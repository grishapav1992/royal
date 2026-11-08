import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { defineRoom, defineServer, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LobbyState, Player } from '../server/state';
import { parseChatV2ResumeRequest, parseChatV2Send, type ChatV2Publication } from '../src/shared/chat';

function request(worker: ChildProcess, command: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, result?: unknown) => {
      clearTimeout(timer);
      worker.off('message', receive);
      worker.off('exit', exited);
      worker.off('error', finish);
      if (error) reject(error); else resolve(result);
    };
    const receive = (message: { kind?: string }) => {
      if (message.kind === 'ready' || message.kind === 'result' || message.kind === 'error') finish(undefined, message);
    };
    const exited = () => finish(new Error('Synthetic worker exited before reporting'));
    const timer = setTimeout(() => finish(new Error('Synthetic worker did not report')), 15_000);
    worker.on('message', receive);
    worker.once('exit', exited);
    worker.once('error', finish);
    worker.send(command, error => { if (error) finish(error); });
  });
}

test('actual load worker negotiates V2, binds slots to authenticated sessions and resumes the same reservation', { timeout: 35_000 }, async () => {
  const tokens = new Map(['slow', 'fast', 'legacy'].map(name => [randomBytes(32).toString('hex'), name]));
  const [slowToken, fastToken, legacyToken] = tokens.keys();
  const epoch = randomUUID(), workers: ChildProcess[] = [];
  const joins: string[] = [], offers: { name: string; senderId: string; messageId: string; text: string; at: number }[] = [];
  const resumed: { senderId: string; messageIds: string[] }[] = [];
  let legacyPackets = 0;
  class SyntheticRoom extends Room<{ state: LobbyState }> {
    private readonly publications = new Map<string, ChatV2Publication>();
    onCreate() {
      this.state = new LobbyState();
      this.onMessage('history', (client, offer) => {
        assert.deepEqual(offer, { version: 1, offerVersion: 2 });
        if (client.auth === 'legacy') { legacyPackets++; client.send('history', []); return; }
        client.send('chat.ready', { version: 2, serverTimeMs: Date.now() });
        client.send('chat.visit', { roomEpoch: epoch, visitId: 1, location: 'arcade', initialCursor: 0 });
      });
      this.onMessage('inputs', (client, payload) => {
        const player = this.state.players.get(client.sessionId);
        if (player) player.inputSeq = payload.inputs.at(-1).seq;
      });
      this.onMessage('stop', () => {});
      this.onMessage('chat.send', (client, packet) => {
        const parsed = parseChatV2Send(packet);
        assert(parsed.ok);
        const { messageId, text } = parsed.value;
        const publication = { publicationId: randomUUID(), publicationSeq: this.publications.size + 1,
          senderId: client.sessionId, name: client.auth as string, text, time: Date.now() };
        assert(!this.publications.has(messageId));
        this.publications.set(messageId, publication);
        offers.push({ name: publication.name, senderId: client.sessionId, messageId, text, at: Date.now() });
        if (client.auth === 'slow') {
          (client.ref as unknown as { terminate(): void }).terminate();
          return;
        }
        client.send('chat.result', { messageId, status: 'accepted' });
        client.send('chat.result', { messageId, status: 'published', publicationId: publication.publicationId });
        this.witness(client, publication);
      });
      this.onMessage('chat.resume', (client, packet) => {
        const parsed = parseChatV2ResumeRequest(packet);
        assert(parsed);
        resumed.push({ senderId: client.sessionId, messageIds: parsed.messageIds });
        const results = parsed.messageIds.map(messageId => {
          const publication = this.publications.get(messageId);
          assert(publication?.senderId === client.sessionId);
          this.witness(client, publication);
          return { messageId, status: 'published', publicationId: publication.publicationId };
        });
        client.send('chat.resume', { results });
      });
    }
    private witness(client: Client, publication: ChatV2Publication) {
      client.send('chat.batch', { roomEpoch: epoch, visitId: 1, fromCursor: 0, scannedThrough: publication.publicationSeq,
        messages: [publication], hasMore: false, reset: false });
    }
    async onAuth(_client: Client, _options: unknown, context: AuthContext) {
      const token = context.headers.get('cookie')?.match(/^royal_session=([a-f0-9]{64})$/)?.[1];
      const name = token && tokens.get(token);
      if (!name) throw new ServerError(401, 'Synthetic token required');
      if (name === 'slow') await delay(125);
      return name;
    }
    onJoin(client: Client) {
      joins.push(client.auth as string);
      this.state.players.set(client.sessionId, new Player());
    }
    onDrop(client: Client) { void this.allowReconnection(client, 3).catch(() => {}); }
  }
  const transport = new WebSocketTransport({ pingInterval: 0 });
  const server = defineServer({ transport, rooms: { lobby: defineRoom(SyntheticRoom) }, greet: false, gracefullyShutdown: false });
  const startWorker = (chat: boolean) => {
    const child = fork('scripts/load-websocket-worker.ts', [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { NODE_ENV: 'test', ...(chat ? { LOAD_CHAT_V2: '1' } : {}) } });
    workers.push(child);
    return child;
  };
  try {
    await server.listen(0, '127.0.0.1');
    const address = transport.server!.address();
    assert(address && typeof address !== 'string');
    const endpoint = 'http://127.0.0.1:' + address.port;
    const chatV2 = { profile: { clients: 4, seconds: 1, steadyPerSecond: 4 }, shard: { index: 1, count: 2 } };
    const legacy = startWorker(false);
    assert.equal((await request(legacy, { kind: 'connect', endpoint, tokens: [legacyToken], chatV2 })).kind, 'error');
    assert.deepEqual(joins, []);
    const legacyReady = await request(legacy, { kind: 'connect', endpoint, tokens: [legacyToken] });
    assert.equal(legacyReady.connectedClients, 1);
    assert(!('chatV2Ready' in legacyReady));
    const movement = await request(legacy, { kind: 'measure', seconds: 1 });
    assert(movement.packetsSent > 0 && movement.errorCount === 0 && !('chatV2' in movement));
    assert.equal(legacyPackets, 0);

    const worker = startWorker(true);
    assert.equal((await request(worker, { kind: 'connect', endpoint: 'http://192.0.2.1:9999', tokens: [slowToken, fastToken], chatV2 })).kind, 'error');
    const ready = await request(worker, { kind: 'connect', endpoint, tokens: [slowToken, fastToken], concurrency: 2, chatV2 });
    assert.equal(ready.chatV2Ready, 2);
    assert.deepEqual(joins.slice(1), ['fast', 'slow']);
    assert.equal((await request(worker, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() - 1 })).kind, 'error');
    const startAtUnixMs = Date.now() + 500;
    const result = await request(worker, { kind: 'measure', seconds: 1, startAtUnixMs, drainMs: 750 });
    assert.equal(result.errorCount, 0);
    assert.equal(result.connectedClients, 2);
    assert.equal(result.chatV2.startAtUnixMs, startAtUnixMs);
    assert.equal(result.chatV2.summary.unmatchedPublications, 0);
    assert.deepEqual(offers.map(row => [row.name, row.text]), [['slow', 'Synthetic load steady message 2'], ['fast', 'Synthetic load steady message 4']]);
    assert(offers.every(row => row.at >= startAtUnixMs && row.at < startAtUnixMs + 1_000));
    assert.deepEqual(resumed, [{ senderId: offers[0].senderId, messageIds: [offers[0].messageId] }]);
    const { planned, offered, published, witnessed, retryAttempts } = result.chatV2.summary.steady;
    assert.deepEqual({ planned, offered, published, witnessed, retryAttempts }, { planned: 2, offered: 2, published: 2, witnessed: 2, retryAttempts: 0 });

    const unsupported = startWorker(true);
    const unavailable = await request(unsupported, { kind: 'connect', endpoint, tokens: [legacyToken],
      chatV2: { profile: { clients: 4, seconds: 1, steadyPerSecond: 1 }, shard: { index: 0, count: 4 } } });
    assert.equal(unavailable.chatV2Ready, 0);
    assert.equal(unavailable.errors['chat-v2-unavailable'], 1);
    assert.equal((await request(unsupported, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() + 500 })).kind, 'error');
    assert.equal(offers.length, 2);
  } finally {
    await Promise.all(workers.map(async worker => {
      if (!worker.pid || worker.exitCode !== null || worker.signalCode !== null) return;
      const exited = once(worker, 'exit');
      if (worker.connected) worker.send({ kind: 'shutdown' });
      const timer = setTimeout(() => worker.kill(), 2500);
      try { await exited; } finally { clearTimeout(timer); }
    }));
    await server.gracefullyShutdown(false);
  }
});
