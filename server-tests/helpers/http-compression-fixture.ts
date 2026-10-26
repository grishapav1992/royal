import express from 'express';
import { createServer } from 'node:http';

if (process.env.NODE_ENV !== 'test' || !process.send) throw Error('Isolated test child required');
const app = express();
let closeAccounts: (() => Promise<void>) | undefined;
if (process.argv.includes('--application')) {
  const {accounts} = await import('../../server/accounts');
  const {installAuth} = await import('../../server/authRoutes');
  const {installMira} = await import('../../server/miraRoutes');
  const {installUsdtWallet} = await import('../../server/usdtWalletRoutes');
  const {installCasinoApiPro} = await import('../../server/casinoApiProRoutes');
  await accounts.ready; closeAccounts = () => accounts.close();
  installAuth(app); installMira(app); installUsdtWallet(app); installCasinoApiPro(app);
} else {
  // Exercise the patched dependency with decompression enabled as well as the application restriction.
  app.post('/probe', express.json({limit: '4kb'}), (req, res) => {
    process.send!({phase: 'parsed'});
    const finish = () => res.json(req.body);
    if (req.complete) finish(); else req.once('end', finish);
  });
}
app.get('/healthz', (_req, res) => res.json({ok: true}));
app.use(((error, _req, res, _next) => {
  res.status(error.status ?? 500).json({error: 'Rejected request'});
}) as express.ErrorRequestHandler);
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing local server');
process.send({phase: 'ready', port: address.port});
process.on('message', async value => {
  if (value !== 'stop') return;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await closeAccounts?.(); process.exit(0);
});
