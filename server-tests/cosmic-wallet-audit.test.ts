import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits} from '../server/demoWalletAmounts';
import {COSMIC_ESCAPE_BET_UNITS} from '../src/shared/cosmicEscapeBets';
import {seededRandom} from '../src/shared/draconaMath';
import {validLuelonSlotSettlement,validLuelonSlotEnvelope,type LuelonSlotView} from '../src/shared/luelonSlots';

const GAME='studio-cosmic-escape' as const;
const MODES={normal:1,'cosmic-chaos':40,'ufo-invasion':75,'deep-echo':135} as const;
const validLuelonSlotSession=(s:any)=>s.gameId===GAME&&s.rulesVersion===2&&validLuelonSlotSettlement(GAME,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.luelon)&&validLuelonSlotEnvelope(GAME,s.state,s.view);
type Mode=keyof typeof MODES;
type Draw=(max:number)=>number;
const start=(mode:Mode,stake='20')=>({id:randomUUID(),action:'start' as const,gameId:GAME,stakeUnits:stake,settings:{luelon:{mode}}});
const move=(id:string,revision:number)=>({id:randomUUID(),action:'move' as const,gameId:GAME,sessionId:id,move:'luelon-spin',revision});
const seeded=(seed:number):Draw=>{const random=seededRandom(seed);return max=>Math.floor(random()*max);};
function sequence(values:[number,number][],fallback:Draw=seeded(1)) {
 let index=0;
 return {draw:(max:number)=>{if(index===values.length)return fallback(max);const [expected,value]=values[index++];assert.equal(max,expected,'Unexpected entropy domain');assert(value>=0&&value<max);return value;},used:()=>index,total:values.length};
}
const repeat=(max:number,n:number,value:number):[number,number][]=>Array.from({length:n},()=>[max,value]);
function natural(portals:3|4|5) {
 return sequence([...Array.from({length:15},(_,i)=>[7,i%7] as [number,number]),...repeat(1000,15,999),[1000000,0],[100,portals===3?75:portals===4?10:0],...Array.from({length:portals},(_,i)=>[[5-i,0],[3,0]] as [number,number][]).flat()]);
}
function echoCap() {
 return sequence([...Array.from({length:15},(_,i)=>[7,i%7] as [number,number]),...repeat(1000,15,999),...repeat(1000,5,999),[100,0],[1000,999],[1000,999],[100,0],...repeat(7,15,0),...repeat(1000,15,0),...repeat(1000,5,999),[1000,999]],()=>{throw Error('Unexpected draw after capped echo');});
}
async function fixture(draw:Draw=seeded(1)) {
 const db=new PostgresDatabase(':memory:');
 await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('cosmic-player'),('other-player')");
 const wallet=new DemoWalletStore(db,draw);await wallet.ready;
 return {db,wallet,close:()=>db.close()};
}
async function fund(wallet:DemoWalletStore,account:string,units:number) {
 let coins=Math.ceil(units/100)+1;
 while(coins>0){const amount=Math.min(coins,100000);await wallet.operate(account,{id:randomUUID(),kind:'deposit',amount});coins-=amount;}
}
async function finish(wallet:DemoWalletStore,session:any,account='cosmic-player') {
 let last:any;
 while(session.state==='active') {
  assert.equal(session.view.actions[0].cost,0);
  last=move(session.id,session.view.luelon.revision);
  session=(await wallet.expansion.operate(account,last)).session;
 }
 return {session,last};
}

test('Cosmic wallet charges each of 26 stakes at all four actual mode costs and reserves the whole paid round',async()=>{
 const f=await fixture(()=>0);let cases=0;
 try {
  assert.equal(COSMIC_ESCAPE_BET_UNITS.length,26);
  for(const [mode,cost] of Object.entries(MODES))for(const stake of COSMIC_ESCAPE_BET_UNITS) {
   const account='grid-'+cases++,paid=Number(stake)*cost;
   await f.db.prepare('INSERT INTO accounts(id) VALUES(?)').run(account);await fund(f.wallet,account,paid);
   const before=await demoBalanceUnits(f.db,account),op=start(mode as Mode,stake),reply=await f.wallet.expansion.operate(account,op);
   assert(validLuelonSlotSession(reply.session));assert.equal(reply.session.state,'active');
   assert.equal(reply.session.stakeUnits,stake);assert.equal(reply.session.spentUnits,String(paid));assert.equal(reply.session.returnedUnits,'0');
   assert.equal(await demoBalanceUnits(f.db,account),before-paid);
   assert.equal(await demoReservedUnits(f.db,account),Number(stake)*10000);
   const rows=await f.db.prepare("SELECT entry_type,amount_units FROM demo_ledger WHERE account_id=? AND source=?").all(account,GAME);
   assert.deepEqual(rows,[{entry_type:'bet',amount_units:-paid}]);
   const saved=await f.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(account,op.id);
   assert.equal(JSON.parse(saved!.payload).mathProfileVersion,3);
  }
  assert.equal(cases,104);
 }finally{await f.close();}
});

test('Cosmic natural three, four and five portals debit one base stake and settle all 10, 12 and 15 free spins once',async()=>{
 for(const [portals,freeSpins] of [[3,10],[4,12],[5,15]] as const) {
  const entropy=natural(portals),f=await fixture(entropy.draw);
  try {
   await f.wallet.operate('cosmic-player',{id:randomUUID(),kind:'deposit',amount:10});
   const before=await demoBalanceUnits(f.db,'cosmic-player'),op=start('normal','1000');assert.equal(before,1000);
   const begun=await f.wallet.expansion.operate('cosmic-player',op),v=begun.session.view.luelon!;
   assert.equal(entropy.used(),entropy.total);assert.equal(v.history[0].initialGrid.filter(s=>s===8).length,portals);
   assert.equal(v.bonus!.remaining,freeSpins);assert.equal(v.history[0].triggerAwards,freeSpins);
   assert.equal(begun.session.spentUnits,'1000');assert.equal(begun.session.returnedUnits,'0');
   let session=begun.session,last:any;
   while(session.state==='active') {
    assert.equal(await demoBalanceUnits(f.db,'cosmic-player'),before-1000);
    last=move(session.id,session.view.luelon!.revision);
    const replies=await Promise.all([f.wallet.expansion.operate('cosmic-player',last),f.wallet.expansion.operate('cosmic-player',last)]);
    assert(replies.some(r=>r.replayed));assert.deepEqual(replies[0].session,replies[1].session);session=replies[0].session;
   }
   assert.equal(session.view.luelon!.history.length,1+freeSpins);assert.equal(session.view.luelon!.bonus!.played,freeSpins);
   assert.equal(session.spentUnits,'1000');assert.equal(await demoBalanceUnits(f.db,'cosmic-player'),before-1000+Number(session.returnedUnits));
   assert.equal(await demoReservedUnits(f.db,'cosmic-player'),0);
   await assert.rejects(f.wallet.expansion.operate('cosmic-player',{...last,id:randomUUID()}));
   assert((await f.wallet.expansion.operate('cosmic-player',last)).replayed);
  }finally{await f.close();}
 }
});

test('Cosmic capped second echo frame pays exactly 10000 base stakes at the minimum and maximum stake',async()=>{
 for(const stake of ['20','200000']) {
  const entropy=echoCap(),f=await fixture(entropy.draw);
  try {
   const paid=Number(stake)*135;await fund(f.wallet,'cosmic-player',paid);
   const before=await demoBalanceUnits(f.db,'cosmic-player'),op=start('deep-echo',stake),begun=await f.wallet.expansion.operate('cosmic-player',op);
   assert.equal(entropy.used(),0);assert.equal(begun.session.view.luelon!.history.length,0);
   const step=move(op.id,0),attempts=[step,{...step,id:randomUUID()}];
   const replies=await Promise.allSettled(attempts.map(action=>f.wallet.expansion.operate('cosmic-player',action)));
   assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);assert.equal(replies.filter(r=>r.status==='rejected').length,1);
   const winner=replies.findIndex(r=>r.status==='fulfilled'),result=replies[winner];assert.equal(result.status,'fulfilled');
   const session=result.value.session,v=session.view.luelon!;
   assert(validLuelonSlotSession(session));assert.equal(session.state,'settled');assert.equal(v.spin!.frames.length,2);
   assert.equal(v.spin!.frames[0].payoutUnits,'0');assert(v.spin!.frames[1].events.some(e=>e.kind==='echo'));
   assert.equal(v.capped,true);assert.equal(v.bonus!.remaining,0);assert.equal(session.returnedUnits,String(BigInt(stake)*10000n));
   assert(BigInt(v.spin!.uncappedPayoutUnits)>BigInt(session.returnedUnits));
   assert.equal(await demoBalanceUnits(f.db,'cosmic-player'),before-paid+Number(session.returnedUnits));
   assert.equal(await demoReservedUnits(f.db,'cosmic-player'),0);assert.equal(entropy.used(),entropy.total);
   const wins=await f.db.prepare("SELECT count(*) AS n,sum(amount_units) AS paid FROM demo_ledger WHERE account_id=? AND source=? AND entry_type='win'").get('cosmic-player',GAME);
   assert.equal(wins!.n,1);assert.equal(String(wins!.paid),session.returnedUnits);
   const reloaded=new DemoWalletStore(f.db,()=>{throw Error('A settled replay must never draw');});
   assert((await reloaded.expansion.operate('cosmic-player',attempts[winner])).replayed);
   assert.equal(await demoBalanceUnits(f.db,'cosmic-player'),before-paid+Number(session.returnedUnits));
  }finally{await f.close();}
 }
});

test('Cosmic final-credit failure rolls back the bonus revision, receipt and money, then concurrent retry credits once',async()=>{
 let entropy=echoCap();const f=await fixture(max=>entropy.draw(max));
 try {
  await fund(f.wallet,'cosmic-player',2700);const op=start('deep-echo'),begun=await f.wallet.expansion.operate('cosmic-player',op),balance=await demoBalanceUnits(f.db,'cosmic-player');
  await f.db.exec("CREATE FUNCTION cosmic_reject_win() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='win' THEN RAISE EXCEPTION 'injected cosmic settlement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER cosmic_reject_win BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION cosmic_reject_win()");
  const step=move(op.id,0);await assert.rejects(f.wallet.expansion.operate('cosmic-player',step),/injected cosmic settlement failure/);
  assert.equal(await demoBalanceUnits(f.db,'cosmic-player'),balance);
  assert.equal(await f.db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get('cosmic-player',step.id),undefined);
  assert.deepEqual((await f.wallet.expansion.active('cosmic-player')).sessions.find(s=>s.id===op.id),begun.session);
  assert.equal(await demoReservedUnits(f.db,'cosmic-player'),200000);
  await f.db.exec('DROP TRIGGER cosmic_reject_win ON demo_ledger');entropy=echoCap();
  const replies=await Promise.all([f.wallet.expansion.operate('cosmic-player',step),f.wallet.expansion.operate('cosmic-player',step)]);
  assert(replies.some(r=>r.replayed));assert.equal(replies[0].session.returnedUnits,'200000');
  assert.equal(await demoBalanceUnits(f.db,'cosmic-player'),balance+200000);
  assert.equal(await demoReservedUnits(f.db,'cosmic-player'),0);
 }finally{await f.close();}
});

test('Cosmic accepted profile 2 and absent legacy profile recover after closing PostgreSQL connections without repricing the bonus',async()=>{
 for(const profile of [2,undefined]) {
  const entropy=natural(4),f=await fixture(entropy.draw);let db=f.db;
  try {
   await fund(f.wallet,'cosmic-player',1000);const op=start('normal','1000'),begun=await f.wallet.expansion.operate('cosmic-player',op);
   const row=await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get('cosmic-player',op.id),saved=JSON.parse(row!.payload);
   // Construct a historical accepted snapshot. This base sample triggers under both entry profiles.
   if(profile===undefined)delete saved.mathProfileVersion;else saved.mathProfileVersion=profile;
   await db.prepare('UPDATE demo_casino_sessions SET payload=? WHERE account_id=? AND id=?').run(JSON.stringify(saved),'cosmic-player',op.id);
   const schema=db.schema,before=await demoBalanceUnits(db,'cosmic-player');await db.close();db=new PostgresDatabase(schema,{existingSchema:true});
   let draws=0;const draw=seeded(1),wallet=new DemoWalletStore(db,max=>{draws++;return draw(max);});
   const restored=(await wallet.expansion.active('cosmic-player')).sessions.find(s=>s.id===op.id)!;
   assert.deepEqual(restored,begun.session);assert.equal(draws,0);
   assert((await wallet.expansion.operate('cosmic-player',op)).replayed);assert.equal(draws,0);
   await assert.rejects(wallet.expansion.operate('cosmic-player',{...op,stakeUnits:'2000'}));
   await assert.rejects(wallet.expansion.operate('cosmic-player',{...op,settings:{luelon:{mode:'deep-echo'}}}));
   const {session,last}=await finish(wallet,restored);
   assert.equal(session.spentUnits,'1000');assert.equal(session.view.luelon!.bonus!.played,12);
   assert.equal(await demoBalanceUnits(db,'cosmic-player'),before+Number(session.returnedUnits));
   assert((await wallet.expansion.operate('cosmic-player',last)).replayed);
   const after=await db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get('cosmic-player',op.id);
   assert.equal(JSON.parse(after!.payload).mathProfileVersion,profile);
  }finally{await db.close();}
 }
});

process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installDemoWallet}=await import('../server/demoWalletRoutes');
test.after(async()=>{await accounts.close();});

test('Cosmic real demo-wallet HTTP route enforces authentication, new-start rules and bonus state ownership across all modes',{timeout:45000},async()=>{
 const app=express();installDemoWallet(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/demo-wallet/expansion`;
 try {
  assert.equal((await fetch(url)).status,401);
  const other=await accounts.login('cosmic-other-'+randomUUID()+'@example.test','Cosmic-other-42!');
  const otherHeaders={'Cookie':'royal_session='+other.token,'X-Royal-Account-Id':other.account.id,'Content-Type':'application/json','X-Royal-Card-Rules':'2'};
  for(const mode of Object.keys(MODES) as Mode[]) {
   const login=await accounts.login('cosmic-audit-'+randomUUID()+'@example.test','Cosmic-audit-42!');
   await accounts.wallet.operate(login.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
   const base={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':login.account.id,'Content-Type':'application/json','X-Royal-Card-Rules':'2'};
   const random=seeded(mode==='normal'?75:1);let draws=0;Reflect.set(accounts.wallet.expansion,'draw',(max:number)=>{draws++;return random(max);});
   const post=(op:unknown,headers:Record<string,string>={})=>fetch(url,{method:'POST',headers:{...base,...headers},body:JSON.stringify(op)});
   const op=start(mode),before=await accounts.wallet.snapshot(login.account.id);
   assert.equal((await post(op,{'X-Royal-Account-Id':randomUUID()})).status,401);
   assert.equal((await post(op,{'X-Royal-Card-Rules':'1'})).status,409);assert.equal(draws,0);
   assert.deepEqual(await accounts.wallet.snapshot(login.account.id),before);
   const first=await post(op);assert.equal(first.status,200);let reply:any=await first.json();assert.equal(reply.session.state,'active');assert(validLuelonSlotSession(reply.session));
   assert.equal(reply.session.spentUnits,String(20*MODES[mode]));const held=reply.wallet.balance;
   const beforeOther=draws,foreignMove=move(op.id,reply.session.view.luelon.revision);
   assert.equal((await fetch(url,{method:'POST',headers:otherHeaders,body:JSON.stringify(foreignMove)})).status,404);assert.equal(draws,beforeOther);
   const oldHeaderReplay=await post(op,{'X-Royal-Card-Rules':'1'});assert.equal(oldHeaderReplay.status,200);assert.equal((await oldHeaderReplay.json()).replayed,true);
   assert.equal((await post({...op,stakeUnits:'40'})).status,409);
   assert.equal((await post({...op,settings:{luelon:{mode:mode==='normal'?'deep-echo':'normal'}}})).status,409);
   assert.equal((await post({...op,id:randomUUID()})).status,409);
   let last:any;
   while(reply.session.state==='active') {
    const view=reply.session.view.luelon as LuelonSlotView;last=move(op.id,view.revision);
    assert.equal((await post({...last,stakeUnits:'200000'})).status,400);
    assert.equal((await post({...last,state:'settled',returnedUnits:'999999999'})).status,400);
    const pair=await Promise.all([post(last,{'X-Royal-Card-Rules':view.revision%2?'1':'2'}),post(last)]);assert(pair.every(r=>r.status===200));
    const values=await Promise.all(pair.map(r=>r.json()));assert(values.some(v=>v.replayed));assert.deepEqual(values[0].session,values[1].session);reply=values[0];
    if(reply.session.state==='active') {
     assert.equal(reply.wallet.balance,held);const after:number=draws;
     assert.equal((await post({...last,id:randomUUID()})).status,409);assert.equal(draws,after);
    }
   }
   assert.equal(reply.wallet.balance,held+Number(reply.session.returnedUnits)/100);
   const final=await accounts.wallet.snapshot(login.account.id);
   assert.equal((await post({...last,id:randomUUID()})).status,409);
   const repeated=await post(last,{'X-Royal-Card-Rules':'1'});assert.equal(repeated.status,200);assert.equal((await repeated.json()).replayed,true);
   assert.deepEqual(await accounts.wallet.snapshot(login.account.id),final);
  }
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
