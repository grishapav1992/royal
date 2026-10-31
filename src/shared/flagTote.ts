import { FLAG_BETS, FLAG_COUNTRIES, type FlagCountry } from './flagBattle';
import type { DemoWallet } from './demoWallet';

export const TOTE_GAME = 'flag-tote' as const;
export const TOTE_HEADER = 'X-Royal-Flag-Tote';
export const TOTE_RULES = 1;
export const TOTE_STAKES = FLAG_BETS;
export const TOTE_LIMITS = { maxBank: 1_000_000, maxAccount: 50_000, maxTickets: 256, minCountries: 3, minAccounts: 2 } as const;
export const TOTE_TIMING = { period: 300_000, betting: 240_000, race: 30_700 } as const;
export type ToteBet = { id: string; roundId: string; rulesVersion: 1; country: FlagCountry; stakeUnits: string };
export type ToteMathTicket = { id: string; accountId: string; country: FlagCountry; stakeUnits: string };
export type ToteAward = { country: FlagCountry; place: number; units: string };
export type ToteSettlement = { state: 'settled' | 'refunded'; reason: 'countries' | 'accounts' | null; potUnits: string; feeUnits: string; awards: ToteAward[]; payouts: { id: string; units: string }[] };
export type ToteRound = { id: string; rulesVersion: 1; openedAt: number; closesAt: number; finishesAt: number; state: 'open' | 'racing' | 'settled' | 'refunded';
  potUnits: string; participants: number; ticketCount: number; totals: { country: FlagCountry; units: string }[]; order?: FlagCountry[]; seed?: number; settlement?: ToteSettlement };
export type ToteReceipt = { id: string; roundId: string; country: FlagCountry; stakeUnits: string; payoutUnits: string | null };
export type ToteSnapshot = { serverNow: number; round: ToteRound; history: ToteRound[]; tickets: ToteReceipt[] };
export type ToteReply = ToteSnapshot & { wallet: DemoWallet; replayed?: boolean };
export const toteUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const toteCountry = (v: unknown): v is FlagCountry => FLAG_COUNTRIES.some(c => c.id === v);
export const toteUnits = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,6})$/.test(v) && Number(v) <= TOTE_LIMITS.maxBank;
export const toteOrder = (v: unknown): v is FlagCountry[] => Array.isArray(v) && v.length === 48 && new Set(v).size === 48 && v.every(toteCountry);
export function validToteBet(v: unknown): v is ToteBet {
  return object(v) && Object.keys(v).sort().join(',') === 'country,id,roundId,rulesVersion,stakeUnits'
    && toteUuid(v.id) && typeof v.roundId === 'string' && /^ft1-[0-9]{1,16}$/.test(v.roundId) && v.rulesVersion === 1 && toteCountry(v.country) && TOTE_STAKES.some(s => s === v.stakeUnits);
}
/** Hamilton allocation: exact integer cents; input order breaks equal remainder ties. */
export function toteAllocate(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n || !weights.length || weights.some(w => w <= 0n)) throw Error('Invalid pool allocation');
  const sum = weights.reduce((a, b) => a + b, 0n);
  const parts = weights.map((w, i) => ({ i, units: total * w / sum, remainder: total * w % sum }));
  let left = total - parts.reduce((a, p) => a + p.units, 0n);
  for (const p of [...parts].sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.i - b.i)) if (left-- > 0n) p.units++;
  return parts.map(p => p.units);
}
export function toteEligible(tickets: readonly ToteMathTicket[]) {
  return new Set(tickets.map(t => t.country)).size >= TOTE_LIMITS.minCountries && new Set(tickets.map(t => t.accountId)).size >= TOTE_LIMITS.minAccounts;
}
/** Rules 1 are retained unchanged for every accepted round. No browser-supplied result is accepted. */
export function settleFlagTote(tickets: readonly ToteMathTicket[], order: readonly FlagCountry[]): ToteSettlement {
  if (!toteOrder(order) || tickets.length > TOTE_LIMITS.maxTickets || new Set(tickets.map(t => t.id)).size !== tickets.length) throw Error('Invalid pool');
  const accounts = new Map<string, bigint>();
  for (const t of tickets) {
    if (!toteCountry(t.country) || !TOTE_STAKES.some(s => s === t.stakeUnits)) throw Error('Invalid pool ticket');
    accounts.set(t.accountId, (accounts.get(t.accountId) ?? 0n) + BigInt(t.stakeUnits));
  }
  const pot = tickets.reduce((n, t) => n + BigInt(t.stakeUnits), 0n);
  if (pot > BigInt(TOTE_LIMITS.maxBank) || [...accounts.values()].some(n => n > BigInt(TOTE_LIMITS.maxAccount))) throw Error('Pool limit exceeded');
  const backed = new Set(tickets.map(t => t.country));
  if (!toteEligible(tickets)) return { state: 'refunded', reason: backed.size < 3 ? 'countries' : 'accounts', potUnits: String(pot), feeUnits: '0', awards: [], payouts: tickets.map(t => ({ id: t.id, units: t.stakeUnits })) };
  const fee = pot / 20n, net = pot - fee;
  const ranking = [...order].reverse();
  const paid = backed.has(ranking[0]) ? [ranking[0]] : ranking.filter(c => backed.has(c)).slice(0, 3);
  const countryAwards = toteAllocate(net, paid.length === 1 ? [1n] : [60n, 30n, 10n]);
  const payouts = new Map(tickets.map(t => [t.id, 0n]));
  paid.forEach((country, i) => {
    const supporters = tickets.filter(t => t.country === country);
    const units = toteAllocate(countryAwards[i], supporters.map(t => BigInt(t.stakeUnits)));
    supporters.forEach((t, n) => payouts.set(t.id, units[n]));
  });
  return { state: 'settled', reason: null, potUnits: String(pot), feeUnits: String(fee), awards: paid.map((country, i) => ({ country, place: ranking.indexOf(country) + 1, units: String(countryAwards[i]) })), payouts: tickets.map(t => ({ id: t.id, units: String(payouts.get(t.id)!) })) };
}
export function validToteSnapshot(v: unknown): v is ToteSnapshot {
  if (!object(v) || !Number.isSafeInteger(v.serverNow) || !Array.isArray(v.history) || v.history.length > 3 || !Array.isArray(v.tickets) || v.tickets.length > 1024) return false;
  const rounds = [v.round, ...v.history];
  for (const r of rounds) {
    if (!object(r) || r.rulesVersion !== 1 || !/^ft1-[0-9]{1,16}$/.test(r.id) || !['open', 'racing', 'settled', 'refunded'].includes(r.state)
      || ![r.openedAt, r.closesAt, r.finishesAt, r.participants, r.ticketCount].every(Number.isSafeInteger) || r.openedAt >= r.closesAt || r.closesAt >= r.finishesAt
      || r.participants < 0 || r.ticketCount < r.participants || r.ticketCount > 256 || !toteUnits(r.potUnits) || !Array.isArray(r.totals) || r.totals.length !== 48
      || new Set(r.totals.map((t: any) => t.country)).size !== 48 || !r.totals.every((t: any) => toteCountry(t.country) && toteUnits(t.units))
      || r.totals.reduce((sum: number, t: any) => sum + Number(t.units), 0) !== Number(r.potUnits)) return false;
    if (r.state === 'open' && (r.order !== undefined || r.seed !== undefined || r.settlement !== undefined)) return false;
    if (r.order !== undefined && (!toteOrder(r.order) || !Number.isSafeInteger(r.seed) || r.seed < 0 || r.seed >= 2147483648)) return false;
    if (r.state === 'racing' && (!r.order || r.settlement !== undefined)) return false;
    if (r.state === 'settled' || r.state === 'refunded') {
      const s = r.settlement;
      if (!object(s) || s.state !== r.state || s.potUnits !== r.potUnits || !toteUnits(s.feeUnits) || !Array.isArray(s.awards) || !Array.isArray(s.payouts) || s.payouts.length) return false;
      if (r.state === 'refunded') { if (s.feeUnits !== '0' || s.awards.length || !['countries', 'accounts'].includes(s.reason)) return false; }
      else if (!r.order || Number(s.feeUnits) !== Number(r.potUnits) / 20 || ![1, 3].includes(s.awards.length) || s.awards.reduce((n: number, a: any) => n + Number(a.units), 0) + Number(s.feeUnits) !== Number(r.potUnits)
        || !s.awards.every((a: any) => toteCountry(a.country) && toteUnits(a.units) && a.place === 48 - r.order.indexOf(a.country))) return false;
    }
  }
  return v.tickets.every((t: any) => object(t) && toteUuid(t.id) && rounds.some(r => r.id === t.roundId) && toteCountry(t.country) && TOTE_STAKES.some(s => s === t.stakeUnits) && (t.payoutUnits === null || toteUnits(t.payoutUnits)));
}
