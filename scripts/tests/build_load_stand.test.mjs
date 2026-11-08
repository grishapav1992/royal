import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile), runtime = resolve('deployment/load-stand-runtime');
const lock = JSON.parse(await readFile(join(runtime, 'package-lock.json')));
const manifest = JSON.parse(await readFile(join(runtime, 'package.json')));
const application = JSON.parse(await readFile('package-lock.json'));

test('stand dependencies pin Redis and share identical app package versions and integrity', () => {
  assert.deepEqual(manifest.dependencies, { '@colyseus/core': '0.18.18', '@colyseus/redis-driver': '0.18.5',
    '@colyseus/redis-presence': '0.18.5', ioredis: '5.11.1' });
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  const missing = [];
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.match(item.integrity, /^sha512-/);
    const shared = application.packages[path];
    if (shared) {
      assert.equal(shared.version, item.version, path);
      assert.equal(shared.integrity, item.integrity, path);
    } else missing.push(path.slice('node_modules/'.length));
  }
  assert.deepEqual(missing.sort(), ['@colyseus/redis-driver', '@colyseus/redis-presence', '@ioredis/commands',
    'cluster-key-slot', 'denque', 'ioredis', 'redis-errors', 'redis-parser', 'standard-as-callback']);
});

test('stand build rejects changed runtime pins, installed versions and native supplement files', async t => {
  const artifacts = resolve('artifacts/work');
  await mkdir(artifacts, { recursive: true });
  const work = await realpath(await mkdtemp(join(artifacts, 'load-stand-pin-test-')));
  t.after(() => rm(work, { recursive: true }));
  const prefix = join(work, 'runtime');
  const supplement = join(prefix, 'node_modules/@colyseus/redis-driver');
  await mkdir(supplement, { recursive: true });
  await copyFile(join(runtime, 'package.json'), join(prefix, 'package.json'));
  await writeFile(join(prefix, 'package-lock.json'), '{}');
  const build = name => run(process.execPath, ['scripts/build-load-stand.mjs', '--stand-runtime', prefix, '--out-dir', join(work, name)]);
  await assert.rejects(build('wrong-lock'), error => /Isolated runtime pin mismatch: package-lock.json/.test(error.stderr));
  const invalidBase = join(work, 'invalid-base-lock.json');
  await writeFile(invalidBase, 'null');
  await assert.rejects(run(process.execPath, ['scripts/build-load-stand.mjs', '--runtime-lock', invalidBase, '--out-dir', join(work, 'invalid-base')]),
    error => /Runtime lock package map required/.test(error.stderr));

  await copyFile(join(runtime, 'package-lock.json'), join(prefix, 'package-lock.json'));
  const installed = join(supplement, 'package.json'), name = '@colyseus/redis-driver';
  await writeFile(installed, JSON.stringify({ name, version: '0.0.0' }));
  await assert.rejects(build('wrong-version'), error => /Installed supplement version mismatch: @colyseus\/redis-driver/.test(error.stderr));

  await writeFile(installed, JSON.stringify({ name, version: '0.18.5' }));
  await writeFile(join(supplement, 'unsafe.node'), 'unapproved');
  await assert.rejects(build('native-file'), error => /Native supplement file refused: unsafe.node/.test(error.stderr));
});
