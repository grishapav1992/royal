import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PostgresDatabase} from '../../server/database';
import {DemoWalletStore} from '../../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits,saveDemoUnits,MAX_DEMO_UNITS} from '../../server/demoWalletAmounts';
import {WILD_NUDGE_GAME,validWildNudgeSession,WILD_NUDGE_RESERVE_MULTIPLIER} from '../../src/shared/wildNudge';
import {WILD_NUDGE_STAKES} from '../../src/shared/wildNudgeMath';

export const NUDGE_WALLET_CASES=['capability-before-entropy','concurrent-paid-start','request-identity-and-ownership','saved-round-and-hidden-future','free-continuation-and-stale-revision','eight-free-spins-one-credit','lost-final-response','all-stakes-integer-journal','atomic-rollback-and-retry','invalid-input-before-entropy','reserve-before-randomness','common-wallet-regression'];
export async function qualifyWildNudgeWallet(){
  const db=new PostgresDatabase(':memory:'),a=randomUUID(),b=randomUUID(),cases:string[]=[];
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');for(const id of [a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
  let calls=0,program:number[]=[],wallet:DemoWalletStore;
  const draw=(max:number)=>{calls++;const ticket=program.length?program.shift()!:30;assert(ticket>=0&&ticket<max);return ticket;};
  const reset=(tickets:number[])=>{program=tickets.slice();};
  const start=(stakeUnits='100')=>({id:randomUUID(),action:'start' as const,gameId:WILD_NUDGE_GAME,stakeUnits,settings:{wildNudge:{mode:'normal' as const}}});
  const move=(session:any)=>({id:randomUUID(),action:'move' as const,gameId:WILD_NUDGE_GAME,sessionId:session.id,move:'wild-nudge-spin',revision:session.view.wildNudge.revision});
  const act=(id:string,op:unknown,cap=true)=>wallet.expansion.operate(id,op,2,true,true,true,true,true,true,true,true,2,4,true,true,2,2,2,cap);
  const active=(cap=true)=>wallet.expansion.active(a,true,true,true,true,true,true,true,2,4,true,true,2,2,2,cap);
  const receipts=async(id:string)=>{const rows=await db.prepare('SELECT entry_type,amount_units FROM demo_ledger WHERE account_id=? AND source=? AND operation_id IN (SELECT id FROM demo_casino_requests WHERE account_id=? AND session_id=?)').all(a,WILD_NUDGE_GAME,a,id);return {bets:rows.filter(r=>r.entry_type==='bet').length,wins:rows.filter(r=>r.entry_type==='win').length};};
  try{
    wallet=new DemoWalletStore(db,draw);await wallet.ready;await wallet.operate(a,{id:randomUUID(),kind:'deposit',amount:10000});await wallet.operate(b,{id:randomUUID(),kind:'deposit',amount:100});
    const before=await demoBalanceUnits(db,a),op=start();reset([16,16,16,30,30]);
    await assert.rejects(act(a,op,false),/Обнови/);assert.equal(calls,0);assert.equal(await demoBalanceUnits(db,a),before);cases.push('capability-before-entropy');
    const replies=await Promise.all(Array.from({length:5},()=>act(a,op)));let session=replies[0].session;
    assert(replies.every(r=>validWildNudgeSession(r.session)));assert.equal(replies.filter(r=>!r.replayed).length,1);assert.equal(calls,5);assert.equal(await demoBalanceUnits(db,a),before-100);assert.deepEqual(await receipts(op.id),{bets:1,wins:0});cases.push('concurrent-paid-start');
    await assert.rejects(act(a,{...op,stakeUnits:'200'}));await assert.rejects(act(b,move(session)));assert.equal(calls,5);cases.push('request-identity-and-ownership');
    assert.equal(session.view.wildNudge!.spins.length,1);assert.equal(session.view.wildNudge!.remaining,8);assert(!('engine' in session));assert.equal((await active(false)).sessions.some(s=>s.gameId===WILD_NUDGE_GAME),false);
    wallet=new DemoWalletStore(db,draw);await wallet.ready;session=(await active()).sessions.find(s=>s.id===op.id)!;assert(validWildNudgeSession(session));assert.equal(calls,5);assert.equal(await demoReservedUnits(db,a),100*WILD_NUDGE_RESERVE_MULTIPLIER);cases.push('saved-round-and-hidden-future');
    await assert.rejects(act(a,{...move(session),revision:2}));await assert.rejects(act(a,start()));const next=move(session),continued=await Promise.allSettled([act(a,next),act(a,{...next,id:randomUUID()})]);assert.equal(continued.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,10);session=(await active()).sessions.find(s=>s.id===op.id)!;cases.push('free-continuation-and-stale-revision');
    let final:any;while(session.state==='active'){final=move(session);session=(await act(a,final)).session;if(session.state==='active')assert.equal(await demoBalanceUnits(db,a),before-100);}
    assert(validWildNudgeSession(session));assert.equal(session.view.wildNudge!.spins.length,9);assert.equal(calls,45);assert.equal(await demoBalanceUnits(db,a),before-100+Number(session.returnedUnits));assert.equal(await demoReservedUnits(db,a),0);assert.deepEqual(await receipts(op.id),{bets:1,wins:1});cases.push('eight-free-spins-one-credit');
    const drawCount=calls;assert((await act(a,final)).replayed);assert.equal(calls,drawCount);await assert.rejects(act(a,{...final,id:randomUUID()}));cases.push('lost-final-response');
    const stakeRows=[];
    for(const stakeUnits of WILD_NUDGE_STAKES){reset([2,45,2,16,14,...Array(40).fill(2)]);const prior=await demoBalanceUnits(db,a),begin=start(stakeUnits);let reply=await act(a,begin);assert.equal(await demoBalanceUnits(db,a),prior-Number(stakeUnits));while(reply.session.state==='active')reply=await act(a,move(reply.session));assert(validWildNudgeSession(reply.session));assert.equal(reply.session.returnedUnits,String(BigInt(stakeUnits)*860790n/100n));assert.equal(await demoBalanceUnits(db,a),prior-Number(stakeUnits)+Number(reply.session.returnedUnits));assert.deepEqual(await receipts(begin.id),{bets:1,wins:1});stakeRows.push({stakeUnits,payoutUnits:reply.session.returnedUnits,betCount:1,creditCount:1,freeContinuations:8});}
    cases.push('all-stakes-integer-journal');
    reset([16,16,16,30,30]);let pending=(await act(a,start())).session;for(let i=0;i<7;i++)pending=(await act(a,move(pending))).session;
    const saved=structuredClone(pending),settle=move(pending),balance=await demoBalanceUnits(db,a);
    await db.exec("CREATE FUNCTION reject_nudge_win() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source='studio-wild-nudge' AND NEW.entry_type='win' THEN RAISE EXCEPTION 'injected nudge settlement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_nudge_win BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_nudge_win()");
    await assert.rejects(act(a,settle),/injected nudge settlement failure/);assert.equal(await demoBalanceUnits(db,a),balance);assert.deepEqual((await active()).sessions.find(s=>s.id===pending.id),saved);assert.equal(await db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(a,settle.id),undefined);
    await db.exec('DROP TRIGGER reject_nudge_win ON demo_ledger');assert(validWildNudgeSession((await act(a,settle)).session));cases.push('atomic-rollback-and-retry');
    const entropy=calls;for(const invalid of [{...start(),stakeUnits:'1'},{...start(),settings:{wildNudge:{mode:'buy'}}},{...start(),payoutUnits:'999999'}])await assert.rejects(act(a,invalid));assert.equal(calls,entropy);cases.push('invalid-input-before-entropy');
    const prior=await demoBalanceUnits(db,a);await saveDemoUnits(db,a,MAX_DEMO_UNITS);await assert.rejects(act(a,start('5000')),/лимит/);assert.equal(calls,entropy);await saveDemoUnits(db,a,prior);cases.push('reserve-before-randomness');
    const snapshot=await wallet.snapshot(a);assert.equal(snapshot.balance,prior/100);await wallet.operate(a,{id:randomUUID(),kind:'play',gameId:'royal-roulette',rulesVersion:1,amount:10,input:{bet:'red'}});assert.equal((await wallet.snapshot(a)).balance,(await demoBalanceUnits(db,a))/100);cases.push('common-wallet-regression');
    assert.deepEqual(cases,NUDGE_WALLET_CASES);
    const evidence={scope:'primary-common-virtual-usdt-wallet',cases,stakeRows,reserveMultiplier:WILD_NUDGE_RESERVE_MULTIPLIER,futureBonusDrawsExposed:false};
    return {...evidence,sha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')};
  }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const evidence=await qualifyWildNudgeWallet();const out=process.argv.indexOf('--output');if(out>=0)await writeFile(resolve(process.argv[out+1]),JSON.stringify(evidence,null,2)+'\n');console.log('WILD_NUDGE_WALLET='+JSON.stringify(evidence));}
