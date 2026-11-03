import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digest } from '../../../scripts/module-build-cache.mjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
const [beforeFile, productionFile] = process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(beforeFile)), production = JSON.parse(fs.readFileSync(productionFile));
const animationCommit = 'e5ac32618bb0d645bef98e05b658bb5bc9a4ced3';
const sources = ['src/game/CatRenderer.ts', 'src/game/CatIdleMotion.ts'];
const canonical = bytes => Buffer.from(bytes.toString().replace(/\r\n/g, '\n'));
const blob = (commit, file) => canonical(execFileSync('git', ['show', commit + ':' + file]));
assert.equal(before.sourceCommit, production.sourceCommit);
assert.deepEqual(before.program, before.preparedProgram);
assert.equal(before.container.image, before.preparedImage);
assert.equal(digest(blob(animationCommit + '^', sources[0])), before.sourceLF[sources[0]], 'Production cat changed since implementation');
const scope = { productionCommit: before.sourceCommit, animationCommit, expectedSources: {}, addedGames: [], restoredGames: [] };
// Production deliberately retains the earlier backend dictionary in its compiled
// program. Bind that exception to the exact verified running backend artifact.
assert.equal(production.backendProjection.output.sha256, before.program['dist-server/index.js']);
const preservedDictionary = '8853e5a8bd533ca85608eb11975f1f0d98a03fd0d1b749f48cca00e9db86cd68';
for (const file of sources) scope.expectedSources[file] = digest(blob(animationCommit, file));
for (const [kind, entries] of [['host', ['index.html']], ['backend', ['server/index.ts']]]) {
  const graph = production[kind + 'Projection'];
  const files = structuredClone(graph.origins);
  for (const [file, hash] of Object.entries(graph.inputs)) {
    assert.equal(files[file].sha256, hash);
    if (kind === 'backend' && file === 'src/i18n/en.ts') assert.equal(hash, preservedDictionary);
    else assert.equal(hash, before.sourceLF[file], 'Retained production input changed: ' + file);
  }
  if (kind === 'host') for (const file of sources) {
    const hash = scope.expectedSources[file];
    files[file] = { commit: animationCommit, path: file, baseSha256: hash, sha256: hash };
  }
  fs.writeFileSync(path.join(folder, kind + '-projection.json'), JSON.stringify({ format: 1, productionCommit: before.sourceCommit, entries, files }, null, 2) + '\n');
}
fs.writeFileSync(path.join(folder, 'scope.json'), JSON.stringify(scope, null, 2) + '\n');
console.log(JSON.stringify({ productionCommit: before.sourceCommit, changed: scope.expectedSources }));
