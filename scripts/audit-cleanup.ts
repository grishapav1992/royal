import { parseArgs } from 'node:util';
import { AuditCleanupBlocked, applyAuditCleanup, installAuditCleanup, previewAuditCleanup, requireAuditCleanupExportDataset } from '../server/audit/cleanup';
import { AuditCleanupFilesError, initializeAuditExportDirectory, registerAuditExportFile } from '../server/audit/cleanup-files';
import { AuditDatasets } from '../server/audit/datasets';
import { isReplayId } from '../server/audit/replay-package';
import { databaseConfig, PostgresDatabase } from '../server/database';

const sourceFlags = '--schema <audit-schema> --game-schema <game-schema> [--payments-schema <payments-schema>]';
const usage = [
  'npm run audit:cleanup -- install ' + sourceFlags,
  'npm run audit:cleanup -- start-test ' + sourceFlags,
  'npm run audit:cleanup -- seal ' + sourceFlags + ' --dataset <test UUID>',
  'npm run audit:cleanup -- init-files --schema <audit-schema> --dataset <test UUID> --files-root <private root>',
  'npm run audit:cleanup -- register-file --schema <audit-schema> --dataset <test UUID> --files-root <private root> --name <file>',
  'npm run audit:cleanup -- plan ' + sourceFlags + ' --dataset <test UUID> --files-root <private root>',
  'npm run audit:cleanup -- apply ' + sourceFlags + ' --dataset <test UUID> --files-root <private root> --sha256 <reviewed SHA-256>',
].join('\n');
const schemaName = (value: unknown): value is string => typeof value === 'string' && /^[a-z_][a-z_0-9]{0,62}$/.test(value);
const invalid = () => new Error('Invalid audit cleanup configuration');

async function main() {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, strict: true, tokens: true, options: {
    help: { type: 'boolean' }, schema: { type: 'string' }, 'game-schema': { type: 'string' }, 'payments-schema': { type: 'string' },
    dataset: { type: 'string' }, 'files-root': { type: 'string' }, name: { type: 'string' }, sha256: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  const { schema, name, sha256 } = values;
  const game = values['game-schema'], payments = values['payments-schema'], filesRoot = values['files-root'];
  const datasetId = values.dataset?.toLowerCase(), command = positionals[0], connection = process.env.ROYAL_AUDIT_CLEANUP_DB_URL_FILE;
  const flags = tokens.flatMap(token => token.kind === 'option' ? [token.name] : []);
  const permits = (...allowed: string[]) => flags.every(flag => flag === 'schema' || allowed.includes(flag));
  const sources = ['game-schema', 'payments-schema'];
  const filesCommand = command === 'init-files' || command === 'register-file';
  if (positionals.length !== 1 || !connection || !schemaName(schema) || new Set(flags).size !== flags.length) throw invalid();
  if (filesCommand) {
    if (!permits('dataset','files-root',...(command === 'register-file' ? ['name'] : [])) || !isReplayId(datasetId) ||
        !filesRoot || (command === 'register-file' && !name)) throw invalid();
  } else if (!schemaName(game) || (payments !== undefined && !schemaName(payments)) ||
      schema === game || schema === payments || game === payments) throw invalid();

  const config = { ...databaseConfig({ DATABASE_URL_FILE: connection, PGSSLMODE: process.env.ROYAL_AUDIT_PGSSLMODE,
    PGSSLROOTCERT: process.env.ROYAL_AUDIT_PGSSLROOTCERT }), max: 1, statement_timeout: 3000, lock_timeout: 1000,
    idle_in_transaction_session_timeout: 8000, application_name: 'royal/audit-cleanup' };
  const db = new PostgresDatabase(schema, { existingSchema: true, config });
  try {
    const settings = await db.prepare("SELECT pg_size_bytes(current_setting('temp_file_limit'))::text AS bytes").get();
    const bytes = Number(settings?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 64 * 1024 * 1024) throw invalid();
    if (filesCommand && isReplayId(datasetId) && filesRoot) {
      const result = await db.transaction(async () => {
        await requireAuditCleanupExportDataset(db, datasetId);
        return command === 'init-files' ? { directory: await initializeAuditExportDirectory(filesRoot, datasetId) }
          : registerAuditExportFile(filesRoot, datasetId, name!);
      }, { lockKey: 'audit-dataset' });
      console.log(JSON.stringify(result));
      return;
    }
    if (!game) throw invalid();
    const sourceSchemas = { game, payments };
    if ((command === 'install' || command === 'start-test') && permits(...sources)) {
      const datasets = new AuditDatasets(db, sourceSchemas);
      if (command === 'install') {
        await datasets.ready;
        await installAuditCleanup(db);
        console.log(JSON.stringify({ status: 'installed' }));
      } else console.log(JSON.stringify(await datasets.startTest()));
    } else if (command === 'seal' && permits(...sources,'dataset') && isReplayId(datasetId)) {
      await new AuditDatasets(db, sourceSchemas, { existingSchema: true }).sealTest(datasetId);
      console.log(JSON.stringify({ status: 'sealed', datasetId }));
    } else if (command === 'plan' && permits(...sources,'dataset','files-root') && isReplayId(datasetId) && filesRoot) {
      const result = await previewAuditCleanup(db, { datasetId, sources: sourceSchemas, filesRoot });
      console.log(JSON.stringify(result));
      if (result.blockers.length) process.exitCode = 1;
    } else if (command === 'apply' && permits(...sources,'dataset','files-root','sha256') && isReplayId(datasetId) && filesRoot && sha256) {
      const result = await applyAuditCleanup(db, { datasetId, sources: sourceSchemas, filesRoot, expectedSha256: sha256 });
      console.log(JSON.stringify(result));
      if (result.status !== 'complete') process.exitCode = 1;
    } else throw invalid();
  } finally { await db.close(); }
}

try { await main(); }
catch (error) {
  const code = (error as { code?: string } | null)?.code;
  if (error instanceof AuditCleanupBlocked) console.error(JSON.stringify({ error: 'cleanup-blocked', blockers: error.blockers }));
  else if (error instanceof AuditCleanupFilesError) console.error(JSON.stringify({ error: 'managed-files-blocked', reason: error.code }));
  else console.error(JSON.stringify({ error: code === '55P03' ? 'source-busy' : code === '57014' || code === '25P04' ? 'query-timeout' : 'audit-cleanup-unavailable' }));
  process.exitCode = error instanceof AuditCleanupBlocked || error instanceof AuditCleanupFilesError ? 1 : 2;
}
