// Browser accounting audit with isolated local PostgreSQL, never production data.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {PostgresDatabase} from '../server/database.ts';
import {DemoWalletStore} from '../server/demoWallet.ts';
import {demoBalanceUnits} from '../server/demoWalletAmounts.ts';
import {startVelvet} from '../server/games/velvetReign.ts';
import {seededRandom} from '../src/shared/draconaMath.ts';
import {VELVET_INFO} from '../src/shared/velvetReign.ts';
const output=process.argv[2]||'docs/game-math/velvet-client-audit-20261024.json';
const db=new PostgresDatabase(':memory:'),streams=[],sourcePaths=['src/ui/VelvetReignUI.ts','src/ui/slotKit/SlotSessions.ts','src/ui/slotKit/SlotScreens.ts','src/wallet/WalletClient.ts','src/wallet/ExpansionClient.ts','server/games/velvetReign.ts','server/games/velvetMath.ts','server/demoExpansion.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
let draw=()=>0,account='',wallet,operations=[],server,browser;
const seeded=seed=>{const r=seededRandom(seed);return max=>Math.floor(r()*max);};
const script=()=>`import {VelvetReignUI} from '/src/ui/VelvetReignUI.ts';import {demoWallet} from '/src/wallet/WalletClient.ts';import {expansionClient} from '/src/wallet/ExpansionClient.ts';
window.audit={wallet:demoWallet,client:expansionClient};demoWallet.setAccount(${JSON.stringify(account)});await expansionClient.refresh();window.audit.ui=new VelvetReignUI(document.querySelector('main'));`;
try{
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
 wallet=new DemoWalletStore(db,max=>draw(max));await wallet.ready;
 server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:0},plugins:[{name:'velvet-accounting-audit',configureServer(vite){
  vite.middlewares.use(async(req,res,next)=>{
   const path=new URL(req.url,'http://local.test').pathname;
   try{
    if(path==='/__velvet-audit'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><style>[hidden]{display:none!important}body{margin:0;background:#111;color:white}main{width:min(1200px,100vw)}</style><main></main><script type="module">'+script()+'</script></html>');return;}
    if(path==='/api/demo-wallet/expansion'){
     let result;if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());result=await wallet.expansion.operate(account,body,2,true,true);operations.push({request:body,response:structuredClone(result)});}else result=await wallet.expansion.active(account,true,true);
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(path==='/api/demo-wallet'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await wallet.snapshot(account)));return;}
    if(path.startsWith('/api/')){res.statusCode=401;res.setHeader('Content-Type','application/json');res.end('{"error":"Isolated test account"}');return;}
    next();
   }catch(error){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
  });
 }}]});await server.listen();const base='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}])for(const mode of VELVET_INFO.modes){
  account=randomUUID();await db.prepare('INSERT INTO accounts VALUES(?)').run(account);await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount:100000});
  let seed=1;while(seed<20000&&startVelvet({luelon:{mode:mode.id}},'100',seeded(seed)).ended)seed++;assert(seed<20000);draw=seeded(seed);operations=[];
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/__velvet-audit');await page.waitForFunction(()=>window.audit?.ui&&window.audit.ui.assets.ready&&!window.audit.client.loading);
  await page.locator('[data-lg-dialog-action="enter"]').click();
  if(mode.id!=='normal'){
   await page.locator('[data-velvet-missions]').click();
   if(mode.bonus){await page.locator('[data-lg-dialog-action="mission:'+mode.id+'"]').click();await page.locator('[data-lg-dialog-action="buy"]').click();}
   else {await page.locator('[data-lg-dialog-action="activate:'+mode.id+'"]').click();await page.locator('[data-lg-spin]').click();}
  }else await page.locator('[data-lg-spin]').click();
  await page.waitForFunction(()=>window.audit.client.sessions[0]?.state==='active'&&!window.audit.ui.live&&!window.audit.client.busy);
  const read=()=>page.evaluate(()=>({displayedBalance:document.querySelector('[data-lg-balance]').textContent,grossUnits:Number(document.querySelector('[data-lg-total]').dataset.units),walletBalance:window.audit.wallet.wallet.balance,session:window.audit.client.sessions[0],dialog:window.audit.ui.dialog,modeLabel:document.querySelector('[data-vr-mode]').textContent,ledgerAmounts:[...document.querySelectorAll('.lg-round-ledger strong')].map(e=>Math.round(Number(e.textContent.replace(/[\s\u00a0\u202f]/g,'').replace(',','.'))*100))}));
  const initial=await read(),spent=100*mode.cost;assert.equal(initial.session.stakeUnits,'100');assert.equal(initial.session.spentUnits,String(spent));assert.equal(initial.walletBalance,100000-mode.cost);assert.equal(initial.grossUnits,Number(initial.session.view.luelon.totalPayoutUnits));
  assert(initial.displayedBalance.replace(/[^0-9]/g,'').startsWith(String(100000-mode.cost)),'Visible balance mismatch: '+initial.displayedBalance);
  const startPosts=operations.length;await page.reload();await page.waitForFunction(()=>window.audit?.ui&&window.audit.ui.assets.ready&&!window.audit.client.loading);const activeRestored=await read();
  assert.equal(activeRestored.session.id,initial.session.id);assert.equal(activeRestored.walletBalance,initial.walletBalance);assert.equal(operations.length,startPosts);assert(activeRestored.modeLabel.includes(mode.name),'Accepted mode label lost after reopening '+mode.id+': '+activeRestored.modeLabel);
  await page.locator('[data-lg-dialog-action="enter"]').click();
  await page.waitForFunction(()=>window.audit.client.sessions[0]?.state==='settled'&&!window.audit.ui.live&&!window.audit.client.busy,{timeout:45000});
  const final=await read(),returned=Number(final.session.returnedUnits),expected=10000000-spent+returned;assert.equal(await demoBalanceUnits(db,account),expected);assert.equal(final.walletBalance,expected/100);assert.equal(final.grossUnits,returned);assert.equal(Math.round(Number(final.displayedBalance.replace(/[\s\u00a0\u202f]/g,'').replace(',','.'))*100),expected);assert.deepEqual(final.ledgerAmounts,[spent,returned,returned-spent]);
  const posts=operations.length,sessionId=final.session.id;assert.equal(operations.filter(x=>x.request.action==='start').length,1);assert(operations.filter(x=>x.request.action==='move').every(x=>!('stakeUnits'in x.request)&&!('settings'in x.request)));
  for(const op of operations){const s=op.response.session;assert.equal(s.spentUnits,String(spent));assert.equal(op.response.wallet.balance,(10000000-spent+(s.state==='settled'?Number(s.returnedUnits):0))/100);}
  await page.reload();await page.waitForFunction(()=>window.audit?.ui&&window.audit.ui.assets.ready&&!window.audit.client.loading);const reopened=await read();assert.equal(reopened.walletBalance,expected/100);assert.equal(reopened.grossUnits,returned);assert.equal(reopened.session.id,sessionId);assert.equal(operations.length,posts);assert.deepEqual(errors,[]);
  const row={mode:mode.id,viewport,costMultiplier:mode.cost,seed,stakeUnits:100,initialBalanceUnits:10000000,spentUnits:spent,returnedUnits:returned,netRoundUnits:returned-spent,finalBalanceUnits:expected,freeMoves:posts-1,startVisibleBalance:initial.displayedBalance,finalVisibleBalance:final.displayedBalance,displayedGrossUnits:final.grossUnits,displayedLedgerAmounts:final.ledgerAmounts,activeRestoredModeLabel:activeRestored.modeLabel,reopenNoDebitOrCredit:true,networkOperations:operations.map(x=>({action:x.request.action,revision:x.request.revision,state:x.response.session.state,walletBalance:x.response.wallet.balance,totalPayoutUnits:x.response.session.view.luelon.totalPayoutUnits,returnedUnits:x.response.session.returnedUnits}))};streams.push(row);console.log(JSON.stringify({mode:mode.id,viewport,seed,spentUnits:spent,returnedUnits:returned,netRoundUnits:returned-spent,freeMoves:posts-1}));await context.close();
 }
 for(const [p,h]of Object.entries(sourceHashes))assert.equal(createHash('sha256').update(await readFile(p)).digest('hex'),h);
 const report={generatedAt:new Date().toISOString(),sourceCommit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'Actual VelvetReignUI and shared browser clients make HTTP requests to a local adapter backed by real DemoWalletStore and isolated PostgreSQL. Auth routing is outside this adapter test. Constructed natural bonus seeds verify accounting and display, not frequencies or RTP. Uses reduced motion only for faster presentation. No production requests or player data.',sourceHashes,results:streams};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:streams.length,output}));
}finally{await browser?.close();await server?.close();await db.close();}
