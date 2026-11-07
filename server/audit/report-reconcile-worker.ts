import type { PostgresDatabase } from '../database';
import type { AuditSourceSchemas } from './datasets';
import { buildAuditReconciliation } from './report-reconcile-core';
import { buildAuditPeriodReconciliation } from './report-reconcile-period-core';
import { AUDIT_RECONCILE_MAX_BYTES } from './report-reconcile-source';
import { readLinkedAuditSignals, signalSourceUnavailable } from './report-reconcile-signals';

type Claim = {
  request_id: string; dataset_id: string; source_namespace: string; posting_id: string | null;
  from_ms: string | null; to_ms: string | null; account_id: string | null; claim: string;
};
const leaseSeconds = 120;

async function postingResult(audit: PostgresDatabase, sources: AuditSourceSchemas, row: Claim & { posting_id: string }, signal: AbortSignal) {
  const target = { namespace: row.source_namespace, rowId: row.posting_id };
  const report = await buildAuditReconciliation(audit, sources, row.dataset_id, target, signal);
  if (report.status !== 'ready') return { payload: report, namespaces: [target.namespace] };
  const linked = await audit.transaction(async () => {
    await audit.exec("SET LOCAL statement_timeout = '3s'");
    return readLinkedAuditSignals(audit, report, sources, signal);
  }, { readOnly: true }).catch(error => {
    if (!signalSourceUnavailable(error)) throw error;
    return { signals: [], clipped: false, sourceUnavailable: true as const };
  });
  const { findings, coverage, requiredSources, ...identity } = report;
  const gap = 'sourceUnavailable' in linked ? 'signal-source-unavailable' : linked.clipped ? 'signal-scan-limit' : null;
  const gaps = gap ? [...coverage, { rule: 'RISK-05', code: gap, sources: [target] }] : coverage;
  return { payload: { ...identity, financialErrors: findings.filter(item => item.status === 'mismatch'),
    checks: findings.filter(item => item.status !== 'mismatch'), coverage: gaps,
    signals: linked.signals.map(({ sources: _sources, ...entry }) => entry) },
  namespaces: [...new Set([target.namespace, ...requiredSources])].sort() };
}

async function periodResult(audit: PostgresDatabase, sources: AuditSourceSchemas, row: Claim, signal: AbortSignal) {
  if (row.from_ms === null || row.to_ms === null || row.account_id === null) throw new Error('Invalid audit period claim');
  const report = await buildAuditPeriodReconciliation(audit, sources, { datasetId: row.dataset_id,
    sourceNamespace: row.source_namespace, fromMs: Number(row.from_ms), toMs: Number(row.to_ms),
    accountId: row.account_id || null }, signal);
  if (!('requiredSources' in report)) return { payload: report, namespaces: [row.source_namespace] };
  const { requiredSources, ...payload } = report;
  return { payload, namespaces: [...new Set([row.source_namespace, ...requiredSources])].sort() };
}

/** Claims one bounded request. The token prevents a stalled worker overwriting a reclaimed result. */
export async function processAuditReconcileRequest(audit: PostgresDatabase, sources: AuditSourceSchemas, abort?: AbortSignal) {
  abort?.throwIfAborted();
  const row = await audit.prepare(`WITH next_request AS (
      SELECT request_id FROM audit_reconcile_requests
      WHERE status='queued' OR (status='running' AND lease_until<=pg_catalog.clock_timestamp())
      ORDER BY requested_at,dataset_id,source_namespace,posting_id,request_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE audit_reconcile_requests r SET status='running',claim=pg_catalog.gen_random_uuid(),
      lease_until=pg_catalog.clock_timestamp()+interval '${leaseSeconds} seconds'
    FROM next_request n WHERE r.request_id=n.request_id
    RETURNING r.request_id::text,r.dataset_id,r.source_namespace,r.posting_id::text,r.from_ms::text,r.to_ms::text,r.account_id,r.claim`).get() as Claim | undefined;
  if (!row) return 'idle' as const;
  const address = [row.request_id, row.claim];
  const timeout = AbortSignal.timeout(35_000);
  const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
  try {
    const { payload, namespaces } = row.posting_id === null
      ? await periodResult(audit, sources, row, signal)
      : await postingResult(audit, sources, { ...row, posting_id: row.posting_id }, signal);
    signal.throwIfAborted();
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded, 'utf8') > AUDIT_RECONCILE_MAX_BYTES || namespaces.length > 8) {
      throw new Error('Audit reconciliation result limit');
    }
    const write = await audit.prepare(`UPDATE audit_reconcile_requests SET status='ready',finished_at=pg_catalog.clock_timestamp(),
        claim=NULL,lease_until=NULL,result=?::jsonb,required_sources=?::text[]
      WHERE request_id=? AND claim=? AND status='running'
        AND lease_until>pg_catalog.clock_timestamp()`).run(encoded, namespaces, ...address);
    return write.changes ? 'ready' as const : 'lease-lost' as const;
  } catch {
    const cancelled = abort?.aborted ?? false;
    const write = await audit.prepare(`UPDATE audit_reconcile_requests
      SET status=?,finished_at=CASE WHEN ?::boolean THEN NULL ELSE pg_catalog.clock_timestamp() END,claim=NULL,lease_until=NULL
      WHERE request_id=? AND claim=? AND status='running'
        AND lease_until>pg_catalog.clock_timestamp()`).run(cancelled ? 'queued' : 'failed', cancelled, ...address);
    return write.changes ? cancelled ? 'cancelled' as const : 'failed' as const : 'lease-lost' as const;
  }
}
