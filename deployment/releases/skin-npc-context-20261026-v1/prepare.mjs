import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), work = resolve(root, '..'), out = resolve(work, 'payload');
const base = '27264a8cac2744aad98145631e76a291af5cbedf', name = 'skin-npc-context-20261026-v1';
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const before = json(resolve(work, 'before.json')), release = json(resolve(root, 'module-build/release-manifest.json'));
const receipt = json(resolve(root, 'module-build/release-github.json'));
assert.equal(release.sourceCommit, git('rev-parse', 'HEAD')); assert.equal(release.baseCommit, base); assert(release.build.passed);
assert.equal(receipt.sourceCommit, release.sourceCommit); assert(!git('status', '--porcelain'));
assert.equal(before.container.image, 'sha256:090153647cc919af02e41fe853e74b89f60755a146a79f2e40eb61bac389af09');
assert.deepEqual(before.program, before.preparedProgram);
assert(!existsSync(out), 'Existing payload must be reviewed'); mkdirSync(out);
function copy(from, to) { const path = resolve(out, to); assert(path.startsWith(out + '/')); mkdirSync(dirname(path), { recursive: true }); copyFileSync(from, path); }
const changed = {};
for (const file of release.changed) {
  if (!/^(src|server|scripts|docs)\//.test(file)) continue;
  const source = resolve(root, file); assert(existsSync(source), file); const digest = hash(source);
  if (before.source[file] === digest) continue;
  changed[file] = digest; copy(source, 'source/' + file);
}
for (const [file, digest] of Object.entries(before.source)) {
  if (file === 'deployment/SERVER.md' || file.endsWith('.orig') || file.endsWith('.bak') || file in changed) continue;
  assert(existsSync(resolve(root, file)), file); const actual = hash(resolve(root, file));
  assert(actual === digest || before.sourceLF[file] === actual, 'Unrelated production source differs: ' + file);
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
const serverDelta = { 'index.js': hash(resolve(root, 'dist-server/index.js')) };
assert.notEqual(serverDelta['index.js'], before.program['dist-server/index.js']);
copy(resolve(root, 'dist-server/index.js'), 'server-delta/index.js');
const independentBackendSources = [];
for (const [entry, file] of [['scripts/crypto-reconcile.ts', 'crypto-reconcile.js'], ['server/payments/index.ts', 'payments.js']]) {
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
for (const file of ['deploy.py', 'snapshot.py']) copy(resolve(helper, file), file);
for (const file of ['release-manifest.json', 'release-github.json']) copy(resolve(root, 'module-build', file), file);
const manifest = { release: name, sourceCommit: release.sourceCommit, baseCommit: base, before, changed, delta, serverDelta, retainedPublicRuntime,
  compatibility: { independentBackendSources, hostContractVersionsUnchanged: true, modulesChecked: Object.keys(before.activeModuleMetadata).length,
    bundledAndExternalModulesRetained: true, dependencyLockEquivalent: true },
  helperSha256: hash(resolve(out, 'deploy.py')), snapshotSha256: hash(resolve(out, 'snapshot.py')) };
writeFileSync(resolve(out, 'install-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
execFileSync('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-czf', resolve(work, 'transport.tgz'), '-C', out, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(JSON.stringify({ sourceCommit: release.sourceCommit, sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length,
  backendFiles: 1, deltaBytes: Object.keys(delta).reduce((sum, file) => sum + statSync(resolve(out, 'dist-delta', file)).size, statSync(resolve(out, 'server-delta/index.js')).size), transportBytes: statSync(resolve(work, 'transport.tgz')).size }));
