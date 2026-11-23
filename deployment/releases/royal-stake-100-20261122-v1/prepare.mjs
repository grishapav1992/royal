import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';
import { verifyModuleProjection } from '../../../scripts/module-source-projection.mjs';

const name = 'royal-stake-100-20261122-v1';
const folder = `deployment/releases/${name}`;
const [, , baselinePath, publishedPath, output] = process.argv;
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { maxBuffer: 64 * 1024 ** 2 });
const committed = (commit, file) => git('show', `${commit}:${file}`);
const root = process.cwd();
const before = read(baselinePath);
const published = read(publishedPath);
const scope = read(`${folder}/scope.json`);
const manifestPath = 'module-build/release-manifest.json';
const receiptPath = 'module-build/release-github.json';
const release = read(manifestPath);
const receipt = read(receiptPath);
assert.equal(git('status', '--porcelain').toString().trim(), '');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
assert.equal(release.baseCommit, before.sourceCommit);
assert.equal(release.sourceCommit, receipt.sourceCommit);
assert.equal(receipt.manifestSha256, sha(fs.readFileSync(manifestPath)));
for (const commit of [release.sourceCommit, receipt.remoteMain]) {
  git('merge-base', '--is-ancestor', commit, 'origin/main');
}
assert.deepEqual(Object.keys(published), scope.activeGames);
assert.equal(scope.activeGames.length, 19);
assert.equal(before.container.health, 'healthy');
assert.deepEqual(before.program, before.preparedProgram);
const reader = await readHostProjection(root, `${folder}/host-projection.json`, { strictOrigins: true });
assert.equal(reader.sha256, release.hostProjection.sha256);
const modules = release.build.moduleProjection;
await verifyModuleProjection(root, modules, reader.metadata.moduleGames);
const backend = await readHostProjection(root, `${folder}/backend-projection.json`, { strictOrigins: true });
assert.equal(backend.sha256, release.backendProjection.sha256);
assert.equal(backend.metadata.productionCommit, before.sourceCommit);
assert.equal(reader.metadata.productionCommit, before.sourceCommit);
const preservedBackend = read('deployment/releases/password-login-20261119-v1/scope.json').retainedBackendInputs;
const changed = new Map();
for (const [projection, sourceReader, exceptions] of [
  [release.hostProjection, reader, {}], [release.backendProjection, backend, preservedBackend], [modules, reader, scope.preservedModuleInputs]
]) {
  for (const [file, digest] of Object.entries(projection.inputs)) {
    if (scope.sources[file]) {
      assert.equal(digest, scope.sources[file], file);
      const bytes = sourceReader.read(file);
      assert.equal(sha(bytes), digest, file);
      changed.set(file, bytes);
    } else {
      assert([before.source[file], before.sourceLF[file], exceptions[file]].includes(digest), file);
    }
  }
}
for (const file of scope.host) assert.equal(release.hostProjection.inputs[file], scope.sources[file]);
for (const file of scope.backend) assert.equal(release.backendProjection.inputs[file], scope.sources[file]);
assert.deepEqual(Object.keys(modules.modules).sort(), [...scope.games].sort());
const payloadScope = {...scope, sources:Object.fromEntries([...changed.keys()].map(file=>[file,scope.sources[file]])), preservedBackend};
const serverDelta = {'index.js':release.backendProjection.output.sha256};
assert.equal(serverDelta['index.js'],release.files['dist-server/index.js']);

fs.mkdirSync(output, { recursive: false });
const write = (name, bytes) => {
  assert(!path.isAbsolute(name) && !name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')));
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return sha(bytes);
};
fs.mkdirSync(path.join(output, 'server-delta'));
for (const [file, bytes] of changed) write(`source/${file}`, bytes);
assert.equal(write('server-delta/index.js', fs.readFileSync('dist-server/index.js')), serverDelta['index.js']);
const delta = {};
for (const [file, digest] of Object.entries(release.files)) {
  if (!file.startsWith('dist/') || before.program[file] === digest) continue;
  const relative = file.slice(5);
  assert(relative === 'index.html' || (!before.program[file] && /^assets\/[\w-]+\.(js|css)$/.test(relative)), file);
  assert.equal(delta[relative] = write(`dist-delta/${relative}`, fs.readFileSync(file)), digest);
}
const packages = {};
for (const [id, row] of Object.entries(modules.modules)) {
  const prior = published[id];
  assert.equal(prior.pointerSha256, before.moduleFiles[`/opt/royal-game-modules/${id}/active.json`]);
  const contract = before.moduleHost.games[id];
  const directory = path.dirname(row.manifestPath);
  const manifest = read(row.manifestPath);
  assert.deepEqual(Object.fromEntries(Object.keys(contract).map(key => [key, manifest[key]])), contract);
  const mediaOnly = record => Object.fromEntries(Object.entries(record).filter(([file])=>file.startsWith('media/')).sort());
  assert.deepEqual(mediaOnly(prior.manifest.files), mediaOnly(manifest.files), id);
  const files = { 'manifest.json': row.manifestSha256, ...manifest.files };
  for (const [file, digest] of Object.entries(files)) {
    const source = `${directory}/${file}`;
    assert.equal(release.files[source], digest);
    const destination = path.join(output, 'packages', id, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.linkSync(source, destination);
  }
  packages[id] = { version: row.version, contract, files, pointerSha256: release.files[`module-dist/${id}/active.json`],
    previousVersion: prior.manifest.version, previousPointerSha256: prior.pointerSha256 };
}
const helpers = {
  'production-guard.py': 'deployment/releases/skin-offers-20261105-v2/deploy.py',
  'overlay-base.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'snapshot-base.py': 'deployment/releases/universal-spins-20261031-v1/snapshot.py',
  'runtime-inventory.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
  'quiesce.cjs': 'deployment/releases/skin-offers-20261105-v2/quiesce.cjs',
  'quiesce-base.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'financial_gate.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'engine-build.py': 'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
  'image_metadata.py': 'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
  'publisher.py': 'scripts/game-module-release.py',
};
const support = Object.fromEntries(Object.entries(helpers).map(([name, source]) => [name, write(name, committed(release.sourceCommit, source))]));
assert.equal(support['publisher.py'], before.source['scripts/game-module-release.py']);
support['scope.json'] = write('scope.json', Buffer.from(JSON.stringify(payloadScope, null, 2) + '\n'));
const manifest = {
  release: name, sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit, before,
  changed: payloadScope.sources, delta, serverDelta, packages, support,
  helperSha256: write('deploy.py', committed(release.sourceCommit, `${folder}/deploy.py`)),
  snapshotSha256: write('snapshot.py', committed(release.sourceCommit, 'deployment/releases/mira-walk-24-20261107-v1/snapshot.py')),
  releaseManifestSha256: write('release-manifest.json', fs.readFileSync(manifestPath)),
  receiptSha256: write('release-github.json', fs.readFileSync(receiptPath)),
  activeGames: scope.activeGames, addedGames: [], restoredGames: [],
};
write('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({ sourceFiles: changed.size, modules: Object.keys(packages).length, clientFiles: Object.keys(delta).length }));
