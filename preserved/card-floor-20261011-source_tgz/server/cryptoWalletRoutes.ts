import express, { type Application, type RequestHandler, type ErrorRequestHandler } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { CryptoError } from './crypto/config';
import { validIpn } from './crypto/nowpayments';
import type { CryptoStore } from './crypto/store';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { gameAccountId } from '../src/shared/nileWallet';
import { createDemoWalletRequestLimit } from './demoWalletRequestLimit';

export function installCryptoWallet(app: Application, store: CryptoStore = accounts.cryptoWallet,
  session: (token: string | undefined) => Promise<{ account: { id: string } } | null | undefined> = token => accounts.session(token)) {
  const bodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') res.status(413).json({ error: 'Слишком большой запрос.' });
    else if (error?.type === 'entity.parse.failed') res.status(400).json({ error: 'Некорректный запрос.' });
    else next(error);
  };
  app.post('/api/crypto-wallet/ipn', express.json({ limit: '32kb', inflate: false }), bodyError, async (req: express.Request, res: express.Response) => {
    if (!store.config.enabled) { res.status(503).json({ ok: false }); return; }
    if (!validIpn(req.body, req.get('x-nowpayments-sig'), store.config.ipnSecret)) { res.status(401).json({ ok: false }); return; }
    try { await store.handleIpn(req.body); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  });
  const authorize: RequestHandler = async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешен.' }); return; }
    const account = (await session(cookieToken(req.headers.cookie)))?.account;
    if (!account || req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(401).json({ error: 'Войди в свой аккаунт, чтобы использовать кошелек.' }); return; }
    if (Object.keys(req.query).length) { res.status(400).json({ error: 'Параметры запроса не поддерживаются.' }); return; }
    res.locals.accountId = account.id; next();
  };
  app.use('/api/crypto-wallet', authorize, createDemoWalletRequestLimit({ limit: 60 }), express.json({ limit: '2kb', inflate: false }), bodyError);
  const handle = (fn: (req: express.Request, accountId: string) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { res.json(await fn(req, res.locals.accountId)); }
    catch (error) { res.status(error instanceof CryptoError ? error.status : 503).json({ error: error instanceof CryptoError ? error.message : 'Не удалось подтвердить операцию. Проверь ее статус позже.' }); }
  };
  app.get('/api/crypto-wallet', handle((_req, id) => store.snapshot(id)));
  app.get('/api/crypto-wallet/currencies', handle(async () => ({ currencies: await store.currencies() })));
  app.post('/api/crypto-wallet/display-rate', handle(req => {
    if (!req.body || Object.keys(req.body).join(',') !== 'currency') throw new CryptoError(400, 'Некорректный запрос курса.');
    return store.displayRate(req.body.currency);
  }));
  app.post('/api/crypto-wallet/deposits', handle((req, id) => store.deposit(id, req.body)));
  app.post('/api/crypto-wallet/quotes', handle((req, id) => store.quote(id, req.body)));
  app.post('/api/crypto-wallet/withdrawals', handle((req, id) => store.withdraw(id, req.body)));
  app.post('/api/crypto-wallet/rounds', handle((req, id) => store.play(id, req.body)));
  app.post('/api/crypto-wallet/operations/:id/refresh', handle((req, accountId) => {
    if (!gameAccountId(req.params.id) || !req.body || Object.keys(req.body).length) throw new CryptoError(400, 'Некорректный запрос проверки.');
    return store.refresh(accountId, String(req.params.id));
  }));
  let running = false;
  const timer = setInterval(() => {
    if (running || !store.config.enabled) return;
    running = true;
    void store.reconcile().catch(() => {}).finally(() => { running = false; });
  }, 15000);
  timer.unref();
  return () => clearInterval(timer);
}
