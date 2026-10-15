import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';
import { matchMaker } from '@colyseus/core';
import type { VerifyClientCallbackAsync } from 'ws';

export const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024;
export const DEFAULT_MAX_WEBSOCKET_CONNECTIONS = 330;
const CHECK_INTERVAL_MS = 1000;

export type WebSocketSafetyOptions = { maxBufferedBytes?: number; maxConnections?: number };
export type SafeTransportOptions = Omit<TransportOptions, 'verifyClient' | 'clientTracking'>;
type BufferedSocket = { readonly bufferedAmount: number; terminate(): void };
type ReservedRoom = { hasReservedSeat(sessionId: string, reconnectionToken?: string): boolean };
type SocketServer = {
  readonly clients: ReadonlySet<BufferedSocket>;
  once(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
};

function bufferLimit(options: WebSocketSafetyOptions) {
  const limit = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('maxBufferedBytes must be a positive safe integer');
  return limit;
}

function connectionLimit(options: WebSocketSafetyOptions) {
  const limit = options.maxConnections ?? DEFAULT_MAX_WEBSOCKET_CONNECTIONS;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('maxConnections must be a positive safe integer');
  return limit;
}

export function hasReservedWebSocketSeat(requestUrl: string, findRoom: (roomId: string) => ReservedRoom | undefined = matchMaker.getLocalRoomById) {
  try {
    const url = new URL(requestUrl, 'http://websocket.local');
    const roomId = url.pathname.match(/\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)$/)?.[1];
    const sessionId = url.searchParams.get('sessionId');
    if (!roomId || !sessionId) return false;
    return findRoom(roomId)?.hasReservedSeat(sessionId, url.searchParams.get('reconnectionToken') ?? undefined) ?? false;
  } catch { return false; }
}

export class WebSocketSafetyMonitor {
  readonly maxBufferedBytes: number;
  private timer?: ReturnType<typeof setInterval>;
  private terminated = new WeakSet<BufferedSocket>();
  private disconnectedClients = 0;
  private onClose = () => this.dispose();

  constructor(private server: SocketServer, options: WebSocketSafetyOptions = {}) {
    this.maxBufferedBytes = bufferLimit(options);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
    server.once('close', this.onClose);
  }

  check() {
    if (!this.timer) return;
    for (const socket of this.server.clients) {
      if (this.terminated.has(socket) || socket.bufferedAmount <= this.maxBufferedBytes) continue;
      this.terminated.add(socket);
      this.disconnectedClients++;
      // Dropping a schema delta would desynchronize this connection. Termination
      // releases the queued bytes; a reconnect establishes a fresh full state.
      socket.terminate();
    }
  }

  stats() { return { maxBufferedBytes: this.maxBufferedBytes, disconnectedClients: this.disconnectedClients }; }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.server.off('close', this.onClose);
  }
}

export class SafeWebSocketTransport extends WebSocketTransport {
  readonly socketSafety: WebSocketSafetyMonitor;
  readonly maxConnections: number;

  constructor(options: SafeTransportOptions = {}, safetyOptions: WebSocketSafetyOptions = {}) {
    // Validate before constructing the underlying HTTP and WebSocket servers.
    const maxBufferedBytes = bufferLimit(safetyOptions);
    const maxConnections = connectionLimit(safetyOptions);
    if ('verifyClient' in options || 'clientTracking' in options) throw new TypeError('WebSocket safety owns verifyClient and clientTracking');
    let connectedClients = () => 0;
    let hasSeat = (_requestUrl: string) => false;
    // The two-argument form lets ws return 503. Calling done synchronously keeps
    // the capacity check and ws adding the connection in the same event-loop turn.
    const verifyClient: VerifyClientCallbackAsync = (_info, done) => {
      if (connectedClients() >= maxConnections) done(false, 503, 'WebSocket capacity reached');
      else if (!hasSeat(_info.req.url ?? '/')) done(false, 401, 'Valid room reservation required');
      else done(true);
    };
    super({ ...options, clientTracking: true, verifyClient });
    connectedClients = () => this.wss.clients.size;
    hasSeat = requestUrl => hasReservedWebSocketSeat(requestUrl, roomId => this.findRoom(roomId));
    this.maxConnections = maxConnections;
    this.socketSafety = new WebSocketSafetyMonitor(this.wss, { maxBufferedBytes });
  }

  protected findRoom(roomId: string): ReservedRoom | undefined { return matchMaker.getLocalRoomById(roomId); }

  disconnectClients() {
    for (const client of this.wss.clients) client.terminate();
  }

  override shutdown() {
    this.socketSafety.dispose();
    super.shutdown();
  }
}
