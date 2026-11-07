import type { PostgresDatabase } from '../database';
import { TOTE_GAME, toteUuid } from '../../src/shared/flagTote';
import type { AuditEntityRef, AuditSourceRef } from './contract';
import { auditToteMode } from './mode-registry';

type ToteTicketEvidence = {
  ticketId: string;
  sequence: string;
  country: string;
  stakeUnits: string;
  payoutUnits: string | null;
  /** The retained ticket sequence is authoritative. The ledger time is not the admission decision time. */
  acceptedAtMs: null;
};

export type TotePostingResolution = {
  source: AuditSourceRef;
  entity: AuditEntityRef & { category: 'totalizator' };
  origin: 'command' | 'automatic';
  coverage: 'partial';
  round: { openedAtMs: number; closesAtMs: number; finishesAtMs: number; state: string; potUnits: string; feeUnits: string | null };
  tickets: ToteTicketEvidence[];
};

function feeFromSettlement(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.feeUnits === 'string' && /^(0|[1-9][0-9]*)$/.test(parsed.feeUnits) ? parsed.feeUnits : null;
  } catch {
    return null;
  }
}

/** Resolve per-ticket debits and the single per-account wallet credit from saved pool state. */
export async function resolveTotePosting(db: PostgresDatabase, entry: {
  rowId: string; accountId: string; operationId: string; gameId: string;
}): Promise<TotePostingResolution | null> {
  if (entry.gameId !== TOTE_GAME || !/^[1-9][0-9]{0,18}$/.test(entry.rowId) ||
    BigInt(entry.rowId) > 9223372036854775807n) return null;
  return db.transaction(async () => {
    const posting = await db.prepare(`SELECT entry_type FROM demo_ledger
      WHERE id=? AND account_id=? AND operation_id=? AND source=?`)
      .get(entry.rowId, entry.accountId, entry.operationId, TOTE_GAME);
    if (!posting) return null;
    const ticketId = posting.entry_type === 'bet' && entry.operationId.startsWith('flag-tote:')
      ? entry.operationId.slice('flag-tote:'.length) : null;
    let roundId: string;
    if (ticketId !== null) {
      if (!toteUuid(ticketId)) return null;
      const saved = await db.prepare('SELECT round_id FROM flag_tote_tickets WHERE id=? AND account_id=?').get(ticketId, entry.accountId);
      if (!saved) return null;
      roundId = String(saved.round_id);
    } else {
      const match = /^flag-tote:(ft1-[0-9]{1,16}):final$/.exec(entry.operationId);
      if (!match || !['win', 'refund'].includes(posting.entry_type)) return null;
      roundId = match[1];
    }
    const round = await db.prepare(`SELECT r.rules_version,r.opened_at,r.closes_at,r.finishes_at,r.state,r.settlement,
      COALESCE((SELECT SUM(stake_units) FROM flag_tote_tickets WHERE round_id=r.id),0)::text AS pot_units
      FROM flag_tote_rounds r WHERE r.id=?`).get(roundId);
    if (!round) return null;
    const tickets = await db.prepare(`SELECT id,sequence::text,country,stake_units::text,payout_units::text
      FROM flag_tote_tickets WHERE round_id=? AND account_id=? AND (?::text IS NULL OR id=?)
      ORDER BY sequence`).all(roundId, entry.accountId, ticketId, ticketId);
    if (!tickets.length) return null;
    return {
      source: { namespace: db.schema + '.demo_ledger', rowId: entry.rowId },
      entity: { category: auditToteMode.category, kind: 'pool', gameId: TOTE_GAME, modeId: auditToteMode.modeId,
        rulesVersion: String(round.rules_version), source: { namespace: db.schema + '.flag_tote_rounds', rowId: roundId }, ticketId },
      origin: ticketId ? 'command' : 'automatic', coverage: 'partial',
      round: { openedAtMs: Number(round.opened_at), closesAtMs: Number(round.closes_at), finishesAtMs: Number(round.finishes_at),
        state: String(round.state), potUnits: String(round.pot_units), feeUnits: feeFromSettlement(round.settlement) },
      tickets: tickets.map(ticket => ({ ticketId: String(ticket.id), sequence: String(ticket.sequence), country: String(ticket.country),
        stakeUnits: String(ticket.stake_units), payoutUnits: ticket.payout_units === null ? null : String(ticket.payout_units), acceptedAtMs: null })),
    };
  }, { readOnly: true });
}
