import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digest } from '../../../scripts/module-build-cache.mjs';
import { readHostProjection } from '../../../scripts/build-host-projection.mjs';
import { verifyRelease, assertClean } from '../../../scripts/release.mjs';

const root = process.cwd(), folder = path.dirname(fileURLToPath(import.meta.url)), name = 'cat-idle-20261103-v1';
const before = JSON.parse(fs.readFileSync(process.argv[2])), out = path.resolve(process.argv[3]);
await assertClean(root);
const release = await verifyRelease(root), receipt = JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit, receipt.sourceCommit);
assert.equal(receipt.manifestSha256, digest(fs.readFileSync('module-build/release-manifest.json')));
assert.equal(release.baseCommit, before.sourceCommit);
assert.deepEqual(before.program, before.preparedProgram); assert.equal(before.container.image, before.preparedImage);
const scope = JSON.parse(fs.readFileSync(path.join(folder, 'scope.json')));
const host = await readHostProjection(root, path.relative(root, path.join(folder, 'host-projection.json')).replaceAll('\\', '/'), { strictOrigins: true });
for (const [file, hash] of Object.entries(release.hostProjection.inputs)) {
  assert(scope.expectedSources[file] === hash || [before.source[file], before.sourceLF[file]].includes(hash), 'Unrelated input: ' + file);
}
assert(!fs.existsSync(out), 'Payload already exists'); fs.mkdirSync(out, { recursive: true });
function write(file, bytes) {
  assert(!path.isAbsolute(file) && !file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')));
  const target = path.join(out, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' }); return digest(bytes);
}
const changed = {}, delta = {};
for (const [file, hash] of Object.entries(scope.expectedSources)) {
  const bytes = host.read(file); assert.equal(digest(bytes), hash);
  assert.equal(release.hostProjection.inputs[file], hash); changed[file] = write('source/' + file, bytes);
}
for (const [file, hash] of Object.entries(release.files)) {
  if (!file.startsWith('dist/') || before.program[file] === hash) continue;
  const relative = file.slice(5);
  assert(relative === 'index.html' || /^assets\/[\w-]+\.(js|css)$/.test(relative), 'Foreign host artifact');
  assert(relative === 'index.html' || !before.program[file], 'Immutable URL collision');
  const bytes = fs.readFileSync(file); assert.equal(digest(bytes), hash); delta[relative] = write('dist-delta/' + relative, bytes);
}
assert(delta['index.html']); fs.mkdirSync(path.join(out, 'server-delta'));
const references = {
  'application-overlay.py': 'deployment/releases/hall-elevator-20261101-v1/deploy.py',
  'overlay-base.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'snapshot-base.py': 'deployment/releases/universal-spins-20261031-v1/snapshot.py',
  'image_metadata.py': 'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
  'runtime-inventory.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
  'quiesce.cjs': 'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'financial_gate.py': 'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'engine-build.py': 'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
};
const committed = file => execFileSync('git', ['show', release.sourceCommit + ':' + file], { maxBuffer: 32 * 1024 ** 2 });
const support = {};
for (const [file, source] of Object.entries(references)) support[file] = write(file, committed(source));
for (const file of ['release-manifest.json', 'release-github.json']) write(file, fs.readFileSync('module-build/' + file));
const helperSha256 = write('deploy.py', committed(path.relative(root, path.join(folder, 'deploy.py')).replaceAll('\\', '/')));
const snapshotSha256 = write('snapshot.py', committed('deployment/releases/hall-elevator-20261101-v1/snapshot.py'));
const manifest = { release: name, sourceCommit: release.sourceCommit, baseCommit: before.sourceCommit, before, changed, delta, serverDelta: {}, support,
  helperSha256, snapshotSha256, releaseManifestSha256: digest(fs.readFileSync('module-build/release-manifest.json')),
  receiptSha256: digest(fs.readFileSync('module-build/release-github.json')) };
write('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({ sourceCommit: release.sourceCommit, sources: Object.keys(changed), clientFiles: Object.keys(delta).length, out }));
