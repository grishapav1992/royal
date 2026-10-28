import { randomInt } from 'node:crypto';
import { startPenalty, movePenalty } from './crLeo';
import { validJackieSettings, validJackieView, type JackieSettings, type JackieView } from '../../src/shared/jackieChan';
import type { PenaltyRisk } from '../../src/shared/crLeo';

export function startJackie(settings: JackieSettings, stake: string, collectionUnits: number, draw = randomInt): JackieView {
  if (!validJackieSettings(settings)) throw Error('Invalid Jackie settings');
  const { costume, location, risk } = settings.jackie;
  const result: JackieView = { version: 1, costume, location, collectionUnits,
    combat: startPenalty({ penalty: { hero: 'cr', risk } }, stake, draw) };
  if (!validJackieView(result, stake)) throw Error('Invalid Jackie collection');
  return result;
}
export function moveJackie(value: JackieView, stake: string, move: string, revision: number | undefined, draw = randomInt, risk?: PenaltyRisk): JackieView {
  if (!validJackieView(value, stake)) throw Error('Invalid saved Jackie series');
  return { ...value, combat: movePenalty(value.combat, stake, move === 'jackie-fight' ? 'penalty-kick' : move, revision, draw, risk) };
}
