import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { assessRemoteStage, boundedCommand, runRemoteWebsocketStage, validateRemoteStagePlan } from '../run-remote-websocket-stage.mjs';

const sha = 'a'.repeat(64), id = 'b'.repeat(64), standRunId = '11111111-1111-4111-8111-111111111111';
const runId = 's8-testcase1';
const production = {
  game: { Id: id, Image: 'sha256:' + sha, StartedAt: '2026-10-11T10:00:00.000000000Z' },
  caddy: { Id: sha, Image: 'sha256:' + id, StartedAt: '2026-10-11T10:01:00.000000000Z' },
};
const runtimeFiles = Object.fromEntries(['frozen-server.mjs', 'dist-load/cluster.mjs', 'dist-load/database.mjs',
  'dist-load/metrics.mjs', 'dist-load/metadata.json', 'runtime-check.mjs', 'bin/caddy', 'bin/redis-server'].map(path => [path, sha]));
const plan = {
  protocol: 1, runId, ownedRoot: '/opt/royal-load-' + runId, containerName: 'royal-load-' + runId + '-test',
  ssh: { host: 'root@45.192.12.242', identityFile: join(homedir(), '.ssh', 'royal_server_ed25519'), port: 22 },
  stage: { clients: 100, seconds: 10, inputMode: 'browser-window', workers: 4 }, localPorts: { api: 17100, control: 17101 },
  supervisor: { path: 'load-remote-stand.py', sha256: sha }, guardSha256: sha, runtimeFiles,
  bundleSha256: sha, runtimeSha256: sha, runtimeArchive: 'offline-runtime.tar.gz', frozenServer: 'frozen-server.mjs',
  manifestPath: 'run/stage-100-private.json', artifacts: { server: 'run/stage-100-server.json', guard: 'run/stage-100-guard.json',
    guardSamples: 'run/stage-100-guard.jsonl', supervisor: 'run/stage-100-supervisor.json' }, production, outputDir: '/private/tmp/placeholder',
};
const outcome = { standRunId, generatorExitCode: 0, attestation: { manifestDigest: true, control: true, gameApi: true, beforeGenerators: true },
  testStopConfirmed: true, remotePrivateFixtureCleanupConfirmed: true, localPrivateFixtureCleanupConfirmed: true,
  tunnelStopConfirmed: true, productionImageAndStartUnchanged: true };
const reports = {
  server: { ok: true, productionTraffic: false, targetClients: 100, measurementSeconds: 10, cleanup: { passed: true },
    bundle: { sha256: sha }, stand: { runId: standRunId }, checks: { connections: true, generatorSustainedTarget: true } },
  generator: { ok: true, productionTraffic: false, generatorOnly: true, sdkWebSocket: 'ws', runId: standRunId, bundleSha256: sha,
    targetClients: 100, seconds: 10, inputMode: 'browser-window', cleanup: { passed: true },
    attestation: { control: true, gameApi: true, verifiedBeforeGenerators: true }, serverReport: { ok: true } },
  guard: { runId, container: plan.containerName, reason: 'container-ended', stopped: false, samples: 1, healthChecks: 1 },
  guardSamples: [{}], supervisor: { runId, container: plan.containerName, passed: true, reason: 'container-ended',
    started: true, stopConfirmed: true, guardExitCode: 0, containerExitCode: 0 },
};
const reorderedProduction = () => Object.fromEntries(['caddy', 'game'].map(service => [service,
  Object.fromEntries(['StartedAt', 'Image', 'Id'].map(key => [key, production[service][key]]))]));

test('rejects unapproved target, workload and artifact ownership', () => {
  for (const change of [
    { ssh: { ...plan.ssh, host: 'root@other.invalid' } }, { ownedRoot: '/opt/royal' },
    { stage: { ...plan.stage, seconds: 1801 } }, { stage: { ...plan.stage, inputMode: 'stress' } },
    { stage: { ...plan.stage, workers: 8 } }, { stage: { ...plan.stage, sdkWebSocket: 'native' } },
    { artifacts: { ...plan.artifacts, extra: 'run/extra.json' } },
    { runtimeFiles: { ...runtimeFiles, 'bin/unowned': sha } }, { guardSha256: 'x' },
  ]) assert.throws(() => validateRemoteStagePlan({ ...plan, ...change }));
  assert.equal(validateRemoteStagePlan(plan).startStand, false);
  assert.equal(validateRemoteStagePlan(plan).stage.sdkWebSocket, 'ws');
});
test('fail-closed verdict rejects incomplete attestation, guard, delivery and cleanup', () => {
  const normalized = validateRemoteStagePlan(plan);
  assert.equal(assessRemoteStage(normalized, outcome, reports).ok, true);
  for (const [key, value] of [['guard', { ...reports.guard, stopped: true }], ['guardSamples', []],
    ['generator', { ...reports.generator, generatorOnly: false }], ['server', { ...reports.server, checks: { generatorSustainedTarget: false } }]]) {
    assert.equal(assessRemoteStage(normalized, outcome, { ...reports, [key]: value }).ok, false);
  }
  for (const change of [{ standRunId: undefined }, { attestation: { control: true } }, { productionImageAndStartUnchanged: false },
    { tunnelStopConfirmed: false }, { missingArtifacts: ['server'] }]) assert.equal(assessRemoteStage(normalized, { ...outcome, ...change }, reports).ok, false);
});

async function failedStage(t, changes = {}, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'royal-runner-regression-')), actions = [];
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await runRemoteWebsocketStage({ ...plan, outputDir: dir, ...changes }, {
    contract: {}, production: async () => reorderedProduction(), availablePort: async () => {},
    copy: async () => { throw Error('absent'); }, ...overrides,
    remote: async (...args) => {
      const [action] = args;
      actions.push(action);
      if (overrides.remote) return overrides.remote(...args);
      if (action === 'start') throw Error('lost reply');
      if (action === 'stop') return { stopConfirmed: true, state: 'exited' };
      if (action === 'cleanup-fixture') return { privateFixtureRemoved: true };
      throw Error('not ready');
    },
  });
  assert.equal(result.ok, false); assert.ok(actions.includes('stop')); assert.ok(actions.includes('cleanup-fixture'));
  assert.equal(result.localPrivateFixtureCleanupConfirmed, true);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'outcome.json'), 'utf8')), JSON.parse(JSON.stringify(result)));
  return { result, actions };
}
test('lost start reply still stops owned stand and removes private fixtures', async t => {
  const { result, actions } = await failedStage(t, { startStand: true });
  assert.deepEqual(actions, ['start', 'stop', 'cleanup-fixture']);
  assert.equal(result.productionImageAndStartUnchanged, true);
});
test('occupied loopback port still cleans already prepared stand', async t => {
  const { actions } = await failedStage(t, {}, { availablePort: async () => { throw Error('port occupied'); } });
  assert.deepEqual(actions, ['stop', 'cleanup-fixture']);
});
test('tunnel cleanup exception cannot skip remote fixture cleanup', async t => {
  const { result } = await failedStage(t, { startStand: true }, { stopTunnel: async () => { throw Error('kill error'); } });
  assert.equal(result.tunnelStopConfirmed, false);
});
test('stale production baseline refuses start while cleaning the owned stand', async t => {
  const { result, actions } = await failedStage(t, { startStand: true }, { production: async () => ({ ...production, game: { ...production.game, Id: sha } }) });
  assert.equal(result.failure, 'stale-production-baseline'); assert.equal(result.productionImageAndStartUnchanged, false);
  assert.deepEqual(actions, ['stop', 'cleanup-fixture']);
});
test('repeated interrupts retain cleanup handlers until fixture cleanup completes', async t => {
  const before = process.listenerCount('SIGINT'), actions = [];
  await failedStage(t, { startStand: true }, { remote: async action => {
    actions.push(action); if (action === 'start') throw Error('lost reply');
    assert.equal(process.listenerCount('SIGINT'), before + 1);
    process.emit('SIGINT'); process.emit('SIGINT');
    return action === 'stop' ? { stopConfirmed: true, state: 'exited' } : { privateFixtureRemoved: true };
  } });
  assert.deepEqual(actions, ['start', 'stop', 'cleanup-fixture']); assert.equal(process.listenerCount('SIGINT'), before);
});
test('complete mocked handoff preserves private manifest and separate UUID until cleanup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'royal-runner-handoff-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifest = { runId: standRunId, bundleSha256: sha, clients: 100, seconds: 10, serverApiPort: 21000,
    serverControlPort: 21001, apiEndpoint: 'http://127.0.0.1:17100', expiresAt: Date.now() + 600000, secret: 'c'.repeat(64) };
  const data = Buffer.from(JSON.stringify(manifest)); let privatePath, attested = false;
  const result = await runRemoteWebsocketStage({ ...plan, outputDir: dir }, {
    contract: { parseStandManifest: value => value, verifyStandStatus() {} }, production: async () => reorderedProduction(),
    availablePort: async () => {}, delay: async () => {}, startTunnel: () => new EventEmitter(), stopTunnel: async () => true,
    attestLocal: async () => { attested = true; },
    remote: async action => action === 'status' ? { runId, container: plan.containerName, containerId: id, state: 'running', phase: 'running',
      guardActive: true, ready: true, standRunId, manifestSha256: createHash('sha256').update(data).digest('hex'),
      serverApiPort: manifest.serverApiPort, serverControlPort: manifest.serverControlPort, bundleSha256: sha }
      : action === 'stop' ? { stopConfirmed: true, state: 'exited' } : { privateFixtureRemoved: true },
    copy: async (path, privateFile) => {
      if (privateFile) return data;
      const key = Object.keys(plan.artifacts).find(key => plan.artifacts[key] === path);
      return Buffer.from(key === 'guardSamples' ? '{}\n' : JSON.stringify(reports[key]));
    }, execute: async (_program, args) => {
      assert.equal(attested, true); assert.ok(args.includes('scripts/load-websocket-generators.ts'));
      assert.ok(!args.some(arg => arg.includes('distributed') || arg.includes('env-file')));
      privatePath = args[args.indexOf('--manifest') + 1];
      assert.equal((await lstat(privatePath)).mode & 0o777, 0o600);
      assert.equal(await readFile(privatePath, 'utf8'), data.toString());
      await writeFile(join(dir, 'generators.json'), JSON.stringify(reports.generator)); return { code: 0 };
    },
  });
  assert.equal(result.ok, true); assert.equal(result.runId, runId); assert.equal(result.standRunId, standRunId);
  assert.equal(result.capacity1000Proven, false);
  await assert.rejects(lstat(dirname(privatePath)), error => error.code === 'ENOENT');
});

test('aborted, output-capped and timed-out commands terminate their owned group', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(boundedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 1000, signal: controller.signal }), error => error.code === 'local-stage-interrupted');
  await assert.rejects(boundedCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096));setInterval(()=>{},1000)'],
    { timeoutMs: 1000, maximum: 64 }), error => error.code === 'command-output-limit');
  await assert.rejects(boundedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 40 }), error => error.code === 'bounded-command-timeout');
  const result = await boundedCommand(process.execPath, ['-e', 'process.stdout.write("done")'], { timeoutMs: 1000 });
  assert.equal(result.code, 0); assert.equal(result.stdout.toString(), 'done');
});
for (const premature of [false, true]) test(premature ? 'parent exit retains the orphan kill watchdog' : 'TERM-ignoring parent and child are both killed', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'royal-command-groups-')), path = join(dir, 'pids.json');
  let pids = [];
  t.after(async () => { for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch {} await rm(dir, { recursive: true, force: true }); });
  const code = `const fs=require('node:fs'),cp=require('node:child_process');${premature ? '' : 'process.on("SIGTERM",()=>{});'}const child=cp.spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(path)},JSON.stringify([process.pid,child.pid]));${premature ? 'setTimeout(()=>process.exit(0),300);' : 'setInterval(()=>{},1000);'}`;
  try { await assert.rejects(boundedCommand(process.execPath, ['-e', code], { timeoutMs: premature ? 2000 : 600 }),
    error => error.code === (premature ? 'owned-process-group-outlived-command' : 'bounded-command-timeout')); }
  finally { try { pids = JSON.parse(await readFile(path, 'utf8')); } catch {} }
  const dead = () => pids.length === 2 && pids.every(pid => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
  for (let n = 0; n < 20 && !dead(); n++) await new Promise(done => setTimeout(done, 50));
  assert.equal(dead(), true);
});
