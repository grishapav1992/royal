import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';

const name = 'game-shell-login-20261127-v1';
const folder = 'deployment/releases/' + name;
const [snapshotFile, destination] = process.argv.slice(2);
assert(snapshotFile && destination, 'Specify the production snapshot and an empty destination');
const out = resolve(destination);
const root = process.cwd();
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { maxBuffer: 64 * 1024 ** 2 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const before = JSON.parse(readFileSync(snapshotFile));
const manifestBytes = readFileSync('module-build/release-manifest.json');
const receiptBytes = readFileSync('module-build/release-github.json');
const release = JSON.parse(manifestBytes);
const receipt = JSON.parse(receiptBytes);
const committed = file => git('show', release.sourceCommit + ':' + file);
const scope = JSON.parse(committed(folder + '/scope.json'));

assert.equal(git('status', '--porcelain').toString().trim(), '');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
assert.equal(receipt.sourceCommit, release.sourceCommit);
assert.equal(receipt.manifestSha256, digest(manifestBytes));
for (const commit of [release.sourceCommit, receipt.remoteMain]) git('merge-base', '--is-ancestor', commit, 'origin/main');
assert(release.clean && release.build.passed && release.scope === 'application');
assert.equal(release.baseCommit, before.sourceCommit);
assert(before.container.health === 'healthy' && before.container.image === before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);

const projection = release.hostProjection;
const reader = await readHostProjection(root, folder + '/host-projection.json', { strictOrigins: true });
assert.equal(reader.sha256, projection.sha256);
assert.equal(projection.productionCommit, before.sourceCommit);
const sources = new Map();
for (const [file, hash] of Object.entries(scope.sourceUpdates)) {
  assert.equal(projection.inputs[file], hash, 'Missing release input: ' + file);
  assert(![before.source[file], before.sourceLF[file]].includes(hash), 'Source already published: ' + file);
  sources.set(file, reader.read(file));
}
for (const [file, hash] of Object.entries(projection.inputs)) {
  assert([scope.sourceUpdates[file], before.source[file], before.sourceLF[file]].includes(hash), 'Unreviewed production input: ' + file);
}

const dist = Object.entries(release.files).filter(([file, hash]) => file.startsWith('dist/') && before.program[file] !== hash);
assert(dist.some(([file]) => file === 'dist/index.html'), 'Missing client index');
for (const [file] of dist) {
  assert(file === 'dist/index.html' || (!before.program[file] && /^dist\/assets\/[\w-]+\.(?:js|css)$/.test(file)),
    'Unexpected client delta: ' + file);
}

assert(!existsSync(out), 'Payload already exists');
mkdirSync(resolve(out, 'server-delta'), { recursive: true });
function write(file, bytes) {
  assert(!isAbsolute(file) && !file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')));
  const target = resolve(out, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  return digest(bytes);
}
const changed = {};
for (const [file, bytes] of sources) {
  changed[file] = write('source/' + file, bytes);
  assert.equal(changed[file], scope.sourceUpdates[file]);
}
const delta = {};
for (const [file, hash] of dist) {
  const relative = file.slice(5);
  delta[relative] = write('dist-delta/' + relative, readFileSync(file));
  assert.equal(delta[relative], hash);
}
const references = {
  'production-guard.py': 'deployment/releases/skin-offers-20261105-v2/deploy.py',
  'engine-build.py': 'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
  'overlay-base.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'snapshot-base.py': 'deployment/releases/universal-spins-20261031-v1/snapshot.py',
  'runtime-inventory.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
  'quiesce.cjs': 'deployment/releases/caribbean-voyage-20261125-v1/quiesce.cjs',
  'quiesce-base.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'financial_gate.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'image_metadata.py': 'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
  'scope.json': folder + '/scope.json',
};
const support = Object.fromEntries(Object.entries(references).map(([file, source]) => [file, write(file, committed(source))]));
const manifest = {
  release: name, sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit, before,
  changed, delta, serverDelta: {}, support, activeGames: scope.activeBefore, addedGames: [], restoredGames: [],
  helperSha256: write('deploy.py', committed(folder + '/deploy.py')),
  snapshotSha256: write('snapshot.py', committed('deployment/releases/mira-walk-24-20261107-v1/snapshot.py')),
  releaseManifestSha256: write('release-manifest.json', manifestBytes),
  receiptSha256: write('release-github.json', receiptBytes),
};
write('install-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ release: name, sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length }));
