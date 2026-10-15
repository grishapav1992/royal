import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { MAX_DEMO_UNITS, saveDemoUnits } from '../server/demoWalletAmounts';
import { advanceSession, publicSession, sessionPayout, sessionReservation, startSession, verifySessionTransition } from '../server/games/casinoSessions';
import { validCasinoAction, validCasinoSession, type CasinoAction, type TowerDifficulty } from '../src/shared/casinoSessions';
const start = (gameId: 'github-hilo'|'github-tower'='github-tower', stakeUnits='1000',difficulty:TowerDifficulty='easy'): Extract<CasinoAction,{action:'start'}> => ({id:randomUUID(),gameId,action:'start',stakeUnits,settings:gameId==='github-tower'?{difficulty}:{}});
const pick = (s:{id:string;gameId:'github-hilo'|'github-tower'},choice:number|'higher'|'lower'):Extract<CasinoAction,{action:'pick'}> => ({id:randomUUID(),gameId:s.gameId,action:'pick',sessionId:s.id,choice});
const cash = (s:{id:string;gameId:'github-hilo'|'github-tower'}):Extract<CasinoAction,{action:'cashout'}> => ({id:randomUUID(),gameId:s.gameId,action:'cashout',sessionId:s.id});
async function fixture(draw:(n:number)=>number=()=>0) {const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice'),('bob')");const wallet=new DemoWalletStore(db,draw);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1000});return {db,wallet};}
test('Tower exact payouts match independent inverse survival for all 27 levels; active states hide dragons',()=>{
  for(const [difficulty,n] of [['easy',4],['medium',3],['hard',2]] as const){let s=startSession(start('github-tower','1000000',difficulty),()=>0);assert(!('dragons' in publicSession(s)));
    for(let depth=1;depth<=9;depth++){const op=pick(s,1),next=advanceSession(s,op);assert(verifySessionTransition(s,op,next));s=next;const pay=1000000n*99n*BigInt(n)**BigInt(depth)/(100n*BigInt(n-1)**BigInt(depth));assert.equal(sessionPayout(s),pay);assert(validCasinoSession(publicSession(s)));assert(sessionPayout(s)<=1000000n*BigInt(Math.ceil(.99*(n/(n-1))**9)));}
    assert.equal(s.state,'cashed_out');assert.equal(sessionReservation(s),0n);assert.equal(publicSession(s).dragons!.length,9);
  }
});
test('Hi-Lo uses independent ranks, excludes ties, verifies all one-step odds and ends after two wins',()=>{
  for(let rank=1;rank<=13;rank++)for(const direction of ['higher','lower'] as const){const count=direction==='higher'?13-rank:rank-1;let draws=[rank-1,0,direction==='higher'?12:0,0,6,0];const s=startSession(start('github-hilo','1000000'),()=>draws.shift()!);assert.equal(publicSession(s).cards!.length,1);const op=pick(s,direction);
    if(!count){assert.throws(()=>advanceSession(s,op));assert.equal(publicSession(s).next![direction],null);continue;}
    const next=advanceSession(s,op);assert.equal(sessionPayout(next),1000000n*99n*13n/(100n*BigInt(count)));assert(Math.abs(count/13*publicSession(next).multiplier-.99)<1e-12);
    const tied=structuredClone(s);tied.cards[1].rank=rank;assert.equal(advanceSession(tied,op).state,'lost');assert.equal(sessionPayout(advanceSession(tied,op)),0n);
    assert(!verifySessionTransition(s,op,{...next,stakeUnits:'2000000'}));
  }
  let draws=[0,0,6,0,12,0],s=startSession(start('github-hilo'),()=>draws.shift()!);s=advanceSession(s,pick(s,'higher'));s=advanceSession(s,pick(s,'higher'));assert.equal(s.state,'cashed_out');assert.equal(publicSession(s).cards!.length,3);assert.throws(()=>advanceSession(s,pick(s,'lower')));
});
test('Demo parties survive reopening, isolate accounts, debit and pay once under concurrent retries',async()=>{
  const {db,wallet}=await fixture();try{
    const op=start(),first=await wallet.casino.operate('alice',op);assert.equal(first.wallet.balance,990);assert(!('dragons' in first.session));
    const reopened=new DemoWalletStore(db,()=>{throw Error('must not redraw');});assert.equal((await reopened.casino.active('alice')).sessions[0].id,op.id);
    const results=await Promise.all(Array.from({length:4},()=>reopened.casino.operate('alice',op)));assert(results.every(r=>r.wallet.balance===990));
    await assert.rejects(reopened.casino.operate('bob',pick(first.session,1)));await assert.rejects(reopened.casino.operate('alice',{...op,stakeUnits:'5000'}));await assert.rejects(reopened.casino.operate('alice',start()));
    const next=await reopened.casino.operate('alice',pick(first.session,1));assert.equal(next.session.payoutUnits,'1320');assert(!('dragons' in next.session));
    const payout=cash(first.session),paid=await reopened.casino.operate('alice',payout);assert.equal(paid.wallet.balance,1003.2);assert.equal(paid.session.state,'cashed_out');
    assert.equal((await reopened.casino.operate('alice',payout)).wallet.balance,1003.2);assert.equal((await reopened.casino.operate('alice',op)).session.state,'cashed_out');await assert.rejects(reopened.casino.operate('alice',cash(first.session)));
    assert.equal(await reopened.casino.reservedUnits('alice'),0);assert.equal((await reopened.casino.active('alice')).sessions.length,0);
    await assert.rejects(reopened.operate('alice',{id:op.id,kind:'deposit',amount:10}));await assert.rejects(reopened.mines.operate('alice',{id:op.id,action:'start',amount:10,mineCount:1}));
  }finally{await db.close();}
});
test('Demo zero loss, balance reservations and invalid caller fields are enforced before RNG',async()=>{
  let draws=0;const {db,wallet}=await fixture(()=>{draws++;return 0;});try{
    const op=start(),r=await wallet.casino.operate('alice',op);const loss=await wallet.casino.operate('alice',pick(r.session,0));assert.equal(loss.wallet.balance,990);assert.equal(loss.session.payoutUnits,'0');assert.equal(loss.session.dragons!.length,9);
    for(const bad of [{...start(),dragons:Array(9).fill(0)},{...start(),stakeUnits:'1'},{...pick(r.session,0),payoutUnits:'999999999'}])await assert.rejects(wallet.casino.operate('alice',bad));
    await saveDemoUnits(db,'alice',MAX_DEMO_UNITS-167000);const hilo=start('github-hilo');await wallet.casino.operate('alice',hilo);assert.equal(await wallet.casino.reservedUnits('alice'),168000);const before=draws;
    await assert.rejects(wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1}));await assert.rejects(wallet.casino.operate('alice',start()));assert.equal(draws,before);
    assert(!validCasinoAction({...start(),settings:{difficulty:'unknown'}}));
  }finally{await db.close();}
});
test('Failed demo persistence rolls back both debit and final payout, preserving the same pending operation',async()=>{
  const {db,wallet}=await fixture();try{
    await db.exec("CREATE FUNCTION reject_casino_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted'; END $$; CREATE TRIGGER reject_casino BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_casino_fn()");
    const op=start();await assert.rejects(wallet.casino.operate('alice',op),/interrupted/);assert.equal((await wallet.snapshot('alice')).balance,1000);assert.equal((await wallet.casino.active('alice')).sessions.length,0);
    await db.exec('DROP TRIGGER reject_casino ON demo_casino_requests');await wallet.casino.operate('alice',op);await wallet.casino.operate('alice',pick(op,1));
    await db.exec('CREATE TRIGGER reject_casino BEFORE INSERT ON demo_casino_requests FOR EACH ROW EXECUTE FUNCTION reject_casino_fn()');const payout=cash(op);await assert.rejects(wallet.casino.operate('alice',payout),/interrupted/);assert.equal((await wallet.snapshot('alice')).balance,990);assert.equal((await wallet.casino.active('alice')).sessions[0].state,'active');
    await db.exec('DROP TRIGGER reject_casino ON demo_casino_requests');assert.equal((await wallet.casino.operate('alice',payout)).wallet.balance,1003.2);
  }finally{await db.close();}
});
