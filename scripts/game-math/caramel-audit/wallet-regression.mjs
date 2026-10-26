// Actual DemoWalletStore accounting in temporary local PostgreSQL, no production access.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PostgresDatabase} from '../../../server/database.ts';
import {DemoWalletStore} from '../../../server/demoWallet.ts';
import {demoBalanceUnits,demoReservedUnits} from '../../../server/demoWalletAmounts.ts';
import {CARAMEL_BETS,validCaramelSettlement,validCaramelEnvelope} from '../../../src/shared/caramelCarnival.ts';
import {renderSlotLedger,slotCoins} from '../../../src/ui/slotKit/SlotScreens.ts';
import {gameReactionForAmounts} from '../../../src/ui/gameReactions.ts';
import {t as translateText} from '../../../src/i18n/index.ts';

const outputFolder=new URL('../../../artifacts/work/caramel-audit-20261026/',import.meta.url);
mkdirSync(outputFolder,{recursive:true});
try{writeFileSync(new URL('OWNER.txt',outputFolder),"Owner: Caramel audit runner\nPurpose: generated current-rules Caramel audit output\nCleanup: preserve compact results in GitHub when needed, then remove obsolete task-owned diagnostics; source and tracked evidence are never written here\n",{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}


assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PGHOST,'127.0.0.1');
const root=fileURLToPath(new URL('../../../',import.meta.url)),game='studio-caramel-carnival';
const sources=['server/games/caramelCarnival.ts','src/shared/caramelCarnival.ts','server/demoWallet.ts','server/demoExpansion.ts','server/demoWalletAmounts.ts','src/ui/CaramelCarnivalUI.ts','src/wallet/ExpansionClient.ts','src/ui/slotKit/SlotScreens.ts','src/ui/gameReactions.ts','src/ui/slotKit/SlotAudio.ts'];
const hashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(root+path)).digest('hex')]));
const sourceHashes=hashes(),sourceCommit=execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();

function uiLedgerChecks(){
 const rows=[];
 for(const active of [true,false])for(const grossUnits of [0,2000,3500,5000]){
  const html=renderSlotLedger('cc','3500',String(grossUnits),active);
  const amounts=[...html.matchAll(/<strong>([^<]*)<\/strong>/g)].map(match=>match[1]);
  const labels=[...html.matchAll(/<span>([^<]*)<strong>/g)].map(match=>match[1]);
  assert.deepEqual(amounts,[slotCoins(3500),slotCoins(grossUnits),slotCoins(grossUnits-3500)]);
  assert.deepEqual(labels,[translateText('Стоимость'),translateText(active?'Накоплено':'Выплата'),translateText('Итог')]);
  const reaction=gameReactionForAmounts('3500',String(grossUnits));
  assert.equal(reaction,grossUnits<3500?'lose':grossUnits>3500?'win':undefined);
  rows.push({active,grossUnits,spentUnits:3500,netUnits:grossUnits-3500,reaction:reaction??'neutral',labels,amounts});
 }
 return {passed:true,checks:rows.length,method:'Actual pure renderer and amount-reaction functions. No browser, DOM mounting, layout or listening verification.',rows};
}

const report={generatedAt:new Date().toISOString(),sourceCommit,sourceHashes,
 method:'Actual DemoWalletStore and its deployed DemoExpansionStore against a fresh isolated local PostgreSQL. Constructed entropy proves accounting and saved-state semantics, not frequencies or RTP. A lost response means deliberately ignoring a committed store reply, then replaying the same UUID; no HTTP or browser recovery claim.',
 matrix:[],insufficient:[],extra:[],uiLedger:uiLedgerChecks(),passed:false};
const balanced=n=>Array.from({length:n},(_,i)=>i%7),tickets=n=>[...Array(n).fill(7),...balanced(30-n)];
const energy=[...Array(12).fill(6),...Array(18).fill(11)],baseEnergy=[...Array(12).fill(6),...Array(4).fill(7),...Array(14).fill(11)];
let db=new PostgresDatabase(':memory:'),wallet,pending=[],draws=0;
const draw=max=>{draws++;const sample=pending.shift();assert(sample,'Unexpected RNG draw '+max);assert.equal(max,sample[0]);return sample[1];};
function symbols(values,free){for(const symbol of values){if(symbol===7)pending.push([1000000,0]);else if(symbol<7)pending.push([1000000,999999],[7,symbol]);else pending.push([1000000,free?12000:22000],[100,[0,52,77,95][symbol-8]]);}}
function entropy(initial,refills=[],free=true){assert.equal(pending.length,0);symbols(initial,free);for(const values of refills)symbols(values,free);}
const begin=(stake,mode)=>({id:randomUUID(),action:'start',gameId:game,stakeUnits:stake,settings:{caramel:{mode}}});
const move=session=>({id:randomUUID(),action:'move',gameId:game,sessionId:session.id,revision:session.view.caramel.revision,move:'caramel-spin'});
const operate=(account,op)=>wallet.expansion.operate(account,op);
const journal=account=>db.prepare('SELECT id,operation_id,entry_type,amount_units,balance_units FROM demo_ledger WHERE account_id=? ORDER BY id').all(account);
const row=(account,id)=>db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(account,id);
function valid(session){assert(validCaramelSettlement(session.state,session.stakeUnits,session.spentUnits,session.returnedUnits,session.view.caramel));assert(validCaramelEnvelope(session.state,session.view));}
async function account(coins){const id=randomUUID();await db.prepare('INSERT INTO accounts(id) VALUES(?)').run(id);if(coins)await wallet.operate(id,{id:randomUUID(),kind:'deposit',amount:coins});return id;}
async function replay(account,op,expected){
 const before=await journal(account),calls=draws,balance=await demoBalanceUnits(db,account);
 const replies=await Promise.all([operate(account,op),operate(account,op)]);
 assert(replies.every(reply=>reply.replayed));assert.deepEqual(replies[0].session,expected);assert.deepEqual(replies[1].session,expected);
 assert.equal(draws,calls);assert.equal(await demoBalanceUnits(db,account),balance);assert.deepEqual(await journal(account),before);
}
async function reconnect(account,expected,last){
 assert.equal(pending.length,0);const before=await journal(account),balance=await demoBalanceUnits(db,account),reserve=await demoReservedUnits(db,account),calls=draws,schema=db.schema;
 await db.close();db=new PostgresDatabase(schema,{existingSchema:true});wallet=new DemoWalletStore(db,draw);
 const restored=(await wallet.expansion.active(account)).sessions.find(session=>session.id===expected.id);
 assert.deepEqual(restored,expected);valid(restored);assert.equal(draws,calls);
 assert.equal(await demoBalanceUnits(db,account),balance);assert.equal(await demoReservedUnits(db,account),reserve);assert.deepEqual(await journal(account),before);
 await replay(account,last,expected);
}
async function tamperOrigin(account,session,stage){
 const original=(await row(account,session.id)).payload,saved=JSON.parse(original),view=saved.view.caramel;
 if(stage==='empty')view.bonus.multiplier=50;
 else{
  const first=view.history.find(spin=>spin.kind==='free');assert(first);
  // Energy already saturates at x50. Payments and all after-state fields remain consistent.
  first.multiplierBefore=50;first.frames[0].multiplierBefore=50;
  if(view.spin.index===first.index){view.spin.multiplierBefore=50;view.spin.frames[0].multiplierBefore=50;}
 }
 assert(!validCaramelSettlement('active',session.stakeUnits,session.spentUnits,'0',view));
 const before=await journal(account),balance=await demoBalanceUnits(db,account),calls=draws;
 await db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?').run(JSON.stringify(saved),account,session.id);
 try{await assert.rejects(operate(account,move(session)),/Фестиваль уже изменился/);assert.equal(draws,calls);assert.equal(await demoBalanceUnits(db,account),balance);assert.deepEqual(await journal(account),before);}
 finally{await db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?').run(original,account,session.id);}
}
async function finalLedger(account,session,spent,expected){
 assert.equal(session.state,'settled');valid(session);assert.equal(session.returnedUnits,String(expected));
 assert.equal(await demoBalanceUnits(db,account),expected);assert.equal(await demoReservedUnits(db,account),0);
 const entries=await db.prepare('SELECT entry_type,amount_units FROM demo_ledger WHERE account_id=? AND source=? ORDER BY id').all(account,game);
 assert.deepEqual(entries,[{entry_type:'bet',amount_units:-spent},{entry_type:'win',amount_units:expected}]);
}
async function startBonus(stake,mode,initial=tickets(4),refills=[]){
 const cost=mode==='festival'?35:1,spent=Number(stake)*cost,id=await account(spent/100),start=begin(stake,mode);
 if(mode==='normal')entropy(initial,refills,false);
 const result=await operate(id,start);assert.equal(pending.length,0);const session=result.session;valid(session);
 assert.equal(session.state,'active');assert.equal(session.spentUnits,String(spent));assert.equal(session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,id),0);
 return {id,start,spent,session};
}
async function free(id,session,initial=balanced(30),refills=[]){entropy(initial,refills);const op=move(session),result=await operate(id,op);assert.equal(pending.length,0);valid(result.session);return {session:result.session,op};}
try{
 await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');wallet=new DemoWalletStore(db,draw);await wallet.ready;
 for(const stake of CARAMEL_BETS)for(const mode of ['normal','festival']){
  let {id,start,spent,session}=await startBonus(stake,mode);
  assert.deepEqual(session.view.caramel.bonus,{awarded:10,played:0,remaining:10,multiplier:1});
  await replay(id,start,session);await tamperOrigin(id,session,'empty');
  const startCalls=draws;
  await assert.rejects(operate(id,{...start,stakeUnits:String(Number(stake)*2)}));
  await assert.rejects(operate(id,{...start,settings:{caramel:{mode:mode==='normal'?'festival':'normal'}}}));
  await assert.rejects(operate(id,{...start,id:randomUUID()}));assert.equal(draws,startCalls);
  let played=await free(id,session,energy,[balanced(30)]);session=played.session;
  assert.equal(session.view.caramel.spin.multiplierBefore,1);assert.equal(session.view.caramel.bonus.multiplier,50);
  const expected=Number(BigInt(stake)*375n*50n/100n);
  assert.equal(session.view.caramel.totalPayoutUnits,String(expected));assert.equal(session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,id),0);
  await replay(id,played.op,session);await tamperOrigin(id,session,'first');
  if(stake===CARAMEL_BETS[0]||stake===CARAMEL_BETS.at(-1))await reconnect(id,session,played.op);
  let last=played.op;
  while(session.state==='active'){
   const beforeCalls=draws,op=move(session);
   await assert.rejects(operate(id,{...op,stakeUnits:'100000'}));await assert.rejects(operate(id,{...op,settings:{caramel:{mode:'festival'}}}));assert.equal(draws,beforeCalls);
   played=await free(id,session);session=played.session;last=played.op;
   assert.equal(session.spentUnits,String(spent));assert.equal(session.view.caramel.spin.multiplierBefore,50);
   if(session.state==='active'){assert.equal(session.returnedUnits,'0');assert.equal(await demoBalanceUnits(db,id),0);}
  }
  assert.equal(session.view.caramel.bonus.played,10);await finalLedger(id,session,spent,expected);
  await replay(id,last,session);await replay(id,start,session);
  const calls=draws;await assert.rejects(operate(id,{...last,id:randomUUID()}),/уже завершена/);assert.equal(draws,calls);
  if(stake===CARAMEL_BETS[0]||stake===CARAMEL_BETS.at(-1))await reconnect(id,session,last);
  report.matrix.push({stakeUnits:stake,mode,costMultiplier:mode==='festival'?35:1,spentUnits:spent,returnedUnits:expected,freeSpins:10,zeroAvailableDuringBonus:true,oneDebitAndFinalCredit:true,ignoredCommittedStartFirstFinalReplayed:true,replayRngDraws:0,originTamperingRejected:['empty','first'],reconnected:stake===CARAMEL_BETS[0]||stake===CARAMEL_BETS.at(-1)});
  const short=await account(spent/100-1),shortOp=begin(stake,mode),before=await journal(short),shortCalls=draws;
  await assert.rejects(operate(short,shortOp),/Недостаточно.*начальных ставок/);
  assert.equal(draws,shortCalls);assert.equal(await demoBalanceUnits(db,short),spent-100);assert.deepEqual(await journal(short),before);assert.equal(await row(short,shortOp.id),undefined);
  report.insufficient.push({stakeUnits:stake,mode,availableUnits:spent-100,requiredUnits:spent,rejectedBeforeRng:true,noDebitOrSession:true});
 }
 console.log(JSON.stringify({matrixPassed:report.matrix.length,insufficientPassed:report.insufficient.length}));
 for(const mode of ['normal','festival']){
  let {id,spent,session}=await startBonus('100',mode),last;
  while(session.state==='active'){const next=await free(id,session,tickets(3));session=next.session;last=next.op;assert(session.view.caramel.bonus.awarded<=30);assert.equal(await demoBalanceUnits(db,id),0);}
  assert.equal(session.view.caramel.bonus.played,30);assert.equal(session.view.caramel.bonus.awarded,30);await finalLedger(id,session,spent,0);await replay(id,last,session);
  report.extra.push({case:'retrigger-limit',mode,stakeUnits:'100',awarded:30,played:30,oneDebitAndFinalCredit:true});
 }
 for(const stake of [CARAMEL_BETS[0],CARAMEL_BETS.at(-1)]){
  let {id,spent,session}=await startBonus(stake,'normal',baseEnergy,[balanced(26)]);
  const expected=Number(BigInt(stake)*375n*50n/100n);assert.equal(session.view.caramel.spin.multiplierAfter,50);assert.equal(session.view.caramel.bonus.multiplier,1);assert.equal(session.view.caramel.totalPayoutUnits,String(expected));
  let next=await free(id,session);session=next.session;assert.equal(session.view.caramel.spin.multiplierBefore,1);assert.equal(await demoBalanceUnits(db,id),0);
  while(session.state==='active'){next=await free(id,session);session=next.session;}
  await finalLedger(id,session,spent,expected);report.extra.push({case:'natural-base-energy-reset',stakeUnits:stake,baseMultiplier:50,freeOriginMultiplier:1,deferredBaseCredit:true});
 }
 for(const mode of ['normal','festival']){
  const stake=CARAMEL_BETS.at(-1);let {id,spent,session}=await startBonus(stake,mode),next=await free(id,session,energy,[balanced(30)]);session=next.session;
  next=await free(id,session,Array(30).fill(6),Array.from({length:20},()=>Array(30).fill(6)));session=next.session;
  assert.equal(session.view.caramel.spin.frames.length,20);assert.equal(session.state,'active');
  next=await free(id,session,Array(30).fill(6),Array.from({length:5},()=>Array(30).fill(6)));session=next.session;
  assert.equal(session.view.caramel.capped,true);assert.equal(session.view.caramel.bonus.played,3);
  await finalLedger(id,session,spent,Number(stake)*5000);await replay(id,next.op,session);
  report.extra.push({case:'full-round-cap',mode,stakeUnits:stake,freeSpins:3,cascadeLimit:20,returnedUnits:Number(stake)*5000,oneDebitAndFinalCredit:true});
 }
 {
  let {id,spent,session}=await startBonus('100','festival'),next=await free(id,session,energy,[balanced(30)]);session=next.session;
  while(session.view.caramel.bonus.remaining>1){next=await free(id,session);session=next.session;}
  const before=await journal(id),saved=(await row(id,session.id)).payload,final=move(session),reserved=await demoReservedUnits(db,id);
  await db.exec("CREATE FUNCTION reject_caramel_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'caramel receipt failure'; END $$; CREATE TRIGGER reject_caramel_receipt BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_caramel_receipt()");
  entropy(balanced(30));await assert.rejects(operate(id,final),/caramel receipt failure/);assert.equal(pending.length,0);
  assert.equal((await row(id,session.id)).payload,saved);assert.equal(await demoBalanceUnits(db,id),0);assert.equal(await demoReservedUnits(db,id),reserved);assert.deepEqual(await journal(id),before);
  await db.exec('DROP TRIGGER reject_caramel_receipt ON demo_casino_requests');
  entropy(balanced(30));session=(await operate(id,final)).session;assert.equal(pending.length,0);await finalLedger(id,session,spent,18750);await replay(id,final,session);
  report.extra.push({case:'final-transaction-rollback',noPartialCreditOrReceipt:true,retrySameUuid:true,oneDebitAndFinalCredit:true});
 }
 assert.deepEqual(hashes(),sourceHashes);assert.equal(report.matrix.length,26);assert.equal(report.insufficient.length,26);assert.equal(report.extra.length,7);report.passed=true;
}catch(error){report.failure=error.message;throw error;}
finally{writeFileSync(new URL('wallet-results.json',outputFolder),JSON.stringify(report,null,2)+'\n');await db.close();}
console.log(JSON.stringify({passed:true,matrix:report.matrix.length,insufficient:report.insufficient.length,extra:report.extra.length,output:fileURLToPath(new URL('wallet-results.json',outputFolder))}));
