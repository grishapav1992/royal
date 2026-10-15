import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildLoadGenerators, transformGeneratorSource, transformMetricsSource } from '../build-load-generators.mjs';

const project = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bounded = (promise, seconds = 10) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Bounded test timeout')), seconds * 1000); })])
    .finally(() => clearTimeout(timer));
};
const temporary = async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'royal-portable-generators-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test('source transformations fail closed if worker arguments or metrics main guard change', async () => {
  const generator = await readFile(join(project, 'scripts/load-websocket-generators.ts'), 'utf8');
  const metrics = await readFile(join(project, 'scripts/load-server-metrics.ts'), 'utf8');
  assert.match(transformGeneratorSource(generator), /new URL\('\.\/worker\.mjs', import\.meta\.url\)/);
  assert.throws(() => transformGeneratorSource(generator.replace("'--import', 'tsx'", "'--import', 'other'")), /arguments changed/);
  assert.throws(() => transformGeneratorSource(generator + "\n['--import', 'tsx', 'scripts/load-websocket-worker.ts']"), /arguments changed/);
  assert.match(transformMetricsSource(metrics), /if \(false\) \{/);
  assert.throws(() => transformMetricsSource(metrics.replace('=== fileURLToPath(import.meta.url)', '!== fileURLToPath(import.meta.url)')), /guard changed/);
});

test('builder refuses existing or symlink output without deleting existing data', async t => {
  const root = await temporary(t), output = join(root, 'existing');
  await mkdir(output);
  await assert.rejects(buildLoadGenerators(output), { code: 'EEXIST' });
  const alias = join(root, 'alias'); await symlink(output, alias);
  await assert.rejects(buildLoadGenerators(alias), { code: 'EEXIST' });
  await assert.rejects(buildLoadGenerators(join(alias, 'new')), /Canonical existing output parent/);
  assert.equal((await lstat(output)).isDirectory(), true);
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
});

test('relocated bundles run CLI and worker IPC without tsx, source tree or runtime packages', async t => {
  const root = await temporary(t), build = join(root, 'built'), relocated = join(root, 'relocated');
  const metadata = await buildLoadGenerators(build);
  assert.equal((await lstat(build)).mode & 0o777, 0o700);
  assert.deepEqual(metadata.transformations, { workerArguments: 1, metricsGuards: 2 });
  assert.equal(metadata.workload.loopbackOnly, true);
  assert.equal(metadata.workload.packetsPerSecondPerClient, 30);
  assert.equal(metadata.lockSha256, sha(await readFile(join(project, 'package-lock.json'))));
  assert.equal(Object.keys(metadata.inputs).some(path => path.startsWith('server/')), false);
  for (const [file, expected] of Object.entries(metadata.outputs)) {
    const bytes = await readFile(join(build, file));
    assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256);
    assert.equal((await lstat(join(build, file))).mode & 0o777, 0o600);
  }
  await cp(build, relocated, { recursive: true });
  await rm(build, { recursive: true });
  const env = { NODE_ENV: 'test', LOAD_SDK_WEBSOCKET: 'ws', ...(process.env.PATH ? { PATH: process.env.PATH } : {}) };
  const help = spawnSync(process.execPath, [join(relocated, 'generators.mjs'), '--help'], { cwd: root, env, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /Generator-only runner/);
  assert.equal(help.stderr, '');
  const child = spawn(process.execPath, [join(relocated, 'worker.mjs')], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', value => { stderr += value; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    try { await bounded(exit, 3); } catch { child.kill('SIGKILL'); await bounded(exit, 3); }
  });
  const command = async payload => {
    const response = new Promise((resolve, reject) => {
      const message = value => { cleanup(); resolve(value); };
      const died = () => { cleanup(); reject(Error('Worker exited')); };
      const cleanup = () => { child.off('message', message); child.off('exit', died); };
      child.once('message', message); child.once('exit', died);
      child.send(payload, error => { if (error) { cleanup(); reject(error); } });
    });
    return bounded(response);
  };
  const rejected = await command({ kind: 'connect', endpoint: 'http://192.0.2.1:17100', tokens: [] });
  assert.equal(rejected.kind, 'error');
  const ready = await command({ kind: 'connect', endpoint: 'http://127.0.0.1:17100', tokens: [], concurrency: 4 });
  assert.equal(ready.kind, 'ready'); assert.equal(ready.count, 0); assert.equal(ready.connectedClients, 0);
  assert.equal(ready.connectionAttempts, 0); assert.equal(ready.transport.implementation, 'ws');
  assert.deepEqual(ready.rooms, []); assert.deepEqual(ready.errors, {});
  child.send({ kind: 'shutdown' });
  assert.deepEqual(await bounded(exit, 3), { code: 0, signal: null }); assert.equal(stderr, '');
});
