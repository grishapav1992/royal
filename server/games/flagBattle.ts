import { randomInt } from 'node:crypto';
import { FLAG_COUNTRIES, validFlagSettings, validFlagStake, type FlagSettings, type FlagView } from '../../src/shared/flagBattle';

/** Uniform Fisher-Yates permutation. The last country is the winner, regardless of the selection. */
export function startFlagBattle(settings: FlagSettings, stake: string, draw: (max: number) => number = randomInt): FlagView {
  if (!validFlagSettings(settings) || !validFlagStake(stake)) throw Error('Invalid Flag Battle start');
  const checked = (max: number) => {
    const value = draw(max);
    if (!Number.isSafeInteger(value) || value < 0 || value >= max) throw Error('Invalid Flag Battle draw');
    return value;
  };
  const order = FLAG_COUNTRIES.map(c => c.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = checked(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { version: 1, country: settings.flags.country, order, seed: checked(2147483648) };
}
