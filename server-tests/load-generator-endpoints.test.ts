import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, type SeatReservation } from '@colyseus/sdk';
import { attestGeneratorApiOrigins, generatorApiOrigins, generatorBatchApiIndex, generatorWebSocketEndpoint } from '../scripts/load-generator-endpoints';
import type { StandManifest } from '../scripts/load-stand-contract';

const canonical = 'http://127.0.0.1:17100', control = 'http://127.0.0.1:17101';
const manifest: StandManifest = { protocol: 1, role: 'isolated-test-stand', runId: 'e67dc241-1a2e-4b3f-91d0-037b901c929e',
  secret: 'a'.repeat(64), createdAt: Date.now(), expiresAt: Date.now() + 60000, apiEndpoint: canonical, controlEndpoint: control,
  serverApiPort: 38001, serverControlPort: 38002, bundleSha256: 'b'.repeat(64), clients: 600, seconds: 30, gameProcesses: 20,
  serverHost: { platform: 'linux', arch: 'x64', logicalCPUs: 20, ramGiB: 96, hostFingerprint: 'c'.repeat(64) }, tokens: [] };
const status = () => ({ protocol: manifest.protocol, role: manifest.role, runId: manifest.runId,
  bundleSha256: manifest.bundleSha256, clients: manifest.clients, seconds: manifest.seconds, expiresAt: manifest.expiresAt,
  apiEndpoint: manifest.apiEndpoint, gameProcesses: manifest.gameProcesses, serverHost: manifest.serverHost });

test('default generators keep the canonical API origin', () => {
  assert.deepEqual(generatorApiOrigins(undefined, 4, canonical, control), Array(4).fill(canonical));
  const endpoint = 'ws://127.0.0.1:17100/workers/worker-19/pid/room?sessionId=session';
  assert.equal(generatorWebSocketEndpoint(endpoint, canonical), endpoint);
});
test('API alias ports cover all generators, remain unique and exclude control', () => {
  assert.deepEqual(generatorApiOrigins('17100,17102,17103,17104', 4, canonical, control),
    [17100, 17102, 17103, 17104].map(port => 'http://127.0.0.1:' + port));
  for (const ports of ['17100,17102', '17100,17102,17102,17104', '17100,17101,17103,17104', '17100,17102,65536,17104', '17100,,17103,17104', '17100,17102,1e4,17104']) {
    assert.throws(() => generatorApiOrigins(ports, 4, canonical, control), /invalid-generator-api-ports/);
  }
  assert.equal(generatorApiOrigins(Array.from({ length: 128 }, (_, index) => 17200 + index).join(','), 4, canonical, control).length, 128);
  assert.throws(() => generatorApiOrigins(Array.from({ length: 129 }, (_, index) => 17200 + index).join(','), 4, canonical, control), /invalid-generator-api-ports/);
});
test('exactly one alias per generator stays fixed through successive batches', () => {
  for (let batch = 0; batch < 150; batch++) for (let generator = 0; generator < 4; generator++) {
    assert.equal(generatorBatchApiIndex(4, 4, generator, batch), generator);
  }
});
test('600 clients in four SDK generators use all twenty carriers without changing child occupancy', () => {
  const perGenerator = [0, 0, 0, 0], perAlias = Array<number>(20).fill(0), used = Array.from({ length: 4 }, () => new Set<number>());
  let batch = 0;
  while (perGenerator.some(count => count < 150)) for (let generator = 0; generator < 4; generator++) {
    const clients = Math.min(4, 150 - perGenerator[generator]); if (!clients) continue;
    const alias = generatorBatchApiIndex(20, 4, generator, batch++);
    perGenerator[generator] += clients; perAlias[alias] += clients; used[generator].add(alias);
  }
  assert.deepEqual(perGenerator, [150, 150, 150, 150]);
  assert.equal(perAlias.reduce((sum, n) => sum + n, 0), 600);
  assert.equal(Math.min(...perAlias), 28); assert.equal(Math.max(...perAlias), 32);
  assert.deepEqual(used.map(aliases => aliases.size), [5, 5, 5, 5]);
  for (const args of [[3, 4, 0, 0], [129, 4, 0, 0], [20, 4, 4, 0], [20, 4, 0, -1], [20, 4, 0, 0.5]]) {
    assert.throws(() => generatorBatchApiIndex(...args as [number, number, number, number]), /invalid-generator-api-assignment/);
  }
});
test('all API aliases attest the same canonical stand before returning', async () => {
  const origins = generatorApiOrigins(Array.from({ length: 20 }, (_, index) => 17200 + index).join(','), 4, canonical, control), seen: string[] = [];
  await attestGeneratorApiOrigins(origins, manifest, async origin => { seen.push(origin); return status(); });
  assert.deepEqual(seen, origins);
  await assert.rejects(attestGeneratorApiOrigins(origins, manifest, async origin => origin === origins[19] ? { ...status(), bundleSha256: 'd'.repeat(64) } : status()), /stand-attestation-mismatch/);
});
test('a wrong run, bundle, host, profile or canonical API rejects an alias', async () => {
  for (const change of [{ runId: 'other' }, { bundleSha256: 'd'.repeat(64) }, { gameProcesses: 4 },
    { serverHost: { ...manifest.serverHost, hostFingerprint: 'd'.repeat(64) } }, { apiEndpoint: 'http://127.0.0.1:17102' }]) {
    const seen: string[] = [], origins = generatorApiOrigins('17100,17102,17103,17104', 4, canonical, control);
    await assert.rejects(attestGeneratorApiOrigins(origins, manifest, async origin => {
      seen.push(origin); return seen.length === 2 ? { ...status(), ...change } : status();
    }));
    assert.deepEqual(seen, origins.slice(0, 2));
  }
});
test('actual SDK publicAddress endpoint is routed through its attested generator alias', () => {
  class ProbeClient extends Client {
    endpoint(reservation: SeatReservation) {
      return generatorWebSocketEndpoint(super.buildEndpoint(reservation, { sessionId: 'session' }), 'http://127.0.0.1:17103', canonical);
    }
  }
  const client = new ProbeClient('http://127.0.0.1:17103');
  const result = new URL(client.endpoint({ name: 'lobby', roomId: 'room', processId: 'pid', sessionId: 'session', publicAddress: '127.0.0.1:17100/workers/worker-19' }));
  assert.equal(result.host, '127.0.0.1:17103');
  assert.equal(result.pathname, '/workers/worker-19/pid/room');
  assert.equal(result.searchParams.get('sessionId'), 'session');
});
test('unexpected reservation endpoints cannot be redirected to an alias', () => {
  for (const endpoint of ['ws://192.0.2.1/workers/main/pid/room', 'ws://127.0.0.1:17105/workers/main/pid/room',
    'ws://user@127.0.0.1:17100/workers/main/pid/room', 'wss://127.0.0.1:17100/workers/main/pid/room',
    'ws://127.0.0.1:17100/other/pid/room', 'ws://127.0.0.1:17100/workers/worker-24/pid/room',
    'ws://127.0.0.1:17100/workers/main/pid/room#fragment']) {
    assert.throws(() => generatorWebSocketEndpoint(endpoint, 'http://127.0.0.1:17102', canonical), /unexpected-generator-websocket-endpoint/);
  }
  assert.throws(() => generatorWebSocketEndpoint('ws://127.0.0.1:17100/workers/main/pid/room', 'http://example.test:17102', canonical));
});
