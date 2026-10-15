import { rouletteRedNumbers, type RouletteInput } from '../../src/shared/gameCore';
import { inputRecord, type GameEngine } from './types';

const RED_NUMBERS = new Set(rouletteRedNumbers);

function rouletteMultiplier(input: RouletteInput, number: number): number {
  const wins = input.bet === 'number' ? number === input.number : number !== 0 && (
    input.bet === 'red' ? RED_NUMBERS.has(number)
      : input.bet === 'black' ? !RED_NUMBERS.has(number)
        : input.bet === 'even' ? number % 2 === 0 : number % 2 === 1
  );
  return wins ? (input.bet === 'number' ? 36 : 2) : 0;
}

function rouletteInput(value: unknown): RouletteInput {
  const input = inputRecord(value);
  const keys = Reflect.ownKeys(input);
  if (input.bet === 'number') {
    if (keys.length !== 2 || !keys.includes('bet') || !keys.includes('number')
      || typeof input.number !== 'number' || !Number.isInteger(input.number) || input.number < 0 || input.number > 36) {
      throw new Error('A number bet requires an integer from 0 to 36.');
    }
    return Object.freeze({ bet: 'number', number: input.number });
  }
  if (keys.length !== 1 || keys[0] !== 'bet'
    || (input.bet !== 'red' && input.bet !== 'black' && input.bet !== 'even' && input.bet !== 'odd')) {
    throw new Error('Invalid roulette bet.');
  }
  return Object.freeze({ bet: input.bet });
}

export const rouletteEngine: GameEngine = Object.freeze({
  gameId: 'royal-roulette',
  rulesVersion: 1,
  maxMultiplier: 36,
  prepare(value: unknown) {
    const input = rouletteInput(value);
    return {
      input,
      maxMultiplier: input.bet === 'number' ? 36 : 2,
      draw(randomInt) {
        const number = randomInt(37);
        return { gameId: 'royal-roulette', input, outcome: { number }, multiplier: rouletteMultiplier(input, number) };
      },
      verifyOutcome(value, multiplier) {
        const outcome = inputRecord(value);
        return Reflect.ownKeys(outcome).length === 1 && Object.hasOwn(outcome, 'number')
          && typeof outcome.number === 'number' && Number.isInteger(outcome.number)
          && outcome.number >= 0 && outcome.number <= 36 && rouletteMultiplier(input, outcome.number) === multiplier;
      },
    };
  },
});
