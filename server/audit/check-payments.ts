import { identifier, type PostgresDatabase } from '../database';
import type { AuditSourceRef } from './contract';

type Status = 'match' | 'mismatch' | 'insufficient-data';
type PaymentCheck = {
  status: Status;
  stage: 'unobserved' | 'requested' | 'request-rejected' | 'reserved' | 'confirmed' | 'refunded' | 'adjusted' | 'inconsistent';
  reason: string;
  command: AuditSourceRef | null;
  postings: AuditSourceRef[];
  confirmedWithdrawalUnits: string | null;
};
type Key = { datasetId: string; accountId: string; operationId: string; kind: 'withdrawal' | 'adjustment' };
type Leg = { id: string; entry_key: string; available: string; reserved: string; counterparty: string };

function unavailable(reason: string): PaymentCheck {
  return { status: 'insufficient-data', stage: 'unobserved', reason, command: null, postings: [],
    confirmedWithdrawalUnits: null };
}

/** Reconcile one real payment operation from its canonical source, with no reads of provider payloads or mirrors. */
export async function reconcileStoredPayment(db: PostgresDatabase, schema: string, key: Key): Promise<PaymentCheck> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid audit payment schema');
  const { datasetId, accountId, operationId, kind } = key;
  const ledger = schema + '.crypto_ledger';
  const prefix = identifier(schema) + '.';
  try {
    return await db.transaction(async () => {
      const dataset = await db.prepare(`SELECT d.sealed_at_ms FROM audit_datasets d
        JOIN audit_dataset_sources s ON s.dataset_id=d.id WHERE d.id=? AND s.source_namespace=?`).get(datasetId, ledger);
      if (!dataset) return unavailable('dataset-source-unavailable');
      const legs = await db.prepare(`SELECT r.source_row_id::text AS id,l.entry_key,l.available_delta::text AS available,
        l.reserved_delta::text AS reserved,l.counterparty_delta::text AS counterparty
        FROM audit_posting_refs r LEFT JOIN ${prefix}crypto_ledger l
          ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
        WHERE r.dataset_id=? AND r.source_namespace=? AND r.account_id=? AND r.operation_id=?
        ORDER BY r.source_row_id LIMIT 501`).all(datasetId, ledger, accountId, operationId) as Leg[];
      if (legs.length > 500) return unavailable('payment-posting-limit');
      if (legs.some(leg => leg.entry_key === null)) return unavailable('canonical-posting-unavailable');
      const tag = kind === 'withdrawal' ? ['reserve:', 'paid:', 'refund:'] : ['adjustment:'];
      const rows = legs.filter(leg => tag.some(value => leg.entry_key.startsWith(value)));
      const postings = rows.map(row => ({ namespace: ledger, rowId: row.id }));
      const result = (status: Status, stage: PaymentCheck['stage'], reason: string, command: AuditSourceRef | null,
        confirmedWithdrawalUnits: string | null = null): PaymentCheck =>
        ({ status, stage, reason, command, postings, confirmedWithdrawalUnits });
      if (kind === 'adjustment') {
        if (!rows.length) return unavailable('adjustment-not-captured');
        const adjustment = await db.prepare(`SELECT delta_units::text AS delta FROM ${prefix}finance_adjustments
          WHERE id=? AND player_id=?`).get(operationId, accountId);
        if (!adjustment) return result('mismatch', 'inconsistent', 'adjustment-command-missing', null);
        const command = { namespace: schema + '.finance_adjustments', rowId: operationId };
        const matches = rows.length === 1 && matchesLeg(rows[0], 'adjustment:' + operationId, BigInt(adjustment.delta), 0n);
        return matches ? result('match', 'adjusted', 'single-adjustment-posting', command)
          : result('mismatch', 'inconsistent', 'adjustment-posting-mismatch', command);
      }
      const namespace = schema + '.crypto_operations';
      const opening = await db.prepare(`SELECT principal_units::text AS units FROM audit_opening_obligations
        WHERE dataset_id=? AND source_namespace=? AND account_id=? AND entity_id=?`).get(datasetId, namespace, accountId, operationId);
      if (!rows.length && !opening) {
        const attempt = await db.prepare(`SELECT count(*)::int AS count,bool_and(rejected) AS rejected FROM (
          SELECT payload->>'decision'='rejected' AS rejected FROM audit_evidence
          WHERE dataset_id=? AND kind='attempt' AND account_id=? AND payload->>'operationId'=?
          AND payload->>'route'='/api/crypto-wallet/withdrawals' LIMIT 501) attempts`)
          .get(datasetId, accountId, operationId);
        if (attempt?.count > 500) return unavailable('payment-attempt-limit');
        return attempt?.count ? result('insufficient-data', attempt.rejected ? 'request-rejected' : 'requested',
          'request-without-captured-reserve', null)
          : unavailable('withdrawal-not-observed');
      }
      const operation = await db.prepare(`SELECT amount_units::text AS units,state FROM ${prefix}crypto_operations
        WHERE id=? AND account_id=? AND kind='withdrawal'`).get(operationId, accountId);
      if (!operation) return result('mismatch', 'inconsistent', 'withdrawal-command-missing', null);
      const command = { namespace, rowId: operationId };
      const units = BigInt(operation.units);
      const reserve = rows.find(row => row.entry_key === 'reserve:' + operationId);
      const paid = rows.find(row => row.entry_key === 'paid:' + operationId);
      const refund = rows.find(row => row.entry_key === 'refund:' + operationId);
      if (rows.length !== [reserve, paid, refund].filter(Boolean).length ||
        (reserve && !matchesLeg(reserve, reserve.entry_key, -units, units)) ||
        (paid && !matchesLeg(paid, paid.entry_key, 0n, -units)) ||
        (refund && !matchesLeg(refund, refund.entry_key, units, -units)) ||
        (paid && refund) || (opening && reserve) || (opening?.units != null && opening.units !== operation.units) ||
        (reserve && (paid || refund) && BigInt(reserve.id) >= BigInt((paid ?? refund)!.id))) {
        return result('mismatch', 'inconsistent', 'withdrawal-legs-inconsistent', command);
      }
      const stage = paid ? 'confirmed' : refund ? 'refunded' : reserve || opening ? 'reserved' : 'requested';
      const confirmed = paid ? units.toString() : null;
      if (dataset.sealed_at_ms === null &&
        ((operation.state === 'finished') !== !!paid || (operation.state === 'refunded') !== !!refund)) {
        return result('mismatch', 'inconsistent', 'withdrawal-state-disagrees-with-ledger', command, confirmed);
      }
      if (!reserve && opening?.units == null) {
        return result('insufficient-data', stage, 'opening-reserve-unconfirmed', command, confirmed);
      }
      return result('match', stage, 'canonical-withdrawal-legs', command, confirmed);
    }, { readOnly: true });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && (code.startsWith('08') || ['42P01', '3F000', '42501', 'ECONNREFUSED', 'ECONNRESET'].includes(code))) {
      return unavailable('source-unavailable');
    }
    throw error;
  }
}

function matchesLeg(row: Leg, key: string, available: bigint, reserved: bigint) {
  return row.entry_key === key && BigInt(row.available) === available && BigInt(row.reserved) === reserved &&
    BigInt(row.counterparty) === -available - reserved;
}
