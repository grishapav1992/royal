import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const [beforeFile, serverProofFile, destination] = process.argv.slice(2).map(path => resolve(path));
assert.ok(beforeFile && serverProofFile && destination, 'Supply before.json, server hashes, and a new staging directory');

const game = 'studio-cosmic-escape';
const racer = 'cosmic-guardians/racer-v1/';
const sourceNames = [
  'games/cosmic-escape/package.json', 'games/cosmic-escape/tsconfig.json',
  'src/ui/CosmicEscapeUI.ts', 'src/ui/CosmicEscapeAssets.ts',
  'src/ui/CosmicEscapeRacer.ts', 'src/ui/cosmic-guardians.css',
  ...['idle', 'focus', 'calm', 'win', 'big-win', 'bonus'].flatMap(cue =>
    [cue + '.webp', cue + '-still.webp'].map(name => 'public/assets/' + racer + name)),
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync(process.env.ROYAL_GIT_BINARY || 'git', args, {cwd: root});
const load = path => readFile(path).then(JSON.parse);
const put = async (name, bytes) => {
  const file = resolve(destination, name);
  await mkdir(dirname(file), {recursive: true});
  await writeFile(file, bytes, {flag: 'wx', mode: 0o600});
};
const output = name => readFile(resolve(root, 'module-build', name));
const releaseBytes = await output('release-manifest.json');
const receiptBytes = await output('release-github.json');
const proofBytes = await output('cosmic-escape-proof.json');
const release = JSON.parse(releaseBytes);
const receipt = JSON.parse(receiptBytes);
const proof = JSON.parse(proofBytes);
const beforeBytes = await readFile(beforeFile);
const before = JSON.parse(beforeBytes);
const server = await load(serverProofFile);
const sourceCommit = git(['rev-parse', 'HEAD']).toString().trim();
assert.equal(sourceCommit, release.sourceCommit);
assert.equal(sourceCommit, receipt.sourceCommit);
assert.equal(receipt.manifestSha256, hash(releaseBytes));
assert.equal(before.sourceCommit, release.baseCommit);
assert.equal(before.moduleFiles['/opt/royal-game-modules/' + game + '/active.json'], server.pointerSha256);
assert.deepEqual(release.modules, ['cosmic-escape']);
assert.equal(release.githubVerified, true);
assert.equal(release.build.passed, true);
assert.equal(release.packages.length, 1);
const [{version, pointer}] = release.packages;
assert.equal(proof.version, version);
const files = resolve(root, 'module-dist', game, 'versions', version);
const source = {};
const wrapper = await readFile(resolve(here, 'publish.py'));
const wrapperPath = 'deployment/releases/cosmic-racer-20261119-v1/publish.py';
assert.deepEqual(wrapper, git(['show', sourceCommit + ':' + wrapperPath]));
const installerCommit = git(['log', '-1', '--format=%H', '--', wrapperPath]).toString().trim();
git(['merge-base', '--is-ancestor', installerCommit, receipt.remoteMain]);
assert.equal(server.publisherSha256, hash(await readFile(resolve(root, 'scripts/game-module-release.py'))));

await mkdir(destination, {mode: 0o700});
for (const name of sourceNames) {
  const bytes = git(['show', sourceCommit + ':' + name]);
  source[name] = hash(bytes);
  if (name.startsWith('public/assets/')) {
    const relative = name.slice('public/assets/'.length);
    assert.equal(hash(await readFile(resolve(files, 'media', relative))), source[name]);
  }
  await put('source/' + name, bytes);
}
await cp(files, resolve(destination, 'package'), {recursive: true, errorOnExist: true, force: false});
await put('publish.py', wrapper);
await put('before.json', beforeBytes);
await put('release-manifest.json', releaseBytes);
await put('release-github.json', receiptBytes);
await put('module-proof.json', proofBytes);
await put('operator.json', JSON.stringify({
  version, sourceCommit, installerCommit, source,
  wrapperSha256: hash(wrapper), beforeSha256: hash(beforeBytes),
  releaseManifestSha256: hash(releaseBytes), receiptSha256: hash(receiptBytes),
  moduleProofSha256: hash(proofBytes), pointerSha256: release.files[pointer],
  publisherSha256: server.publisherSha256, helpers: server.helpers,
  priorManifestSha256: server.priorManifestSha256,
}, null, 2) + '\n');
console.log(JSON.stringify({version, sourceCommit, installerCommit, staged: true}));
