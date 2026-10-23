import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, mkdtemp, symlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { moduleFingerprinter, cachedModule, digest, inventory, regularPath } from '../scripts/module-build-cache.mjs';
import { releasePlan, assertClean, git, releaseFiles, verifyRelease, prepareRelease } from '../scripts/release.mjs';

const parent = resolve('artifacts/work/release-tooling-tests');
await mkdir(parent, { recursive: true });
await writeFile(resolve(parent, 'owner.json'), JSON.stringify({ owner: 'release-tooling tests', purpose: 'Small synthetic fixtures', cleanupCondition: 'Remove after test process exits' }));
test.after(async () => { await rm(parent, { recursive: true }); });
async function fixture(t) {
  const root = await mkdtemp(resolve(parent, 'fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, data) => { await mkdir(dirname(resolve(root, name)), { recursive: true }); await writeFile(resolve(root, name), data); };
  await put('package.json', '{}'); await put('package-lock.json', '{}'); await put('tsconfig.json', '{}');
  await put('src/ui/A.ts', 'export const value = 1;'); await put('src/ui/B.ts', 'export const value = 2;');
  await put('public/assets/a/one.webp', 'image');
  const contract = { slug: 'a', gameId: 'test-a', apiVersion: 1, rulesVersion: 1, progressVersion: 1 };
  const config = { version: '1.0.0', assetRoots: ['a'] };
  return { root, put, contract, config, fingerprint: () => moduleFingerprinter(root, { esbuildVersion: 'test' }) };
}

test('cache invalidates dependent source, new resolution candidates, added media, config and toolchain', async t => {
  const f = await fixture(t), hash = () => f.fingerprint()(f.config, f.contract, ['src/ui/A.ts']);
  const first = await hash();
  await f.put('src/ui/B.ts', 'unrelated edit'); assert.equal(await hash(), first);
  await f.put('src/ui/A.ts', 'dependent edit'); assert.notEqual(await hash(), first);
  const second = await hash();
  await f.put('src/ui/A/index.ts', 'new resolution candidate'); assert.notEqual(await hash(), second);
  const third = await hash();
  await f.put('public/assets/a/two.webp', 'added media'); assert.notEqual(await hash(), third);
  const fourth = await hash();
  await f.put('tsconfig.json', '{"compilerOptions":{}}'); assert.notEqual(await hash(), fourth);
  assert.notEqual(await moduleFingerprinter(f.root, { esbuildVersion: 'new' })(f.config, f.contract, ['src/ui/A.ts']), await hash());
});

test('missing source and symlinked source or media cannot produce a cache hit', async t => {
  const f = await fixture(t), hash = () => f.fingerprint()(f.config, f.contract, ['src/ui/A.ts']);
  const first = await hash();
  await rm(resolve(f.root, 'src/ui/A.ts')); assert.notEqual(await hash(), first);
  await symlink(resolve(f.root, 'src/ui/B.ts'), resolve(f.root, 'src/ui/A.ts'));
  await assert.rejects(hash(), /symlink/);
  await rm(resolve(f.root, 'src/ui/A.ts')); await f.put('src/ui/A.ts', 'source');
  await symlink(resolve(f.root, 'src/ui/B.ts'), resolve(f.root, 'public/assets/a/escape.webp'));
  await assert.rejects(hash(), /symlink/);
});

test('cache validates every immutable output, rejects extras and restores a pointer without rebuilding', async t => {
  const f = await fixture(t), version = '1.0.0-aaaaaaaaaaaa';
  const folder = `module-dist/test-a/versions/${version}`;
  await f.put(folder + '/entry.js', 'entry'); await f.put(folder + '/manifest.json', '{}');
  const proof = { gameId: f.contract.gameId, version, files: 1, sourceFiles: { 'src/ui/A.ts': 'hash' },
    cache: { format: 1, fingerprint: await f.fingerprint()(f.config, f.contract, ['src/ui/A.ts']),
      outputs: await inventory(resolve(f.root, folder)) } };
  await f.put('module-build/a-proof.json', JSON.stringify(proof));
  const hit = await cachedModule(f.root, f.config, f.contract, f.fingerprint());
  assert.equal(hit.pointer.sha256, digest('{}'));
  await f.put(folder + '/extra.js', 'extra');
  await assert.rejects(cachedModule(f.root, f.config, f.contract, f.fingerprint()), /damaged/);
  await rm(resolve(f.root, folder + '/extra.js')); await f.put(folder + '/entry.js', 'corrupt');
  await assert.rejects(cachedModule(f.root, f.config, f.contract, f.fingerprint()), /damaged/);
});

test('path guards reject escaping paths and output symlinks', async t => {
  const f = await fixture(t);
  for (const path of ['../outside', '/etc/passwd', 'src/../package.json', 'src\\ui\\A.ts']) {
    await assert.rejects(regularPath(f.root, path), /Unsafe/);
  }
  await symlink(resolve(f.root, 'src/ui/A.ts'), resolve(f.root, 'src/link'));
  await assert.rejects(inventory(resolve(f.root, 'src')), /symlink/);
});

async function committedFixture(t) {
  const f = await fixture(t);
  git(f.root, ['init', '-q']); git(f.root, ['config', 'user.name', 'Release test']);
  git(f.root, ['config', 'user.email', 'release-test@example.invalid']);
  await f.put('.gitignore', 'module-build/\nmodule-dist/\ndist/\ndist-server/\n');
  git(f.root, ['add', '.']); git(f.root, ['commit', '-qm', 'baseline']);
  const base = git(f.root, ['rev-parse', 'HEAD']);
  await f.put('src/ui/A.ts', 'changed source');
  git(f.root, ['add', '.']); git(f.root, ['commit', '-qm', 'source change']);
  return { ...f, base };
}

test('release plan requires an explicit ancestor and catches unfinished tracked and untracked work', async t => {
  const f = await committedFixture(t);
  assert.throws(() => releasePlan(f.root), /--base/);
  assert.deepEqual(releasePlan(f.root, f.base).changed, ['src/ui/A.ts']);
  assertClean(f.root);
  await f.put('src/ui/A.ts', 'unfinished'); assert.throws(() => assertClean(f.root), /clean checkout/);
  git(f.root, ['checkout', '--', 'src/ui/A.ts']);
  await f.put('new.ts', 'untracked'); assert.throws(() => assertClean(f.root), /clean checkout/);
});

test('release verification rejects source drift, changed output and unexpected package files', async t => {
  const f = await committedFixture(t), version = '1.0.0-aaaaaaaaaaaa';
  const folder = `module-dist/test-a/versions/${version}`;
  await f.put(folder + '/manifest.json', '{}'); await f.put(folder + '/entry.js', 'entry');
  await f.put('module-dist/test-a/active.json', JSON.stringify({ manifest: `/game-modules/test-a/versions/${version}/manifest.json`, sha256: digest('{}') }));
  await f.put('module-build/build-report.json', JSON.stringify({ games: [{ gameId: 'test-a', version }] }));
  const manifest = { ...releasePlan(f.root, f.base), scope: 'modules', modules: ['a'], build: { passed: true },
    ...await releaseFiles(f.root, ['a']) };
  await f.put('module-build/release-manifest.json', JSON.stringify(manifest));
  await verifyRelease(f.root);
  await f.put(folder + '/entry.js', 'corrupt'); await assert.rejects(verifyRelease(f.root), /output changed/);
  await f.put(folder + '/entry.js', 'entry'); await f.put(folder + '/extra.js', 'extra');
  await assert.rejects(verifyRelease(f.root), /inventory changed/);
  await rm(resolve(f.root, folder + '/extra.js')); await f.put('src/ui/A.ts', 'unfinished');
  await assert.rejects(verifyRelease(f.root), /clean checkout/);
});

test('failed preflight removes a stale successful manifest and releases its own lock', async t => {
  const f = await committedFixture(t);
  await f.put('module-build/release-manifest.json', '{"passed":true}');
  await f.put('unfinished.ts', 'work');
  await assert.rejects(prepareRelease(f.root, { base: f.base, local: true }), /clean checkout/);
  await assert.rejects(readFile(resolve(f.root, 'module-build/release-manifest.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(f.root, 'module-build/release.lock/owner.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(resolve(f.root, 'module-build/release-timings.json'))).passed, false);
});

test('a concurrent preparation cannot remove another preparation lock or its manifest', async t => {
  const f = await committedFixture(t);
  await f.put('module-build/release.lock/owner.json', '{"pid":123}');
  await f.put('module-build/release-manifest.json', 'other preparation');
  await assert.rejects(prepareRelease(f.root, { base: f.base, local: true }), { code: 'EEXIST' });
  assert.equal(await readFile(resolve(f.root, 'module-build/release-manifest.json'), 'utf8'), 'other preparation');
});
