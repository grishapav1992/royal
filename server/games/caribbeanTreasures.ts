import { randomInt } from 'node:crypto';
import {
  startCaribbeanRound, moveCaribbeanRound, validCaribbeanView, CaribbeanMoveError,
  type CaribbeanSettings, type CaribbeanView, type CaribbeanMove,
} from '../../src/shared/caribbeanTreasures.ts';
import type { CaribbeanRandom } from '../../src/shared/caribbeanTreasuresMath.ts';

export function startCaribbean(settings: CaribbeanSettings, lineStakeUnits: string, draw: CaribbeanRandom = randomInt) {
  return startCaribbeanRound(settings, lineStakeUnits, draw);
}
export function moveCaribbean(view: CaribbeanView, revision: unknown, move: CaribbeanMove, draw: CaribbeanRandom = randomInt) {
  if (!validCaribbeanView(view)) throw new CaribbeanMoveError('Invalid saved Caribbean round');
  return moveCaribbeanRound(view, revision, move, draw);
}
