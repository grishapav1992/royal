import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';

const name = 'password-login-20261119-v1';
const folder = `deployment/releases/${name}`;
const [, , baseline, output] = process.argv;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 ** 2 });
const read = filename => JSON.parse(fs.readFileSync(filename));
const before = read(baseline);
const scope = read(`${folder}/scope.json`);
const releasePath = 'module-build/release-manifest.json', receiptPath = 'module-build/release-github.json';
const release = read(releasePath), receipt = read(receiptPath);
const committed = filename => git('show', release.sourceCommit + ':' + filename);
assert(output && !fs.existsSync(output));
assert.equal(git('status', '--porcelain').toString().trim(), '');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
for (const commit of [release.sourceCommit, receipt.remoteMain]) git('merge-base', '--is-ancestor', commit, 'origin/main');
assert.equal(release.sourceCommit, receipt.sourceCommit);
assert.equal(hash(fs.readFileSync(releasePath)), receipt.manifestSha256);
assert(release.clean && release.build.passed && release.scope === 'application');
assert.equal(release.baseCommit, before.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
assert.equal(before.program['dist-server/index.js'], scope.oldBackendDigest);

const sources = new Map();
for (const [kind, retained] of [['host', {}], ['backend', scope.retainedBackendInputs]]) {
  const proof = release[kind + 'Projection'];
  const reader = await readHostProjection(process.cwd(), `${folder}/${kind}-projection.json`, { strictOrigins: true });
  assert.equal(reader.sha256, proof.sha256);
  assert.equal(proof.productionCommit, before.sourceCommit);
  for (const [file, digest] of Object.entries(proof.inputs)) {
    if (!scope[kind].includes(file)) {
      assert((Object.hasOwn(retained, file) ? [retained[file]] : [before.source[file], before.sourceLF[file]]).includes(digest), file);
    }
  }
  for (const file of scope[kind]) {
    assert(!sources.has(file), file);
    const bytes = reader.read(file);
    assert.equal(hash(bytes), proof.inputs[file], file);
    sources.set(file, bytes);
  }
}
const dist = Object.entries(release.files).filter(([file, digest]) => file.startsWith('dist/') && before.program[file] !== digest);
assert(dist.some(([file]) => file === 'dist/index.html'));
for (const [file] of dist) {
  assert(file === 'dist/index.html' || (!before.program[file] && /^dist\/assets\/[\w-]+\.(?:js|css)$/.test(file)), file);
}
assert(!release.build.moduleProjection);
const backend = 'dist-server/index.js';
assert.equal(release.backendProjection.output.sha256, release.files[backend]);

fs.mkdirSync(output);
function write(filename, bytes) {
  const target = path.join(output, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return hash(bytes);
}
function artifact(source, destination, digest) {
  const bytes = fs.readFileSync(source);
  assert.equal(hash(bytes), digest, source);
  return write(destination, bytes);
}
const changed = Object.fromEntries([...sources].map(([file, bytes]) => [file, write('source/' + file, bytes)]));
const delta = Object.fromEntries(dist.map(([file, digest]) => [file.slice(5), artifact(file, 'dist-delta/' + file.slice(5), digest)]));
const serverDelta = { 'index.js': artifact(backend, 'server-delta/index.js', release.files[backend]) };
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
  'scope.json': `${folder}/scope.json`,
};
const support = Object.fromEntries(Object.entries(helpers).map(([file, source]) => [file, write(file, committed(source))]));
const manifest = {
  release: name, sourceCommit: release.sourceCommit, baseCommit: release.baseCommit, before, changed, delta, serverDelta, support,
  helperSha256: write('deploy.py', committed(`${folder}/deploy.py`)),
  snapshotSha256: write('snapshot.py', committed('deployment/releases/mira-walk-24-20261107-v1/snapshot.py')),
  releaseManifestSha256: write('release-manifest.json', fs.readFileSync(releasePath)),
  receiptSha256: write('release-github.json', fs.readFileSync(receiptPath)),
  addedGames: [], restoredGames: [],
};
write('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({ source: Object.keys(changed).length, host: Object.keys(delta).length,
  backend: Object.keys(serverDelta).length }));
