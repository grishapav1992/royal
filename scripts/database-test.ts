import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

export async function temporaryDatabase(options: { maxConnections?: number } = {}) {
  const maxConnections = options.maxConnections;
  if (maxConnections !== undefined && (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 256)) {
    throw new RangeError('Temporary PostgreSQL connection limit must be between 1 and 256');
  }
  const directory = await mkdtemp(join(tmpdir(), 'royal-pg-'));
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const password = randomBytes(32).toString('hex');
  const postgres = new EmbeddedPostgres({ databaseDir: directory, port, user: 'postgres', password, persistent: true,
    authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1', ...(maxConnections === undefined ? [] : ['-c', 'max_connections=' + maxConnections])], onLog: () => {}, onError: () => {} });
  await postgres.initialise(); await postgres.start(); await postgres.createDatabase('royal_test');
  return { env: { NODE_ENV: 'test', DATABASE_URL: '', DATABASE_URL_FILE: '', PGHOST: '127.0.0.1', PGPORT: String(port), PGDATABASE: 'royal_test', PGUSER: 'postgres', PGPASSWORD: password, PGPASSWORD_FILE: '', PGSSLMODE: 'disable', CODEX_SALE_API_KEY: '' },
    cleanup: async () => { await postgres.stop(); await rm(directory, { recursive: true, force: true }); } };
}

if (process.argv[1]?.endsWith('database-test.ts')) {
  const database = await temporaryDatabase();
  let childExitCode = 1;
  try {
    const args = process.argv.slice(2);
    const child = spawn(process.execPath, args.length ? args : ['--import', 'tsx', '--test', 'server-tests/postgres.test.ts'], { stdio: 'inherit', env: { ...process.env, ...database.env } });
    childExitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally { await database.cleanup(); }
  // embedded-postgres installs a beforeExit hook that otherwise replaces this status with 0.
  // The cluster and its files have already been fully cleaned up.
  process.exit(childExitCode);
}
