import { parseArgs } from 'node:util';
import type { AuditScope } from '../server/audit/contract';
import { readAuditRiskReportSignal, reviewAuditRiskReportSignal, runAuditRiskReport } from '../server/audit/risk-report';
import { isRiskScope, isRiskSignalKey } from '../server/audit/risk-rules';
import { RISK_WINDOW_MS } from '../server/audit/risk-selection';
import { databaseConfig, PostgresDatabase } from '../server/database';

const scopeArgs = '--schema <audit-schema> --dataset <test UUID>';
const usage = [
  'npm run audit:risk -- run ' + scopeArgs + ' --game-schema <schema> --category <casino|pvp|totalizator>',
  '  --day <YYYY-MM-DD UTC> --subject <account> [--subject <account>] --peer <account> [--peer <account>]',
  'npm run audit:risk -- show ' + scopeArgs + ' --key <signal-key>',
  'npm run audit:risk -- review ' + scopeArgs + ' --key <signal-key> --revision <number> --decision <explained|escalated|dismissed>',
].join('\n');
const schema = (value: unknown): value is string => typeof value === 'string' && /^[a-z_][a-z_0-9]{0,62}$/.test(value);
const invalid = () => new Error('Invalid audit risk arguments');

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, schema: { type: 'string' }, dataset: { type: 'string' },
    'game-schema': { type: 'string' }, category: { type: 'string' }, day: { type: 'string' },
    subject: { type: 'string', multiple: true }, peer: { type: 'string', multiple: true },
    key: { type: 'string' }, revision: { type: 'string' }, decision: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  const scope: AuditScope = { datasetId: values.dataset ?? '', environment: 'test' };
  const subcommand = positionals[0], gameSchema = values['game-schema'];
  const common = ['schema', 'dataset'];
  if (positionals.length !== 1 || !schema(values.schema) || !isRiskScope(scope)) throw invalid();
  const source = process.env.ROYAL_AUDIT_RISK_DB_URL_FILE;
  if (!source) throw new Error('An explicit audit risk service connection is required');
  const config = { ...databaseConfig({ DATABASE_URL_FILE: source, PGSSLMODE: process.env.ROYAL_AUDIT_PGSSLMODE,
    PGSSLROOTCERT: process.env.ROYAL_AUDIT_PGSSLROOTCERT }), max: 1, statement_timeout: 3000, lock_timeout: 500,
    application_name: 'royal/audit-risk' };
  const audit = new PostgresDatabase(values.schema, { existingSchema: true, config });
  let game: PostgresDatabase | undefined;
  try {
    if (subcommand === 'run') {
      const { category, day, subject, peer } = values;
      if (!schema(gameSchema) || !subject?.length || !peer?.length ||
          (category !== 'casino' && category !== 'pvp' && category !== 'totalizator') ||
          !day || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          Object.keys(values).some(key => ![...common, 'game-schema', 'category', 'day', 'subject', 'peer'].includes(key))) throw invalid();
      const fromMs = Date.parse(day + 'T00:00:00Z');
      if (!Number.isSafeInteger(fromMs) || fromMs < 0 || new Date(fromMs).toISOString().slice(0, 10) !== day) throw invalid();
      game = new PostgresDatabase(gameSchema, { readOnly: true, existingSchema: true, config });
      const report = await runAuditRiskReport(audit, game, {
        scope, gameSchema, fromMs, toMs: fromMs + RISK_WINDOW_MS, asOfMs: Date.now(),
        subjectAccountIds: subject, comparisonAccountIds: peer,
      }, category, AbortSignal.timeout(60_000));
      console.log(JSON.stringify(report));
    } else if (subcommand === 'show' || subcommand === 'review') {
      const { key, revision, decision } = values;
      const allowed = subcommand === 'show' ? [...common, 'key'] : [...common, 'key', 'revision', 'decision'];
      if (!key || !isRiskSignalKey(key) || Object.keys(values).some(option => !allowed.includes(option))) throw invalid();
      let result;
      if (subcommand === 'review') {
        if (!revision || !/^[1-9][0-9]*$/.test(revision) ||
            (decision !== 'explained' && decision !== 'escalated' && decision !== 'dismissed')) throw invalid();
        result = await reviewAuditRiskReportSignal(audit, scope, key, { expectedRevision: Number(revision), decision });
      } else {
        result = await readAuditRiskReportSignal(audit, scope, key);
      }
      if (!result) { console.log(JSON.stringify({ scope, status: 'not-found' })); process.exitCode = 1; return; }
      console.log(JSON.stringify(result));
    } else throw invalid();
  } finally {
    await Promise.all([audit.close(), game?.close()]);
  }
}

try { await main(); }
catch (error) {
  const code = (error as { code?: string } | null)?.code;
  console.error(JSON.stringify({ error: code === '57014' ? 'query-timeout' : 'audit-risk-unavailable' }));
  process.exitCode = 2;
}
