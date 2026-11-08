import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pvpFixture } from './finance/helpers/nile-pvp-fixture';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { COMBAT_RULES_VERSION, validCombatEscrowReceipt } from '../src/shared/combatEscrow';

async function fixture(){
 const c=await pvpFixture();let now=Date.now();
 const escrow=new NileCombatEscrow(c.ledger,()=>now);await escrow.ready;
 return {...c,escrow,advance:(ms:number)=>{now+=ms;},restart:()=>new NileCombatEscrow(c.ledger,()=>now),
  match:()=>({id:randomUUID(),accounts:[c.a,c.b],stakeUnits:'10000000'}),
  wallet:(id:string)=>c.ledger.wallet(id,now)};
}
test('combat uses the shared Nile journal, reserves both stakes and pays 95% exactly once',async()=>{
 const c=await fixture();try{
  const m=c.match(),r=await c.escrow.fund(c.a,m);assert.equal(validCombatEscrowReceipt(r),true);
  await c.escrow.fund(c.a,m);
  assert.deepEqual(await c.ledger.db.prepare('SELECT rules_version FROM combat_matches WHERE id=?').get(m.id),
   {rules_version:COMBAT_RULES_VERSION});
  const held=await c.wallet(c.a);assert.equal(held.state,'assigned');if(held.state!=='assigned')return;
  assert.equal(held.balanceUnits,'190000000');assert.equal(held.reservedUnits,'10000000');
  const result=await c.escrow.settle(c.a,{...m,winner:c.a});
  assert.equal(result.feeUnits,'1000000');assert.equal(result.payoutUnits,'19000000');
  await c.escrow.settle(c.a,{...m,winner:c.a});
  // A conflicting retry cannot redirect a settled pot either.
  assert.equal((await c.escrow.settle(c.a,{...m,winner:c.b})).winner,c.a);
  const a=await c.wallet(c.a),b=await c.wallet(c.b);
  assert.equal(a.state==='assigned'&&a.balanceUnits,'209000000');
  assert.equal(b.state==='assigned'&&b.balanceUnits,'190000000');
  assert.equal(a.state==='assigned'&&a.reservedUnits,'0');
  assert.equal((await c.ledger.db.prepare("SELECT count(*) AS n FROM events WHERE kind='pvp' AND payload::jsonb->>'matchId'=?").get(m.id))!.n,3);
  const audit=await c.ledger.audit();assert.equal(audit.houseUnits,'1000000');assert.equal(audit.totalUnits,'400000000');
  const report=await c.ledger.adminReport({mode:'pvp',game:'mortal-kombat'});
  assert.equal(report.rows.length,2);assert.equal(report.totals.fees,'1000000');
  assert.equal(report.rows.find(row=>row.playerId===c.a)!.opponentId,c.b);
 }finally{await c.close();}
});
test('combat rejects forged actors, participants, stakes, winners and reused identities without altering money',async()=>{
 const c=await fixture();try{
  const m=c.match(),outsider=randomUUID();
  await assert.rejects(()=>c.escrow.fund(outsider,m));
  await assert.rejects(()=>c.escrow.fund(c.a,{...m,accounts:[c.a,c.a]}));
  await assert.rejects(()=>c.escrow.fund(c.a,{...m,stakeUnits:'1'}));
  await assert.rejects(()=>c.escrow.fund(c.a,{...m,winner:c.a}));
  await assert.rejects(()=>c.escrow.fund(c.a,{...m,rulesVersion:COMBAT_RULES_VERSION}));
  await c.escrow.fund(c.a,m);
  await assert.rejects(()=>c.escrow.settle(c.a,{...m,winner:outsider}));
  await assert.rejects(()=>c.escrow.fund(c.a,{...m,accounts:[c.a,outsider]}));
  assert.equal((await c.ledger.db.prepare('SELECT count(*) AS n FROM combat_seats').get())!.n,2);
  await c.ledger.audit();
 }finally{await c.close();}
});
test('a failed second hold or settlement rolls back the complete common-wallet transaction',async()=>{
 const c=await fixture();try{
  const m=c.match();
  await c.ledger.db.exec(`CREATE FUNCTION fail_combat_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test journal failure'; END $$;
   CREATE TRIGGER fail_combat BEFORE INSERT ON events FOR EACH ROW WHEN (NEW.kind='pvp' AND NEW.payload::jsonb->>'action'='hold' AND NEW.payload::jsonb->'participants'->0->>'accountId'='${c.b}') EXECUTE FUNCTION fail_combat_entry();`);
  await assert.rejects(()=>c.escrow.fund(c.a,m));
  assert.equal((await c.ledger.db.prepare('SELECT count(*) AS n FROM combat_matches').get())!.n,0);
  const wallet=await c.wallet(c.a);assert.equal(wallet.state==='assigned'&&wallet.balanceUnits,'200000000');
  await c.ledger.db.exec('DROP TRIGGER fail_combat ON events');
  await c.escrow.fund(c.a,m);
  await c.ledger.db.exec("CREATE TRIGGER fail_combat BEFORE INSERT ON events FOR EACH ROW WHEN (NEW.kind='pvp' AND NEW.payload::jsonb->>'action'='settle') EXECUTE FUNCTION fail_combat_entry();");
  await assert.rejects(()=>c.escrow.settle(c.a,{...m,winner:c.a}));
  assert.equal((await c.ledger.db.prepare('SELECT count(*) AS n FROM combat_seats').get())!.n,2);
  await c.ledger.db.exec('DROP TRIGGER fail_combat ON events');
  await c.escrow.settle(c.a,{...m,winner:c.a});await c.ledger.audit();
 }finally{await c.close();}
});
test('cancellation blocks delayed funding and orphan expiry refunds once after restart',async()=>{
 const c=await fixture();try{
  const cancelled=c.match();
  assert.equal((await c.escrow.cancel(c.a,cancelled)).state,'cancelled');
  assert.equal((await c.escrow.fund(c.a,cancelled)).state,'cancelled');
  assert.deepEqual(await c.ledger.db.prepare('SELECT rules_version FROM combat_matches WHERE id=?').get(cancelled.id),
   {rules_version:null});
  const m=c.match();await c.escrow.fund(c.a,m);c.advance(150001);
  const restarted=c.restart();await restarted.recoverExpired();await restarted.recoverExpired();
  const late=await restarted.settle(c.a,{...m,winner:c.a});assert.equal(late.state,'refunded');assert.equal(late.feeUnits,'0');
  assert.deepEqual(await c.ledger.db.prepare('SELECT rules_version FROM combat_matches WHERE id=?').get(m.id),
   {rules_version:COMBAT_RULES_VERSION});
  for(const id of [c.a,c.b]){const w=await c.wallet(id);assert.equal(w.state==='assigned'&&w.balanceUnits,'200000000');assert.equal(w.state==='assigned'&&w.reservedUnits,'0');}
  await c.ledger.audit();
 }finally{await c.close();}
});
test('a fight funded before the rules-version migration remains unpinned through retry and recovery',async()=>{
 const c=await pvpFixture();try{
  const m={id:randomUUID(),accounts:[c.a,c.b],stakeUnits:'10000000'};
  let now=Date.now();
  await c.ledger.db.exec(`CREATE TABLE combat_matches(
    id TEXT PRIMARY KEY, accounts TEXT NOT NULL, stake_units BIGINT NOT NULL,
    state TEXT NOT NULL, expires_at BIGINT NOT NULL, winner TEXT NOT NULL DEFAULT '',
    fee_units BIGINT NOT NULL DEFAULT 0, payout_units BIGINT NOT NULL DEFAULT 0)`);
  for(const account of m.accounts) await c.ledger.pvpHold(account,
   {matchId:m.id,gameId:'mortal-kombat',stakeUnits:m.stakeUnits},now);
  await c.ledger.db.prepare("INSERT INTO combat_matches(id,accounts,stake_units,state,expires_at) VALUES (?,?,?,'active',?)")
   .run(m.id,JSON.stringify(m.accounts),m.stakeUnits,now+150000);
  const escrow=new NileCombatEscrow(c.ledger,()=>now);
  assert.equal((await escrow.fund(c.a,m)).state,'active');
  now+=150001;
  await escrow.recoverExpired();
  assert.equal((await escrow.fund(c.a,m)).state,'refunded');
  assert.deepEqual(await c.ledger.db.prepare('SELECT rules_version FROM combat_matches WHERE id=?').get(m.id),
   {rules_version:null});
  for(const account of m.accounts){
   const wallet=await c.ledger.wallet(account,now);
   assert.equal(wallet.state==='assigned'&&wallet.balanceUnits,'200000000');
   assert.equal(wallet.state==='assigned'&&wallet.reservedUnits,'0');
  }
 }finally{await c.close();}
});
test('stale Nile funding and simultaneous combat reservations fail closed without partial debits',async()=>{
 const c=await fixture();try{
  await c.ledger.db.prepare('UPDATE state SET source_at=? WHERE id=1').run(Date.now()-120000);
  await assert.rejects(()=>c.escrow.fund(c.a,c.match()));
  assert.equal((await c.ledger.db.prepare('SELECT count(*) AS n FROM combat_matches').get())!.n,0);
  await c.ledger.sync(c.source,await c.reconciliation());
  const results=await Promise.allSettled([c.escrow.fund(c.a,c.match()),c.escrow.fund(c.a,c.match())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await c.ledger.db.prepare('SELECT count(*) AS n FROM combat_seats WHERE account_id=?').get(c.a))!.n,1);
  await c.ledger.audit();
 }finally{await c.close();}
});

test('funding from another game reduces the same available balance and cannot be double spent in combat',async()=>{
 const c=await fixture();try{
  await c.ledger.pvpHold(c.b,{matchId:randomUUID(),gameId:'durak',stakeUnits:'150000000'});
  const m={...c.match(),stakeUnits:'100000000'};
  await assert.rejects(()=>c.escrow.fund(c.a,m));
  const a=await c.wallet(c.a),b=await c.wallet(c.b);
  assert.equal(a.state==='assigned'&&a.balanceUnits,'200000000');
  assert.equal(a.state==='assigned'&&a.reservedUnits,'0');
  assert.equal(b.state==='assigned'&&b.balanceUnits,'50000000');
  assert.equal((await c.ledger.db.prepare('SELECT count(*) AS n FROM combat_matches').get())!.n,0);
  await c.ledger.audit();
 }finally{await c.close();}
});
