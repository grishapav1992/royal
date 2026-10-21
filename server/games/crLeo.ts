import { randomInt } from 'node:crypto';
import { PENALTY_RISKS, penaltyPathQuote, penaltyZone, shotZone, validPenaltyRisk, validPenaltySettings, validPenaltyView, type PenaltyRisk, type PenaltySettings, type PenaltyView, type PenaltyShot } from '../../src/shared/crLeo';

export class PenaltyMoveError extends Error {}
function kick(v: PenaltyView, stake: string, draw: (max: number) => number): PenaltyView {
  const goal = draw(100) < PENALTY_RISKS[v.risk].chance;
  const finish: PenaltyShot['finish'] = goal ? 'goal' : (['save', 'post', 'wide'] as const)[draw(3)];
  const zone = draw(18);
  const shot: PenaltyShot = { index: v.shots.length, goal, finish, side: penaltyZone(zone).side, risk: v.risk, zone };
  const shots = [...v.shots, shot];
  return { ...v, version: 2, shots, revision: v.revision + 1, status: !goal ? 'lost' : shots.length === 5 ? 'complete' : 'playing', availableUnits: goal ? penaltyPathQuote(stake, shots.map(s => s.risk!)) : '0' };
}
export function startPenalty(settings: PenaltySettings, stake: string, draw = randomInt): PenaltyView {
  if (!validPenaltySettings(settings)) throw new PenaltyMoveError('Выбери игрока и риск.');
  return kick({ version: 2, ...settings.penalty, revision: 0, shots: [], status: 'playing', availableUnits: '0' }, stake, draw);
}
export function movePenalty(value: unknown, stake: string, move: string, revision: number | undefined, draw = randomInt, risk?: PenaltyRisk): PenaltyView {
  if (!validPenaltyView(value, stake)) throw Error('Invalid saved penalty series');
  if (value.status !== 'playing' || value.revision !== revision) throw new PenaltyMoveError('Этот удар уже обработан. Обнови серию.');
  if (move === 'cashout') return { ...structuredClone(value), status: 'banked', revision: value.revision + 1 };
  if (move !== 'penalty-kick') throw new PenaltyMoveError('Недопустимое действие серии.');
  if (risk !== undefined && !validPenaltyRisk(risk)) throw new PenaltyMoveError('Выбери риск следующего удара.');
  // Preserve legacy accepted shots when continuing a series saved before per-shot risks and sectors.
  const shots = value.shots.map(s => ({ ...s, risk: s.risk ?? value.risk, zone: shotZone(s, value.risk).id }));
  return kick({ ...value, shots, risk: risk ?? value.risk }, stake, draw);
}
