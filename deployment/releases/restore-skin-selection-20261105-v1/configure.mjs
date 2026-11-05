import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const folder = 'deployment/releases/restore-skin-selection-20261105-v1';
const [snapshot, publishedManifest, featureCommit] = process.argv.slice(2);
const before = JSON.parse(readFileSync(snapshot));
const published = JSON.parse(readFileSync(publishedManifest));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = (commit, file) => execFileSync('git', ['show', commit + ':' + file]);
const matches = (file, hash) => [before.source[file], before.sourceLF[file]].includes(hash);
const auth = 'src/ui/AuthUI.ts';
const roster = 'src/shared/characters.ts';
const newFiles = ['src/ui/CharacterSelector.ts', 'src/ui/character-selector.css'];

assert.match(featureCommit, /^[a-f0-9]{40}$/);
assert.equal(before.sourceCommit, published.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
const files = structuredClone(published.hostProjection.origins);
for (const [file, digest] of Object.entries(published.hostProjection.inputs)) {
  assert.equal(files[file]?.sha256, digest);
  assert(matches(file, digest), 'Published host origin differs: ' + file);
}
assert.equal(files[auth].sha256, sha(source(featureCommit + '^', auth)), 'Apply the feature to the changed production AuthUI before building');
files[roster] ??= published.backendProjection.origins[roster];
assert(matches(roster, files[roster]?.sha256), 'Published roster origin differs');
const expectedSources = {};
for (const file of [auth, ...newFiles]) {
  if (file !== auth) assert(!before.source[file] && !files[file], 'Unreviewed production source already exists: ' + file);
  const digest = sha(source(featureCommit, file));
  files[file] = { commit: featureCommit, path: file, baseSha256: digest, sha256: digest };
  expectedSources[file] = digest;
}
writeFileSync(folder + '/host-projection.json', JSON.stringify({
  format: 1, productionCommit: before.sourceCommit, entries: ['index.html'], files,
}, null, 2) + '\n');
writeFileSync(folder + '/scope.json', JSON.stringify({
  productionCommit: before.sourceCommit, featureCommit, expectedSources, addedGames: [], restoredGames: [],
}, null, 2) + '\n');
console.log(JSON.stringify({ productionCommit: before.sourceCommit, expectedSources }));
