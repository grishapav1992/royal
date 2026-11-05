import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const folder = 'deployment/releases/restore-skin-selection-20261105-v2';
const [snapshot, publishedManifest] = process.argv.slice(2);
const before = JSON.parse(readFileSync(snapshot));
const published = JSON.parse(readFileSync(publishedManifest));
const picker = 'd219ac7db89f1f73f111b96255f9a89edcd54a53';
const art = 'c520de63';
const source = (commit, file) => execFileSync('git', ['show', commit + ':' + file]);
const commitId = ref => execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const matches = (file, hash) => Boolean(hash) && [before.source[file], before.sourceLF[file]].includes(hash);
const roster = 'src/shared/characters.ts';
const changes = [
  { file: 'src/ui/AuthUI.ts', commit: picker, base: picker + '^' },
  { file: 'src/ui/CharacterSelector.ts', commit: picker },
  { file: 'src/ui/character-selector.css', commit: picker },
  { file: 'src/game/characters.ts', commit: art, base: '8afa0d8b^' },
  { file: 'src/game/presetSkinArt.ts', commit: art },
];

assert.equal(before.sourceCommit, published.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
const files = structuredClone(published.hostProjection.origins);
for (const [file, digest] of Object.entries(published.hostProjection.inputs)) {
  assert.equal(files[file]?.sha256, digest);
  assert(matches(file, digest), 'Published host origin differs: ' + file);
}

const rosterOrigin = published.backendProjection?.origins?.[roster];
const rosterDigest = sha(source(picker + '^', roster));
files[roster] ??= rosterOrigin ?? {
  commit: commitId(picker + '^'), path: roster, baseSha256: rosterDigest, sha256: rosterDigest,
};
assert(matches(roster, files[roster]?.sha256), 'Published roster origin differs');
const expectedSources = {};
for (const { file, commit, base } of changes) {
  if (base) {
    assert.equal(files[file]?.sha256, sha(source(base, file)), 'Concurrent change requires review: ' + file);
  } else {
    assert(!before.source[file] && !files[file], 'Unreviewed production source already exists: ' + file);
  }
  const digest = sha(source(commit, file));
  assert.equal(digest, sha(source('HEAD', file)), 'Reviewed feature differs from the checkout: ' + file);
  files[file] = { commit: commitId(commit), path: file, baseSha256: digest, sha256: digest };
  expectedSources[file] = digest;
}
writeFileSync(folder + '/host-projection.json', JSON.stringify({
  format: 1, productionCommit: before.sourceCommit, entries: ['index.html'], files,
}, null, 2) + '\n');
writeFileSync(folder + '/scope.json', JSON.stringify({
  productionCommit: before.sourceCommit, featureCommits: [picker, commitId(art)],
  expectedSources, addedGames: [], restoredGames: [],
}, null, 2) + '\n');
console.log(JSON.stringify({ productionCommit: before.sourceCommit, expectedSources }));
