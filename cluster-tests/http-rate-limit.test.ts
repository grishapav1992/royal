import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RedisRequestLimitStore, createHttpRateLimitRuntime, HttpRateLimits } from '../server/requestRateLimit';
import { temporaryRedis } from '../scripts/temporary-redis';

test('independent Redis clients atomically share quotas, keep TTL and retain limits across restarts', { timeout: 15000 }, async () => {
  const redis = await temporaryRedis(), prefix = 'royal:rate-test:' + randomUUID() + ':';
  const a = new RedisRequestLimitStore(redis.url, prefix), b = new RedisRequestLimitStore(redis.url, prefix);
  const replacement = new RedisRequestLimitStore(redis.url, prefix), separate = new RedisRequestLimitStore(redis.url, prefix + 'other:');
  try {
    await Promise.all([a.start(), b.start(), separate.start()]);
    const policy = { limit: 7, windowMs: 1000 };
    const decisions = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).consume('account', policy)));
    assert.equal(decisions.filter(d => d.allowed).length, 7);
    assert.equal(decisions.filter(d => !d.allowed).length, 43);
    assert.ok(decisions.every(d => d.retryAfterMs > 0 && d.retryAfterMs <= 1000));
    assert.equal((await b.consume('other-account', policy)).allowed, true);
    assert.equal((await separate.consume('account', policy)).allowed, true);
    a.close(); await replacement.start();
    assert.equal((await replacement.consume('account', policy)).allowed, false);
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal((await replacement.consume('account', policy)).allowed, true);
    await redis.stop();
    await assert.rejects(b.consume('account', policy));
  } finally { a.close(); b.close(); replacement.close(); separate.close(); await redis.cleanup(); }
});

test('runtime reuses cluster Redis and shares stable keys across API instances', { timeout: 15000 }, async () => {
  const redis = await temporaryRedis(), env = { REDIS_URL: redis.url, PUBLIC_ORIGIN: 'https://rate-' + randomUUID() + '.example.test' };
  const a = createHttpRateLimitRuntime(env), b = createHttpRateLimitRuntime(env);
  try {
    assert.equal(a.shared, true); assert.equal(b.shared, true);
    await Promise.all([a.start(), b.start()]);
    const handlerA = a.limits.account(), handlerB = b.limits.account();
    let allowed = 0, rejected = 0;
    const call = async (handler: typeof handlerA) => {
      const request: any = { method: 'POST', path: '/withdrawals' };
      const response: any = { locals: { accountId: 'shared-player' }, setHeader() {}, status(code: number) { assert.equal(code, 429); rejected++; return this; }, json() {} };
      await handler(request, response, () => { allowed++; });
    };
    await Promise.all(Array.from({ length: 30 }, (_, i) => call(i % 2 ? handlerA : handlerB)));
    assert.equal(allowed, 5); assert.equal(rejected, 25);
  } finally { a.close(); b.close(); await redis.cleanup(); }
});

test('IPv6 subnet and mapped IPv4 quotas remain shared across independent Redis clients', { timeout: 15000 }, async () => {
  const redis = await temporaryRedis(), prefix = 'royal:ipv6-test:' + randomUUID() + ':';
  const a = new RedisRequestLimitStore(redis.url, prefix), b = new RedisRequestLimitStore(redis.url, prefix);
  try {
    await Promise.all([a.start(), b.start()]);
    const policies = { ip: { limit: 2, windowMs: 60_000 }, ipBurst: { limit: 2, windowMs: 10_000 }, loginIp: { limit: 1, windowMs: 60_000 } };
    const limitsA = new HttpRateLimits(a, policies), limitsB = new HttpRateLimits(b, policies);
    const call = async (handler: ReturnType<HttpRateLimits['ip']>, ip: string, email = 'player@example.test') => {
      let status = 0;
      const req: any = { ip, method: 'GET', originalUrl: '/api/status', body: { email } };
      const res: any = { locals: {}, setHeader() {}, status(code: number) { status = code; return this; }, json() {} };
      await handler(req, res, () => { status = 200; });
      return status;
    };
    assert.equal(await call(limitsA.ip(), '2001:db8:1:1::1'), 200);
    assert.equal(await call(limitsB.ip(), '2001:0DB8:0001:0001:0000:0000:0000:0002'), 200);
    assert.equal(await call(limitsA.ip(), '2001:db8:1:1::ffff'), 429);
    assert.equal(await call(limitsB.ip(), '2001:db8:1:2::1'), 200);
    assert.equal(await call(limitsA.ip(), '192.0.2.1'), 200);
    assert.equal(await call(limitsB.ip(), '::ffff:c000:201'), 200);
    assert.equal(await call(limitsA.ip(), '::ffff:192.0.2.1'), 429);
    assert.equal(await call(limitsA.login(), '2001:db8:2:1::1', 'first@example.test'), 200);
    assert.equal(await call(limitsB.login(), '2001:db8:2:1::2', 'second@example.test'), 429);
    assert.equal(await call(limitsB.login(), '2001:db8:2:2::1', 'third@example.test'), 200);
  } finally { a.close(); b.close(); await redis.cleanup(); }
});
