import {
  diceOdds, getKenoMultipliers, getPlinkoMultipliers, kenoOdds, limboOdds,
  type DiceInput, type KenoInput, type LimboInput, type PlinkoInput,
} from '../../src/shared/originalGames';
import { isWon } from './vfair/dice/dice-math';
import { isLimboWon } from './vfair/limbo/limbo-math';
import { rollLimboFromInteger } from './vfair/limbo/limbo-roll';
import { inputRecord, type GameEngine } from './types';

function keys(value: unknown, expected: string): Record<string, unknown> {
  const row = inputRecord(value);
  if (Reflect.ownKeys(row).length !== expected.split(',').length || Object.keys(row).sort().join(',') !== expected) throw new Error('Invalid game fields');
  return row;
}
function decimalNumber(value: unknown, decimals: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && new RegExp('^\\d+(?:\\.\\d{1,' + decimals + '})?$').test(String(value));
}
function uniqueNumbers(value: unknown, count: number, low: number, high: number): value is number[] {
  return Array.isArray(value) && value.length === count && Reflect.ownKeys(value).length === count + 1
    && [...value].every(n => Number.isSafeInteger(n) && n >= low && n <= high) && new Set(value).size === count;
}

export const diceEngine: GameEngine = Object.freeze({
  gameId: 'royal-dice', rulesVersion: 1, maxMultiplier: 9800,
  prepare(value) {
    const row = keys(value, 'gameMode,sliderValue');
    if ((row.gameMode !== 'rollUnder' && row.gameMode !== 'rollOver') || !decimalNumber(row.sliderValue, 2)) throw new Error('Invalid Dice input');
    const input: DiceInput = Object.freeze({ gameMode: row.gameMode, sliderValue: row.sliderValue });
    const odds = diceOdds.calculate(input);
    const won = (rolledValue: number) => isWon({ ...input, rolledValue });
    return {
      input, maxMultiplier: Math.ceil(odds.multiplier),
      draw(randomInt) { const rolledValue = randomInt(10000) / 100; const win = won(rolledValue); return { gameId: 'royal-dice', input, outcome: { rolledValue, won: win }, multiplier: win ? odds.multiplier : 0 }; },
      verifyOutcome(value, multiplier) {
        const result = keys(value, 'rolledValue,won');
        if (!decimalNumber(result.rolledValue, 2) || result.rolledValue < 0 || result.rolledValue > 99.99 || typeof result.won !== 'boolean') return false;
        const win = won(result.rolledValue);
        return result.won === win && multiplier === (win ? odds.multiplier : 0);
      },
    };
  },
});

export const plinkoEngine: GameEngine = Object.freeze({
  gameId: 'royal-plinko', rulesVersion: 1, maxMultiplier: 10000,
  prepare(value) {
    const row = keys(value, 'risk,rows');
    const input = Object.freeze({ rows: row.rows, risk: row.risk }) as PlinkoInput;
    const table = getPlinkoMultipliers(input.rows, input.risk);
    return {
      input, maxMultiplier: Math.ceil(Math.max(...table)),
      draw(randomInt) { const path = Array.from({ length: input.rows }, () => randomInt(2)); const bucket = path.reduce((a, b) => a + b, 0); return { gameId: 'royal-plinko', input, outcome: { path, bucket }, multiplier: table[bucket] }; },
      verifyOutcome(value, multiplier) {
        const result = keys(value, 'bucket,path');
        if (!Array.isArray(result.path) || result.path.length !== input.rows || Reflect.ownKeys(result.path).length !== input.rows + 1
          || [...result.path].some(bit => bit !== 0 && bit !== 1)) return false;
        const bucket = (result.path as number[]).reduce((a, b) => a + b, 0);
        return result.bucket === bucket && multiplier === table[bucket];
      },
    };
  },
});

export const limboEngine: GameEngine = Object.freeze({
  gameId: 'royal-limbo', rulesVersion: 1, maxMultiplier: 1000000,
  prepare(value) {
    const row = keys(value, 'targetMultiplier');
    if (!decimalNumber(row.targetMultiplier, 2)) throw new Error('Invalid Limbo target');
    const input: LimboInput = Object.freeze({ targetMultiplier: limboOdds.calculate({ targetMultiplier: row.targetMultiplier }).targetMultiplier });
    const won = (rolledMultiplier: number) => isLimboWon({ ...input, rolledMultiplier });
    return {
      input, maxMultiplier: Math.ceil(input.targetMultiplier),
      draw(randomInt) {
        const integer = randomInt(2 ** 32);
        const rolledMultiplier = rollLimboFromInteger(integer, 0.98);
        const win = won(rolledMultiplier);
        return { gameId: 'royal-limbo', input, outcome: { rolledMultiplier, won: win }, multiplier: win ? input.targetMultiplier : 0 };
      },
      verifyOutcome(value, multiplier) {
        const result = keys(value, 'rolledMultiplier,won');
        if (!decimalNumber(result.rolledMultiplier, 2) || result.rolledMultiplier < 1 || result.rolledMultiplier > 1000000 || typeof result.won !== 'boolean') return false;
        const win = won(result.rolledMultiplier);
        return result.won === win && multiplier === (win ? input.targetMultiplier : 0);
      },
    };
  },
});

export const kenoEngine: GameEngine = Object.freeze({
  gameId: 'royal-keno', rulesVersion: 1, maxMultiplier: 1000,
  prepare(value) {
    const row = keys(value, 'picks,risk');
    if (!Array.isArray(row.picks) || row.picks.length < 1 || row.picks.length > 10
      || !uniqueNumbers(row.picks, row.picks.length, 1, 40) || typeof row.risk !== 'string'
      || Object.keys(kenoOdds.validate({ picks: row.picks, risk: row.risk })).length) throw new Error('Invalid Keno input');
    const input = Object.freeze({ picks: Object.freeze(kenoOdds.normalizePicks(row.picks)), risk: row.risk }) as KenoInput;
    const table = getKenoMultipliers(input.picks.length, input.risk);
    const hitsFor = (drawn: readonly number[]) => input.picks.filter(pick => drawn.includes(pick));
    return {
      input, maxMultiplier: Math.ceil(Math.max(...table)),
      draw(randomInt) {
        const pool = Array.from({ length: 40 }, (_, i) => i + 1);
        const drawnNumbers: number[] = [];
        for (let i = 0; i < 10; i++) drawnNumbers.push(pool.splice(randomInt(pool.length), 1)[0]);
        drawnNumbers.sort((a, b) => a - b);
        const hits = [...hitsFor(drawnNumbers)];
        return { gameId: 'royal-keno', input, outcome: { drawnNumbers, hits }, multiplier: table[hits.length] };
      },
      verifyOutcome(value, multiplier) {
        const result = keys(value, 'drawnNumbers,hits');
        if (!uniqueNumbers(result.drawnNumbers, 10, 1, 40) || !Array.isArray(result.hits)
          || !uniqueNumbers(result.hits, result.hits.length, 1, 40)) return false;
        const hits = hitsFor(result.drawnNumbers);
        return JSON.stringify(result.hits) === JSON.stringify(hits) && multiplier === table[hits.length];
      },
    };
  },
});
