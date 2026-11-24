import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {readHostProjection} = await import(pathToFileURL(path.resolve('scripts/build-host-projection.mjs')));
const {verifyRelease} = await import(pathToFileURL(path.resolve('scripts/release.mjs')));

const [review, output, toolRef] = process.argv.slice(2);
assert(review && output && toolRef, 'Usage: prepare.mjs <review-directory> <output-directory> <installer-commit>');
const hash = data => createHash('sha256').update(data).digest('hex');
const read = file => fs.readFileSync(file);
const json = file => JSON.parse(read(file));
const encoded = value => JSON.stringify(value, null, 2) + '\n';
const git = (...args) => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, {maxBuffer: 32 * 1024 ** 2});
const put = (name, data) => {
 const file = path.join(output, name);
 fs.mkdirSync(path.dirname(file), {recursive: true});
 fs.writeFileSync(file, data, {flag: 'wx'});
 return hash(data);
};

assert(!fs.existsSync(output), 'Output already exists');
const folder = 'deployment/releases/slot-entry-notes-20261124-v1';
const release = await verifyRelease(process.cwd());
assert.equal(release.scope, 'modules');
const receipt = json('module-build/release-github.json');
assert.equal(release.sourceCommit, receipt.sourceCommit);
const main = git('rev-parse', 'origin/main').toString().trim();
for(const commit of [release.sourceCommit, toolRef, receipt.remoteMain]) git('merge-base', '--is-ancestor', commit, main);
const projection = await readHostProjection(process.cwd(), release.moduleProjection.config, {strictOrigins: true});
const before = json(path.join(review, 'production-baseline.json'));
const host = json(path.join(review, 'host-game-sources.json')).source;
assert.equal(before.sourceCommit, release.baseCommit);
assert.equal(before.container.health, 'healthy');
const browser = json(path.join(review, 'browser-prepared.json'));
assert.equal(browser.sourceCommit, release.sourceCommit);
assert.deepEqual(browser.games.slice().sort(), release.packages.map(row => row.gameId).sort());
assert.deepEqual(browser.languages, ['ru', 'en']);
assert.equal(browser.connectedChat, true);

const slugPrefix = release.modules.map(slug => 'games/' + slug + '/');
const editable = name => slugPrefix.some(prefix => name.startsWith(prefix));
const source = {};
for(const [name, digest] of Object.entries(release.moduleProjection.inputs)) {
 if(!editable(name) || !before.source[name] || digest === host[name]) continue;
 const bytes = projection.read(name);
 const delta = name.endsWith('velvetReignText.ts')
   ? /^  'Виртуальные USDT · Вход без ставки': 'Virtual USDT · Entry without a stake',\n/m
   : /<(small|p) class="(?:ce|cc)-dialog-note">(?:Виртуальные USDT|Тестовый кошелёк клуба) · [Вв]ход без ставки<\/\1>/;
 if(digest !== before.source[name]) {
  const prior = read(path.join(review, 'live-source', name));
  assert.equal(hash(prior), before.source[name], 'Live source changed: ' + name);
  assert.match(prior.toString(), delta, 'Expected one intro label: ' + name);
  assert.equal(prior.toString().replace(delta, ''), bytes.toString(), 'Additional source delta: ' + name);
 }
 source[name] = put('source/' + name, bytes);
}
for (const [name, digest] of Object.entries(before.source)) {
 if(editable(name) && digest !== host[name]) assert(source[name], 'Missing existing module source evidence: ' + name);
}
const packages = {}, proof = {sourceCommit: release.sourceCommit, games: {}};
const media = files => Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('media/')));
const browserReportSha256 = put('browser-validation.json', read(path.join(review, 'browser-prepared.json')));
for (const row of release.packages) {
 const game = row.gameId;
 const pointer = json(row.pointer);
 const manifestPath = pointer.manifest.replace('/game-modules/', 'module-dist/');
 const entry = json(manifestPath);
 const priorBytes = read(path.join(review, 'prior', game, 'manifest.json'));
 const prior = JSON.parse(priorBytes);
 const oldFolder = '/opt/royal-game-modules/' + game;
 const beforePointerSha256 = before.moduleFiles[oldFolder + '/active.json'];
 assert.equal(hash(priorBytes), before.moduleFiles[oldFolder + '/versions/' + prior.version + '/manifest.json']);
 assert.deepEqual(media(prior.files), media(entry.files), 'Unexpected media change: ' + game);
 const styles = (manifest, root) => manifest.styles.map(name => {
  const bytes = read(path.join(root, name));
  assert.equal(hash(bytes), manifest.files[name], 'Unexpected style digest: ' + game);
  return bytes.toString().replaceAll('/game-modules/' + game + '/versions/' + manifest.version + '/', '/game-modules/' + game + '/versions/current/');
 });
 assert.deepEqual(styles(prior, path.join(review, 'prior', game)), styles(entry, path.dirname(manifestPath)), 'Unexpected style change: ' + game);
 const files = {'manifest.json': hash(read(manifestPath)), ...entry.files};
 assert.equal(browser.versions[game], row.version);
 for(const [name, digest] of Object.entries(files)) {
  const from = path.join(path.dirname(manifestPath), name), to = path.join(output, 'packages', game, name);
  assert.equal(digest, release.files[from]);
  assert.equal(hash(read(from)), digest);
  fs.mkdirSync(path.dirname(to), {recursive:true});
  fs.linkSync(from, to);
 }
 packages[game] = {version: row.version, pointerSha256: release.files[row.pointer], beforePointerSha256, files};
 proof.games[game] = {passed:true, kind:'intro-note-removal', beforeManifest:hash(priorBytes), afterManifest:files['manifest.json'],
   beforeEntry:prior.files[prior.entry], afterEntry:entry.files[entry.entry], browserReportSha256};
}
const helpers = json(path.join(review, 'production-helper-hashes.json'));
const publisherSha256 = before.source['scripts/game-module-release.py'];
const wrapperSha256 = put('publish.py', git('show', toolRef + ':' + folder + '/publish.py'));
const guardSha256 = put('scope_guard.py', git('show', toolRef + ':deployment/releases/autoplay-spin-count-20261120-v1/publish.py'));
const packagesHelperSha256 = put('scope_packages.py', git('show', toolRef + ':deployment/releases/desktop-stake-lists-20261123-v1/publish.py'));
const releaseManifest = read('module-build/release-manifest.json');
put('install-manifest.json', releaseManifest);
const operator = {sourceCommit:release.sourceCommit, installerCommit:toolRef, source, packages, helpers, publisherSha256,
 wrapperSha256, guardSha256, packagesHelperSha256,
 beforeSha256:put('before.json', read(path.join(review, 'production-baseline.json'))),
 releaseManifestSha256:put('release-manifest.json', releaseManifest),
 receiptSha256:put('release-github.json', read('module-build/release-github.json')),
 programProofSha256:put('program-proof.json', encoded(proof))};
put('operator.json', encoded(operator));
console.log(JSON.stringify({release:folder, packages:Object.keys(packages), source:Object.keys(source), sourceCommit:release.sourceCommit}));
