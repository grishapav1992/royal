import { readdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectRoot } from './build-application.mjs';
import { regularPath } from './module-build-cache.mjs';

// A CI job has no open game sessions. Local and production histories need their own retention review.
if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Cache pruning is restricted to a disposable GitHub Actions checkout');
const report = JSON.parse(await readFile(resolve(projectRoot, 'module-build/build-report.json'), 'utf8'));
let removed = 0;
for (const game of report.games) {
  const prefix = `module-dist/${game.gameId}/versions`;
  for (const entry of await readdir(await regularPath(projectRoot, prefix), { withFileTypes: true })) {
    if (entry.name === game.version || !/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(entry.name)) continue;
    const target = await regularPath(projectRoot, prefix + '/' + entry.name);
    if (!entry.isDirectory()) throw Error('Unexpected module version');
    await rm(target, { recursive: true }); removed++;
  }
}
console.log(JSON.stringify({ removedInactiveCiPackages: removed }));
