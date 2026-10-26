import express, { type Application } from 'express';
import { accounts, allowedOrigin, cookieToken } from '../accounts';
import { CryptoError } from '../crypto/config';
import { WALLET_ACCOUNT_HEADER } from '../../src/shared/walletAccount';
import { createDemoWalletRequestLimit } from '../demoWalletRequestLimit';
import type { SandboxPaymentStore } from './sandbox';

export function installSandboxPayments(app: Application, store: SandboxPaymentStore = accounts.sandboxPayments) {
  const base = '/api/nowpayments-sandbox';
  const error = (reason: unknown, res: express.Response) => res.status(reason instanceof CryptoError ? reason.status : 503)
    .json({ error: reason instanceof CryptoError ? reason.message : 'Не удалось подтвердить тестовое пополнение.' });
  app.post(base + '/ipn', express.json({ limit: '32kb', inflate: false }), async (req, res) => {
    try { res.json(await store.receiveIpn(req.body, req.get('x-nowpayments-sig'))); } catch (e) { error(e, res); }
  });
  app.use(base, async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account || req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(401).json({ error: 'Войди в свой аккаунт.' }); return; }
    if (Object.keys(req.query).length) { res.status(400).json({ error: 'Параметры запроса не поддерживаются.' }); return; }
    res.locals.accountId = account.id; next();
  }, createDemoWalletRequestLimit({ limit: 30 }), express.json({ limit: '2kb', inflate: false }));
  app.get(base, async (_req, res) => { try { res.json(await store.snapshot(res.locals.accountId)); } catch (e) { error(e, res); } });
  app.post(base + '/deposits', async (req, res) => { try { res.json(await store.create(res.locals.accountId, req.body)); } catch (e) { error(e, res); } });
  app.post(base + '/deposits/:id/refresh', async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).length) throw new CryptoError(400, 'Некорректный запрос проверки.');
      res.json(await store.refresh(res.locals.accountId, String(req.params.id)));
    } catch (e) { error(e, res); }
  });
  app.use(base, ((reason, _req, res, _next) => {
    res.status(reason?.type === 'entity.too.large' ? 413 : reason?.type === 'entity.parse.failed' ? 400 : 503).json({ error: 'Некорректный запрос тестового пополнения.' });
  }) as express.ErrorRequestHandler);
  const timer = store.config.enabled ? setInterval(() => { void store.sweep().catch(() => {}); }, 15000) : undefined;
  timer?.unref();
  return () => clearInterval(timer);
}
