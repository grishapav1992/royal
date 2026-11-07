import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConfig } from 'pg';
import type { AuditScope, AuditSourceRef } from './contract';
import type { AuditDetailReport } from './report-detail-source';
import {
  AuditPlayerReportError, openAuditReportReader, runAuditReport, type AuditPostingReportFilters,
} from './report-player';

type Investigation = { schema: string; datasetId: string; filters: AuditPostingReportFilters; signal?: AbortSignal };
type ReportIdentity = { schemaVersion: 1; datasetId: string; environment: AuditScope['environment'] };
type ReconcileReport = ReportIdentity & {
  anchor: AuditSourceRef;
  requestStatus: 'queued' | 'running' | 'ready' | 'failed' | 'not-captured' | 'not-requested' |
    'queue-full' | 'queue-busy' | 'source-unavailable';
  requestedAt: string | null;
  finishedAt: string | null;
  report: Record<string, unknown> | null;
};
const byteLimit = 1024 * 1024 + 4096;
const environments = new Set(['test', 'live']);

function outputFor<T extends ReportIdentity & Partial<Record<'source' | 'anchor', AuditSourceRef>>>(
  report: T | undefined, input: Investigation, jobId: string, identityKey: 'source' | 'anchor',
) {
  const identity = report?.[identityKey];
  if (!report || report.schemaVersion !== 1 || report.datasetId !== input.datasetId.toLowerCase() ||
      typeof report.environment !== 'string' || !environments.has(report.environment) ||
      identity?.namespace !== input.filters.source || identity.rowId !== input.filters.postingId) {
    throw new AuditPlayerReportError('internal-error', jobId);
  }
  const output = { jobId, ...report };
  const bytes = Buffer.byteLength(JSON.stringify(output) + '\n', 'utf8');
  if (bytes > byteLimit) throw new AuditPlayerReportError('byte-limit', jobId);
  return { output, bytes };
}

export async function readAuditDetail(config: ClientConfig, input: Investigation) {
  const result = await runAuditReport(config, input, 'detail', 30_000, async (settings, schema, jobId, signal) => {
    const { connection, finish } = await openAuditReportReader(settings, jobId, signal);
    try {
      const query = await connection.query<{ report: AuditDetailReport }>(
        'SELECT ' + schema + '.audit_report_detail($1) AS report', [jobId]);
      const report = query.rows[0]?.report;
      const result = outputFor(report, input, jobId, 'source');
      const rowCount = [result.output.linkedPostings, result.output.attempts, result.output.events]
        .reduce((count, rows) => count + (Array.isArray(rows) ? rows.length : 0), result.output.anchor ? 1 : 0);
      signal.throwIfAborted();
      await connection.query('COMMIT');
      return { ...result, rowCount };
    } finally { await finish(); }
  });
  return result.output;
}

export async function requestAuditReconcile(config: ClientConfig, input: Investigation & { waitMs?: number }) {
  const waitMs = input.waitMs ?? 0;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 45_000) throw new Error('Invalid audit reconcile wait');
  const result = await runAuditReport(config, input, 'reconcile', 60_000, async (settings, schema, jobId, signal) => {
    const { connection, finish } = await openAuditReportReader(settings, jobId, signal, false);
    try {
      const query = async (enqueue: boolean) => {
        signal.throwIfAborted();
        const response = await connection.query<{ report: ReconcileReport }>(
          'SELECT ' + schema + '.audit_report_reconcile($1,$2) AS report', [jobId, enqueue]);
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
      return { ...outputFor(report, input, jobId, 'anchor'), rowCount: report?.report ? 1 : 0 };
    } finally { await finish(); }
  });
  return result.output;
}
