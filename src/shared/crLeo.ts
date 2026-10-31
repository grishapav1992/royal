import {validGameStake} from './gameStakes.ts';
import {precisionBaseSession} from './roundPrecision.ts';
export const PENALTY_CLIENT_HEADER = 'X-Royal-Cr-Leo';
export const PENALTY_GAME = 'original-cr-vs-leo' as const;
export const PENALTY_MAX = 54;
export const PENALTY_BETS = ['1000', '5000', '10000', '50000'] as const;
export const PENALTY_RISKS = {
  safe: { name: 'Пенальти', chance: 75, description: 'С 11 метров' },
  sharp: { name: 'Штрафной', chance: 60, description: 'С 20 метров, стенка из пяти' },
  extreme: { name: 'Дальний', chance: 45, description: 'С 30 метров, стенка из трёх' },
} as const;
export type PenaltyHero = 'cr' | 'leo';
export type PenaltyRisk = keyof typeof PENALTY_RISKS;
export type PenaltySettings = { penalty: { hero: PenaltyHero; risk: PenaltyRisk } };
export type PenaltyShot = { index: number; goal: boolean; finish: 'goal' | 'save' | 'post' | 'wide'; side: -1 | 1; risk?: PenaltyRisk; zone?: number };
export type PenaltyView = {
  version: 1 | 2; hero: PenaltyHero; risk: PenaltyRisk; revision: number;
  shots: PenaltyShot[]; status: 'playing' | 'lost' | 'banked' | 'complete';
  availableUnits: string;
};
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, any>, expected: string) => Object.keys(v).sort().join(',') === expected.split(',').sort().join(',');
export const validPenaltyRisk = (v: unknown): v is PenaltyRisk => typeof v === 'string' && Object.hasOwn(PENALTY_RISKS, v);
export const validPenaltyHero = (v: unknown): v is PenaltyHero => v === 'cr' || v === 'leo';
export function validPenaltySettings(v: unknown): v is PenaltySettings {
  return object(v) && keys(v, 'penalty') && object(v.penalty) && keys(v.penalty, 'hero,risk') && validPenaltyHero(v.penalty.hero) && validPenaltyRisk(v.penalty.risk);
}
/** Apply the house edge once to the exact path probability, then round only the final money. */
export function penaltyQuote(stake: string, risk: PenaltyRisk, goals: number): string {
  if (!/^[1-9][0-9]{0,10}$/.test(stake) || !validPenaltyRisk(risk) || !Number.isInteger(goals) || goals < 0 || goals > 5) throw Error('Invalid penalty quote');
  if (!goals) return '0';
  return penaltyPathQuote(stake, Array<PenaltyRisk>(goals).fill(risk));
}
/** The selected risk changes only the next shot; past successes retain their own probabilities. */
export function penaltyPathQuote(stake: string, risks: readonly PenaltyRisk[]): string {
  if (!/^[1-9][0-9]{0,10}$/.test(stake) || !Array.isArray(risks) || risks.length > 5 || !risks.every(validPenaltyRisk)) throw Error('Invalid penalty path');
  if (!risks.length) return '0';
  const probability = risks.reduce((p, r) => p * BigInt(PENALTY_RISKS[r].chance), 1n);
  return String(BigInt(stake) * 99n * 100n ** BigInt(risks.length) / (100n * probability));
}
export const penaltyRisks = (v: PenaltyView): PenaltyRisk[] => v.shots.map(s => s.risk ?? v.risk);
export const validPenaltyZone = (zone: unknown): zone is number => Number.isInteger(zone) && Number(zone) >= 0 && Number(zone) < 18;
/** Zone ids run left to right, then top to bottom, following the supplied 6 by 3 reference. */
export function penaltyZone(zone: number) {
  if (!validPenaltyZone(zone)) throw Error('Invalid goal sector');
  const row = Math.floor(zone / 6), column = zone % 6;
  return { id: zone, row, column, side: column < 3 ? -1 as const : 1 as const, number: (2 - row) * 3 + [3, 2, 1, 1, 2, 3][column], x: (column + .5) / 6, y: (row + .5) / 3 };
}
export function shotZone(shot: PenaltyShot, fallback: PenaltyRisk = 'safe') {
  return penaltyZone(shot.zone ?? ((shot.risk ?? fallback) === 'extreme' ? 0 : 12) + (shot.side < 0 ? 1 : 4));
}
export function penaltyHundredths(risk: PenaltyRisk, goals: number): number {
  return Number(penaltyQuote('100', risk, goals));
}
export function validPenaltyView(v: unknown, stake: string): v is PenaltyView {
  try {
    if (!(validGameStake(stake)||PENALTY_BETS.includes(stake as any)) || !object(v) || !keys(v, 'version,hero,risk,revision,shots,status,availableUnits') || ![1, 2].includes(v.version) || !validPenaltyHero(v.hero) || !validPenaltyRisk(v.risk) || !Array.isArray(v.shots) || v.shots.length < 1 || v.shots.length > 5 || !['playing', 'lost', 'banked', 'complete'].includes(v.status)) return false;
    for (let i = 0; i < v.shots.length; i++) {
      const shot = v.shots[i];
      if (!object(shot) || !keys(shot, v.version === 2 ? 'index,goal,finish,side,risk,zone' : 'index,goal,finish,side') || shot.index !== i || typeof shot.goal !== 'boolean' || !['goal', 'save', 'post', 'wide'].includes(shot.finish) || shot.goal !== (shot.finish === 'goal') || ![-1, 1].includes(shot.side) || i < v.shots.length - 1 && !shot.goal) return false;
      if (v.version === 2 && (!validPenaltyRisk(shot.risk) || !validPenaltyZone(shot.zone) || penaltyZone(shot.zone).side !== shot.side)) return false;
    }
    const lost = !v.shots.at(-1).goal, complete = !lost && v.shots.length === 5;
    if (lost ? v.status !== 'lost' : complete ? v.status !== 'complete' : !['playing', 'banked'].includes(v.status)) return false;
    return (v.version === 1 || v.risk === v.shots.at(-1).risk) && v.revision === v.shots.length + Number(v.status === 'banked') && v.availableUnits === (lost ? '0' : penaltyPathQuote(stake, v.shots.map((s: PenaltyShot) => s.risk ?? v.risk)));
  } catch { return false; }
}
export function validPenaltySettlement(state: string, stake: string, spent: string, returned: string, v: unknown): v is PenaltyView {
  return validPenaltyView(v, stake) && spent === stake && state === (v.status === 'playing' ? 'active' : 'settled') && returned === (v.status === 'banked' || v.status === 'complete' ? v.availableUnits : '0');
}
export function validPenaltySession(s: any): boolean {
  s=precisionBaseSession(s);
  if (!object(s) || !keys(s, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view') || s.gameId !== PENALTY_GAME || s.rulesVersion !== 1 || typeof s.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s.id) || !validPenaltySettlement(s.state, s.stakeUnits, s.spentUnits, s.returnedUnits, s.view?.penalty)) return false;
  const v = s.view;
  if (!object(v) || !keys(v, 'penalty,player,dealer,community,actions,phase,ended,message') || ![v.player, v.dealer, v.community].every(a => Array.isArray(a) && a.length === 0) || !Array.isArray(v.actions) || v.phase !== v.penalty.revision + 1 || v.ended !== (s.state === 'settled') || typeof v.message !== 'string') return false;
  const moves = s.state === 'active' ? ['penalty-kick', 'cashout'] : [];
  return v.actions.length === moves.length && v.actions.every((a: any, i: number) => object(a) && keys(a, 'move,label,cost') && a.move === moves[i] && typeof a.label === 'string' && a.cost === 0);
}
