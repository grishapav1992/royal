import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const name = 'club-conduct-20261107-v1';
const folder = `deployment/releases/${name}`;
const baselineCommit = '2a077d6174cc13b4f6cc10d13d66cb2ff5bbbef5';
const baselineImage = 'sha256:9ddb3517cdaa91cc111a630d3eab7634a8525ae8444d80dfdceed612851361a1';
const english = 'src/i18n/en.ts';
const preservedBackend = {
  [english]: 'e6a39483750df92467b584e98319ce679f2a3489669e4b0d3f64a2d7ba0a762c',
  'src/i18n/progressionEn.ts': '66c68ac05b3b362c4ef1dae60afaeb1c484d6ada0887adefd9954a4de12c1ba4',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {maxBuffer: 64 * 1024 ** 2});

assert.equal(process.argv.length, 4, 'Provide the reviewed baseline snapshot and a new payload directory');
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = path.resolve(process.argv[3]);
assert.equal(git('status', '--porcelain').toString().trim(), '', 'Release source must be clean');
assert.equal(before.sourceCommit, baselineCommit, 'Unexpected production source');
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, baselineImage);
assert.equal(before.preparedImage, baselineImage);
assert.deepEqual(before.program, before.preparedProgram, 'Production and prepared program differ');
assert(!fs.existsSync(out), 'Payload already exists');

const releaseBytes = fs.readFileSync('module-build/release-manifest.json');
const receiptBytes = fs.readFileSync('module-build/release-github.json');
const release = JSON.parse(releaseBytes);
const receipt = JSON.parse(receiptBytes);
assert.equal(release.sourceCommit, receipt.sourceCommit);
assert.equal(git('rev-parse', 'HEAD').toString().trim(), release.sourceCommit);
assert.equal(git('rev-parse', 'HEAD^{tree}').toString().trim(), release.sourceTree);
git('merge-base', '--is-ancestor', baselineCommit, release.sourceCommit);
git('merge-base', '--is-ancestor', release.sourceCommit, receipt.remoteMain);
git('merge-base', '--is-ancestor', receipt.remoteMain, 'origin/main');
assert.equal(sha(releaseBytes), receipt.manifestSha256);
assert.equal(release.baseCommit, baselineCommit);
assert.equal(release.scope, 'application');
assert(release.clean && release.build.passed);
const committed = file => git('show', `${release.sourceCommit}:${file}`);

const replacements = new Map();
const configFiles = new Map();
const projectionChanges = {};
for (const kind of ['host', 'backend']) {
  const config = `${kind}-projection.json`;
  const file = `${folder}/${config}`;
  const bytes = committed(file);
  const report = release[`${kind}Projection`];
  assert.deepEqual(report, release.build[`${kind}Projection`]);
  assert.equal(report.config, file);
  assert.equal(report.productionCommit, baselineCommit);
  assert.equal(report.sha256, sha(bytes));
  configFiles.set(config, bytes);
  const reader = await readHostProjection(process.cwd(), file, {strictOrigins: true});
  const previousDigest = name => kind === 'backend' && Object.hasOwn(preservedBackend, name)
    ? [preservedBackend[name]] : [before.source[name], before.sourceLF[name]];
  const changed = Object.entries(report.inputs).filter(([name, digest]) => !previousDigest(name).includes(digest));
  reader.preload(changed.map(([name]) => name));
  projectionChanges[kind] = Object.fromEntries(changed);
  for (const [name, digest] of changed) {
    assert(/^(src|server)\/.+\.(ts|css)$/.test(name), `Unexpected ${kind} source change: ${name}`);
    const projected = reader.read(name);
    assert.equal(sha(projected), digest, `Changed ${kind} input differs: ${name}`);
    assert.deepEqual(reader.origins[name], report.origins[name]);
    const existing = replacements.get(name);
    if (existing) {
      assert(name === english || existing.equals(projected), `Host and backend changed differently: ${name}`);
    } else {
      replacements.set(name, projected);
    }
  }
}
assert(projectionChanges.host[english] && projectionChanges.backend[english], 'Missing English language updates');
assert.equal(release.backendProjection.output.path, 'dist-server/index.js');
assert.deepEqual(release.backendProjection.entries, ['server/index.ts']);
const backendBytes = fs.readFileSync(release.backendProjection.output.path);
assert.equal(sha(backendBytes), release.backendProjection.output.sha256);
assert.equal(sha(backendBytes), release.files[release.backendProjection.output.path]);

const client = new Map();
for (const [file, digest] of Object.entries(release.files)) {
  if (!file.startsWith('dist/') || before.program[file] === digest) continue;
  const relative = file.slice('dist/'.length);
  assert(relative === 'index.html' || /^assets\/[\w-]+\.(js|css)$/.test(relative), 'Unexpected client artifact');
  assert(relative === 'index.html' || !Object.hasOwn(before.program, file), `Immutable URL collision: ${file}`);
  const bytes = fs.readFileSync(file);
  assert.equal(sha(bytes), digest, `Changed client artifact differs: ${file}`);
  client.set(relative, bytes);
}
assert(client.has('index.html'), 'Missing updated host index');

function write(file, bytes) {
  assert(!path.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(part =>
    !part || part === '.' || part === '..' || part.startsWith('.env')));
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes, {flag: 'wx'});
  return sha(bytes);
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
};

const changed = Object.fromEntries(Array.from(replacements, ([file, bytes]) => [file, write(`source/${file}`, bytes)]));
const delta = Object.fromEntries(Array.from(client, ([file, bytes]) => [file, write(`dist-delta/${file}`, bytes)]));
const serverDelta = {'index.js': write('server-delta/index.js', backendBytes)};
const support = Object.fromEntries(Object.entries(references).map(([file, source]) => [file, write(file, committed(source))]));
for (const [file, bytes] of configFiles) write(file, bytes);
const manifest = {
  release: name, sourceCommit: release.sourceCommit, baseCommit: baselineCommit,
  before, changed, delta, serverDelta, projectionChanges, support,
  helperSha256: write('deploy.py', committed(`${folder}/deploy.py`)),
  snapshotSha256: write('snapshot.py', committed('deployment/releases/mira-walk-24-20261107-v1/snapshot.py')),
  releaseManifestSha256: write('release-manifest.json', releaseBytes),
  receiptSha256: write('release-github.json', receiptBytes),
  addedGames: [], restoredGames: [],
};
write('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({out, sourceFiles: Object.keys(changed).length, clientFiles: client.size, backendFiles: 1}));
