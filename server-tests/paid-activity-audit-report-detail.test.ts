import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import type { AuditAttempt, AuditEvent, AuditSourceRef } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { installAuditReportAccess } from '../server/audit/report-access';
import { installAuditDetailReport, type AuditDetailReport } from '../server/audit/report-detail-source';
import { readAuditDetail } from '../server/audit/report-investigation';
import { exportAuditPlayer, type AuditDetailLookupFilters } from '../server/audit/report-player';
import { installAuditPlayerReport } from '../server/audit/report-player-source';
import { installAuditSummaryReport, type SummaryReport } from '../server/audit/report-summary-source';
import { cryptoConfig } from '../server/crypto/config';
import type { CryptoProvider } from '../server/crypto/nowpayments';
import { CryptoStore } from '../server/crypto/store';
import { databaseConfig, identifier, PostgresDatabase } from '../server/database';
import { DemoExpansionStore } from '../server/demoExpansion';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits } from '../server/demoWalletAmounts';
import { FlagToteStore } from '../server/flagTote';
import { cardEngine } from '../server/games/cardEngine';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { TOTE_TIMING } from '../src/shared/flagTote';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), payment = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  const clients: pg.Client[] = [];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const reader = 'audit_detail_reader_' + suffix, alice = 'audit_detail_alice_' + suffix;
  const bob = 'audit_detail_bob_' + suffix, password = randomUUID();
  await audit.exec(`CREATE ROLE ${identifier(reader)} NOLOGIN;
    CREATE ROLE ${identifier(alice)} LOGIN PASSWORD '${password}';
    CREATE ROLE ${identifier(bob)} LOGIN PASSWORD '${password}';
    GRANT ${identifier(reader)} TO ${identifier(alice)},${identifier(bob)};
    ALTER ROLE ${identifier(alice)} SET temp_file_limit='32MB';
    ALTER ROLE ${identifier(bob)} SET temp_file_limit='32MB'`);
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
  const config = (name: string) => databaseConfig({ ...process.env, DATABASE_URL: '', DATABASE_URL_FILE: '',
    PGUSER: name, PGPASSWORD: password, PGPASSWORD_FILE: '' });
  const login = async (name: string) => {
    const client = new pg.Client(config(name));
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
  const lookup = (filters: AuditDetailLookupFilters, selected = datasetId) =>
    readAuditDetail(config(alice), { schema: audit.schema, datasetId: selected, filters });
  const credentialFile = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'royal-detail-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const url = new URL('postgresql://localhost');
    url.hostname = process.env.PGHOST!;
    url.port = process.env.PGPORT!;
    url.pathname = '/' + process.env.PGDATABASE!;
    url.username = alice;
    url.password = password;
    const file = join(directory, 'operator-url');
    await writeFile(file, url.href, { mode: 0o600 });
    return file;
  };
  return { game, payment, audit, wallet, crypto, actor, other, before, datasets, scope, schema,
    demo, real, grant, reader, alice, operator, otherOperator, begin, read, finish, sourceRows, lookup, credentialFile, config };
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

test('registered casino mode agrees across detail, CSV and summary and rejects foreign settings', async t => {
  const f = await fixture(t);
  const sources = { game: f.game.schema, payments: f.payment.schema };
  await installAuditPlayerReport(f.audit, f.reader, sources);
  await installAuditSummaryReport(f.audit, f.reader, sources);
  const id = randomUUID(), gameId = 'studio-caramel-carnival', foreignMode = 'cosmic-chaos';
  await f.wallet.expansion.operate(f.actor, { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1,
    settings: { caramel: { mode: 'festival' } } });
  const [stake] = await f.sourceRows(id);
  const readAnchor = async () => {
    const job = await f.begin(stake);
    try {
      const detail = await f.read(job);
      assert.equal(detail.status, 'found');
      assert(detail.anchor);
      return detail.anchor;
    } finally {
      await f.finish(job);
    }
  };
  const accepted = await readAnchor();
  assert.deepEqual([accepted.category, accepted.gameId, accepted.modeId, accepted.rulesVersion, accepted.amountUnits],
    ['casino', gameId, 'festival', '2', '-350']);

  const fromMs = Number(accepted.occurredAtMs);
  const summary = async (modeId?: string) => {
    const filters = { category: 'casino', gameId, fromMs, toMs: fromMs + 1, modeId };
    const started = await f.operator.query<{ id: string }>(
      `SELECT ${f.schema}.audit_report_begin($1,'summary',$2::jsonb) AS id`,
      [f.scope.datasetId, JSON.stringify(filters)]);
    const job = started.rows[0].id;
    try {
      const result = await f.operator.query<{ report: SummaryReport }>(
        `SELECT ${f.schema}.audit_report_summary($1) AS report`, [job]);
      return result.rows[0].report;
    } finally {
      await f.finish(job);
    }
  };
  const rowsForFestival = (await summary('festival')).rows;
  assert.deepEqual(rowsForFestival.map(row => [row.movement_type, row.posting_count, row.amount_units]),
    [['paid-option', '1', '-350']]);

  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-mode-csv-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'player.csv');
  const csv = await exportAuditPlayer(f.config(f.alice), { schema: f.audit.schema, datasetId: f.scope.datasetId, destination,
    filters: { accountId: f.actor, category: 'casino', gameId, modeId: 'festival', fromMs, toMs: fromMs + 1 } });
  assert.equal(csv.rowCount, 1);
  assert((await readFile(destination, 'utf8')).includes(`"${id}","casino","${gameId}","festival","2","${id}"`));

  for (const settings of [{ caramel: { mode: 'unrecognized' }, luelon: { mode: foreignMode } }, 'malformed']) {
    await f.game.prepare(`UPDATE demo_casino_sessions
      SET payload=jsonb_set(payload::jsonb,'{settings}',?::jsonb)::text WHERE account_id=? AND id=?`)
      .run(JSON.stringify(settings), f.actor, id);
    const damaged = await readAnchor();
    assert.deepEqual([damaged.category, damaged.gameId, damaged.modeId, damaged.rulesVersion, damaged.amountUnits],
      ['casino', gameId, null, '2', '-350']);
    assert.deepEqual((await summary(foreignMode)).rows, []);
    assert.deepEqual((await summary('festival')).rows, []);
    assert.deepEqual((await summary()).rows.map(row => [row.posting_count, row.amount_units]), [['1', '-350']]);
  }
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

test('typed operation and instant round keep the original journal selector, source and account boundary', async t => {
  const f = await fixture(t);
  const id = randomUUID();
  for (const account of [f.actor, f.other]) {
    await f.wallet.operate(account, { id, kind: 'play', gameId: 'royal-roulette',
      input: { bet: 'black' }, rulesVersion: 1, stakePolicyVersion: 1, amount: 1 });
  }
  await f.crypto.creditStarsDeposit(f.actor, id, '1000000', randomUUID(), 100);
  const shared = { source: f.demo, lookupId: id };
  for (const lookupKind of ['operation', 'round'] as const) {
    const filters = { ...shared, lookupKind };
    const ambiguous = await f.lookup(filters);
    assert.equal(ambiguous.status, 'ambiguous-account');
    assert.deepEqual(ambiguous.selection, filters);
    assert.equal(ambiguous.source, null);
    assert.equal(ambiguous.anchor, null);
    assert(!JSON.stringify(ambiguous).includes(f.actor) && !JSON.stringify(ambiguous).includes(f.other));
  }

  const [stake, payout] = await f.sourceRows(id);
  const connection = await f.credentialFile();
  const { stdout } = await promisify(execFile)(process.execPath, ['--import','tsx','scripts/audit.ts','detail',
    '--schema',f.audit.schema,'--dataset',f.scope.datasetId,'--source',f.demo,'--round',id,'--account',f.actor], {
    cwd:fileURLToPath(new URL('..',import.meta.url)),env:{ ...process.env, ROYAL_AUDIT_DB_URL_FILE:connection },
  });
  const report = JSON.parse(stdout) as AuditDetailReport & { jobId: string };
  const filters = { ...shared, lookupKind: 'round', accountId: f.actor };
  assert.equal(report.status, 'found');
  assert.deepEqual(report.selection, filters);
  assert.deepEqual(report.source, stake);
  assert.deepEqual(report.linkedPostings.map(row => row.source), [payout]);
  assert.equal(report.outcome?.kind, 'casino-round');
  const journal = await f.audit.prepare('SELECT operator_name,kind,status,filters FROM audit_export_jobs WHERE id=?').get(report.jobId);
  assert.deepEqual(journal, { operator_name: f.alice, kind: 'detail', status: 'succeeded', filters });

  const unknown = await f.lookup({ ...shared, lookupKind: 'operation', accountId: randomUUID() });
  assert.equal(unknown.status, 'not-captured');
  assert.equal(unknown.source, null);
  const uncaptured = await f.lookup({ source: f.demo, lookupKind: 'operation', lookupId: f.before });
  assert.equal(uncaptured.status, 'not-captured');
  await assert.rejects(f.lookup({ source: f.real, lookupKind: 'operation', lookupId: id }), { code: 'permission-denied' });
  await f.grant(f.alice, f.real);
  const payment = await f.lookup({ source: f.real, lookupKind: 'operation', lookupId: id });
  assert.equal(payment.operation?.kind, 'deposit');
  assert.deepEqual(payment.linkedPostings, []);
  assert.equal((await f.lookup({ source: f.real, lookupKind: 'round', lookupId: id })).status, 'not-captured');

  await assert.rejects(f.operator.query(`SELECT ${f.schema}.audit_report_begin($1,'detail',$2::jsonb)`,
    [f.scope.datasetId, JSON.stringify({ ...filters, postingId: stake.rowId })]), { code: '22023' });
  const damagedId = randomUUID();
  await f.wallet.operate(f.actor, { id: damagedId, kind: 'deposit', amount: 1 });
  const [damagedPosting] = await f.sourceRows(damagedId);
  await f.game.prepare("UPDATE demo_ledger SET operation_id='damaged' WHERE id=?").run(damagedPosting.rowId);
  const damaged = await f.lookup({ source: f.demo, lookupKind: 'operation', lookupId: damagedId });
  assert.equal(damaged.status, 'source-unavailable');
  assert.deepEqual(damaged.source, damagedPosting);

  const crowded = randomUUID();
  await f.game.prepare(`INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type)
    SELECT ?,?,'deposit',1,1,?,100,100,'deposit' FROM generate_series(1,129)`).run(f.actor,crowded,Date.now());
  await assert.rejects(f.lookup({ source: f.demo, lookupKind: 'operation', lookupId: crowded, accountId: f.actor }), { code: 'scan-limit' });
});

test('typed round follows a captured continuation of a round proved at the opening checkpoint', async t => {
  const f = await fixture(t);
  let clock = Date.now();
  const store = new DemoExpansionStore(f.game, async account => ({ balance: await demoBalanceUnits(f.game, account) / 100, entries: [] }),
    f.wallet.ready, async () => {}, () => 0, () => clock, cardEngine, () => 2.3456);
  const id = randomUUID(), cashout = randomUUID(), gameId = 'github-crash';
  await store.operate(f.actor, { id, gameId, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings: {} });
  await f.datasets.sealTest(f.scope.datasetId);
  const next = await f.datasets.startTest();
  await f.grant(f.alice, f.demo, next.datasetId);
  clock += 4_000;
  await store.operate(f.actor, { id: cashout, gameId, action: 'move', sessionId: id, move: 'cashout' });
  const [credit] = await f.sourceRows(cashout);
  const lookup = { source: f.demo, lookupKind: 'round', lookupId: id } as const;
  const report = await f.lookup(lookup, next.datasetId);
  assert.equal(report.status, 'found');
  assert.deepEqual(report.source, credit);
  assert.equal(report.anchor?.entityId, id);
  assert.equal(report.operation?.id, cashout);
  assert.deepEqual(report.linkedPostings, []);
  assert.equal((await f.lookup({ ...lookup, lookupKind: 'operation' }, next.datasetId)).status, 'not-captured');
  assert.equal((await f.lookup({ ...lookup, accountId: f.other }, next.datasetId)).status, 'not-captured');
  const old = await f.lookup(lookup);
  assert.equal(old.status, 'found');
  assert.equal(old.outcome, null);
  assert.deepEqual(old.linkedPostings, []);
});

test('typed PvP match shows both captured participants or one explicit account', async t => {
  const f = await fixture(t);
  const ledger = new VirtualPvpLedger(f.game, f.wallet);
  const matchId = randomUUID();
  const terms = { matchId, gameId: 'chess', stakeUnits: '10000000' };
  for (const account of [f.actor, f.other]) await ledger.pvpHold(account, terms);
  await ledger.pvpFinish(f.actor, { matchId, winnerId: f.actor, reason: 'win' });
  const lookup = { source: f.demo, lookupKind: 'match', lookupId: matchId } as const;
  const match = await f.lookup(lookup);
  assert.equal(match.status, 'found');
  assert.equal(match.anchor?.entityId, matchId);
  assert.equal(match.coverage.linkedPostingScope, 'match');
  assert.equal(match.outcome?.winnerAccountId, f.actor);
  const legs = [match.anchor!, ...match.linkedPostings];
  assert.deepEqual(legs.map(row => [row.accountId, row.amountUnits]),
    [[f.actor,'-1000'], [f.other,'-1000'], [f.actor,'1900']]);
  for (const accountId of [f.actor, f.other]) {
    const found = await f.lookup({ ...lookup, accountId });
    assert.equal(found.status, 'found');
    assert.equal(found.anchor?.entityId, matchId);
    assert.equal(found.anchor?.accountId, accountId);
    assert.equal(found.outcome?.kind, 'pvp-bank');
    assert.equal(found.outcome?.accountWon, accountId === f.actor);
    assert(found.linkedPostings.every(row => row.accountId === accountId));
  }
});

test('typed ticket finds its own debit or the captured refund after an opening checkpoint', async t => {
  const f = await fixture(t);
  let clock = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period + 1;
  const pool = new FlagToteStore(f.game, id => f.wallet.snapshotInTransaction(id), f.wallet.ready, () => clock, () => 0);
  const { round } = await pool.snapshot(f.actor);
  assert(round);
  const id = randomUUID();
  await pool.bet(f.actor, { id, roundId: round.id, rulesVersion: 1, country: 'FR', stakeUnits: '100' });
  const lookup = { source: f.demo, lookupKind: 'ticket', lookupId: id } as const;
  const accepted = await f.lookup(lookup);
  assert.equal(accepted.status, 'found');
  assert.equal(accepted.anchor?.ticketId, id);
  assert.equal(accepted.operation?.id, id);
  assert.equal(accepted.anchor?.operationId, 'flag-tote:' + id);
  assert.equal((await f.lookup({ ...lookup, accountId: f.other })).status, 'not-captured');

  await f.datasets.sealTest(f.scope.datasetId);
  const next = await f.datasets.startTest();
  await f.grant(f.alice, f.demo, next.datasetId);
  clock = round.finishesAt;
  await pool.advance();
  const settled = await f.lookup(lookup, next.datasetId);
  assert.equal(settled.status, 'found');
  assert.equal(settled.anchor?.operationId, 'flag-tote:' + round.id + ':final');
  assert.equal(settled.anchor?.movement, 'refund');
  assert.equal(settled.operation?.id, id);
  assert.equal(settled.outcome?.state, 'refunded');
  assert.deepEqual(settled.linkedPostings, []);
  assert.equal((await f.lookup({ ...lookup, accountId: f.other }, next.datasetId)).status, 'not-captured');
});
