import { gameAccountId } from '../../src/shared/nileWallet';
import { isPvpGame, pvpPayout, validPvpStake, type PvpGameId } from '../../src/shared/pvp';

export type PvpOwner = { accountId: string; userId: string };
export type PvpMoneyEvent = {
  version: 1; action: 'hold' | 'refund' | 'settle'; matchId: string; gameId: PvpGameId;
  stakeUnits: string; participants: PvpOwner[]; winnerId: string | null; reason: string; createdAt: number;
};
export type PvpMoneyMatch = { gameId: PvpGameId; stakeUnits: string; participants: PvpOwner[]; final?: PvpMoneyEvent };
export const pvpEventId = (row: PvpMoneyEvent) => `pvp:${row.matchId}:${row.action === 'hold' ? row.participants[0].accountId : 'final'}`;
const escrow = (id: string, userId: string) => `pvp:${id}:${userId}`;
const fail = (): never => { throw Error('Invalid PvP ledger event'); };
export function validPvpMoneyEvent(value: unknown): value is PvpMoneyEvent {
  const row = value as PvpMoneyEvent;
  return !!row && Object.keys(row).sort().join(',') === 'action,createdAt,gameId,matchId,participants,reason,stakeUnits,version,winnerId'
    && row.version === 1 && gameAccountId(row.matchId) && isPvpGame(row.gameId) && validPvpStake(row.stakeUnits)
    && ['hold', 'refund', 'settle'].includes(row.action) && Number.isSafeInteger(row.createdAt) && row.createdAt > 0
    && ['hold', 'win', 'draw', 'cancel', 'expired', 'server', 'disconnect', 'resign', 'timeout'].includes(row.reason)
    && Array.isArray(row.participants) && row.participants.length >= 1 && row.participants.length <= 2
    && row.participants.every(owner => owner && Object.keys(owner).sort().join(',') === 'accountId,userId'
      && gameAccountId(owner.accountId) && typeof owner.userId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(owner.userId))
    && new Set(row.participants.map(owner => owner.accountId)).size === row.participants.length
    && new Set(row.participants.map(owner => owner.userId)).size === row.participants.length
    && (row.winnerId === null || row.participants.some(owner => owner.accountId === row.winnerId));
}
/** Replayed by the financial audit in journal order, without trusting mutable game state. */
export function applyPvpMoneyEvent(row: PvpMoneyEvent, matches: Map<string, PvpMoneyMatch>) {
  if (!validPvpMoneyEvent(row)) return fail();
  let match = matches.get(row.matchId);
  if (match && (match.final || match.gameId !== row.gameId || match.stakeUnits !== row.stakeUnits)) return fail();
  if (row.action === 'hold') {
    if (row.participants.length !== 1 || row.winnerId !== null || row.reason !== 'hold') return fail();
    if (!match) { match = { gameId: row.gameId, stakeUnits: row.stakeUnits, participants: [] }; matches.set(row.matchId, match); }
    const owner = row.participants[0];
    if (match.participants.length >= 2 || match.participants.some(saved => saved.accountId === owner.accountId || saved.userId === owner.userId)) return fail();
    match.participants.push(owner);
    return [{ account: 'player:' + owner.userId, units: '-' + row.stakeUnits }, { account: escrow(row.matchId, owner.userId), units: row.stakeUnits }];
  }
  if (!match || JSON.stringify(match.participants) !== JSON.stringify(row.participants)) return fail();
  if (row.action === 'settle' ? row.participants.length !== 2 || row.winnerId === null : row.winnerId !== null) return fail();
  match.final = row;
  const entries = row.participants.map(owner => ({ account: escrow(row.matchId, owner.userId), units: '-' + row.stakeUnits }));
  if (row.action === 'refund') for (const owner of row.participants) entries.push({ account: 'player:' + owner.userId, units: row.stakeUnits });
  else {
    const winner = row.participants.find(owner => owner.accountId === row.winnerId)!;
    const result = pvpPayout(row.stakeUnits);
    entries.push({ account: 'player:' + winner.userId, units: result.payoutUnits }, { account: 'house', units: result.feeUnits });
  }
  return entries;
}
