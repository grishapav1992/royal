import {
  FRUITS_MAX_MULTIPLIER, FRUITS_REEL_COUNT, FRUITS_REEL_SIZE,
  fruitsMultiplier, fruitsSymbolForStop, isValidFruitsOutcome,
} from '../../src/shared/gameCore';
import { inputRecord, type GameEngine } from './types';

export const fruitsEngine: GameEngine = Object.freeze({
  gameId: 'royal-fruits',
  rulesVersion: 1,
  maxMultiplier: FRUITS_MAX_MULTIPLIER,
  prepare(input: unknown) {
    if (Reflect.ownKeys(inputRecord(input)).length !== 0) throw new Error('Royal Fruits requires empty input.');
    const normalizedInput = Object.freeze({});
    return {
      input: normalizedInput,
      maxMultiplier: FRUITS_MAX_MULTIPLIER,
      draw(randomInt) {
        const symbols = Array.from({ length: FRUITS_REEL_COUNT }, () => fruitsSymbolForStop(randomInt(FRUITS_REEL_SIZE)));
        return { gameId: 'royal-fruits', input: normalizedInput, outcome: { symbols }, multiplier: fruitsMultiplier(symbols) };
      },
      verifyOutcome(value, multiplier) {
        const outcome = inputRecord(value);
        return Reflect.ownKeys(outcome).length === 1 && Object.hasOwn(outcome, 'symbols')
          && isValidFruitsOutcome(outcome.symbols, multiplier);
      },
    };
  },
});
