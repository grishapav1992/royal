import { randomInt as cryptoRandomInt } from 'node:crypto';
import type { CoinsRound, GameId, GameInput, GameRound } from '../../src/shared/gameCore';
import { coinsEngine } from './coins';
import { fruitsEngine } from './fruits';
import { wheelEngine } from './wheel';
import { rouletteEngine } from './roulette';
import { diceEngine, plinkoEngine, limboEngine, kenoEngine } from './originals';
import { exactPayoutUnits } from '../../src/shared/originalGames';
import { inputRecord, type GameEngine, type RandomInt } from './types';

export type PreparedGame = {
  readonly gameId: GameId;
  readonly rulesVersion: 1;
  readonly input: GameInput;
  readonly maxMultiplier: number;
  play(stakeUnits: bigint, randomInt?: RandomInt): GameRound;
};

// Versions stay registered so a stored round can always identify its rules.
const GAME_REGISTRY = new Map<string, ReadonlyMap<number, GameEngine>>([
  ['royal-coins', new Map([[1, coinsEngine]])],
  ['royal-fruits', new Map([[1, fruitsEngine]])],
  ['royal-wheel', new Map([[1, wheelEngine]])],
  ['royal-roulette', new Map([[1, rouletteEngine]])],
  ['royal-dice', new Map([[1, diceEngine]])],
  ['royal-plinko', new Map([[1, plinkoEngine]])],
  ['royal-limbo', new Map([[1, limboEngine]])],
  ['royal-keno', new Map([[1, kenoEngine]])],
]);

function registeredEngine(gameId: unknown, rulesVersion: unknown): GameEngine {
  if (typeof gameId !== 'string' || !GAME_REGISTRY.has(gameId)) throw new Error('Unknown game.');
  if (typeof rulesVersion !== 'number' || !Number.isSafeInteger(rulesVersion)) throw new Error('Invalid game rules version.');
  const engine = GAME_REGISTRY.get(gameId)!.get(rulesVersion);
  if (!engine) throw new Error('Unsupported game rules version.');
  return engine;
}

export function prepareGame(gameId: unknown, rulesVersion: unknown, input: unknown): PreparedGame {
  const engine = registeredEngine(gameId, rulesVersion);
  const prepared = engine.prepare(input);
  if (!Number.isSafeInteger(prepared.maxMultiplier) || prepared.maxMultiplier < 0
    || prepared.maxMultiplier > engine.maxMultiplier) throw new Error('Invalid prepared game payout limit.');
  return Object.freeze({
    gameId: engine.gameId,
    rulesVersion: engine.rulesVersion,
    input: prepared.input,
    maxMultiplier: prepared.maxMultiplier,
    play(stakeUnits: bigint, randomInt: RandomInt = cryptoRandomInt): GameRound {
      if (typeof stakeUnits !== 'bigint' || stakeUnits <= 0n) throw new RangeError('The stake must be positive integer units.');
      const checkedRandomInt: RandomInt = max => {
        const value = randomInt(max);
        if (!Number.isSafeInteger(value) || value < 0 || value >= max) throw new RangeError('Invalid random game outcome.');
        return value;
      };
      const result = prepared.draw(checkedRandomInt);
      if (result.gameId !== engine.gameId || !Number.isFinite(result.multiplier)
        || result.multiplier < 0 || result.multiplier > prepared.maxMultiplier) throw new Error('Invalid game engine result.');
      return {
        ...result,
        rulesVersion: engine.rulesVersion,
        stakeUnits: stakeUnits.toString(),
        payoutUnits: exactPayoutUnits(stakeUnits, result.multiplier).toString(),
      };
    },
  });
}

/** Adapter for the existing Royal Coins wallet and its deterministic fixtures. */
export function playRoyalCoins(stakeUnits: bigint, draw?: () => number): CoinsRound {
  const round = prepareGame('royal-coins', 1, {}).play(stakeUnits, draw);
  if (round.gameId !== 'royal-coins') throw new Error('Invalid Royal Coins engine.');
  return round;
}

/** Checks fixed rules and exact accounting. This does not prove a draw was random. */
export function verifyGameRound(value: unknown): value is GameRound {
  try {
    const round = inputRecord(value);
    if (Object.keys(round).sort().join(',') !== 'gameId,input,multiplier,outcome,payoutUnits,rulesVersion,stakeUnits'
      || Reflect.ownKeys(round).length !== 7
      || typeof round.stakeUnits !== 'string' || !/^[1-9][0-9]*$/.test(round.stakeUnits)
      || typeof round.payoutUnits !== 'string' || !/^(0|[1-9][0-9]*)$/.test(round.payoutUnits)
      || typeof round.multiplier !== 'number' || !Number.isFinite(round.multiplier) || round.multiplier < 0) return false;
    const prepared = registeredEngine(round.gameId, round.rulesVersion).prepare(round.input);
    if (!prepared.verifyOutcome(round.outcome, round.multiplier)) return false;
    return BigInt(round.payoutUnits) === exactPayoutUnits(BigInt(round.stakeUnits), round.multiplier);
  } catch {
    return false;
  }
}
