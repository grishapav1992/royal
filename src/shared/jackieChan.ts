import { PENALTY_BETS, PENALTY_RISKS, validPenaltyRisk, validPenaltyView, validPenaltySession, type PenaltyRisk, type PenaltyView } from './crLeo';

export const JACKIE_GAME = 'original-jackie-chan' as const;
export const JACKIE_HEADER = 'X-Royal-Jackie';
export const JACKIE_BETS = PENALTY_BETS;
export const JACKIE_RISKS = {
  safe: { opponents: 1, chance: PENALTY_RISKS.safe.chance },
  sharp: { opponents: 2, chance: PENALTY_RISKS.sharp.chance },
  extreme: { opponents: 3, chance: PENALTY_RISKS.extreme.chance },
} as const;
// Match GIRLHUB's sequential album thresholds, in wallet hundredths.
export const JACKIE_COSTUMES = [
  { id: 'master', film: 'Пьяный мастер', year: 1978, target: 0, name: 'Ученик мастера' },
  { id: 'sailor', film: 'Проект А', year: 1983, target: 16000, name: 'Морской патруль' },
  { id: 'police', film: 'Полицейская история', year: 1985, target: 44000, name: 'Инспектор' },
  { id: 'hawk', film: 'Доспехи бога', year: 1986, target: 90000, name: 'Азиатский ястреб' },
] as const;
export const JACKIE_LOCATIONS = [
  { id: 'restaurant', name: 'Чайный дом', chapter: 'Столы, стулья и немного кунг-фу' },
  { id: 'harbor', name: 'Старый порт', chapter: 'Последний груз до заката' },
  { id: 'market', name: 'Ночной рынок', chapter: 'Разборка под фонарями' },
] as const;
export type JackieCostume = typeof JACKIE_COSTUMES[number]['id'];
export type JackieLocation = typeof JACKIE_LOCATIONS[number]['id'];
export type JackieSettings = { jackie: { risk: PenaltyRisk; costume: JackieCostume; location: JackieLocation } };
export type JackieView = { version: 1; costume: JackieCostume; location: JackieLocation; collectionUnits: number; combat: PenaltyView };
export const costumeUnlocked = (costume: JackieCostume, units: number) => JACKIE_COSTUMES.some(c => c.id === costume && units >= c.target);
export const validCostume = (v: unknown): v is JackieCostume => JACKIE_COSTUMES.some(c => c.id === v);
export const validLocation = (v: unknown): v is JackieLocation => JACKIE_LOCATIONS.some(c => c.id === v);
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validJackieSettings(v: unknown): v is JackieSettings {
  return object(v) && Object.keys(v).join() === 'jackie' && object(v.jackie)
    && Object.keys(v.jackie).sort().join() === 'costume,location,risk'
    && validPenaltyRisk(v.jackie.risk) && validCostume(v.jackie.costume) && validLocation(v.jackie.location);
}
export function validJackieView(v: unknown, stake: string): v is JackieView {
  return object(v) && Object.keys(v).sort().join() === 'collectionUnits,combat,costume,location,version'
    && v.version === 1 && validCostume(v.costume) && validLocation(v.location)
    && Number.isSafeInteger(v.collectionUnits) && v.collectionUnits >= 0 && v.collectionUnits <= 90000
    && costumeUnlocked(v.costume, v.collectionUnits) && validPenaltyView(v.combat, stake)
    && v.combat.version === 2 && v.combat.hero === 'cr';
}
/** Reuse the original series' strict money/envelope validator without sharing its identity. */
export function validJackieSession(s: any): boolean {
  if (!object(s) || s.gameId !== JACKIE_GAME || !validJackieView(s.view?.jackie, s.stakeUnits)) return false;
  const { jackie, ...envelope } = s.view;
  if (Object.hasOwn(envelope, 'penalty')) return false;
  const expected = s.state === 'active' ? ['jackie-fight','cashout'] : [];
  if (!Array.isArray(envelope.actions) || envelope.actions.length !== expected.length || envelope.actions.some((a:any,i:number) => a?.move !== expected[i])) return false;
  return validPenaltySession({ ...s, gameId: 'original-cr-vs-leo', view: { ...envelope, penalty: jackie.combat,
    actions: Array.isArray(envelope.actions) ? envelope.actions.map((a: any) => ({ ...a, move: a.move === 'jackie-fight' ? 'penalty-kick' : a.move })) : envelope.actions } });
}
export function validJackieReply(s: any, op: any, replayed: boolean): boolean {
  if (op.gameId !== JACKIE_GAME) return true;
  if (!validJackieSession(s)) return false;
  const v = s.view.jackie as JackieView;
  return op.action === 'start' ? validJackieSettings(op.settings) && s.stakeUnits === op.stakeUnits
    && v.costume === op.settings.jackie.costume && v.location === op.settings.jackie.location
    && v.combat.shots[0].risk === op.settings.jackie.risk && (replayed || v.combat.revision === 1)
    : v.combat.revision > op.revision && (replayed || v.combat.revision === op.revision + 1)
      && (op.penaltyRisk === undefined || v.combat.shots[op.revision]?.risk === op.penaltyRisk);
}
