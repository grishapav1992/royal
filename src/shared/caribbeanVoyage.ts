import {CREW_IDS, isCrewId, type CaribbeanCrewId} from './caribbeanCrew.ts';
/** Cosmetic crew of Caribbean Treasures. It never reads wager entropy and never changes a stake, a chance or a payout. */
export const CARIBBEAN_VOYAGE_GAME = 'studio-caribbean-treasures';
const THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250] as const;
/** The order of the islands on the voyage map. */
export const CARIBBEAN_VOYAGE = CREW_IDS.map((id, index) => ({id, points: THRESHOLDS[index]}));
export const VOYAGE_START: CaribbeanCrewId = 'isabella';

/** Points of one completed paid round, by the whole amount debited for it. Amounts are USDT cents. */
export const CARIBBEAN_VOYAGE_RATES = [
  {from: 10, points: 1}, {from: 50, points: 2}, {from: 100, points: 3},
  {from: 500, points: 5}, {from: 1000, points: 8}, {from: 5000, points: 12},
] as const;
export function caribbeanVoyagePoints(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw Error('Invalid Caribbean voyage amount');
  let points = 0;
  for (const rate of CARIBBEAN_VOYAGE_RATES) if (cents >= rate.from) points = rate.points;
  return points;
}
export const caribbeanVoyageReached = (points: number) => CARIBBEAN_VOYAGE.filter(member => points >= member.points).map(member => member.id);

/** `reached` follows the points. `met` also keeps pirates opened before the voyage existed. */
export type CaribbeanVoyageProfile = {version: 1; accountId: string; revision: number; points: number; reached: CaribbeanCrewId[]; met: CaribbeanCrewId[]; selected: CaribbeanCrewId; active: boolean};
export type CaribbeanVoyageRequest = {action: 'select' | 'meet'; characterId: CaribbeanCrewId};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const keys = (value: object) => Object.keys(value).sort().join();
export function validCaribbeanVoyageRequest(value: unknown): value is CaribbeanVoyageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys(value) !== 'action,characterId') return false;
  const request = value as CaribbeanVoyageRequest;
  return (request.action === 'select' || request.action === 'meet') && isCrewId(request.characterId);
}
export function validCaribbeanVoyageProfile(value: unknown): value is CaribbeanVoyageProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys(value) !== 'accountId,active,met,points,reached,revision,selected,version') return false;
  const profile = value as CaribbeanVoyageProfile;
  if (profile.version !== 1 || typeof profile.accountId !== 'string' || !profile.accountId || !count(profile.revision) || !count(profile.points) || typeof profile.active !== 'boolean') return false;
  if (!Array.isArray(profile.reached) || profile.reached.join() !== caribbeanVoyageReached(profile.points).join()) return false;
  return Array.isArray(profile.met) && profile.met.every(isCrewId) && new Set(profile.met).size === profile.met.length
    && profile.met.includes(VOYAGE_START) && profile.met.includes(profile.selected);
}
