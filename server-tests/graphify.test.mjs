import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { git } from '../scripts/sync-work.mjs';
import { inventory, inputKind, localEnvironment, status, GRAPHIFY_VERSION } from '../scripts/graphify.mjs';

const output = fileURLToPath(new URL('../graphify-out/', import.meta.url));
async function fixture(callback) {
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(resolve(output, 'test-'));
  try {
    await git(directory, ['init', '-q']);
    await mkdir(resolve(directory, 'src'));
    await writeFile(resolve(directory, 'src/main.ts'), 'export const ready = true;\n');
    await git(directory, ['add', 'src/main.ts']);
    await git(directory, ['-c', 'user.name=Graph test', '-c', 'user.email=graph-test@example.invalid', 'commit', '-qm', 'fixture']);
    await callback(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('only tracked inputs enter the map; changes, staged additions, renames and deletions invalidate it', async () => fixture(async directory => {
  const before = await inventory(directory);
  await writeFile(resolve(directory, 'src/local 2.ts'), 'export const local = true;');
  assert.equal((await inventory(directory)).sourceHash, before.sourceHash);
  await writeFile(resolve(directory, 'src/main.ts'), 'export const ready = false;');
  assert.notEqual((await inventory(directory)).sourceHash, before.sourceHash);
  await writeFile(resolve(directory, 'src/new.ts'), 'export const added = true;');
  await git(directory, ['add', 'src/new.ts']);
  assert.deepEqual((await inventory(directory)).sources, ['src/main.ts', 'src/new.ts']);
  await git(directory, ['mv', 'src/new.ts', 'src/renamed.ts']);
  assert.deepEqual((await inventory(directory)).sources, ['src/main.ts', 'src/renamed.ts']);
  await rm(resolve(directory, 'src/main.ts'));
  assert.deepEqual((await inventory(directory)).sources, ['src/renamed.ts']);
}));

test('secrets, state, archives and symlinks are excluded; resolver settings affect freshness', async () => fixture(async directory => {
  for (const path of ['.env', '.env.local', 'data/user.py', 'secrets/private.ts', 'ai-factory/knowledge-graph/.state/snapshot.md',
    'deployment/releases/old/install.py', 'public/assets/vendor.js', 'artifacts/work/other/main.ts']) assert.equal(inputKind(path), null, path);
  const before = await inventory(directory);
  await writeFile(resolve(directory, 'tsconfig.json'), '{"compilerOptions":{}}');
  await git(directory, ['add', 'tsconfig.json']);
  const configured = await inventory(directory);
  assert.notEqual(configured.sourceHash, before.sourceHash);
  assert.deepEqual(configured.sources, ['src/main.ts']);
  await symlink('main.ts', resolve(directory, 'src/link.ts'));
  await git(directory, ['add', 'src/link.ts']);
  assert.deepEqual((await inventory(directory)).sources, ['src/main.ts']);
}));

test('status detects source edits, a changed commit and corrupted graph bytes without building', async () => fixture(async directory => {
  assert.equal((await status(directory)).state, 'missing');
  const input = await inventory(directory), commit = await git(directory, ['rev-parse', 'HEAD']);
  await mkdir(resolve(directory, 'graphify-out'));
  const graph = '{"nodes":[],"links":[]}\n';
  await writeFile(resolve(directory, 'graphify-out/graph.json'), graph);
  const manifest = { schemaVersion: 1, commit, sourceHash: input.sourceHash, graphHash: createHash('sha256').update(graph).digest('hex'), graphifyVersion: GRAPHIFY_VERSION };
  await writeFile(resolve(directory, 'graphify-out/royal-manifest.json'), JSON.stringify(manifest));
  assert.equal((await status(directory)).state, 'current');
  await writeFile(resolve(directory, 'src/main.ts'), 'export const ready = false;');
  assert.equal((await status(directory)).state, 'stale');
  await writeFile(resolve(directory, 'src/main.ts'), 'export const ready = true;\n');
  await git(directory, ['-c', 'user.name=Graph test', '-c', 'user.email=graph-test@example.invalid', 'commit', '--allow-empty', '-qm', 'new head']);
  assert.equal((await status(directory)).state, 'stale');
  manifest.commit = await git(directory, ['rev-parse', 'HEAD']);
  await writeFile(resolve(directory, 'graphify-out/royal-manifest.json'), JSON.stringify(manifest));
  assert.equal((await status(directory)).state, 'current');
  await writeFile(resolve(directory, 'graphify-out/graph.json'), graph + ' ');
  assert.equal((await status(directory)).state, 'stale');
  assert.equal(await readFile(resolve(directory, 'graphify-out/graph.json'), 'utf8'), graph + ' ');
  await writeFile(resolve(directory, 'graphify-out/royal-manifest.json'), 'null');
  assert.equal((await status(directory)).state, 'stale');
}));

test('the Graphify process receives local-only controls and no provider or database credentials', () => {
  const env = localEnvironment({ PATH: '/bin', HOME: '/home/test', OPENAI_API_KEY: 'test-value', A6API_KEY: 'test-value',
    DATABASE_URL: 'test-value', GRAPHIFY_BACKEND: 'openai', GRAPHIFY_OUT: '/elsewhere', GRAPHIFY_CONFIG: '/private' }, '/project/graphify-out');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.GRAPHIFY_BACKEND, 'none');
  assert.equal(env.GRAPHIFY_OUT, '/project/graphify-out');
  assert.equal(env.GRAPHIFY_NO_AUTO_REFRESH, '1');
  assert.equal(env.GRAPHIFY_QUERY_LOG_DISABLE, '1');
  for (const key of ['OPENAI_API_KEY', 'A6API_KEY', 'DATABASE_URL', 'GRAPHIFY_CONFIG']) assert.equal(env[key], undefined);
});
