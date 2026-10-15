import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import type { DemoWalletRequestLimitOptions } from '../server/demoWalletRequestLimit';

process.env.AUTH_DB_PATH = ':memory:';
const { accounts } = await import('../server/accounts');
const { installDemoWallet } = await import('../server/demoWalletRoutes');

async function serve(options?: DemoWalletRequestLimitOptions) {
  const app = express();
  installDemoWallet(app, options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

test('Originals HTTP rejects data theft, forged outcomes, excessive bodies and replay floods', { timeout: 25000 }, async t => {
  const alice = await accounts.login(`security-alice-${randomUUID()}@example.test`, 'Security-test-password!');
  const bob = await accounts.login(`security-bob-${randomUUID()}@example.test`, 'Security-test-password!');
  for (const owner of [alice, bob]) (await accounts.wallet.operate(owner.account.id, { id: randomUUID(), kind: 'deposit', amount: 1000 }));
  const headers = (owner = alice) => ({ Cookie: `royal_session=${owner.token}`, [WALLET_ACCOUNT_HEADER]: owner.account.id, 'Content-Type': 'application/json' });
  const server = await serve();
  const request = (path: string, body?: unknown, owner = alice, extra: Record<string, string> = {}) => fetch(server.origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers(owner), ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await t.test('cookie ownership and origin gates cover reads, instant games and every Mines action', async () => {
      const beforeAlice = (await accounts.wallet.snapshot(alice.account.id)), beforeBob = (await accounts.wallet.snapshot(bob.account.id));
      const operations = [
        { path: '/api/demo-wallet' }, { path: '/api/demo-wallet/mines' },
        { path: '/api/demo-wallet/operations', body: { id: randomUUID(), kind: 'play', gameId: 'royal-dice', rulesVersion: 1, amount: 10, input: { gameMode: 'rollUnder', sliderValue: 50 } } },
        { path: '/api/demo-wallet/mines', body: { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 } },
        { path: '/api/demo-wallet/mines', body: { id: randomUUID(), action: 'reveal', sessionId: randomUUID(), cell: 0 } },
        { path: '/api/demo-wallet/mines', body: { id: randomUUID(), action: 'cashout', sessionId: randomUUID() } },
      ];
      for (const item of operations) {
        for (const changes of [ { Cookie: '' }, { [WALLET_ACCOUNT_HEADER]: '' }, { [WALLET_ACCOUNT_HEADER]: bob.account.id } ] as Record<string,string>[]) {
          const response = await request(item.path, item.body, alice, changes);
          assert.equal(response.status, 401); await response.arrayBuffer();
        }
        for (const changes of [ { Origin: 'https://attacker.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' } ] as Record<string,string>[]) {
          const response = await request(item.path, item.body, alice, changes);
          assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.arrayBuffer();
        }
      }
      assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), beforeAlice);
      assert.deepEqual((await accounts.wallet.snapshot(bob.account.id)), beforeBob);
    });

    await t.test('client-selected payouts, SQL strings and prototype fields cannot change a balance', async () => {
      const before = (await accounts.wallet.snapshot(alice.account.id));
      const valid = { kind: 'play', gameId: 'royal-dice', rulesVersion: 1, amount: 10, input: { gameMode: 'rollUnder', sliderValue: 50 } };
      const malformed = [
        { ...valid, payout: 99999999 }, { ...valid, outcome: { won: true } },
        { ...valid, amount: -10 }, { ...valid, amount: 10.01 }, { ...valid, gameId: "royal-dice'; DROP TABLE accounts;--" },
        { ...valid, input: JSON.parse('{"gameMode":"rollUnder","sliderValue":50,"__proto__":{"polluted":true}}') },
        { ...valid, gameId: 'royal-keno', input: { picks: [1, 1], risk: 'classic' } },
        { ...valid, gameId: 'royal-keno', input: { picks: [41], risk: 'classic' } },
        { ...valid, gameId: 'royal-keno', input: { picks: ['<img src="https://attacker.example">'], risk: 'classic' } },
        { ...valid, gameId: 'royal-plinko', input: { rows: 17, risk: 'medium' } },
        { ...valid, gameId: 'royal-plinko', input: { rows: 12, risk: '__proto__' } },
        { ...valid, gameId: 'royal-limbo', input: { targetMultiplier: 1000000.01 } },
        { ...valid, gameId: 'royal-mines', input: {} },
      ];
      for (const operation of malformed) {
        const response = await request('/api/demo-wallet/operations', { id: randomUUID(), ...operation });
        assert.equal(response.status, 400); await response.arrayBuffer();
      }
      assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
      assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), before);
      assert.equal((await request('/api/demo-wallet')).status, 200);
    });

    await t.test('parser errors are bounded JSON without reflected input or server stack traces', async () => {
      for (const [body, status] of [['{"sensitive_test_marker":', 400], [JSON.stringify({ padding: 'x'.repeat(3000) }), 413]] as const) {
        const response = await fetch(server.origin + '/api/demo-wallet/mines', { method: 'POST', headers: headers(), body });
        assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(response.headers.get('content-type')!, /application\/json/);
        const text = await response.text();
        assert.equal(Object.keys(JSON.parse(text)).join(','), 'error');
        assert.doesNotMatch(text, /sensitive_test_marker|SyntaxError|node_modules|\/Users\/|at /);
      }
      const compressed = await fetch(server.origin + '/api/demo-wallet/mines', {
        method: 'POST', headers: { ...headers(), 'Content-Encoding': 'gzip' }, body: gzipSync(JSON.stringify({ padding: 'x'.repeat(100000) })),
      });
      assert.equal(compressed.status, 415, 'Compressed wallet requests are rejected before decompression');
      assert.equal(Object.keys(await compressed.json()).join(','), 'error');
    });

    await t.test('a foreign account cannot recover a field and parallel replay never charges twice', async () => {
      const start = { id: randomUUID(), action: 'start', amount: 10, mineCount: 1 };
      const responses = await Promise.all(Array.from({ length: 6 }, () => request('/api/demo-wallet/mines', start)));
      const results = await Promise.all(responses.map(async response => { assert.equal(response.status, 200); return response.json(); }));
      for (const result of results) {
        assert.equal(result.session.state, 'active'); assert.equal(result.wallet.balance, 990);
        assert.doesNotMatch(JSON.stringify(result), /mineCells|mine_cells/);
      }
      const replay = await request('/api/demo-wallet/mines', { ...start, mineCount: 2 });
      assert.equal(replay.status, 409); await replay.arrayBuffer();
      for (const action of ['reveal', 'cashout']) {
        const response = await request('/api/demo-wallet/mines', { id: randomUUID(), action, sessionId: start.id, ...(action === 'reveal' ? { cell: 0 } : {}) }, bob);
        assert.equal(response.status, 404); await response.arrayBuffer();
      }
      const other = await request('/api/demo-wallet/mines', undefined, bob);
      assert.deepEqual((await other.json()).session, null);
      const invalidCashout = await request('/api/demo-wallet/mines', { id: randomUUID(), action: 'cashout', sessionId: start.id });
      assert.equal(invalidCashout.status, 400); await invalidCashout.arrayBuffer();
      assert.equal((await (await accounts.wallet.snapshot(alice.account.id)).entries.filter(entry => entry.operationId === start.id && entry.kind === 'bet')).length, 1);
      assert.equal((await accounts.wallet.snapshot(bob.account.id)).balance, 1000);
    });

    await t.test('reads, rejected JSON and replay all consume one account budget, then recover without another debit', async () => {
      let now = 0;
      const limited = await serve({ limit: 3, windowMs: 1000, now: () => now });
      try {
        const before = (await accounts.wallet.snapshot(alice.account.id));
        const active = (await accounts.wallet.mines.active(alice.account.id)).session!;
        const requestTo = (path: string, body?: string, owner = alice) => fetch(limited.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: headers(owner), body });
        assert.equal((await requestTo('/api/demo-wallet')).status, 200);
        const replay = JSON.stringify({ id: active.id, action: 'start', amount: active.amount, mineCount: active.mineCount });
        assert.equal((await requestTo('/api/demo-wallet/mines', replay)).status, 200);
        assert.equal((await requestTo('/api/demo-wallet/mines', '{')).status, 400);
        const throttled = await requestTo('/api/demo-wallet/mines', replay);
        assert.equal(throttled.status, 429); assert.equal(throttled.headers.get('retry-after'), '1'); await throttled.arrayBuffer();
        assert.equal((await requestTo('/api/demo-wallet', undefined, bob)).status, 200);
        now = 1000;
        assert.equal((await requestTo('/api/demo-wallet/mines', replay)).status, 200);
        assert.deepEqual((await accounts.wallet.snapshot(alice.account.id)), before);
      } finally { await limited.close(); }
    });

    await t.test('limiter memory is bounded and expiry releases capacity for another account', async () => {
      let now = 0;
      const bounded = await serve({ maxAccounts: 1, windowMs: 1000, now: () => now });
      try {
        const get = (owner: typeof alice) => fetch(bounded.origin + '/api/demo-wallet', { headers: headers(owner) });
        assert.equal((await get(alice)).status, 200);
        assert.equal((await get(bob)).status, 429);
        now = 1000;
        assert.equal((await get(bob)).status, 200);
      } finally { await bounded.close(); }
    });
  } finally {
    await server.close(); (await accounts.close());
  }
});
