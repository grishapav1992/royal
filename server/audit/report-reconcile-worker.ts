import type { PostgresDatabase } from '../database';
import type { AuditSourceRef } from './contract';
import type { AuditSourceSchemas } from './datasets';
import { buildAuditReconciliation, type ReadyAuditReconciliation } from './report-reconcile-core';
import { AUDIT_RECONCILE_MAX_BYTES } from './report-reconcile-source';
import { riskEvidenceKey } from './risk-rules';
import { AuditRiskSignals } from './risk-store';

type Claim = { dataset_id: string; source_namespace: string; posting_id: string; claim: string };
const scanLimit = 64;
const matchLimit = 16;
const leaseSeconds = 120;

function signalSourceUnavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && (code.startsWith('08') || ['57014','42501','42P01','3F000'].includes(code));
}

async function linkedSignals(audit: PostgresDatabase, report: ReadyAuditReconciliation, sources: AuditSourceSchemas, signal: AbortSignal) {
  // The implemented rules use this one canonical wallet. Check every attached posting again before projecting signal metadata.
  const namespace = sources.game + '.demo_ledger';
  if (report.anchor.namespace !== namespace) return { signals: [], clipped: false };
  const rows = await audit.prepare(`SELECT signal_key FROM audit_risk_signals
    WHERE dataset_id=? AND status='observed' AND as_of_ms>=? AND
      pg_catalog.jsonb_exists(signal#>'{input,subject,accountIds}',?)
    ORDER BY as_of_ms DESC,signal_key LIMIT ?`)
    .all(report.scope.datasetId, report.occurredAtMs, report.accountId, scanLimit + 1);
  const storage = new AuditRiskSignals(audit);
  const evidenceKey = (source: AuditSourceRef) => riskEvidenceKey({
    kind: 'posting', source, accountId: null, operationId: null, occurredAtMs: 0,
  });
  const known = new Set([report.anchor, ...report.evidence].filter(source => source.namespace === namespace).map(evidenceKey));
  const signals = [];
  let clipped = rows.length > scanLimit;
  for (const row of rows.slice(0, scanLimit)) {
    signal.throwIfAborted();
    const current = await storage.read(report.scope, row.signal_key);
    if (!current || current.signal.status !== 'observed' || current.signal.input.asset?.contour !== 'virtual') continue;
    const entries = current.signal.input.observations;
    const refs = entries.flatMap(item => [item.primary, ...item.supporting]).filter(item => item.kind === 'posting');
    if (refs.some(ref => ref.source.namespace !== namespace) ||
        !entries.some(item => item.primary.accountId === report.accountId &&
          [item.primary, ...item.supporting].some(ref => known.has(riskEvidenceKey(ref))))) continue;
    if (signals.length === matchLimit) { clipped = true; break; }
    const { key, rule, subject, comparison, input } = current.signal;
    signals.push({ key, ruleId: rule.id, ruleVersion: rule.version, subject, comparison,
      fromMs: input.fromMs, toMs: input.toMs, revision: current.revision,
      review: current.review, reviewAppliesToCurrent: current.reviewAppliesToCurrent });
  }
  return { signals, clipped };
}

/** Claims one bounded request. The token prevents a stalled worker overwriting a reclaimed result. */
export async function processAuditReconcileRequest(audit: PostgresDatabase, sources: AuditSourceSchemas, abort?: AbortSignal) {
  abort?.throwIfAborted();
  const row = await audit.prepare(`WITH next_request AS (
      SELECT dataset_id,source_namespace,posting_id FROM audit_reconcile_requests
      WHERE status='queued' OR (status='running' AND lease_until<=pg_catalog.clock_timestamp())
      ORDER BY requested_at,dataset_id,source_namespace,posting_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE audit_reconcile_requests r SET status='running',claim=pg_catalog.gen_random_uuid(),
      lease_until=pg_catalog.clock_timestamp()+interval '${leaseSeconds} seconds'
    FROM next_request n WHERE r.dataset_id=n.dataset_id AND r.source_namespace=n.source_namespace AND r.posting_id=n.posting_id
    RETURNING r.dataset_id,r.source_namespace,r.posting_id::text,r.claim`).get() as Claim | undefined;
  if (!row) return 'idle' as const;
  const address = [row.dataset_id, row.source_namespace, row.posting_id, row.claim];
  const target = { namespace: row.source_namespace, rowId: row.posting_id };
  const timeout = AbortSignal.timeout(35_000);
  const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
  try {
    const report = await buildAuditReconciliation(audit, sources, row.dataset_id, target, signal);
    let payload: object = report, namespaces = [target.namespace];
    if (report.status === 'ready') {
      const linked = await audit.transaction(async () => {
        await audit.exec("SET LOCAL statement_timeout = '3s'");
        return linkedSignals(audit, report, sources, signal);
      }, { readOnly: true }).catch(error => {
        if (!signalSourceUnavailable(error)) throw error;
        return { signals: [], clipped: false, sourceUnavailable: true as const };
      });
      const { findings, coverage, requiredSources, ...identity } = report;
      const gap = 'sourceUnavailable' in linked ? 'signal-source-unavailable' : linked.clipped ? 'signal-scan-limit' : null;
      const gaps = gap ? [...coverage, { rule: 'RISK-05', code: gap, sources: [target] }] : coverage;
      payload = { ...identity, financialErrors: findings.filter(item => item.status === 'mismatch'),
        checks: findings.filter(item => item.status !== 'mismatch'), coverage: gaps, signals: linked.signals };
      namespaces = [...new Set([target.namespace, ...requiredSources])].sort();
    }
    signal.throwIfAborted();
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded, 'utf8') > AUDIT_RECONCILE_MAX_BYTES || namespaces.length > 8) {
      throw new Error('Audit reconciliation result limit');
    }
    const write = await audit.prepare(`UPDATE audit_reconcile_requests SET status='ready',finished_at=pg_catalog.clock_timestamp(),
        claim=NULL,lease_until=NULL,result=?::jsonb,required_sources=?::text[]
      WHERE dataset_id=? AND source_namespace=? AND posting_id=? AND claim=? AND status='running'
        AND lease_until>pg_catalog.clock_timestamp()`).run(encoded, namespaces, ...address);
    return write.changes ? 'ready' as const : 'lease-lost' as const;
  } catch {
    const cancelled = abort?.aborted ?? false;
    const write = await audit.prepare(`UPDATE audit_reconcile_requests
      SET status=?,finished_at=CASE WHEN ?::boolean THEN NULL ELSE pg_catalog.clock_timestamp() END,claim=NULL,lease_until=NULL
      WHERE dataset_id=? AND source_namespace=? AND posting_id=? AND claim=? AND status='running'
        AND lease_until>pg_catalog.clock_timestamp()`).run(cancelled ? 'queued' : 'failed', cancelled, ...address);
    return write.changes ? cancelled ? 'cancelled' as const : 'failed' as const : 'lease-lost' as const;
  }
}
