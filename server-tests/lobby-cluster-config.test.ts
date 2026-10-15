import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lobbyClusterConfig } from '../server/lobbyCluster';

test('single process mode stays independent of Redis', () => {
  assert.equal(lobbyClusterConfig({}), undefined);
  assert.equal(lobbyClusterConfig({ LOBBY_WORKER_ONLY: 'false' }), undefined);
  assert.throws(() => lobbyClusterConfig({ LOBBY_WORKER_ONLY: 'true' }));
  assert.throws(() => lobbyClusterConfig({ LOBBY_WORKER_ID: 'worker-1' }));
});

test('cluster addresses preserve the public origin and identify a worker', () => {
  const config = lobbyClusterConfig({ REDIS_URL: 'redis://127.0.0.1:6379/0', PUBLIC_ORIGIN: 'https://example.test', LOBBY_WORKER_ID: 'worker-1', LOBBY_WORKER_ONLY: 'true' });
  assert.equal(config?.publicAddress, 'example.test/workers/worker-1');
  assert.equal(config?.workerOnly, true);
  const local = lobbyClusterConfig({ REDIS_URL: 'redis://127.0.0.1:6379', PUBLIC_ORIGIN: 'http://127.0.0.1:15000', LOBBY_WORKER_ID: 'main' });
  assert.equal(local?.publicAddress, '127.0.0.1:15000/workers/main');
});

test('unsafe or incomplete cluster routing configuration fails before connection', () => {
  const env = { REDIS_URL: 'redis://127.0.0.1:6379', PUBLIC_ORIGIN: 'https://example.test', LOBBY_WORKER_ID: 'main' };
  for (const REDIS_URL of ['http://example.test', 'invalid', 'redis://127.0.0.1/#secret']) assert.throws(() => lobbyClusterConfig({ ...env, REDIS_URL }));
  for (const PUBLIC_ORIGIN of ['https://example.test/path', 'https://user:password@example.test', 'https://example.test?query=1', 'https://example.test/#fragment']) assert.throws(() => lobbyClusterConfig({ ...env, PUBLIC_ORIGIN }));
  for (const LOBBY_WORKER_ID of ['', 'A', '../main', 'workers/main', 'a'.repeat(33)]) assert.throws(() => lobbyClusterConfig({ ...env, LOBBY_WORKER_ID }));
  assert.throws(() => lobbyClusterConfig({ ...env, NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://example.test' }));
  assert.throws(() => lobbyClusterConfig({ ...env, LOBBY_WORKER_ONLY: 'yes' }));
  assert.throws(() => lobbyClusterConfig({ ...env, LOBBY_WORKER_ONLY: 'true' }));
  assert.throws(() => lobbyClusterConfig({ ...env, LOBBY_WORKER_ID: 'worker-1', LOBBY_WORKER_ONLY: 'false' }));
});
