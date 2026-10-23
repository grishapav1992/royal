import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, constants } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

export async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'royal-pg-'));
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const password = randomBytes(32).toString('hex');
  const postgres = new EmbeddedPostgres({ databaseDir: directory, port, user: 'postgres', password, persistent: true,
    authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  await postgres.initialise(); await postgres.start(); await postgres.createDatabase('royal_test');
  return { env: { NODE_ENV: 'test', DATABASE_URL: '', DATABASE_URL_FILE: '', PGHOST: '127.0.0.1', PGPORT: String(port), PGDATABASE: 'royal_test', PGUSER: 'postgres', PGPASSWORD: password, PGPASSWORD_FILE: '', PGSSLMODE: 'disable', CODEX_SALE_API_KEY: '' },
    cleanup: async () => {
      await postgres.stop();
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('royal-pg-')) throw new Error('Unexpected temporary database directory');
      await rm(target, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
    } };
}

if (process.argv[1]?.endsWith('database-test.ts')) {
  let exitCode = 1;
  try {
    const database = await temporaryDatabase();
    try {
      const args = process.argv.slice(2);
      const environment: NodeJS.ProcessEnv = { ...process.env, ...database.env };
      // This child is a standalone test run, including when the wrapper is tested itself.
      delete environment.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, args.length ? args : ['--import', 'tsx', '--test', 'server-tests/postgres.test.ts'], { stdio: 'inherit', env: environment });
      exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)));
      });
    } finally { await database.cleanup(); }
  } catch (error) {
    console.error('Database test runner failed:', error instanceof Error ? error.message : 'Unknown error');
    exitCode = 1;
  }
  // The embedded database's beforeExit hook uses zero, so exit explicitly after cleanup.
  process.exit(exitCode);
}
