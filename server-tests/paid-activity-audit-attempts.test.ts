import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { defineRoom, defineServer } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PostgresDatabase } from '../server/database';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditAttemptRecorder, startAuditAttemptRuntime, type AuditAttemptObservation } from '../server/audit/attempts';
import { auditHttpAttempts } from '../server/audit/http-attempts';
import { AuditPostingReader } from '../server/audit/postings';
import { reconcileAuditBalance, reconcileStoredAuditAttempt } from '../server/audit/check-balances';
import { reconcileStoredAuditOperation } from '../server/audit/check-repeats';

process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { installDemoWallet } = await import('../server/demoWalletRoutes');
const { LobbyRoom, configureLobbyAuditAttempts } = await import('../server/LobbyRoom');
test.after(async () => accounts.close());

const observation = (at: number): AuditAttemptObservation => ({
  attemptId: randomUUID(), occurredAtMs: at, accountId: randomUUID(), operationId: randomUUID(), entity: null,
  transport: 'http', route: '/api/demo-wallet/operations', decision: 'unknown',
  response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' }, delivery: 'closed',
});

test('attempt queue is bounded and reports capture failures without awaiting database writes', async () => {
  const recorded: string[] = [], gaps: unknown[] = [], notices: number[] = [];
  let failing = true;
  const recorder = new AuditAttemptRecorder({ datasetId: randomUUID(), environment: 'test' }, {
    record: async value => {
      if (failing) throw new Error('database unavailable');
      recorded.push(value.attemptId);
    },
    gap: async value => {
      if (failing) throw new Error('database unavailable');
      gaps.push(value);
    },
  }, count => { notices.push(count); }, 2);
  recorder.record(observation(100));
  recorder.record(observation(200));
  recorder.record(observation(300));
  assert.deepEqual(recorded, []);
  assert.deepEqual(notices, [1]);
  await recorder.flush();
  assert.deepEqual(gaps, []);
  failing = false;
  const resumed = observation(400);
  recorder.record(resumed);
  await recorder.stop();
  assert.deepEqual(recorded, [resumed.attemptId]);
  assert.deepEqual(gaps, [{ count: 3, firstAtMs: 100, lastAtMs: 300 }]);
});

test('actual HTTP and WebSocket attempts persist independently of canonical postings in the selected test dataset', { timeout: 20_000 }, async t => {
  assert.equal(startAuditAttemptRuntime({}), undefined);
  await accounts.ready;
  const audit = new PostgresDatabase(':memory:');
  t.after(async () => audit.close());
  const login = await accounts.login('audit-attempt-' + randomUUID() + '@example.test', 'Audit-local-attempt-42!');
  await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const datasets = new AuditDatasets(audit, { game: accounts.schema });
  const { datasetId } = await datasets.startTest();
  const env = { ...process.env, ROYAL_AUDIT_SCHEMA: audit.schema, ROYAL_AUDIT_TEST_DATASET_ID: datasetId };
  const runtime = startAuditAttemptRuntime(env)!;
  let closed = false;
  t.after(async () => { if (!closed) await runtime.close(); });
  const app = express();
  app.use(auditHttpAttempts(runtime.record, { gameSchema: accounts.schema }));
  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = body => {
      if (req.get('x-fixture-response') === 'drop') {
        // Wallet handler has returned from the committed operation before attempting to send.
        res.destroy();
        return res;
      }
      if (req.get('x-fixture-response') === 'wrong') body.wallet.balance = -1;
      return send(body);
    };
    next();
  });
  installDemoWallet(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const headers = { Cookie: 'royal_session=' + login.token, 'X-Royal-Account-Id': login.account.id,
    'Content-Type': 'application/json' };
  const call = (path: string, op: unknown, fixture = '') => fetch('http://127.0.0.1:' + address.port + '/api/demo-wallet/' + path,
    { method: 'POST', headers: { ...headers, 'x-fixture-response': fixture }, body: JSON.stringify(op) });
  const core = { id: randomUUID(), kind: 'play', gameId: 'royal-plinko', amount: 0.1,
    input: { rows: 12, risk: 'easy' }, rulesVersion: 1, stakePolicyVersion: 1 };
  const expansion = { id: randomUUID(), action: 'start', gameId: 'github-crash', stakeUnits: '10',
    stakePolicyVersion: 1, settings: {} };
  await assert.rejects(call('operations', core, 'drop'));
  const expected: { operationId: string; units: string; decision: string }[] = [];
  for (const [route, op, decision] of [
    ['operations', core, 'replayed'],
    ['expansion', expansion, 'accepted'], ['expansion', expansion, 'replayed'],
  ] as const) {
    const reply = await call(route, op);
    assert.equal(reply.status, 200, JSON.stringify(await reply.clone().json()));
    const body = await reply.json() as { wallet: { balance: number } };
    expected.push({ operationId: op.id, units: String(Math.round(body.wallet.balance * 100)), decision });
  }
  const wrong = await call('operations', core, 'wrong');
  assert.equal(wrong.status, 200);
  assert.equal((await wrong.json() as { wallet: { balance: number } }).wallet.balance, -1);
  const rejected = await call('operations', { ...core, amount: 0.2 });
  assert.equal(rejected.status, 409);
  await rejected.text();

  await accounts.select(login.account.id, 0);
  configureLobbyAuditAttempts(runtime.record);
  t.after(() => configureLobbyAuditAttempts(undefined));
  const transport = new WebSocketTransport({ maxPayload: 8192, pingInterval: 0 });
  const realtime = defineServer({ transport, rooms: { lobby: defineRoom(LobbyRoom) }, greet: false, gracefullyShutdown: false });
  await realtime.listen(0, '127.0.0.1');
  const wsAddress = transport.server!.address();
  assert(wsAddress && typeof wsAddress !== 'string');
  const client = new Client('http://127.0.0.1:' + wsAddress.port, { headers: { Cookie: headers.Cookie } });
  const pvpId = randomUUID();
  try {
    const room = await client.create('lobby');
    room.reconnection.enabled = false;
    room.onMessage('*', () => {});
    const waitPvp = (direct: boolean) => new Promise<{ type: string; response: Record<string, unknown> }>((resolve, reject) => {
      const receive = (type: string, response: Record<string, unknown>) => {
        if (direct ? response?.requestId !== pvpId : response?.requestId !== undefined) return;
        finish();
        resolve({ type, response });
      };
      const off = room.onMessage('pvp', response => receive('pvp', response));
      const offError = room.onMessage('pvp-result', response => receive('pvp-result', response));
      const timer = setTimeout(() => { finish(); reject(new Error('Expected PvP message')); }, 5000);
      function finish() { clearTimeout(timer); off(); offError(); }
    });
    const sendPvp = (stakeUnits: string) => {
      const reply = waitPvp(true);
      room.send('pvp', { id: pvpId, action: 'create', gameId: 'chess', stakeUnits,
        targetId: null, walletScope: 'virtual-usdt-v1' });
      return reply;
    };
    try {
      assert.equal((await waitPvp(false)).type, 'pvp');
      const first = await sendPvp('1000000');
      assert.equal(first.type, 'pvp', String(first.response.error ?? ''));
      assert.ok(first.response.wallet);
      assert.equal(Object.hasOwn(first.response, 'replayed'), false);
      const repeated = await sendPvp('1000000');
      assert.equal(repeated.type, 'pvp', String(repeated.response.error ?? ''));
      assert.ok(repeated.response.wallet);
      assert.equal(Object.hasOwn(repeated.response, 'replayed'), false);
      const conflict = await sendPvp('2000000');
      assert.equal(conflict.type, 'pvp-result');
      assert.equal(conflict.response.rejected, true);
    } finally {
      if (room.connection.isOpen) await room.leave();
    }
  } finally {
    await realtime.gracefullyShutdown(false);
  }

  runtime.record({ ...observation(Date.now()), route: '/api/demo-wallet?invalid-observation=1' });
  await runtime.close();
  closed = true;
  const rows = (await audit.prepare(`SELECT payload FROM audit_evidence WHERE dataset_id=? AND kind='attempt'
    ORDER BY occurred_at_ms,evidence_id`).all(datasetId)).map(row => row.payload);
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.map(row => row.attemptId)).size, 9);
  assert.ok(rows.every(row => row.scope.datasetId === datasetId && row.scope.environment === 'test'));
  const lost = rows.find(row => row.delivery === 'closed');
  assert.equal(lost?.operationId, core.id);
  assert.equal(lost?.response, 'not-observed');
  assert.equal(lost?.decision, 'unknown');
  assert.ok(rows.filter(row => row !== lost).every(row => row.delivery === 'handed-off' && row.response === 'formed'));
  for (const { operationId, units, decision } of expected) {
    const matching = rows.find(row => row.operationId === operationId && row.decision === decision && row.balance.units === units);
    assert.ok(matching);
    assert.equal(matching.balance.snapshot.namespace, accounts.schema + '.demo_ledger');
  }
  assert.equal(rows.find(row => row.statusCode === 409)?.decision, 'rejected');
  const wsAttempts = rows.filter(row => row.transport === 'websocket');
  assert.equal(wsAttempts.length, 3);
  assert.ok(wsAttempts.every(row => row.operationId === pvpId && row.route === 'pvp' && row.statusCode === null));
  assert.deepEqual(wsAttempts.filter(row => row.balance.state === 'value').map(row => row.decision).sort(),
    ['accepted', 'replayed']);
  assert.equal(wsAttempts.filter(row => row.balance.state === 'absent' && row.decision === 'rejected').length, 1);
  const postings = await audit.prepare(`SELECT operation_id,count(*)::int AS count FROM audit_posting_refs
    WHERE dataset_id=? GROUP BY operation_id ORDER BY operation_id`).all(datasetId);
  assert.equal(postings.find(row => row.operation_id === core.id)?.count, 2);
  assert.ok(postings.find(row => row.operation_id === expansion.id)?.count >= 1);
  const holdCount = await audit.prepare(`SELECT count(*)::int AS count FROM audit_posting_refs
    WHERE dataset_id=? AND operation_id LIKE 'pvp:%:hold'`).get(datasetId);
  assert.equal(holdCount?.count, 1);
  const game = new PostgresDatabase(accounts.schema, { readOnly: true });
  t.after(async () => game.close());
  const reader = new AuditPostingReader(audit, game);
  const wrongAttempt = rows.find(row => row.balance.units === '-100');
  assert.equal(wrongAttempt?.decision, 'replayed');
  const mismatch = await reconcileStoredAuditAttempt(wrongAttempt, reader);
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.observedUnits, '-100');
  assert.notEqual(mismatch.expectedUnits, '-100');
  const correct = await reconcileStoredAuditAttempt(rows.find(row => row.operationId === core.id &&
    row.balance.units === expected[0].units), reader);
  assert.equal(correct.status, 'match');
  const sourceNamespace = accounts.schema + '.demo_ledger';
  const references = await audit.prepare(`SELECT source_row_id::text FROM audit_posting_refs
    WHERE dataset_id=? AND source_namespace=? AND account_id=? ORDER BY source_row_id`)
    .all(datasetId, sourceNamespace, login.account.id);
  const entries = [];
  for (const row of references) {
    const result = await reader.read(datasetId, { namespace: sourceNamespace, rowId: row.source_row_id });
    assert.equal(result.status, 'found');
    entries.push({ posting: result.posting });
  }
  const opening = await audit.prepare(`SELECT available_units::text FROM audit_opening_balances
    WHERE dataset_id=? AND source_namespace=? AND account_id=?`).get(datasetId, sourceNamespace, login.account.id);
  assert.equal(opening?.available_units, '10000');
  const balance = reconcileAuditBalance({ scope: { datasetId, environment: 'test' }, accountId: login.account.id,
    asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 }, sourceNamespace,
    component: 'available', openingUnits: opening.available_units, entries });
  assert.ok(balance.checks.length >= 4 && balance.checks.every(check => check.status === 'match'));
  const accountId = login.account.id;
  const repeats = await reconcileStoredAuditOperation(audit, accounts.schema,
    { datasetId, accountId, operationId: core.id, route: '/api/demo-wallet/operations' });
  assert.equal(repeats.status, 'match');
  assert.equal(repeats.money.postings.length, 2);
  assert.equal(repeats.attempts.filter(attempt => attempt.reason === 'same-accepted-intent').length, 3);
  assert.equal(repeats.attempts.filter(attempt => attempt.reason === 'different-intent-rejected').length, 1);
  assert.equal(repeats.attempts.find(attempt => attempt.attemptId === lost.attemptId)?.intent, 'same');
  const pvpRepeats = await reconcileStoredAuditOperation(audit, accounts.schema,
    { datasetId, accountId, operationId: pvpId, route: 'pvp' });
  assert.equal(pvpRepeats.money.reason, 'match-bank-check-required');
  assert.equal(pvpRepeats.attempts.filter(attempt => attempt.reason === 'same-accepted-intent').length, 2);
  assert.equal(pvpRepeats.attempts.filter(attempt => attempt.reason === 'different-intent-rejected').length, 1);
  assert.deepEqual(await audit.prepare('SELECT missing_count FROM audit_attempt_capture_gaps WHERE dataset_id=?').all(datasetId),
    [{ missing_count: 1 }]);
});
