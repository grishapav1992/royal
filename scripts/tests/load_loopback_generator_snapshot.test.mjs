import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { installControlSnapshot, snapshotControlPort } from '../load-loopback-generator-snapshot.mjs';

const project = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runId = '00000000-0000-4000-8000-000000000001';
const prepared = { runId, ready: [], clientHost: { platform: 'linux', hostFingerprint: '0'.repeat(64) },
  inputMode: 'browser-window', gameProcesses: 20,
  connectionPhase: { durationSeconds: 1, batches: 1, connectionAttempts: 4, connectionRetries: 0 } };
const setup = async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'royal-generator-snapshot-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'snapshot.json'), calls = [], response = {};
  const target = { fetch: (input, init) => { calls.push({ input, init }); return Promise.resolve(response); } };
  const original = target.fetch, restore = installControlSnapshot({ controlPort: 17101, output, target });
  t.after(restore);
  const post = (path, body, headers = { Authorization: 'Bearer private-fixture', Cookie: 'royal_session=private-fixture' }) => {
    const init = { method: 'POST', headers, body: JSON.stringify(body) };
    return { init, promise: target.fetch('http://127.0.0.1:17101' + path, init) };
  };
  return { directory, output, calls, response, target, original, post };
};

test('only one explicit numeric control port is accepted', () => {
  assert.equal(snapshotControlPort(['node', 'entry', '--control-port', '17101']), 17101);
  for (const argv of [[], ['--control-port', '0'], ['--control-port', '65536'], ['--control-port', '1e4'],
    ['--control-port', '17101', '--control-port', '17101']]) assert.throws(() => snapshotControlPort(argv), /refused/);
});

test('fixed IPv4 origin and paths leave all other fetch calls untouched', async t => {
  const { target, output, calls } = await setup(t);
  const inputs = ['http://localhost:17101/prepared', 'https://127.0.0.1:17101/prepared',
    'http://127.0.0.1:17102/prepared', 'http://127.0.0.1:17101/other',
    'http://127.0.0.1:17101/prepared?x=1', 'http://127.0.0.1:17101/prepared#fragment',
    'http://user@127.0.0.1:17101/prepared',
    'http://127.0.0.1:17101/prepared', 'http://127.0.0.1:17101/results'];
  for (const [index, input] of inputs.entries()) {
    const init = { method: index < inputs.length - 2 ? 'POST' : 'GET', body: 'untouched' };
    await target.fetch(input, init); assert.equal(calls.at(-1).input, input); assert.equal(calls.at(-1).init, init);
  }
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});

test('snapshot is durable before original fetch and excludes request headers', async t => {
  const { output, response } = await setup(t), calls = [], observed = [];
  const target = { fetch: async (input, init) => {
    observed.push(JSON.parse(await readFile(output))); calls.push({ input, init }); return response;
  } };
  const restore = installControlSnapshot({ controlPort: 17101, output, target }); t.after(restore);
  const post = (path, body) => {
    const init = { method: 'POST', headers: { Authorization: 'Bearer private-fixture', Cookie: 'royal_session=private-fixture' },
      body: JSON.stringify(body) };
    return { init, promise: target.fetch('http://127.0.0.1:17101' + path, init) };
  };
  const first = post('/prepared', prepared); assert.equal(await first.promise, response);
  assert.equal(calls[0].init, first.init);
  assert.deepEqual(observed[0].prepared, prepared);
  const snapshot = JSON.parse(await readFile(output));
  assert.deepEqual(snapshot.prepared, prepared);
  assert.equal(snapshot.partial, true); assert.equal(snapshot.cleanupUnobserved, true);
  assert.equal((await lstat(output)).mode & 0o777, 0o600);
  const results = [{ kind: 'result', connectedClients: 4, diagnostics: { sentPayloadBytes: 100 },
    errors: {}, transport: { implementation: 'ws' } }];
  await post('/results', { runId, results }).promise;
  const bytes = await readFile(output, 'utf8'), final = JSON.parse(bytes);
  assert.deepEqual(final.results, results);
  assert.deepEqual(observed[1].results, results);
  for (const forbidden of ['private-fixture', 'Authorization', 'Cookie', 'royal_session=']) assert.equal(bytes.includes(forbidden), false);
  assert.equal(final.preparedObservedAtMs <= final.resultsObservedAtMs, true);
});

test('unknown fields, nested credentials and oversized payload refuse before fetch', async t => {
  for (const change of [{ extra: 1 }, { ready: [{ tokens: ['private-token'] }] },
    { ready: [{ note: 'royal_session=private-token' }] }, { ready: [{ note: 'x'.repeat(6 * 1024 ** 2) }] }]) {
    const fixture = await setup(t);
    await assert.rejects(fixture.post('/prepared', { ...prepared, ...change }).promise, /refused/);
    assert.equal(fixture.calls.length, 0);
    await assert.rejects(readFile(fixture.output), { code: 'ENOENT' });
  }
});

test('private parent and existing output protect unrelated files before fetch', async t => {
  const publicParent = await setup(t);
  await chmod(publicParent.directory, 0o755);
  await assert.rejects(publicParent.post('/prepared', prepared).promise, /refused/);
  assert.equal(publicParent.calls.length, 0);
  const existing = await setup(t);
  await writeFile(existing.output, 'unrelated', { mode: 0o600 });
  await assert.rejects(existing.post('/prepared', prepared).promise, /refused/);
  assert.equal(await readFile(existing.output, 'utf8'), 'unrelated');
  const alias = await setup(t), destination = join(alias.directory, 'unrelated.txt');
  await writeFile(destination, 'unrelated', { mode: 0o600 });
  await symlink(destination, alias.output);
  await assert.rejects(alias.post('/prepared', prepared).promise, /refused/);
  assert.equal(await readFile(destination, 'utf8'), 'unrelated');
});

test('original response and rejection identity are preserved after a successful write', async t => {
  const { target, output, post, response } = await setup(t);
  assert.equal(await post('/prepared', prepared).promise, response);
  const failure = Error('private failure message');
  const another = join(dirname(output), 'failure.json');
  const rejectionTarget = { fetch: () => Promise.reject(failure) };
  const restore = installControlSnapshot({ controlPort: 17101, output: another, target: rejectionTarget }); t.after(restore);
  await assert.rejects(rejectionTarget.fetch('http://127.0.0.1:17101/prepared',
    { method: 'POST', body: JSON.stringify(prepared) }), error => error === failure);
  assert.deepEqual(JSON.parse(await readFile(another)).prepared, prepared);
  assert.equal(typeof target.fetch, 'function');
});

test('actual four-client server payloads are recorded without transforming generator results', async t => {
  const { output, post } = await setup(t);
  let server;
  try { server = JSON.parse(await readFile(join(project, 'artifacts/websocket-capacity-stage-9/4-loopback-control/server.json'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; t.skip('The local four-client Linux evidence is unavailable'); return; }
  const phase = server.connectionPhase;
  const actualPrepared = { ...prepared, ready: phase.generators,
    connectionPhase: { durationSeconds: phase.durationSeconds, batches: phase.batches,
      connectionAttempts: phase.connectionAttempts, connectionRetries: phase.connectionRetries } };
  await post('/prepared', actualPrepared).promise;
  await post('/results', { runId, results: server.generators }).promise;
  const snapshot = JSON.parse(await readFile(output));
  assert.deepEqual(snapshot.results, server.generators);
  assert.deepEqual(snapshot.prepared.ready, server.connectionPhase.generators);
  assert.equal(snapshot.cleanupUnobserved, true);
});
