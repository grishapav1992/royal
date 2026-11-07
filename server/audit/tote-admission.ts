import { identifier, type PostgresDatabase } from '../database';
import type { FlagToteAdmission } from '../flagTote';
import { TOTE_GAME } from '../../src/shared/flagTote';
import { TOTE_ADMISSION_CLOCK } from './check-tote';
import { AUDIT_SCHEMA_VERSION, type AuditScope } from './contract';
import { AuditEvidence } from './evidence';

/** Admit clocks only after the source commits, and only against an exact captured debit. */
export function toteAdmissionWriter(audit: PostgresDatabase, scope: AuditScope, gameSchema: string) {
  const game = identifier(gameSchema);
  const namespace = gameSchema + '.demo_ledger';
  const evidence = new AuditEvidence(audit, audit.schema);
  const queue: FlagToteAdmission[] = [];
  const capacity = 128;
  let accepting = true, lost = 0, drain: Promise<void> | undefined;
  const gap = () => {
    lost++;
    if (lost === 1 || lost % capacity === 0) {
      console.warn(JSON.stringify({ event: 'audit-tote-admission-gap', datasetId: scope.datasetId, missingCount: lost }));
    }
  };

  const persist = async (entry: FlagToteAdmission) => {
    const postings = await audit.prepare(`SELECT l.id::text AS id,t.sequence::text AS sequence
      FROM ${game}.flag_tote_tickets t JOIN ${game}.demo_ledger l
        ON l.account_id=t.account_id AND l.operation_id=? AND l.source=? AND l.entry_type='bet'
        AND l.amount_units=-t.stake_units
      JOIN audit_posting_refs r ON r.dataset_id=? AND r.source_namespace=? AND r.source_row_id=l.id
        AND r.account_id=l.account_id AND r.operation_id=l.operation_id AND r.occurred_at_ms=l.created_at
      WHERE t.id=? AND t.round_id=? AND t.account_id=? AND t.country=? AND t.stake_units=?::bigint LIMIT 2`)
      .all(TOTE_GAME + ':' + entry.id, TOTE_GAME, scope.datasetId, namespace, entry.id, entry.roundId,
        entry.accountId, entry.country, entry.stakeUnits);
    if (postings.length !== 1) { gap(); return; }
    const [{ id, sequence }] = postings;
    await evidence.record({
      schemaVersion: AUDIT_SCHEMA_VERSION, type: 'event', scope, occurredAtMs: entry.admittedAtMs,
      eventId: TOTE_ADMISSION_CLOCK + ':' + entry.id, sequence,
      accountId: entry.accountId, operationId: entry.id, event: 'accepted', reasonCode: TOTE_ADMISSION_CLOCK,
      entity: { category: 'totalizator', kind: 'pool', gameId: TOTE_GAME, modeId: 'pool', rulesVersion: String(entry.rulesVersion),
        source: { namespace: gameSchema + '.flag_tote_rounds', rowId: entry.roundId }, ticketId: entry.id },
      postings: [{ namespace, rowId: id }],
    });
  };

  function schedule() {
    if (drain || !queue.length) return;
    drain = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      while (queue.length) {
        const entry = queue.shift()!;
        try { await persist(entry); } catch { gap(); }
      }
    }).finally(() => { drain = undefined; schedule(); });
  }

  return {
    record(entry: FlagToteAdmission) {
      if (!accepting || queue.length >= capacity) { gap(); return; }
      queue.push(entry);
      schedule();
    },
    async stop() {
      accepting = false;
      while (drain) await drain;
    },
  };
}
