import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const root = process.cwd();
const [baseline, destination] = process.argv.slice(2);
assert(baseline && destination, 'Provide the reviewed production snapshot and payload directory');
const name = 'caramel-stake-limit-20261119-v1';
const game = 'studio-caramel-carnival';
const folder = 'deployment/releases/' + name;
const out = path.resolve(destination);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const git = (...args) => execFileSync('git', args, {cwd: root, maxBuffer: 64 * 1024**2});
const verifySource = (file, commit) => git('show', commit + ':' + file);
const ln = bytes => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
const before = read(path.resolve(baseline));
const release = read('module-build/release-manifest.json');
const receipt = read('module-build/release-github.json');
const source = release.sourceCommit;

assert.equal(git('status', '--porcelain').toString(), '');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), source);
assert.equal(release.scope, 'application');
assert(release.clean && release.build.passed);
assert.equal(receipt.sourceCommit, source);
for (const commit of [source, receipt.remoteMain]) git('merge-base', '--is-ancestor', commit, 'origin/main');
assert.equal(release.baseCommit, before.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);

const scope = read(folder + '/scope.json');
const host = await readHostProjection(root, folder + '/host-projection.json', {strictOrigins: true});
const backend = await readHostProjection(root, folder + '/backend-projection.json', {strictOrigins: true});
for (const [label, reader] of [['host', host], ['backend', backend]]) {
 const digest = sha(verifySource(folder + '/' + label + '-projection.json', source));
 assert.equal(digest, release[label + 'Projection'].sha256);
 assert.equal(digest, reader.sha256);
}
const sourceFiles = new Map();
for (const [files, reader, label] of [[scope.host, host, 'host'], [scope.backend, backend, 'backend']]) {
 for (const file of files) {
  const bytes = reader.read(file);
  assert.equal(sha(bytes), release[label + 'Projection'].inputs[file], file);
  if (sourceFiles.has(file)) assert.deepEqual(bytes, sourceFiles.get(file), file);
  sourceFiles.set(file, bytes);
 }
}
for (const file of scope.module) sourceFiles.set(file, ln(verifySource(file, source)));
const changed = Object.fromEntries([...sourceFiles].map(([file, bytes]) => [file, sha(bytes)]));
for (const label of ['host', 'backend']) {
 const retained = label === 'backend' ? scope.preservedBackendInputs : {};
 for (const [file, digest] of Object.entries(release[label + 'Projection'].inputs)) {
  const permitted = retained[file] ? [retained[file]] : changed[file] ? [changed[file]] : [before.source[file], before.sourceLF[file]];
  assert(permitted.includes(digest), 'Unrelated ' + label + ' input: ' + file);
 }
}

const proof = read('module-build/caramel-carnival-proof.json');
const previous = read('deployment/releases/caramel-prototype-20261117-v1/module-build-proof.json');
const selected = release.packages.find(p => p.gameId === game);
assert.equal(proof.gameId, selected.gameId);
assert.equal(proof.version, selected.version);
assert(proof.hostSingletonsExternalized && !proof.serverImplementationIncluded);
for (const file of scope.moduleBindings) {
 assert.equal(proof.sourceFiles[file], changed[file], 'Unbound module source: ' + file);
}
assert.deepEqual(Object.keys(proof.sourceFiles).sort(), Object.keys(previous.sourceFiles).sort());
for (const [file, digest] of Object.entries(scope.moduleProductionInputs)) {
 assert.equal(digest, before.sourceLF[file] ?? before.source[file], 'Retained module source changed: ' + file);
 assert.equal(digest, proof.sourceFiles[file], 'Retained module source is unbound: ' + file);
}
for (const [file, digest] of Object.entries(proof.sourceFiles)) {
 assert.equal(digest, changed[file] ?? scope.moduleProductionInputs[file] ?? previous.sourceFiles[file], 'Unrelated module input: ' + file);
}
for (const field of ['assetRoots', 'assetFiles', 'mediaReferences', 'dynamicMediaDirectories', 'hostBridges']) {
 assert.deepEqual(proof[field], previous[field], 'Module scope differs: ' + field);
}

const moduleDir = `module-dist/${game}/versions/${selected.version}/`;
const active = '/opt/royal-game-modules/' + game + '/active.json';
const oldFolder = '/opt/royal-game-modules/' + game + '/versions/' + previous.version + '/';
const priorPublic = read('deployment/releases/caramel-prototype-20261117-v1/verification.json').module;
assert.equal(before.moduleFiles[active], priorPublic.activePointerSha256, 'The expected Caramel Carnival is no longer active');
const pointer = read(selected.pointer);
const metadata = read(moduleDir + 'manifest.json');
assert.equal(metadata.sourceSha256, proof.sourceSha256);
assert.deepEqual(before.moduleHost.games[game], {apiVersion: 1, rulesVersion: 2, progressVersion: 1});
assert.equal(metadata.apiVersion, 1);
assert.equal(metadata.rulesVersion, 2);
assert.equal(metadata.progressVersion, 1);
assert.equal(before.moduleFiles[oldFolder + 'manifest.json'], priorPublic.manifestSha256);
const files = {'manifest.json': pointer.sha256, ...metadata.files};
const mediaNames = Object.keys(files).filter(n => /\.(?:png|jpe?g|webp|gif|avif|mp3|ogg|wav|woff2?)$/i.test(n));
for (const file of mediaNames) assert.equal(files[file], before.moduleFiles[oldFolder + file], 'Module media changed: ' + file);

fs.mkdirSync(out, {mode: 0o700});
function write(file, bytes) {
 const destination = path.join(out, file);
 fs.mkdirSync(path.dirname(destination), {recursive: true});
 fs.writeFileSync(destination, bytes, {flag: 'wx'});
 return sha(bytes);
}
for (const [file, bytes] of sourceFiles) assert.equal(write('source/' + file, bytes), changed[file]);
const delta = {};
for (const [file, digest] of Object.entries(release.files)) {
 if (!file.startsWith('dist/') || before.program[file] === digest) continue;
 const relative = file.slice(5);
 assert(relative === 'index.html' || /^assets\/[\w-]+\.(?:js|css)$/.test(relative), 'Foreign client output: ' + relative);
 assert(relative === 'index.html' || !before.program[file], 'Immutable URL collision: ' + relative);
 assert.equal(write('dist-delta/' + relative, fs.readFileSync(file)), digest);
 delta[relative] = digest;
}
assert(delta['index.html']);
const serverDelta = {'index.js': write('server-delta/index.js', fs.readFileSync('dist-server/index.js'))};
assert.equal(serverDelta['index.js'], release.backendProjection.output.sha256);
for (const [file, digest] of Object.entries(files)) {
 assert.equal(digest, release.files[moduleDir + file]);
 assert.equal(write('package/' + file, fs.readFileSync(moduleDir + file)), digest);
}

const references = {
 'production-guard.py': 'deployment/releases/skin-offers-20261105-v2/deploy.py',
 'engine-build.py': 'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
 'overlay-base.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py': 'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs': 'deployment/releases/skin-offers-20261105-v2/quiesce.cjs',
 'quiesce-base.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py': 'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
 'publisher.py': 'scripts/game-module-release.py',
};
const support = Object.fromEntries(Object.entries(references).map(([target, file]) => [target, write(target, verifySource(file, source))]));
assert.equal(support['publisher.py'], before.source[references['publisher.py']]);
const helperSha256 = write('deploy.py', verifySource(folder + '/deploy.py', source));
const scopeSha256 = write('scope.json', verifySource(folder + '/scope.json', source));
const snapshotSha256 = write('snapshot.py', verifySource('deployment/releases/mira-walk-24-20261107-v1/snapshot.py', source));
const releaseManifestSha256 = write('release-manifest.json', fs.readFileSync('module-build/release-manifest.json'));
const receiptSha256 = write('release-github.json', fs.readFileSync('module-build/release-github.json'));
assert.equal(releaseManifestSha256, receipt.manifestSha256);
const moduleProofSha256 = write('module-proof.json', fs.readFileSync('module-build/caramel-carnival-proof.json'));
write('install-manifest.json', Buffer.from(JSON.stringify({
 release: name, sourceCommit: source, baseCommit: before.sourceCommit, before, changed, delta, serverDelta,
 support, helperSha256, scopeSha256, snapshotSha256, releaseManifestSha256, receiptSha256, moduleProofSha256,
 addedGames: [], restoredGames: [], module: {version: selected.version, pointerSha256: release.files[selected.pointer], files},
}, null, 2) + '\n'));
console.log(JSON.stringify({source, version: selected.version, sources: sourceFiles.size, clientFiles: Object.keys(delta).length, moduleFiles: Object.keys(files).length, releaseManifestSha256, backendSha256: serverDelta['index.js']}));
