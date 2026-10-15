// Adapted from vfair-games/libs/game-math/src/limbo/limbo-provably-fair.ts (Apache-2.0).
// Modified for Royal: accepts the first unsigned 32-bit integer without hash or seed helpers.
// Arithmetic and rounding are unchanged; see public/licenses/vfair/LICENSE.txt and provenance.
import { CRASH_MULTIPLIER_DECIMALS, MAX_CRASH_MULTIPLIER } from './limbo-constants';

export const LIMBO_OUTCOME_COUNT = 2 ** 32;
const MIN_FLOAT = 1 / LIMBO_OUTCOME_COUNT;

/** Browser-safe copy of the upstream hash-to-roll arithmetic. */
export function rollLimboFromInteger(integer: number, rtp: number): number {
  if (!Number.isSafeInteger(integer) || integer < 0 || integer >= LIMBO_OUTCOME_COUNT) {
    throw new RangeError('Invalid Limbo random integer');
  }
  const float = Math.max(integer / LIMBO_OUTCOME_COUNT, MIN_FLOAT);
  const raw = MAX_CRASH_MULTIPLIER / (float * MAX_CRASH_MULTIPLIER);
  const crash = Math.floor(raw * rtp * 100) / 100;
  const factor = 10 ** CRASH_MULTIPLIER_DECIMALS;
  const rounded = Math.floor(crash * factor) / factor;
  return Math.min(MAX_CRASH_MULTIPLIER, Math.max(1, rounded));
}
