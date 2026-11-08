import { COMBAT_USDT_STAKES } from '../../src/shared/combatEscrow';
import { gameAccountId } from '../../src/shared/nileWallet';
import { pvpPayout, validVirtualPvpStake } from '../../src/shared/pvp';
import { tsuDuelPayout, validTsuDuelStake } from '../../src/shared/tsuDuel';
import { identifier, type DatabaseRow, type PostgresDatabase } from '../database';
import { isPvpMoneyGame } from '../finance/pvp-money';
import type { AuditScope, AuditSourceRef } from './contract';
import { registeredPvpRulesVersion } from './mode-registry';

type State = 'open' | 'settled' | 'refunded';
type HoldState = 'held' | 'settled' | 'refunded';
type FindingCode = 'source-unavailable' | 'terminal-not-captured' | 'match-unconfirmed' | 'rules-unsupported'
  | 'capture-mismatch' | 'participant-mismatch' | 'outcome-mismatch' | 'hold-state-mismatch' | 'missing-stake'
  | 'duplicate-stake' | 'stake-mismatch' | 'capacity-mismatch' | 'unexpected-credit' | 'missing-credit'
  | 'duplicate-credit' | 'credit-mismatch' | 'commission-mismatch' | 'bank-not-conserved';
type Finding = {
  code: FindingCode;
  severity: 'mismatch' | 'gap';
  source: AuditSourceRef | null;
  accountId: string | null;
};
type Posting = { source: AuditSourceRef; stage: 'hold' | 'final'; entryType: string; units: string };
type Participant = {
  accountId: string;
  hold: { source: AuditSourceRef; stakeUnits: string; payoutCapacityUnits: string; state: HoldState | null } | null;
  openingStakeUnits: string | null;
  postings: Posting[];
};
type Bank = {
  source: AuditSourceRef;
  gameId: string;
  moneyRulesVersion: 'virtual-usdt-pvp-v1';
  gameRulesVersion: string | null;
  state: State | null;
  stakeUnits: string;
  feeUnits: string | null;
  winnerId: string | null;
  reason: string | null;
};
type Totals = { stakeUnits: string; payoutUnits: string; refundUnits: string; feeUnits: string; remainderUnits: string };
export type PvpMatchCheck = {
  status: 'not-captured' | 'insufficient-data' | 'pending' | 'match' | 'mismatch';
  scope: AuditScope | null;
  matchId: string;
  bank: Bank | null;
  participants: Participant[];
  totals: Totals | null;
  findings: Finding[];
};

const settledReasons = new Set(['win', 'resign', 'timeout', 'disconnect']);
const refundReasons = new Set(['draw', 'cancel', 'expired', 'server', 'timeout']);
const gameStates = new Set(['open', 'arriving', 'playing', 'finished', 'cancelled']);

function source(namespace: string, rowId: string): AuditSourceRef {
  return { namespace, rowId };
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function moneyTerms(gameId: string, stakeUnits: string) {
  if (!isPvpMoneyGame(gameId)) return null;
  const micro = String(BigInt(stakeUnits) * 10_000n);
  if (gameId === 'mortal-kombat' && !COMBAT_USDT_STAKES.some(stake => BigInt(micro) === BigInt(stake) * 1_000_000n)) return null;
  const payout = gameId === 'tsu-e-fa' && validTsuDuelStake(micro) ? tsuDuelPayout(micro)
    : validVirtualPvpStake(micro) ? pvpPayout(micro) : null;
  return payout && { payout: BigInt(payout.payoutUnits) / 10_000n, fee: BigInt(payout.feeUnits) / 10_000n };
}

function gameplay(row: DatabaseRow, matchId: string, gameSchema: string) {
  const micro = String(BigInt(row.stake_units) * 10_000n);
  if (row.game_id === 'mortal-kombat') {
    const accounts = parsed(row.combat_accounts);
    if (!Array.isArray(accounts) || accounts.length !== 2 || !accounts.every(gameAccountId) || accounts[0] === accounts[1]) return null;
    return {
      source: source(gameSchema + '.combat_matches', matchId), accounts, status: row.combat_state as string,
      winner: row.combat_winner || null, reason: null, stakeMatches: row.combat_stake === micro, version: row.combat_rules_version as unknown,
      feeMicro: row.combat_fee as string, payoutMicro: row.combat_payout as string,
    };
  }
  const challenge = object(object(parsed(row.pvp_payload))?.challenge);
  if (!challenge || challenge.id !== matchId || challenge.gameId !== row.game_id || challenge.mode === 'free' ||
      challenge.creatorId !== row.creator_id || challenge.opponentId !== row.opponent_id ||
      challenge.status !== row.pvp_status || !gameStates.has(row.pvp_status) || !gameAccountId(row.creator_id) ||
      (row.opponent_id !== null && (!gameAccountId(row.opponent_id) || row.creator_id === row.opponent_id))) return null;
  return {
    source: source(gameSchema + '.pvp_matches', matchId),
    accounts: row.opponent_id === null ? [row.creator_id as string] : [row.creator_id as string, row.opponent_id as string],
    status: row.pvp_status as string, winner: challenge.winnerId, reason: challenge.reason,
    stakeMatches: challenge.stakeUnits === micro, version: challenge.rulesVersion,
    feeMicro: null, payoutMicro: null,
  };
}

function gameplayState(status: string, winner: unknown): State | null {
  if (['active', 'open', 'arriving', 'playing'].includes(status)) return 'open';
  if (status === 'settled') return 'settled';
  if (status === 'refunded' || status === 'cancelled') return 'refunded';
  if (status === 'finished') return winner ? 'settled' : 'refunded';
  return null;
}

function unavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' &&
    (code.startsWith('08') || ['42P01', '3F000', '42501', 'ECONNREFUSED', 'ECONNRESET'].includes(code));
}

/** Reconcile one captured match against both participants in one read-only PostgreSQL snapshot. */
export async function reconcileStoredPvpMatch(
  audit: PostgresDatabase, game: Pick<PostgresDatabase, 'schema'>, datasetId: string, matchId: string,
): Promise<PvpMatchCheck> {
  const result: PvpMatchCheck = {
    status: 'not-captured', scope: null, matchId, bank: null, participants: [], totals: null, findings: [],
  };
  if (!gameAccountId(datasetId) || !gameAccountId(matchId)) return result;
  const ledger = game.schema + '.demo_ledger';
  const holds = game.schema + '.virtual_pvp_holds';
  const prefix = identifier(game.schema) + '.';
  const holdKey = 'pvp:' + matchId + ':hold';
  const finalKey = 'pvp:' + matchId + ':final';
  const bankSource = source(game.schema + '.virtual_pvp_banks', matchId);
  const issue = (code: FindingCode, severity: Finding['severity'], ref = bankSource, accountId: string | null = null) =>
    result.findings.push({ code, severity, source: ref, accountId });

  try {
    return await audit.transaction(async () => {
      const dataset = await audit.prepare(`
        SELECT d.environment, d.sealed_at_ms FROM audit_datasets d
        JOIN audit_dataset_sources s ON s.dataset_id=d.id
        WHERE d.id=? AND s.source_namespace=?
      `).get(datasetId, ledger);
      if (!dataset) return result;
      result.scope = { datasetId, environment: dataset.environment };
      const entries = await audit.prepare(`
        SELECT r.source_row_id::text AS row_id, r.account_id, r.operation_id, r.occurred_at_ms::text AS occurred_at_ms,
          l.account_id AS actual_account_id, l.operation_id AS actual_operation_id, l.created_at::text AS actual_at_ms,
          l.source AS actual_source, l.entry_type, l.amount_units::text AS units
        FROM audit_posting_refs r LEFT JOIN ${prefix}demo_ledger l ON l.id=r.source_row_id
        WHERE r.dataset_id=? AND r.source_namespace=? AND r.operation_id IN (?,?) ORDER BY r.source_row_id
      `).all(datasetId, ledger, holdKey, finalKey);
      const opening = await audit.prepare(`
        SELECT account_id, principal_units::text AS units FROM audit_opening_obligations
        WHERE dataset_id=? AND source_namespace=? AND entity_id=? AND state='held'
        ORDER BY account_id
      `).all(datasetId, holds, matchId);
      if (!entries.length && !opening.length) return result;
      const row = await audit.prepare(`
        SELECT b.game_id,b.state,b.winner_id,b.reason,b.stake_units::text,b.fee_units::text,
          m.payload AS pvp_payload,m.status AS pvp_status,m.creator_id,m.opponent_id,
          c.accounts AS combat_accounts,c.state AS combat_state,c.winner AS combat_winner,
          c.stake_units::text AS combat_stake,c.fee_units::text AS combat_fee,c.payout_units::text AS combat_payout,
          to_jsonb(c)->'rules_version' AS combat_rules_version
        FROM ${prefix}virtual_pvp_banks b
        LEFT JOIN ${prefix}pvp_matches m ON m.id=b.match_id AND b.game_id<>'mortal-kombat'
        LEFT JOIN ${prefix}combat_matches c ON c.id=b.match_id AND b.game_id='mortal-kombat'
        WHERE b.match_id=?
      `).get(matchId);
      if (!row) {
        issue('source-unavailable', 'gap');
        return { ...result, status: 'insufficient-data' };
      }

      const storedState = row.state as State;
      const sealedWithoutFinal = dataset.sealed_at_ms !== null && !entries.some(entry => entry.operation_id === finalKey);
      const hiddenTerminal = sealedWithoutFinal && storedState !== 'open';
      const state = hiddenTerminal ? null : storedState;
      const savedMatch = gameplay(row, matchId, game.schema);
      const match = sealedWithoutFinal ? null : savedMatch;
      const version = savedMatch?.stakeMatches ? registeredPvpRulesVersion(row.game_id, savedMatch.version) : null;
      result.bank = {
        source: bankSource, gameId: row.game_id, moneyRulesVersion: 'virtual-usdt-pvp-v1',
        gameRulesVersion: version, state, stakeUnits: row.stake_units,
        feeUnits: hiddenTerminal ? null : row.fee_units, winnerId: hiddenTerminal ? null : row.winner_id,
        reason: hiddenTerminal ? null : row.reason,
      };

      const sourceHolds = await audit.prepare(`
        SELECT account_id,state,stake_units::text,reserved_units::text
        FROM ${prefix}virtual_pvp_holds WHERE match_id=? ORDER BY account_id
      `).all(matchId);
      const expectedTerms = moneyTerms(row.game_id, row.stake_units);
      const accounts = new Set([...opening, ...entries, ...(sealedWithoutFinal ? [] : sourceHolds)].map(item => String(item.account_id)));
      const present = new Map<string, Participant>();
      const missingRows = new Set<string>();
      for (const accountId of [...accounts].sort()) {
        const hold = sourceHolds.find(item => item.account_id === accountId);
        present.set(accountId, {
          accountId,
          hold: hold ? {
            source: source(holds, JSON.stringify([matchId, accountId])), state: hiddenTerminal ? null : hold.state,
            stakeUnits: hold.stake_units, payoutCapacityUnits: hold.reserved_units,
          } : null,
          openingStakeUnits: opening.find(item => item.account_id === accountId)?.units ?? null, postings: [],
        });
      }
      result.participants = [...present.values()];
      for (const entry of entries) {
        const ref = source(ledger, entry.row_id);
        const stage = entry.operation_id === holdKey ? 'hold' : 'final';
        if (entry.actual_account_id === null || entry.actual_account_id !== entry.account_id ||
            entry.actual_operation_id !== entry.operation_id || entry.actual_at_ms !== entry.occurred_at_ms ||
            entry.actual_source !== 'pvp:' + row.game_id) {
          issue(entry.actual_account_id === null ? 'source-unavailable' : 'capture-mismatch',
            entry.actual_account_id === null ? 'gap' : 'mismatch', ref, entry.account_id);
          missingRows.add(entry.account_id + ':' + stage);
          continue;
        }
        present.get(entry.account_id)!.postings.push({ source: ref, stage, entryType: entry.entry_type, units: entry.units });
      }
      if (hiddenTerminal) issue('terminal-not-captured', 'gap');

      if (!expectedTerms || savedMatch?.stakeMatches && savedMatch.version != null && version === null) issue('rules-unsupported', 'gap');
      if (!match && !sealedWithoutFinal) issue('match-unconfirmed', 'gap');
      if (match) {
        if (gameplayState(match.status, match.winner) !== state || match.winner !== row.winner_id ||
            (match.reason !== null && match.reason !== row.reason)) issue('outcome-mismatch', 'mismatch', match.source);
        if (!match.stakeMatches) issue('stake-mismatch', 'mismatch', match.source);
        if (match.accounts.length !== accounts.size || match.accounts.some(account => !accounts.has(account))) {
          issue('participant-mismatch', 'mismatch', match.source);
        }
      }
      const winner = row.winner_id as string | null;
      const fee = hiddenTerminal ? null : BigInt(row.fee_units);
      if (accounts.size < 1 || accounts.size > 2 || (state === 'settled' && (accounts.size !== 2 || !winner || !accounts.has(winner)))) {
        issue('participant-mismatch', 'mismatch');
      }
      if ((state === 'open' && (winner !== null || row.reason !== '')) ||
          (state === 'settled' && !settledReasons.has(row.reason)) ||
          (state === 'refunded' && (winner !== null || !refundReasons.has(row.reason) || row.reason === 'draw' && accounts.size !== 2))) {
        issue('outcome-mismatch', 'mismatch');
      }
      const expectedFee = state === 'settled' ? expectedTerms?.fee : 0n;
      if (fee !== null && ((expectedFee !== undefined && fee !== expectedFee) ||
          (match?.feeMicro != null && BigInt(match.feeMicro) !== fee * 10_000n))) issue('commission-mismatch', 'mismatch');
      if (match?.payoutMicro != null && (state !== 'settled' || expectedTerms) &&
          BigInt(match.payoutMicro) !== (state === 'settled' ? expectedTerms!.payout : 0n) * 10_000n) {
        issue('credit-mismatch', 'mismatch', match.source);
      }

      let stakeTotal = 0n, payouts = 0n, refunds = 0n;
      let completeAmounts = missingRows.size === 0;
      for (const participant of result.participants) {
        const { accountId, hold, openingStakeUnits, postings } = participant;
        const debits = postings.filter(posting => posting.stage === 'hold');
        const credits = postings.filter(posting => posting.stage === 'final');
        const holdRef = hold?.source ?? bankSource;
        if (!hold) {
          issue('participant-mismatch', 'mismatch', holdRef, accountId);
          completeAmounts = false;
        } else {
          const expectedHold = state === 'open' ? 'held' : state;
          if (state !== null && hold.state !== expectedHold) issue('hold-state-mismatch', 'mismatch', holdRef, accountId);
          if (hold.stakeUnits !== row.stake_units) issue('stake-mismatch', 'mismatch', holdRef, accountId);
          if (expectedTerms && BigInt(hold.payoutCapacityUnits) !== expectedTerms.payout) {
            issue('capacity-mismatch', 'mismatch', holdRef, accountId);
          }
        }
        if (debits.length > 1 || (debits.length > 0 && openingStakeUnits !== null)) {
          issue('duplicate-stake', 'mismatch', debits.at(-1)?.source ?? holdRef, accountId);
        }
        if (openingStakeUnits !== null) {
          if (hold && openingStakeUnits !== hold.stakeUnits) issue('stake-mismatch', 'mismatch', holdRef, accountId);
          stakeTotal += BigInt(openingStakeUnits);
        }
        for (const debit of debits) {
          if (debit.entryType !== 'bet' || (hold && BigInt(debit.units) !== -BigInt(hold.stakeUnits))) {
            issue('stake-mismatch', 'mismatch', debit.source, accountId);
          }
          stakeTotal -= BigInt(debit.units);
        }
        if (!debits.length && openingStakeUnits === null) {
          if (!missingRows.has(accountId + ':hold')) issue('missing-stake', 'gap', holdRef, accountId);
          completeAmounts = false;
        }

        const expectedCredit = state === 'refunded' ? 'refund' : state === 'settled' && winner === accountId ? 'win' : null;
        const expectedUnits = expectedCredit === 'refund' && hold ? BigInt(hold.stakeUnits) : expectedTerms?.payout;
        if (credits.length > 1) issue('duplicate-credit', 'mismatch', credits.at(-1)!.source, accountId);
        if (!credits.length && expectedCredit && !missingRows.has(accountId + ':final')) {
          issue('missing-credit', 'mismatch', holdRef, accountId);
        }
        for (const credit of credits) {
          if (!expectedCredit) issue('unexpected-credit', 'mismatch', credit.source, accountId);
          else if (credit.entryType !== expectedCredit || (expectedUnits !== undefined && BigInt(credit.units) !== expectedUnits)) {
            issue('credit-mismatch', 'mismatch', credit.source, accountId);
          }
          if (credit.entryType === 'win') payouts += BigInt(credit.units);
          else if (credit.entryType === 'refund') refunds += BigInt(credit.units);
        }
      }
      if (completeAmounts && fee !== null) {
        const remainder = stakeTotal - payouts - refunds - fee;
        result.totals = {
          stakeUnits: String(stakeTotal), payoutUnits: String(payouts), refundUnits: String(refunds),
          feeUnits: String(fee), remainderUnits: String(remainder),
        };
        if (state !== 'open' && remainder !== 0n) issue('bank-not-conserved', 'mismatch');
      }
      result.status = result.findings.some(finding => finding.severity === 'mismatch') ? 'mismatch'
        : result.findings.length ? 'insufficient-data' : state === 'open' ? 'pending' : 'match';
      return result;
    }, { readOnly: true });
  } catch (error) {
    if (!unavailable(error)) throw error;
    return { ...result, status: 'insufficient-data', bank: null, participants: [], totals: null,
      findings: [{ code: 'source-unavailable', severity: 'gap', source: null, accountId: null }] };
  }
}
