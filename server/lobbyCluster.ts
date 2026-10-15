import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';
import { READY_PROCESSES_KEY, workerLeaseKey, parseReadyProcess } from './clusterRegistry';

export function lobbyClusterConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.LOBBY_WORKER_ONLY && !['true', 'false'].includes(env.LOBBY_WORKER_ONLY)) throw new Error('LOBBY_WORKER_ONLY must be true or false');
  const workerOnly = env.LOBBY_WORKER_ONLY === 'true';
  if (!env.REDIS_URL) {
    if (workerOnly || env.LOBBY_WORKER_ID) throw new Error('Redis is required for lobby workers');
    return undefined;
  }
  let redis: URL, origin: URL;
  try { redis = new URL(env.REDIS_URL); origin = new URL(env.PUBLIC_ORIGIN || ''); }
  catch { throw new Error('Set valid REDIS_URL and PUBLIC_ORIGIN for lobby workers'); }
  if (!['redis:', 'rediss:'].includes(redis.protocol) || !redis.hostname || redis.hash) throw new Error('REDIS_URL must use Redis');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be an HTTP origin');
  if (env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error('Production lobby workers require HTTPS');
  const workerId = env.LOBBY_WORKER_ID;
  if (!workerId || !/^[a-z][a-z0-9-]{0,31}$/.test(workerId)) throw new Error('Set a unique LOBBY_WORKER_ID containing lowercase letters, digits or hyphens');
  if (workerOnly === (workerId === 'main')) throw new Error('The API ingress must use LOBBY_WORKER_ID=main; other processes must set LOBBY_WORKER_ONLY=true');
  return { redisUrl: env.REDIS_URL, workerId, workerOnly, publicAddress: `${origin.host}/workers/${workerId}` };
}

class ObservedPresence extends RedisPresence {
  get connections() { return [this.pub as Redis, this.sub as Redis]; }
  override shutdown() {
    // Colyseus invokes shutdown without awaiting this method.
    void Promise.allSettled(this.connections.map(client => client.quit()));
  }
}

const bounded = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Lobby cluster operation timed out')), ms); })]);
  } finally { clearTimeout(timer!); }
};

export class LobbyCluster {
  readonly presence: ObservedPresence;
  readonly driver: RedisDriver;
  private readonly connections: Redis[];
  private readonly owner = randomUUID();
  private readonly key: string;
  private processId?: string;
  private registration?: string;
  private active = false;
  private failed = false;
  private stopping = false;
  private renewing = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly onConnectionLoss = () => this.fail();

  constructor(readonly config: NonNullable<ReturnType<typeof lobbyClusterConfig>>, private readonly onFailure: () => void) {
    const options = { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 5000, commandTimeout: 5000, retryStrategy: () => 500 };
    const pub = new Redis(config.redisUrl, options), rooms = new Redis(config.redisUrl, options);
    this.presence = new ObservedPresence(pub);
    this.driver = new RedisDriver(rooms);
    this.connections = [...this.presence.connections, rooms];
    this.key = workerLeaseKey(config.workerId);
    for (const client of this.connections) {
      client.on('close', this.onConnectionLoss);
      client.on('error', this.onConnectionLoss);
    }
  }
  async start() {
    try {
      await bounded(Promise.all(this.connections.map(client => client.connect())), 10000);
      // Stable public routes must identify exactly one process at a time.
      const claimed = await this.connections[0].set(this.key, this.owner, 'EX', 30, 'NX');
      if (!claimed) throw new Error('LOBBY_WORKER_ID is already in use');
      this.timer = setInterval(() => { void this.renew(); }, 10000);
      this.timer.unref();
    } catch (error) {
      for (const client of this.connections) client.disconnect();
      throw error;
    }
  }
  async activate(processId: string) {
    if (this.failed || this.stopping || this.connections.some(client => client.status !== 'ready')) throw new Error('Lobby cluster is unavailable');
    this.processId = processId;
    this.registration = JSON.stringify({ workerId: this.config.workerId, owner: this.owner });
    const registry = await this.connections[0].hgetall(READY_PROCESSES_KEY);
    const obsolete = Object.entries(registry).filter(([, value]) => {
      const entry = parseReadyProcess(value);
      return entry?.workerId === this.config.workerId && entry.owner !== this.owner;
    }).map(([id]) => id);
    // A restarted stable route retires its old process registrations, including
    // entries left behind when Redis was unavailable during the previous stop.
    for (let index = 0; index < obsolete.length; index += 100) {
      const cleared = await this.connections[0].eval("if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; for i=2,#ARGV do redis.call('HDEL',KEYS[2],ARGV[i]) end; return 1", 2,
        this.key, READY_PROCESSES_KEY, this.owner, ...obsolete.slice(index, index + 100));
      if (cleared !== 1) throw new Error('Lobby cluster is unavailable');
    }
    const registered = await this.connections[0].eval("if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('HSET',KEYS[2],ARGV[2],ARGV[3]); return 1 else return 0 end", 2,
      this.key, READY_PROCESSES_KEY, this.owner, processId, this.registration);
    if (registered !== 1 || this.failed || this.stopping || this.connections.some(client => client.status !== 'ready')) throw new Error('Lobby cluster is unavailable');
    this.active = true;
  }
  isReady() { return this.active && !this.failed && !this.stopping && this.connections.every(client => client.status === 'ready'); }
  fail() {
    if (this.failed || this.stopping) return;
    this.failed = true;
    if (this.active) this.onFailure();
  }
  private async renew() {
    if (this.stopping || this.renewing) return;
    this.renewing = true;
    try {
      const renewed = await this.connections[0].eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],30) else return 0 end", 1, this.key, this.owner);
      if (renewed !== 1) this.fail();
    } catch { this.fail(); }
    finally { this.renewing = false; }
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    for (const client of this.connections) {
      client.off('close', this.onConnectionLoss);
      client.off('error', this.onConnectionLoss);
    }
    try {
      await bounded(this.connections[0].eval("if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('DEL',KEYS[1]) end; if redis.call('HGET',KEYS[2],ARGV[2]) == ARGV[3] then redis.call('HDEL',KEYS[2],ARGV[2]) end; return 1", 2,
        this.key, READY_PROCESSES_KEY, this.owner, this.processId ?? '', this.registration ?? ''), 2000);
    } catch { /* A dead process registration expires without deleting a new owner. */ }
  }
}
