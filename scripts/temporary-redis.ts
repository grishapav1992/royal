import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Redis } from 'ioredis';

export async function freeLocalPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export async function temporaryRedis() {
  const directory = await mkdtemp(join(tmpdir(), 'royal-redis-'));
  const port = await freeLocalPort();
  const child = spawn(process.env.ROYAL_REDIS_SERVER_BINARY || 'redis-server', [
    '--bind', '127.0.0.1', '--protected-mode', 'yes', '--port', String(port),
    '--save', '', '--appendonly', 'no', '--dir', directory, '--loglevel', 'warning',
  ], { stdio: 'ignore' });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  const url = 'redis://127.0.0.1:' + port;
  const client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, retryStrategy: null, connectTimeout: 500, maxRetriesPerRequest: 1 });
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
    return { url, port, stop, cleanup: async () => { client.disconnect(); await stop(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    client.disconnect(); await stop(); await rm(directory, { recursive: true, force: true }); throw error;
  }
}
