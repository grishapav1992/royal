import { WHEEL_MULTIPLIER_CENTS, WHEEL_RISKS, WHEEL_SEGMENT_COUNT, wheelMultiplier, type WheelInput, type WheelRisk } from '../../src/shared/themedGames';
import { inputRecord, type GameEngine } from './types';

export const wheelEngine: GameEngine = {
  gameId: 'royal-wheel', rulesVersion: 1, maxMultiplier: 49,
  prepare(value: unknown) {
    const record = inputRecord(value);
    if (Object.keys(record).join(',') !== 'risk' || Reflect.ownKeys(record).length !== 1
      || !(WHEEL_RISKS as readonly unknown[]).includes(record.risk)) throw new Error('Invalid wheel risk.');
    const risk = record.risk as WheelRisk;
    const input: WheelInput = Object.freeze({ risk });
    return {
      input,
      maxMultiplier: Math.ceil(Math.max(...WHEEL_MULTIPLIER_CENTS[risk]) / 100),
      draw(randomInt) {
        const segment = randomInt(WHEEL_SEGMENT_COUNT);
        return { gameId: 'royal-wheel', input, outcome: { segment }, multiplier: wheelMultiplier(risk, segment) };
      },
      verifyOutcome(value, multiplier) {
        try {
          const outcome = inputRecord(value);
          return Object.keys(outcome).join(',') === 'segment' && Reflect.ownKeys(outcome).length === 1
            && typeof outcome.segment === 'number' && multiplier === wheelMultiplier(risk, outcome.segment);
        } catch { return false; }
      },
    };
  },
};
