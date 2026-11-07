import type { PostgresDatabase } from '../database';
import { auditSourceKey, type AuditScope, type AuditSourceRef } from './contract';
import type { AuditSourceSchemas } from './datasets';
import { auditReconcileSection, auditReconcileSupportsSource, reconcileAuditPostingInSnapshot,
  type ReadyAuditReconciliation } from './report-reconcile-core';
import { auditSignalReplayLinkLimit, readLinkedAuditSignals } from './report-reconcile-signals';
import { AUDIT_RECONCILE_MAX_BYTES, AUDIT_RECONCILE_PAGE_SIZE, AUDIT_RECONCILE_SCAN_MAX_POSTINGS } from './report-reconcile-source';
import { isReplayId } from './replay-package';

export const AUDIT_RECONCILE_PERIOD_MAX_POSTINGS = AUDIT_RECONCILE_PAGE_SIZE;
export const AUDIT_RECONCILE_PERIOD_MAX_MS = 31 * 24 * 60 * 60 * 1000;
const maxScanPostings = AUDIT_RECONCILE_SCAN_MAX_POSTINGS;

export type AuditReconcilePeriodSelection = {
  datasetId: string;
  sourceNamespace: string;
  fromMs: number;
  toMs: number;
  accountId: string | null;
};
type ScanRequest = { manifest: unknown; offset: number };
type ScanManifest = {
  version: 1;
  selection: AuditReconcilePeriodSelection;
  selectionAsOfMs: number;
  captureStartedAtMs: number;
  captureSealedAtMs: number | null;
  environment: AuditScope['environment'];
  rowIds: string[];
};
type PeriodPage = { offset: number; processed: number; total: number; hasMore: boolean; anchors: AuditSourceRef[] };
type Anchors = { anchors: AuditSourceRef[]; sources: AuditSourceRef[] };
type Coverage = Anchors & {
  rule: ReadyAuditReconciliation['coverage'][number]['rule'] | 'period' | 'RISK-05';
  code: string;
  status?: 'pending';
};
type FinancialError = Anchors & Omit<ReadyAuditReconciliation['findings'][number], 'sources' | 'status'> & {
  status: 'mismatch';
  replayIds: string[];
};
type Signal = Awaited<ReturnType<typeof readLinkedAuditSignals>>['signals'][number] & Anchors;
type PeriodReport = {
  status: 'ready' | 'scan-limit' | 'byte-limit';
  schemaVersion: 1;
  selection: AuditReconcilePeriodSelection;
  scope: AuditScope;
  asOfMs: number;
  captureStartedAtMs: number;
  captureSealedAtMs: number | null;
  selectionAsOfMs?: number;
  page?: PeriodPage;
  selectedCount: number;
  selectedCountLowerBound: boolean;
  requiredSources: string[];
  financialErrors: FinancialError[];
  coverage: Coverage[];
  signals: Signal[];
  evidence: AuditSourceRef[];
  replayIds: string[];
};
export type AuditPeriodReconciliation = PeriodReport | { status: 'not-found' } | { status: 'unsupported' };
type PeriodWork = { report: AuditPeriodReconciliation; manifest: ScanManifest | null };

const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function validSelection(selection: AuditReconcilePeriodSelection) {
  const { datasetId, fromMs, toMs, accountId } = selection;
  return isReplayId(datasetId) && time(fromMs) && time(toMs) && toMs > fromMs &&
    toMs - fromMs <= AUDIT_RECONCILE_PERIOD_MAX_MS &&
    (accountId === null || typeof accountId === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(accountId));
}

function checkedManifest(scan: ScanRequest | null, selection: AuditReconcilePeriodSelection): ScanManifest | null {
  if (scan === null) return null;
  const { offset, manifest } = scan;
  if (offset === 0 && manifest === null) return null;
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset % AUDIT_RECONCILE_PERIOD_MAX_POSTINGS !== 0 ||
      !manifest || typeof manifest !== 'object') throw new Error('Invalid audit reconciliation scan');
  const value = manifest as ScanManifest;
  const prior = value.selection;
  if (value.version !== 1 || !prior || prior.datasetId !== selection.datasetId ||
      prior.sourceNamespace !== selection.sourceNamespace || prior.accountId !== selection.accountId ||
      prior.fromMs !== selection.fromMs || prior.toMs !== selection.toMs ||
      (value.environment !== 'test' && value.environment !== 'live') ||
      !time(value.selectionAsOfMs) || !time(value.captureStartedAtMs) ||
      (value.captureSealedAtMs !== null && (!time(value.captureSealedAtMs) || value.captureSealedAtMs < value.captureStartedAtMs)) ||
      !Array.isArray(value.rowIds) || value.rowIds.length > maxScanPostings || offset >= value.rowIds.length ||
      new Set(value.rowIds).size !== value.rowIds.length ||
      value.rowIds.some(id => typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)) {
    throw new Error('Invalid audit reconciliation scan manifest');
  }
  return value;
}

function referenceKey(item: Coverage | FinancialError) {
  return JSON.stringify([item.rule, item.code, item.status, item.sources.map(auditSourceKey).sort(),
    'expected' in item ? item.expected : null, 'observed' in item ? item.observed : null]);
}

function addRefs(target: AuditSourceRef[], refs: readonly AuditSourceRef[]) {
  const known = new Set(target.map(auditSourceKey));
  for (const ref of refs) {
    const key = auditSourceKey(ref);
    if (!known.has(key)) {
      target.push(ref);
      known.add(key);
    }
  }
}

function merge<T extends Anchors>(items: Map<string, T>, key: string, entry: T) {
  const existing = items.get(key);
  if (!existing) {
    items.set(key, entry);
    return entry;
  }
  addRefs(existing.anchors, entry.anchors);
  addRefs(existing.sources, entry.sources);
  return existing;
}

function periodGap(code: string): Coverage {
  return { rule: 'period', code, anchors: [], sources: [] };
}

/** Reconcile every admitted posting in one bounded, committed read-only snapshot. */
export async function buildAuditPeriodReconciliation(audit: PostgresDatabase, sources: AuditSourceSchemas,
  input: AuditReconcilePeriodSelection, abort?: AbortSignal): Promise<AuditPeriodReconciliation> {
  return (await buildPeriod(audit, sources, input, null, abort)).report;
}

/** Freeze the exact selection once and reconcile one page in each committed read-only snapshot. */
export function buildAuditPeriodPageReconciliation(audit: PostgresDatabase, sources: AuditSourceSchemas,
  input: AuditReconcilePeriodSelection, scan: ScanRequest, abort?: AbortSignal): Promise<PeriodWork> {
  return buildPeriod(audit, sources, input, scan, abort);
}

async function buildPeriod(audit: PostgresDatabase, sources: AuditSourceSchemas, input: AuditReconcilePeriodSelection,
  scan: ScanRequest | null, abort?: AbortSignal): Promise<PeriodWork> {
  const timeout = AbortSignal.timeout(35_000);
  const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
  signal.throwIfAborted();
  const selection = { datasetId: input.datasetId.toLowerCase(), sourceNamespace: input.sourceNamespace,
    fromMs: input.fromMs, toMs: input.toMs, accountId: input.accountId };
  if (!validSelection(selection) || !auditReconcileSupportsSource(audit, sources, selection.sourceNamespace)) {
    return { report: { status: 'unsupported' }, manifest: null };
  }
  const prior = checkedManifest(scan, selection);
  if (audit.inTransaction) throw new Error('Audit period reconciliation requires an independent snapshot');
  return audit.transaction(async () => {
    await audit.exec("SET LOCAL statement_timeout='3s'; SET LOCAL transaction_timeout='35s'");
    signal.throwIfAborted();
    const { datasetId, sourceNamespace, accountId, fromMs, toMs } = selection;
    const dataset = await audit.prepare(`SELECT d.environment,d.started_at_ms,d.sealed_at_ms,
      floor(extract(epoch FROM statement_timestamp())*1000)::bigint AS as_of_ms
      FROM audit_datasets d JOIN audit_dataset_sources s ON s.dataset_id=d.id
      WHERE d.id=? AND s.source_namespace=?`).get(datasetId, sourceNamespace);
    if (!dataset) return { report: { status: 'not-found' }, manifest: prior };
    const { environment, started_at_ms: captureStartedAtMs, sealed_at_ms: captureSealedAtMs, as_of_ms: asOfMs } = dataset;
    if ((environment !== 'test' && environment !== 'live') || !time(captureStartedAtMs) ||
        (captureSealedAtMs !== null && !time(captureSealedAtMs)) || !time(asOfMs)) {
      return { report: { status: 'unsupported' }, manifest: prior };
    }
    if (prior && (prior.environment !== environment || prior.captureStartedAtMs !== captureStartedAtMs ||
        (prior.captureSealedAtMs !== null && prior.captureSealedAtMs !== captureSealedAtMs))) {
      return { report: { status: 'unsupported' }, manifest: prior };
    }

    const scanLimit = scan ? maxScanPostings : AUDIT_RECONCILE_PERIOD_MAX_POSTINGS;
    const scopeSql = `dataset_id=? AND source_namespace=? ${accountId === null ? '' : 'AND account_id=?'}
      AND occurred_at_ms>=? AND occurred_at_ms<?`;
    const scopeArgs = [datasetId, sourceNamespace, ...(accountId === null ? [] : [accountId]), fromMs, toMs];
    const selectedIds = prior?.rowIds ?? (await audit.prepare(`SELECT source_row_id::text AS row_id FROM audit_posting_refs
      WHERE ${scopeSql} ORDER BY occurred_at_ms,source_row_id LIMIT ?`)
      .all(...scopeArgs, scanLimit + 1)).map(row => row.row_id as string);
    signal.throwIfAborted();
    const exceeds = selectedIds.length > scanLimit;
    const manifest = scan && !exceeds ? prior ?? {
      version: 1 as const, selection, selectionAsOfMs: asOfMs, captureStartedAtMs, captureSealedAtMs,
      environment, rowIds: selectedIds,
    } : null;
    const selectionAsOfMs = manifest?.selectionAsOfMs ?? asOfMs;
    const base: PeriodReport = {
      status: 'ready', schemaVersion: 1, selection, scope: { datasetId, environment },
      asOfMs, captureStartedAtMs, captureSealedAtMs: manifest ? manifest.captureSealedAtMs : captureSealedAtMs,
      selectedCount: selectedIds.length, selectedCountLowerBound: exceeds,
      ...(scan ? { selectionAsOfMs, page: { offset: scan.offset, processed: 0, total: selectedIds.length,
        hasMore: false, anchors: [] } } : {}),
      requiredSources: [sourceNamespace], financialErrors: [], coverage: [], signals: [], evidence: [], replayIds: [],
    };
    if (fromMs < captureStartedAtMs) base.coverage.push(periodGap('period-before-capture'));
    if (base.captureSealedAtMs !== null && toMs > base.captureSealedAtMs) base.coverage.push(periodGap('period-after-capture'));
    if (base.captureSealedAtMs === null && toMs > selectionAsOfMs) base.coverage.push(periodGap('period-after-snapshot'));
    if (sourceNamespace === sources.game + '.demo_ledger') {
      const gap = await auditReconcileSection(audit, async () => Boolean(await audit.prepare(`SELECT 1 FROM audit_attempt_capture_gaps
        WHERE dataset_id=? AND first_at_ms<? AND last_at_ms>=? LIMIT 1`).get(datasetId, toMs, fromMs)));
      // Recorder ranges are dataset-wide. Do not infer the missing attempt belonged to the selected account.
      if (gap === null) base.coverage.push(periodGap('attempt-capture-coverage-unavailable'));
      else if (gap) base.coverage.push(periodGap('attempt-capture-gap-overlap'));
    }
    if (exceeds) {
      return { manifest: null, report: { ...base, status: 'scan-limit',
        coverage: [...base.coverage, periodGap('period-scan-limit')] } };
    }

    const offset = scan?.offset ?? 0;
    const rows = selectedIds.slice(offset, offset + AUDIT_RECONCILE_PERIOD_MAX_POSTINGS);
    // Current evidence may differ from the selection snapshot. Keep a missing or changed row in the page as a gap.
    const available = new Set(prior ? (await audit.prepare(`SELECT source_row_id::text AS row_id FROM audit_posting_refs
      WHERE ${scopeSql} AND source_row_id=ANY(?::bigint[])`).all(...scopeArgs, rows)).map(row => row.row_id as string) : rows);
    const anchors = rows.map(rowId => ({ namespace: sourceNamespace, rowId }));
    const financialErrors = new Map<string, FinancialError>(), coverage = new Map<string, Coverage>();
    const signals = new Map<string, Signal>(), evidence = new Map<string, AuditSourceRef>();
    const requiredSources = new Set(base.requiredSources), replayIds = new Set<string>();
    const addCoverage = (entry: Coverage) => merge(coverage, referenceKey(entry), entry);
    for (const anchor of anchors) {
      signal.throwIfAborted();
      evidence.set(auditSourceKey(anchor), anchor);
      const report = available.has(anchor.rowId)
        ? await reconcileAuditPostingInSnapshot(audit, sources, datasetId, anchor, signal) : { status: 'not-found' as const };
      if (report.status !== 'ready') {
        addCoverage({ rule: 'period', code: report.status === 'unsupported' ? 'posting-unsupported' : 'posting-unavailable',
          anchors: [anchor], sources: [anchor] });
        continue;
      }
      report.requiredSources.forEach(namespace => requiredSources.add(namespace));
      report.evidence.forEach(ref => evidence.set(auditSourceKey(ref), ref));
      report.replayIds.forEach(id => replayIds.add(id));
      for (const finding of report.findings) {
        if (finding.status === 'pending') {
          addCoverage({ rule: finding.rule, code: finding.code, status: 'pending', anchors: [anchor], sources: finding.sources });
          continue;
        }
        if (finding.status !== 'mismatch') continue;
        const entry: FinancialError = { ...finding, status: 'mismatch', anchors: [anchor], replayIds: [] };
        const group = merge(financialErrors, referenceKey(entry), entry);
        group.replayIds = [...new Set([...group.replayIds, ...report.replayIds])];
      }
      for (const gap of report.coverage) addCoverage({ ...gap, anchors: [anchor] });

      const linked = await auditReconcileSection(audit, () => readLinkedAuditSignals(audit, report, sources, signal));
      if (!linked || linked.clipped) {
        addCoverage({ rule: 'RISK-05', code: !linked ? 'signal-source-unavailable' : 'signal-scan-limit',
          anchors: [anchor], sources: [anchor] });
      }
      for (const entry of linked?.signals ?? []) {
        const item = merge(signals, entry.key, { ...entry, anchors: [anchor] });
        const links = new Map([...item.replayLinks, ...entry.replayLinks].map(link =>
          [link.replayId + ':' + link.sequence, link]));
        item.replayLinks = [...links.values()].slice(0, auditSignalReplayLinkLimit);
      }
    }

    signal.throwIfAborted();
    base.requiredSources = [...requiredSources].sort();
    const report: PeriodReport = {
      ...base, financialErrors: [...financialErrors.values()], coverage: [...base.coverage, ...coverage.values()],
      signals: [...signals.values()], evidence: [...evidence.values()], replayIds: [...replayIds].sort(),
      ...(base.page ? { page: { ...base.page, processed: anchors.length, anchors,
        hasMore: offset + anchors.length < selectedIds.length } } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') > AUDIT_RECONCILE_MAX_BYTES) {
      return { manifest, report: { ...base, status: 'byte-limit', coverage: [...base.coverage, periodGap('period-output-limit')] } };
    }
    return { manifest, report };
  }, { readOnly: true });
}
