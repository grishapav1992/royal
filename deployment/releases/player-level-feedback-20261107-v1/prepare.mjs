import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';
import { digest } from '../../../scripts/module-build-cache.mjs';

const name = 'player-level-feedback-20261107-v1';
const folder = 'deployment/releases/' + name;
const [baseline, output, installer] = process.argv.slice(2);
assert.match(installer, /^[0-9a-f]{40}$/);
const out = path.resolve(output);
assert(!fs.existsSync(out), 'Existing payload is immutable');
const read = name => JSON.parse(fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, ''));
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 ** 2 });
const text = (...args) => git(...args).toString().trim();
const committed = (ref, file) => git('show', ref + ':' + file);
const release = read('module-build/release-manifest.json');
const receipt = read('module-build/release-github.json');
const before = read(baseline);
const scope = read(folder + '/scope.json');
assert.equal(text('status', '--porcelain'), '');
assert.equal(text('rev-parse', 'HEAD'), release.sourceCommit);
assert.equal(receipt.sourceCommit, release.sourceCommit);
assert.equal(receipt.manifestSha256, digest(fs.readFileSync('module-build/release-manifest.json')));
assert(release.githubVerified && release.clean && release.build.passed);
assert.equal(release.baseCommit, before.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
for (const ref of [release.sourceCommit, receipt.remoteMain, installer]) git('merge-base', '--is-ancestor', ref, 'origin/main');
const changedOnlyReleaseTooling = text('diff', '--name-only', installer + '^', installer).split('\n');
assert(changedOnlyReleaseTooling.length && changedOnlyReleaseTooling.every(file => file.startsWith(folder + '/')), 'Installer revision must only contain app release tooling');
const config = kind => folder + '/' + kind + '-projection.json';
const readers = {};
for (const kind of ['host', 'backend']) {
  const report = release[kind + 'Projection'];
  readers[kind] = await readHostProjection(process.cwd(), config(kind), { strictOrigins: true });
  assert.equal(report.sha256, digest(committed(release.sourceCommit, config(kind))));
  for (const [file, hash] of Object.entries(report.inputs)) {
    const preserved = kind === 'backend' && scope.preservedBackendInputs[file];
    const expected = preserved || scope.changed[file];
    assert(expected ? expected === hash : [before.source[file], before.sourceLF[file]].includes(hash), 'Unreviewed input: ' + file);
  }
  for (const file of scope.inputs[kind]) assert.equal(report.inputs[file], scope.changed[file], file);
}

function write(name, bytes) {
  assert(!path.isAbsolute(name) && !name.split('/').some(p => !p || p === '..' || p === '.' || p.startsWith('.env')));
  const target = path.join(out, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return digest(bytes);
}
const changed = {}, delta = {}, serverDelta = {};
for (const kind of ['host', 'backend', 'qualifications']) {
  for (const file of scope.inputs[kind]) {
    if (Object.hasOwn(changed, file)) continue;
    const bytes = readers[kind] ? readers[kind].read(file) : committed(release.sourceCommit, file);
    assert.equal(digest(bytes), scope.changed[file]);
    changed[file] = write('source/' + file, bytes);
  }
}
for (const [file, hash] of Object.entries(release.files)) {
  if (!file.startsWith('dist/') || before.program[file] === hash) continue;
  const name = file.slice(5);
  assert(name === 'index.html' || /^assets\/[\w-]+\.(js|css)$/.test(name), 'Unexpected client output');
  assert(name === 'index.html' || !before.program[file], 'Immutable URL collision');
  assert.equal(delta[name] = write('dist-delta/' + name, fs.readFileSync(file)), hash);
}
assert(delta['index.html']);
assert.equal(serverDelta['index.js'] = write('server-delta/index.js', fs.readFileSync('dist-server/index.js')),
  release.backendProjection.output.sha256);
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
};
const support = Object.fromEntries(Object.entries(references).map(([name, file]) => [name, write(name, committed(installer, file))]));
const installerReceipt = { format: 1, sourceCommit: installer, applicationSourceCommit: release.sourceCommit,
  remoteMain: text('rev-parse', 'origin/main'), changedOnlyReleaseTooling };
const helperReceiptSha256 = write('installer-github.json', JSON.stringify(installerReceipt));
const helperSha256 = write('deploy.py', committed(installer, folder + '/deploy.py'));
const snapshotSha256 = write('snapshot.py', committed(installer, 'deployment/releases/mira-walk-24-20261107-v1/snapshot.py'));
const scopeSha256 = write('scope.json', committed(release.sourceCommit, folder + '/scope.json'));
for (const file of ['release-manifest.json', 'release-github.json']) write(file, fs.readFileSync('module-build/' + file));
const manifest = { release: name, sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit,
  helperSourceCommit: installer, helperReceiptSha256, before, changed, delta, serverDelta, support, helperSha256,
  snapshotSha256, scopeSha256, releaseManifestSha256: receipt.manifestSha256,
  receiptSha256: digest(fs.readFileSync('module-build/release-github.json')), addedGames: [], restoredGames: [] };
console.log(JSON.stringify({ out, source: release.sourceCommit, sourceFiles: Object.keys(changed).length,
  clientFiles: Object.keys(delta).length, manifestSha256: write('install-manifest.json', JSON.stringify(manifest)) }));
