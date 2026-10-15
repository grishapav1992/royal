import { ServerError } from '@colyseus/core';
import { ROOM_CAPACITY } from '../src/shared/world';

export const SERVER_BUSY = 'Сейчас много игроков. Подожди несколько секунд и попробуй войти снова.';

export async function settleAuthWork<T extends readonly unknown[]>(work: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  // A failed query must not release the permit while its siblings are still running.
  const results = await Promise.allSettled(work);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as unknown as T;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer between ${min} and ${max}`);
  return value;
}

export function admissionConfig(env: NodeJS.ProcessEnv = process.env) {
  const maxRooms = integer(env, 'LOBBY_MAX_ROOMS', 10, 1, 100);
  return {
    maxRooms,
    maxConnections: integer(env, 'WS_MAX_CONNECTIONS', maxRooms * ROOM_CAPACITY + ROOM_CAPACITY, ROOM_CAPACITY, 10000),
    maxAuthWork: integer(env, 'LOBBY_AUTH_CONCURRENCY', 8, 1, 50),
    matchmakingRate: integer(env, 'LOBBY_MATCHMAKING_RATE', 30, 1, 1000),
    matchmakingBurst: integer(env, 'LOBBY_MATCHMAKING_BURST', 60, 1, 2000),
    maxBufferedBytes: integer(env, 'WS_MAX_BUFFERED_BYTES', 256 * 1024, 16384, 16 * 1024 * 1024),
  };
}

type Config = ReturnType<typeof admissionConfig>;
type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> };

export class LobbyAdmission {
  private readonly rooms = new Set<object>();
  private accepting = true;
  private readonly waiting: Waiter[] = [];
  private active = 0;
  private tokens: number;
  private refillAt: number;
  constructor(readonly config: Config, private readonly now = () => performance.now()) {
    this.tokens = config.matchmakingBurst;
    this.refillAt = now();
  }
  claimRoom(room: object) {
    if (this.rooms.has(room)) return;
    if (!this.accepting || this.rooms.size >= this.config.maxRooms) throw new ServerError(503, SERVER_BUSY);
    this.rooms.add(room);
  }
  releaseRoom(room: object) { this.rooms.delete(room); }
  async drain() {
    this.accepting = false;
    // Room.lock changes local state synchronously, then persists the listing.
    // Start every lock before waiting for any slow external operation.
    const locking = [...this.rooms].map(room => {
      try { return Promise.resolve((room as { lock?: () => unknown }).lock?.()); }
      catch (error) { return Promise.reject(error); }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled(locking), new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  allowMatchmaking() {
    const now = this.now();
    this.tokens = Math.min(this.config.matchmakingBurst, this.tokens + Math.max(0, now - this.refillAt) * this.config.matchmakingRate / 1000);
    this.refillAt = Math.max(this.refillAt, now);
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
  async authenticate<T>(action: () => Promise<T>): Promise<T> {
    // New admissions never wait ahead of already reserved joins or reconnects.
    if (this.active >= this.config.maxAuthWork || this.waiting.length) throw new ServerError(503, SERVER_BUSY);
    this.active++;
    try { return await action(); } finally { this.releaseWork(); }
  }
  async reserved<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.config.maxAuthWork || this.waiting.length) {
      // Native room capacity bounds valid reservations, including reconnect grace.
      if (this.waiting.length >= this.config.maxRooms * ROOM_CAPACITY) throw new ServerError(503, SERVER_BUSY);
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          grant: resolve,
          timer: setTimeout(() => {
            const index = this.waiting.indexOf(waiter);
            if (index !== -1) this.waiting.splice(index, 1);
            reject(new ServerError(503, SERVER_BUSY));
          }, 5000),
        };
        this.waiting.push(waiter);
      });
    } else this.active++;
    try { return await action(); } finally { this.releaseWork(); }
  }
  private releaseWork() {
    const next = this.waiting.shift();
    if (next) { clearTimeout(next.timer); next.grant(); } else this.active--;
  }
  snapshot() {
    return { rooms: this.rooms.size, maxRooms: this.config.maxRooms, maxSeats: this.config.maxRooms * ROOM_CAPACITY, activeAuthWork: this.active, waitingAuthWork: this.waiting.length };
  }
}

export const lobbyAdmission = new LobbyAdmission(admissionConfig());
