import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import ipaddr from 'ipaddr.js';
import type { Request, RequestHandler } from 'express';

export type RatePolicy = { limit: number; windowMs: number };
export type RateDecision = { allowed: boolean; retryAfterMs: number };
export interface RequestLimitStore {
  consume(key: string, policy: RatePolicy): Promise<RateDecision>;
}

export class MemoryRequestLimitStore implements RequestLimitStore {
  private windows = new Map<string, { count: number; until: number }>();
  private nextCleanup = 0;
  constructor(private now: () => number = Date.now, private maxKeys = 50_000) {
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new Error('Invalid rate limit capacity');
  }
  async consume(key: string, policy: RatePolicy): Promise<RateDecision> {
    const now = this.now();
    if (now >= this.nextCleanup) {
      for (const [id, entry] of this.windows) if (entry.until <= now) this.windows.delete(id);
      this.nextCleanup = now + 1000;
    }
    let entry = this.windows.get(key);
    if (!entry || entry.until <= now) {
      if (!entry && this.windows.size >= this.maxKeys) return { allowed: false, retryAfterMs: 1000 };
      entry = { count: 0, until: now + policy.windowMs };
      this.windows.set(key, entry);
    }
    if (entry.count >= policy.limit) return { allowed: false, retryAfterMs: entry.until - now };
    entry.count++;
    return { allowed: true, retryAfterMs: entry.until - now };
  }
}

// Increment and expiry are one atomic operation, including across API processes.
const CONSUME = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if count > 0 and ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
if count >= tonumber(ARGV[1]) then return {0, math.max(1, ttl)} end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {1, redis.call('PTTL', KEYS[1])}
`;

export class RedisRequestLimitStore implements RequestLimitStore {
  private client: Redis;
  constructor(url: string, private prefix: string) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Invalid HTTP rate limit Redis configuration'); }
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname || parsed.hash) throw new Error('Invalid HTTP rate limit Redis configuration');
    this.client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
      connectTimeout: 2000, commandTimeout: 500, retryStrategy: () => 500 });
    // Credentials and connection URLs must not enter application logs.
    this.client.on('error', () => {});
  }
  async start() { await this.client.connect(); }
  close() { this.client.disconnect(); }
  async consume(key: string, policy: RatePolicy): Promise<RateDecision> {
    const result = await this.client.eval(CONSUME, 1, this.prefix + key, policy.limit, policy.windowMs) as number[];
    if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || !Number.isFinite(result[1])) throw new Error('Invalid rate limit response');
    return { allowed: result[0] === 1, retryAfterMs: Math.max(1, result[1]) };
  }
}

export const HTTP_RATE_POLICIES = {
  ip: { limit: 1800, windowMs: 60_000 },
  ipBurst: { limit: 180, windowMs: 10_000 },
  callback: { limit: 6000, windowMs: 60_000 },
  callbackBurst: { limit: 600, windowMs: 10_000 },
  wallet: { limit: 240, windowMs: 60_000 },
  read: { limit: 120, windowMs: 60_000 },
  game: { limit: 180, windowMs: 60_000 },
  funding: { limit: 20, windowMs: 60_000 },
  withdrawal: { limit: 5, windowMs: 60_000 },
  refresh: { limit: 30, windowMs: 60_000 },
  crypto: { limit: 60, windowMs: 60_000 },
  demo: { limit: 240, windowMs: 60_000 },
  loginIp: { limit: 80, windowMs: 900_000 },
  loginEmail: { limit: 10, windowMs: 900_000 },
} satisfies Record<string, RatePolicy>;
type PolicyName = keyof typeof HTTP_RATE_POLICIES;
type Charge = { policy: PolicyName; identity: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function normalizeRateLimitIp(ip: string): string {
  // IPv4-mapped IPv6 shares the IPv4 budget, regardless of address notation.
  const address = ipaddr.process(ip);
  if (address.kind() === 'ipv4') return address.toString();
  const bytes = address.toByteArray();
  // Rotating interface addresses inside one IPv6 /64 cannot reset the budget.
  bytes.fill(0, 8);
  return ipaddr.fromByteArray(bytes).toString() + '/64';
}

function clientIpIdentity(req: Request): string {
  for (const ip of [req.ip, req.socket?.remoteAddress]) {
    if (!ip) continue;
    try { return normalizeRateLimitIp(ip); } catch { /* Invalid forwarded values use the socket peer. */ }
  }
  return 'unknown';
}
const isCallback = (req: Request) => {
  const path = req.originalUrl.split('?')[0].toLowerCase();
  return req.method === 'POST' && (/^\/api\/crypto-wallet\/ipn\/?$/.test(path)
    || /^\/api\/casinoapipro\/wallet\/(balance|debit|credit|refund|rollback)\/?$/.test(path)
    || /^\/internal\/payments\/events\/?$/.test(path));
};

export class HttpRateLimits {
  private policies: typeof HTTP_RATE_POLICIES;
  constructor(private store: RequestLimitStore = new MemoryRequestLimitStore(), overrides: Partial<Record<PolicyName, RatePolicy>> = {}) {
    this.policies = { ...HTTP_RATE_POLICIES, ...overrides };
    for (const policy of Object.values(this.policies)) {
      if (!Number.isSafeInteger(policy.limit) || policy.limit < 1 || !Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) throw new Error('Invalid HTTP rate limit policy');
    }
  }
  private gate(charges: (req: Request, accountId: string) => Charge[]): RequestHandler {
    return async (req, res, next) => {
      try {
        for (const { policy, identity } of charges(req, res.locals.accountId)) {
          const decision = await this.store.consume(policy + ':' + hash(identity), this.policies[policy]);
          if (!decision.allowed) {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Retry-After', Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
            res.status(429).json({ error: 'Слишком много запросов. Подожди и повтори запрос.' });
            return;
          }
        }
        next();
      } catch {
        // A Redis failure cannot silently reset a shared financial limit.
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Retry-After', '2');
        res.status(503).json({ error: 'Проверка запросов временно недоступна. Повтори запрос позже.' });
      }
    };
  }
  ip(): RequestHandler {
    return this.gate(req => {
      const identity = clientIpIdentity(req);
      return (isCallback(req) ? ['callbackBurst', 'callback'] : ['ipBurst', 'ip']).map(policy => ({ policy: policy as PolicyName, identity }));
    });
  }
  account(kind: 'wallet' | 'crypto' | 'demo' = 'wallet'): RequestHandler {
    return this.gate((req, identity) => {
      if (typeof identity !== 'string' || !identity) throw new Error('Missing rate limit account');
      if (kind === 'demo') return [{ policy: 'demo', identity }];
      const path = req.path.toLowerCase().replace(/\/$/, '');
      let policy: PolicyName;
      if (req.method === 'GET' || path === '/display-rate') policy = 'read';
      else if (path === '/withdrawals') policy = 'withdrawal';
      else if (/^\/operations\/[^/]+\/refresh$/.test(path)) policy = 'refresh';
      else if (['/deposit', '/deposits', '/quotes', '/claim'].includes(path)) policy = 'funding';
      else policy = 'game';
      return [{ policy: 'wallet', identity }, ...(kind === 'crypto' ? [{ policy: 'crypto' as const, identity }] : []), { policy, identity }];
    });
  }
  login(): RequestHandler {
    return this.gate(req => [{ policy: 'loginIp', identity: clientIpIdentity(req) },
      { policy: 'loginEmail', identity: typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '' }]);
  }
}

export function createHttpRateLimitRuntime(env: NodeJS.ProcessEnv = process.env) {
  const url = env.HTTP_RATE_LIMIT_REDIS_URL || env.REDIS_URL;
  const scope = env.PUBLIC_ORIGIN || 'royal-local';
  const store = url ? new RedisRequestLimitStore(url, 'royal:http-limit:v1:' + hash(scope) + ':') : new MemoryRequestLimitStore();
  const overrides: Partial<Record<PolicyName, RatePolicy>> = {};
  for (const [name, variable] of [['ip', 'HTTP_RATE_LIMIT_IP_PER_MINUTE'], ['ipBurst', 'HTTP_RATE_LIMIT_IP_BURST'],
    ['callback', 'HTTP_RATE_LIMIT_CALLBACK_PER_MINUTE'], ['callbackBurst', 'HTTP_RATE_LIMIT_CALLBACK_BURST']] as const) {
    if (env[variable] !== undefined) overrides[name] = { ...HTTP_RATE_POLICIES[name], limit: Number(env[variable]) };
  }
  const limits = new HttpRateLimits(store, overrides);
  return { limits, shared: store instanceof RedisRequestLimitStore,
    start: async () => { if (store instanceof RedisRequestLimitStore) {
      try { await store.start(); } catch { store.close(); throw new Error('HTTP rate limit Redis is unavailable'); }
    } }, close: () => { if (store instanceof RedisRequestLimitStore) store.close(); } };
}
