import { parseArgs } from 'node:util';
import { persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { isReplayId } from '../server/audit/replay-package';
import { persistCapturedToteReplay } from '../server/audit/replay-tote';
import { databaseConfig, PostgresDatabase } from '../server/database';

const usage = 'npm run audit:replay-prepare -- --schema <audit-schema> --game-schema <game-schema> --dataset <test UUID> ' +
  '--replay <UUID> (--posting <demo_ledger row ID> | --pool <ft1-ID>)';
const validSchema = (value: string | undefined): value is string => !!value && /^[a-z_][a-z_0-9]{0,62}$/.test(value);
const maxTemporaryBytes = 64 * 1024 * 1024;
const validPosting = (value: string): boolean => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

async function main() {
  const { values, tokens } = parseArgs({ strict: true, tokens: true, options: {
    help: { type: 'boolean' }, schema: { type: 'string' }, 'game-schema': { type: 'string' },
    dataset: { type: 'string' }, replay: { type: 'string' }, posting: { type: 'string' }, pool: { type: 'string' },
  } });
  if (values.help) { console.log(usage); return; }
  const { schema, posting, pool } = values;
  const gameSchema = values['game-schema'], datasetId = values.dataset?.toLowerCase(), replayId = values.replay?.toLowerCase();
  const flags = tokens.flatMap(token => token.kind === 'option' ? [token.name] : []);
  const connection = process.env.ROYAL_AUDIT_WORKER_DB_URL_FILE;
  if (!connection || !validSchema(schema) || !validSchema(gameSchema) || schema === gameSchema ||
    !isReplayId(datasetId) || !isReplayId(replayId) || (posting === undefined) === (pool === undefined) ||
    (posting !== undefined && !validPosting(posting)) || (pool !== undefined && !/^ft1-[0-9]{1,16}$/.test(pool)) ||
    new Set(flags).size !== flags.length) throw new Error('Invalid audit replay preparation configuration');

  const config = { ...databaseConfig({
    DATABASE_URL_FILE: connection, PGSSLMODE: process.env.ROYAL_AUDIT_PGSSLMODE,
    PGSSLROOTCERT: process.env.ROYAL_AUDIT_PGSSLROOTCERT,
  }), max: 1, statement_timeout: 3000, lock_timeout: 1000, idle_in_transaction_session_timeout: 8000,
  application_name: 'royal/audit-replay-prepare' };
  const audit = new PostgresDatabase(schema, { existingSchema: true, config });
  try {
    const settings = await audit.prepare("SELECT pg_size_bytes(current_setting('temp_file_limit'))::text AS bytes").get();
    const bytes = Number(settings?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxTemporaryBytes) {
      throw new Error('Audit replay worker requires a bounded temp file limit');
    }
    const namespace = gameSchema + '.demo_ledger';
    const dataset = await audit.prepare(`SELECT 1 FROM audit_datasets d JOIN audit_dataset_sources s ON s.dataset_id=d.id
      WHERE d.id=? AND d.environment='test' AND d.sealed_at_ms IS NULL AND s.source_namespace=?`).get(datasetId, namespace);
    if (!dataset) {
      console.log(JSON.stringify({ status: 'unavailable', reason: 'active-test-dataset-required' }));
      process.exitCode = 1;
      return;
    }
    const input = { datasetId, replayId, gameSchema };
    const result = posting !== undefined
      ? await persistCapturedCasinoReplay(audit, { ...input, posting: { namespace, rowId: posting } })
      : await persistCapturedToteReplay(audit, { ...input, poolId: pool! });
    console.log(JSON.stringify(result));
    if (result.status !== 'stored') process.exitCode = 1;
  } finally {
    await audit.close();
  }
}

try { await main(); }
catch (error) {
  const code = (error as { code?: string } | null)?.code;
  console.error(JSON.stringify({ error: code === '57014' ? 'query-timeout' : 'audit-replay-prepare-unavailable' }));
  process.exitCode = 2;
}
