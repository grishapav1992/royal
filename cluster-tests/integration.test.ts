import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import { RedisPresence } from '@colyseus/redis-presence';
import { Client, type Room } from '@colyseus/sdk';
import { chromium } from '@playwright/test';
import type { LobbyState } from '../server/state';
import { LobbyCluster, lobbyClusterConfig } from '../server/lobbyCluster';
import { READY_PROCESSES_KEY, workerLeaseKey } from '../server/clusterRegistry';
import { configureReconnection } from '../src/network/reconnection';
import { temporaryRedis, freeLocalPort } from '../scripts/temporary-redis';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
class TestPresence extends RedisPresence {
  async closeConnections() {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
    this.pub.disconnect(); this.sub.disconnect();
  }
}
async function eventually(check: () => boolean | Promise<boolean>, timeout = 10000) {
  const until = performance.now() + timeout;
  do { if (await check()) return; await delay(50); } while (performance.now() < until);
  assert.fail('Expected state was not reached');
}

test('real Redis routes rooms across four processes and preserves access and reconnection', { timeout: 120000 }, async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.PGDATABASE, 'royal_test');
  process.env.AUTH_DB_PATH = 'royal_ws_cluster';
  const { accounts } = await import('../server/accounts');
  const redis = await temporaryRedis();
  const observer = new Redis(redis.url, { maxRetriesPerRequest: 1 }); observer.on('error', () => {});
  const presence = new TestPresence(redis.url);
  const probes: LobbyCluster[] = [];
  const children = new Map<string, ChildProcess>(), logs = new Map<string, string>();
  const rooms: Room<LobbyState>[] = [], proxies = new Map<string, Socket>(), sockets = new Set<Socket>();
  let phase = 'startup';
  const failures: { code: number | undefined; message?: string; phase: string }[] = [];
  const expectedTransportErrors = new Set<Room<LobbyState>>();
  let inducedTransportErrors = 0;
  const front = createServer((req, res) => {
    const route = routed(req.url || '/');
    const upstream = request({ hostname: '127.0.0.1', port: route.port, path: route.path, method: req.method,
      headers: { ...req.headers, 'x-forwarded-proto': 'http' } }, reply => {
      res.writeHead(reply.statusCode || 502, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  front.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const workerIds = ['main', 'worker-1', 'worker-2', 'worker-3'];
  const ports = new Map<string, number>();
  for (const id of workerIds) ports.set(id, await freeLocalPort());
  function routed(url: string) {
    const match = url.match(/^\/workers\/([a-z0-9-]+)(\/.*)$/);
    return { port: ports.get(match?.[1] ?? 'main')!, path: match?.[2] ?? url };
  }
  front.on('upgrade', (req, socket, head) => {
    const route = routed(req.url || '/'), sessionId = new URL(req.url!, 'http://local').searchParams.get('sessionId')!;
    const upstream = connect(route.port, '127.0.0.1');
    sockets.add(upstream); proxies.set(sessionId, socket as Socket);
    upstream.once('connect', () => {
      const headers: string[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push(req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
      upstream.write(`${req.method} ${route.path} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
    socket.on('close', () => { upstream.destroy(); if (proxies.get(sessionId) === socket) proxies.delete(sessionId); });
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const report: { productionTraffic: boolean; processes: number; maxRoomsPerProcess: number; scenarios: string[]; roomOwners?: string[]; drainedOwner?: string; recoveredOwner?: string; inducedTransportErrors?: number; passed?: boolean }
    = { productionTraffic: false, processes: 4, maxRoomsPerProcess: 1, scenarios: [] };
  const passed = report.scenarios;
  const runCase = async (name: string, action: () => Promise<void>) => {
    phase = name;
    let complete = false;
    await t.test(name, async () => { await action(); complete = true; });
    assert(complete, 'Cluster scenario failed: ' + name);
  };
  const fixture: Awaited<ReturnType<typeof accounts.login>>[] = [];
  const addRoom = (room: Room<LobbyState>) => {
    rooms.push(room); configureReconnection(room.reconnection);
    for (const type of ['chat', 'piano-note', 'notice', 'history', 'activities', 'chat-check', 'security', 'ejected']) room.onMessage(type, () => {});
    room.onError((code, message) => {
      // The Node WebSocket adapter reports an uncoded error on deliberate TCP
      // termination. Accept it once, only for a connection we are about to drop.
      if (code === undefined && expectedTransportErrors.delete(room)) inducedTransportErrors++;
      else failures.push({ code, message, phase });
    });
    return room;
  };
  let endpoint = '';
  const sdk = (index: number) => new Client(endpoint, { headers: { Cookie: 'royal_session=' + fixture[index].token } });
  const api = (index: number, path: string, body: unknown = {}) => fetch(endpoint + path, {
    method: 'POST', headers: { Cookie: 'royal_session=' + fixture[index].token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const owner = (room: Room<LobbyState>) => new URL(room.connection.url!).pathname.split('/')[2];
  const closeChild = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    try { await done; } finally { clearTimeout(timer); }
  };
  try {
    await accounts.ready;
    for (let index = 0; index < 40; index++) {
      const account = await accounts.login(`cluster-${crypto.randomUUID()}@example.test`, 'Cluster-test-123!');
      await accounts.select(account.account.id, index % 6); fixture.push(account);
    }
    await accounts.events.connect(presence, { topic: 'royal:account-events:' + accounts.schema });
    await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
    endpoint = 'http://127.0.0.1:' + (front.address() as { port: number }).port;
    for (const id of workerIds) {
      const child = spawn(process.execPath, ['dist-server/index.js'], { env: { ...process.env, PORT: String(ports.get(id)),
        REDIS_URL: redis.url, PUBLIC_ORIGIN: endpoint, LOBBY_WORKER_ID: id, LOBBY_WORKER_ONLY: String(id !== 'main'),
        LOBBY_MAX_ROOMS: '1', LOBBY_MATCHMAKING_BURST: '1000', LOBBY_AUTH_CONCURRENCY: '4', PGPOOL_MAX: '6',
        CODEX_SALE_API_KEY: '', NOWPAYMENTS_ENABLED: 'false', CASINOAPIPRO_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
      children.set(id, child); logs.set(id, '');
      for (const stream of [child.stdout, child.stderr]) stream!.on('data', chunk => logs.set(id, logs.get(id)! + String(chunk)));
    }
    await eventually(async () => {
      for (const [id, port] of ports) {
        if (children.get(id)!.exitCode !== null) throw new Error('Cluster process exited during startup: ' + id);
        try { if (!(await fetch('http://127.0.0.1:' + port + '/healthz')).ok) return false; } catch { return false; }
      }
      return Object.keys(await observer.hgetall(READY_PROCESSES_KEY)).length === 4;
    }, 30000);
    await runCase('startup registration cannot overwrite another worker or become ready after failure', async () => {
      const config = lobbyClusterConfig({ REDIS_URL: redis.url, PUBLIC_ORIGIN: endpoint, LOBBY_WORKER_ID: 'runtime-test', LOBBY_WORKER_ONLY: 'true' })!;
      const probe = new LobbyCluster(config, () => {}); probes.push(probe); await probe.start();
      const duplicate = new LobbyCluster(config, () => {}); probes.push(duplicate);
      await assert.rejects(duplicate.start(), /already in use/);
      probe.fail(); await assert.rejects(probe.activate('probe-failed'), /unavailable/);
      assert.equal(await observer.hget(READY_PROCESSES_KEY, 'probe-failed'), null);
      await probe.stop(); probe.presence.shutdown(); await probe.driver.shutdown();
      const stale = new LobbyCluster({ ...config, workerId: 'runtime-stale' }, () => {}); probes.push(stale); await stale.start();
      await observer.set(workerLeaseKey('runtime-stale'), 'replacement', 'EX', 30);
      const replacementRegistration = JSON.stringify({ workerId: 'runtime-stale', owner: 'replacement' });
      await observer.hset(READY_PROCESSES_KEY, 'probe-new-owner', replacementRegistration);
      await assert.rejects(stale.activate('probe-stale'), /unavailable/);
      assert.equal(await observer.hget(READY_PROCESSES_KEY, 'probe-stale'), null);
      assert.equal(await observer.hget(READY_PROCESSES_KEY, 'probe-new-owner'), replacementRegistration);
      await observer.hdel(READY_PROCESSES_KEY, 'probe-new-owner');
      await stale.stop(); assert.equal(await observer.get(workerLeaseKey('runtime-stale')), 'replacement');
      stale.presence.shutdown(); await stale.driver.shutdown(); passed.push('startup-owner-and-failure-fencing');
    });
    const anchors: Room<LobbyState>[] = [];
    await runCase('four rooms have four distinct owners and full capacity refuses a fifth room', async () => {
      for (let index = 0; index < 4; index++) anchors.push(addRoom(await sdk(index).create<LobbyState>('lobby', { activityProtocol: 1 })));
      await eventually(() => anchors.every(room => !!room.state.players?.get(room.sessionId)));
      assert.deepEqual(anchors.map(owner).sort(), workerIds.slice().sort());
      await assert.rejects(sdk(4).create('lobby'), { code: 503 });
      for (let index = 0; index < anchors.length; index++) {
        const room = anchors[index], player = room.state.players.get(room.sessionId)!;
        room.send('inputs', { revision: player.hallRevision, inputs: [{ seq: 1, x: 1, y: 0, ms: 1000 / 60 }] });
      }
      await eventually(() => anchors.every(room => room.state.players.get(room.sessionId)!.inputSeq >= 1));
      report.roomOwners = anchors.map(owner); passed.push('four-process-room-routing-and-capacity');
    });
    const remoteIndex = anchors.findIndex(room => owner(room) !== 'main'), remote = anchors[remoteIndex];
    await runCase('worker HTTP matchmaking and API background endpoints are not alternate ingress', async () => {
      const response = await fetch(endpoint + '/workers/worker-1/matchmake/create/lobby', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'royal_session=' + fixture[4].token }, body: '{}' });
      assert.equal(response.status, 403);
      assert.equal((await fetch(endpoint + '/workers/worker-1/api/auth/me')).status, 404);
      passed.push('single-api-ingress');
    });
    await runCase('one account cannot occupy a second process, including during reconnection grace', async () => {
      const other = anchors.find(room => owner(room) !== owner(remote))!;
      await assert.rejects(sdk(remoteIndex).joinById(other.roomId), { code: 409 });
      const beforeId = remote.sessionId, beforeOwner = owner(remote);
      let dropped = false, resumed = false;
      remote.onDrop(() => { dropped = true; }); remote.onReconnect(() => { resumed = true; });
      expectedTransportErrors.add(remote); proxies.get(remote.sessionId)!.destroy();
      await eventually(() => dropped);
      await assert.rejects(sdk(remoteIndex).joinById(other.roomId), { code: 409 });
      assert.equal((await api(remoteIndex, '/api/auth/character', { skin: 3, name: 'Cluster reconnect' })).status, 200);
      await eventually(() => resumed && remote.state.players.get(remote.sessionId)?.connected === true);
      assert.equal(remote.sessionId, beforeId); assert.equal(owner(remote), beforeOwner);
      await eventually(() => remote.state.players.get(remote.sessionId)?.name === 'Cluster reconnect' && remote.state.players.get(remote.sessionId)?.skin === 3);
      passed.push('cross-process-duplicate-refusal-and-same-owner-reconnect');
    });
    await runCase('profile, drinking and security events reach a remote room through authoritative state', async () => {
      assert.equal((await api(remoteIndex, '/api/auth/profile', { name: 'Remote profile' })).status, 200);
      await eventually(() => remote.state.players.get(remote.sessionId)?.name === 'Remote profile');
      const dose = await accounts.drinking.consume(fixture[remoteIndex].account.id, 'beer');
      await eventually(() => remote.state.players.get(remote.sessionId)?.soberAt === dose.soberAt);
      const warning = await accounts.moderation.record(fixture[remoteIndex].account.id); accounts.events.emit('security', fixture[remoteIndex].account.id, warning);
      await eventually(() => remote.state.players.get(remote.sessionId)?.security === 'warning');
      passed.push('remote-profile-drinking-and-security-events');
    });
    await runCase('a browser uses the owner route and keeps its session after network loss', async () => {
      const available = anchors.find(room => owner(room) !== 'main' && room !== remote)!;
      browser = await chromium.launch({ channel: 'chrome' }); const context = await browser.newContext();
      await context.addCookies([{ name: 'royal_session', value: fixture[35].token, url: endpoint }]);
      const page = await context.newPage(), paths: string[] = [], errors: string[] = [];
      page.on('websocket', socket => paths.push(new URL(socket.url()).pathname)); page.on('pageerror', error => errors.push(error.message));
      await page.goto(endpoint + '/?room=' + available.roomId, { waitUntil: 'domcontentloaded' });
      const network = () => page.evaluate(() => (window as any).royalDemo?.getNetworkState());
      await eventually(async () => (await network())?.status === 'connected', 15000);
      const before = await network();
      proxies.get(before.selfId)!.destroy();
      await eventually(async () => paths.length >= 2 && (await network())?.status === 'connected', 15000);
      assert.equal((await network()).selfId, before.selfId);
      assert(paths.every(path => path.startsWith('/workers/' + owner(available) + '/')));
      assert.deepEqual(errors, []); await context.close(); await browser.close(); browser = undefined;
      passed.push('browser-owner-route-and-reconnect');
    });
    await runCase('a full room routes new players to another existing room and leaves it usable', async () => {
      const anchor = anchors.find(room => room !== remote)!, occupied = [anchor];
      for (let index = 4; index < 33; index++) occupied.push(addRoom(await sdk(index).joinById<LobbyState>(anchor.roomId)));
      await eventually(() => occupied.every(room => room.state.players?.size === 30));
      const routed = addRoom(await sdk(33).joinOrCreate<LobbyState>('lobby'));
      assert.notEqual(routed.roomId, anchor.roomId);
      await assert.rejects(sdk(34).joinById(anchor.roomId));
      passed.push('full-room-uses-existing-free-room');
    });
    await runCase('logout through the API revokes the remote connection without disturbing other rooms', async () => {
      let left = false; remote.onLeave(() => { left = true; }); remote.reconnection.enabled = false;
      assert.equal((await api(remoteIndex, '/api/auth/logout')).status, 200);
      await eventually(() => left);
      await assert.rejects(sdk(remoteIndex).joinOrCreate('lobby'), { code: 401 });
      assert(anchors.filter(room => room !== remote).every(room => room.connection.isOpen));
      passed.push('remote-logout');
    });
    await runCase('draining a process removes it from discovery and empty live capacity recovers', async () => {
      const draining = anchors.find(room => room !== remote && owner(room) !== 'main')!;
      const drainedId = owner(draining); report.drainedOwner = drainedId;
      for (const room of rooms) if (owner(room) === drainedId && room.connection.isOpen) {
        room.reconnection.enabled = false; expectedTransportErrors.add(room);
      }
      const ready = await observer.hgetall(READY_PROCESSES_KEY);
      const drainedPid = Object.keys(ready).find(pid => JSON.parse(ready[pid]).workerId === drainedId)!;
      await closeChild(children.get(drainedId)!);
      assert.equal(draining.connection.isOpen, false);
      assert(anchors.filter(room => room !== remote && owner(room) !== drainedId).every(room => room.connection.isOpen));
      assert.equal(await observer.hget(READY_PROCESSES_KEY, drainedPid), null);
      const freed = anchors.find(room => room !== remote && owner(room) !== drainedId)!;
      await Promise.all(rooms.filter(room => room.roomId === freed.roomId && room.connection.isOpen).map(room => room.leave()));
      await eventually(async () => {
        try { const room = addRoom(await sdk(36).create<LobbyState>('lobby')); report.recoveredOwner = owner(room); return true; }
        catch (error) { if ((error as { code: number }).code !== 503) throw error; return false; }
      });
      assert.notEqual(report.recoveredOwner, drainedId); passed.push('drain-and-capacity-recovery');
    });
    await runCase('loss of Redis shuts down active processes instead of keeping stale authorization', async () => {
      for (const room of rooms) room.reconnection.enabled = false;
      await accounts.events.close(); await presence.closeConnections();
      for (const room of rooms) if (room.connection.isOpen) expectedTransportErrors.add(room);
      await redis.stop();
      await eventually(() => [...children.values()].every(child => child.exitCode !== null || child.signalCode !== null), 15000);
      assert(rooms.every(room => !room.connection.isOpen));
      for (const [id, child] of children) if (id !== report.drainedOwner) assert.equal(child.exitCode, 1);
      passed.push('redis-failure-closes-stale-connections');
    });
    assert.deepEqual(failures, []);
    report.inducedTransportErrors = inducedTransportErrors;
    report.passed = true;
  } finally {
    if (browser) await browser.close();
    for (const room of rooms) { room.reconnection.enabled = false; if (room.connection.isOpen) room.connection.close(1000); }
    await Promise.all([...children.values()].map(closeChild));
    for (const socket of sockets) socket.destroy();
    if (front.listening) { front.closeAllConnections(); await new Promise<void>(resolve => front.close(() => resolve())); }
    for (const probe of probes) { await probe.stop(); probe.presence.shutdown(); await probe.driver.shutdown().catch(() => {}); }
    await accounts.close(); await presence.closeConnections(); observer.disconnect(); await redis.cleanup();
    for (const [id, log] of logs) await writeFile('artifacts/websocket-cluster/' + id + '.log', log);
    await writeFile('artifacts/websocket-cluster/integration-result.json', JSON.stringify(report, null, 2) + '\n');
  }
});
