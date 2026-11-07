import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConfig } from 'pg';
import type { AuditScope, AuditSourceRef } from './contract';
import type { AuditDetailReport } from './report-detail-source';
import {
  AuditPlayerReportError, openAuditReportReader, runAuditReport, type AuditDetailLookupFilters, type AuditPostingReportFilters,
  type AuditReconcilePeriodFilters,
} from './report-player';

type Investigation = { schema: string; datasetId: string; filters: AuditPostingReportFilters; signal?: AbortSignal };
type DetailInvestigation = Omit<Investigation, 'filters'> & { filters: AuditPostingReportFilters | AuditDetailLookupFilters };
type ReportIdentity = { schemaVersion: 1; datasetId: string; environment: AuditScope['environment'] };
type ReconcileReport = ReportIdentity & {
  requestStatus: 'queued' | 'running' | 'ready' | 'failed' | 'not-captured' | 'not-requested' |
    'queue-full' | 'queue-busy' | 'source-unavailable';
  requestedAt: string | null;
  finishedAt: string | null;
  report: Record<string, unknown> | null;
};
type PostingReconcileReport = ReconcileReport & { anchor: AuditSourceRef };
type PeriodReconcileReport = ReconcileReport & {
  selection: { source: string; fromMs: number; toMs: number; accountId: string | null };
};
const byteLimit = 1024 * 1024 + 4096;
const environments = new Set(['test', 'live']);

function outputFor<T extends ReportIdentity>(
  report: T | undefined, input: { datasetId: string }, jobId: string, identityMatches: boolean,
) {
  if (!report || report.schemaVersion !== 1 || report.datasetId !== input.datasetId.toLowerCase() ||
      typeof report.environment !== 'string' || !environments.has(report.environment) ||
      !identityMatches) {
    throw new AuditPlayerReportError('internal-error', jobId);
  }
  const output = { jobId, ...report };
  const bytes = Buffer.byteLength(JSON.stringify(output) + '\n', 'utf8');
  if (bytes > byteLimit) throw new AuditPlayerReportError('byte-limit', jobId);
  return { output, bytes };
}

function detailIdentityMatches(report: AuditDetailReport | undefined, filters: DetailInvestigation['filters']) {
  if (!report) return false;
  if ('postingId' in filters) {
    return report.source?.namespace === filters.source && report.source.rowId === filters.postingId;
  }
  const selection = report.selection;
  if (selection?.source !== filters.source || selection.lookupKind !== filters.lookupKind ||
      selection.lookupId !== filters.lookupId || selection.accountId !== filters.accountId) return false;
  if (report.source === null) return report.anchor === null && report.status !== 'found';
  return report.source.namespace === filters.source && /^[1-9][0-9]{0,18}$/.test(report.source.rowId) &&
    (!filters.accountId || report.anchor?.accountId === filters.accountId);
}

export async function readAuditDetail(config: ClientConfig, input: DetailInvestigation) {
  const result = await runAuditReport(config, input, 'detail', 30_000, async (settings, schema, jobId, signal) => {
    const { connection, finish } = await openAuditReportReader(settings, jobId, signal);
    try {
      const query = await connection.query<{ report: AuditDetailReport }>(
        'SELECT ' + schema + '.audit_report_detail($1) AS report', [jobId]);
      const report = query.rows[0]?.report;
      const result = outputFor(report, input, jobId, detailIdentityMatches(report, input.filters));
      const rowCount = [result.output.linkedPostings, result.output.attempts, result.output.events]
        .reduce((count, rows) => count + (Array.isArray(rows) ? rows.length : 0), result.output.anchor ? 1 : 0);
      signal.throwIfAborted();
      await connection.query('COMMIT');
      return { ...result, rowCount };
    } finally { await finish(); }
  });
  return result.output;
}

async function requestReconciliation<T extends ReconcileReport>(config: ClientConfig,
  input: Omit<Investigation, 'filters'> & { filters: AuditPostingReportFilters | AuditReconcilePeriodFilters; waitMs?: number },
  read: 'audit_report_reconcile' | 'audit_report_reconcile_period',
  identityMatches: (report: T | undefined) => boolean,
) {
  const waitMs = input.waitMs ?? 0;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 45_000) throw new Error('Invalid audit reconcile wait');
  const result = await runAuditReport(config, input, 'reconcile', 60_000, async (settings, schema, jobId, signal) => {
    const { connection, finish } = await openAuditReportReader(settings, jobId, signal, false);
    try {
      const query = async (enqueue: boolean) => {
        signal.throwIfAborted();
        const response = await connection.query<{ report: T }>(
          'SELECT ' + schema + '.' + read + '($1,$2) AS report', [jobId, enqueue]);
        return response.rows[0]?.report;
      };
      let report = await query(true);
      await connection.query('COMMIT');
      const deadline = performance.now() + waitMs;
      while (report?.requestStatus === 'queued' || report?.requestStatus === 'running') {
        const remaining = deadline - performance.now();
        if (remaining <= 0) break;
        await delay(Math.min(remaining, 500), undefined, { signal });
        report = await query(false);
      }
      signal.throwIfAborted();
      return { ...outputFor(report, input, jobId, identityMatches(report)), rowCount: report?.report ? 1 : 0 };
    } finally { await finish(); }
  });
  return result.output;
}

export function requestAuditReconcile(config: ClientConfig, input: Investigation & { waitMs?: number }) {
  return requestReconciliation<PostingReconcileReport>(config, input, 'audit_report_reconcile', report =>
    report?.anchor?.namespace === input.filters.source && report.anchor.rowId === input.filters.postingId);
}

export function requestAuditPeriodReconcile(config: ClientConfig,
  input: Omit<Investigation, 'filters'> & { filters: AuditReconcilePeriodFilters; waitMs?: number },
) {
  const { source, fromMs, toMs, accountId } = input.filters;
  return requestReconciliation<PeriodReconcileReport>(config, input, 'audit_report_reconcile_period', report =>
    report?.selection?.source === source && report.selection.fromMs === fromMs && report.selection.toMs === toMs &&
    report.selection.accountId === (accountId ?? null));
}
