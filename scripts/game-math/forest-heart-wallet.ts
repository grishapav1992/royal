import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PostgresDatabase} from '../../server/database';
import {DemoWalletStore} from '../../server/demoWallet';
import {demoBalanceUnits,demoReservedUnits,saveDemoUnits,MAX_DEMO_UNITS} from '../../server/demoWalletAmounts';
import {VirtualPvpLedger} from '../../server/pvp/virtual-wallet';
import {FOREST_HEART_GAME,validForestHeartSession} from '../../src/shared/forestHeart';
import {FOREST_HEART_STAKES} from '../../src/shared/forestHeartMath';
// @ts-expect-error Independent JavaScript verifier deliberately has no shared scorer types.
import {referenceBoard,referenceFlow,referenceHeld,referenceNextState,countFlowers} from './forest-heart-reference.mjs';
// @ts-expect-error Pure evidence schema is also consumed by the JavaScript build gate.
import {FOREST_WALLET_CASES,forestWalletDigest,validateForestWalletEvidence} from './forest-heart-evidence.mjs';

function oracle(stake:string,view:any){
  const base=view.base,first=referenceFlow(referenceBoard(base.bits));
  const second=referenceFlow(referenceBoard(base.rotation===null?base.bits:base.bits^(1<<base.rotation)));
  let total=BigInt(stake)*631n*BigInt(base.energy*countFlowers(first.receiverMask|second.receiverMask))/1000n,state=0;
  for(const spin of view.bonus){
    const held=referenceHeld(state),bits=(spin.bits&~held.mask)|held.values;
    const flow=referenceFlow(referenceBoard(bits));
    const payout=BigInt(stake)*631n*BigInt(spin.energy*countFlowers(flow.receiverMask))/1000n;
    state=referenceNextState(state,bits,flow.terminalRootMask);
    assert.equal(spin.payoutUnits,String(payout));assert.equal(spin.heldState,state);total+=payout;
  }
  assert.equal(view.totalPayoutUnits,String(total));return total;
}
async function fixture(){
  const db=new PostgresDatabase(':memory:'),a=randomUUID(),b=randomUUID();
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  for(const account of[a,b])await db.prepare('INSERT INTO accounts VALUES(?)').run(account);
  let calls=0,program:number[]=[],fallback=1;
  const draw=(max:number)=>{calls++;return program.length?program.shift()!:Math.min(fallback,max-1);};
  let wallet=new DemoWalletStore(db,draw);await wallet.ready;
  const depositId=randomUUID();await wallet.operate(a,{id:depositId,kind:'deposit',amount:10000});
  await wallet.operate(b,{id:randomUUID(),kind:'deposit',amount:200});
  const operate=(account:string,op:unknown,cap=true)=>wallet.expansion.operate(account,op,2,true,true,true,true,true,true,true,true,2,3,true,cap);
  const active=(account:string,cap=true)=>wallet.expansion.active(account,true,true,true,true,true,true,true,2,3,true,cap);
  const start=(stake='1000')=>({id:randomUUID(),action:'start' as const,gameId:FOREST_HEART_GAME,stakeUnits:stake,settings:{forestHeart:{mode:'normal' as const}}});
  const move=(s:any,name:string)=>({id:randomUUID(),action:'move' as const,gameId:FOREST_HEART_GAME,sessionId:s.id,move:name,revision:s.view.forestHeart.revision});
  const set=(values:number[],defaultValue=1)=>{program=[...values];fallback=defaultValue;};
  const receiptRows=async(id:string)=>{
    const rows=await db.prepare("SELECT entry_type FROM demo_ledger WHERE account_id=? AND operation_id IN (SELECT id FROM demo_casino_requests WHERE account_id=? AND session_id=?)").all(a,a,id);
    return {bets:rows.filter(row=>row.entry_type==='bet').length,wins:rows.filter(row=>row.entry_type==='win').length};
  };
  return {db,a,b,depositId,operate,active,start,move,set,calls:()=>calls,receiptRows,
    wallet:()=>wallet,restart:async()=>{wallet=new DemoWalletStore(db,draw);await wallet.ready;},close:()=>db.close()};
}

/** Real Postgres transactions against the currently used common virtual wallet. */
export async function qualifyForestHeartWallet(){
  const c=await fixture(),cases:string[]=[];
  try{
    const before=await demoBalanceUnits(c.db,c.a),initial=c.start();c.set([0,0,0,0]);
    await assert.rejects(c.operate(c.a,initial,false),/Обнови/);assert.equal(c.calls(),0);
    assert.equal(await demoBalanceUnits(c.db,c.a),before);cases.push('client-negotiation');
    const replies=await Promise.all(Array.from({length:5},()=>c.operate(c.a,initial)));
    let session=replies[0].session;
    assert(replies.every(row=>validForestHeartSession(row.session)&&row.session.id===initial.id));
    assert.equal(c.calls(),4);assert.equal(await demoBalanceUnits(c.db,c.a),before-1000);
    assert.deepEqual(await c.receiptRows(initial.id),{bets:1,wins:0});
    await assert.rejects(c.operate(c.a,{...initial,stakeUnits:'2000'}));
    assert.equal(c.calls(),4);cases.push('concurrent-start-and-replay');
    assert.equal(session.view.forestHeart!.bonus.length,0);assert.equal(session.view.forestHeart!.stage,'choice');
    assert.equal('engine'in session,false);
    assert(!(await c.active(c.a,false)).sessions.some(s=>s.id===initial.id));
    await c.restart();session=(await c.active(c.a)).sessions.find(s=>s.id===initial.id)!;
    assert.equal(session.view.forestHeart!.revision,1);assert.equal(c.calls(),4);
    assert.equal(await demoReservedUnits(c.db,c.a),947000);cases.push('saved-choice-and-private-future');
    await assert.rejects(c.operate(c.b,c.move(session,'forest-pass')));
    await assert.rejects(c.operate(c.a,{...c.move(session,'forest-pass'),revision:2}));
    await assert.rejects(c.operate(c.a,{...c.move(session,'forest-pass'),payoutUnits:'99999999'}));
    await assert.rejects(c.operate(c.a,c.move(session,'forest-spin')));
    await assert.rejects(c.operate(c.a,c.start()));assert.equal(c.calls(),4);
    cases.push('ownership-revisions-and-actions');
    const choice=c.move(session,'forest-turn-2');
    const parallel=await Promise.allSettled([c.operate(c.a,choice),c.operate(c.a,{...choice,id:randomUUID()})]);
    assert.equal(parallel.filter(row=>row.status==='fulfilled').length,1);
    session=(await c.active(c.a)).sessions.find(s=>s.id===initial.id)!;
    assert.equal(session.view.forestHeart!.stage,'bonus');assert.equal(c.calls(),4);
    assert.equal(await demoBalanceUnits(c.db,c.a),before-1000);cases.push('free-turn-and-concurrent-revision');
    c.set([132,0,132,0,132,0,132,0]);
    for(let i=0;i<3;i++)session=(await c.operate(c.a,c.move(session,'forest-spin'))).session;
    const final=c.move(session,'forest-spin'),saved=structuredClone(session);
    await c.db.exec("CREATE FUNCTION reject_forest_win() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source='studio-forest-heart' AND NEW.entry_type='win' THEN RAISE EXCEPTION 'injected forest settlement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_forest_win BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_forest_win()");
    await assert.rejects(c.operate(c.a,final),/injected forest settlement failure/);
    assert.equal(await demoBalanceUnits(c.db,c.a),before-1000);
    assert.deepEqual((await c.active(c.a)).sessions.find(s=>s.id===initial.id),saved);
    assert.equal(await c.db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(c.a,final.id),undefined);
    await c.db.exec('DROP TRIGGER reject_forest_win ON demo_ledger');c.set([132,0]);
    session=(await c.operate(c.a,final)).session;assert(validForestHeartSession(session));
    assert.equal(session.state,'settled');const expected=oracle('1000',session.view.forestHeart);
    assert.equal(await demoBalanceUnits(c.db,c.a),before-1000+Number(expected));
    assert.equal(await demoReservedUnits(c.db,c.a),0);assert.deepEqual(await c.receiptRows(initial.id),{bets:1,wins:1});
    const draws=c.calls();assert((await c.operate(c.a,final)).replayed);assert.equal(c.calls(),draws);
    await assert.rejects(c.operate(c.a,{...final,id:randomUUID()}));cases.push('rollback-and-retry');
    for(const stake of FOREST_HEART_STAKES){
      c.set([132,9999,1,0,...Array.from({length:4},()=>[132,9999]).flat()]);
      const prior=await demoBalanceUnits(c.db,c.a),start=c.start(String(stake));let reply=await c.operate(c.a,start);
      assert.equal(await demoBalanceUnits(c.db,c.a),prior-stake);
      while(reply.session.state==='active')reply=await c.operate(c.a,c.move(reply.session,'forest-spin'));
      const paid=oracle(String(stake),reply.session.view.forestHeart);assert.equal(paid*2n,BigInt(stake)*1893n);
      assert.equal(await demoBalanceUnits(c.db,c.a),prior-stake+Number(paid));assert.equal(await demoReservedUnits(c.db,c.a),0);
      assert.deepEqual(await c.receiptRows(start.id),{bets:1,wins:1});
    }
    cases.push('all-stakes-and-maximum-settlement');
    const pvp=new VirtualPvpLedger(c.db,c.wallet()),match={matchId:randomUUID(),gameId:'chess',stakeUnits:'190000000'};
    await pvp.pvpHold(c.b,match);assert.equal((await c.wallet().snapshot(c.b)).balance,10);
    const drawBefore=c.calls();await assert.rejects(c.operate(c.b,c.start('2000')),/Недостаточно/);assert.equal(c.calls(),drawBefore);
    await pvp.pvpFinish(c.b,{matchId:match.matchId,winnerId:null,reason:'cancel'});
    assert.equal((await c.wallet().snapshot(c.b)).balance,200);cases.push('shared-pvp-balance');
    const edge=await fixture();try{
      await saveDemoUnits(edge.db,edge.a,MAX_DEMO_UNITS-1000);
      await assert.rejects(edge.operate(edge.a,edge.start()),/лимит/);assert.equal(edge.calls(),0);
      await saveDemoUnits(edge.db,edge.a,MAX_DEMO_UNITS-947000);edge.set([0,0,0,1]);
      const pending=(await edge.operate(edge.a,edge.start())).session;
      assert.equal(await demoReservedUnits(edge.db,edge.a),947000);
      await assert.rejects(edge.wallet().operate(edge.a,{id:randomUUID(),kind:'deposit',amount:11}));
      const settled=await edge.operate(edge.a,edge.move(pending,'forest-pass'));
      assert.equal(settled.session.state,'settled');assert.equal(await demoReservedUnits(edge.db,edge.a),0);
    }finally{await edge.close();}
    cases.push('reserved-capacity');
    const invalid=c.start(),balance=await demoBalanceUnits(c.db,c.a);c.set([-1]);
    await assert.rejects(c.operate(c.a,invalid),/entropy/);
    assert.equal(await demoBalanceUnits(c.db,c.a),balance);
    assert.equal(await c.db.prepare('SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND id=?').get(c.a,invalid.id),undefined);
    assert.equal(await c.db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(c.a,invalid.id),undefined);
    cases.push('invalid-entropy-rollback');c.set([]);
    const used=c.calls();await assert.rejects(c.operate(c.a,{...c.start(),id:c.depositId}));assert.equal(c.calls(),used);
    cases.push('cross-operation-identity');assert.deepEqual(cases,FOREST_WALLET_CASES);
    const ledger=[];
    for(const [i,account]of[c.a,c.b].entries()){
      const entries=await c.db.prepare('SELECT amount_units,balance_units FROM demo_ledger WHERE account_id=? ORDER BY id').all(account);
      let total=0n,credits=0n,debits=0n;
      for(const row of entries){const amount=BigInt(row.amount_units);total+=amount;if(amount>=0n)credits+=amount;else debits-=amount;assert.equal(BigInt(row.balance_units),total);assert(total>=0n);}
      assert.equal(BigInt(await demoBalanceUnits(c.db,account)),total);
      ledger.push({account:'synthetic-'+i,rows:entries.length,credits:String(credits),debits:String(debits),balance:String(total),reserved:String(await demoReservedUnits(c.db,account))});
    }
    const evidence={method:'postgres-common-wallet-v1',cases,ledger,sha256:''};evidence.sha256=forestWalletDigest(evidence);validateForestWalletEvidence(evidence);
    return evidence;
  }finally{await c.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  console.log('FOREST_WALLET_EVIDENCE:'+JSON.stringify(await qualifyForestHeartWallet()));
