import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), work = resolve(root, '..'), out = resolve(work, 'payload');
const base = '9892f8fc1a78369bce385221466f80a45d426b42', name = 'character-motion-20261027-v2';
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const before = json(resolve(work, 'before.json')), release = json(resolve(root, 'module-build/release-manifest.json'));
const receipt = json(resolve(root, 'module-build/release-github.json'));
assert.equal(release.sourceCommit, git('rev-parse', 'HEAD')); assert.equal(release.baseCommit, base); assert(release.build.passed);
assert.equal(receipt.sourceCommit, release.sourceCommit); assert(!git('status', '--porcelain'));
assert.equal(before.sourceRevision, base); assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
assert(!existsSync(out), 'Existing payload must be reviewed'); mkdirSync(out);
function copy(from, to) { const path = resolve(out, to); assert(path.startsWith(out + '/')); mkdirSync(dirname(path), { recursive: true }); copyFileSync(from, path); }
const changed = {}, retainedSource = [];
const allowed = new Set(['src/game/RoomScene.ts','src/game/characterAnimation.ts','src/ui/SkinFittingRoom.ts','src/ui/SkinStudioUI.ts','docs/skin-studio.md']);
for (const file of release.changed) {
  if (!allowed.has(file)) continue;
  const source = resolve(root, file); assert(existsSync(source), file); const digest = hash(source);
  if (before.source[file] === digest) continue;
  changed[file] = digest; copy(source, 'source/' + file);
}
for (const [file, digest] of Object.entries(before.source)) {
  if (file === 'deployment/SERVER.md' || file.endsWith('.orig') || file.endsWith('.bak') || file in changed) continue;
  assert(existsSync(resolve(root, file)), file); const actual = hash(resolve(root, file));
  if (actual !== digest && before.sourceLF[file] !== actual) {
    assert(file === 'docs/game-math/qualification.md', 'Unrelated production source differs: ' + file);
    retainedSource.push({file, retainedSha256:digest, localSha256:actual});
  }
}
const sameRuntime = (file, digest) => {
  if (before.program[file] === digest) return true;
  if (!/\.(html|css|js|json|svg|txt|map|md)$/i.test(file)) return false;
  if (before.programLF[file] === digest) return true;
  const publicSource = file.startsWith('dist/') ? 'public/' + file.slice(5) : '';
  return before.source[publicSource] === before.program[file] && before.sourceLF[publicSource] === digest;
};
const delta = {}, retainedPublicRuntime = [];
for (const [file, digest] of Object.entries(release.files)) {
  if (!file.startsWith('dist/')) continue;
  if (sameRuntime(file, digest)) continue;
  const sub = file.slice(5);
  if (sub === 'index.html' || /^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub)) {
    assert(sub === 'index.html' || !(file in before.program), 'Immutable client URL would change');
    delta[sub] = digest; copy(resolve(root, file), 'dist-delta/' + sub);
  } else {
    const source = 'public/' + sub;
    assert(before.source[source] === digest || before.sourceLF[source] === digest, 'Unrelated static source changed: ' + file);
    // Unchanged public sources can have older deployed bytes. Preserve that reviewed runtime pin.
    retainedPublicRuntime.push({ file, retainedSha256: before.program[file] ?? null, localSourceSha256: digest });
  }
}
assert('index.html' in delta);
const serverDelta = {}; mkdirSync(resolve(out, 'server-delta'));
const independentBackendSources = [];
for (const [entry, file] of [['server/index.ts', 'index.js'], ['scripts/crypto-reconcile.ts', 'crypto-reconcile.js'], ['server/payments/index.ts', 'payments.js']]) {
  const audit = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', packages: 'external',
    format: 'esm', outfile: 'dist-server/' + file, write: false, metafile: true });
  assert.equal(createHash('sha256').update(audit.outputFiles[0].contents).digest('hex'), release.files['dist-server/' + file]);
  for (const source of Object.keys(audit.metafile.inputs)) {
    const digest = hash(resolve(root, source));
    assert(!(source in changed) && (before.source[source] === digest || before.sourceLF[source] === digest), 'Independent backend dependency changed: ' + source);
  }
  independentBackendSources.push({ entry, runtimeFile: 'dist-server/' + file, inputCount: Object.keys(audit.metafile.inputs).length,
    retainedSha256: before.program['dist-server/' + file], localBuildSha256: release.files['dist-server/' + file] });
}
const host = json(resolve(root, 'module-dist/host-contracts.json'));
assert.deepEqual(host.games, before.moduleHost.games, 'Host compatibility versions changed');
const clientText = Object.keys(delta).filter(file => file.endsWith('.js')).map(file => readFileSync(resolve(out, 'dist-delta', file), 'utf8')).join('\n');
for (const [gameId, installed] of Object.entries(before.activeModuleMetadata)) {
  const pointer = json(resolve(root, 'module-dist', gameId, 'active.json'));
  const local = json(resolve(root, 'module-dist', pointer.manifest.replace(/^\/game-modules\//, '')));
  for (const field of ['gameId', 'apiVersion', 'rulesVersion', 'progressVersion']) assert.equal(local[field], installed[field], 'Module compatibility changed: ' + gameId);
  if (local.version !== installed.version) assert(!clientText.includes(local.version), 'Client requires an unpublished module version: ' + gameId);
}
for (const file of ['package.json', 'package-lock.json']) {
  const digest = hash(resolve(root, file));
  assert(before.program[file] === digest || (before.program[file] === before.source[file] && before.sourceLF[file] === digest), 'Dependencies changed: ' + file);
}
const helper = dirname(fileURLToPath(import.meta.url));
const helpers = Object.fromEntries(['runtime-inventory.cjs','quiesce.cjs','financial_gate.py'].map(file => [file,hash(resolve(helper,file))]));
for (const file of ['deploy.py', 'snapshot.py', ...Object.keys(helpers)]) copy(resolve(helper, file), file);
for (const file of ['release-manifest.json', 'release-github.json']) copy(resolve(root, 'module-build', file), file);
const manifest = { release: name, sourceCommit: release.sourceCommit, baseCommit: base, before, changed, delta, serverDelta, retainedPublicRuntime, retainedSource, helpers,
  compatibility: { independentBackendSources, hostContractVersionsUnchanged: true, modulesChecked: Object.keys(before.activeModuleMetadata).length,
    bundledAndExternalModulesRetained: true, dependencyLockEquivalent: true },
  helperSha256: hash(resolve(out, 'deploy.py')), snapshotSha256: hash(resolve(out, 'snapshot.py')) };
writeFileSync(resolve(out, 'install-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
execFileSync('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-czf', resolve(work, 'transport.tgz'), '-C', out, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(JSON.stringify({ sourceCommit: release.sourceCommit, sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length,
  backendFiles: 0, deltaBytes: Object.keys(delta).reduce((sum, file) => sum + statSync(resolve(out, 'dist-delta', file)).size, 0), transportBytes: statSync(resolve(work, 'transport.tgz')).size }));
