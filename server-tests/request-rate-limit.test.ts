import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { HttpRateLimits, MemoryRequestLimitStore, createHttpRateLimitRuntime, normalizeRateLimitIp } from '../server/requestRateLimit';
import { accounts } from '../server/accounts';
import { installUsdtWallet } from '../server/usdtWalletRoutes';
import { installNileWallet } from '../server/nileWalletRoutes';
import { installCryptoWallet } from '../server/cryptoWalletRoutes';
import { installAuth } from '../server/authRoutes';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

after(async () => { await accounts.close(); });
async function serve(app: express.Express) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  return { origin, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('memory limits recover, isolate identities and bound retained state', async () => {
  let now = 0;
  const store = new MemoryRequestLimitStore(() => now, 2), policy = { limit: 2, windowMs: 1000 };
  assert.equal((await store.consume('a', policy)).allowed, true);
  assert.equal((await store.consume('a', policy)).allowed, true);
  now = 100;
  assert.deepEqual(await store.consume('a', policy), { allowed: false, retryAfterMs: 900 });
  assert.equal((await store.consume('b', policy)).allowed, true);
  assert.equal((await store.consume('c', policy)).allowed, false);
  now = 1100;
  assert.equal((await store.consume('c', policy)).allowed, true);
  assert.equal((await store.consume('a', policy)).allowed, true);
});

test('IP identities normalize IPv6 /64 and preserve distinct IPv4 addresses', () => {
  const expected = normalizeRateLimitIp('2001:db8:abcd:1234::1');
  for (const ip of ['2001:db8:abcd:1234::2', '2001:db8:abcd:1234:ffff:ffff:ffff:ffff', '2001:0DB8:ABCD:1234:0000:0000:0000:0001']) {
    assert.equal(normalizeRateLimitIp(ip), expected);
  }
  assert.notEqual(normalizeRateLimitIp('2001:db8:abcd:1235::1'), expected);
  assert.equal(normalizeRateLimitIp('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeRateLimitIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeRateLimitIp('::ffff:c000:0201'), '192.0.2.1');
  assert.notEqual(normalizeRateLimitIp('192.0.2.1'), normalizeRateLimitIp('192.0.2.2'));
});

test('changing IPv6 host addresses cannot reset minute, burst, login or callback budgets', async () => {
  let now = 0;
  const store = new MemoryRequestLimitStore(() => now);
  const limits = new HttpRateLimits(store, {
    ip: { limit: 2, windowMs: 60_000 }, ipBurst: { limit: 1, windowMs: 10_000 },
    loginIp: { limit: 1, windowMs: 60_000 }, callback: { limit: 1, windowMs: 60_000 },
  });
  const app = express(); app.set('trust proxy', 'loopback');
  app.use('/api', limits.ip());
  app.get('/api/status', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/login', express.json(), limits.login(), (_req, res) => res.json({ ok: true }));
  app.post('/api/crypto-wallet/ipn', (_req, res) => res.status(401).json({ error: 'signature' }));
  const server = await serve(app);
  const request = async (path: string, ip: string, email?: string) => {
    const response = await fetch(server.origin + path, { method: email !== undefined || path.endsWith('/ipn') ? 'POST' : 'GET',
      headers: { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }, body: email === undefined ? undefined : JSON.stringify({ email }) });
    const result = { status: response.status, retry: response.headers.get('retry-after') }; await response.arrayBuffer(); return result;
  };
  try {
    assert.equal((await request('/api/status', '2001:db8:1:1::1')).status, 200);
    assert.deepEqual(await request('/api/status', '2001:db8:1:1::2'), { status: 429, retry: '10' });
    now = 10_000;
    assert.equal((await request('/api/status', '2001:db8:1:1::ffff')).status, 200);
    now = 20_000;
    assert.deepEqual(await request('/api/status', '2001:db8:1:1::3'), { status: 429, retry: '40' });
    assert.equal((await request('/api/status', '2001:db8:1:2::1')).status, 200);
    now = 60_000;
    assert.equal((await request('/api/status', '2001:db8:1:1::4')).status, 200);

    assert.equal((await request('/api/auth/login', '2001:db8:2:1::1', 'a@example.test')).status, 200);
    now += 10_000;
    assert.equal((await request('/api/auth/login', '2001:db8:2:1::2', 'b@example.test')).status, 429);
    assert.equal((await request('/api/auth/login', '2001:db8:2:2::1', 'c@example.test')).status, 200);

    assert.equal((await request('/api/crypto-wallet/ipn', '2001:db8:3:1::1')).status, 401);
    assert.equal((await request('/api/crypto-wallet/ipn', '2001:db8:3:1::2')).status, 429);
    assert.equal((await request('/api/crypto-wallet/ipn', '2001:db8:3:2::1')).status, 401);
  } finally { await server.close(); }
});

test('IPv4-mapped addresses and malformed forwarded values cannot create fresh IP budgets', async () => {
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(), { ip: { limit: 1, windowMs: 60_000 } });
  const app = express(); app.set('trust proxy', 'loopback'); app.use('/api', limits.ip());
  app.get('/api/status', (_req, res) => res.json({ ok: true }));
  const server = await serve(app);
  const request = async (ip: string) => { const response = await fetch(server.origin + '/api/status', { headers: { 'X-Forwarded-For': ip } }); await response.arrayBuffer(); return response.status; };
  try {
    assert.equal(await request('192.0.2.1'), 200);
    assert.equal(await request('::ffff:c000:201'), 429);
    assert.equal(await request('192.0.2.2'), 200);
    assert.equal(await request('invalid-address-one'), 200);
    assert.equal(await request('invalid-address-two'), 429);
  } finally { await server.close(); }
});

test('IP gate precedes parsing and authentication and ignores untrusted forwarded identities', async () => {
  let now = 0, sessions = 0;
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(() => now), {
    ip: { limit: 2, windowMs: 1000 }, ipBurst: { limit: 10, windowMs: 1000 },
  });
  const app = express(); app.use('/api', limits.ip());
  app.use('/api', express.json({ limit: '2kb' }), (_req, res) => { sessions++; res.status(401).json({ error: 'session' }); });
  const server = await serve(app);
  try {
    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      const response = await fetch(server.origin + '/api/usdt-wallet', { headers: { 'X-Forwarded-For': ip } });
      assert.equal(response.status, 401); await response.arrayBuffer();
    }
    const denied = await fetch(server.origin + '/api/crypto-wallet/deposits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.3' }, body: '{' });
    assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '1');
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(await denied.json()), ['error']); assert.equal(sessions, 2);
    now = 1000;
    assert.equal((await fetch(server.origin + '/api/usdt-wallet')).status, 401); assert.equal(sessions, 3);
  } finally { await server.close(); }
});

test('IP bursts have a separate short window', async () => {
  let now = 0;
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(() => now), {
    ip: { limit: 100, windowMs: 60_000 }, ipBurst: { limit: 2, windowMs: 10_000 },
  });
  const app = express(); app.use('/api', limits.ip()); app.get('/api/status', (_req, res) => res.json({ ok: true }));
  const server = await serve(app);
  try {
    const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(server.origin + '/api/status')));
    assert.equal(responses.filter(r => r.status === 200).length, 2);
    assert.equal(responses.filter(r => r.status === 429).length, 10);
    assert.equal(responses.find(r => r.status === 429)!.headers.get('retry-after'), '10');
    await Promise.all(responses.map(r => r.arrayBuffer()));
    now = 10_000;
    assert.equal((await fetch(server.origin + '/api/status')).status, 200);
  } finally { await server.close(); }
});

test('signed callback budgets stay independent of browser IP exhaustion and remain bounded', async () => {
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(), {
    ip: { limit: 1, windowMs: 60_000 }, callback: { limit: 3, windowMs: 60_000 },
  });
  const app = express(); app.use('/api', limits.ip());
  app.use('/internal/payments/events', limits.ip());
  app.get('/api/status', (_req, res) => res.json({ ok: true }));
  app.post('/api/crypto-wallet/ipn', (_req, res) => res.status(401).json({ error: 'signature' }));
  app.post('/api/casinoapipro/wallet/credit', (_req, res) => res.status(401).json({ error: 'signature' }));
  app.post('/internal/payments/events', (_req, res) => res.status(401).json({ error: 'signature' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const server = await serve(app);
  try {
    assert.equal((await fetch(server.origin + '/api/status')).status, 200);
    assert.equal((await fetch(server.origin + '/api/status')).status, 429);
    assert.equal((await fetch(server.origin + '/internal/payments/events', { method: 'POST' })).status, 401);
    assert.equal((await fetch(server.origin + '/api/crypto-wallet/ipn?test=1', { method: 'POST' })).status, 401);
    assert.equal((await fetch(server.origin + '/API/CASINOAPIPRO/WALLET/CREDIT/', { method: 'POST' })).status, 401);
    assert.equal((await fetch(server.origin + '/api/crypto-wallet/ipn', { method: 'POST' })).status, 429);
    assert.equal((await fetch(server.origin + '/internal/payments/events', { method: 'POST' })).status, 429);
    assert.equal((await fetch(server.origin + '/healthz')).status, 200);
  } finally { await server.close(); }
});

test('USDT applies account quotas before parsing, counts malformed actions, recovers and isolates owners', async t => {
  let now = 0;
  const alice = randomUUID(), bob = randomUUID();
  t.mock.method(accounts, 'session', async token => token === 'alice' ? { account: { id: alice } } : token === 'bob' ? { account: { id: bob } } : undefined);
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(() => now), {
    read: { limit: 2, windowMs: 1000 }, funding: { limit: 2, windowMs: 1000 }, game: { limit: 2, windowMs: 1000 },
  });
  const app = express(); installUsdtWallet(app, '', limits); installNileWallet(app, '', limits); const server = await serve(app);
  const request = (path = '', token = 'alice', body?: string) => fetch(server.origin + '/api/usdt-wallet' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: 'royal_session=' + token, [WALLET_ACCOUNT_HEADER]: token === 'alice' ? alice : bob, 'Content-Type': 'application/json' }, body,
  });
  try {
    assert.equal((await request('', 'missing', '{')).status, 401);
    assert.equal((await request()).status, 200);
    assert.equal((await request('/casino-sessions')).status, 200);
    assert.equal((await request()).status, 429);
    assert.equal((await fetch(server.origin + '/api/nile-wallet', { headers: { Cookie: 'royal_session=alice' } })).status, 429);
    assert.equal((await request('', 'bob')).status, 200);
    assert.equal((await request('/deposit', 'alice', '{')).status, 400);
    assert.equal((await request('/deposit', 'alice', '{}')).status, 503);
    assert.equal((await request('/DEPOSIT/', 'alice', '{}')).status, 429);
    assert.equal((await request('/rounds', 'alice', '{}')).status, 400);
    assert.equal((await request('/casino-sessions', 'alice', '{}')).status, 400);
    assert.equal((await request('/rounds', 'alice', '{}')).status, 429);
    now = 1000;
    assert.equal((await request()).status, 200);
    assert.equal((await request('/deposit', 'alice', '{}')).status, 503);
  } finally { await server.close(); }
});

test('wallet route families share account counters; throttled withdrawals never reach the payment service', async () => {
  const id = randomUUID(); let withdrawals = 0, reads = 0;
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(), { withdrawal: { limit: 1, windowMs: 60_000 }, read: { limit: 1, windowMs: 60_000 } });
  const session = async () => ({ account: { id } });
  const store = { snapshot: async () => { reads++; return { ok: true }; }, currencies: async () => [], displayRate: async () => ({}),
    deposit: async () => ({}), quote: async () => ({}), withdraw: async () => { withdrawals++; return { ok: true }; },
    refresh: async () => ({}), receiveIpn: async () => ({}), play: async () => ({}) };
  const app = express(); installCryptoWallet(app, store, session, limits);
  // A second application route uses the same account budget, as another wallet would.
  app.use('/api/second-wallet', (_req, res, next) => { res.locals.accountId = id; next(); }, limits.account());
  app.get('/api/second-wallet', (_req, res) => res.json({ ok: true }));
  const server = await serve(app), headers = { [WALLET_ACCOUNT_HEADER]: id, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(server.origin + '/api/crypto-wallet', { headers })).status, 200);
    assert.equal((await fetch(server.origin + '/api/second-wallet')).status, 429); assert.equal(reads, 1);
    for (const [path, status] of [['/withdrawals', 200], ['/WITHDRAWALS/', 429]] as const) {
      assert.equal((await fetch(server.origin + '/api/crypto-wallet' + path, { method: 'POST', headers, body: '{}' })).status, status);
    }
    assert.equal(withdrawals, 1);
  } finally { await server.close(); }
});

test('shared-store failures reject requests instead of resetting financial limits', async () => {
  let reached = 0;
  const limits = new HttpRateLimits({ consume: async () => { throw new Error('Redis unavailable'); } });
  const app = express(); app.use('/api', limits.ip()); app.get('/api/wallet', (_req, res) => { reached++; res.json({ ok: true }); });
  const server = await serve(app);
  try {
    const response = await fetch(server.origin + '/api/wallet');
    assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '2'); assert.equal(reached, 0);
    assert.doesNotMatch(JSON.stringify(await response.json()), /Redis|stack/);
  } finally { await server.close(); }
});

test('login limits share normalized email identities and stop password work before it starts', async t => {
  let now = 0, passwordChecks = 0;
  const limits = new HttpRateLimits(new MemoryRequestLimitStore(() => now), { loginEmail: { limit: 2, windowMs: 1000 } });
  t.mock.method(accounts, 'login', async () => { passwordChecks++; return { token: 'test-token', account: { id: randomUUID(), email: 'player@example.test', name: 'Игрок', skin: null } }; });
  t.mock.method(accounts, 'logout', async () => {});
  const app = express(); installAuth(app, limits); const server = await serve(app);
  const login = (email: string) => fetch(server.origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-password' }) });
  try {
    assert.equal((await login('player@example.test')).status, 200);
    assert.equal((await login(' PLAYER@EXAMPLE.TEST ')).status, 200);
    assert.equal((await login('Player@example.test')).status, 429); assert.equal(passwordChecks, 2);
    now = 1000;
    assert.equal((await login('player@example.test')).status, 200); assert.equal(passwordChecks, 3);
  } finally { await server.close(); }
});

test('runtime rejects invalid limits and Redis URLs without revealing credentials', () => {
  assert.equal(createHttpRateLimitRuntime({}).shared, false);
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity']) assert.throws(() => createHttpRateLimitRuntime({ HTTP_RATE_LIMIT_IP_BURST: value }));
  assert.throws(() => createHttpRateLimitRuntime({ HTTP_RATE_LIMIT_REDIS_URL: 'https://secret-user:secret-password@example.test' }), error => !String(error).includes('secret-password'));
});
