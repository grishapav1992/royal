import { HEROES, MAX_ROUND_SPINS, NEOPOLIS_MATH, PAYTABLE, initialTeam, playNeopolisSpin, type Hero, type Team, type Battle, type Spin } from './neopolisMath';
import { playNeopolisSpin as playNeopolisSpinV3 } from './neopolisMathV3';
import { NEOPOLIS_PAYOUT_SCALE, neopolisTeamPayout } from './neopolisStakePayouts';
import { playNeopolisSpin as playNeopolisSpinV1 } from './neopolisMathV1';
import { playNeopolisSpin as playNeopolisSpinV2, PAYTABLE as PAYTABLE_V2 } from './neopolisMathV2';

export const NEOPOLIS_GAME = 'studio-neopolis' as const;
export const NEOPOLIS_HEADER = 'X-Royal-Neopolis-Rules';
export const NEOPOLIS_BETS = [10, 20, 50, 100, 200, 500] as const;
export const NEOPOLIS_MAX_WIN = 3000;
// Five resolution chains (initial, three heroes, finisher) fit even at their full bounds.
const MAX_DRAWS = 4096;
export type NeopolisSettings = { neopolis: { hero: Hero } };
export type RecordedSpin = { draws: number[]; result: Spin; payoutUnits: string };
export type NeopolisVersion = 1 | 2 | 3 | 4;
export type NeopolisView = { kind: 'neopolis'; version: NeopolisVersion; revision: number; origin: Team; history: RecordedSpin[]; team: Team; battle: Battle | null; totalPayoutUnits: string; capped: boolean };
export type NeopolisResult = { view: NeopolisView; ended: boolean; credit: number; message: string; actions: { move: 'neopolis-spin'; label: string; cost: 0 }[] };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: object, expected: string) => Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
const integer = (value: unknown, low: number, high: number): value is number => Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const validNeopolisStake = (value: unknown): value is string => typeof value === 'string' && NEOPOLIS_BETS.some(bet => String(bet * 100) === value);
export function validTeam(value: unknown): value is Team {
  return record(value) && keys(value, 'starter,charges,complete') && HEROES.includes(value.starter) && typeof value.complete === 'boolean'
    && Array.isArray(value.charges) && value.charges.length === 3 && Array.from(value.charges).every((n: unknown) => integer(n, 0, 3)) && value.charges[HEROES.indexOf(value.starter)] === 3;
}
export function validNeopolisSettings(value: unknown): value is NeopolisSettings {
  return record(value) && keys(value, 'neopolis') && record(value.neopolis) && keys(value.neopolis, 'hero') && HEROES.includes(value.neopolis.hero);
}
export function neopolisPointUnits(stake: string, points: number, version: NeopolisVersion, origin?: Team) {
  if (version === 4 && !origin) throw Error('Missing Neopolis round team');
  const scale = version === 4 ? neopolisTeamPayout(origin!) : 1n;
  return BigInt(stake) * BigInt(points) * scale / (40n * BigInt(version >= 3 ? NEOPOLIS_MATH.payDenominator : 1) * (version === 4 ? NEOPOLIS_PAYOUT_SCALE : 1n));
}
export function neopolisPaytable(version: NeopolisVersion, origin?: Team) {
  if (version === 4 && !origin) throw Error('Missing Neopolis paytable team');
  const scale = version === 4 ? Number(neopolisTeamPayout(origin!)) / Number(NEOPOLIS_PAYOUT_SCALE) : 1;
  return version >= 3 ? PAYTABLE.map(row => row.map(pay => pay / NEOPOLIS_MATH.payDenominator * scale)) : PAYTABLE_V2;
}
export function emptyNeopolisView(origin: Team, version: NeopolisVersion = 4): NeopolisView {
  return { kind: 'neopolis', version, revision: 0, origin: structuredClone(origin), history: [], team: structuredClone(origin), battle: null, totalPayoutUnits: '0', capped: false };
}
/** Only consumed past random draws enter the transcript. No future spin is generated. */
export function advanceNeopolis(value: NeopolisView, stake: string, draw: (max: number) => number): NeopolisResult {
  const view = structuredClone(value), draws: number[] = [];
  const play = view.version === 1 ? playNeopolisSpinV1 : view.version === 2 ? playNeopolisSpinV2 : view.version === 3 ? playNeopolisSpinV3 : playNeopolisSpin;
  const result: Spin = play(view.team, view.battle, () => {
    const n = draw(4294967296);
    if (!integer(n, 0, 4294967295) || draws.length >= MAX_DRAWS) throw Error('Invalid Neopolis entropy');
    draws.push(n); return n / 4294967296;
  });
  const available = BigInt(stake) * BigInt(NEOPOLIS_MAX_WIN) - BigInt(view.totalPayoutUnits);
  const raw = neopolisPointUnits(stake, result.points, view.version, view.origin);
  const payout = raw < available ? raw : available;
  view.totalPayoutUnits = String(BigInt(view.totalPayoutUnits) + payout);
  view.history.push({ draws, result, payoutUnits: String(payout) });
  view.revision++; view.team = result.team; view.battle = result.battle; view.capped = raw >= available;
  const ended = !view.battle || view.battle.remaining === 0 || view.capped;
  // Reaching the declared round limit ends the collection cycle and bonus together.
  if (view.capped) view.team = { ...view.team, complete: true };
  return { view, ended, credit: ended ? Number(view.totalPayoutUnits) : 0,
    message: ended ? 'Neopolis: settled' : 'Neopolis: bonus saved', actions: ended ? [] : [{ move: 'neopolis-spin', label: 'Neopolis free spin', cost: 0 }] };
}

export function validNeopolisView(stake: string, value: unknown): value is NeopolisView {
  try {
    if (!validNeopolisStake(stake) || !record(value) || !keys(value, 'kind,version,revision,origin,history,team,battle,totalPayoutUnits,capped')
      || value.kind !== 'neopolis' || ![1,2,3,4].includes(value.version) || !validTeam(value.origin) || value.origin.complete || !Array.isArray(value.history)
      || !integer(value.revision, 1, value.version === 1 ? 14 : MAX_ROUND_SPINS) || value.history.length !== value.revision) return false;
    let replay = emptyNeopolisView(value.origin, value.version);
    for (const spin of value.history) {
      if (!record(spin) || !keys(spin, 'draws,result,payoutUnits') || !Array.isArray(spin.draws) || spin.draws.length > MAX_DRAWS
        || !spin.draws.every((n: unknown) => integer(n, 0, 4294967295)) || replay.capped
        || (replay.revision > 0 && (!replay.battle || replay.battle.remaining === 0))) return false;
      let cursor = 0;
      const next = advanceNeopolis(replay, stake, () => { if (cursor >= spin.draws.length) throw Error('Missing entropy'); return spin.draws[cursor++]; });
      if (cursor !== spin.draws.length || !same(next.view.history.at(-1), spin)) return false;
      replay = next.view;
    }
    return same(replay, value);
  } catch { return false; }
}
export function validNeopolisSettlement(state: string, stake: string, spent: string, returned: string, view: unknown): view is NeopolisView {
  if (!validNeopolisView(stake, view) || stake !== spent) return false;
  const ended = !view.battle || view.battle.remaining === 0 || view.capped;
  return ended ? state === 'settled' && returned === view.totalPayoutUnits : state === 'active' && returned === '0';
}
export function validNeopolisSession(value: unknown): boolean {
  if (!record(value) || !keys(value, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view') || value.gameId !== NEOPOLIS_GAME || ![1,2,3,4].includes(value.rulesVersion)
    || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id) || !record(value.view)) return false;
  const envelope = value.view;
  return keys(envelope, 'player,dealer,community,actions,phase,ended,message,neopolis')
    && value.rulesVersion === envelope.neopolis?.version
    && validNeopolisSettlement(value.state, value.stakeUnits, value.spentUnits, value.returnedUnits, envelope.neopolis)
    && [envelope.player, envelope.dealer, envelope.community].every(list => Array.isArray(list) && list.length === 0)
    && envelope.phase === envelope.neopolis.revision + 1 && envelope.ended === (value.state === 'settled')
    && envelope.message === (envelope.ended ? 'Neopolis: settled' : 'Neopolis: bonus saved')
    && same(envelope.actions, envelope.ended ? [] : [{ move: 'neopolis-spin', label: 'Neopolis free spin', cost: 0 }]);
}
export { initialTeam };
