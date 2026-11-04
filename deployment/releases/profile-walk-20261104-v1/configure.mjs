import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const folder = 'deployment/releases/profile-walk-20261104-v1';
const [beforeFile, productionFile] = process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(beforeFile)), production = JSON.parse(fs.readFileSync(productionFile));
const animationCommit = '384a045e';
const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 ** 2 });
const commit = git('rev-parse', animationCommit).toString().trim();
const sources = ['src/game/characters.ts', 'src/game/avatarArt.ts', 'src/game/profileWalk.ts'];
const canonical = bytes => Buffer.from(bytes.toString().replace(/\r\n/g, '\n'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = (revision, name) => canonical(git('show', revision + ':' + name));

assert.equal(before.sourceCommit, production.sourceCommit);
assert.deepEqual(before.program, before.preparedProgram);
assert.equal(before.container.image, before.preparedImage);
const files = structuredClone(production.hostProjection.origins);
for (const [name, hash] of Object.entries(production.hostProjection.inputs)) {
  assert.equal(files[name].sha256, hash);
  assert([before.source[name], before.sourceLF[name]].includes(hash), 'Retained host input changed: ' + name);
}
for (const name of sources.slice(0, 2)) {
  assert.equal(sha(blob(commit + '^', name)), before.sourceLF[name], 'Animation was implemented against another production drawing: ' + name);
}
assert(!before.source[sources[2]], 'Profile helper already exists in production');
const scope = { productionCommit: before.sourceCommit, animationCommit: commit, expectedSources: {}, addedGames: [], restoredGames: [] };
for (const name of sources) {
  const hash = sha(blob(commit, name));
  scope.expectedSources[name] = hash;
  files[name] = { commit, path: name, baseSha256: hash, sha256: hash };
}
fs.writeFileSync(folder + '/host-projection.json', JSON.stringify({ format: 1, productionCommit: before.sourceCommit, entries: ['index.html'], files }, null, 2) + '\n');
fs.writeFileSync(folder + '/scope.json', JSON.stringify(scope, null, 2) + '\n');
console.log(JSON.stringify({ base: before.sourceCommit, inputs: Object.keys(files).length, changes: scope.expectedSources }));
