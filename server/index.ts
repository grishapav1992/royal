import { installDemoWallet } from './demoWalletRoutes';
import { installGameModuleAssets } from './gameModuleAssets';
import { installCasinoApiPro } from './casinoApiProRoutes';
import { installCryptoWallet } from './cryptoWalletRoutes';
import { installPaymentCredits } from './payments/credits';
import { installPaymentMethods } from './payments/methods';
import { installSandboxPayments } from './payments/sandbox-routes';
import { installMira } from './miraRoutes';
import { installSkinStudio } from './skinStudioRoutes';
import { defineServer, defineRoom } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { resolve } from 'node:path';
import { LobbyRoom } from './LobbyRoom';
import { installAuth } from './authRoutes';
import { accounts } from './accounts';
import { installFinanceAdmin } from './admin/routes';

const port = Number(process.env.PORT || 2567);
let stopCrypto: (() => void) | undefined;
let stopSandbox: (() => void) | undefined;
let stopSkinStudio: (() => Promise<void>) | undefined;
const server = defineServer({
  transport: new WebSocketTransport({ maxPayload: 8192, pingInterval: 5000, pingMaxRetries: 3 }),
  beforeListen: async () => { await accounts.ready; },
  rooms: { lobby: defineRoom(LobbyRoom) },
  express: async app => {
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use((req, res, next) => {
      if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_ORIGIN && !req.secure && req.path !== '/healthz' && req.path !== '/internal/payments/events') {
        res.redirect(308, process.env.PUBLIC_ORIGIN + req.originalUrl); return;
      }
      next();
    });
    installPaymentMethods(app);
    installAuth(app);
    installFinanceAdmin(app);
    installDemoWallet(app);
    stopSandbox = installSandboxPayments(app);
    installCasinoApiPro(app);
    stopCrypto = installCryptoWallet(app);
      installPaymentCredits(app, accounts.paymentCredits, accounts.paymentEventSecret);
    await installMira(app);
    stopSkinStudio = await installSkinStudio(app);
    app.get('/healthz', async (_req, res) => {
      try { await accounts.health(); res.json({ ok: true, service: 'royal-arcade' }); }
      catch { res.status(503).json({ ok: false, service: 'royal-arcade' }); }
    });
    installGameModuleAssets(app);
    app.use(express.static(resolve('dist'), { maxAge: '1h', setHeaders: (res, path) => { if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }));
    app.get('/', (_req, res) => res.sendFile(resolve('dist/index.html')));
  },
});
server.onBeforeShutdown(async () => { await stopSkinStudio?.(); });
server.onShutdown(async () => { stopCrypto?.(); stopSandbox?.(); await accounts.close(); });
await server.listen(port, '0.0.0.0');
console.log(`Royal server listening on port ${port}`);
