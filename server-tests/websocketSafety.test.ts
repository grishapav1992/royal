import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import WebSocket from 'ws';
import { DEFAULT_MAX_BUFFERED_BYTES, DEFAULT_MAX_WEBSOCKET_CONNECTIONS, hasReservedWebSocketSeat, SafeWebSocketTransport, WebSocketSafetyMonitor } from '../server/websocketSafety';

class Socket {
  bufferedAmount = 0;
  terminations = 0;
  terminate() { this.terminations++; }
}
class SocketServer extends EventEmitter {
  clients = new Set<Socket>();
}

test('only the slow recipient is disconnected, including one connected after monitoring starts', () => {
  const server = new SocketServer(), healthy = new Socket(), slow = new Socket();
  server.clients.add(healthy);
  const monitor = new WebSocketSafetyMonitor(server, { maxBufferedBytes: 100 });
  try {
    server.clients.add(slow);
    healthy.bufferedAmount = 100;
    slow.bufferedAmount = 101;
    monitor.check();
    assert.equal(healthy.terminations, 0);
    assert.equal(slow.terminations, 1);
    assert.deepEqual(monitor.stats(), { maxBufferedBytes: 100, disconnectedClients: 1 });
    monitor.check();
    assert.equal(slow.terminations, 1);
    assert.equal(monitor.stats().disconnectedClients, 1);
  } finally { monitor.dispose(); }
});

test('a drained queue remains usable, while a later backlog is disconnected', () => {
  const server = new SocketServer(), socket = new Socket();
  server.clients.add(socket);
  const monitor = new WebSocketSafetyMonitor(server, { maxBufferedBytes: 100 });
  try {
    socket.bufferedAmount = 90;
    monitor.check();
    socket.bufferedAmount = 0;
    monitor.check();
    assert.equal(socket.terminations, 0);
    socket.bufferedAmount = 101;
    monitor.check();
    assert.equal(socket.terminations, 1);
  } finally { monitor.dispose(); }
});

test('server close and explicit disposal stop checks and remove the close listener', () => {
  for (const closeServer of [false, true]) {
    const server = new SocketServer(), socket = new Socket();
    server.clients.add(socket);
    const monitor = new WebSocketSafetyMonitor(server, { maxBufferedBytes: 100 });
    assert.equal(server.listenerCount('close'), 1);
    if (closeServer) server.emit('close'); else monitor.dispose();
    monitor.dispose();
    assert.equal(server.listenerCount('close'), 0);
    socket.bufferedAmount = 101;
    monitor.check();
    assert.equal(socket.terminations, 0);
  }
});

test('invalid limits fail before allocating transport resources', () => {
  for (const maxBufferedBytes of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const server = new SocketServer();
    assert.throws(() => new WebSocketSafetyMonitor(server, { maxBufferedBytes }), RangeError);
    assert.equal(server.listenerCount('close'), 0);
    assert.throws(() => new SafeWebSocketTransport({}, { maxBufferedBytes }), RangeError);
    assert.throws(() => new SafeWebSocketTransport({}, { maxConnections: maxBufferedBytes }), RangeError);
  }
  assert.throws(() => new SafeWebSocketTransport({ verifyClient: () => true } as any), TypeError);
  assert.throws(() => new SafeWebSocketTransport({ clientTracking: false } as any), TypeError);
});

test('upgrade checks the reserved room, session and reconnection token without accepting probes', () => {
  const checked: { roomId: string; sessionId: string; token?: string }[] = [];
  const findRoom = (roomId: string) => roomId === 'room-1' ? {
    hasReservedSeat(sessionId: string, token?: string) {
      checked.push({ roomId, sessionId, token });
      return sessionId === 'joining' && token === undefined || sessionId === 'returning' && token === 'valid-token';
    },
  } : undefined;
  assert.equal(hasReservedWebSocketSeat('/process/room-1?sessionId=joining', findRoom), true);
  assert.equal(hasReservedWebSocketSeat('/multiplayer/process/room-1?sessionId=returning&reconnectionToken=valid-token&skipHandshake=1', findRoom), true);
  for (const request of ['/', '/room-1?sessionId=joining', '/process/missing?sessionId=joining', '/process/room-1', '/process/room-1?sessionId=unknown', '/process/room-1?sessionId=returning', '/process/room-1?sessionId=returning&reconnectionToken=wrong']) {
    assert.equal(hasReservedWebSocketSeat(request, findRoom), false, request);
  }
  assert.deepEqual(checked[1], { roomId: 'room-1', sessionId: 'returning', token: 'valid-token' });
  assert.equal(hasReservedWebSocketSeat('/process/room-1?sessionId=joining', () => { throw new Error('room disposed'); }), false);
});

test('the transport uses one unreferenced check interval and cleans up on shutdown', t => {
  const callbacks: (() => void)[] = [];
  const intervals: number[] = [];
  let unrefs = 0, clears = 0;
  const timer = { unref() { unrefs++; return this; } };
  t.mock.method(globalThis, 'setInterval', (callback: () => void, interval: number) => {
    callbacks.push(callback); intervals.push(interval); return timer;
  });
  t.mock.method(globalThis, 'clearInterval', (value: unknown) => { if (value === timer) clears++; });
  const transport = new SafeWebSocketTransport({ noServer: true, pingInterval: 0 });
  try {
    assert.equal(transport.socketSafety.maxBufferedBytes, DEFAULT_MAX_BUFFERED_BYTES);
    assert.equal(transport.maxConnections, DEFAULT_MAX_WEBSOCKET_CONNECTIONS);
    assert.deepEqual(intervals, [1000]);
    assert.equal(unrefs, 1);
    callbacks[0]();
    transport.shutdown();
    assert.equal(clears, 1);
    transport.socketSafety.dispose();
    assert.equal(clears, 1);
  } finally { transport.socketSafety.dispose(); }
});

test('concurrent real handshakes stop at the socket cap and capacity recovers after a disconnect', { timeout: 5000 }, async () => {
  class TestTransport extends SafeWebSocketTransport {
    // Keep sockets open without constructing rooms or requiring accounts.
    protected override async onConnection() {}
    protected override findRoom(roomId: string) {
      return roomId === 'test-room' ? { hasReservedSeat: (sessionId: string, token?: string) => /^seat-\d+$/.test(sessionId) && !token } : undefined;
    }
    connectedClients() { return this.wss.clients.size; }
    firstSocket() { return this.wss.clients.values().next().value!; }
  }
  const transport = new TestTransport({ pingInterval: 0 }, { maxConnections: 2 });
  const server = transport.server!;
  const clients: WebSocket[] = [];
  let nextSession = 0;
  const connect = (path = `/process/test-room?sessionId=seat-${nextSession++}`) => {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${path}`);
    clients.push(socket);
    return new Promise<{ socket: WebSocket; status: number }>((resolve, reject) => {
      socket.once('open', () => resolve({ socket, status: 101 }));
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve({ socket, status: response.statusCode! });
        socket.terminate();
      });
      socket.on('error', error => { if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) reject(error); });
    });
  };
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    assert.equal((await connect('/')).status, 401);
    assert.equal((await connect('/process/test-room?sessionId=unknown')).status, 401);
    assert.equal(transport.connectedClients(), 0);
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => connect()));
    assert.deepEqual(outcomes.map(o => o.status).sort(), [101, 101, ...Array(18).fill(503)]);
    assert.equal(transport.connectedClients(), 2);
    const admitted = outcomes.filter(o => o.status === 101);
    const dropped = Promise.race(admitted.map(async ({ socket }) => {
      const [code] = await once(socket, 'close');
      return { socket, code };
    }));
    Object.defineProperty(transport.firstSocket(), 'bufferedAmount', { get: () => DEFAULT_MAX_BUFFERED_BYTES + 1 });
    transport.socketSafety.check();
    const disconnected = await dropped;
    assert.equal(disconnected.code, 1006);
    assert.equal(transport.socketSafety.stats().disconnectedClients, 1);
    assert.equal(admitted.find(o => o.socket !== disconnected.socket)!.socket.readyState, WebSocket.OPEN);
    // The peer close can reach the server on the next event-loop turn.
    for (let attempt = 0; transport.connectedClients() === 2 && attempt < 20; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(transport.connectedClients(), 1);
    assert.equal((await connect()).status, 101);
    assert.equal(transport.connectedClients(), 2);
  } finally {
    for (const socket of clients) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    const closed = once(server, 'close');
    transport.shutdown();
    await closed;
  }
});
