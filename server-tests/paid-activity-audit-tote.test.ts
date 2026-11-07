import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { resolveTotePosting } from '../server/audit/tote';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { FlagToteStore } from '../server/flagTote';

test('pool debit resolves to one ticket and final credit resolves to all of its account tickets', async t => {
  const db = new PostgresDatabase(':memory:');
  t.after(() => db.close());
  const a = randomUUID(), b = randomUUID();
  await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(a,b);
  const wallet = new DemoWalletStore(db);
  for (const account of [a,b]) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 100 });
  let now = 900001;
  const tote = new FlagToteStore(db, account => wallet.snapshotInTransaction(account), wallet.ready, () => now, () => 0);
  const round = (await tote.snapshot(a)).round;
  const ticketA = randomUUID(), ticketB = randomUUID(), ticketC = randomUUID();
  for (const [account, id, country] of [[a,ticketA,'FR'],[a,ticketB,'BR'],[b,ticketC,'DE']] as const) {
    await tote.bet(account, { id, roundId: round.id, rulesVersion: 1, country, stakeUnits: '100' });
  }
  const entry = async (accountId: string, operationId: string) => {
    const row = await db.prepare('SELECT id::text,amount_units::text FROM demo_ledger WHERE account_id=? AND operation_id=?').get(accountId,operationId);
    return row && { rowId: String(row.id), accountId, operationId, gameId: 'flag-tote', amountUnits: String(row.amount_units) };
  };
  const debit = (await entry(a,'flag-tote:'+ticketA))!;
  const started = (await resolveTotePosting(db,debit))!;
  assert.equal(started.entity.ticketId, ticketA);
  assert.equal(started.entity.source.rowId, round.id);
  assert.equal(started.origin,'command');
  assert.equal(started.tickets[0].acceptedAtMs,null);
  assert.equal(started.tickets[0].payoutUnits,null);
  assert.equal(await resolveTotePosting(db,{ ...debit, accountId:b }),null);

  now=round.finishesAt;
  await tote.advance();
  const final=(await entry(a,'flag-tote:'+round.id+':final'))!;
  const settled=(await resolveTotePosting(db,final))!;
  assert.equal(settled.origin,'automatic');
  assert.equal(settled.entity.ticketId,null);
  assert.equal(settled.round.state,'settled');
  assert.equal(settled.round.potUnits,'300');
  assert.equal(settled.round.feeUnits,'15');
  assert.deepEqual(settled.tickets.map(ticket=>ticket.ticketId),[ticketA,ticketB]);
  assert.equal(settled.tickets.reduce((sum,ticket)=>sum+BigInt(ticket.payoutUnits!),0n).toString(),final.amountUnits);
});

test('an ineligible pool refund keeps the original ticket and zero fee', async t => {
  const db = new PostgresDatabase(':memory:');
  t.after(() => db.close());
  const a=randomUUID();
  await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await db.prepare('INSERT INTO accounts VALUES (?)').run(a);
  const wallet=new DemoWalletStore(db);
  await wallet.operate(a,{ id:randomUUID(),kind:'deposit',amount:100 });
  let now=900001;
  const tote=new FlagToteStore(db,account=>wallet.snapshotInTransaction(account),wallet.ready,()=>now);
  const round=(await tote.snapshot(a)).round, id=randomUUID();
  await tote.bet(a,{ id,roundId:round.id,rulesVersion:1,country:'FR',stakeUnits:'100' });
  now=round.closesAt;
  await tote.advance();
  const operationId='flag-tote:'+round.id+':final';
  const row=(await db.prepare('SELECT id::text FROM demo_ledger WHERE operation_id=?').get(operationId))!;
  const refund=(await resolveTotePosting(db,{ rowId:String(row.id),accountId:a,operationId,gameId:'flag-tote' }))!;
  assert.equal(refund.round.state,'refunded');
  assert.equal(refund.round.feeUnits,'0');
  assert.equal(refund.tickets[0].ticketId,id);
  assert.equal(refund.tickets[0].payoutUnits,'100');
});
