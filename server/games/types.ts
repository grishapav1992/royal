import type { CoinsRound, FruitsRound, GameInput, GameId, RouletteRound, DiceRound, PlinkoRound, LimboRound, KenoRound, WheelRound } from '../../src/shared/gameCore';

export type RandomInt = (max: number) => number;
export type EngineResult =
  | Pick<CoinsRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<FruitsRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<DiceRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<PlinkoRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<LimboRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<KenoRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<WheelRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>
  | Pick<RouletteRound, 'gameId' | 'input' | 'multiplier' | 'outcome'>;
export type PreparedEngine = {
  input: GameInput;
  maxMultiplier: number;
  draw: (randomInt: RandomInt) => EngineResult;
  verifyOutcome: (outcome: unknown, multiplier: number) => boolean;
};
export type GameEngine = {
  gameId: GameId;
  rulesVersion: 1;
  maxMultiplier: number;
  prepare: (input: unknown) => PreparedEngine;
};

export function inputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || Reflect.ownKeys(input).some(key => typeof key !== 'string')) {
    throw new Error('Invalid game input.');
  }
  return input as Record<string, unknown>;
}
