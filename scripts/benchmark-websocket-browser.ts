import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
import {Protocol} from '@colyseus/core';

// Run through scripts/database-test.ts so the browser uses an isolated database.
if(process.env.NODE_ENV!=='test')throw new Error('An isolated test database is required.');
const children=[
  spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{stdio:'ignore'}),
  spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','server/index.ts'],{stdio:'ignore'}),
];
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  for(const url of ['http://127.0.0.1:5173','http://127.0.0.1:2567/healthz']){
    let ready=false;
    for(let i=0;i<100;i++){
      if(children.some(child=>child.exitCode!==null))throw new Error('A local benchmark server exited.');
      try{if((await fetch(url)).ok){ready=true;break;}}catch{}
      await delay(100);
    }
    if(!ready)throw new Error('A local benchmark server did not start.');
  }
  browser=await chromium.launch({channel:'chrome'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const login=await context.request.post('http://127.0.0.1:2567/api/auth/login',{data:{email:`ws-bench-${crypto.randomUUID()}@example.test`,password:'Benchmark-test-123!'}});
  if(!login.ok())throw new Error('Benchmark account login failed.');
  const selected=await context.request.post('http://127.0.0.1:2567/api/auth/character',{data:{skin:0}});
  if(!selected.ok())throw new Error('Benchmark character selection failed.');
  const page=await context.newPage();const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const received:{code:number;bytes:number}[]=[],sent:{code:number;bytes:number}[]=[];
  let measuring=false;
  page.on('websocket',socket=>{
    const record=(frames:typeof received)=>({payload}:{payload:string|Buffer})=>{
      if(measuring&&typeof payload!=='string')frames.push({code:payload[0],bytes:payload.byteLength});
    };
    socket.on('framereceived',record(received));socket.on('framesent',record(sent));
  });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(()=>(window as any).royalDemo?.getNetworkState()?.status==='connected'&&(window as any).royalDemo.getState().locked===false,{},{timeout:20000});
  await page.locator('#game').focus();
  const rows=[];
  for(const [scenario,seconds] of [['idle',6],['walking',4]] as const){
    received.length=0;sent.length=0;
    await page.evaluate(()=>{
      const win=window as any;
      win.__wsAudit={listRebuilds:0,addedTags:0,frames:0};
      win.__wsAuditObserver=new MutationObserver(records=>{
        for(const record of records)if(record.target===document.querySelector('#people-list')){
          if(record.removedNodes.length)win.__wsAudit.listRebuilds++;
          win.__wsAudit.addedTags+=record.addedNodes.length;
        }
      });
      win.__wsAuditObserver.observe(document.querySelector('#people-list')!,{childList:true});
      const tick=()=>{win.__wsAudit.frames++;win.__wsAuditRAF=requestAnimationFrame(tick);};tick();
    });
    measuring=true;const before=performance.now();
    if(scenario==='walking')await page.keyboard.down('d');
    await delay(seconds*1000);
    if(scenario==='walking')await page.keyboard.up('d');
    measuring=false;const durationMs=performance.now()-before;
    const ui=await page.evaluate(()=>{const win=window as any;win.__wsAuditObserver.disconnect();cancelAnimationFrame(win.__wsAuditRAF);return win.__wsAudit;});
    const count=(frames:typeof received)=>({packets:frames.length,bytes:frames.reduce((sum,frame)=>sum+frame.bytes,0),packetsPerSecond:Number((frames.length*1000/durationMs).toFixed(1)),bytesPerSecond:Number((frames.reduce((sum,frame)=>sum+frame.bytes,0)*1000/durationMs).toFixed(1))});
    rows.push({scenario,durationMs:Number(durationMs.toFixed(1)),received:count(received),statePatches:count(received.filter(frame=>frame.code===Protocol.ROOM_STATE_PATCH)),sent:count(sent),
      listRebuilds:ui.listRebuilds,listRebuildsPerSecond:Number((ui.listRebuilds*1000/durationMs).toFixed(1)),addedTags:ui.addedTags,fps:Number((ui.frames*1000/durationMs).toFixed(1))});
  }
  if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
  console.log(JSON.stringify({measurement:'One real Chrome client and real local WebSocket server with isolated temporary database; frame payload bytes exclude WebSocket/TLS headers',rows},null,2));
}finally{
  await browser?.close();
  await Promise.all(children.map(child=>new Promise<void>(resolve=>{if(child.exitCode!==null){resolve();return;}child.once('exit',()=>resolve());child.kill('SIGTERM');})));
}
