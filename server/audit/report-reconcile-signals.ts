import type { PostgresDatabase } from '../database';
import { auditSourceKey, type AuditSourceRef } from './contract';
import type { AuditSourceSchemas } from './datasets';
import type { ReadyAuditReconciliation } from './report-reconcile-core';
import { riskEvidenceKey } from './risk-rules';
import { AuditRiskSignals } from './risk-store';

const scanLimit = 64;
const matchLimit = 16;
export const auditSignalReplayLinkLimit = 16;

export function signalSourceUnavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && (code.startsWith('08') || ['57014','42501','42P01','3F000'].includes(code));
}

export async function readLinkedAuditSignals(audit: PostgresDatabase, report: ReadyAuditReconciliation, sources: AuditSourceSchemas, signal?: AbortSignal) {
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
    signal?.throwIfAborted();
    const current = await storage.read(report.scope, row.signal_key, { omitInvalidReplayLinks: true });
    if (!current || current.signal.status !== 'observed' || current.signal.input.asset?.contour !== 'virtual') continue;
    const entries = current.signal.input.observations;
    const refs = entries.flatMap(item => [item.primary, ...item.supporting]).filter(item => item.kind === 'posting');
    if (refs.some(ref => ref.source.namespace !== namespace)) continue;
    const linked = new Map<string, AuditSourceRef>();
    for (const item of entries) {
      if (item.primary.accountId !== report.accountId) continue;
      for (const ref of [item.primary, ...item.supporting]) {
        const key = riskEvidenceKey(ref);
        if (ref.kind === 'posting' && known.has(key)) linked.set(key, ref.source);
      }
    }
    if (!linked.size) continue;
    if (signals.length === matchLimit) { clipped = true; break; }
    const linkedPostingKeys = new Set([...linked.values()].map(auditSourceKey));
    const replayLinks = (current.replayLinks ?? []).filter(link => {
      const frame = report.replayFrames.get(link.replayId)?.get(link.sequence);
      if (!frame) return false;
      const sourceKey = auditSourceKey(link.source);
      if (link.source.namespace === namespace) return linkedPostingKeys.has(sourceKey) && frame.has(sourceKey);
      const { entity } = report;
      return entity !== null && auditSourceKey(entity.source) === sourceKey && (
        entity.category === 'pvp' ||
        entity.category === 'totalizator' && [...linkedPostingKeys].some(key => frame.has(key)));
    }).slice(0, auditSignalReplayLinkLimit);
    const { key, rule, subject, comparison, input } = current.signal;
    signals.push({ key, ruleId: rule.id, ruleVersion: rule.version, subject, comparison,
      fromMs: input.fromMs, toMs: input.toMs, revision: current.revision,
      review: current.review, reviewAppliesToCurrent: current.reviewAppliesToCurrent, sources: [...linked.values()], replayLinks });
  }
  return { signals, clipped };
}
