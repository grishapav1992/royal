// Browser accounting audit in isolated local PostgreSQL. No production access.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {PostgresDatabase} from '../server/database.ts';
import {DemoWalletStore} from '../server/demoWallet.ts';
import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts.ts';
import {startLuelonSlotGame,moveLuelonSlotGame} from '../server/games/luelonSlots.ts';
import {seededRandom} from '../src/shared/draconaMath.ts';
import {LUELON_SLOT_INFO} from '../src/shared/luelonSlotsModels.ts';
import {COSMIC_ESCAPE_BET_UNITS} from '../src/shared/cosmicEscapeBets.ts';

const game='studio-cosmic-escape',info=LUELON_SLOT_INFO[game],output=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'docs/game-math/cosmic-client-audit-20261025.json';
const sourcePaths=['scripts/cosmic-client-audit.mjs','src/ui/CosmicEscapeUI.ts','src/ui/CosmicEscapeBoard.ts','src/ui/slotKit/SlotSessions.ts','src/ui/slotKit/SlotScreens.ts','src/ui/slotKit/SlotPlayback.ts','src/wallet/WalletClient.ts','src/wallet/ExpansionClient.ts','server/games/luelonSlots.ts','src/shared/luelonSlots.ts','src/shared/luelonSlotsModels.ts','src/shared/cosmicEscapeBets.ts','server/demoExpansion.ts','server/demoWallet.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const db=new PostgresDatabase(':memory:'),results=[];
let draw=()=>0,draws=0,account='',wallet,operations=[],fault=null,faultTriggered=false,server,browser;
const seeded=seed=>{const random=seededRandom(seed);return max=>Math.floor(random()*max);};
const start=(mode,stake,rng)=>startLuelonSlotGame(game,{luelon:{mode}},String(stake),rng);
const seedForPortals=new Map();
for(let seed=1;seed<200000&&seedForPortals.size<3;seed++){
 const first=start('normal',100,seeded(seed)),count=first.luelon.spin.initialGrid.filter(n=>n===8).length;
 if(!first.ended&&count>=3&&!seedForPortals.has(count))seedForPortals.set(count,seed);
}
assert.equal(seedForPortals.size,3,'Need independently constructed natural 3, 4 and 5 portal entries');
const cases=[...[3,4,5].map(portals=>({id:'natural-'+portals,mode:'normal',cost:1,portals,spins:portals===3?10:portals===4?12:15,seed:seedForPortals.get(portals)})),...info.modes.filter(m=>m.bonus).map(m=>({id:m.id,mode:m.id,cost:m.cost,portals:null,spins:m.spins,seed:1}))];
const scenarios=[];
for(const viewport of [{width:1440,height:1000},{width:390,height:844}])for(const stake of [20,100])for(const item of cases)scenarios.push({...item,stake,viewport,fault:null});
scenarios.push({...cases.find(c=>c.id==='cosmic-chaos'),stake:20,viewport:{width:1440,height:1000},fault:'start'},
 {...cases.find(c=>c.id==='natural-3'),stake:20,viewport:{width:1440,height:1000},fault:'move'},
 {...cases.find(c=>c.id==='deep-echo'),stake:20,viewport:{width:390,height:844},fault:'final'});

const script=()=>`import {CosmicEscapeUI} from '/src/ui/CosmicEscapeUI.ts';import {demoWallet} from '/src/wallet/WalletClient.ts';import {expansionClient} from '/src/wallet/ExpansionClient.ts';
window.audit={wallet:demoWallet,client:expansionClient};demoWallet.setAccount(${JSON.stringify(account)});await expansionClient.refresh();window.audit.ui=new CosmicEscapeUI(document.querySelector('main'));`;
const units=text=>Math.round(Number(String(text).replace(/^[^\d-]*/,'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.'))*100);
try{
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');wallet=new DemoWalletStore(db,max=>{draws++;return draw(max);});await wallet.ready;
 server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:0},plugins:[{name:'cosmic-accounting-audit',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  const path=new URL(req.url,'http://local.test').pathname;
  try{
   if(path==='/__cosmic-audit'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><style>[hidden]{display:none!important}body{margin:0;background:#111;color:white}main{width:min(1200px,100vw)}</style><main></main><script type="module">'+script()+'</script></html>');return;}
   if(path==='/api/demo-wallet/expansion'){
    let value;
    if(req.method==='POST'){
     const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString()),beforeDraws=draws;
     value=await wallet.expansion.operate(account,request,2,true,true);
     operations.push({request,response:structuredClone(value),draws:draws-beforeDraws,responseDropped:false});
    }else value=await wallet.expansion.active(account,true,true);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
   }
   if(path==='/api/demo-wallet'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await wallet.snapshot(account)));return;}
   if(path.startsWith('/api/')){res.statusCode=401;res.setHeader('Content-Type','application/json');res.end('{"error":"Isolated test account"}');return;}
   next();
  }catch(error){res.statusCode=error.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
 });}}]});await server.listen();const base='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const spec of scenarios.filter(item=>!process.argv.includes('--faults-only')||item.fault)){
  account=randomUUID();await db.prepare('INSERT INTO accounts VALUES(?)').run(account);await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount:100000});
  draw=seeded(spec.seed);draws=0;operations=[];fault=spec.fault;faultTriggered=false;
  const referenceDraw=seeded(spec.seed);let reference=start(spec.mode,spec.stake,referenceDraw);
  const expectedAward=reference.luelon.bonus.awarded;
  if(spec.portals)assert.equal(reference.luelon.spin.initialGrid.filter(n=>n===8).length,spec.portals);
  while(!reference.ended)reference=moveLuelonSlotGame(reference.luelon,String(spec.stake),reference.luelon.revision,'luelon-spin',undefined,referenceDraw);
  const context=await browser.newContext({viewport:spec.viewport,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  await context.route('**/api/demo-wallet/expansion',async route=>{
   const response=await route.fetch();
   if(route.request().method()==='POST'&&!faultTriggered&&fault){
    const request=route.request().postDataJSON(),value=await response.json();
    if(fault==='start'?request.action==='start':fault==='move'?request.action==='move':value.session.state==='settled'){
     faultTriggered=true;operations.at(-1).responseDropped=true;await route.abort('failed');return;
    }
   }
   await route.fulfill({response});
  });
  page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>window.audit?.ui&&window.audit.ui.assets.ready&&!window.audit.client.loading,null,{timeout:30000});
  const stable=()=>page.waitForFunction(()=>!window.audit.ui.live&&!window.audit.client.busy,null,{timeout:30000});
  const read=()=>page.evaluate(()=>({displayedBalance:document.querySelector('[data-lg-balance]').textContent,grossUnits:Number(document.querySelector('[data-lg-total]').dataset.units),walletBalance:window.audit.wallet.wallet.balance,session:window.audit.client.sessions[0],dialog:window.audit.ui.dialog,pending:window.audit.client.pending,costText:document.querySelector('[data-lg-cost]').textContent,bonusName:document.querySelector('[data-lg-bonus-name]').textContent,remaining:Number(document.querySelector('[data-lg-remaining]').textContent),stakeValue:document.querySelector('[data-lg-stake]').value,ledgerAmounts:[...document.querySelectorAll('.lg-round-ledger strong')].map(e=>Math.round(Number(e.textContent.replace(/[\s\u00a0\u202f]/g,'').replace(',','.'))*100))}));
  const recoverPending=async()=>{
   assert(faultTriggered);await page.waitForFunction(()=>window.audit.client.pending&&!window.audit.client.busy&&!window.audit.ui.live);
   const previous=await read(),requests=operations.length;await page.reload();await ready();let recovered=await read();assert(recovered.pending);assert.equal(recovered.pending.id,previous.pending.id);assert.equal(operations.length,requests);
   await page.locator('[data-lg-dialog-action="enter"]').click();await page.locator('[data-lg-retry]').click();await page.waitForFunction(()=>!window.audit.client.pending&&!window.audit.client.busy&&!window.audit.ui.live);
   recovered=await read();assert.equal(operations.length,requests+1);const replay=operations.at(-1);assert(replay.response.replayed);assert.equal(replay.request.id,previous.pending.id);assert.equal(replay.draws,0);return recovered;
  };
  await page.goto(base+'/__cosmic-audit');await ready();await page.locator('[data-lg-dialog-action="enter"]').click();
  assert.deepEqual(await page.locator('[data-lg-stake] option').evaluateAll(elements=>elements.map(e=>e.value)),[...COSMIC_ESCAPE_BET_UNITS]);
  await page.locator('[data-lg-stake]').selectOption(String(spec.stake));let displayedPurchaseCost=null;
  if(spec.mode!=='normal'){
   await page.locator('[data-cosmic-missions]').click();await page.locator('[data-lg-dialog-action="mission:'+spec.mode+'"]').click();
   displayedPurchaseCost=units(await page.locator('.ce-confirm strong').textContent());assert.equal(displayedPurchaseCost,spec.stake*spec.cost);assert.equal(units(await page.locator('[data-lg-dialog-action="buy"]').textContent()),spec.stake*spec.cost);
   await page.locator('[data-lg-dialog-action="buy"]').click();
  }else{assert.equal(units((await read()).costText),spec.stake);await page.locator('[data-lg-spin]').click();}
  await stable();let initial;
  if(spec.fault==='start')initial=await recoverPending();else{await page.waitForFunction(()=>window.audit.client.sessions[0]?.state==='active'&&!window.audit.ui.live&&!window.audit.client.busy);initial=await read();}
  const spent=spec.stake*spec.cost,initialBalanceUnits=10000000;
  assert.equal(initial.session.stakeUnits,String(spec.stake));assert.equal(initial.session.spentUnits,String(spent));assert.equal(initial.session.view.luelon.bonus.awarded,spec.spins);assert.equal(expectedAward,spec.spins);assert.equal(initial.walletBalance,(initialBalanceUnits-spent)/100);assert.equal(units(initial.displayedBalance),initialBalanceUnits-spent);assert.equal(initial.grossUnits,Number(initial.session.view.luelon.totalPayoutUnits));assert.match(initial.costText,/бесплатно/i);assert.equal(initial.stakeValue,String(spec.stake));
  const expectedName=info.modes.find(m=>m.id===(spec.mode==='normal'?'cosmic-chaos':spec.mode)).name;assert.equal(initial.bonusName,expectedName);
  const initialRevision=initial.session.view.luelon.revision;
  if(initial.dialog==='bonus')await page.locator('[data-lg-dialog-action="bonus"]').click();else await page.locator('[data-lg-spin]').click();
  if(spec.fault!=='move')await page.locator('[data-lg-pause]').click();await stable();let mid;
  if(spec.fault==='move')mid=await recoverPending();else{await page.waitForFunction(revision=>window.audit.client.sessions[0].view.luelon.revision>revision&&!window.audit.ui.live&&!window.audit.client.busy,initialRevision);mid=await read();}
  assert.equal(mid.session.state,'active');assert(mid.session.view.luelon.bonus.played>=1);assert.equal(mid.walletBalance,(initialBalanceUnits-spent)/100);assert.match(mid.costText,/бесплатно/i);
  const midPosts=operations.length;await page.reload();await ready();const activeRestored=await read();assert.equal(activeRestored.session.id,initial.session.id);assert.deepEqual(activeRestored.session.view.luelon,mid.session.view.luelon);assert.equal(activeRestored.walletBalance,mid.walletBalance);assert.equal(activeRestored.grossUnits,mid.grossUnits);assert.equal(activeRestored.bonusName,expectedName);assert.equal(activeRestored.stakeValue,String(spec.stake));assert.equal(operations.length,midPosts);
  await page.locator('[data-lg-dialog-action="enter"]').click();
  await page.waitForFunction(()=>!window.audit.client.busy&&!window.audit.ui.live&&(window.audit.client.pending||window.audit.client.sessions[0]?.state==='settled'),null,{timeout:60000});
  let final;
  if(spec.fault==='final'){final=await recoverPending();await page.locator('[data-lg-history]').click();final=await read();}else final=await read();
  const returned=Number(final.session.returnedUnits),expected=initialBalanceUnits-spent+returned;
  assert.equal(final.session.state,'settled');assert.equal(returned,reference.credit);assert.equal(final.session.view.luelon.history.filter(s=>s.kind==='free-spin').length,spec.spins);assert.equal(await demoBalanceUnits(db,account),expected);assert.equal(await demoReservedUnits(db,account),0);assert.equal(final.walletBalance,expected/100);assert.equal(units(final.displayedBalance),expected);assert.equal(final.grossUnits,returned);assert.deepEqual(final.ledgerAmounts,[spent,returned,returned-spent]);
  const uniqueStarts=new Set(operations.filter(x=>x.request.action==='start').map(x=>x.request.id));assert.equal(uniqueStarts.size,1);
  assert(operations.filter(x=>x.request.action==='move').every(x=>!('stakeUnits'in x.request)&&!('settings'in x.request)));
  for(const op of operations){const session=op.response.session;assert.equal(session.spentUnits,String(spent));assert.equal(op.response.wallet.balance,(initialBalanceUnits-spent+(session.state==='settled'?Number(session.returnedUnits):0))/100);if(op.response.replayed)assert.equal(op.draws,0);}
  const ledger=await db.prepare("SELECT entry_type,count(*) AS n,sum(amount_units) AS amount FROM demo_ledger WHERE account_id=? AND source=? GROUP BY entry_type").all(account,game);
  assert.equal(Number(ledger.find(x=>x.entry_type==='bet').n),1);assert.equal(Number(ledger.find(x=>x.entry_type==='bet').amount),-spent);assert.equal(Number(ledger.find(x=>x.entry_type==='win').n),1);assert.equal(Number(ledger.find(x=>x.entry_type==='win').amount),returned);
  const posts=operations.length;await page.reload();await ready();const reopened=await read();assert.equal(reopened.walletBalance,expected/100);assert.equal(units(reopened.displayedBalance),expected);assert.equal(reopened.grossUnits,returned);assert.equal(reopened.session.id,final.session.id);assert.equal(operations.length,posts);assert.deepEqual(errors,[]);assert.equal(!!spec.fault,faultTriggered);
  const row={case:spec.id,mode:spec.mode,portalCount:spec.portals,viewport:spec.viewport,stakeUnits:spec.stake,costMultiplier:spec.cost,seed:spec.seed,awardedFreeSpins:spec.spins,playedFreeSpins:final.session.view.luelon.history.filter(s=>s.kind==='free-spin').length,initialBalanceUnits,spentUnits:spent,returnedUnits:returned,netRoundUnits:returned-spent,finalBalanceUnits:expected,visibleFinalBalance:final.displayedBalance,displayedGrossUnits:final.grossUnits,displayedLedgerAmounts:final.ledgerAmounts,displayedPurchaseCostUnits:displayedPurchaseCost,activeBonusName:activeRestored.bonusName,midBonusRevision:activeRestored.session.view.luelon.revision,midBonusGrossUnits:activeRestored.grossUnits,lostResponse:spec.fault,replayedRequests:operations.filter(x=>x.response.replayed).length,allContinuationCostsZero:true,all26StakeOptionsMatch:true,midBonusRestored:true,settledReopenNoDebitOrCredit:true,singleDebitAndFinalCredit:true,network:operations.map(x=>({action:x.request.action,revision:x.request.revision,replayed:x.response.replayed,responseDropped:x.responseDropped,rngDraws:x.draws,state:x.response.session.state,walletBalance:x.response.wallet.balance,totalPayoutUnits:x.response.session.view.luelon.totalPayoutUnits,returnedUnits:x.response.session.returnedUnits}))};
  results.push(row);console.log(JSON.stringify({case:spec.id,viewport:spec.viewport,stakeUnits:spec.stake,lostResponse:spec.fault,spentUnits:spent,returnedUnits:returned,midBonusRevision:row.midBonusRevision}));await context.close();
 }
 for(const [path,hash]of Object.entries(sourceHashes))assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hash,'Audited source changed while browser was running: '+path);
 const report={generatedAt:new Date().toISOString(),sourceCommit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'Actual CosmicEscapeUI, ExpansionClient and WalletClient make HTTP requests to a local test adapter backed by real DemoWalletStore and isolated PostgreSQL. Constructed natural 3/4/5-portal seeds and purchased modes verify accounting and display, not frequencies or RTP. Two viewport sizes and stakes20/100. Recovery includes actual reload during a partially played bonus and deliberate lost responses after committed start, continuation and final settlement. Reduced motion changes presentation only. No production requests, player data, production auth or full host/chat layout claims.',sourceHashes,results};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:results.length,output}));
}finally{await browser?.close();await server?.close();await db.close();}
