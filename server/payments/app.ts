import express from 'express';
import { gameAccountId } from '../../src/shared/nileWallet';
import { CryptoError } from '../crypto/config';
import type { CryptoStore } from '../crypto/store';
import { validateServiceSecret, verifyServiceSignature } from './protocol';
import { requireFinanceAdmin } from '../admin/validation';
import { paymentFinanceReport } from '../admin/paymentFinance';
import type { TelegramStarsStore } from './telegram-stars';
import { validTelegramSecret } from './telegram-provider';

export function createPaymentApp(store: CryptoStore, requestSecret: string, stars?: TelegramStarsStore) {
  validateServiceSecret(requestSecret);
  if (store.config.games) throw new Error('The payment service does not run games');
  const app = express(); app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/healthz', async (_req, res) => {
    try { await store.ready; await store.db.prepare('SELECT 1').get(); res.json({ ok: true, service: 'royal-payments' }); }
    catch { res.status(503).json({ ok: false }); }
  });
  const fail = (error: unknown, res: express.Response) => res.status(error instanceof CryptoError ? error.status : 503)
    .json({ error: error instanceof CryptoError ? error.message : 'Платежный сервис не подтвердил операцию.' });
  app.post('/api/telegram-stars/webhook', (req, res, next) => {
    if (!stars || !validTelegramSecret(req.get('x-telegram-bot-api-secret-token'), stars.config.webhookSecret)) {
      res.status(401).json({ ok: false }); return;
    }
    next();
  }, express.json({ limit: '32kb', inflate: false }), async (req, res) => {
    try { res.json(await stars!.receive(req.body)); } catch (error) { fail(error, res); }
  });
  app.post('/api/crypto-wallet/ipn', express.json({ limit: '32kb', inflate: false }), async (req, res) => {
    try { await store.receiveIpn(req.body, req.get('x-nowpayments-sig')); res.json({ ok: true }); }
    catch (error) { fail(error, res); }
  });
  app.use('/internal', express.raw({ type: 'application/json', limit: '4kb', inflate: false }), (req, res, next) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (req.get('origin') || Object.keys(req.query).length || !verifyServiceSignature(requestSecret, 'request', req.get('x-royal-payments-timestamp'),
      req.get('x-royal-payments-signature'), req.method, req.originalUrl, body)) { res.status(401).json({ error: 'Нужна сервисная подпись.' }); return; }
    try { req.body = body ? JSON.parse(body) : undefined; next(); }
    catch { res.status(400).json({ error: 'Некорректный запрос.' }); }
  });
  app.post('/internal/ipn', async (req, res) => {
    try { await store.receiveIpn(req.body, req.get('x-nowpayments-sig')); res.json({ ok: true }); }
    catch (error) { fail(error, res); }
  });
  app.post('/internal/admin/:action',async(req,res)=>{
    try{
      if(!req.body||Object.keys(req.body).sort().join(',')!=='actorId,value') throw new CryptoError(400,'Некорректный запрос.');
      requireFinanceAdmin(req.body.actorId);
      if(req.params.action==='report') res.json(await paymentFinanceReport(store,req.body.value));
      else if(req.params.action==='adjust'){
        if(req.body.value?.actorId!==req.body.actorId) throw new CryptoError(403,'Неверный автор действия.');
        res.json(await store.adminAdjust(req.body.value));
      } else if(req.params.action==='refresh'){
        const v=req.body.value;
        if(!v||Object.keys(v).sort().join(',')!=='operationId,playerId'||![v.operationId,v.playerId].every(gameAccountId))throw new CryptoError(400,'Некорректная операция.');
        res.json(await store.refresh(v.playerId,v.operationId));
      } else throw new CryptoError(404,'Действие не найдено.');
    }catch(error){fail(error,res);}
  });
  const handle = (method: 'get' | 'post', action: string, fn: (id: string, body: unknown, req: express.Request) => Promise<unknown>, register = true) => {
    app[method]('/internal/users/:user/' + action, async (req, res) => {
      try {
        const id = String(req.params.user);
        if (!gameAccountId(id)) throw new CryptoError(400, 'Некорректный игрок.');
        if (register && store.config.enabled) await store.db.prepare('INSERT INTO accounts(id) VALUES (?) ON CONFLICT DO NOTHING').run(id);
        res.json(await fn(id, req.body, req));
      } catch (error) { fail(error, res); }
    });
  };
  handle('get', 'snapshot', id => store.snapshot(id));
  handle('get', 'currencies', () => store.currencies(), false);
  handle('post', 'display-rate', (_id, body) => {
    if (!body || Object.keys(body).join(',') !== 'currency') throw new CryptoError(400, 'Некорректный запрос курса.');
    return store.displayRate((body as { currency: unknown }).currency);
  }, false);
  handle('post', 'deposits', (id, body) => store.deposit(id, body));
  handle('get', 'stars', async id => stars ? stars.snapshot(id) : { enabled: false, operations: [] });
  handle('post', 'stars', (id, body) => {
    if (!stars) throw new CryptoError(503, 'Оплата Telegram Stars пока не подключена.');
    return stars.create(id, body);
  });
  handle('post', 'quotes', (id, body) => store.quote(id, body));
  handle('post', 'withdrawals', (id, body) => store.withdraw(id, body));
  handle('post', 'operations/:operation/refresh', (id, body, req) => {
    if (!gameAccountId(req.params.operation) || !body || Object.keys(body).length) throw new CryptoError(400, 'Некорректный запрос проверки.');
    return store.refresh(id, String(req.params.operation));
  });
  app.use((_req, res) => res.status(404).json({ error: 'Метод платежного сервиса не найден.' }));
  app.use(((error, _req, res, _next) => {
    res.status(error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 503).json({ error: 'Некорректный запрос платежного сервиса.' });
  }) as express.ErrorRequestHandler);
  return app;
}
