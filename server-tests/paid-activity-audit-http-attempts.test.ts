import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import express, { type Application } from 'express';
import { accounts } from '../server/accounts';
import type { AuditAttemptObservation } from '../server/audit/attempts';
import { reconcileStoredAuditOperation } from '../server/audit/check-repeats';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { auditHttpAttempts } from '../server/audit/http-attempts';
import { auditCommandRoutes } from '../server/audit/intents';
import { installClubFineRoutes } from '../server/clubFineRoutes';
import { PostgresDatabase } from '../server/database';
import { installDemoWallet } from '../server/demoWalletRoutes';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

function collector() {
  const signal = new EventEmitter();
  const attempts: AuditAttemptObservation[] = [];
  return {
    attempts,
    record: (observation: AuditAttemptObservation) => {
      attempts.push(observation);
      signal.emit('attempt', observation);
    },
    next: async (): Promise<AuditAttemptObservation> => (await once(signal, 'attempt'))[0],
  };
}

async function serve(app: Application, scenario: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    await scenario('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

test.after(async () => accounts.close());

test('real club-fine attempts link the committed debit and distinguish business rejection from payment and replay', async t => {
  const login = await accounts.login(randomUUID() + '@example.test', 'Royal-audit-fine-42!');
  const accountId = login.account.id;
  t.after(() => accounts.logout(login.token));
  await accounts.wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const { outcome: { sanction } } = await accounts.clubSanctions.recordViolation(accountId,
    { id: randomUUID(), reason: 'spam' });
  const audit = new PostgresDatabase(':memory:');
  t.after(() => audit.close());
  const { datasetId, environment } = await new AuditDatasets(audit, { game: accounts.schema }).startTest();
  const observer = collector(), evidence = new AuditEvidence(audit, audit.schema);
  const app = express();
  app.use(auditHttpAttempts(observer.record, { gameSchema: accounts.schema }));
  installDemoWallet(app);
  installClubFineRoutes(app);
  const quote = { id: randomUUID(), sanctionId: sanction.id, revision: sanction.revision, amountCents: sanction.amountCents };
  const operationId = 'club-fine:' + quote.id;
  await serve(app, async base => {
    const headers = { Cookie: 'royal_session=' + login.token, [WALLET_ACCOUNT_HEADER]: accountId };
    const scenarios = [
      { body: { ...quote, revision: quote.revision + 1 }, status: 'changed', decision: 'rejected' },
      { body: { ...quote, id: quote.id.toUpperCase(), sanctionId: quote.sanctionId.toUpperCase() }, status: 'paid', decision: 'accepted' },
      { body: quote, status: 'paid', decision: 'replayed' },
      { body: { ...quote, amountCents: quote.amountCents + 1 }, status: 'id-conflict', decision: 'rejected' },
    ];
    for (const scenario of scenarios) {
      const observation = observer.next();
      const reply = await post(base, auditCommandRoutes.fine, scenario.body, headers);
      assert.equal(reply.status, 200);
      assert.equal((await reply.json()).status, scenario.status);
      const attempt = await observation;
      assert.equal(attempt.operationId, operationId);
      assert.equal(attempt.decision, scenario.decision);
      assert.equal(attempt.delivery, 'handed-off');
      assert.deepEqual(attempt.balance, { state: 'absent' });
      assert(attempt.intentFingerprint);
      await evidence.record({ ...attempt, scope: { datasetId, environment }, schemaVersion: 1, type: 'attempt' });
    }
  });
  const source = { datasetId, accountId, operationId, route: auditCommandRoutes.fine };
  const result = await reconcileStoredAuditOperation(audit, accounts.schema, source);
  assert.equal(result.status, 'match');
  assert.deepEqual(result.command, {
    namespace: accounts.schema + '.club_fine_payments', rowId: JSON.stringify([accountId, quote.id]),
  });
  assert.equal(result.money.reason, 'single-fine-debit');
  assert.equal(result.money.postings.length, 1);
  assert.equal(result.duplicateAcceptedDecision, false);
  assert.deepEqual(observer.attempts.map(attempt => result.attempts.find(item => item.attemptId === attempt.attemptId)?.reason),
    ['different-intent-rejected', 'same-accepted-intent', 'same-accepted-intent', 'different-intent-rejected']);
  await accounts.db.prepare('UPDATE club_fine_payments SET amount_cents=amount_cents+1 WHERE account_id=? AND operation_id=?')
    .run(accountId, quote.id);
  assert.equal((await reconcileStoredAuditOperation(audit, accounts.schema, source)).money.reason, 'fine-debit-mismatch');
});

test('real wallet routes distinguish typed decisions and capture a formed lost reply without a second debit', async () => {
  const login = await accounts.login(randomUUID() + '@example.test', 'Royal-audit-http-42!');
  const accountId = login.account.id;
  await accounts.wallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const observer = collector();
  const app = express();
  app.use(auditHttpAttempts(observer.record, { gameSchema: accounts.schema }));
  app.use((req, res, next) => {
    if (req.get('x-fixture-close-after-form') === '1') {
      res.end = function () { this.destroy(); return this; };
    }
    next();
  });
  installDemoWallet(app);
  await serve(app, async base => {
    const headers = { Cookie: 'royal_session=' + login.token, [WALLET_ACCOUNT_HEADER]: accountId };
    const instant = {
      id: randomUUID(), kind: 'play', gameId: 'royal-roulette', amount: 0.1, rulesVersion: 1,
      stakePolicyVersion: 1, input: { bet: 'black' },
    };
    const unauthenticated = await post(base, '/api/demo-wallet/operations', instant, { [WALLET_ACCOUNT_HEADER]: accountId });
    assert.equal(unauthenticated.status, 401);
    await unauthenticated.text();
    assert.equal(observer.attempts.length, 0);

    const closedObservation = observer.next();
    await assert.rejects(post(base, '/api/demo-wallet/operations', instant, { ...headers, 'x-fixture-close-after-form': '1' }));
    const closed = await closedObservation;
    assert.equal(closed.accountId, accountId);
    assert.equal(closed.operationId, instant.id);
    assert.equal(closed.decision, 'accepted');
    assert.equal(closed.response, 'formed');
    assert.equal(closed.delivery, 'closed');
    assert.equal(closed.statusCode, 200);
    assert.equal(closed.balance.state, 'value');

    const retryObservation = observer.next();
    const retry = await post(base, '/api/demo-wallet/operations', instant, headers);
    assert.equal(retry.status, 200);
    const retryBody = await retry.json();
    assert.deepEqual(Object.keys(retryBody).sort(), ['gameRound', 'wallet']);
    const handedOff = await retryObservation;
    assert.equal(handedOff.operationId, instant.id);
    assert.notEqual(handedOff.attemptId, closed.attemptId);
    assert.equal(handedOff.decision, 'replayed');
    assert.equal(handedOff.delivery, 'handed-off');
    assert.equal(handedOff.balance.state, 'value');
    const instantRows = await accounts.db.prepare(`SELECT id::text,entry_type,amount_units::text FROM demo_ledger
      WHERE account_id=? AND operation_id=? ORDER BY id`).all(accountId, instant.id);
    assert.deepEqual(instantRows.map(row => [row.entry_type, row.amount_units]),
      [['bet', '-10'], ['win', retryBody.gameRound.payoutUnits]]);
    assert.deepEqual(handedOff.balance.snapshot, {
      namespace: accounts.schema + '.demo_ledger', rowId: instantRows[1].id,
    });

    const session = {
      id: randomUUID(), gameId: 'flag-battle', action: 'start', stakeUnits: '10', stakePolicyVersion: 1,
      settings: { flags: { country: 'RU', mode: 'classic' } },
    };
    for (const decision of ['accepted', 'replayed'] as const) {
      const observed = observer.next();
      const reply = await post(base, '/api/demo-wallet/expansion', session, { ...headers, 'X-Royal-Flag-Battle': '2', 'X-Royal-Card-Rules': '2' });
      assert.equal(reply.status, 200, await reply.clone().text());
      await reply.json();
      const attempt = await observed;
      assert.equal(attempt.decision, decision);
      assert.equal(attempt.operationId, session.id);
      assert.equal(attempt.delivery, 'handed-off');
      assert.equal(attempt.balance.state, 'value');
    }
    const bad = { ...instant, id: randomUUID(), amount: -1 };
    const rejectObservation = observer.next();
    const rejection = await post(base, '/api/demo-wallet/operations', bad, headers);
    assert.equal(rejection.status, 400);
    await rejection.json();
    const rejected = await rejectObservation;
    assert.equal(rejected.operationId, bad.id);
    assert.equal(rejected.decision, 'rejected');
    assert.equal(rejected.balance.state, 'absent');
    assert.equal(observer.attempts.length, 5);
  });
});

test('observer records the serialized balance, sanitized IDs and only static authorized route templates', async () => {
  const accountId = randomUUID(), operationId = randomUUID(), refreshId = randomUUID();
  const secret = 'fixture-secret-never-record';
  const observer = collector();
  const app = express();
  app.use(auditHttpAttempts(observer.record, { gameSchema: 'royal_game' }), express.json());
  app.use((_req, res, next) => { res.locals.accountId = accountId; next(); });
  app.set('json replacer', (key: string, value: unknown) => key === 'balance' ? '-1.0000' : key === 'id' ? 999 : value);
  app.post('/api/demo-wallet/operations', (_req, res) => {
    res.json({ wallet: { balance: 302.16, pendingBalance: secret, entries: [{ id: 42, signature: secret }] },
      replayed: false, privateData: secret });
  });
  app.get('/api/demo-wallet/operations', (_req, res) => { res.json({ wallet: { balance: 302.16 } }); });
  app.post('/api/demo-wallet/debug', (_req, res) => { res.json({ wallet: { balance: 302.16 } }); });
  app.post('/api/crypto-wallet/operations/:id/refresh', (_req, res) => {
    res.json({ wallet: { asset: 'USDT', scale: 6, balanceUnits: '-302160000' } });
  });
  app.post('/api/demo-wallet/flight', (_req, res) => {
    res.type('application/json').send('{"wallet":{"balance":1.000000000000000001}}');
  });
  app.post('/api/demo-wallet/mines', (_req, res) => { res.status(503).json({ error: secret }); });
  app.post('/api/progression/spins', (_req, res) => { res.status(503).json({ rejected: true, error: secret }); });

  await serve(app, async base => {
    const wireObservation = observer.next();
    const response = await post(base, '/api/demo-wallet/operations?unlogged=' + secret,
      { id: operationId, privateData: secret }, { 'X-Ignored-Fixture': secret });
    assert.equal((await response.json()).wallet.balance, '-1.0000');
    const wire = await wireObservation;
    assert.deepEqual(wire.balance, {
      state: 'value', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 }, units: '-100',
      snapshot: { namespace: 'royal_game.demo_ledger', rowId: '42' },
    });
    assert.equal(wire.route, '/api/demo-wallet/operations');
    assert.equal(wire.operationId, operationId);
    assert.equal(wire.entity, null);
    assert.equal(JSON.stringify(wire).includes(secret), false);

    const refreshObservation = observer.next();
    await (await post(base, '/api/crypto-wallet/operations/' + refreshId + '/refresh', { id: operationId })).json();
    const refresh = await refreshObservation;
    assert.equal(refresh.route, '/api/crypto-wallet/operations/:id/refresh');
    assert.equal(refresh.operationId, refreshId);
    assert.deepEqual(refresh.balance, {
      state: 'value', asset: { contour: 'real', code: 'USDT', scale: 6 }, units: '-302160000',
      snapshot: null,
    });

    const invalidObservation = observer.next();
    await (await post(base, '/api/demo-wallet/flight', { id: secret })).json();
    const invalid = await invalidObservation;
    assert.equal(invalid.operationId, null);
    assert.deepEqual(invalid.balance, { state: 'invalid' });

    for (const [path, decision] of [
      ['/api/demo-wallet/mines', 'unknown'],
      ['/api/progression/spins', 'rejected'],
    ]) {
      const failedObservation = observer.next();
      assert.equal((await post(base, path, { id: operationId })).status, 503);
      const failure = await failedObservation;
      assert.equal(failure.decision, decision);
      assert.equal(JSON.stringify(failure).includes(secret), false);
    }
    await (await fetch(base + '/api/demo-wallet/operations')).json();
    await (await post(base, '/api/demo-wallet/debug', { id: operationId })).json();
    assert.equal(observer.attempts.length, 5);
  });
});

test('a closed socket before any formed reply records absence of response evidence', async () => {
  const accountId = randomUUID(), id = randomUUID(), observer = collector();
  const acceptedByHandler = new EventEmitter();
  const app = express();
  app.use(auditHttpAttempts(observer.record), express.json());
  app.post('/api/demo-wallet/mines', (_req, res) => {
    res.locals.accountId = accountId;
    acceptedByHandler.emit('waiting');
  });
  await serve(app, async base => {
    const waiting = once(acceptedByHandler, 'waiting');
    const observation = observer.next();
    const client = httpRequest(base + '/api/demo-wallet/mines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    client.on('error', () => {});
    client.end(JSON.stringify({ id }));
    await waiting;
    client.destroy();
    const attempt = await observation;
    assert.equal(attempt.accountId, accountId);
    assert.equal(attempt.operationId, id);
    assert.equal(attempt.decision, 'unknown');
    assert.equal(attempt.delivery, 'closed');
    assert.equal(attempt.response, 'not-observed');
    assert.equal(attempt.statusCode, null);
    assert.deepEqual(attempt.balance, { state: 'not-recorded' });
    assert.equal(observer.attempts.length, 1);
  });
});

test('observer failure does not alter the original HTTP reply', async () => {
  const app = express();
  app.use(auditHttpAttempts(() => { throw new Error('diagnostics are unavailable'); }));
  app.post('/api/demo-wallet/flight', (_req, res) => {
    res.locals.accountId = randomUUID();
    res.status(503).json({ error: 'original response' });
  });
  await serve(app, async base => {
    const response = await post(base, '/api/demo-wallet/flight', {});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'original response' });
  });
});
