export const COINS_SYMBOL_COUNT = 5;
export const COINS_REEL_COUNT = 3;
export const COINS_MAX_MULTIPLIER = 12;

export const FRUITS_REEL_COUNT = 3;
export const FRUITS_REEL_SIZE = 20;
export const FRUITS_SYMBOL_COUNT = 4;
export const FRUITS_MAX_MULTIPLIER = 140;
export const FRUITS_PAYTABLE = Object.freeze([
  Object.freeze({ symbol: 0, key: 'cherry', label: 'Вишня', weight: 8, multiplier: 5 } as const),
  Object.freeze({ symbol: 1, key: 'lemon', label: 'Лимон', weight: 6, multiplier: 10 } as const),
  Object.freeze({ symbol: 2, key: 'grape', label: 'Виноград', weight: 4, multiplier: 30 } as const),
  Object.freeze({ symbol: 3, key: 'seven', label: 'Семёрка', weight: 2, multiplier: 140 } as const),
]);

export type GameId = 'royal-coins' | 'royal-fruits' | 'royal-roulette' | 'royal-wheel' | OriginalGameId;
export type CoinsInput = Readonly<Record<string, never>>;
export type FruitsInput = Readonly<Record<string, never>>;
export type RouletteBet = 'red' | 'black' | 'even' | 'odd' | 'number';
export type RouletteInput =
  | { readonly bet: Exclude<RouletteBet, 'number'>; readonly number?: never }
  | { readonly bet: 'number'; readonly number: number };
export type GameInput = CoinsInput | FruitsInput | RouletteInput | DiceInput | PlinkoInput | LimboInput | KenoInput | WheelInput;

export type GamePlayRequest = {
  id: string;
  kind: 'play';
  amount: number;
  gameId: GameId;
  rulesVersion: 1;
  input: GameInput;
};

type RoundAmounts = {
  rulesVersion: 1;
  stakeUnits: string;
  payoutUnits: string;
  /** Total return, including the stake when it is returned. */
  multiplier: number;
};
export type CoinsRound = RoundAmounts & {
  gameId: 'royal-coins';
  input: CoinsInput;
  outcome: { symbols: number[] };
};
export type FruitsRound = RoundAmounts & {
  gameId: 'royal-fruits';
  input: FruitsInput;
  outcome: { symbols: number[] };
};
export type RouletteRound = RoundAmounts & {
  gameId: 'royal-roulette';
  input: RouletteInput;
  outcome: { number: number };
};
export type DiceRound = RoundAmounts & { gameId: 'royal-dice'; input: DiceInput; outcome: { rolledValue: number; won: boolean } };
export type PlinkoRound = RoundAmounts & { gameId: 'royal-plinko'; input: PlinkoInput; outcome: { path: number[]; bucket: number } };
export type LimboRound = RoundAmounts & { gameId: 'royal-limbo'; input: LimboInput; outcome: { rolledMultiplier: number; won: boolean } };
export type KenoRound = RoundAmounts & { gameId: 'royal-keno'; input: KenoInput; outcome: { drawnNumbers: number[]; hits: number[] } };
export type WheelRound = RoundAmounts & { gameId: 'royal-wheel'; input: WheelInput; outcome: { segment: number } };
export type GameRound = CoinsRound | FruitsRound | RouletteRound | DiceRound | PlinkoRound | LimboRound | KenoRound | WheelRound;

export const rouletteRedNumbers = Object.freeze([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Metadata describes fixed server rules; the client cannot override these values. */
export const GAME_CATALOG = Object.freeze([
  Object.freeze({ id: 'royal-wheel', name: 'Royal Fortune', engineId: 'themed-wheel', rulesVersion: 1, rtp: Object.freeze({ numerator: 49, denominator: 50 }), maxMultiplier: 49, kind: 'instant', rounding: 'floor-payout-units' } as const),
  Object.freeze({ id: 'royal-flight', name: 'Royal Orbit', engineId: 'themed-flight', rulesVersion: 1, rtp: Object.freeze({ numerator: 98, denominator: 100 }), maxMultiplier: 100, kind: 'session', rtpVariable: true, rounding: 'discrete-32-bit-rng; floor-payout-units' } as const),
  Object.freeze({ id: 'royal-dice', name: 'Royal Dice', engineId: 'vfair-dice', rulesVersion: 1, rtp: Object.freeze({ numerator: 98, denominator: 100 }), maxMultiplier: 9800, kind: 'instant', rtpVariable: true, rounding: 'nearest-4-decimal-multiplier; floor-payout-units' } as const),
  Object.freeze({ id: 'royal-plinko', name: 'Royal Plinko', engineId: 'vfair-plinko', rulesVersion: 1, rtp: null, maxMultiplier: 10000, kind: 'instant', rtpVariable: true } as const),
  Object.freeze({ id: 'royal-limbo', name: 'Royal Limbo', engineId: 'vfair-limbo', rulesVersion: 1, rtp: Object.freeze({ numerator: 98, denominator: 100 }), maxMultiplier: 1000000, kind: 'instant', rtpVariable: true, rounding: 'upstream-double-floor-roll; discrete-32-bit-rng; floor-payout-units' } as const),
  Object.freeze({ id: 'royal-keno', name: 'Royal Keno', engineId: 'vfair-keno', rulesVersion: 1, rtp: null, maxMultiplier: 1000, kind: 'instant', rtpVariable: true } as const),
  Object.freeze({ id: 'royal-mines', name: 'Royal Mines', engineId: 'vfair-mines', rulesVersion: 1, rtp: Object.freeze({ numerator: 98, denominator: 100 }), maxMultiplier: 5096294, kind: 'session', rtpVariable: true, rounding: 'nearest-2-decimal-multiplier; floor-payout-units' } as const),
  Object.freeze({
    id: 'royal-coins',
    name: 'Royal Coins',
    engineId: 'three-reel-slot',
    rulesVersion: 1,
    rtp: Object.freeze({ numerator: 24, denominator: 25 }),
    maxMultiplier: COINS_MAX_MULTIPLIER,
    kind: 'instant',
  } as const),
  Object.freeze({
    id: 'royal-fruits',
    name: 'Royal Fruits',
    engineId: 'weighted-three-reel-slot',
    rulesVersion: 1,
    rtp: Object.freeze({ numerator: 97, denominator: 100 }),
    maxMultiplier: FRUITS_MAX_MULTIPLIER,
    kind: 'instant',
  } as const),
  Object.freeze({
    id: 'royal-roulette',
    name: 'Royal Roulette',
    engineId: 'european-roulette',
    rulesVersion: 1,
    rtp: Object.freeze({ numerator: 36, denominator: 37 }),
    maxMultiplier: 36,
    kind: 'instant',
  } as const),
]);

function validCoinsSymbols(symbols: unknown): symbols is number[] {
  if (!Array.isArray(symbols) || symbols.length !== COINS_REEL_COUNT) return false;
  for (let reel = 0; reel < COINS_REEL_COUNT; reel++) {
    const symbol: unknown = symbols[reel];
    if (typeof symbol !== 'number' || !Number.isInteger(symbol) || symbol < 0 || symbol >= COINS_SYMBOL_COUNT) return false;
  }
  return true;
}

export function coinsMultiplier(symbols: readonly number[]): number {
  if (!validCoinsSymbols(symbols)) throw new RangeError('Invalid Royal Coins symbols.');
  const distinct = new Set(symbols).size;
  return distinct === 1 ? COINS_MAX_MULTIPLIER : distinct === 2 ? 1 : 0;
}

export function isValidCoinsOutcome(symbols: unknown, multiplier: unknown): boolean {
  return validCoinsSymbols(symbols) && multiplier === coinsMultiplier(symbols);
}

/** Each independent reel selects a uniform stop before its symbol is displayed. */
export function fruitsSymbolForStop(stop: number): number {
  if (!Number.isSafeInteger(stop) || stop < 0 || stop >= FRUITS_REEL_SIZE) {
    throw new RangeError('Invalid Royal Fruits reel stop.');
  }
  let position = stop;
  for (const entry of FRUITS_PAYTABLE) {
    if (position < entry.weight) return entry.symbol;
    position -= entry.weight;
  }
  throw new RangeError('Invalid Royal Fruits reel table.');
}

function validFruitsSymbols(symbols: unknown): symbols is number[] {
  if (!Array.isArray(symbols) || symbols.length !== FRUITS_REEL_COUNT
    || Reflect.ownKeys(symbols).length !== FRUITS_REEL_COUNT + 1) return false;
  for (let reel = 0; reel < FRUITS_REEL_COUNT; reel++) {
    const symbol: unknown = symbols[reel];
    if (!Object.hasOwn(symbols, reel) || typeof symbol !== 'number'
      || !Number.isSafeInteger(symbol) || symbol < 0 || symbol >= FRUITS_SYMBOL_COUNT) return false;
  }
  return true;
}

/** Total return including stake; pairs and mixed symbols return zero. */
export function fruitsMultiplier(symbols: readonly number[]): number {
  if (!validFruitsSymbols(symbols)) throw new RangeError('Invalid Royal Fruits symbols.');
  return symbols[0] === symbols[1] && symbols[1] === symbols[2]
    ? FRUITS_PAYTABLE[symbols[0]].multiplier : 0;
}

export function isValidFruitsOutcome(symbols: unknown, multiplier: unknown): boolean {
  return validFruitsSymbols(symbols) && multiplier === fruitsMultiplier(symbols);
}
import type { DiceInput, KenoInput, LimboInput, OriginalGameId, PlinkoInput } from './originalGames';
import type { WheelInput } from './themedGames';
