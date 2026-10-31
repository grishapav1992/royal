import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { validProgressionSnapshot, validRewardSpinResult } from '../src/shared/progression';
import { CryptoError } from '../server/crypto/config';

process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { installProgression } = await import('../server/progressionRoutes');
test.after(async () => { await accounts.close(); });

test('authenticated progression HTTP ignores client scope, starts at one, grants paid milestones and retries reward receipts', { timeout: 45000 }, async () => {
  const app = express(); installProgression(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/progression`;
  const login = await accounts.login('progression-http-' + randomUUID() + '@example.test', 'Progression-http-test-42!');
  const headers = { Cookie: 'royal_session=' + login.token, 'X-Royal-Account-Id': login.account.id, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { ...headers, 'X-Royal-Account-Id': randomUUID() } })).status, 401);
    assert.equal((await fetch(base, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(base + '?locationId=another-location', { headers })).status, 400);
    let snapshot = await (await fetch(base, { headers })).json();
    assert(validProgressionSnapshot(snapshot)); assert.equal(snapshot.level, 1); assert.equal(snapshot.xp, '0'); assert.equal(snapshot.grants.length, 0);
    await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'deposit', amount: 1000 });
    snapshot = await (await fetch(base, { headers })).json(); assert.equal(snapshot.level, 1); assert.equal(snapshot.xp, '0');
    await accounts.wallet.operate(login.account.id, { id: randomUUID(), kind: 'play', amount: 100, gameId: 'royal-coins', rulesVersion: 1, input: {} });
    snapshot = await (await fetch(base, { headers })).json(); assert(validProgressionSnapshot(snapshot)); assert(snapshot.level >= 5);
    assert.equal(snapshot.grants.length, 1); const grant = snapshot.grants[0]; assert.equal(grant.poolId, 'royal-slots-v1');
    const operation = { id: randomUUID(), grantId: grant.id, gameId: 'royal-coins' };
    const post = (body: unknown) => fetch(base + '/spins', { method: 'POST', headers, body: JSON.stringify(body) });
    const before = await accounts.wallet.snapshot(login.account.id);
    assert.equal((await post({ ...operation, locationId: 'other' })).status, 400);
    assert.equal((await post({ ...operation, accountId: randomUUID() })).status, 400);
    assert.equal((await post({ ...operation, nominal: '100000000000' })).status, 400);
    assert.deepEqual(await accounts.wallet.snapshot(login.account.id), before);
    const accepted = await post(operation); assert.equal(accepted.status, 200); const result = await accepted.json();
    assert(validRewardSpinResult(result)); assert.equal(result.remaining, grant.count - 1); assert.equal(result.wallet.balance, before.balance + Number(result.gameRound.payoutUnits) / 100);
    const retried = await post(operation); assert.equal(retried.status, 200); const replay = await retried.json();
    assert.equal(replay.replayed, true); assert.deepEqual(replay.gameRound, result.gameRound); assert.equal(replay.wallet.balance, result.wallet.balance);
    const after = await (await fetch(base, { headers })).json(); assert.equal(after.xp, snapshot.xp); assert.equal(after.grants[0].remaining, grant.count - 1);
    const rejected = await post({ id: randomUUID(), grantId: randomUUID() }); assert.equal(rejected.status, 404); assert.equal((await rejected.json()).rejected, true);
    const check = accounts.financeAdmin.assertAllowed;
    accounts.financeAdmin.assertAllowed = async () => { throw new CryptoError(403, 'Новые операции временно заблокированы.'); };
    try {
      const old = await post(operation); assert.equal(old.status, 200); assert.equal((await old.json()).replayed, true);
      const blocked = await post({ id: randomUUID(), grantId: grant.id }); assert.equal(blocked.status, 403); assert.equal((await blocked.json()).rejected, true);
      const unchanged = await (await fetch(base, { headers })).json(); assert.equal(unchanged.grants[0].remaining, grant.count - 1);
    } finally { accounts.financeAdmin.assertAllowed = check; }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
