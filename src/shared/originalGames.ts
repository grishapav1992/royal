// Royal adapters around vendored vfair-games math (Apache-2.0).
import { createDiceOdds } from '../../server/games/vfair/dice/dice-math';
import { createLimboOdds } from '../../server/games/vfair/limbo/limbo-math';
import { LIMBO_OUTCOME_COUNT, rollLimboFromInteger } from '../../server/games/vfair/limbo/limbo-roll';
import { createMinesOdds } from '../../server/games/vfair/mines/mines-math';
import { createPlinkoOdds, calculatePlinkoExpectedReturn } from '../../server/games/vfair/plinko/plinko-math';
import { createKenoOdds } from '../../server/games/vfair/keno/keno-math';
import { calculateKenoExpectedReturn } from '../../server/games/vfair/keno/keno-probability';
export { PLINKO_RISKS, type PlinkoRisk } from '../../server/games/vfair/plinko/plinko-constants';
export { KENO_RISKS, type KenoRisk } from '../../server/games/vfair/keno/keno-constants';
import type { PlinkoRisk } from '../../server/games/vfair/plinko/plinko-constants';
import type { KenoRisk } from '../../server/games/vfair/keno/keno-constants';

export const ORIGINAL_RTP = 0.98;
export const diceOdds = createDiceOdds(ORIGINAL_RTP);
export const limboOdds = createLimboOdds(ORIGINAL_RTP);
export const minesOdds = createMinesOdds(ORIGINAL_RTP);
export const plinkoOdds = createPlinkoOdds();
export const kenoOdds = createKenoOdds();
export const getPlinkoMultipliers = (rows: number, risk: PlinkoRisk): number[] => plinkoOdds.getMultipliers(rows, risk);
export const getKenoMultipliers = (count: number, risk: KenoRisk): number[] => kenoOdds.getPaytable(count, risk);
export const getPlinkoRtp = (rows: number, risk: PlinkoRisk): number => calculatePlinkoExpectedReturn(getPlinkoMultipliers(rows, risk), rows);
export const getKenoRtp = (count: number, risk: KenoRisk): number => calculateKenoExpectedReturn(count, getKenoMultipliers(count, risk));
export type DiceInput = { readonly gameMode: 'rollUnder' | 'rollOver'; readonly sliderValue: number };
export type PlinkoInput = { readonly rows: number; readonly risk: PlinkoRisk };
export type LimboInput = { readonly targetMultiplier: number };
export type KenoInput = { readonly picks: readonly number[]; readonly risk: KenoRisk };
export function getDiceRtp(input: DiceInput): number {
  const odds = diceOdds.calculate(input);
  return odds.winChance / 100 * odds.multiplier;
}
/** Expected return after the same unit flooring used to settle the selected stake. */
export function getDiceRtpForStake(input: DiceInput, stakeUnits: bigint): number {
  const odds = diceOdds.calculate(input);
  const payoutUnits = exactPayoutUnits(stakeUnits, odds.multiplier);
  return odds.winChance / 100 * Number(payoutUnits) / Number(stakeUnits);
}
/** Count the uniform 32-bit inputs that win under the actual upstream roll rounding. */
export function getLimboWinProbability(targetMultiplier: number): number {
  if (!Number.isFinite(targetMultiplier) || !/^\d+(?:\.\d{1,2})?$/.test(String(targetMultiplier))) {
    throw new RangeError('Invalid Limbo target');
  }
  const target = limboOdds.calculate({ targetMultiplier }).targetMultiplier;
  // Positive arithmetic and both floor operations preserve monotonicity in the integer.
  // Find the first losing integer; all preceding outcomes win, including 0 and 1.
  let lower = 0, upper = LIMBO_OUTCOME_COUNT;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (rollLimboFromInteger(middle, ORIGINAL_RTP) >= target) lower = middle + 1;
    else upper = middle;
  }
  return lower / LIMBO_OUTCOME_COUNT;
}
export function getLimboRtp(targetMultiplier: number): number {
  return getLimboWinProbability(targetMultiplier) * targetMultiplier;
}
export function getMinesRtp(mineCount: number, reveals: number): number {
  if (!Number.isSafeInteger(reveals) || reveals < 1) throw new RangeError('At least one reveal is required');
  const multiplier = minesOdds.getMultiplier(mineCount, reveals);
  let survival = 1;
  for (let i = 0; i < reveals; i++) survival *= (25 - mineCount - i) / (25 - i);
  return survival * multiplier;
}
export type OriginalGameId = 'royal-dice' | 'royal-mines' | 'royal-plinko' | 'royal-limbo' | 'royal-keno';
export const ORIGINAL_DEFAULT_INPUTS = {
  'royal-dice': { gameMode: 'rollUnder', sliderValue: 50 } as DiceInput,
  'royal-plinko': { rows: 12, risk: 'medium' } as PlinkoInput,
  'royal-limbo': { targetMultiplier: 2 } as LimboInput,
  'royal-keno': { picks: [1, 2, 3], risk: 'classic' } as KenoInput,
};

/** Parse a bounded decimal multiplier exactly; never multiply money with binary floats. */
export function multiplierRatio(multiplier: number): { numerator: bigint; denominator: bigint } {
  const text = String(multiplier);
  if (!Number.isFinite(multiplier) || multiplier < 0 || !/^\d+(?:\.\d{1,4})?$/.test(text)) throw new RangeError('Invalid payout multiplier');
  const [whole, fraction = ''] = text.split('.');
  return { numerator: BigInt(whole + fraction), denominator: 10n ** BigInt(fraction.length) };
}
export function exactPayoutUnits(stakeUnits: bigint, multiplier: number): bigint {
  const ratio = multiplierRatio(multiplier);
  if (stakeUnits <= 0n) throw new RangeError('Invalid stake');
  return stakeUnits * ratio.numerator / ratio.denominator;
}
