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
      if (message.kind === 'ready' || message.kind === 'result' || message.kind === 'error'
        || message.kind === 'chat-audit-roster' || message.kind === 'chat-audit-evidence') finish(undefined, message);
    };
    const exited = () => finish(new Error('Synthetic worker exited before reporting'));
    const timer = setTimeout(() => finish(new Error('Synthetic worker did not report')), 15_000);
    worker.on('message', receive);
    worker.once('exit', exited);
    worker.once('error', finish);
    worker.send(command, error => { if (error) finish(error); });
  });
}

test('actual load worker separates movers from chat clients and resumes the same V2 reservation', { timeout: 35_000 }, async () => {
  const tokens = new Map(['slow', 'fast', 'legacy', 'idle', 'implicit'].map(name => [randomBytes(32).toString('hex'), name]));
  const [slowToken, fastToken, legacyToken, idleToken, implicitToken] = tokens.keys();
  const epoch = randomUUID(), workers: ChildProcess[] = [];
  const joins: string[] = [], offers: { name: string; senderId: string; messageId: string; publicationId: string; text: string; at: number }[] = [];
  const resumed: { senderId: string; messageIds: string[] }[] = [];
  const inputFrames = new Map<string, number>();
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
        const name = client.auth as string;
        inputFrames.set(name, (inputFrames.get(name) ?? 0) + 1);
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
        offers.push({ name: publication.name, senderId: client.sessionId, messageId, publicationId: publication.publicationId, text, at: Date.now() });
        if (client.auth === 'slow') {
          const receiver = this.clients.find(peer => peer.auth === 'fast');
          assert(receiver && receiver.sessionId !== client.sessionId);
          this.witness(receiver, publication);
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
    const chatV2 = { profile: { clients: 4, seconds: 1, steadyPerSecond: 4, movingClients: 2 }, shard: { index: 1, count: 2 } };
    const legacy = startWorker(false);
    assert.equal((await request(legacy, { kind: 'connect', endpoint, tokens: [legacyToken], chatV2 })).kind, 'error');
    assert.deepEqual(joins, []);
    const legacyReady = await request(legacy, { kind: 'connect', endpoint, tokens: [legacyToken] });
    assert.equal(legacyReady.connectedClients, 1);
    assert(!('chatV2Ready' in legacyReady) && !('movingClients' in legacyReady));
    assert.equal((await request(legacy, { kind: 'chat-audit-roster' })).kind, 'error');
    const movement = await request(legacy, { kind: 'measure', seconds: 1 });
    assert(movement.packetsSent > 0 && movement.errorCount === 0 && !('chatV2' in movement) && !('movement' in movement));
    assert.equal(legacyPackets, 0);

    const worker = startWorker(true);
    assert.equal((await request(worker, { kind: 'connect', endpoint: 'http://192.0.2.1:9999', tokens: [slowToken, fastToken], chatV2 })).kind, 'error');
    const ready = await request(worker, { kind: 'connect', endpoint, tokens: [slowToken, fastToken], concurrency: 2, chatV2 });
    assert.equal(ready.chatV2Ready, 2);
    assert.equal(ready.movingClients, 1);
    assert.deepEqual(joins.slice(1), ['fast', 'slow']);
    const roster = await request(worker, { kind: 'chat-audit-roster' });
    assert.equal(roster.kind, 'chat-audit-roster');
    assert.deepEqual(roster.accounts.map((account: { accountIndex: number }) => account.accountIndex).sort(), [1, 3]);
    assert(roster.accounts.every((account: { roomEpoch: string; location: string }) => account.roomEpoch === epoch && account.location === 'arcade'));
    const sender = roster.accounts.find((account: { accountIndex: number }) => account.accountIndex === 1);
    const receiver = roster.accounts.find((account: { accountIndex: number }) => account.accountIndex === 3);
    assert(sender.senderId !== receiver.senderId);
    assert.equal((await request(worker, { kind: 'chat-audit-evidence', stream: 'receipts', offset: 0 })).kind, 'error');
    assert.equal((await request(worker, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() - 1, stepsPerPacket: 2 })).kind, 'error');
    assert.equal((await request(worker, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() + 500, stepsPerPacket: 3 })).kind, 'error');
    const startAtUnixMs = Date.now() + 500;
    const result = await request(worker, { kind: 'measure', seconds: 1, startAtUnixMs, drainMs: 750, stepsPerPacket: 2, inputMode: 'browser-window',
      chatAuditObservers: [{ accountIndex: 3, senderId: sender.senderId }] });
    assert.equal(result.errorCount, 0);
    assert.equal(result.connectedClients, 2);
    assert.deepEqual(result.movement, { plannedClients: 1, sentClients: 1, connectedClients: 1 });
    assert.equal(result.offeredInputPacketsPerSecond, 30);
    assert.equal(result.offeredInputStepsPerSecond, 60);
    assert(result.packetsSent > 0 && result.ackMs.count > 0);
    assert.equal(inputFrames.get('slow'), result.packetsSent);
    assert(!inputFrames.has('fast'));
    assert.equal(result.chatV2.startAtUnixMs, startAtUnixMs);
    assert.equal(result.chatV2.summary.unmatchedPublications, 0);
    assert.deepEqual(offers.map(row => [row.name, row.text]), [['slow', 'Synthetic load steady message 2'], ['fast', 'Synthetic load steady message 4']]);
    assert(offers.every(row => row.at >= startAtUnixMs && row.at < startAtUnixMs + 1_000));
    assert.deepEqual(resumed, [{ senderId: offers[0].senderId, messageIds: [offers[0].messageId] }]);
    const { planned, offered, published, witnessed, retryAttempts } = result.chatV2.summary.steady;
    assert.deepEqual({ planned, offered, published, witnessed, retryAttempts }, { planned: 2, offered: 2, published: 2, witnessed: 2, retryAttempts: 0 });
    assert.equal((await request(worker, { kind: 'chat-audit-roster' })).kind, 'error');
    assert.equal((await request(worker, { kind: 'chat-audit-evidence', stream: 'receipts', offset: 1 })).kind, 'error');
    const receipts = await request(worker, { kind: 'chat-audit-evidence', stream: 'receipts', offset: 0 });
    const witnesses = await request(worker, { kind: 'chat-audit-evidence', stream: 'witnesses', offset: 0 });
    assert(receipts.done && witnesses.done);
    assert.deepEqual(receipts.rows.map(({ offeredAtMs, ...row }: { offeredAtMs: number }) => row), offers.map((offer, index) => ({
      publicationId: offer.publicationId, accountIndex: 1 + 2 * index, roomEpoch: epoch, location: 'arcade', publicationSeq: index + 1,
    })));
    assert.equal(witnesses.rows.length, 1);
    const { atMs, ...peerWitness } = witnesses.rows[0];
    assert(atMs >= receipts.rows[0].offeredAtMs);
    assert.deepEqual(peerWitness, { publicationId: offers[0].publicationId, accountIndex: 3, senderId: sender.senderId,
      roomEpoch: epoch, location: 'arcade', publicationSeq: 1 });
    assert.equal((await request(worker, { kind: 'chat-audit-evidence', stream: 'receipts', offset: 2 })).kind, 'error');

    const unsupported = startWorker(true);
    const unavailable = await request(unsupported, { kind: 'connect', endpoint, tokens: [legacyToken],
      chatV2: { profile: { clients: 4, seconds: 1, steadyPerSecond: 1 }, shard: { index: 0, count: 4 } } });
    assert.equal(unavailable.chatV2Ready, 0);
    assert.equal(unavailable.errors['chat-v2-unavailable'], 1);
    assert.equal((await request(unsupported, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() + 500 })).kind, 'error');
    assert.equal(offers.length, 2);

    const idleWorker = startWorker(true);
    const idleReady = await request(idleWorker, { kind: 'connect', endpoint, tokens: [idleToken],
      chatV2: { ...chatV2, shard: { index: 2, count: 4 } } });
    assert.equal(idleReady.chatV2Ready, 1);
    assert.equal(idleReady.movingClients, 0);
    const idle = await request(idleWorker, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() + 500, drainMs: 250, stepsPerPacket: 2 });
    assert.equal(idle.errorCount, 0);
    assert.deepEqual(idle.movement, { plannedClients: 0, sentClients: 0, connectedClients: 0 });
    assert.equal(idle.connectedClients, 1);
    assert.equal(idle.packetsSent, 0);
    assert.equal(idle.ackMs.count, 0);
    assert.equal(idle.timing.timerTicks, 0);
    assert(!inputFrames.has('idle'));
    assert.equal(idle.chatV2.summary.steady.published, 1);
    assert.equal(offers.at(-1)?.name, 'idle');

    const implicitWorker = startWorker(true);
    const implicitReady = await request(implicitWorker, { kind: 'connect', endpoint, tokens: [implicitToken],
      chatV2: { profile: { clients: 4, seconds: 1, steadyPerSecond: 4 }, shard: { index: 3, count: 4 } } });
    assert.equal(implicitReady.chatV2Ready, 1);
    assert(!('movingClients' in implicitReady));
    const implicit = await request(implicitWorker, { kind: 'measure', seconds: 1, startAtUnixMs: Date.now() + 500, drainMs: 250 });
    assert.equal(implicit.errorCount, 0);
    assert(!('movement' in implicit));
    assert(implicit.packetsSent > 0);
    assert.equal(inputFrames.get('implicit'), implicit.packetsSent);
    assert.equal(implicit.chatV2.summary.steady.published, 1);
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
