/** Cosmetic crew of Cosmic Escape. It never reads wager entropy and never changes a stake, a chance or a payout. */
export const COSMIC_CREW_GAME = 'studio-cosmic-escape';
export const COSMIC_CREW_CAPSULES = 4;
/** Capsules without artwork stay announced and locked, so nobody collects points for an empty capsule. */
export const COSMIC_CREW = [
  {id: 'racer', points: 0},
  {id: 'silver', points: 100},
] as const;
export type CosmicCrewId = typeof COSMIC_CREW[number]['id'];
export const isCosmicCrewId = (value: unknown): value is CosmicCrewId => COSMIC_CREW.some(member => member.id === value);

/** Points of one completed paid round, by the whole amount debited for it. Amounts are USDT cents. */
export const COSMIC_CREW_RATES = [
  {from: 10, points: 1}, {from: 50, points: 2}, {from: 100, points: 3},
  {from: 500, points: 5}, {from: 1000, points: 8}, {from: 5000, points: 12},
] as const;
export function cosmicCrewPoints(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw Error('Invalid Cosmic crew amount');
  let points = 0;
  for (const rate of COSMIC_CREW_RATES) if (cents >= rate.from) points = rate.points;
  return points;
}
export const cosmicCrewUnlocked = (points: number) => COSMIC_CREW.filter(member => points >= member.points).map(member => member.id);

export type CosmicCrewProfile = {version: 1; accountId: string; revision: number; points: number; unlocked: CosmicCrewId[]; revealed: CosmicCrewId[]; selected: CosmicCrewId; active: boolean};
export type CosmicCrewRequest = {action: 'select' | 'reveal'; characterId: CosmicCrewId};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const keys = (value: object) => Object.keys(value).sort().join();
export function validCosmicCrewRequest(value: unknown): value is CosmicCrewRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys(value) !== 'action,characterId') return false;
  const request = value as CosmicCrewRequest;
  return (request.action === 'select' || request.action === 'reveal') && isCosmicCrewId(request.characterId);
}
export function validCosmicCrewProfile(value: unknown): value is CosmicCrewProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys(value) !== 'accountId,active,points,revealed,revision,selected,unlocked,version') return false;
  const profile = value as CosmicCrewProfile;
  if (profile.version !== 1 || typeof profile.accountId !== 'string' || !profile.accountId || !count(profile.revision) || !count(profile.points) || typeof profile.active !== 'boolean') return false;
  if (!Array.isArray(profile.unlocked) || profile.unlocked.join() !== cosmicCrewUnlocked(profile.points).join()) return false;
  return Array.isArray(profile.revealed) && new Set(profile.revealed).size === profile.revealed.length
    && profile.revealed.every(id => profile.unlocked.includes(id)) && profile.revealed.includes(profile.selected);
}
