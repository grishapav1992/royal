import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { databaseConfig, PostgresDatabase } from '../server/database';
import { processAuditReconcileRequest } from '../server/audit/report-reconcile-worker';

const validSchema = (value: unknown): value is string => typeof value === 'string' && /^[a-z_][a-z_0-9]{0,62}$/.test(value);

async function main() {
  const { values } = parseArgs({ options: { schema: { type: 'string' }, 'game-schema': { type: 'string' },
    'payments-schema': { type: 'string' }, watch: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('npm run audit:reconcile-worker -- --schema <audit> --game-schema <game> [--payments-schema <payments>] [--watch]');
    return;
  }
  const schema = values.schema, game = values['game-schema'], payments = values['payments-schema'];
  const source = process.env.ROYAL_AUDIT_WORKER_DB_URL_FILE;
  if (!source || !validSchema(schema) || !validSchema(game) || (payments !== undefined && !validSchema(payments)) ||
      schema === game || schema === payments || game === payments) throw new Error('Invalid reconciliation worker configuration');
  const config = { ...databaseConfig({ DATABASE_URL_FILE: source, PGSSLMODE: process.env.ROYAL_AUDIT_PGSSLMODE,
    PGSSLROOTCERT: process.env.ROYAL_AUDIT_PGSSLROOTCERT }), max: 1, statement_timeout: 3000, lock_timeout: 1000,
    application_name: 'royal/audit-reconcile-worker' };
  const audit = new PostgresDatabase(schema, { existingSchema: true, config });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    do {
      const outcome = await processAuditReconcileRequest(audit, { game, payments }, controller.signal);
      if (outcome !== 'idle' || !values.watch) console.log(JSON.stringify({ outcome }));
      if (outcome === 'idle' && values.watch) await delay(1000, undefined, { signal: controller.signal });
    } while (values.watch && !controller.signal.aborted);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await audit.close();
  }
}

try { await main(); }
catch {
  console.error(JSON.stringify({ error: 'audit-reconcile-worker-unavailable' }));
  process.exitCode = 1;
}
