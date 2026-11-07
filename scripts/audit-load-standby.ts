import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);

async function loopbackPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/** Clone only the benchmark-owned primary. No external database connection is accepted. */
export async function startAuditLoadStandby(pgBasebackup: string,
  primary: { PGPORT: string; PGDATABASE: string; PGUSER: string; PGPASSWORD: string }, signal?: AbortSignal) {
  const port = await loopbackPort();
  const backup = resolve(pgBasebackup);
  if (!/^pg_basebackup(?:\.exe)?$/.test(basename(backup))) throw new Error('Expected a pg_basebackup executable');
  const pgCtl = join(dirname(backup), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LC_ALL: 'C',
    PGPASSWORD: primary.PGPASSWORD, PGSSLMODE: 'disable' };
  const directory = await mkdtemp(join(tmpdir(), 'royal-audit-standby-'));
  const dataDir = join(directory, 'standby');
  const control = (args: string[]) => run(pgCtl, ['-D', dataDir, ...args], { env, timeout: 15_000 });
  const stop = async () => {
    const running = await access(join(dataDir, 'postmaster.pid')).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
    if (running) await control(['stop', '-m', 'fast', '-w', '-t', '10']);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await run(backup, ['-D', dataDir, '-h', '127.0.0.1', '-p', primary.PGPORT, '-U', primary.PGUSER,
      '--checkpoint=fast', '--wal-method=stream', '--write-recovery-conf', '--no-password'],
    { env, timeout: 20_000, signal });
    signal?.throwIfAborted();
    await control(['start', '-w', '-t', '10', '-l', join(directory, 'standby.log'),
      '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories= -c hot_standby_feedback=off`]);
  } catch (error) {
    await stop();
    signal?.throwIfAborted();
    throw new Error('Failed to start the isolated audit load standby', { cause: error });
  }
  const connect = (databasePort = port) => new pg.Client({ host: '127.0.0.1', port: databasePort,
    database: primary.PGDATABASE, user: primary.PGUSER, password: primary.PGPASSWORD,
    ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
  return { port, connect, stop };
}
