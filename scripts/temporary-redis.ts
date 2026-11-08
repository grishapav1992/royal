import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Redis } from 'ioredis';
import { LOAD_RUN_REDIS_KEY } from './load-stand-ownership';

export async function freeLocalPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export async function temporaryRedis(runId: string) {
  const port = await freeLocalPort();
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'royal-redis-'));
  const removeDirectory = async () => {
    const target = await realpath(directory).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!target) return;
    if (target !== directory || dirname(target) !== temporaryRoot || !basename(target).startsWith('royal-redis-')) {
      throw new Error('Unexpected temporary Redis directory');
    }
    await rm(target, { recursive: true, force: true });
  };
  const child = spawn(process.env.ROYAL_REDIS_SERVER_BINARY || 'redis-server', [
    '--bind', '127.0.0.1', '--protected-mode', 'yes', '--port', String(port),
    '--save', '', '--appendonly', 'no', '--dir', directory, '--loglevel', 'warning',
  ], { stdio: 'ignore' });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  const url = 'redis://127.0.0.1:' + port;
  const client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, retryStrategy: null, connectTimeout: 500, commandTimeout: 1500, maxRetriesPerRequest: 1 });
  client.on('error', () => {});
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await done; } finally { clearTimeout(timer); }
  };
  try {
    for (let attempt = 0; ; attempt++) {
      if (spawnError) throw new Error('Install redis-server or set ROYAL_REDIS_SERVER_BINARY to a local Redis-compatible executable');
      if (child.exitCode !== null || attempt >= 100) throw new Error('Temporary Redis did not start');
      try {
        if (client.status !== 'ready') await client.connect();
        if (await client.ping() === 'PONG') break;
      } catch { client.disconnect(); await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    const runningPid = /(?:^|\r?\n)process_id:(\d+)(?:\r?\n|$)/.exec(await client.info('server'))?.[1];
    if (!child.pid || Number(runningPid) !== child.pid || await client.set(LOAD_RUN_REDIS_KEY, runId, 'NX') !== 'OK') {
      throw new Error('Temporary Redis ownership could not be verified');
    }
    return { url, port, stop, cleanup: async () => { client.disconnect(); await stop(); await removeDirectory(); } };
  } catch (error) {
    client.disconnect(); await stop(); await removeDirectory(); throw error;
  }
}
