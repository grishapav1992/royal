import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { defineRoom, defineServer, Room, type AuthContext, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LobbyState, Player } from '../server/state';
import { parseChatV2Send, ROOM_CHAT_PROTOCOL, ROOM_CHAT_PROTOCOL_V2 } from '../src/shared/chat';
import { createStandControl } from '../scripts/load-stand-control';
import { chatAuditChecks, parseStandFinished, parseStandPrepared, standHost, STAND_ROLE, type StandManifest, type StandPrepared } from '../scripts/load-stand-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

type Delivery = 'peers' | 'sender-only' | 'shared-id';

async function runDeliveryFixture(t: TestContext, delivery: Delivery) {
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
  const accountsByCookie = new Map(tokens.map((token, index) => ['royal_session=' + token, index] as const));
  const profile = { clients: 4, seconds: 1, steadyPerSecond: 4, burst: { count: 4, atSecond: 0 } };
  const createdAt = Date.now(), expiresAt = createdAt + 60000;
  const status = { clients: profile.clients, seconds: profile.seconds, apiEndpoint: endpoint, bundleSha256, serverHost: standHost(), chatV2: profile };
  const acceptedIds = new Set<string>(), publicationIds = new Set<string>();
  const senderCounts = new Map<number, number>(), sessionAccounts = new Map<string, number>();
  const sharedPublicationId = randomUUID();
  let readyOffers = 0;

  class SyntheticRoom extends Room<{ state: LobbyState }> {
    private readonly roomEpoch = randomUUID();
    private publicationSeq = 0;

    onAuth(client: Client, _options: unknown, context: AuthContext) {
      const account = accountsByCookie.get(context.headers.get('cookie') ?? '');
      if (account === undefined) return false;
      sessionAccounts.set(client.sessionId, account);
      return true;
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
        const account = sessionAccounts.get(client.sessionId);
        assert(account !== undefined);
        readyOffers++;
        client.send('chat.ready', { version: ROOM_CHAT_PROTOCOL_V2, serverTimeMs: Date.now() });
        client.send('chat.visit', { roomEpoch: this.roomEpoch, visitId: account + 1, location: 'arcade', initialCursor: 0 });
      });
      this.onMessage('chat.send', (client, value: unknown) => {
        const account = sessionAccounts.get(client.sessionId);
        assert(account !== undefined);
        const request = parseChatV2Send(value);
        assert(request.ok && request.value.roomEpoch === this.roomEpoch && request.value.visitId === account + 1);
        const { messageId, text } = request.value;
        assert(!acceptedIds.has(messageId)); acceptedIds.add(messageId);
        const sent = senderCounts.get(account) ?? 0;
        senderCounts.set(account, sent + 1);
        // Accounts 0 and 1 belong to different SDK worker processes.
        const duplicate = delivery === 'shared-id' && account < 2 && sent === 0;
        const publicationId = duplicate ? sharedPublicationId : randomUUID(), publicationSeq = ++this.publicationSeq;
        publicationIds.add(publicationId);
        client.send('chat.result', { messageId, status: 'accepted' });
        const message = { publicationId, publicationSeq, senderId: client.sessionId, name: 'Synthetic', text, time: Date.now() };
        // Keep the shared-ID fault in the receipt stream. A peer could otherwise see conflicting sequences first.
        const recipients = delivery === 'sender-only' || duplicate ? [client] : this.clients;
        for (const recipient of recipients) {
          const receivingAccount = sessionAccounts.get(recipient.sessionId);
          assert(receivingAccount !== undefined);
          recipient.send('chat.batch', { roomEpoch: this.roomEpoch, visitId: receivingAccount + 1, fromCursor: publicationSeq - 1,
            scannedThrough: publicationSeq, hasMore: false, reset: false, messages: [message] });
        }
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
  const audit = finished.chatAudit;
  assert(audit);
  assert.equal(audit.receipts, 8);
  assert.equal(audit.uniquePublications, delivery === 'shared-id' ? 7 : 8);
  assert.equal(audit.duplicatePublications, delivery === 'shared-id' ? 1 : 0);
  assert.equal(audit.eligiblePublications, audit.uniquePublications);
  assert.equal(audit.witnessedPublications, delivery === 'sender-only' ? 0 : delivery === 'shared-id' ? 6 : 8);
  assert.equal(audit.ineligiblePublications, 0);
  assert.equal(audit.unmatchedWitnesses, 0);
  assert.equal(audit.mismatchedWitnesses, 0);
  assert.equal(audit.changedVisits, 0);
  assert.equal(audit.peerDeliveryP95Ms === null, delivery === 'sender-only');
  const checks = chatAuditChecks(audit), ok = Object.values(checks).every(Boolean);
  assert.equal(checks.chatV2PublicationIdsUnique, delivery !== 'shared-id');
  assert.equal(checks.chatV2PeerDeliveryComplete, delivery === 'peers');
  assert.equal(ok, delivery === 'peers');
  await control.publish({ ok, verdict: ok ? 'synthetic-chat-verified' : 'synthetic-chat-audit-failed', checks, chatAudit: audit });
  const [code] = await exit;
  assert.equal(code, ok ? 0 : 1, diagnostics);
  const report = await readFile(output, 'utf8');
  const verified = JSON.parse(report);
  assert.equal(verified.ok, ok);
  assert.deepEqual(verified.chatAudit, audit);
  assert.deepEqual(verified.serverReport.chatAudit, audit);
  assert.deepEqual(verified.serverReport.checks, checks);
  assert.equal(verified.chatV2.crossHostClockOffsetVerified, true);
  const { beforeStart, afterMeasurement, maxOffsetMs } = verified.chatV2.clock;
  assert.equal(maxOffsetMs, 50);
  assert(beforeStart.checkedAtUnixMs < startAtUnixMs);
  assert(afterMeasurement.checkedAtUnixMs >= startAtUnixMs + profile.seconds * 1000);
  for (const probe of [beforeStart, afterMeasurement]) {
    assert.equal(probe.samples, 3);
    assert(probe.lowerOffsetMs <= 0 && probe.upperOffsetMs >= 0);
    assert(probe.lowerOffsetMs >= -maxOffsetMs && probe.upperOffsetMs <= maxOffsetMs);
  }
  for (const privateValue of [secret, ...tokens, ...acceptedIds, ...publicationIds, ...sessionAccounts.keys()]) {
    assert(!(report + diagnostics).includes(privateValue));
  }
}

for (const [delivery, title] of [
  ['peers', 'two real SDK workers reconcile V2 publications with independent peers'],
  ['sender-only', 'sender echoes across two real SDK workers do not prove delivery to peers'],
  ['shared-id', 'two real SDK workers reject a publication ID shared across their receipts'],
] as const) {
  test(title, { timeout: 25000 }, t => runDeliveryFixture(t, delivery));
}
