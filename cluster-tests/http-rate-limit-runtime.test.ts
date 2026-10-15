import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { temporaryRedis, freeLocalPort } from '../scripts/temporary-redis';

test('two built API processes share IP limits and refuse API traffic when Redis is lost', { timeout: 30000 }, async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.PGDATABASE, 'royal_test');
  const redis = await temporaryRedis(), ports = [await freeLocalPort(), await freeLocalPort()];
  const children: ChildProcess[] = [];
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await done; } finally { clearTimeout(timer); }
  };
  try {
    for (const port of ports) children.push(spawn(process.execPath, ['dist-server/index.js'], {
      env: { ...process.env, PORT: String(port), AUTH_DB_PATH: 'rate_smoke_' + randomUUID().replaceAll('-', ''),
        REDIS_URL: '', LOBBY_WORKER_ID: '', LOBBY_WORKER_ONLY: 'false', PUBLIC_ORIGIN: 'http://rate-smoke.example.test',
        HTTP_RATE_LIMIT_REDIS_URL: redis.url, HTTP_RATE_LIMIT_IP_PER_MINUTE: '3', HTTP_RATE_LIMIT_IP_BURST: '100',
        NOWPAYMENTS_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false', PAYMENTS_SERVICE_URL: '',
        USDT_MAINNET_SOCKET_FILE: '', NILE_PLAY_SOCKET_FILE: '', NILE_WALLET_VIEW_FILE: '', CODEX_SALE_API_KEY: '' },
      stdio: 'ignore',
    }));
    const origins = ports.map(port => 'http://127.0.0.1:' + port);
    const deadline = Date.now() + 20_000;
    for (const [i, origin] of origins.entries()) {
      while (true) {
        assert.equal(children[i].exitCode, null, 'API process exited before readiness');
        try { if ((await fetch(origin + '/healthz')).status === 200) break; } catch { /* Wait for local startup. */ }
        assert.ok(Date.now() < deadline, 'API process did not become ready');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.equal((await fetch(origins[0] + '/api/usdt-wallet')).status, 401);
    assert.equal((await fetch(origins[1] + '/api/usdt-wallet')).status, 401);
    assert.equal((await fetch(origins[0] + '/api/demo-wallet')).status, 401);
    const limited = await fetch(origins[1] + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(limited.headers.get('cache-control'), 'no-store'); assert.deepEqual(Object.keys(await limited.json()), ['error']);
    assert.equal((await fetch(origins[0] + '/api/crypto-wallet/ipn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(origins[1] + '/internal/payments/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(origins[1] + '/')).status, 200);
    await redis.stop();
    assert.equal((await fetch(origins[0] + '/api/usdt-wallet')).status, 503);
    for (const origin of origins) assert.equal((await fetch(origin + '/healthz')).status, 200);
  } finally { await Promise.all(children.map(stop)); await redis.cleanup(); }
});
