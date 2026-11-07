import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, cp, lstat, mkdtemp, open, readFile, realpath, rm, statfs, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
const loopback = '127.0.0.1';
const gameRole = 'royal_chat_load_game';
const chatRole = 'royal_chat_load_chat';
const standbyName = 'royal_chat_load_standby';
const replicationRole = 'royal_chat_load_replica';
const maxConnections = 60;
const deadlineMs = 30_000;

function subprocessEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function nativeBinaries(): Promise<{ initdb: string; pg_ctl: string; postgres: string }> {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  return import('@embedded-postgres/' + platform + '-' + process.arch);
}

async function localPort() {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, loopback, done);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  return address.port;
}

const password = () => randomBytes(32).toString('hex');
type ServerProcess = { child: ChildProcess; exited: Promise<void>; stopped: boolean };
type Cluster = { directory: string; port: number; bootstrapPassword: string; server?: ServerProcess };
type Database = { port: number; role: string; password: string };

async function connect<T>(database: Database, action: (client: pg.Client) => Promise<T>, name = database.role) {
  const client = new pg.Client({
    host: loopback, port: database.port, user: database.role, password: database.password, database: name,
    ssl: false, connectionTimeoutMillis: 3_000, statement_timeout: 5_000, application_name: 'royal/chat-load-stand',
  });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.end();
  }
}

async function waitFor<T>(probe: () => Promise<T | undefined>, reason: string, signal?: AbortSignal) {
  const deadline = performance.now() + deadlineMs;
  do {
    signal?.throwIfAborted();
    const result = await probe();
    if (result !== undefined) return result;
    await delay(50, undefined, { signal });
  } while (performance.now() < deadline);
  throw new Error(reason);
}

async function bootstrap(cluster: Cluster, role: string, runId: string, createReplicationRole = false) {
  const database = { port: cluster.port, role, password: password() };
  const admin = { port: cluster.port, role: 'postgres', password: cluster.bootstrapPassword };
  const replicationPassword = createReplicationRole ? password() : undefined;
  await connect(admin, async client => {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${database.password}'`);
    await client.query(`CREATE DATABASE ${role} OWNER ${role}`);
    await client.query(`ALTER DATABASE ${role} SET royal.chat_load_run_id = '${runId}'`);
    if (replicationPassword) {
      await client.query(`CREATE ROLE ${replicationRole} REPLICATION LOGIN PASSWORD '${replicationPassword}'`);
    }
  });
  return { database, replicationPassword };
}

/**
 * The local stand owns all three clusters and accepts no external database address.
 * The standby is copied only while the fresh synthetic primary is cleanly stopped.
 */
export async function startLocalChatLoadStand(parentDirectory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const parent = await realpath(parentDirectory);
  const artifactRoot = join(await realpath(process.cwd()), 'artifacts', 'work');
  assert(parent === resolve(parentDirectory) && dirname(parent) === artifactRoot, 'Use an owned directory under artifacts/work');
  const { initdb, pg_ctl, postgres } = await nativeBinaries();
  const runId = randomUUID();
  const directory = await mkdtemp(join(parent, 'royal-chat-load-'));
  const clusters: Cluster[] = [];
  const env = subprocessEnv();
  const command = (binary: string, args: string[]) => run(binary, args, { env, windowsHide: true, timeout: 45_000 });
  const allocate = async (name: string, bootstrapPassword = password()): Promise<Cluster> => {
    let port = await localPort();
    while (clusters.some(cluster => cluster.port === port)) port = await localPort();
    const cluster = { directory: join(directory, name), port, bootstrapPassword };
    clusters.push(cluster);
    return cluster;
  };
  const settings = (cluster: Cluster, values: string[]) =>
    appendFile(join(cluster.directory, 'postgresql.conf'), '\n' + values.join('\n') + '\n');
  const initialise = async (cluster: Cluster) => {
    signal?.throwIfAborted();
    const pwFile = join(directory, basename(cluster.directory) + '.pw');
    await writeFile(pwFile, cluster.bootstrapPassword + '\n', { flag: 'wx', mode: 0o600 });
    try {
      await command(initdb, ['-D', cluster.directory, '--username=postgres', '--pwfile=' + pwFile,
        '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally {
      await unlink(pwFile);
    }
    await settings(cluster, [
      `listen_addresses = '${loopback}'`, `port = ${cluster.port}`, "unix_socket_directories = ''",
      `max_connections = ${maxConnections}`, "wal_keep_size = '128MB'", 'max_wal_senders = 4',
      'fsync = on', 'synchronous_commit = on',
    ]);
  };
  const start = async (cluster: Cluster) => {
    signal?.throwIfAborted();
    const log = await open(join(directory, basename(cluster.directory) + '.log'), 'a', 0o600);
    let server: ServerProcess;
    try {
      const child = spawn(postgres, ['-D', cluster.directory], { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      let settle!: () => void;
      const exited = new Promise<void>(done => { settle = done; });
      server = { child, exited, stopped: false };
      cluster.server = server;
      const onExit = () => { server.stopped = true; settle(); };
      child.once('exit', onExit);
      child.once('error', onExit);
    } finally {
      await log.close();
    }
    const admin = { port: cluster.port, role: 'postgres', password: cluster.bootstrapPassword };
    await waitFor(async () => {
      assert(!server.stopped, 'Owned PostgreSQL exited during startup');
      try {
        await connect(admin, client => client.query('SELECT 1'), 'postgres');
        return true;
      } catch (error) {
        if (!['ECONNREFUSED', 'ECONNRESET', '57P03'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }, 'Owned PostgreSQL did not become ready', signal);
  };
  const stop = async (cluster: Cluster, requireClean = false) => {
    const server = cluster.server;
    if (!server) return;
    if (!server.stopped) {
      const pid = await readFile(join(cluster.directory, 'postmaster.pid'), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return '';
      });
      if (server.child.pid && pid.split(/\r?\n/, 1)[0] === String(server.child.pid)) {
        try { await command(pg_ctl, ['-D', cluster.directory, '-w', '-t', '30', '-m', 'fast', 'stop']); }
        catch (error) {
          if (requireClean) throw error;
          if (!server.stopped) server.child.kill();
        }
      } else {
        assert(!requireClean, 'Cannot cold-copy PostgreSQL without a verified clean shutdown');
        server.child.kill();
      }
    }
    const timeout = new AbortController();
    try {
      await Promise.race([server.exited, delay(deadlineMs, undefined, { signal: timeout.signal }).then(() => {
        throw new Error('Owned PostgreSQL did not exit');
      })]);
    } finally {
      timeout.abort();
    }
    if (requireClean) assert.equal(server.child.exitCode, 0, 'Primary shutdown was not clean');
    cluster.server = undefined;
  };
  const cleanup = async () => {
    const failures: unknown[] = [];
    for (const cluster of [...clusters].reverse()) {
      try { await stop(cluster); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Owned PostgreSQL processes did not stop');
    const target = await realpath(directory);
    assert(target === directory && dirname(target) === parent && basename(target).startsWith('royal-chat-load-'),
      'Unexpected chat load stand directory');
    await rm(target, { recursive: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    const gameCluster = await allocate('game');
    await initialise(gameCluster);
    await start(gameCluster);
    const { database: game } = await bootstrap(gameCluster, gameRole, runId);
    await connect(game, client => client.query('CREATE SCHEMA royal_game'));

    const primary = await allocate('chat-primary');
    await initialise(primary);
    await start(primary);
    const { database: chat, replicationPassword } = await bootstrap(primary, chatRole, runId, true);
    assert(replicationPassword);
    await stop(primary, true);
    const standby = await allocate('chat-replica', primary.bootstrapPassword);
    await cp(primary.directory, standby.directory, { recursive: true, force: false, errorOnExist: true });
    await settings(primary, [`synchronous_standby_names = 'FIRST 1 (${standbyName})'`]);
    await settings(standby, [`port = ${standby.port}`, 'hot_standby = on',
      `primary_conninfo = 'host=${loopback} port=${primary.port} user=${replicationRole} password=${replicationPassword} application_name=${standbyName}'`]);
    await writeFile(join(standby.directory, 'standby.signal'), '', { flag: 'wx' });
    await start(primary);
    await start(standby);

    const admin = { port: primary.port, role: 'postgres', password: primary.bootstrapPassword };
    const replication = await connect(admin, async client => {
      const primaryConfig = (await client.query(`
        SELECT pg_is_in_recovery() AS recovery, current_setting('fsync') AS fsync,
          current_setting('synchronous_commit') AS synchronous_commit, current_setting('max_connections')::int AS max_connections`
      )).rows[0];
      assert.deepEqual(primaryConfig, { recovery: false, fsync: 'on', synchronous_commit: 'on', max_connections: maxConnections });
      return waitFor(async () => {
        const row = (await client.query(`
          SELECT state, sync_state FROM pg_stat_replication WHERE application_name = $1`, [standbyName])).rows[0];
        return row?.state === 'streaming' && row.sync_state === 'sync' ? row : undefined;
      }, 'Synchronous chat replica did not become ready', signal);
    }, 'postgres');
    const commitMs = await connect(chat, async client => {
      await client.query('CREATE TABLE stand_probe (id uuid PRIMARY KEY)');
      const started = performance.now();
      await client.query('INSERT INTO stand_probe (id) VALUES ($1)', [runId]);
      return performance.now() - started;
    });
    await connect({ ...chat, port: standby.port }, async client => {
      assert.equal((await client.query('SELECT pg_is_in_recovery() AS recovery')).rows[0].recovery, true);
      await waitFor(async () => {
        const result = await client.query('SELECT 1 FROM stand_probe WHERE id = $1', [runId]);
        return result.rowCount === 1 ? true : undefined;
      }, 'Committed chat WAL did not reach the standby', signal);
    });
    const disk = await statfs(parent);
    return {
      runId, game, chat, replicaPort: standby.port, cleanup,
      report: { sameHost: true, separateFailureDomains: false, cpuCount: availableParallelism(), ramBytes: totalmem(),
        freeRamBytes: freemem(), freeDiskBytes: disk.bavail * disk.bsize, maxConnections, replication, commitMs },
    };
  } catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Chat load stand startup and cleanup failed'); }
    throw error;
  }
}

function walletEnvironment(game: Database): NodeJS.ProcessEnv {
  return {
    ...subprocessEnv(), NODE_ENV: 'test', PGHOST: loopback, PGPORT: String(game.port),
    PGUSER: game.role, PGDATABASE: game.role, PGPASSWORD: game.password, PGSSLMODE: 'disable',
  };
}

async function main() {
  const [workDir, duration = '30'] = process.argv.slice(2);
  const seconds = Number(duration);
  if (!workDir || process.argv.length > 4 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 1800) {
    throw new Error('Usage: node --import tsx scripts/chat-load-stand.ts <owned-artifact-directory> [duration-seconds]');
  }
  const controller = new AbortController();
  let child: ChildProcess | undefined;
  const interrupt = () => {
    controller.abort();
    child?.kill('SIGTERM');
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const walletReport = resolve(workDir, 'wallet-baseline.json');
    const standReport = resolve(workDir, 'local-postgres.json');
    for (const report of [walletReport, standReport]) {
      await lstat(report).then(() => { throw new Error('Use a new artifact directory for each baseline'); },
        error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
    const stand = await startLocalChatLoadStand(resolve(workDir), controller.signal);
    try {
      controller.signal.throwIfAborted();
      child = spawn(process.execPath, ['--import', 'tsx', 'scripts/chat-load-wallet-baseline.ts',
        '--run-id', stand.runId, '--phase', 'baseline', '--duration-seconds', duration, '--output', walletReport],
      { env: walletEnvironment(stand.game), stdio: 'inherit', windowsHide: true });
      const code = await new Promise<number | null>((done, fail) => {
        child!.once('error', fail);
        child!.once('exit', done);
      });
      assert.equal(code, 0, 'Synthetic wallet baseline failed');
    } finally {
      await stand.cleanup();
    }
    controller.signal.throwIfAborted();
    await writeFile(standReport, JSON.stringify({ ...stand.report, cleanupConfirmed: true }, null, 2) + '\n', { flag: 'wx' });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Chat load stand failed');
    process.exitCode = 1;
  }
}
