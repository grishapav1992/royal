import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { digest } from '../../../scripts/module-build-cache.mjs';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';

const name = 'player-level-feedback-roulette-20261107-v1';
const app = 'player-level-feedback-20261107-v1';
const game = 'royal-roulette';
const [baseline, appPayload, helperHashes, output, installer] = process.argv.slice(2);
assert.match(installer, /^[0-9a-f]{40}$/);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const before = read(baseline);
const installed = read(path.join(appPayload, 'install-manifest.json'));
const appRelease = read(path.join(appPayload, 'release-manifest.json'));
const release = read('module-build/release-manifest.json');
const receipt = read('module-build/release-github.json');
const proof = read('module-build/' + game + '-proof.json');
const helpers = read(helperHashes);
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 ** 2 });
const text = (...args) => git(...args).toString().trim();
const committed = (ref, file) => git('show', ref + ':' + file);
assert.equal(text('status', '--porcelain'), '');
assert.equal(text('rev-parse', 'HEAD'), release.sourceCommit);
assert.equal(release.sourceCommit, appRelease.sourceCommit);
assert.equal(release.sourceCommit, before.sourceCommit);
assert.equal(release.baseCommit, installed.baseCommit);
assert.equal(receipt.sourceCommit, release.sourceCommit);
assert.equal(receipt.manifestSha256, digest(fs.readFileSync('module-build/release-manifest.json')));
assert.deepEqual(release.modules, [game]);
assert(release.githubVerified && release.clean && release.build.passed);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
for (const ref of [release.sourceCommit, receipt.remoteMain, installer]) git('merge-base', '--is-ancestor', ref, 'origin/main');
const host = before.moduleHost.games[game];
assert.deepEqual(host, { apiVersion: 1, rulesVersion: 1, progressVersion: 1 });
const sourcePath = 'games/' + game + '/RoyalRoulette.ts';
const config = 'deployment/releases/' + app + '/module-projection.json';
const reader = await readHostProjection(process.cwd(), config, { strictOrigins: true });
const source = { [sourcePath]: digest(reader.read(sourcePath)) };
assert.equal(source[sourcePath], digest(committed(release.sourceCommit, sourcePath)));
const compiled = release.moduleProjection.modules[game];
const tested = appRelease.build.moduleProjection.modules[game];
assert.equal(compiled.version, tested.version);
assert.deepEqual(compiled.files, tested.files);
assert.equal(compiled.manifestSha256, tested.manifestSha256);
for (const [file, hash] of Object.entries(release.moduleProjection.inputs)) {
  assert.equal(hash, source[file] ?? before.sourceLF[file], 'Unexpected module input: ' + file);
}

const out = path.resolve(output);
assert(!fs.existsSync(out), 'Existing payload is immutable');
function write(name, bytes) {
  assert(!path.isAbsolute(name) && !name.split('/').some(p => !p || p === '..' || p === '.'));
  const target = path.join(out, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return digest(bytes);
}
const installerPath = 'deployment/releases/' + name + '/publish.py';
const installerSha256 = write('publish.py', committed(installer, installerPath));
const guardSha256 = write('publish-base.py', committed(installer, 'deployment/releases/roulette-ball-physics-20261105-v1/publish.py'));
const publisherSha256 = write('publisher.py', committed(release.sourceCommit, 'scripts/game-module-release.py'));
assert.equal(publisherSha256, before.source['scripts/game-module-release.py']);
const installerReceipt = { sourceCommit: installer, includedInMain: true, remoteMain: text('rev-parse', 'origin/main'),
  files: { [installerPath]: installerSha256 } };
const installerReceiptSha256 = write('installer-github.json', JSON.stringify(installerReceipt));
const manifestSha256 = write('release-manifest.json', fs.readFileSync('module-build/release-manifest.json'));
const receiptSha256 = write('release-github.json', fs.readFileSync('module-build/release-github.json'));
const proofSha256 = write('module-proof.json', JSON.stringify(proof));
const beforeSha256 = write('before.json', JSON.stringify(before));
const pointerFile = 'module-dist/' + game + '/active.json';
const pointerSha256 = digest(fs.readFileSync(pointerFile));
assert.equal(pointerSha256, release.files[pointerFile]);
assert.equal(pointerSha256, appRelease.files[pointerFile]);
for (const file of ['manifest.json', ...Object.keys(compiled.files)]) {
  const target = compiled.manifestPath.replace(/manifest\.json$/, file);
  assert.equal(write('package/' + file, fs.readFileSync(target)), release.files[target]);
}
write('source/' + sourcePath, reader.read(sourcePath));
const oldPointer = '/opt/royal-game-modules/' + game + '/active.json';
const oldVersions = Object.keys(before.moduleFiles).filter(n => n.startsWith('/opt/royal-game-modules/' + game + '/versions/') && n.endsWith('/manifest.json'));
const oldVersion = oldVersions.find(n => n.endsWith('/1.6.2-7e7da59084f0/manifest.json'))?.split('/')[5];
assert(oldVersion && before.moduleFiles[oldPointer]);
const operator = { sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit, buildBaseCommit: release.baseCommit,
  installerSourceCommit: installer, source, beforeSha256, installerSha256, guardSha256, publisherSha256, manifestSha256,
  receiptSha256, installerReceiptSha256, proofSha256, pointerSha256, oldVersion, helpers,
  snapshotReader: '/opt/royal-releases/' + app + '/snapshot.py' };
console.log(JSON.stringify({ out, version: compiled.version, operatorSha256: write('operator.json', JSON.stringify(operator)) }));
