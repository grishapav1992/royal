import { randomUUID } from 'node:crypto';
import { ServerError } from '@colyseus/core';
import { loadLobbyWorkers } from './load-lobby-config';
import { STAND_MAX_ROOMS_PER_PROCESS } from './load-stand-limits';
import { LOAD_RUN_REDIS_KEY } from './load-stand-ownership';

export const READY_PROCESSES_KEY = 'royal:lobby:ready-processes';
export const loadLobbyLeaseKey = (workerId: string) => 'royal:lobby:worker:' + workerId;
export const loadLobbyBusy = 'load-lobby-owner-unavailable';
const leaseMs = 30_000;
const maxRegistrations = loadLobbyWorkers.length * 2;
const processIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const ownerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function parseReadyProcess(value: unknown): { workerId: string; owner: string } | undefined {
  if (typeof value !== 'string' || value.length > 256) return;
  try {
    const entry = JSON.parse(value);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 2
      || !loadLobbyWorkers.includes(entry.workerId) || typeof entry.owner !== 'string' || !ownerPattern.test(entry.owner)) return;
    return { workerId: entry.workerId, owner: entry.owner };
  } catch { return; }
}

const owns = "redis.call('GET',KEYS[1]) == ARGV[1] and redis.call('GET',KEYS[2]) == ARGV[2]";
const claim = `-- claim owner\nif redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
  if redis.call('SET',KEYS[2],ARGV[2],'NX','PX',ARGV[3]) then return 1 end
  return 0`;
const register = `-- register owner\nif not (${owns}) then return 0 end
  local prior=redis.call('HGET',KEYS[3],ARGV[3]); if prior and prior ~= ARGV[4] then return 0 end
  for i=5,#ARGV do redis.call('HDEL',KEYS[3],ARGV[i]) end
  redis.call('HSET',KEYS[3],ARGV[3],ARGV[4]); return 1`;
const verify = `-- verify owner\nif not (${owns}) then return 0 end
  if ARGV[3] ~= '' and redis.call('HGET',KEYS[3],ARGV[3]) ~= ARGV[4] then return 0 end
  if ARGV[5] ~= '' then return redis.call('PEXPIRE',KEYS[2],ARGV[5]) end
  return 1`;
const release = `-- release owner\nif not (${owns}) then return 0 end
  if ARGV[3] ~= '' and redis.call('HGET',KEYS[3],ARGV[3]) == ARGV[4] then redis.call('HDEL',KEYS[3],ARGV[3]) end
  redis.call('DEL',KEYS[2]); return 1`;

type RegistryRead = { get(key: string): Promise<unknown>; hgetall(key: string): Promise<Record<string, string>> };
type Registry = RegistryRead & { eval(script: string, keys: number, ...arguments_: string[]): Promise<unknown> };

/** Only an attested run can write leases. Every Redis mutation checks its current ownership. */
export class LoadLobbyOwnerLease {
  private readonly owner = randomUUID();
  private readonly key: string;
  private readonly registration: string;
  private processId?: string;
  private attemptedProcessId?: string;
  private timer?: ReturnType<typeof setInterval>;
  private renewing?: Promise<void>;
  private stopped = false;
  private lost = false;
  private closing?: Promise<void>;

  constructor(private readonly redis: Registry, private readonly runId: string, private readonly workerId: string,
    private readonly onLost: () => void) {
    if (!loadLobbyWorkers.includes(workerId)) throw new Error('load-lobby-invalid-worker');
    this.key = loadLobbyLeaseKey(workerId);
    this.registration = JSON.stringify({ workerId, owner: this.owner });
  }

  async start() {
    if (this.stopped || this.timer || await this.redis.eval(claim, 2, LOAD_RUN_REDIS_KEY, this.key, this.runId, this.owner, String(leaseMs)) !== 1) {
      throw new Error('load-lobby-owner-lease-refused');
    }
    this.timer = setInterval(() => { void this.renew(); }, leaseMs / 3);
    this.timer.unref();
  }

  async activate(processId: string) {
    if (!this.timer || this.stopped || this.lost || this.attemptedProcessId || !processIdPattern.test(processId)) throw new Error(loadLobbyBusy);
    this.attemptedProcessId = processId;
    const registry = Object.entries(await this.redis.hgetall(READY_PROCESSES_KEY));
    if (registry.length > maxRegistrations) throw new Error(loadLobbyBusy);
    const obsolete = registry.filter(([id, raw]) => id !== processId && parseReadyProcess(raw)?.workerId === this.workerId).map(([id]) => id);
    if (await this.redis.eval(register, 3, LOAD_RUN_REDIS_KEY, this.key, READY_PROCESSES_KEY,
      this.runId, this.owner, processId, this.registration, ...obsolete) !== 1 || this.stopped || this.lost) throw new Error(loadLobbyBusy);
    this.processId = processId;
  }

  get ready() { return this.processId !== undefined && !this.stopped && !this.lost; }

  async checkReady() {
    if (!this.ready) return false;
    try { if (await this.verify(false) === 1) return this.ready; } catch { /* Lose readiness below. */ }
    this.connectionLost();
    return false;
  }

  connectionLost() {
    if (this.stopped || this.lost) return;
    this.lost = true;
    this.onLost();
  }

  private verify(renew: boolean) {
    return this.redis.eval(verify, 3, LOAD_RUN_REDIS_KEY, this.key, READY_PROCESSES_KEY,
      this.runId, this.owner, this.processId ?? '', this.registration, renew ? String(leaseMs) : '');
  }

  private renew() {
    if (this.stopped || this.lost || this.renewing) return;
    this.renewing = this.verify(true).then(result => { if (result !== 1) this.connectionLost(); }, () => this.connectionLost())
      .finally(() => { this.renewing = undefined; });
    return this.renewing;
  }

  close() {
    if (this.closing) return this.closing;
    this.stopped = true;
    clearInterval(this.timer);
    return this.closing = (async () => {
      await this.renewing;
      await this.redis.eval(release, 3, LOAD_RUN_REDIS_KEY, this.key, READY_PROCESSES_KEY,
        this.runId, this.owner, this.attemptedProcessId ?? '', this.registration);
    })();
  }
}

export type LoadLobbyProcess = { processId: string; roomCount: number; available?: boolean };
type Presence = RegistryRead & { channels(pattern: string): Promise<string[]> };

export async function liveLoadLobbyProcesses(presence: Presence, fetchStats: () => Promise<LoadLobbyProcess[]>): Promise<LoadLobbyProcess[]> {
  const [stats, channels, registry] = await Promise.all([fetchStats(), presence.channels('p:*'), presence.hgetall(READY_PROCESSES_KEY)]);
  if (stats.length > maxRegistrations || channels.length > maxRegistrations || Object.keys(registry).length > maxRegistrations) {
    throw new ServerError(503, loadLobbyBusy);
  }
  const active = new Set(channels.map(channel => channel.slice(2)));
  const seen = new Set<string>(), leases = new Map<string, Promise<unknown>>();
  const live: LoadLobbyProcess[] = [];
  for (const stat of stats) {
    if (stat.available === false || !processIdPattern.test(stat.processId) || !active.has(stat.processId)
      || !Number.isSafeInteger(stat.roomCount) || stat.roomCount < 0) continue;
    const entry = parseReadyProcess(registry[stat.processId]);
    if (!entry) continue;
    const lease = leases.get(entry.workerId) ?? presence.get(loadLobbyLeaseKey(entry.workerId));
    leases.set(entry.workerId, lease);
    if (await lease !== entry.owner) continue;
    if (seen.has(entry.workerId)) throw new ServerError(503, loadLobbyBusy);
    seen.add(entry.workerId);
    live.push(stat);
  }
  return live;
}

/** Count provisional rooms until Colyseus has recorded their creation in its shared stats. */
export function selectLoadLobbyProcess(fetchLive: () => Promise<LoadLobbyProcess[]>, now = () => performance.now()) {
  const provisional = new Map<string, { observed: number; picks: number[] }>();
  let previous = '', pending = 0, queue: Promise<void> = Promise.resolve();
  const choose = async () => {
    const stats = await fetchLive(), at = now(), live = new Set(stats.map(stat => stat.processId));
    for (const id of provisional.keys()) if (!live.has(id)) provisional.delete(id);
    const candidates = stats.map(stat => {
      const { processId, roomCount } = stat;
      const tracked = provisional.get(processId) ?? { observed: roomCount, picks: [] };
      tracked.picks.splice(0, Math.max(0, roomCount - tracked.observed));
      tracked.picks = tracked.picks.filter(pickedAt => at - pickedAt < 5_000);
      tracked.observed = roomCount;
      provisional.set(processId, tracked);
      return { processId, tracked, count: roomCount + tracked.picks.length };
    }).filter(candidate => candidate.count < STAND_MAX_ROOMS_PER_PROCESS)
      .sort((a, b) => a.count - b.count || a.processId.localeCompare(b.processId));
    if (!candidates.length) throw new ServerError(503, loadLobbyBusy);
    const least = candidates.filter(candidate => candidate.count === candidates[0].count);
    const selected = least.find(candidate => candidate.processId.localeCompare(previous) > 0) ?? least[0];
    previous = selected.processId;
    selected.tracked.picks.push(at);
    return selected.processId;
  };
  return () => {
    if (pending >= 128) return Promise.reject(new ServerError(503, loadLobbyBusy));
    pending++;
    const selection = queue.then(choose).finally(() => { pending--; });
    queue = selection.then(() => {}, () => {});
    return selection;
  };
}
