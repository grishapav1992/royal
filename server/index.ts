import { installDemoWallet } from './demoWalletRoutes';
import { installCasinoApiPro } from './casinoApiProRoutes';
import { installNileWallet } from './nileWalletRoutes';
import { installNilePlay } from './nilePlayRoutes';
import { installUsdtWallet } from './usdtWalletRoutes';
import { installCryptoWallet } from './cryptoWalletRoutes';
import { installPaymentCredits } from './payments/credits';
import { installMira } from './miraRoutes';
import { defineServer, defineRoom, matchMaker } from '@colyseus/core';
import express from 'express';
import { resolve } from 'node:path';
import { LobbyRoom } from './LobbyRoom';
import { installAuth } from './authRoutes';
import { accounts, allowedOrigin } from './accounts';
import { lobbyAdmission } from './lobbyAdmission';
import { lobbyRoutes } from './lobbyRoutes';
import { SafeWebSocketTransport } from './websocketSafety';
import { lobbyClusterConfig, LobbyCluster } from './lobbyCluster';
import { selectRoomProcess } from './clusterSelection';
import { createHttpRateLimitRuntime } from './requestRateLimit';

const port = Number(process.env.PORT || 2567);
let stopCrypto: (() => void) | undefined;
let onClusterFailure = () => {};
const clusterConfig = lobbyClusterConfig();
const cluster = clusterConfig ? new LobbyCluster(clusterConfig, () => onClusterFailure()) : undefined;
if (cluster) await cluster.start();
const httpRateLimits = createHttpRateLimitRuntime();
await httpRateLimits.start();
const clusterReady = () => !cluster || (cluster.isReady() && accounts.events.health().connected && !accounts.events.health().failed);
const transport = new SafeWebSocketTransport({
  maxPayload: 8192, pingInterval: 5000, pingMaxRetries: 3,
  beforeUpgrade: (_request, context) => {
    if (!allowedOrigin(context.headers.get('origin') || undefined)) return new Response(null, { status: 403 });
    if (!clusterReady()) return new Response(null, { status: 503 });
  },
}, { maxConnections: lobbyAdmission.config.maxConnections, maxBufferedBytes: lobbyAdmission.config.maxBufferedBytes });
const server = defineServer({
  transport,
  ...(cluster ? { presence: cluster.presence, driver: cluster.driver, publicAddress: cluster.config.publicAddress,
    selectProcessIdToCreateRoom: selectRoomProcess(lobbyAdmission.config.maxRooms) } : {}),
  routes: lobbyRoutes(lobbyAdmission, { acceptNewConnections: !cluster?.config.workerOnly, isReady: clusterReady }),
  beforeListen: async () => {
    await accounts.ready;
    if (cluster) await accounts.events.connect(cluster.presence, { topic: 'royal:account-events:' + accounts.schema, onFailure: () => cluster.fail() });
  },
  rooms: { lobby: defineRoom(LobbyRoom) },
  express: async app => {
    app.disable('x-powered-by');
    // Only local/private proxy peers may supply the client address.
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.use('/api', httpRateLimits.limits.ip());
    app.use('/internal/payments/events', httpRateLimits.limits.ip());
    app.use((req, res, next) => {
      if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_ORIGIN && !req.secure && req.path !== '/healthz' && req.path !== '/internal/payments/events') {
        res.redirect(308, process.env.PUBLIC_ORIGIN + req.originalUrl); return;
      }
      next();
    });
    if (!cluster?.config.workerOnly) {
      installAuth(app, httpRateLimits.limits);
      installDemoWallet(app, undefined, httpRateLimits.limits);
      installCasinoApiPro(app, undefined, undefined, undefined, httpRateLimits.limits);
      installNileWallet(app, undefined, httpRateLimits.limits);
      installNilePlay(app, undefined, httpRateLimits.limits);
      installUsdtWallet(app, undefined, httpRateLimits.limits);
      stopCrypto = installCryptoWallet(app, undefined, undefined, httpRateLimits.limits);
      installPaymentCredits(app, accounts.paymentCredits, accounts.paymentEventSecret);
      await installMira(app);
    }
    app.get('/healthz', async (_req, res) => {
      try {
        if (!clusterReady()) throw new Error('Lobby cluster unavailable');
        await accounts.health(); res.json({ ok: true, service: 'royal-arcade' });
      }
      catch { res.status(503).json({ ok: false, service: 'royal-arcade' }); }
    });
    if (cluster?.config.workerOnly) return;
    app.use(express.static(resolve('dist'), { maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }));
    app.get('/', (_req, res) => res.sendFile(resolve('dist/index.html')));
  },
});
let stoppingAfterFailure = false;
onClusterFailure = () => {
  if (stoppingAfterFailure) return;
  stoppingAfterFailure = true;
  // Missed logout or security events must never leave stale clients authorized.
  transport.disconnectClients();
  console.error('Lobby cluster connection lost. Restarting this process.');
  const watchdog = setTimeout(() => process.exit(1), 10000);
  watchdog.unref();
  void server.gracefullyShutdown(false).finally(() => process.exit(1));
};
server.onBeforeShutdown(async () => {
  stopCrypto?.();
  const locked = lobbyAdmission.drain();
  await cluster?.stop();
  await locked;
  // Close clients before the event bridge stops receiving revocations.
  transport.disconnectClients();
  await accounts.events.close();
});
server.onShutdown(async () => { httpRateLimits.close(); stopCrypto?.(); await accounts.close(); });
await server.listen(port, '0.0.0.0');
await cluster?.activate(matchMaker.processId);
console.log(`Royal server listening on port ${port}`);
