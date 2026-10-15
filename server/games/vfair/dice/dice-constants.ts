// Source: vfair-games/libs/game-math/src/dice/dice-constants.ts (Apache-2.0).
// Vendored for Royal; attribution header added, upstream math below is unchanged.
// See public/licenses/vfair/LICENSE.txt and provenance in public/licenses/upstream-games.json.
export const MIN_MULTIPLIER = 1.01;
export const WIN_CHANCE_DECIMALS = 2;
export const MIN_WIN_CHANCE_PERCENT = 10 ** -WIN_CHANCE_DECIMALS;
export const MAX_WIN_CHANCE_PERCENT = 100 - MIN_WIN_CHANCE_PERCENT;
export const MULTIPLIER_DECIMALS = WIN_CHANCE_DECIMALS + 2;
export const SLIDER_DECIMALS = WIN_CHANCE_DECIMALS;
export const DEFAULT_SLIDER_VALUE = 50;
