import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { accounts } from '../server/accounts';
import type { AuditAttemptObservation } from '../server/audit/attempts';
import { auditHttpAttempts } from '../server/audit/http-attempts';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { installDemoWallet } from '../server/demoWalletRoutes';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

test.after(async () => accounts.close());

test('HTTP audit distinguishes historical Mines and Flight settlement from a retry', async t => {
  const login = await accounts.login(randomUUID() + '@example.test', 'Royal-audit-legacy-42!');
  const accountId = login.account.id;
  t.after(() => accounts.logout(login.token));
  // Prepare already accepted rounds through the original engine, outside the current admission routes.
  const db = new PostgresDatabase(accounts.schema, { existingSchema: true });
  t.after(() => db.close());
  const historicalWallet = new DemoWalletStore(db, () => 0);
  await historicalWallet.operate(accountId, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const minesStart = { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 };
  const flightStart = { id: randomUUID(), action: 'start', amount: 10, autoCashout: 100 };
  await historicalWallet.mines.operate(accountId, minesStart);
  await historicalWallet.mines.operate(accountId, { id: randomUUID(), action: 'reveal', cell: 1, sessionId: minesStart.id });
  assert.equal((await historicalWallet.flight.operate(accountId, flightStart)).session?.state, 'active');

  const attempts: AuditAttemptObservation[] = [];
  const app = express();
  app.use(auditHttpAttempts(attempt => attempts.push(attempt), { gameSchema: accounts.schema }));
  installDemoWallet(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST', headers: { Cookie: 'royal_session=' + login.token, [WALLET_ACCOUNT_HEADER]: accountId,
      'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const minesPath = '/api/demo-wallet/mines';
  const retired = await post(minesPath, { ...minesStart, id: randomUUID() });
  assert.equal(retired.status, 409);
  await retired.json();
  assert.equal(attempts.at(-1)?.decision, 'rejected');
  const acceptedStart = await post(minesPath, minesStart);
  assert.equal(acceptedStart.status, 200);
  assert.equal((await acceptedStart.json()).session.id, minesStart.id);
  assert.equal(attempts.at(-1)?.decision, 'replayed');

  for (const [route, sessionId, keys] of [
    [minesPath, minesStart.id, ['session', 'wallet']],
    ['/api/demo-wallet/flight', flightStart.id, ['serverNow', 'session', 'wallet']],
  ] as const) {
    const cashout = { id: randomUUID(), action: 'cashout', sessionId };
    const replies = await Promise.all([post(route, cashout), post(route, cashout)]);
    const bodies = await Promise.all(replies.map(async reply => {
      assert.equal(reply.status, 200);
      const body = await reply.json();
      assert.deepEqual(Object.keys(body).sort(), keys);
      assert.equal(body.session.state, 'cashed_out');
      return body;
    }));
    assert.deepEqual(bodies[0].session, bodies[1].session);
    assert.deepEqual(bodies[0].wallet, bodies[1].wallet);
    const observed = attempts.filter(attempt => attempt.operationId === cashout.id);
    assert.deepEqual(observed.map(attempt => attempt.decision).sort(), ['accepted', 'replayed']);
    assert(observed.every(attempt => attempt.delivery === 'handed-off' && attempt.balance.state === 'value'));
    const rows = await db.prepare('SELECT entry_type FROM demo_ledger WHERE account_id=? AND operation_id=? ORDER BY id')
      .all(accountId, sessionId);
    assert.deepEqual(rows.map(row => row.entry_type), ['bet', 'win']);
  }
});
