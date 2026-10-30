import {test,expect,request as apiRequest,type Page,type APIRequestContext} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {temporaryDatabase} from '../scripts/database-test';
import {PostgresDatabase,databaseConfig} from '../server/database';

const port=process.env.TEMPLE_RELEASE_PORT??'2635',origin='http://127.0.0.1:'+port,scope=process.env.TEMPLE_RELEASE_SCOPE??'artifacts/work/temple-release-preparation';
let database:Awaited<ReturnType<typeof temporaryDatabase>>|undefined,backend:ChildProcess|undefined,backendLog='';
let fundingDb:PostgresDatabase,fundingWallet:any;
const game=(p:Page)=>p.frameLocator('.temple-frame');
const state=(p:Page)=>p.evaluate(()=>(window as any).royalDemo?.getMiniState());
const accepted=(p:Page)=>p.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].expansionClient.sessions.find((s:any)=>s.gameId==='studio-flooded-temple'));
const balance=(p:Page)=>p.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].demoWallet.wallet.balance);
async function report(name:string,value:unknown){await mkdir(scope,{recursive:true});await writeFile(scope+'/'+name+'.json',JSON.stringify(value,null,2)+'\n');}
async function auth(api:APIRequestContext){
 const r=await api.post('/api/auth/login',{data:{email:'temple-release-'+randomUUID()+'@example.test',password:'Temple-local-review-42!'}});expect(r.ok()).toBe(true);
 expect((await api.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
 const me=await(await api.get('/api/auth/me')).json();await fundingWallet.operate(me.account.id,{id:randomUUID(),kind:'deposit',amount:10000});return{id:me.account.id,cookie:r.headers()['set-cookie'].split(';')[0]};
}
async function open(p:Page){
 await p.locator('#games-tab').click();await p.locator('[data-cabinet=studio-dracona]').click();await p.locator('[data-platform-game=studio-flooded-temple]').click();
 await expect(game(p).locator('[data-ft=primary]')).toBeEnabled();await expect.poll(async()=>(await state(p)).character.loaded.length).toBe(6);
}
async function done(p:Page){await expect.poll(async()=>{const s=await state(p);return s?.completed&&!s.busy&&!s.presenting;},{timeout:60000}).toBe(true);}

test.beforeAll(async()=>{
 test.setTimeout(120000);database=await temporaryDatabase();
 backend=spawn(process.execPath,['dist-server/index.js'],{env:{...process.env,...database.env,PORT:port,AUTH_DB_PATH:'temple_release_review',PUBLIC_ORIGIN:origin,NILE_PLAY_SOCKET_FILE:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
 for(const stream of[backend.stdout,backend.stderr])stream?.on('data',b=>{backendLog=(backendLog+b).slice(-6000);});
 let ready=false;for(let i=0;i<100;i++){
  if(backend.exitCode!==null)throw Error('Built backend stopped: '+backendLog);
  ready=await fetch(origin+'/healthz').then(r=>r.ok).catch(()=>false);if(ready)break;await new Promise(resolve=>setTimeout(resolve,200));
 }
 if(!ready)throw Error('Built backend did not start: '+backendLog);
 const funding=await build({entryPoints:['server/demoWallet.ts'],bundle:true,platform:'node',packages:'external',format:'esm',write:false});await mkdir(scope,{recursive:true});await writeFile(scope+'/funding-store.mjs',funding.outputFiles[0].contents);
 const {DemoWalletStore}=await import(pathToFileURL(resolve(scope+'/funding-store.mjs')).href);
 fundingDb=new PostgresDatabase('temple_release_review',{existingSchema:true,config:databaseConfig({...process.env,...database.env})});fundingWallet=new DemoWalletStore(fundingDb);await fundingWallet.ready;
 await report('built-server',{origin,programSha256:createHash('sha256').update(await readFile('dist-server/index.js')).digest('hex'),clientIndexSha256:createHash('sha256').update(await readFile('dist/index.html')).digest('hex'),disposableDatabase:true,vite:false,walletMiddlewareFixture:false,syntheticFundsOnly:true,funding:'Existing wallet store, only in the isolated temporary database'});
});
test.afterAll(async()=>{
 if(backend&&backend.exitCode===null){backend.kill();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,5000);backend!.once('exit',()=>{clearTimeout(timer);resolve();});});}
 await fundingDb?.close();await database?.cleanup();
});

test('compiled API negotiates Temple rules separately and settles/replays one original stake',async()=>{
 const api=await apiRequest.newContext({baseURL:origin});try{
  const account=await auth(api),headers={'X-Royal-Account-Id':account.id},path='/api/demo-wallet/expansion';
  const initial=(await(await api.get('/api/demo-wallet',{headers})).json()).balance;
  const op={id:randomUUID(),action:'start',gameId:'studio-flooded-temple',stakeUnits:'1000',settings:{temple:{mode:'cascades'}}};
  for(const capabilities of[{}, {'X-Royal-Flag-Battle':'2'},{'X-Royal-Temple-Rules':'1'}]){
   const r=await api.post(path,{headers:{...headers,...capabilities},data:op});expect(r.status()).toBe(409);
   expect((await(await api.get('/api/demo-wallet',{headers})).json()).balance).toBe(initial);
  }
  const current={...headers,'X-Royal-Temple-Rules':'2'},begun=await api.post(path,{headers:current,data:op});expect(begun.ok(),await begun.text()).toBe(true);
  let reply=await begun.json(),session=reply.session,continuations=0;expect(session.rulesVersion).toBe(2);
  while(session.state==='active'){
   expect(continuations++).toBeLessThan(200);
   const r=await api.post(path,{headers:current,data:{id:randomUUID(),gameId:op.gameId,action:'move',sessionId:session.id,revision:session.view.templeCascade.revision,move:'temple-cascade'}});expect(r.ok()).toBe(true);reply=await r.json();session=reply.session;
  }
  expect(session.spentUnits).toBe('1000');expect(Math.round(reply.wallet.balance*100)).toBe(Math.round(initial*100)-1000+Number(session.returnedUnits));
  const replay=await(await api.post(path,{headers:current,data:op})).json();expect(replay.replayed).toBe(true);expect(replay.session.id).toBe(session.id);expect(replay.wallet.balance).toBe(reply.wallet.balance);
  for(const version of['0','1']){const hidden=await(await api.get(path,{headers:{...headers,'X-Royal-Temple-Rules':version}})).json();expect(hidden.sessions.some((s:any)=>s.id===session.id)).toBe(false);}
  const old=await api.post(path,{headers:{...headers,'X-Royal-Temple-Rules':'1'},data:{...op,id:randomUUID(),settings:{temple:{mode:'normal'}}}});expect(old.ok()).toBe(true);let legacy=(await old.json()).session;expect(legacy.rulesVersion).toBe(1);
  if(legacy.state==='active'){const r=await api.post(path,{headers:current,data:{id:randomUUID(),gameId:op.gameId,action:'move',sessionId:legacy.id,revision:legacy.view.temple.revision,move:'temple-finish'}});expect(r.ok()).toBe(true);legacy=(await r.json()).session;}
  expect(legacy.state).toBe('settled');expect(legacy.rulesVersion).toBe(1);
  await report('compiled-protocol',{unsupportedClientsRejectedBeforeDebit:true,independentCapability:true,legacyRulesPreserved:true,paidRoundId:session.id,stakeUnits:session.stakeUnits,payoutUnits:session.returnedUnits,continuations,replayWithoutDebit:true});
 }finally{await api.dispose();}
});

for(const mobile of[false,true])test(`built Royal, real wallet, connected chat and lost-response recovery: ${mobile?'phone EN':'desktop RU'}`,async({browser})=>{
 const context=await browser.newContext({baseURL:origin,viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?3:1,reducedMotion:'reduce'}),api=await apiRequest.newContext({baseURL:origin});let peer:any;
 const diagnostics:any[]=[];let reviewPage:Page|undefined;
 try{
  const identity=await auth(api);
  peer=await new Client(origin,{headers:{Cookie:identity.cookie},fetchFn:async(url,options)=>{const r=await api.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}}).create('lobby');for(const type of['chat','activities','piano-note','notice','pvp'])peer.onMessage(type,()=>{});
  const page=reviewPage=await context.newPage(),errors:string[]=[],posts:any[]=[],manifests:string[]=[];page.on('pageerror',e=>{errors.push(e.message);diagnostics.push({pageError:e.stack});});page.on('console',m=>{if(m.type()==='error')diagnostics.push({console:m.text()});});page.on('requestfailed',r=>diagnostics.push({failed:new URL(r.url()).pathname,error:r.failure()?.errorText}));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/expansion')){expect(r.headers()['x-temple-test-case']).toBeUndefined();posts.push(r.postDataJSON());}if(r.url().includes('/studio-flooded-temple/versions/')&&r.url().endsWith('/manifest.json'))manifests.push(r.url());});
  await auth(page.request);await page.goto('/?lang='+(mobile?'en':'ru')+'&room='+peer.roomId);await expect(page.locator('#loading')).toHaveCount(0,{timeout:60000});await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});await page.waitForFunction(()=>(window as any).royalDemo?.getState().online===true,{},{timeout:20000});await open(page);
  const initial=await balance(page);await game(page).locator('[data-ft=primary]').click();await done(page);const first=await accepted(page);expect(first.rulesVersion).toBe(2);expect(Math.round((await balance(page))*100)).toBe(Math.round(initial*100)-1000+Number(first.returnedUnits));
  const geometry=await game(page).locator('.ft').evaluate(root=>{const box=(q:string)=>root.querySelector(q)!.getBoundingClientRect().toJSON();return{width:root.clientWidth,scroll:root.scrollWidth,girl:box('.ft-character'),board:box('.ft-cabinet'),netFont:parseFloat(getComputedStyle(root.querySelector('.ft-net')!).fontSize)};});
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.netFont).toBeGreaterThanOrEqual(12);if(geometry.width>520)expect(geometry.girl.right).toBeLessThanOrEqual(geometry.board.left-8);else expect(geometry.girl.bottom).toBeLessThanOrEqual(geometry.board.top);
  await expect(page.locator('#mini-dialog #chat-input')).toBeVisible();await expect(page.locator('#mini-dialog #chat-input')).toBeEnabled();
  await page.locator('#studio-game-list').click();await page.locator('[data-platform-game=studio-flooded-temple]').click();await done(page);expect((await accepted(page)).id).toBe(first.id);expect((await state(page)).audio.played).toEqual({});
  let lost=false,acceptedBeforeLoss:any;
  await page.route('**/api/demo-wallet/expansion',async route=>{
   const r=route.request();if(r.method()==='POST'&&r.postDataJSON().action==='start'&&!lost){lost=true;acceptedBeforeLoss=await(await route.fetch()).json();await route.abort('failed');}else await route.continue();
  });
  await game(page).locator('[data-ft=primary]').click();await expect.poll(async()=>{const s=await state(page);return s.pending&&!s.busy;}).toBe(true);const pendingId=posts.filter(p=>p.action==='start').at(-1).id;
  await page.reload();await expect(page.locator('#loading')).toHaveCount(0,{timeout:60000});await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});await page.waitForFunction(()=>(window as any).royalDemo?.getState().online===true);await open(page);
  await expect.poll(async()=>(await state(page)).pending).toBe(true);await page.unroute('**/api/demo-wallet/expansion');await game(page).locator('[data-ft=primary]').click();await done(page);
  const recovered=await accepted(page);expect(recovered.id).toBe(pendingId);expect(recovered.id).toBe(acceptedBeforeLoss.session.id);expect(recovered.spentUnits).toBe('1000');expect(new Set(posts.filter(p=>p.action==='start').map(p=>p.id)).size).toBe(2);
  expect(Math.round((await balance(page))*100)).toBe(Math.round(initial*100)-2000+Number(first.returnedUnits)+Number(recovered.returnedUnits));expect(manifests.some(m=>m.includes(process.env.TEMPLE_RELEASE_VERSION??'0.9.3-4a6b3fba5115'))).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:scope+'/built-host-'+(mobile?'phone':'desktop')+'.png'});
  await report('built-host-'+(mobile?'phone':'desktop'),{geometry,chatConnected:true,chatMessagesSent:0,paidStarts:2,requestStartAttempts:posts.filter(p=>p.action==='start').length,recoveredSameUUID:true,exactBalance:true,quietReopen:true,module:manifests.at(-1),errors});
 }catch(error){await report('built-host-failure',{mobile,diagnostics,network:await reviewPage?.evaluate(()=>(window as any).royalDemo?.getNetworkState()).catch(()=>undefined),backend:backendLog});throw error;}
 finally{if(peer)await peer.leave();await context.close();await api.dispose();}
});
