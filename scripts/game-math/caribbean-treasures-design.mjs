import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { q, add, sub, mul, div, sum, number, view } from './rational.mjs';
import {
  CARIBBEAN_COLS, CARIBBEAN_ROWS, CARIBBEAN_SYMBOLS, CARIBBEAN_LINES, CARIBBEAN_LINE_COUNTS,
  CARIBBEAN_MODEL_VERSION, CARIBBEAN_TARGET_RTP, CARIBBEAN_PROFILE, caribbeanExpansionOptions,
} from '../../src/shared/caribbeanTreasuresMath.ts';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const sameCellGroup = (line, column, block) => block && column >= block.x && column < block.x + block.size
  && line[column] >= block.y && line[column] < block.y + block.size ? 'block' : 'column-' + column;

/** Exact expectation for one actual line; every repeated block cell shares ONE symbol draw. */
export function caribbeanDraftLineMean(line, block, blockWeights = CARIBBEAN_SYMBOLS.map(symbol => q(symbol.weight, 100))) {
  let mean = q(0);
  for (const candidate of CARIBBEAN_SYMBOLS) for (let count = 3; count <= CARIBBEAN_COLS; count++) {
    const groups = new Set(line.slice(0, count).map((_, column) => sameCellGroup(line, column, block)));
    let probability = q(1);
    for (const group of groups) probability = mul(probability, group === 'block' ? blockWeights[candidate.id] : q(candidate.weight, 100));
    if (count < CARIBBEAN_COLS) {
      const nextGroup = sameCellGroup(line, count, block);
      probability = groups.has(nextGroup) ? q(0) : mul(probability, sub(q(1), nextGroup === 'block' ? blockWeights[candidate.id] : q(candidate.weight, 100)));
    }
    mean = add(mean, mul(probability, q(candidate.pays[count - 3])));
  }
  return mean;
}
export function caribbeanDraftCases(mode, lines = 20) {
  if (!['base','raid','flagship'].includes(mode)) throw new Error('Invalid draft mode');
  const cases = [];
  const profile = CARIBBEAN_PROFILE[lines];
  const largeProbability = q(profile.baseLargePerMillion, 1000000);
  if (mode === 'base') cases.push({ block: null, probability: sub(q(70, 100), largeProbability) });
  if (mode !== 'raid') {
    const probability = mode === 'flagship' ? q(1) : largeProbability;
    for (let y = 0; y <= CARIBBEAN_ROWS - 3; y++) for (let x = 0; x <= CARIBBEAN_COLS - 3; x++)
      cases.push({ block: { x, y, size: 3, symbol: 0 }, probability: mul(probability, q(1, 8)) });
  }
  if (mode !== 'flagship') {
    const initial = mode === 'base' ? q(30, 100) : q(1);
    const cannon = mode === 'base' ? q(1, 8) : q(profile.raidCannonPerMillion, 1000000);
    for (let y = 0; y <= CARIBBEAN_ROWS - 2; y++) for (let x = 0; x <= CARIBBEAN_COLS - 2; x++) {
      const block = { x, y, size: 2, symbol: 0 }, probability = mul(initial, q(1, 15));
      cases.push({ block, probability: mul(probability, sub(q(1), cannon)) });
      const options = caribbeanExpansionOptions(block);
      for (const next of options) cases.push({ block: next, probability: mul(mul(probability, cannon), q(1, options.length)) });
    }
  }
  return cases;
}
export function analyzeCaribbeanDraft() {
  const modes = Object.fromEntries(['base','raid','flagship'].map(mode => {
    return [mode, CARIBBEAN_LINE_COUNTS.map(lines => {
      const cases = caribbeanDraftCases(mode, lines);
      if (number(sum(cases.map(row => row.probability))) !== 1) throw new Error('Invalid draft probability mass');
      const mean = sum(cases.map(row => mul(row.probability,
        sum(CARIBBEAN_LINES.slice(0, lines).map(line => caribbeanDraftLineMean(line, row.block))))));
      return { lines, meanPayoutInTotalStakes: view(div(mean, q(lines))) };
    })];
  }));
  return {
    schemaVersion: 1, modelVersion: CARIBBEAN_MODEL_VERSION, status: 'development-only',
    registeredWageredGame: false, qualified: false, targetRtp: CARIBBEAN_TARGET_RTP,
    method: 'Exact rational single-spin first moments for independent ordinary cells and one correlated giant-symbol block. All legal positions and cannon expansions are enumerated.',
    dimensions: { columns: CARIBBEAN_COLS, rows: CARIBBEAN_ROWS }, modes,
    conclusions: [
      'The figures describe individual draft spin modes, not the RTP of a complete paid round.',
      'A multi-cell block uses one symbol draw. Treating its cells as independent gives a wrong expectation.',
      'Different line selections can have different expected payouts per total stake and require separate calibration.',
      'Bonus entry, tactical choice, purchased cost and complete-round settlement are outside this single-spin diagnostic. See the separate complete-round qualification.',
    ],
  };
}
export async function writeCaribbeanDraftReport() {
  const report = analyzeCaribbeanDraft();
  report.sourceHashes = Object.fromEntries(await Promise.all([
    'src/shared/caribbeanTreasuresMath.ts', 'scripts/game-math/caribbean-treasures-design.mjs', 'scripts/game-math/rational.mjs',
  ].map(async file => [file, createHash('sha256').update((await readFile(resolve(workspace, file), 'utf8')).replace(/\r\n/g,'\n')).digest('hex')])));
  const target = resolve(workspace, 'docs/concepts/caribbean-treasures/math-feasibility.json');
  await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = process.argv.includes('--write-report') ? await writeCaribbeanDraftReport() : analyzeCaribbeanDraft();
  console.log(JSON.stringify(report, null, 2));
}
