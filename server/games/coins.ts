import { COINS_MAX_MULTIPLIER, COINS_REEL_COUNT, COINS_SYMBOL_COUNT, coinsMultiplier, isValidCoinsOutcome } from '../../src/shared/gameCore';
import { inputRecord, type GameEngine } from './types';

export const coinsEngine: GameEngine = Object.freeze({
  gameId: 'royal-coins',
  rulesVersion: 1,
  maxMultiplier: COINS_MAX_MULTIPLIER,
  prepare(input: unknown) {
    if (Reflect.ownKeys(inputRecord(input)).length !== 0) throw new Error('Royal Coins requires empty input.');
    const normalizedInput = Object.freeze({});
    return {
      input: normalizedInput,
      maxMultiplier: COINS_MAX_MULTIPLIER,
      draw(randomInt) {
        const symbols = Array.from({ length: COINS_REEL_COUNT }, () => randomInt(COINS_SYMBOL_COUNT));
        return { gameId: 'royal-coins', input: normalizedInput, outcome: { symbols }, multiplier: coinsMultiplier(symbols) };
      },
      verifyOutcome(value, multiplier) {
        const outcome = inputRecord(value);
        return Reflect.ownKeys(outcome).length === 1 && Object.hasOwn(outcome, 'symbols')
          && isValidCoinsOutcome(outcome.symbols, multiplier);
      },
    };
  },
});
