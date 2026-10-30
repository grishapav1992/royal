import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { MAX_DEMO_UNITS, demoBalanceUnits, recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';
import { advanceSession, publicSession, sessionPayout, sessionReservation, startSession, verifySessionTransition } from '../server/games/casinoSessions';
import { isLegacyTowerState, legacyCasinoPayout, legacyCasinoReservation, validLegacyCasinoState, verifyLegacyCasinoRetirement, verifyLegacyCasinoTransition, type LegacyCasinoState, type LegacyTowerState } from '../server/games/legacyCasinoSessions';
import { casinoActionKey, isSessionGame, validCasinoAction, validCasinoSession, type CasinoAction } from '../src/shared/casinoSessions';

const start = (stakeUnits='1000'): Extract<CasinoAction,{action:'start'}> => ({id:randomUUID(),gameId:'github-hilo',action:'start',stakeUnits,settings:{}});
const pick = (s:{id:string},choice:'higher'|'lower'):Extract<CasinoAction,{action:'pick'}> => ({id:randomUUID(),gameId:'github-hilo',action:'pick',sessionId:s.id,choice});
const cash = (s:{id:string}):Extract<CasinoAction,{action:'cashout'}> => ({id:randomUUID(),gameId:'github-hilo',action:'cashout',sessionId:s.id});
async function fixture() {
  const db=new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");
  const wallet=new DemoWalletStore(db,()=>{throw Error('Saved rounds must not redraw future cards');});
  await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1000});
  return {db,wallet};
}
// Hi-Lo is retired. Seed a previously accepted round instead of reopening new wagers in tests.
async function acceptedRound(db:PostgresDatabase,wallet:DemoWalletStore,op=start(),cards=[0,0,6,0,12,0]) {
  const draws=[...cards],state={...startSession(op,()=>draws.shift()!),dragons:[]};
  await db.transaction(async()=>{
    const balance=await demoBalanceUnits(db,'alice')-Number(op.stakeUnits);
    await db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run('alice',state.id,state.gameId,state.state,JSON.stringify(state),Number(sessionReservation(state)));
    await recordDemoUnits(db,'alice',op.id,'bet',-Number(op.stakeUnits),balance,op.gameId,'Hi-Lo');
    await saveDemoUnits(db,'alice',balance);
    await db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run('alice',op.id,casinoActionKey(op),state.id,Date.now());
  },{lockKey:'account:alice'});
  return {op,state,session:publicSession(state),wallet:await wallet.snapshot('alice')};
}

test('Live session contract and engine reject every removed game operation before randomness',()=>{
  const op=start(),tower={...op,gameId:'github-tower',settings:{difficulty:'easy'}};
  assert(!isSessionGame('github-tower'));
  for(const value of [tower,{id:randomUUID(),gameId:'github-tower',action:'pick',sessionId:op.id,choice:1},{id:randomUUID(),gameId:'github-tower',action:'cashout',sessionId:op.id}])assert(!validCasinoAction(value));
  assert.throws(()=>startSession(tower as unknown as Extract<CasinoAction,{action:'start'}>,()=>{throw Error('Randomness must not be called');}),/Invalid casino action/);
  assert(!validCasinoAction({...op,settings:{difficulty:'easy'}}));
  assert(!validCasinoAction({...pick(op,'higher'),choice:1}));
  const session=publicSession(startSession(op,()=>0));
  assert(validCasinoSession(session));
  assert(!validCasinoSession({...session,dragons:[]}));
  assert(!validCasinoSession({...session,gameId:'github-tower'}));
});

test('Hi-Lo keeps exact original odds, one house edge, ties and complete transition verification',()=>{
  for(let rank=1;rank<=13;rank++)for(const direction of ['higher','lower'] as const){
    const count=direction==='higher'?13-rank:rank-1,draws=[rank-1,0,direction==='higher'?12:0,0,6,0],op=start('1000000'),s=startSession(op,()=>draws.shift()!);
    assert(verifySessionTransition(undefined,op,s));assert.equal(publicSession(s).cards!.length,1);
    const action=pick(s,direction);
    if(!count){assert.throws(()=>advanceSession(s,action));assert.equal(publicSession(s).next![direction],null);continue;}
    const next=advanceSession(s,action);assert(verifySessionTransition(s,action,next));assert.equal(sessionPayout(next),1000000n*99n*13n/(100n*BigInt(count)));
    assert(Math.abs(count/13*publicSession(next).multiplier-.99)<1e-12);
    const tied=structuredClone(s);tied.cards[1].rank=rank;assert.equal(advanceSession(tied,action).state,'lost');assert.equal(sessionPayout(advanceSession(tied,action)),0n);
    assert(!verifySessionTransition(s,action,{...next,stakeUnits:'2000000'}));
  }
  const draws=[0,0,6,0,12,0];let s=startSession(start(),()=>draws.shift()!);
  s=advanceSession(s,pick(s,'higher'));s=advanceSession(s,pick(s,'higher'));
  assert.equal(s.state,'cashed_out');assert.equal(publicSession(s).cards!.length,3);assert.throws(()=>advanceSession(s,pick(s,'lower')));
});

test('Historical Tower replay retains original exact money but cannot create a live action',()=>{
  for(const [difficulty,width] of [['easy',4],['medium',3],['hard',2]] as const){
    let state:LegacyTowerState={id:randomUUID(),gameId:'github-tower',rulesVersion:1,state:'active',stakeUnits:'1000000',settings:{difficulty},choices:[],cards:[],dragons:Array(9).fill(0)};
    const opening={id:state.id,gameId:state.gameId,action:'start',stakeUnits:state.stakeUnits,settings:state.settings};
    assert(verifyLegacyCasinoTransition(undefined,opening,state));assert(!validCasinoAction(opening));
    assert(isLegacyTowerState(state));assert.equal(legacyCasinoPayout(state),1000000n);
    for(let step=1;step<=9;step++){
      const before=structuredClone(state),choice={id:randomUUID(),gameId:state.gameId,action:'pick',sessionId:state.id,choice:1};
      state={...state,choices:[...state.choices,1],state:step===9?'cashed_out':'active'};
      assert(verifyLegacyCasinoTransition(before,choice,state));
      assert.equal(legacyCasinoPayout(state),1000000n*99n*BigInt(width)**BigInt(step)/(100n*BigInt(width-1)**BigInt(step)));
      if(state.state==='active')assert(legacyCasinoReservation(state)>=legacyCasinoPayout(state));
    }
    assert.equal(legacyCasinoReservation(state),0n);
  }
});

test('Historical Hi-Lo accepts old empty dragon fields and new snapshots without rewriting history',()=>{
  const draws=[0,0,6,0,12,0],op=start(),current=startSession(op,()=>draws.shift()!),old={...current,dragons:[]};
  assert(validLegacyCasinoState(old));assert(verifyLegacyCasinoTransition(undefined,op,old));assert(verifyLegacyCasinoTransition(undefined,op,current));
  const action=pick(current,'higher'),next=advanceSession(old,action);
  assert(verifyLegacyCasinoTransition(old,action,next));assert.equal(legacyCasinoPayout(next),sessionPayout(next));
  assert(!validLegacyCasinoState({...old,dragons:[0]}));assert(!verifyLegacyCasinoTransition(old,action,{...next,stakeUnits:'5000'}));
});

test('Internal retirement returns untouched stakes, retains existing cashout and rejects historical zero-step cashout',()=>{
  const before:LegacyTowerState={id:randomUUID(),gameId:'github-tower',rulesVersion:1,state:'active',stakeUnits:'1000',settings:{difficulty:'easy'},choices:[],cards:[],dragons:Array(9).fill(0)};
  const retired:LegacyTowerState={...before,state:'cashed_out'};
  assert(validLegacyCasinoState(retired));assert(verifyLegacyCasinoRetirement(before,retired));assert.equal(legacyCasinoPayout(retired),1000n);assert.equal(legacyCasinoReservation(retired),0n);
  assert(!verifyLegacyCasinoTransition(before,{id:randomUUID(),gameId:before.gameId,action:'cashout',sessionId:before.id},retired));
  const progressed:LegacyTowerState={...before,choices:[1]},paid:LegacyTowerState={...progressed,state:'cashed_out'};
  assert(verifyLegacyCasinoRetirement(progressed,paid));assert.equal(legacyCasinoPayout(paid),1320n);
  assert(!verifyLegacyCasinoRetirement(progressed,{...paid,stakeUnits:'5000'}));assert(!verifyLegacyCasinoRetirement(paid,paid));
});

test('Previously accepted Hi-Lo survives reopening, isolates accounts and settles once under concurrent retries',async()=>{
  const {db,wallet}=await fixture();try{
    await assert.rejects(wallet.casino.operate('alice',start()),/удалена/);
    const first=await acceptedRound(db,wallet);assert.equal(first.wallet.balance,990);
    const reopened=new DemoWalletStore(db,()=>{throw Error('must not redraw');});assert.equal((await reopened.casino.active('alice')).sessions[0].id,first.op.id);
    const results=await Promise.all(Array.from({length:4},()=>reopened.casino.operate('alice',first.op)));assert(results.every(r=>r.wallet.balance===990));
    await assert.rejects(reopened.casino.operate('bob',pick(first.session,'higher')));await assert.rejects(reopened.casino.operate('alice',{...first.op,stakeUnits:'5000'}));
    const next=await reopened.casino.operate('alice',pick(first.session,'higher'));assert.equal(next.session.payoutUnits,'1072');
    const payout=cash(first.session),replies=await Promise.all(Array.from({length:4},()=>reopened.casino.operate('alice',payout)));
    assert(replies.every(r=>r.wallet.balance===1000.72));assert.equal(replies[0].session.state,'cashed_out');
    assert.equal((await reopened.casino.operate('alice',first.op)).session.state,'cashed_out');await assert.rejects(reopened.casino.operate('alice',cash(first.session)));
    assert.equal(await reopened.casino.reservedUnits('alice'),0);assert.equal((await reopened.casino.active('alice')).sessions.length,0);
    await assert.rejects(reopened.operate('alice',{id:first.op.id,kind:'deposit',amount:10}));await assert.rejects(reopened.mines.operate('alice',{id:first.op.id,action:'start',amount:10,mineCount:1}));
  }finally{await db.close();}
});

test('Saved Hi-Lo losses, capacity reservations and invalid caller fields remain enforced',async()=>{
  const {db,wallet}=await fixture();try{
    const first=await acceptedRound(db,wallet,start(),[0,0,0,0,0,0]);
    const loss=await wallet.casino.operate('alice',pick(first.session,'higher'));assert.equal(loss.wallet.balance,990);assert.equal(loss.session.payoutUnits,'0');
    for(const bad of [{...start(),dragons:Array(9).fill(0)},{...start(),stakeUnits:'1'},{...pick(first.session,'higher'),payoutUnits:'999999999'}])await assert.rejects(wallet.casino.operate('alice',bad));
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-167000);await acceptedRound(db,wallet);assert.equal(await wallet.casino.reservedUnits('alice'),168000);
    await assert.rejects(wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1}));
  }finally{await db.close();}
});

test('Failed continuation and final-credit persistence rolls back state, receipt and money together',async()=>{
  const {db,wallet}=await fixture();try{
    const first=await acceptedRound(db,wallet),action=pick(first.session,'higher');
    await db.exec("CREATE FUNCTION reject_casino_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted'; END $$; CREATE TRIGGER reject_casino BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_casino_fn()");
    await assert.rejects(wallet.casino.operate('alice',action),/interrupted/);assert.equal((await wallet.snapshot('alice')).balance,990);assert.equal((await wallet.casino.active('alice')).sessions[0].steps,0);
    await db.exec('DROP TRIGGER reject_casino ON demo_casino_requests');await wallet.casino.operate('alice',action);
    await db.exec('CREATE TRIGGER reject_casino BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_casino_fn()');const payout=cash(first.session);
    await assert.rejects(wallet.casino.operate('alice',payout),/interrupted/);assert.equal((await wallet.snapshot('alice')).balance,990);assert.equal((await wallet.casino.active('alice')).sessions[0].state,'active');
    await db.exec('DROP TRIGGER reject_casino ON demo_casino_requests');assert.equal((await wallet.casino.operate('alice',payout)).wallet.balance,1000.72);
  }finally{await db.close();}
});
