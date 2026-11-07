import { parseArgs } from 'node:util';
import { databaseConfig } from '../server/database';
import { AuditPlayerReportError, exportAuditPlayer, type AuditReportFilters } from '../server/audit/report-player';
import { readAuditSummary } from '../server/audit/report-summary';

const period = '--schema <audit-schema> --dataset <uuid> --from <ISO timestamp with timezone> --to <ISO timestamp with timezone>';
const optionalFilters = '[--category <casino|pvp|totalizator>] [--game <id>] [--mode <id>] [--asset <code>] [--contour <virtual|test|real>]';
const usage = 'npm run audit -- player ' + period + ' --account <id> --output <new CSV file> ' + optionalFilters + '\n' +
  'npm run audit -- summary ' + period + ' [--account <id>] ' + optionalFilters;

function timestamp(value: string) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (!match) throw new Error('Invalid audit report time');
  const day = new Date(match[1] + '-' + match[2] + '-' + match[3] + 'T00:00:00Z');
  const at = Date.parse(value);
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error('Invalid audit report time');
  }
  return at;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' },
    schema: { type: 'string' }, dataset: { type: 'string' }, account: { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, output: { type: 'string' },
    category: { type: 'string' }, game: { type: 'string' }, mode: { type: 'string' },
    asset: { type: 'string' }, contour: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  const { schema, dataset, account, from, to, output, category, game, mode, asset, contour } = values;
  const kind = positionals[0];
  if (positionals.length !== 1 || (kind !== 'player' && kind !== 'summary') || !schema || !dataset || !from || !to ||
      (kind === 'player' && (!account || !output)) || (kind === 'summary' && output !== undefined) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(dataset) ||
      (category !== undefined && !['casino','pvp','totalizator'].includes(category)) ||
      (contour !== undefined && !['virtual','test','real'].includes(contour))) throw new Error('Invalid audit report arguments');
  const source = process.env.ROYAL_AUDIT_DB_URL_FILE;
  if (!source) throw new Error('An explicit operator connection is required');
  const config = databaseConfig({
    DATABASE_URL_FILE: source,
    PGSSLMODE: process.env.ROYAL_AUDIT_PGSSLMODE,
    PGSSLROOTCERT: process.env.ROYAL_AUDIT_PGSSLROOTCERT,
  });
  const filters: AuditReportFilters = {
    accountId: account, fromMs: timestamp(from), toMs: timestamp(to), category: category as AuditReportFilters['category'],
    gameId: game, modeId: mode, asset, contour: contour as AuditReportFilters['contour'],
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const input = { schema, datasetId: dataset, filters, signal: controller.signal };
    const result = kind === 'player'
      ? await exportAuditPlayer(config, { ...input, filters: { ...filters, accountId: account! }, destination: output! })
      : await readAuditSummary(config, input);
    console.log(JSON.stringify(result));
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

try { await main(); }
catch (error) {
  if (error instanceof AuditPlayerReportError) {
    console.error(JSON.stringify({ error: error.code, jobId: error.jobId }));
    process.exitCode = error.code === 'cancelled' ? 130 : 1;
  } else {
    console.error('Invalid audit arguments or operator connection configuration.');
    console.error(usage);
    process.exitCode = 2;
  }
}
