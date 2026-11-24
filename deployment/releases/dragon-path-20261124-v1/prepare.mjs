import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';

const name = 'dragon-path-20261124-v1';
const folder = 'deployment/releases/' + name;
const [snapshotFile, target] = process.argv.slice(2);
assert(snapshotFile && target, 'Specify the production snapshot and an empty destination');
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 ** 2 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString());
const file = name => fs.readFileSync(name);
const before = json(file(snapshotFile));
const out = path.resolve(target);
const releaseBytes = file('module-build/release-manifest.json');
const githubBytes = file('module-build/release-github.json');
const release = json(releaseBytes);
const github = json(githubBytes);
const fromGit = (file, commit = release.sourceCommit) => git('show', commit + ':' + file);
const scope = json(fromGit(folder + '/scope.json'));
const { game } = scope;
assert.equal(git('status', '--porcelain').toString().trim(), '');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
assert.equal(github.sourceCommit, release.sourceCommit);
assert.equal(sha(releaseBytes), github.manifestSha256);
assert.equal(before.sourceCommit, release.baseCommit);
assert(before.container.health === 'healthy' && before.container.image === before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
assert(!before.moduleHost.games[game]);
for (const commit of [release.sourceCommit, github.remoteMain]) git('merge-base', '--is-ancestor', commit, 'origin/main');
assert(release.build.passed && release.clean && release.scope === 'application');

const sources = new Map();
for (const [key, changed, buildOnly] of [['hostProjection', scope.host, {}], ['backendProjection', scope.backend, scope.backendBuildInputs]]) {
  const projection = release[key];
  const reader = await readHostProjection(root, projection.config, { strictOrigins: true });
  assert.equal(reader.sha256, projection.sha256);
  assert.equal(projection.productionCommit, before.sourceCommit);
  for (const [file, digest] of Object.entries(changed)) {
    assert.equal(projection.inputs[file], digest, 'Missing release input: ' + file);
    sources.set(file, reader.read(file));
  }
  for (const [file, digest] of Object.entries(projection.inputs)) {
    assert([changed[file], buildOnly[file], before.source[file], before.sourceLF[file]].includes(digest), 'Unreviewed production input: ' + file);
  }
}

fs.mkdirSync(out);
function write(name, bytes) {
  assert(!path.isAbsolute(name) && !name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')));
  const destination = path.join(out, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  return sha(bytes);
}
function verifiedWrite(target, bytes, digest) {
  assert.equal(sha(bytes), digest, 'Mismatched bytes: ' + target);
  return write(target, bytes);
}
for (const [name, digest] of Object.entries(scope.sources)) verifiedWrite('source/' + name, sources.get(name) ?? fromGit(name), digest);
const delta = {};
for (const [file, digest] of Object.entries(release.files).filter(([name]) => name.startsWith('dist/'))) {
  if (before.program[file] === digest) continue;
  const relative = file.slice(5);
  assert(relative === 'index.html' || /^assets\/[\w-]+\.(?:js|css)$/.test(relative), 'Foreign host output: ' + file);
  assert(relative === 'index.html' || !before.program[file], 'Immutable asset collision: ' + file);
  delta[relative] = verifiedWrite('dist-delta/' + relative, fileBytes(file), digest);
}
function fileBytes(name) { return fs.readFileSync(name); }
assert(delta['index.html']);
for (const [name, digest] of Object.entries(scope.media)) {
  assert(!before.program['dist/' + name], 'Existing media in first release: ' + name);
  delta[name] = verifiedWrite('dist-delta/' + name, fromGit('public/' + name), digest);
}
const serverDelta = { 'index.js': verifiedWrite('server-delta/index.js', file('dist-server/index.js'), release.files['dist-server/index.js']) };
const [built] = release.packages;
assert(release.packages.length === 1 && built.gameId === game);
const pointerBytes = file(built.pointer);
const pointer = json(pointerBytes);
assert.equal(sha(pointerBytes), release.files[built.pointer]);
const packagePrefix = `module-dist/${game}/versions/${built.version}/`;
assert.equal(pointer.manifest, '/' + packagePrefix.replace('module-dist', 'game-modules') + 'manifest.json');
const packageFiles = Object.fromEntries(Object.entries(release.files)
  .filter(([name]) => name.startsWith(packagePrefix)).map(([name, digest]) => [name.slice(packagePrefix.length), digest]));
assert.equal(packageFiles['manifest.json'], pointer.sha256);
for (const [name, digest] of Object.entries(packageFiles)) verifiedWrite('package/' + name, file(packagePrefix + name), digest);
const contract = { ...before.moduleHost, games: { ...before.moduleHost.games, [game]: scope.contract } };
const hostContractsSha256 = write('host-contracts.json', Buffer.from(JSON.stringify(contract, null, 2) + '\n'));

const helpers = {
  'production-guard.py': 'deployment/releases/skin-offers-20261105-v2/deploy.py',
  'engine-build.py': 'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
  'overlay-base.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'snapshot-base.py': 'deployment/releases/universal-spins-20261031-v1/snapshot.py',
  'runtime-inventory.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
  'quiesce.cjs': folder + '/quiesce.cjs',
  'quiesce-base.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'financial_gate.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'image_metadata.py': 'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
  'publisher.py': 'scripts/game-module-release.py',
  'scope.json': folder + '/scope.json',
};
const support = Object.fromEntries(Object.entries(helpers).map(([name, source]) => [name, write(name, fromGit(source))]));
const helperSha256 = write('deploy.py', fromGit(folder + '/deploy.py'));
const snapshotSha256 = write('snapshot.py', fromGit('deployment/releases/mira-walk-24-20261107-v1/snapshot.py'));
const installerReceipt = {
  sourceCommit: git('log', '-1', '--format=%H', release.sourceCommit, '--', folder + '/deploy.py').toString().trim(),
  remoteMain: github.remoteMain,
  applicationSourceCommit: release.sourceCommit,
  files: { 'deploy.py': helperSha256, 'quiesce.cjs': support['quiesce.cjs'] },
};
git('merge-base', '--is-ancestor', installerReceipt.sourceCommit, 'origin/main');
for (const [name, digest] of Object.entries(installerReceipt.files)) assert.equal(sha(fromGit(folder + '/' + name, installerReceipt.sourceCommit)), digest);
const install = {
  release: name, sourceCommit: release.sourceCommit, baseCommit: release.baseCommit, before,
  changed: scope.sources, delta, serverDelta, support, helperSha256, snapshotSha256, hostContractsSha256,
  activeGames: [game, ...scope.activeBefore], addedGames: [game], restoredGames: [],
  package: { version: built.version, files: packageFiles, pointerSha256: sha(pointerBytes) },
  releaseManifestSha256: write('release-manifest.json', releaseBytes), receiptSha256: write('release-github.json', githubBytes),
  installerReceiptSha256: write('installer-github.json', Buffer.from(JSON.stringify(installerReceipt, null, 2) + '\n')),
};
write('install-manifest.json', Buffer.from(JSON.stringify(install, null, 2) + '\n'));
console.log(JSON.stringify({ release: name, client: Object.keys(delta).length, source: Object.keys(scope.sources).length, package: built.version }));
