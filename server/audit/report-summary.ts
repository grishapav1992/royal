import type { ClientConfig } from 'pg';
import { AuditPlayerReportError, openAuditReportReader, runAuditReport, type AuditReportFilters } from './report-player';
import type { SummaryReport } from './report-summary-source';

export async function readAuditSummary(
  config: ClientConfig, input: { schema: string; datasetId: string; filters: AuditReportFilters; signal?: AbortSignal },
) {
  const result = await runAuditReport(config, input, 'summary', 60_000, async (settings, schema, jobId, signal) => {
    const { connection, finish } = await openAuditReportReader(settings, jobId, signal);
    try {
      signal.throwIfAborted();
      const query = await connection.query<{ summary: SummaryReport }>('SELECT ' + schema + '.audit_report_summary($1) AS summary', [jobId]);
      const summary = query.rows[0]?.summary;
      if (!summary || summary.datasetId !== input.datasetId.toLowerCase() || !Array.isArray(summary.rows)) {
        throw new AuditPlayerReportError('internal-error', jobId);
      }
      signal.throwIfAborted();
      await connection.query('COMMIT');
      const output = { jobId, ...summary };
      return { output, rowCount: summary.rows.length, bytes: Buffer.byteLength(JSON.stringify(output) + '\n', 'utf8') };
    } finally {
      await finish();
    }
  });
  return result.output;
}
