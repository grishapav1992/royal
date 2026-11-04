import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink, stat, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { moduleFingerprinter, digest, cachedModule } from '../scripts/module-build-cache.mjs';
import { sharedModuleCache, restoreSharedModule, storeSharedModule } from '../scripts/shared-module-cache.mjs';

const parent = resolve('artifacts/work/shared-module-cache/tests');
await mkdir(parent, { recursive: true });
await writeFile(resolve(parent, 'owner.json'), JSON.stringify({ owner: 'shared module cache tests', purpose: 'Disposable source and package fixtures', cleanupCondition: 'Remove after test process exits' }));
async function removeOwned(path) {
  const name = relative(parent, resolve(path));
  assert(name && !name.startsWith('..') && !name.includes(':'));
  await rm(path, { recursive: true, force: true });
}
test.after(async () => { await rm(resolve(parent, 'owner.json'), { force: true }); await rm(parent, { recursive: true }); });

async function fixture(t) {
  const directory = await mkdtemp(resolve(parent, 'fixture-'));
  t.after(() => removeOwned(directory));
  const cache = { root: resolve(directory, 'shared'), maxBytes: 2 * 1024 ** 3, minFreeBytes: 0 };
  const config = { version: '1.0.0', assetRoots: ['test'] };
  const contract = { slug: 'test', gameId: 'test-game', apiVersion: 1, rulesVersion: 1, progressVersion: 1 };
  const toolchain = { esbuildVersion: 'test', node: 'test', platform: 'test' };
  const put = async (root, name, bytes) => { const path = resolve(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };
  async function checkout(name) {
    const root = resolve(directory, name);
    for (const [path, bytes] of Object.entries({ 'package.json': '{}', 'package-lock.json': '{}', 'tsconfig.json': '{}',
      'src/ui/A.ts': 'export const value=1;', 'src/ui/B.ts': 'unrelated', 'public/assets/test/a.svg': '<svg/>',
      'node_modules/test/package.json': '{}', 'node_modules/test/index.js': 'export const dependency=1;' })) await put(root, path, bytes);
    return root;
  }
  const fingerprint = root => moduleFingerprinter(root, toolchain);
  const outputs = new Map([['manifest.json', Buffer.from('{}')], ['entry.js', Buffer.from('module')], ['style.css', Buffer.from('style')], ['media/test/a.svg', Buffer.from('<svg/>')]]);
  async function proof(root, version = '1.0.0-aaaaaaaaaaaa') {
    const inputs = ['src/ui/A.ts', 'node_modules/test/index.js'];
    return { gameId: contract.gameId, version, files: outputs.size - 1,
      sourceFiles: Object.fromEntries(await Promise.all(inputs.map(async name => [name, digest(await readFile(resolve(root, name)))]))),
      cache: { format: 1, fingerprint: await fingerprint(root)(config, contract, inputs), outputs: Object.fromEntries([...outputs].map(([name, bytes]) => [name, digest(bytes)])) } };
  }
  const first = await checkout('first'), second = await checkout('second');
  return { directory, cache, config, contract, toolchain, put, checkout, fingerprint, outputs, proof, first, second,
    slot: resolve(cache.root, 'test.cache'), restore: root => restoreSharedModule(root, cache, config, contract, fingerprint(root)) };
}

test('independent checkouts reuse exact package bytes and create their own local proof', async t => {
  const f = await fixture(t), proof = await f.proof(f.first);
  assert.equal((await storeSharedModule(f.cache, f.contract, proof, f.outputs)).status, 'stored');
  const restored = await f.restore(f.second);
  assert.equal(restored.reason, 'shared-hit');
  assert.equal(restored.hit.proof.version, proof.version);
  for (const [name, bytes] of f.outputs) assert.deepEqual(await readFile(resolve(restored.hit.folder, name)), bytes);
  const local = await cachedModule(f.second, f.config, f.contract, f.fingerprint(f.second));
  assert.deepEqual(local.pointer, restored.hit.pointer);
  assert.equal((await readdir(f.cache.root)).filter(name => name.endsWith('.cache')).length, 1);
});

test('a modified restored package cannot alter the shared cache or another checkout', async t => {
  const f = await fixture(t);
  await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs);
  const second = await f.restore(f.second), sharedBytes = await readFile(f.slot);
  await writeFile(resolve(second.hit.folder, 'entry.js'), 'damaged locally');
  assert.deepEqual(await readFile(f.slot), sharedBytes);
  const third = await f.restore(await f.checkout('third'));
  assert.equal(await readFile(resolve(third.hit.folder, 'entry.js'), 'utf8'), 'module');
  await assert.rejects(cachedModule(f.second, f.config, f.contract, f.fingerprint(f.second)), /damaged/);
});

for (const [label, name] of [['dependent source', 'src/ui/A.ts'], ['dependency', 'node_modules/test/index.js'], ['declared media', 'public/assets/test/a.svg'], ['lockfile', 'package-lock.json'], ['compiler configuration', 'tsconfig.json']]) {
  test('shared reuse invalidates changed ' + label, async t => {
    const f = await fixture(t);
    await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs);
    await f.put(f.second, name, 'changed');
    const result = await f.restore(f.second);
    assert.equal(result.hit, null); assert.equal(result.reason, 'inputs-changed');
    await assert.rejects(stat(resolve(f.second, 'module-dist')), { code: 'ENOENT' });
  });
}

test('unchanged imported files can be reused after an unrelated file edit', async t => {
  const f = await fixture(t);
  await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs);
  await f.put(f.second, 'src/ui/B.ts', 'unrelated edit');
  assert.equal((await f.restore(f.second)).reason, 'shared-hit');
});

test('toolchain and added import candidates invalidate shared reuse', async t => {
  const f = await fixture(t);
  await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs);
  const changedToolchain = moduleFingerprinter(f.second, { ...f.toolchain, esbuildVersion: 'new' });
  assert.equal((await restoreSharedModule(f.second, f.cache, f.config, f.contract, changedToolchain)).hit, null);
  await f.put(f.second, 'src/ui/A/index.ts', 'new resolution candidate');
  assert.equal((await f.restore(f.second)).hit, null);
});

test('current source hashes remain mandatory when a fingerprint memo is stale', async t => {
  const f = await fixture(t), proof = await f.proof(f.first), fingerprint = f.fingerprint(f.second);
  await fingerprint(f.config, f.contract, Object.keys(proof.sourceFiles));
  await storeSharedModule(f.cache, f.contract, proof, f.outputs);
  await f.put(f.second, 'src/ui/A.ts', 'edited during this invocation');
  assert.equal((await restoreSharedModule(f.second, f.cache, f.config, f.contract, fingerprint)).hit, null);
});

test('damaged shared payloads fail before any local package is installed', async t => {
  const f = await fixture(t);
  await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs);
  const bytes = await readFile(f.slot); bytes[bytes.length - 1] ^= 1; await writeFile(f.slot, bytes);
  await assert.rejects(f.restore(f.second), /damaged/);
  await assert.rejects(stat(resolve(f.second, 'module-dist')), { code: 'ENOENT' });
});

test('shared restore cannot overwrite an existing immutable version, including an empty directory', async t => {
  const f = await fixture(t), proof = await f.proof(f.first);
  await storeSharedModule(f.cache, f.contract, proof, f.outputs);
  const version = resolve(f.second, 'module-dist/test-game/versions', proof.version);
  await mkdir(version, { recursive: true });
  await assert.rejects(f.restore(f.second), /collision/);
  assert.deepEqual(await readdir(version), []);
  await writeFile(resolve(version, 'entry.js'), 'existing damaged bytes');
  await assert.rejects(f.restore(f.second), /collision/);
  assert.equal(await readFile(resolve(version, 'entry.js'), 'utf8'), 'existing damaged bytes');
});

test('cache roots and restored output parents reject directory symlinks', async t => {
  const f = await fixture(t), foreign = resolve(f.directory, 'foreign');
  await mkdir(foreign);
  const alias = resolve(f.directory, 'alias');
  await symlink(foreign, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restoreSharedModule(f.second, { ...f.cache, root: alias }, f.config, f.contract, f.fingerprint(f.second)), /symlink/);
  await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs);
  await symlink(foreign, resolve(f.second, 'module-dist'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.restore(f.second), /symlink/);
  assert.deepEqual(await readdir(foreign), []);
});

test('unsafe package names and same-fingerprint collisions cannot enter the cache', async t => {
  const f = await fixture(t), proof = await f.proof(f.first);
  await assert.rejects(storeSharedModule(f.cache, f.contract, proof, new Map([['../outside', Buffer.from('bad')]])), /inventory/);
  await storeSharedModule(f.cache, f.contract, proof, f.outputs);
  await assert.rejects(storeSharedModule(f.cache, f.contract, { ...proof, version: '1.0.0-bbbbbbbbbbbb' }, f.outputs), /collision/);
  assert.equal((await f.restore(f.second)).hit.proof.version, proof.version);
});

test('one slot per game replaces older input versions and respects the total quota', async t => {
  const f = await fixture(t), proof = await f.proof(f.first);
  await storeSharedModule(f.cache, f.contract, proof, f.outputs);
  await f.put(f.first, 'src/ui/A.ts', 'next source');
  const next = await f.proof(f.first, '1.0.0-bbbbbbbbbbbb');
  assert.equal((await storeSharedModule(f.cache, f.contract, next, f.outputs)).status, 'stored');
  assert.deepEqual(await readdir(f.cache.root), ['test.cache']);
  const bytes = await readFile(f.slot);
  assert.equal((await storeSharedModule({ ...f.cache, maxBytes: 1 }, f.contract, proof, f.outputs)).status, 'capacity');
  assert.deepEqual(await readFile(f.slot), bytes);
  assert.deepEqual(await readdir(f.cache.root), ['test.cache']);
});

test('a busy local writer never blocks a build and preserves the prepared package', async t => {
  const f = await fixture(t), lock = resolve(f.cache.root, '.write-lock');
  await mkdir(lock, { recursive: true });
  await writeFile(resolve(lock, 'owner.json'), '{"pid":123}');
  assert.equal((await storeSharedModule(f.cache, f.contract, await f.proof(f.first), f.outputs)).status, 'write-busy');
  assert.equal(await readFile(resolve(lock, 'owner.json'), 'utf8'), '{"pid":123}');
});

test('parallel writers publish a whole consistent entry without stale temporary files', async t => {
  const f = await fixture(t), proof = await f.proof(f.first);
  const results = await Promise.all(Array.from({ length: 8 }, () => storeSharedModule(f.cache, f.contract, proof, f.outputs)));
  assert(results.some(row => row.status === 'stored'));
  assert(results.every(row => ['stored', 'already-present', 'write-busy'].includes(row.status)));
  assert.equal((await f.restore(f.second)).reason, 'shared-hit');
  assert.deepEqual(await readdir(f.cache.root), ['test.cache']);
});

test('shared cache is optional, disabled in disposable CI, and resolves to the common Git directory', async t => {
  const f = await fixture(t);
  assert.equal(await sharedModuleCache(f.first, { ROYAL_SHARED_MODULE_CACHE: '0' }), null);
  assert.equal(await sharedModuleCache(f.first, { CI: 'true' }), null);
  assert.equal((await sharedModuleCache(f.first, { CI: 'true', ROYAL_SHARED_MODULE_CACHE_DIR: f.cache.root })).root, f.cache.root);
  await assert.rejects(sharedModuleCache(f.first, { ROYAL_SHARED_MODULE_CACHE_DIR: f.cache.root, ROYAL_SHARED_MODULE_CACHE_MAX_BYTES: '-1' }), /limit/);
  execFileSync('git', ['init', '-q'], { cwd: f.first });
  const config = await sharedModuleCache(f.first, {});
  assert.equal(config.root, resolve(f.first, '.git/royal-module-cache/v1'));
  assert.equal((await restoreSharedModule(f.second, null, f.config, f.contract, f.fingerprint(f.second))).reason, 'disabled');
  assert.equal((await storeSharedModule(null, f.contract, await f.proof(f.first), f.outputs)).status, 'disabled');
});

test('linked Git worktrees automatically share a verified cache without configuration', async t => {
  const f = await fixture(t);
  const git = args => execFileSync('git', args, { cwd: f.first, stdio: 'pipe' });
  git(['init', '-q']); git(['config', 'core.autocrlf', 'false']); git(['add', '.']);
  git(['-c', 'user.name=Cache test', '-c', 'user.email=cache-test@example.invalid', 'commit', '-qm', 'Synthetic cache fixture']);
  const linked = resolve(f.directory, 'linked');
  git(['worktree', 'add', '--detach', '-q', linked, 'HEAD']);
  const firstCache = { ...await sharedModuleCache(f.first, {}), minFreeBytes: 0 };
  const linkedCache = { ...await sharedModuleCache(linked, {}), minFreeBytes: 0 };
  assert.equal(firstCache.root, linkedCache.root);
  await storeSharedModule(firstCache, f.contract, await f.proof(f.first), f.outputs);
  assert.equal((await restoreSharedModule(linked, linkedCache, f.config, f.contract, f.fingerprint(linked))).reason, 'shared-hit');
});

test('the real module builder uses shared hits and still invokes qualification on every run', async t => {
  const f = await fixture(t), repository = resolve('.'), links = [];
  const config = { ...f.config, ...f.contract, entry: 'entry.ts' };
  const stubs = {
    'package.json': '{"type":"module"}',
    'src/modules/GameModuleCatalog.ts': 'export const GAME_MODULES=' + JSON.stringify([f.contract]),
    'games/test/package.json': JSON.stringify(config), 'games/test/tsconfig.json': '{}',
    'games/test/entry.ts': "export {value} from '../../src/ui/A';import '../../src/ui/style.css';export const image='/assets/test/a.svg';",
    'src/ui/style.css': '.test{color:red}',
    'scripts/game-math/rtp-gate.mjs': "import{appendFile}from'node:fs/promises';import{resolve}from'node:path';export async function checkGameRtp(root){await appendFile(resolve(root,'qualification-calls.txt'),'checked\\n');}",
    'scripts/build-host-projection.mjs': "export function readHostProjection(){throw Error('Projection is outside this synthetic fixture');}",
    'scripts/module-source-projection.mjs': "import{createHash}from'node:crypto';export const moduleSourceSha256=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');export function projectedModuleContract(){throw Error('unexpected projection')}export const moduleProjectionCatalog=projectedModuleContract,projectedMediaBytes=projectedModuleContract,projectedDependencyBytes=projectedModuleContract;",
  };
  try {
    for (const root of [f.first, f.second]) {
      for (const [name, bytes] of Object.entries(stubs)) await f.put(root, name, bytes);
      for (const name of ['build-game-module.mjs', 'module-build-cache.mjs', 'shared-module-cache.mjs']) await f.put(root, 'scripts/' + name, await readFile(resolve(repository, 'scripts', name)));
      const link = resolve(root, 'node_modules/esbuild');
      await symlink(await realpath(resolve(repository, 'node_modules/esbuild')), link, process.platform === 'win32' ? 'junction' : 'dir');
      links.push(link);
    }
    const run = async root => {
      execFileSync(process.execPath, ['scripts/build-game-module.mjs', '--all'], { cwd: root,
        env: { ...process.env, ROYAL_SHARED_MODULE_CACHE_DIR: f.cache.root, ROYAL_SHARED_MODULE_CACHE: '1' }, stdio: 'pipe', timeout: 60000 });
      return JSON.parse(await readFile(resolve(root, 'module-build/build-report.json')));
    };
    const cold = await run(f.first), warm = await run(f.second);
    assert.equal(cold.built, 1); assert.equal(cold.cache.sharedHits, 0);
    assert.equal(warm.built, 0); assert.equal(warm.reused, 1); assert.equal(warm.cache.sharedHits, 1);
    assert.equal(warm.games[0].cacheSource, 'shared');
    assert.equal(await readFile(resolve(f.first, 'qualification-calls.txt'), 'utf8'), 'checked\n');
    assert.equal(await readFile(resolve(f.second, 'qualification-calls.txt'), 'utf8'), 'checked\n');
    await f.put(f.second, 'src/ui/A.ts', 'export const value=2;');
    const changed = await run(f.second);
    assert.equal(changed.built, 1); assert.equal(changed.cache.sharedHits, 0);
    assert.equal(await readFile(resolve(f.second, 'qualification-calls.txt'), 'utf8'), 'checked\nchecked\n');
  } finally { for (const link of links) await unlink(link); }
});
