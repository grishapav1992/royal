// Package the scoped rooftop window update for the guarded application installer.
// Usage: node deployment/releases/roof-toilet-window-20261126-v2/prepare.mjs <before.json> <empty-destination>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';

const name = 'roof-toilet-window-20261126-v2';
const folder = 'deployment/releases/' + name;
const [snapshotFile, target] = process.argv.slice(2);
assert(snapshotFile && target, 'Specify the production snapshot and an empty destination');
const root = process.cwd(), out = path.resolve(target);
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, { maxBuffer: 64 * 1024 ** 2 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = JSON.parse(fs.readFileSync(snapshotFile));
const releaseBytes = fs.readFileSync('module-build/release-manifest.json');
const receiptBytes = fs.readFileSync('module-build/release-github.json');
const release = JSON.parse(releaseBytes), receipt = JSON.parse(receiptBytes);
const committed = file => git('show', release.sourceCommit + ':' + file);
const scope = JSON.parse(committed(folder + '/scope.json'));
assert.equal(git('status', '--porcelain').toString().trim(), '');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
assert.equal(receipt.sourceCommit, release.sourceCommit);
assert.equal(receipt.manifestSha256, sha(releaseBytes));
for (const commit of [release.sourceCommit, receipt.remoteMain]) git('merge-base', '--is-ancestor', commit, 'origin/main');
assert(release.clean && release.build.passed && release.scope === 'application');
assert.equal(release.baseCommit, before.sourceCommit);
assert(before.container.health === 'healthy' && before.container.image === before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);

const sources = new Map();
for (const [key, changed, buildOnly] of [['hostProjection', scope.host, {}], ['backendProjection', scope.backend, scope.backendBuildInputs]]) {
  const projection = release[key], reader = await readHostProjection(root, projection.config, { strictOrigins: true });
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
const foreign = Object.entries(release.files).filter(([file, digest]) => file.startsWith('dist/') && before.program[file] !== digest);
assert(foreign.some(([file]) => file === 'dist/index.html'), 'Missing client index');
for (const [file] of foreign) {
  assert(file === 'dist/index.html' || (!before.program[file] && /^dist\/assets\/[\w-]+\.(?:js|css)$/.test(file)),
    'Unexpected client delta: ' + file);
}

assert(!fs.existsSync(out), 'Payload already exists');
fs.mkdirSync(path.join(out, 'dist-delta'), { recursive: true });
function write(file, bytes) {
  assert(!path.isAbsolute(file) && !file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')));
  const destination = path.join(out, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  return sha(bytes);
}
const changed = {};
for (const [file, bytes] of sources) {
  assert.notEqual(before.source[file], scope.host[file] ?? scope.backend[file], 'Production already carries ' + file);
  changed[file] = write('source/' + file, bytes);
  assert.equal(changed[file], scope.host[file] ?? scope.backend[file]);
}
const backend = fs.readFileSync('dist-server/index.js');
assert.equal(sha(backend), release.files['dist-server/index.js']);
assert.equal(sha(backend), release.backendProjection.output.sha256);
assert.notEqual(sha(backend), before.program['dist-server/index.js']);
const delta = Object.fromEntries(foreign.map(([file, hash]) => {
  const relative = file.slice(5);
  assert.equal(write('dist-delta/' + relative, fs.readFileSync(file)), hash);
  return [relative, hash];
}));
const serverDelta = { 'index.js': write('server-delta/index.js', backend) };

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
  release: name, sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit, before, changed, delta, serverDelta, support,
  helperSha256: write('deploy.py', committed(folder + '/deploy.py')),
  snapshotSha256: write('snapshot.py', committed('deployment/releases/mira-walk-24-20261107-v1/snapshot.py')),
  activeGames: scope.activeBefore, addedGames: [], restoredGames: [],
  releaseManifestSha256: write('release-manifest.json', releaseBytes),
  receiptSha256: write('release-github.json', receiptBytes),
};
write('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({ release: name, sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length, backendFiles: 1 }));
