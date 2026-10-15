import { spawn, type ChildProcess } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { temporaryDatabase } from './database-test';
import { installLoopbackNetworking } from './load-server-metrics';
import { DEFAULT_GAME_PROCESSES, standDatabaseConnectionLimit } from './load-stand-limits';
import { createGeneratorCompletionHold, generatorCompletionExitCode, generatorCompletionOptions } from './load-generator-completion';

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([exited, new Promise<void>(done => { timer = setTimeout(done, 15000); })]); }
  finally { if (timer) clearTimeout(timer); }
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
}

async function run() {
  if (process.argv.includes('--help')) {
    console.log('node dist-load/database.mjs dist-load/cluster.mjs --metrics-script dist-load/metrics.mjs --server-bundle dist-server/index.js --stand-manifest /private/path/stand.json [cluster options]'); return;
  }
  const entry = process.argv[2] && await realpath(resolve(process.argv[2]));
  if (!entry || !entry.endsWith('.mjs') || !(await stat(entry)).isFile()) throw new Error('A prebuilt .mjs Node entrypoint is required');
  const options = generatorCompletionOptions(process.argv.slice(3));
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'ROYAL_REDIS_SERVER_BINARY', 'ROYAL_CADDY_BINARY']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // Embedded PostgreSQL subprocesses inherit this process environment too.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env, { NODE_ENV: 'test' });
  installLoopbackNetworking();
  const processFlag = process.argv.indexOf('--game-processes', 3);
  const gameProcesses = processFlag < 0 ? DEFAULT_GAME_PROCESSES : Number(process.argv[processFlag + 1]);
  const completion = options.completionFile ? await createGeneratorCompletionHold(options.completionFile, options.manifestFile!) : undefined;
  let database;
  try { database = await temporaryDatabase({ maxConnections: standDatabaseConnectionLimit(gameProcesses) }); }
  catch (error) { await completion?.close(); throw error; }
  let child: ChildProcess | undefined, interrupted = false, code = 1;
  const interrupt = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    child = spawn(process.execPath, [entry, ...options.args], { stdio: 'inherit', env: { ...env, ...database.env } });
    code = await new Promise<number>((done, reject) => { child!.once('error', reject); child!.once('exit', result => done(result ?? 1)); });
  } finally {
    if (child) await stop(child);
    if (!completion) { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
    await database.cleanup();
    if (completion) {
      try {
        const finished = await completion.wait(() => interrupted);
        code = generatorCompletionExitCode(code, finished.generatorExitCode);
      } catch { if (code === 0) code = 1; }
      finally {
        await completion.close();
        process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      }
    }
  }
  // embedded-postgres has a beforeExit hook; preserve the child result after cleanup.
  process.exit(interrupted ? 1 : code);
}
void run().catch(() => { console.error('Prebuilt temporary database stand failed'); process.exit(1); });
