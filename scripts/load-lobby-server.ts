import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { isolatedLoadLobbyEnvironment, parseLoadLobbyConfig } from './load-lobby-config';
import { liveLoadLobbyProcesses, LoadLobbyOwnerLease, selectLoadLobbyProcess } from './load-lobby-owners';
import { boundedLoadLobbyRoom, LoadLobbyTransport, loadLobbyRoutes } from './load-lobby-room';
import { assertOwnedLoadDatabase, LOAD_RUN_REDIS_KEY } from './load-stand-ownership';

type Accounts = typeof import('../server/accounts')['accounts'];
type RedisConnection = { disconnect(): void };

async function run() {
  const config = parseLoadLobbyConfig(process.env);
  if (!process.connected || !process.send || await assertOwnedLoadDatabase() !== config.runId) throw new Error('load-lobby-owned-run-required');
  const lifetime = new AbortController();
  const connections: RedisConnection[] = [];
  let lease: LoadLobbyOwnerLease | undefined, transport: LoadLobbyTransport | undefined;
  let server: { gracefullyShutdown(exit?: boolean): Promise<void> } | undefined, accounts: Accounts | undefined;
  let failed = false, stopping = false, watchdog: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    watchdog = setTimeout(() => process.exit(1), 10_000);
    watchdog.unref();
  };
  const unavailable = () => {
    if (stopping || lifetime.signal.aborted) return;
    failed = true; stop();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop); process.once('disconnect', stop);
  if (!process.connected) stop();
  const ready = () => !lifetime.signal.aborted && lease?.ready === true;
  try {
    lifetime.signal.throwIfAborted();
    const [{ Redis }, { RedisPresence }, { RedisDriver }] = await Promise.all([
      import('ioredis'), import('@colyseus/redis-presence'), import('@colyseus/redis-driver'),
    ]);
    const redisOptions = { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2500,
      commandTimeout: 2500, retryStrategy: null };
    const watch = <T extends RedisConnection & { on(event: string, handler: () => void): unknown }>(client: T) => {
      connections.push(client);
      client.on('close', unavailable); client.on('error', unavailable);
      return client;
    };
    const pub = watch(new Redis(config.redisUrl, redisOptions));
    await pub.connect();
    if (await pub.get(LOAD_RUN_REDIS_KEY) !== config.runId) throw new Error('load-lobby-owned-redis-required');

    class OwnedPresence extends RedisPresence {
      get subscriber() { return this.sub as typeof pub; }
      override shutdown() { /* The stand releases both owned Redis connections after Colyseus drains. */ }
    }
    const presence = new OwnedPresence(pub), sub = watch(presence.subscriber), rooms = watch(new Redis(config.redisUrl, redisOptions));
    await Promise.all([sub, rooms].map(async client => {
      await client.connect();
      if (await client.get(LOAD_RUN_REDIS_KEY) !== config.runId) throw new Error('load-lobby-owned-redis-required');
    }));
    lease = new LoadLobbyOwnerLease(pub, config.runId, config.workerId, unavailable);
    await lease.start();
    lifetime.signal.throwIfAborted();

    process.env = isolatedLoadLobbyEnvironment(config, process.env);
    const [{ accounts: store, cookieToken }, { LobbyRoom }] = await Promise.all([import('../server/accounts'), import('../server/LobbyRoom')]);
    accounts = store;
    await store.ready;
    lifetime.signal.throwIfAborted();

    transport = new LoadLobbyTransport(ready);
    const lobby = defineServer({ transport, presence, driver: new RedisDriver(rooms), publicAddress: config.publicAddress,
      selectProcessIdToCreateRoom: selectLoadLobbyProcess(() => liveLoadLobbyProcesses(presence, matchMaker.stats.fetchAll)),
      rooms: { lobby: defineRoom(boundedLoadLobbyRoom(LobbyRoom, ready, config.maxAuthWork)) },
      routes: loadLobbyRoutes(config.workerOnly, ready, cookieToken), greet: false, gracefullyShutdown: false,
      express: app => {
        app.disable('x-powered-by');
        app.get('/healthz', async (_request, response) => {
          response.setHeader('Cache-Control', 'no-store');
          try {
            if (!ready() || !await lease!.checkReady()) throw new Error('load-lobby-not-ready');
            await store.health();
            if (!ready()) throw new Error('load-lobby-not-ready');
            response.json({ ok: true, workerId: config.workerId });
          } catch { response.status(503).json({ ok: false }); }
        });
      },
    });
    server = lobby;
    await lobby.listen(config.listenPort, '127.0.0.1');
    lifetime.signal.throwIfAborted();
    await lease.activate(matchMaker.processId);
    if (!lifetime.signal.aborted) await new Promise<void>(resolve => lifetime.signal.addEventListener('abort', () => resolve(), { once: true }));
  } catch {
    if (!lifetime.signal.aborted) failed = true;
  } finally {
    stopping = true;
    stop();
    transport?.disconnectClients();
    try { await lease?.close(); } catch { failed = true; }
    try { await server?.gracefullyShutdown(false); } catch { failed = true; }
    transport?.shutdown();
    for (const client of connections) client.disconnect();
    try { await accounts?.close(); } catch {
      failed = true;
      await accounts?.financeAdmin.db.close().catch(() => {});
    }
    clearTimeout(watchdog);
    process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('disconnect', stop);
  }
  if (failed) throw new Error('load-lobby-stand-failed');
}

try {
  await run();
  process.exit(0);
} catch {
  console.error('load-lobby-stand-failed');
  process.exit(1);
}
