import type { DatabaseRow, PostgresDatabase } from '../database';
import { isPvpMoneyGame } from '../finance/pvp-money';
import { registeredAuditMode } from './mode-registry';
import { gameAccountId } from '../../src/shared/nileWallet';
import { isAuditEntityRef, type AuditEntityRef, type AuditSourceRef } from './contract';

export type PvpPostingKey = {
  rowId: string;
  accountId: string;
  operationId: string;
  gameId: string;
};

export type PvpPostingResolution = {
  source: AuditSourceRef;
  entity: AuditEntityRef & { category: 'pvp' };
  // Completeness describes the entity link and rules version, independently of request evidence.
  coverage: 'complete' | 'partial';
  operation: null;
  origin: 'automatic' | 'unknown';
  stage: 'hold' | 'final';
  openingObligationKey: { sourceNamespace: string; accountId: string; entityId: string };
  // These are current stored snapshots. All amounts are in the shared wallet's exact cents.
  hold: { source: AuditSourceRef; state: 'held' | 'settled' | 'refunded'; stakeUnits: string; payoutCapacityUnits: string };
  bank: {
    source: AuditSourceRef; state: 'open' | 'settled' | 'refunded'; stakeUnits: string;
    winnerId: string | null; reason: string; feeUnits: string;
  };
};

const automaticReasons = new Set(['expired', 'server', 'disconnect', 'timeout']);

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function gameplayMatch(row: DatabaseRow, matchId: string, entry: PvpPostingKey) {
  const transportStake = String(BigInt(row.bank_stake_units) * 10_000n);
  if (entry.gameId === 'mortal-kombat') {
    const accounts = parseJson(row.combat_accounts);
    if (Array.isArray(accounts) && accounts.length === 2 && accounts.every(gameAccountId) &&
        accounts[0] !== accounts[1] && accounts.includes(entry.accountId) &&
        transportStake === row.combat_stake_units) {
      return { table: 'combat_matches', rulesVersion: null };
    }
    return null;
  }

  const payload = parseJson(row.match_payload);
  const challenge = isObject(payload) ? payload.challenge : null;
  if (!isObject(challenge) || challenge.id !== matchId || challenge.gameId !== entry.gameId ||
      challenge.creatorId !== row.creator_id || challenge.opponentId !== row.opponent_id ||
      challenge.status !== row.match_status || challenge.mode === 'free' || challenge.stakeUnits !== transportStake ||
      ![row.creator_id, row.opponent_id].includes(entry.accountId)) return null;
  const mode = registeredAuditMode(entry.gameId, 'stake', challenge.rulesVersion);
  const rulesVersion = mode?.category === 'pvp' ? mode.rulesVersion : null;
  return { table: 'pvp_matches', rulesVersion };
}

/** Link a committed virtual PvP posting to the source match and bank without resuming gameplay. */
export async function resolvePvpPosting(db: PostgresDatabase, entry: PvpPostingKey): Promise<PvpPostingResolution | null> {
  if (!/^[1-9][0-9]{0,18}$/.test(entry.rowId) || BigInt(entry.rowId) > 9223372036854775807n ||
      !gameAccountId(entry.accountId) || !isPvpMoneyGame(entry.gameId)) return null;
  const [, matchId, stage] = /^pvp:([^:]+):(hold|final)$/.exec(entry.operationId) ?? [];
  if (!gameAccountId(matchId) || (stage !== 'hold' && stage !== 'final')) return null;

  const row = await db.prepare(`
    SELECT l.entry_type, b.state AS bank_state, b.winner_id, b.reason, b.fee_units::text AS fee_units,
      b.stake_units::text AS bank_stake_units,
      h.state AS hold_state, h.stake_units::text AS stake_units, h.reserved_units::text AS capacity_units,
      m.payload AS match_payload, m.creator_id, m.opponent_id, m.status AS match_status,
      c.accounts AS combat_accounts, c.stake_units::text AS combat_stake_units
    FROM demo_ledger l
    JOIN virtual_pvp_banks b ON b.match_id=? AND l.source='pvp:'||b.game_id
    JOIN virtual_pvp_holds h ON h.match_id=b.match_id AND h.account_id=l.account_id
    LEFT JOIN pvp_matches m ON m.id=b.match_id AND b.game_id<>'mortal-kombat'
    LEFT JOIN combat_matches c ON c.id=b.match_id AND b.game_id='mortal-kombat'
    WHERE l.id=?::bigint AND l.account_id=? AND l.operation_id=? AND b.game_id=?
  `).get(matchId, entry.rowId, entry.accountId, entry.operationId, entry.gameId);
  if (!row || (stage === 'hold' ? row.entry_type !== 'bet' : !['win', 'refund'].includes(row.entry_type))) return null;

  const ref = (table: string, rowId: string): AuditSourceRef => ({ namespace: db.schema + '.' + table, rowId });
  const bank = ref('virtual_pvp_banks', matchId);
  const hold = ref('virtual_pvp_holds', JSON.stringify([matchId, entry.accountId]));
  const match = gameplayMatch(row, matchId, entry);
  const entity = {
    category: 'pvp', kind: 'match', gameId: entry.gameId, modeId: 'stake',
    rulesVersion: match?.rulesVersion ?? null, source: match ? ref(match.table, matchId) : bank, ticketId: null,
  } as const;
  if (!isAuditEntityRef(entity)) return null;

  // Shared ledger keys do not identify a particular client request. Only explicit server completion reasons fix the origin.
  const origin = stage === 'final' && automaticReasons.has(row.reason) ? 'automatic' : 'unknown';
  return {
    source: ref('demo_ledger', entry.rowId), entity, stage, operation: null, origin,
    coverage: entity.rulesVersion === null ? 'partial' : 'complete',
    openingObligationKey: { sourceNamespace: hold.namespace, accountId: entry.accountId, entityId: matchId },
    hold: { source: hold, state: row.hold_state, stakeUnits: row.stake_units, payoutCapacityUnits: row.capacity_units },
    bank: {
      source: bank, state: row.bank_state, stakeUnits: row.bank_stake_units,
      winnerId: row.winner_id, reason: row.reason, feeUnits: row.fee_units,
    },
  };
}
