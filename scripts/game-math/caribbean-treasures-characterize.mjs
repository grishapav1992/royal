import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playCaribbeanFrame, CARIBBEAN_PROFILE, CARIBBEAN_BONUS_SPINS } from '../../src/shared/caribbeanTreasuresMath.ts';
const root = fileURLToPath(new URL('../../',import.meta.url));
const seeds = [487103,582997]; // Characterization only; distinct from qualification replay seeds.
function rng(seed) {
  let state = seed >>> 0;
  return maximum => {
    const ceiling = Math.floor(4294967296 / maximum) * maximum;
    let value;
    do {
      state = (state + 0x6d2b79f5) >>> 0;
      let word = state;
      word = Math.imul(word ^ word >>> 15,word | 1);
      word ^= word + Math.imul(word ^ word >>> 7,word | 61);
      value = (word ^ word >>> 14) >>> 0;
    } while (value >= ceiling);
    return value % maximum;
  };
}
export function characterizeCaribbean(roundsPerSeed = 10000, progress = () => {}) {
  if (!Number.isInteger(roundsPerSeed) || roundsPerSeed < 1000 || roundsPerSeed > 1000000) throw Error('Invalid characterization sample size');
  const results = [];
  for (const lines of [1,5,10,20]) for (const mode of ['normal','buy']) for (const tactic of ['raid','flagship']) {
    const profile = CARIBBEAN_PROFILE[lines], baseUnits = lines * 100;
    const costUnits = mode === 'normal' ? baseUnits : Math.ceil(baseUnits * profile.bonusCostPerMillion / 1000000);
    let count = 0, mean = 0, m2 = 0, payoutCount = 0, profitCount = 0, breakEvenCount = 0, bonusCount = 0, maximumObserved = 0;
    const streams = [];
    for (const seed of seeds) {
      const streamSeed = seed + lines * 100003 + (mode === 'buy' ? 2000003 : 0) + (tactic === 'flagship' ? 3000017 : 0), draw = rng(streamSeed);
      streams.push(streamSeed);
      for (let index = 0; index < roundsPerSeed; index++) {
        let factor = 0, bonus = mode === 'buy';
        if (!bonus) {
          factor = playCaribbeanFrame('base',lines,draw).factorSum;
          bonus = draw(1000000) < profile.bonusEntryPerMillion;
        }
        if (bonus) {
          bonusCount++;
          for (let free = 0; free < CARIBBEAN_BONUS_SPINS[tactic]; free++) factor += playCaribbeanFrame(tactic,lines,draw).factorSum;
        }
        const rewardUnits = factor * 100, ratio = rewardUnits / costUnits;
        count++; const delta = ratio - mean; mean += delta / count; m2 += delta * (ratio - mean);
        payoutCount += Number(rewardUnits > 0); profitCount += Number(rewardUnits > costUnits);
        breakEvenCount += Number(rewardUnits === costUnits); maximumObserved = Math.max(maximumObserved,ratio);
      }
    }
    const sd = Math.sqrt(m2 / (count - 1)), half = 1.96 * sd / Math.sqrt(count);
    const row = { lines,mode,tactic,lineStakeUnits:100,paidRounds:count,costUnits,streams,
      observedRtp:mean,approximateMeanInterval95:[mean - half,mean + half],
      payoutProbability:payoutCount / count,profitProbability:profitCount / count,breakEvenProbability:breakEvenCount / count,
      observedStandardDeviationInPaidStakes:sd,maximumObservedInPaidStakes:maximumObserved,bonusEntries:bonusCount };
    results.push(row); progress({ completed:results.length,total:16,lines,mode,tactic });
  }
  return { schemaVersion:1,purpose:'Payout distribution characterization, not RTP qualification',seeds,roundsPerSeed,results,
    limitations:['Statistics cover the declared 1-coin line stake. Exact qualification separately covers every permitted stake and mode.',
      'Intervals use a normal approximation to the sampled mean. Rare tails and the complete variance are not certified by this sample.',
      'No users, wallet accounts or real wagers are involved. Greater play time and payout frequency are not evidence of enjoyment.'] };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const position = process.argv.indexOf('--rounds-per-seed');
  const size = position < 0 ? 10000 : Number(process.argv[position + 1]);
  const report = characterizeCaribbean(size,value => console.log(JSON.stringify(value)));
  report.sourceHashes = Object.fromEntries(await Promise.all([
    'src/shared/caribbeanTreasuresMath.ts','scripts/game-math/caribbean-treasures-characterize.mjs',
  ].map(async file => [file,createHash('sha256').update((await readFile(resolve(root,file),'utf8')).replace(/\r\n/g,'\n')).digest('hex')])));
  if (process.argv.includes('--write-report')) await writeFile(resolve(root,'docs/concepts/caribbean-treasures/payout-characterization.json'),JSON.stringify(report,null,2) + '\n');
  console.log(JSON.stringify({ paidRounds:report.results.reduce((count,row) => count + row.paidRounds,0),
    results:report.results.map(row => ({ lines:row.lines,mode:row.mode,tactic:row.tactic,observedRtp:row.observedRtp,payoutProbability:row.payoutProbability,profitProbability:row.profitProbability })) }));
}
