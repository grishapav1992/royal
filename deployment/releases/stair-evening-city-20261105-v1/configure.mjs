import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const folder = 'deployment/releases/stair-evening-city-20261105-v1';
const [snapshot, publishedManifest] = process.argv.slice(2);
const before = JSON.parse(readFileSync(snapshot));
const published = JSON.parse(readFileSync(publishedManifest));
const feature = 'fb10f886b2343603f63e3056a1f4493d9eb39dae';
const featureBase = '7ebaad3377caf00041689f0c926e060132171ca4';
const sources = [
  'src/game/StreetAmbience.ts', 'src/game/StreetRenderer.ts',
  'src/game/streetArt.ts', 'src/game/streetCityArt.ts',
];
const source = (commit, file) => execFileSync('git', ['show', commit + ':' + file]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

assert.equal(before.sourceCommit, published.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
const files = structuredClone(published.hostProjection.origins);
for (const [file, digest] of Object.entries(published.hostProjection.inputs)) {
  assert.equal(files[file]?.sha256, digest);
  assert([before.source[file], before.sourceLF[file]].includes(digest), 'Published host origin differs: ' + file);
}

const expectedSources = {};
for (const file of sources) {
  if (file === 'src/game/streetCityArt.ts') {
    assert(!before.source[file] && !files[file], 'An unreviewed city source is already deployed');
  } else {
    assert.equal(files[file]?.sha256, sha(source(featureBase, file)), 'Concurrent street change requires review: ' + file);
  }
  const digest = sha(source(feature, file));
  assert.equal(digest, sha(source('HEAD', file)), 'Reviewed feature differs from the checkout: ' + file);
  files[file] = { commit: feature, path: file, baseSha256: digest, sha256: digest };
  expectedSources[file] = digest;
}
writeFileSync(folder + '/host-projection.json', JSON.stringify({
  format: 1, productionCommit: before.sourceCommit, entries: ['index.html'], files,
}, null, 2) + '\n');
writeFileSync(folder + '/scope.json', JSON.stringify({
  productionCommit: before.sourceCommit, feature, expectedSources, addedGames: [], restoredGames: [],
}, null, 2) + '\n');
console.log(JSON.stringify({ productionCommit: before.sourceCommit, expectedSources }));
