import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';

const root = process.cwd();
const name = 'entry-chooser-20261119-v1';
const folder = 'deployment/releases/' + name;
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = path.resolve(process.argv[3]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 ** 2 });
assert.equal(git('status', '--porcelain').toString().trim(), '');

const releaseBytes = fs.readFileSync('module-build/release-manifest.json');
const receiptBytes = fs.readFileSync('module-build/release-github.json');
const release = JSON.parse(releaseBytes);
const receipt = JSON.parse(receiptBytes);
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
assert.equal(release.sourceCommit, receipt.sourceCommit);
for (const commit of [release.sourceCommit, receipt.remoteMain]) git('merge-base', '--is-ancestor', commit, 'origin/main');
assert.equal(sha(releaseBytes), receipt.manifestSha256);
assert.equal(release.baseCommit, before.sourceCommit);
assert(release.clean && release.build.passed);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);

const committed = file => git('show', release.sourceCommit + ':' + file);
const { client, previews } = JSON.parse(committed(folder + '/scope.json'));
const reader = await readHostProjection(root, folder + '/host-projection.json', { strictOrigins: true });
assert.equal(reader.sha256, release.hostProjection.sha256);
const clientBytes = Object.fromEntries(client.map(file => [file, reader.read(file)]));
for (const [file, bytes] of Object.entries(clientBytes)) {
  assert.equal(sha(bytes), release.hostProjection.inputs[file]);
  assert(bytes.equals(committed(file)), 'Entry source differs: ' + file);
}
for (const [file, hash] of Object.entries(release.hostProjection.inputs)) {
  if (!Object.hasOwn(clientBytes, file)) {
    assert([before.source[file], before.sourceLF[file]].includes(hash), 'Unrelated input: ' + file);
  }
}

const media = {};
const previewBytes = Object.fromEntries(previews.map(file => [file, committed(file)]));
const dist = Object.entries(release.files).filter(([file]) => file.startsWith('dist/'));
for (const [file, bytes] of Object.entries(previewBytes)) {
  const { name: stem, ext } = path.parse(file);
  const matches = dist.filter(([output, digest]) =>
    output.startsWith('dist/assets/' + stem + '-') && output.endsWith(ext) && digest === sha(bytes));
  assert.equal(matches.length, 1, 'Preview build differs: ' + file);
  media[file] = matches[0][0].slice(5);
}

assert(!fs.existsSync(out), 'Payload already exists');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, 'server-delta'));
function write(file, bytes) {
  assert(!path.isAbsolute(file) && !file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')));
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return sha(bytes);
}

const changed = {};
for (const [file, bytes] of Object.entries({ ...clientBytes, ...previewBytes })) changed[file] = write('source/' + file, bytes);
const delta = {};
for (const [file, hash] of dist) {
  if (before.program[file] === hash) continue;
  const relative = file.slice(5);
  assert(relative === 'index.html' || Object.values(media).includes(relative) || /^assets\/[\w-]+\.(?:js|css)$/.test(relative),
    'Foreign host artifact: ' + relative);
  assert(relative === 'index.html' || !before.program[file], 'Immutable URL collision');
  const bytes = fs.readFileSync(file);
  assert.equal(sha(bytes), hash);
  delta[relative] = write('dist-delta/' + relative, bytes);
}
assert(delta['index.html']);
assert(Object.values(media).every(file => delta[file]));

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
  'scope.json': folder + '/scope.json',
};
const support = {};
for (const [name, source] of Object.entries(references)) support[name] = write(name, committed(source));
const helperSha256 = write('deploy.py', committed(folder + '/deploy.py'));
const snapshotSha256 = write('snapshot.py', committed('deployment/releases/mira-walk-24-20261107-v1/snapshot.py'));
const manifest = {
  release: name, sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit, before, changed, delta, media,
  serverDelta: {}, support, helperSha256, snapshotSha256, addedGames: [], restoredGames: [],
  releaseManifestSha256: write('release-manifest.json', releaseBytes),
  receiptSha256: write('release-github.json', receiptBytes),
};
write('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({ sourceFiles: Object.keys(changed).length, clientFiles: Object.keys(delta).length, backendFiles: 0 }));
