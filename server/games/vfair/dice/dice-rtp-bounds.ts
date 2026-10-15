// Source: vfair-games/libs/game-math/src/dice/dice-rtp-bounds.ts (Apache-2.0).
// Vendored for Royal; attribution header added, upstream math below is unchanged.
// See public/licenses/vfair/LICENSE.txt and provenance in public/licenses/upstream-games.json.
import { roundToDecimals } from '../decimal';
import {
  MAX_WIN_CHANCE_PERCENT,
  MIN_MULTIPLIER,
  MIN_WIN_CHANCE_PERCENT,
  MULTIPLIER_DECIMALS,
} from './dice-constants';

export type DiceMultiplierBounds = {
  minMultiplier: number;
  maxMultiplier: number;
};

export const getDiceMultiplierBounds = (rtp: number): DiceMultiplierBounds => ({
  maxMultiplier: roundToDecimals(
    (rtp * 100) / MIN_WIN_CHANCE_PERCENT,
    MULTIPLIER_DECIMALS,
  ),
  minMultiplier: roundToDecimals(
    Math.max(MIN_MULTIPLIER, (rtp * 100) / MAX_WIN_CHANCE_PERCENT),
    MULTIPLIER_DECIMALS,
  ),
});
