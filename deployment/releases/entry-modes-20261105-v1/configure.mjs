import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectHostSource } from '../../../scripts/build-host-projection.mjs';

const parent = '6742d9d49bfac0080e01883a9f88ad7421bd26a0';
const feature = 'b560f5a632c15128dc56730b30e901f559b4f303';
const task = process.argv[2];
const folder = 'deployment/releases/entry-modes-20261105-v1';
const published = JSON.parse(readFileSync(join(task, 'published-release.json')));
const scratch = join(task, 'merge');
mkdirSync(scratch, { recursive: true });

const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 ** 2 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = (commit, file) => git('show', commit + ':' + file);
const files = structuredClone(published.hostProjection.origins);
const sources = git('diff', '--name-only', parent, feature, '--', 'index.html', 'src').toString().trim().split('\n');
const scope = { productionCommit: published.sourceCommit, featureCommit: feature, expectedSources: {}, addedGames: [], restoredGames: [] };
const matches = (state, file, hash) => [state.source[file], state.sourceLF[file]].includes(hash);

// Resolve only the reviewed overlaps with the installed release. The digest covers
// both sides and their common ancestor. A later overlap requires a fresh review.
const resolutions = {
  '6c19a564fe77796a147fc3e2ddb6ffcac626734af0110d53ff639e43650fe4cd': (_, entry) => entry.replace('GAME_CABINETS, ', ''),
  '3148ddf31b37498ba86b548338702cc8ac29a14655ffdedf198118d5805f3674': (_, entry) => entry.slice(0, entry.indexOf('    if (!offline)')),
  '2b3419065cd375cfe36e5293a9575263644583f3163e09c81e1e7ec48b768346': (_, entry) => entry,
  '84f380325958f88b67a997d0b9e8e484e64341cca4405f1bb2b435dfff9ca949': (live, entry) => live + entry.replace("import { CharacterSelector } from './CharacterSelector';\n", ''),
  '005ea161e3c5f9c0a04c5cc5146519cb48a043c7f709c44b4425672304392d2b': (live, entry) => live.slice(0, live.indexOf('\n') + 1) + entry.slice(entry.indexOf('\n') + 1),
  'c47f99959df2cd76a06466e30ae28da7580fdb1a64f3b10a38867a7a6e365e5d': (_, entry) => entry,
};

function merge(file, live, base, update) {
  const paths = ['live', 'base', 'entry'].map(label => join(scratch, label));
  [live, base, update].forEach((bytes, i) => writeFileSync(paths[i], bytes));
  const result = spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'production', '-L', 'feature base', '-L', 'entry modes', ...paths], { maxBuffer: 32 * 1024 ** 2 });
  if (result.status === 0) return result.stdout;
  const output = join(scratch, file.replaceAll('/', '_'));
  const merged = result.stdout.toString().replace(
    /^<<<<<<< production\n([\s\S]*?)^\|{7} feature base\n[\s\S]*?^=======\n([\s\S]*?)^>>>>>>> entry modes\n/gm,
    (block, current, entry) => resolutions[sha(block)]?.(current, entry) ?? block,
  );
  writeFileSync(output, merged);
  if (!merged || /^<<<<<<< production$/m.test(merged)) throw Error('Review overlapping changes: ' + output);
  return Buffer.from(merged);
}

function patches(previous, updated) {
  const paths = ['previous', 'updated'].map(label => join(scratch, label));
  [previous, updated].forEach((bytes, i) => writeFileSync(paths[i], bytes));
  const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--unified=4', '--', ...paths], { maxBuffer: 32 * 1024 ** 2 });
  assert.equal(diff.status, 1, diff.stderr.toString());
  const result = [];
  let patch;
  for (const line of diff.stdout.toString().split('\n')) {
    if (line.startsWith('@@')) {
      patch = { from: '', to: '' };
      result.push(patch);
    } else if (patch) {
      if (line.startsWith(' ') || line.startsWith('-')) patch.from += line.slice(1) + '\n';
      if (line.startsWith(' ') || line.startsWith('+')) patch.to += line.slice(1) + '\n';
    }
  }
  return result;
}

const status = [];
const conflicts = [];
for (const file of sources) {
  const update = read(feature, file);
  const origin = files[file];
  const previousMode = git('ls-tree', parent, '--', file).length;
  if (origin) {
    const original = read(origin.commit, origin.path);
    const live = projectHostSource(origin, original);
    assert.equal(sha(live), published.hostProjection.inputs[file]);
    assert(previousMode, 'Production and the feature both created ' + file);
    const base = read(parent, file);
    if (!live.equals(base)) {
      let merged;
      try {
        merged = merge(file, live, base, update);
      } catch (error) {
        conflicts.push(error.message);
        continue;
      }
      files[file] = { ...origin, sha256: sha(merged), patches: [...(origin.patches ?? []), ...patches(live, merged)] };
      projectHostSource(files[file], original);
      status.push('Merged with production: ' + file);
    }
  } else {
    assert(!previousMode, 'Missing production origin: ' + file);
  }
  if (files[file] === origin) {
    const digest = sha(update);
    files[file] = { commit: feature, path: file, baseSha256: digest, sha256: digest };
  }
  scope.expectedSources[file] = files[file].sha256;
}
console.log(status.join('\n'));
assert(!conflicts.length, conflicts.join('\n'));
if (process.argv.includes('--inspect')) process.exit(0);

const before = JSON.parse(readFileSync(join(task, 'before.json')));
assert.equal(before.sourceCommit, published.sourceCommit);
assert.equal(before.container.health, 'healthy');
assert.equal(before.container.image, before.preparedImage);
assert.deepEqual(before.program, before.preparedProgram);
for (const [file, hash] of Object.entries(published.hostProjection.inputs)) {
  assert(matches(before, file, hash), 'Published host origin differs: ' + file);
}
for (const file of sources) {
  if (!published.hostProjection.origins[file]) assert(!before.source[file], 'New input exists in production: ' + file);
}
for (const [name, value] of Object.entries({
  'host-projection.json': { format: 1, productionCommit: before.sourceCommit, entries: ['index.html'], files },
  'scope.json': scope,
})) writeFileSync(join(folder, name), JSON.stringify(value, null, 2) + '\n');
console.log(JSON.stringify({ base: before.sourceCommit, projectedInputs: Object.keys(files).length, changedSources: sources.length }));
