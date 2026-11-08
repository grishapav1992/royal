import type { IncomingMessage } from 'node:http';
import { createRouter, matchMaker, ServerError } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { LobbyRoom } from '../server/LobbyRoom';
import { loadLobbyBusy } from './load-lobby-owners';
import { STAND_MAX_CONNECTIONS_PER_PROCESS, STAND_MAX_ROOMS_PER_PROCESS } from './load-stand-limits';

const validOrigin = (origin: string | null | undefined) => !origin || /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin);
const methods = new Set(['joinOrCreate', 'create', 'join', 'joinById', 'reconnect']);
const reject = (status: number) => Response.json({ code: status, error: loadLobbyBusy }, { status, headers: { 'Cache-Control': 'no-store' } });

export function loadLobbyRoutes(workerOnly: boolean, ready: () => boolean, cookieToken: (cookie?: string) => string | undefined) {
  let tokens = 60, refilledAt = performance.now();
  return createRouter({}, { onRequest(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/matchmake/')) return;
    if (request.method !== 'POST') return reject(405);
    if (!ready()) return reject(503);
    if (!validOrigin(request.headers.get('origin'))) return reject(403);
    const method = path.split('/')[2];
    if (!methods.has(method) || (workerOnly && method !== 'reconnect')) return reject(403);
    if (method !== 'reconnect' && !/^[a-f0-9]{64}$/.test(cookieToken(request.headers.get('cookie') ?? undefined) ?? '')) return reject(401);
    const now = performance.now();
    tokens = Math.min(60, tokens + Math.max(0, now - refilledAt) * 0.03);
    refilledAt = now;
    if (tokens < 1) return reject(429);
    tokens--;
  } });
}

export function boundedLoadLobbyRoom(Base: typeof LobbyRoom, ready: () => boolean, maxAuthWork: number) {
  let rooms = 0, authorizing = 0;
  return class StandLobbyRoom extends Base {
    private roomSlot = false;

    override onCreate() {
      if (!ready() || rooms >= STAND_MAX_ROOMS_PER_PROCESS) throw new ServerError(503, loadLobbyBusy);
      rooms++; this.roomSlot = true;
      try { super.onCreate(); }
      catch (error) { this.releaseRoomSlot(); throw error; }
    }

    override async onAuth(...args: Parameters<LobbyRoom['onAuth']>) {
      if (!ready() || authorizing >= maxAuthWork) throw new ServerError(503, loadLobbyBusy);
      authorizing++;
      try { return await super.onAuth(...args); }
      finally { authorizing--; }
    }

    override onDispose() {
      try { super.onDispose(); }
      finally { this.releaseRoomSlot(); }
    }

    private releaseRoomSlot() {
      if (!this.roomSlot) return;
      this.roomSlot = false; rooms--;
    }
  };
}

export class LoadLobbyTransport extends WebSocketTransport {
  private timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(ready: () => boolean) {
    let socketCount = () => 0;
    // The synchronous verification callback and ws's client insertion share one event-loop turn.
    super({ maxPayload: 8192, pingInterval: 5000, pingMaxRetries: 3, clientTracking: true,
      verifyClient: (info: { req: IncomingMessage }, done: (accept: boolean, code?: number, reason?: string) => void) => {
        if (!ready() || socketCount() >= STAND_MAX_CONNECTIONS_PER_PROCESS) { done(false, 503, loadLobbyBusy); return; }
        if (!validOrigin(info.req.headers.origin) || !hasSeat(info.req.url)) { done(false, 401, loadLobbyBusy); return; }
        done(true);
      },
    });
    socketCount = () => this.wss.clients.size;
    this.timer = setInterval(() => {
      for (const client of this.wss.clients) if (client.bufferedAmount > 256 * 1024) client.terminate();
    }, 1000);
    this.timer.unref();
  }

  disconnectClients() { for (const client of this.wss.clients) client.terminate(); }

  override shutdown() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.disconnectClients();
    super.shutdown();
  }
}

function hasSeat(requestUrl?: string) {
  try {
    const url = new URL(requestUrl ?? '/', 'http://127.0.0.1');
    const match = /^\/([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,64})$/.exec(url.pathname);
    const sessionId = url.searchParams.get('sessionId');
    return !!match && match[1] === matchMaker.processId && !!sessionId
      && !!matchMaker.getLocalRoomById(match[2])?.hasReservedSeat(sessionId, url.searchParams.get('reconnectionToken') ?? undefined);
  } catch { return false; }
}
