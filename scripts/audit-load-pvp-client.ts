import { Agent, request } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import type { Room } from '@colyseus/sdk';
import type { SchemaConstructor } from '@colyseus/sdk/serializer/SchemaSerializer';
import NodeWebSocket, { type ClientOptions as WebSocketOptions } from 'ws';
import { VIRTUAL_PVP_SCOPE, type PvpRequest, type PvpSnapshot } from '../src/shared/pvp';

type FixtureRoom = Room<any, any>;
const commandTimeoutMs = 5000;
const closeTimeoutMs = 1000;
const maxMatchmakerBytes = 65_536;

class DirectWebSocket extends NodeWebSocket {
  constructor(url: string, options?: WebSocketOptions) {
    super(url, { ...options, agent: new Agent({ proxyEnv: {} }), handshakeTimeout: commandTimeoutMs });
  }
}

let sdk: Promise<typeof import('@colyseus/sdk')> | undefined;
function directSdk() {
  return sdk ??= (async () => {
    // The SDK captures the socket constructor on import. This fixture pins a direct Node transport.
    const previous = globalThis.WebSocket;
    globalThis.WebSocket = DirectWebSocket as unknown as typeof globalThis.WebSocket;
    try { return await import('@colyseus/sdk'); }
    finally { globalThis.WebSocket = previous; }
  })();
}

function fetchMatchmaker(url: URL, init: RequestInit | undefined, agent: Agent, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => { headers[name] = value; });
  if (typeof init?.body !== 'string' || init.method !== 'POST') throw new Error('Expected a fixture matchmaker request');
  const body = init.body;
  return new Promise((complete, reject) => {
    const call = request(url, { agent, method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, signal }, reply => {
      let content = '', size = 0;
      reply.setEncoding('utf8');
      reply.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > maxMatchmakerBytes) reply.destroy(new Error('Fixture matchmaker response exceeds bound'));
        else content += chunk;
      });
      reply.once('error', reject);
      reply.once('end', () => {
        try {
          complete(new Response(content, { status: reply.statusCode,
            headers: { 'content-type': reply.headers['content-type'] ?? '' } }));
        } catch (error) { reject(error); }
      });
    });
    call.once('error', reject);
    call.end(body);
  });
}

async function beforeDeadline<T>(operation: Promise<T>, signal: AbortSignal) {
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_complete, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function waitForPvp(room: FixtureRoom, signal: AbortSignal, matches: (value: PvpSnapshot) => boolean,
  command?: PvpRequest): Promise<PvpSnapshot> {
  return new Promise((complete, reject) => {
    let settled = false;
    const clean = () => {
      if (settled) return false;
      settled = true;
      offSnapshot(); offResult();
      room.onError.remove(disconnected); room.onDrop.remove(disconnected); room.onLeave.remove(disconnected);
      signal.removeEventListener('abort', aborted);
      return true;
    };
    const fail = (error: unknown) => { if (clean()) reject(error); };
    const aborted = () => fail(signal.reason);
    const disconnected = () => fail(new Error('Fixture PvP connection closed'));
    const offSnapshot = room.onMessage<PvpSnapshot>('pvp', value => {
      if (value && matches(value) && clean()) complete(value);
    });
    const offResult = room.onMessage<{ requestId?: string }>('pvp-result', value => {
      if (command && value?.requestId === command.id) fail(new Error('Fixture PvP command failed'));
    });
    room.onError(disconnected); room.onDrop(disconnected); room.onLeave(disconnected);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      signal.throwIfAborted();
      if (!room.connection.isOpen) throw new Error('Fixture PvP connection is unavailable');
      if (command) room.send('pvp', { ...command, walletScope: VIRTUAL_PVP_SCOPE });
    } catch (error) { fail(error); }
  });
}

async function closeRoom(room: FixtureRoom) {
  const connection = room.connection;
  if (!connection) return;
  try {
    if (connection.isOpen) {
      const left = await Promise.race([room.leave().then(() => true), pause(closeTimeoutMs, false, { ref: false })]);
      if (left) return;
    }
  } catch { /* Force the fixture connection closed below. */ }
  const socket = (connection.transport as { ws?: { terminate?: () => void } }).ws;
  if (socket?.terminate) socket.terminate();
  else connection.close();
}

/** Connect independent two-player fixtures through the same authenticated room protocol as a player. */
export async function openAuditLoadPvpPairs(wsBaseUrl: string, pairs: ReadonlyArray<readonly [string, string]>,
  tokens: ReadonlyMap<string, string>, signal?: AbortSignal) {
  const endpoint = new URL(wsBaseUrl);
  if (!['http:', 'ws:'].includes(endpoint.protocol) || endpoint.hostname !== '127.0.0.1' || !endpoint.port ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('Expected a loopback fixture PvP endpoint');
  }
  signal?.throwIfAborted();
  const { Client } = await directSdk();
  signal?.throwIfAborted();
  const agent = new Agent({ keepAlive: true, proxyEnv: {} });
  const rooms = new Set<FixtureRoom>();
  const lifetime = new AbortController();
  const active = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
  const deadline = () => AbortSignal.any([active, AbortSignal.timeout(commandTimeoutMs)]);
  class TrackedClient extends Client {
    protected override createRoom<T>(name: string, schema?: SchemaConstructor<T>) {
      active.throwIfAborted();
      const room = super.createRoom(name, schema);
      room.reconnection.enabled = false;
      room.onMessage('*', () => {});
      rooms.add(room);
      return room;
    }
  }
  const localUrl = (url: URL) => {
    if (url.host !== endpoint.host || !['http:', 'ws:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Unexpected fixture PvP destination');
    }
    return url.href;
  };
  const clientFor = (account: string) => {
    const token = tokens.get(account);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Fixture PvP session is missing');
    return new TrackedClient(endpoint.href, { headers: { Cookie: 'royal_session=' + token }, urlBuilder: localUrl,
      fetchFn: (target, init) => {
        const url = new URL(target instanceof Request ? target.url : target);
        localUrl(url);
        return fetchMatchmaker(url, init, agent, deadline());
      } });
  };
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', cancel);
    lifetime.abort();
    agent.destroy();
    await Promise.all([...rooms].map(closeRoom));
  })();
  const cancel = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const connected = await Promise.all(pairs.map(async ([left, right]) => {
      const first = await beforeDeadline(clientFor(left).create('lobby', { activityProtocol: 1, auditLoadSeat: 0 }), deadline());
      const second = await beforeDeadline(clientFor(right).joinById(first.roomId, { activityProtocol: 1, auditLoadSeat: 1 }), deadline());
      const waitForPeer = (room: FixtureRoom, peer: string) => waitForPvp(room, deadline(), value =>
        !value.requestId && value.people?.some(person => person.accountId === peer && person.available));
      await Promise.all([waitForPeer(first, right), waitForPeer(second, left)]);
      const pair = [first, second] as const;
      return { command: (side: 0 | 1, command: PvpRequest) =>
        waitForPvp(pair[side], deadline(), value => value.requestId === command.id, command) };
    }));
    return { pairs: connected, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
