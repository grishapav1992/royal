import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import type { AuditAttempt, AuditEvent, AuditSourceRef } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport, type AuditDetailReport } from '../server/audit/report-detail-source';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), payment = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const clients: pg.Client[] = [];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const reader = 'audit_detail_reader_' + suffix, alice = 'audit_detail_alice_' + suffix;
  const bob = 'audit_detail_bob_' + suffix, password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(reader)} NOLOGIN;
    CREATE ROLE ${identifier(alice)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(bob)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(reader)} TO ${identifier(alice)},${identifier(bob)}`);
  t.after(async () => {
    await Promise.all(clients.map(client => client.end()));
    await audit.exec(`DROP OWNED BY ${identifier(reader)}; DROP ROLE ${identifier(alice)},${identifier(bob)},${identifier(reader)}`);
    await Promise.all([game.close(), payment.close(), audit.close()]);
  });

  const actor = randomUUID(), other = randomUUID();
  for (const db of [game, payment]) {
    await db.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
    await db.prepare('INSERT INTO accounts VALUES (?),(?)').run(actor, other);
  }
  const wallet = new DemoWalletStore(game, () => 0);
  const crypto = new CryptoStore(payment, cryptoConfig({}), {} as CryptoProvider);
  const before = randomUUID();
  await wallet.operate(actor, { id: before, kind: 'deposit', amount: 100 });
  await wallet.operate(other, { id: randomUUID(), kind: 'deposit', amount: 100 });
  await crypto.ready;
  const sources = { game: game.schema, payments: payment.schema };
  const datasets = new AuditDatasets(audit, sources);
  const { datasetId, environment } = await datasets.startTest();
  const scope = { datasetId, environment };
  await installAuditReportAccess(audit, reader);
  await installAuditDetailReport(audit, reader, sources);
  const demo = game.schema + '.demo_ledger', real = payment.schema + '.crypto_ledger';
  const grant = (name: string, namespace: string, selected = datasetId) => audit.prepare(
    'INSERT INTO audit_report_acl(operator_name,dataset_id,source_namespace) VALUES (?,?,?)').run(name, selected, namespace);
  await grant(alice, demo);
  await grant(bob, demo);
  const login = async (name: string) => {
    const client = new pg.Client(databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
      PGUSER: name, PGPASSWORD: password, PGPASSWORD_FILE: '' }));
    await client.connect();
    clients.push(client);
    return client;
  };
  const operator = await login(alice), otherOperator = await login(bob);
  const schema = identifier(audit.schema);
  const begin = (source: AuditSourceRef, who = operator, selected = datasetId) => who.query(
    `SELECT ${schema}.audit_report_begin($1,'detail',$2::jsonb) AS id`, [selected, JSON.stringify({ source: source.namespace, postingId: source.rowId })])
    .then(result => result.rows[0].id as string);
  const read = (job: string, who = operator) => who.query(`SELECT ${schema}.audit_report_detail($1) AS report`, [job])
    .then(result => result.rows[0].report as AuditDetailReport);
  const finish = (job: string, who = operator) => who.query(`SELECT ${schema}.audit_report_finish($1,'succeeded',0,0,NULL)`, [job]);
  const sourceRows = async (op: string, db = game, account = actor) => {
    const table = db === game ? 'demo_ledger' : 'crypto_ledger';
    return (await db.prepare(`SELECT id::text FROM ${table} WHERE account_id=? AND operation_id=? ORDER BY ${table}.id`)
      .all(account, op)).map(row => ({ namespace: db.schema + '.' + table, rowId: row.id }));
  };
  return { game, payment, audit, wallet, crypto, actor, other, before, datasets, scope, schema,
    demo, real, grant, alice, operator, otherOperator, begin, read, finish, sourceRows };
}

test('operator detail projects the accepted command, two canonical legs and sanitized formed responses', async t => {
  const f = await fixture(t);
  const operationId = randomUUID();
  const play = (account: string) => f.wallet.operate(account, { id: operationId, kind: 'play',
    gameId: 'royal-roulette', input: { bet: 'black' }, rulesVersion: 1, stakePolicyVersion: 1, amount: 1 });
  await play(f.actor);
  await play(f.other);
  await f.crypto.creditStarsDeposit(f.actor, operationId, '1000000', randomUUID(), 100);
  const [stake, payout] = await f.sourceRows(operationId);
  const [foreign] = await f.sourceRows(operationId, f.game, f.other);
  const [real] = await f.sourceRows(operationId, f.payment);
  const evidence = new AuditEvidence(f.audit, f.audit.schema);
  const at = Date.now(), observed = randomUUID();
  const attempt: AuditAttempt = { schemaVersion: 1, scope: f.scope, type: 'attempt', occurredAtMs: at,
    attemptId: observed, accountId: f.actor, operationId, entity: null, route: '/api/demo-wallet/operations',
    transport: 'http', decision: 'replayed', response: 'formed', statusCode: 200, delivery: 'handed-off',
    balance: { state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 }, units: '-100', snapshot: payout } };
  const unaffiliated = randomUUID(), malformed = randomUUID(), privateField = 'SENSITIVE-' + randomUUID();
  await evidence.record(attempt);
  await evidence.record({ ...attempt, attemptId: unaffiliated, occurredAtMs: at + 1, balance: { ...attempt.balance, snapshot: foreign } });
  await evidence.record({ ...attempt, attemptId: malformed, occurredAtMs: at + 2,
    balance: { ...attempt.balance, snapshot: { namespace: f.demo, rowId: privateField } } });
  await evidence.record({ ...attempt, attemptId: randomUUID(), route: '/api/crypto-wallet/deposits' });
  await evidence.record({ ...attempt, attemptId: randomUUID(), accountId: f.other });
  const event: AuditEvent = { schemaVersion: 1, scope: f.scope, type: 'event', occurredAtMs: at,
    eventId: randomUUID(), sequence: '1', accountId: f.actor, operationId, event: 'settled', reasonCode: null,
    entity: { category: 'casino', kind: 'round', gameId: 'royal-roulette', modeId: 'normal', rulesVersion: '1', ticketId: null,
      source: { namespace: f.game.schema + '.demo_operations', rowId: JSON.stringify([f.actor, operationId]) } },
    postings: [stake, payout, foreign, real] };
  await evidence.record(event);
  const system = { ...event, eventId: randomUUID(), accountId: null, occurredAtMs: at + 1, postings: [stake] };
  await evidence.record(system);
  await evidence.record({ ...system, eventId: randomUUID(), postings: [foreign] });
  await f.audit.prepare(`UPDATE audit_evidence SET payload=payload||jsonb_build_object('rawResponse',?::text,'token',?::text)
    WHERE dataset_id=? AND kind='attempt' AND evidence_id=?`).run(privateField, privateField, f.scope.datasetId, observed);

  const job = await f.begin(stake);
  await assert.rejects(f.read(job, f.otherOperator), { code: '42501' });
  await assert.rejects(f.operator.query(`SELECT * FROM ${identifier(f.game.schema)}.demo_ledger`), { code: '42501' });
  const report = await f.read(job);
  assert.equal(report.status, 'found');
  assert.deepEqual(report.anchor?.source, stake);
  assert.equal(report.anchor?.amountUnits, '-100');
  assert.equal(report.anchor?.expectedBalanceUnits, '9900');
  assert.deepEqual(report.linkedPostings.map(posting => [posting.source, posting.amountUnits]), [[payout, '0']]);
  assert.deepEqual(report.operation?.source, event.entity.source);
  assert.equal(report.operation?.kind, 'play');
  assert.deepEqual(report.operation?.parameters, { bet: 'black', number: null });
  assert.equal(report.outcome?.rouletteNumber, '0');
  assert.equal(report.outcome?.payoutUnits, '0');
  assert.deepEqual(report.events[0]?.postings, [stake, payout]);
  assert.deepEqual(report.events.map(row => [row.id, row.accountId]), [[event.eventId, f.actor], [system.eventId, null]]);
  assert.equal(report.attempts.length, 3);
  const formed = report.attempts.find(row => row.id === observed);
  assert.equal(formed?.statusCode, 200);
  assert.equal(formed?.delivery, 'handed-off');
  assert.deepEqual(formed?.balance, { state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 },
    units: '-100', snapshot: payout, snapshotBalanceUnits: '9900' });
  for (const id of [unaffiliated, malformed]) {
    assert.equal((report.attempts.find(row => row.id === id)?.balance as { snapshot: unknown }).snapshot, null);
  }
  assert(!JSON.stringify(report).includes(privateField));
  await f.finish(job);
  await assert.rejects(f.read(job), { code: '42501' });
  const forbidden = await f.begin(real);
  await assert.rejects(f.read(forbidden), { code: '42501' });
  await f.operator.query(`SELECT ${f.schema}.audit_report_finish($1,'failed',0,0,'permission-denied')`, [forbidden]);
  await f.grant(f.alice, f.real);
  const otherSource = await f.begin(real);
  const payment = await f.read(otherSource);
  assert.equal(payment.status, 'found');
  assert.equal(payment.operation?.kind, 'deposit');
  assert.deepEqual(payment.linkedPostings, []);
  assert.deepEqual(payment.events, []);
  await f.finish(otherSource);
});

test('detail distinguishes uncaptured, unavailable and current mutable source after sealing', async t => {
  const f = await fixture(t);
  const id = randomUUID(), gameId = 'github-crash';
  await f.wallet.expansion.operate(f.actor, { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
  const [stake] = await f.sourceRows(id);
  const [old] = await f.sourceRows(f.before);
  const unavailable = await f.begin(old);
  assert.equal((await f.read(unavailable)).status, 'not-captured');
  await f.finish(unavailable);

  await f.operator.query('BEGIN');
  try {
    const uncommitted = await f.begin(stake);
    await assert.rejects(f.read(uncommitted), { code: '42501' });
  } finally {
    await f.operator.query('ROLLBACK');
  }
  const job = await f.begin(stake);
  const active = await f.read(job);
  assert.equal(active.operation?.kind, 'start');
  assert.equal(active.outcome?.state, 'active');
  assert.equal(active.outcome?.basis, 'current-source');
  await f.finish(job);
  await f.datasets.sealTest(f.scope.datasetId);

  const sealed = await f.begin(stake);
  const historical = await f.read(sealed);
  assert.equal(historical.operation?.kind, 'start');
  assert.equal(historical.outcome, null);
  assert.equal(historical.coverage.outcome, 'mutable-source-after-seal');
  await f.finish(sealed);
  const { datasetId: next } = await f.datasets.startTest();
  await f.grant(f.alice, f.demo, next);
  const cross = await f.begin(stake, f.operator, next);
  assert.equal((await f.read(cross)).status, 'not-captured');
  await f.finish(cross);

  await f.game.prepare('UPDATE demo_ledger SET operation_id=? WHERE id=?').run('damaged', stake.rowId);
  const damaged = await f.begin(stake);
  const gap = await f.read(damaged);
  assert.equal(gap.status, 'source-unavailable');
  assert.equal(gap.operation, null);
  assert.deepEqual(gap.attempts, []);
  await f.finish(damaged);
});

test('a high-repeat operation is capped with an explicit attempt coverage marker', async t => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.wallet.operate(f.actor, { id, kind: 'deposit', amount: 1 });
  const [source] = await f.sourceRows(id);
  const evidence = new AuditEvidence(f.audit, f.audit.schema), at = Date.now();
  for (let index = 0; index < 65; index++) {
    await evidence.record({
      schemaVersion: 1, scope: f.scope, type: 'attempt', occurredAtMs: at + index, attemptId: randomUUID(),
      accountId: f.actor, operationId: id, entity: null, route: '/api/demo-wallet/operations', transport: 'http',
      decision: 'unknown', response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' }, delivery: 'closed',
    });
  }
  const job = await f.begin(source);
  const report = await f.read(job);
  assert.equal(report.attempts.length, 64);
  assert.equal(report.coverage.attemptsTruncated, true);
  assert.deepEqual(report.attempts.map(row => row.occurredAtMs), Array.from({ length: 64 }, (_, index) => String(at + index)));
  await f.finish(job);
});
