import type { ClientConfig } from 'pg';
import { AuditPlayerReportError, openAuditReportReader, runAuditReport, type AuditReportFilters } from './report-player';
import type { SummaryReport } from './report-summary-source';

export async function readAuditSummary(
  config: ClientConfig, input: { schema: string; datasetId: string; filters: AuditReportFilters;
    signal?: AbortSignal; fixtureStandbyPort?: number },
) {
  const result = await runAuditReport(config, input, 'summary', 60_000, async (settings, schema, jobId, signal, authorizePublication) => {
    const { query, finish } = await openAuditReportReader(settings, jobId, signal);
    try {
      signal.throwIfAborted();
      const result = await query<{ summary: SummaryReport }>('SELECT ' + schema + '.audit_report_summary($1) AS summary', [jobId]);
      const summary = result.rows[0]?.summary;
      if (!summary || summary.datasetId !== input.datasetId.toLowerCase() || !Array.isArray(summary.rows)) {
        throw new AuditPlayerReportError('internal-error', jobId);
      }
      signal.throwIfAborted();
      await query('COMMIT');
      const output = { jobId, ...summary };
      const bytes = Buffer.byteLength(JSON.stringify(output) + '\n', 'utf8');
      await authorizePublication?.(async () => {});
      return { output, rowCount: summary.rows.length, bytes };
    } finally {
      await finish();
    }
  });
  return result.output;
}
