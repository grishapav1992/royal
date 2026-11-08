import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { defineRoom, defineServer, Room, type AuthContext, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LobbyState, Player } from '../server/state';
import { parseChatV2Send, ROOM_CHAT_PROTOCOL, ROOM_CHAT_PROTOCOL_V2 } from '../src/shared/chat';
import { createStandControl } from '../scripts/load-stand-control';
import { parseStandFinished, parseStandPrepared, standHost, STAND_ROLE, type StandManifest, type StandPrepared } from '../scripts/load-stand-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('the real isolated generator starts two SDK workers together and reconciles V2 messages', { timeout: 25000 }, async t => {
  const root = resolve('artifacts/work');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'chat-generator-test-'));
  const manifestPath = join(directory, 'manifest.json'), output = join(directory, 'report.json');
  t.after(async () => {
    for (const file of [manifestPath, output]) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  });
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert(address && typeof address !== 'string');
  await new Promise<void>((done, fail) => reservation.close(error => error ? fail(error) : done()));
  const port = address.port, endpoint = 'http://127.0.0.1:' + port;
  const runId = randomUUID(), secret = hash(runId), bundleSha256 = hash('isolated-chat-generator-test');
  const tokens = Array.from({ length: 4 }, (_, index) => hash(`${runId}:${index}`));
  const profile = { clients: 4, seconds: 1, steadyPerSecond: 4, burst: { count: 4, atSecond: 0 } };
  const createdAt = Date.now(), expiresAt = createdAt + 60000;
  const status = { clients: profile.clients, seconds: profile.seconds, apiEndpoint: endpoint, bundleSha256, serverHost: standHost(), chatV2: profile };
  const acceptedIds = new Set<string>(), senderCounts = new Map<string, number>();
  let readyOffers = 0;

  class SyntheticRoom extends Room<{ state: LobbyState }> {
    private readonly roomEpoch = randomUUID();
    private publicationSeq = 0;

    onAuth(_client: Client, _options: unknown, context: AuthContext) {
      return tokens.some(token => context.headers.get('cookie') === 'royal_session=' + token);
    }

    onCreate() {
      this.state = new LobbyState();
      this.onMessage('stop', () => {});
      this.onMessage('inputs', (client, value: { inputs: { seq: number }[] }) => {
        const player = this.state.players.get(client.sessionId), last = value.inputs.at(-1);
        if (player && last) player.inputSeq = last.seq;
      });
      this.onMessage('history', (client, value: { version: number; offerVersion: number }) => {
        assert.deepEqual(value, { version: ROOM_CHAT_PROTOCOL, offerVersion: ROOM_CHAT_PROTOCOL_V2 });
        readyOffers++;
        client.send('chat.ready', { version: ROOM_CHAT_PROTOCOL_V2, serverTimeMs: Date.now() });
        client.send('chat.visit', { roomEpoch: this.roomEpoch, visitId: 1, location: 'arcade', initialCursor: 0 });
      });
      this.onMessage('chat.send', (client, value: unknown) => {
        const request = parseChatV2Send(value);
        assert(request.ok && request.value.roomEpoch === this.roomEpoch && request.value.visitId === 1);
        const { messageId, text } = request.value;
        assert(!acceptedIds.has(messageId)); acceptedIds.add(messageId);
        senderCounts.set(client.sessionId, (senderCounts.get(client.sessionId) ?? 0) + 1);
        const publicationId = randomUUID(), publicationSeq = ++this.publicationSeq;
        client.send('chat.result', { messageId, status: 'accepted' });
        client.send('chat.batch', { roomEpoch: this.roomEpoch, visitId: 1, fromCursor: publicationSeq - 1,
          scannedThrough: publicationSeq, hasMore: false, reset: false,
          messages: [{ publicationId, publicationSeq, senderId: client.sessionId, name: 'Synthetic', text, time: Date.now() }] });
        client.send('chat.result', { messageId, status: 'published', publicationId });
      });
    }

    onJoin(client: Client) { this.state.players.set(client.sessionId, new Player()); }
    onLeave(client: Client) { this.state.players.delete(client.sessionId); }
  }

  const transport = new WebSocketTransport({ pingInterval: 0 });
  const server = defineServer({ transport, rooms: { lobby: defineRoom(SyntheticRoom) }, greet: false, gracefullyShutdown: false,
    publicAddress: `127.0.0.1:${port}/workers/main`, express: app => {
      app.get('/__load-stand/status', (request, response) => {
        if (request.headers.authorization !== 'Bearer ' + secret) { response.sendStatus(401); return; }
        response.json({ protocol: 1, role: STAND_ROLE, runId, expiresAt, ...status });
      });
    } });
  await server.listen(port, '127.0.0.1');
  t.after(() => server.gracefullyShutdown(false));
  let prepared: StandPrepared, startAtUnixMs: number;
  const control = await createStandControl({ runId, secret, expiresAt, status, onAbort: () => {},
    validatePrepared: body => (prepared = parseStandPrepared(body, runId, profile.clients, 4, profile)),
    validateResults: body => parseStandFinished(body, runId, prepared, profile.seconds, startAtUnixMs) });
  t.after(() => control.close());
  const manifest: StandManifest = { protocol: 1, role: STAND_ROLE, runId, secret, createdAt, expiresAt,
    controlEndpoint: 'http://127.0.0.1:' + control.port, serverControlPort: control.port, serverApiPort: port, tokens, ...status };
  await writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
  for (const key of ['PATH', 'HOME', 'SystemRoot', 'TEMP', 'TMPDIR']) if (process.env[key] !== undefined) env[key] = process.env[key];
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/load-websocket-generators.ts', '--manifest', manifestPath,
    '--workers', '2', '--output', output], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-8192); });
  const exit = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exit; } });
  const earlyExit = exit.then(() => { throw new Error('Generator exited before the control phase: ' + diagnostics); });
  const readiness = await Promise.race([control.prepared, earlyExit]);
  assert.deepEqual(readiness.ready.map(worker => worker.chatV2Ready), [2, 2]);
  startAtUnixMs = Date.now() + 1000;
  control.start(startAtUnixMs);
  const finished = await Promise.race([control.results, earlyExit]);
  for (const worker of finished.results) {
    assert.equal(worker.chatV2?.startAtUnixMs, startAtUnixMs);
    assert.equal(worker.chatV2.summary.steady.witnessed, 2);
    assert.equal(worker.chatV2.summary.burst.witnessed, 2);
  }
  assert.equal(readyOffers, 4); assert.equal(acceptedIds.size, 8);
  assert.deepEqual([...senderCounts.values()], [2, 2, 2, 2]);
  await control.publish({ ok: true, verdict: 'synthetic-chat-verified' });
  const [code] = await exit;
  assert.equal(code, 0, diagnostics);
  const report = await readFile(output, 'utf8');
  assert.equal(JSON.parse(report).ok, true);
  for (const token of [secret, ...tokens]) assert(!(report + diagnostics).includes(token));
});
