import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { TOTE_ADMISSION_CLOCK, reconcileStoredTotePool } from '../server/audit/check-tote';
import type { AuditEvent } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { recordDemoUnits } from '../server/demoWalletAmounts';
import { FlagToteStore } from '../server/flagTote';
import { TOTE_TIMING, type ToteBet } from '../src/shared/flagTote';

async function fixture() {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const a = randomUUID(), b = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(a, b);
  const wallet = new DemoWalletStore(game);
  for (const account of [a, b]) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const openedAt = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period;
  let now = openedAt + 1;
  const tote = new FlagToteStore(game, account => wallet.snapshotInTransaction(account), wallet.ready, () => now, () => 0);
  const round = (await tote.snapshot(a)).round;
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const accept = async (accountId: string, country: ToteBet['country'], stakeUnits = '100') => {
    const ticketId = randomUUID();
    await tote.bet(accountId, { id: ticketId, roundId: round.id, rulesVersion: 1, country, stakeUnits });
    return { accountId, ticketId, at: now };
  };
  const finish = async (time = round.finishesAt) => { now = time; await tote.advance(); };
  const close = () => Promise.all([audit.close(), game.close()]);
  return { game, audit, datasets, a, b, round, accept, finish, close };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Accepted = Awaited<ReturnType<Fixture['accept']>>;

async function recordClock(f: Fixture, datasetId: string, accepted: Accepted, options: {
  at?: number; wrongPosting?: string; reasonCode?: string;
} = {}) {
  const debit = (await f.game.prepare('SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=?')
    .get(accepted.accountId, 'flag-tote:' + accepted.ticketId))!;
  const event: AuditEvent = {
    schemaVersion: 1, type: 'event', scope: { datasetId, environment: 'test' }, occurredAtMs: options.at ?? accepted.at,
    eventId: randomUUID(), sequence: '1', accountId: accepted.accountId, operationId: accepted.ticketId,
    entity: { category: 'totalizator', kind: 'pool', gameId: 'flag-tote', modeId: 'pool', rulesVersion: '1',
      source: { namespace: f.game.schema + '.flag_tote_rounds', rowId: f.round.id }, ticketId: accepted.ticketId },
    event: 'accepted', reasonCode: options.reasonCode ?? TOTE_ADMISSION_CLOCK,
    postings: [{ namespace: f.game.schema + '.demo_ledger', rowId: options.wrongPosting ?? debit.id }],
  };
  await new AuditEvidence(f.audit, f.audit.schema).record(event);
  return event;
}

test('archived opening tickets have coverage gaps for acceptance time and one aggregate credit per player', async t => {
  const f = await fixture();
  t.after(f.close);
  const tickets = await Promise.all([f.accept(f.a, 'FR'), f.accept(f.a, 'BR', '200'), f.accept(f.b, 'DE')]);
  const { datasetId } = await f.datasets.startTest();
  await f.finish();
  await f.finish();
  // A ledger timestamp is not the server decision time, even if it is outside the pool window.
  await f.game.prepare('UPDATE demo_ledger SET created_at=? WHERE operation_id=?')
    .run(f.round.closesAt + 1, 'flag-tote:' + tickets[0].ticketId);
  const result = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.equal(result.state, 'settled');
  assert.equal(result.bankUnits, '400');
  assert.equal(result.status, 'insufficient-data');
  assert.deepEqual(result.findings.map(row => row.code), Array(3).fill('admission-clock-unavailable'));
  const credits = await f.game.prepare('SELECT account_id,amount_units::text FROM demo_ledger WHERE operation_id=?')
    .all('flag-tote:' + f.round.id + ':final');
  assert.equal(new Set(credits.map(row => row.account_id)).size, credits.length);
  assert.equal(credits.reduce((sum, row) => sum + BigInt(row.amount_units), 0n), 380n);
  assert.equal(await reconcileStoredTotePool(f.audit, f.game, randomUUID(), f.round.id), null);
});

test('the exact trusted acceptance time accepts the open boundary and rejects the closed boundary', async t => {
  const f = await fixture();
  t.after(f.close);
  const { datasetId } = await f.datasets.startTest();
  const timely = await f.accept(f.a, 'FR'), late = await f.accept(f.a, 'BR'), wrong = await f.accept(f.b, 'DE');
  await recordClock(f, datasetId, timely, { at: f.round.openedAt });
  const lateClock = await recordClock(f, datasetId, late, { at: f.round.closesAt });
  await recordClock(f, datasetId, wrong, { wrongPosting: '99999999' });
  await f.finish();
  const result = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.equal(result.status, 'mismatch');
  const findings = new Map(result.findings.map(row => [row.code, row]));
  assert.deepEqual([...findings.keys()], ['ticket-outside-window', 'admission-clock-unavailable']);
  assert.equal(findings.get('ticket-outside-window')?.observed, String(f.round.closesAt));
  assert(findings.get('ticket-outside-window')?.sources.some(source => source.rowId.includes(lateClock.eventId)));
  assert.equal(findings.get('admission-clock-unavailable')?.sources[0].rowId, wrong.ticketId);
});

test('eligible pool checks stored bank, commission, awards, ticket debits and per-account credit independently', async t => {
  const f = await fixture();
  t.after(f.close);
  const { datasetId } = await f.datasets.startTest();
  const a = await f.accept(f.a, 'FR'), b = await f.accept(f.a, 'BR', '200'), c = await f.accept(f.b, 'DE');
  for (const accepted of [a, b, c]) await recordClock(f, datasetId, accepted);
  const open = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.equal(open.state, 'open');
  assert.equal(open.status, 'match');
  await f.finish();
  assert.equal((await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))?.status, 'match');

  await f.game.prepare(`UPDATE flag_tote_rounds SET settlement=(settlement::jsonb ||
    '{"potUnits":"399","feeUnits":"19","awards":[]}'::jsonb)::text WHERE id=?`).run(f.round.id);
  await f.game.prepare('UPDATE flag_tote_tickets SET payout_units=payout_units+1 WHERE id=?').run(a.ticketId);
  await f.game.prepare('UPDATE demo_ledger SET amount_units=-99,amount=0 WHERE operation_id=?').run('flag-tote:' + c.ticketId);
  const final = 'flag-tote:' + f.round.id + ':final';
  const credit = (await f.game.prepare('SELECT account_id,balance_units FROM demo_ledger WHERE operation_id=? LIMIT 1').get(final))!;
  await recordDemoUnits(f.game, credit.account_id, final, 'win', 1, credit.balance_units + 1, 'flag-tote');
  const damaged = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  const codes = new Set(damaged.findings.map(row => row.code));
  for (const expected of ['pool-bank', 'pool-commission', 'pool-awards', 'ticket-payout', 'ticket-debit', 'pool-credit-count']) {
    assert(codes.has(expected), expected);
  }
});

test('ineligible pool refunds the original ticket amounts and does not charge a fee', async t => {
  const f = await fixture();
  t.after(f.close);
  const { datasetId } = await f.datasets.startTest();
  const ticket = await f.accept(f.a, 'FR', '200');
  await recordClock(f, datasetId, ticket);
  await f.finish(f.round.closesAt);
  const refunded = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.equal(refunded.state, 'refunded');
  assert.equal(refunded.status, 'match');
  assert.equal(refunded.bankUnits, '200');
  await f.game.prepare('UPDATE flag_tote_tickets SET payout_units=100 WHERE id=?').run(ticket.ticketId);
  await f.game.prepare("UPDATE demo_ledger SET entry_type='win' WHERE operation_id=?").run('flag-tote:' + f.round.id + ':final');
  const damaged = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.deepEqual(damaged.findings.map(row => row.code), ['ticket-refund', 'pool-refund-credit']);
});

test('a pool settled after sealing is not reconciled as a terminal pool in the older dataset', async t => {
  const f = await fixture();
  t.after(f.close);
  const { datasetId } = await f.datasets.startTest();
  const accepted = await f.accept(f.a, 'FR');
  await recordClock(f, datasetId, accepted);
  await f.datasets.sealTest(datasetId);
  await f.finish(f.round.closesAt);
  const result = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.equal(result.state, null);
  assert.deepEqual(result.findings.map(row => row.code), ['pool-settlement-outside-dataset']);
});

test('a captured row with an incompatible canonical key is an explicit source gap', async t => {
  const f = await fixture();
  t.after(f.close);
  const { datasetId } = await f.datasets.startTest();
  const ticket = await f.accept(f.a, 'FR');
  await recordClock(f, datasetId, ticket);
  const debit = (await f.game.prepare('SELECT id::text FROM demo_ledger WHERE operation_id=?')
    .get('flag-tote:' + ticket.ticketId))!;
  await f.game.prepare('UPDATE demo_ledger SET operation_id=? WHERE id=?').run('another-operation', debit.id);
  const result = (await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id))!;
  assert.equal(result.status, 'insufficient-data');
  assert.equal(result.findings[0].code, 'pool-canonical-postings-unavailable');
  assert.deepEqual(result.findings[0].sources[1], { namespace: f.game.schema + '.demo_ledger', rowId: debit.id });
});

test('a missing canonical table yields a source gap only for a registered dataset', async t => {
  const f = await fixture();
  t.after(f.close);
  const { datasetId } = await f.datasets.startTest();
  await f.accept(f.a, 'FR');
  assert.equal(await reconcileStoredTotePool(f.audit, f.game, datasetId, 'ft1-1'), null);
  await f.game.exec('ALTER TABLE demo_ledger RENAME TO unavailable_ledger');
  assert.equal(await reconcileStoredTotePool(f.audit, f.game, randomUUID(), f.round.id), null);
  assert.deepEqual(await reconcileStoredTotePool(f.audit, f.game, datasetId, f.round.id), {
    status: 'insufficient-data', scope: { datasetId, environment: 'test' },
    source: { namespace: f.game.schema + '.flag_tote_rounds', rowId: f.round.id },
    rulesVersion: null, state: null, bankUnits: null,
    findings: [{ status: 'insufficient-data', code: 'pool-source-unavailable',
      sources: [{ namespace: f.game.schema + '.flag_tote_rounds', rowId: f.round.id }] }],
  });
});
