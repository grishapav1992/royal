import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { type Application } from 'express';
import { accounts, allowedOrigin, cookieToken, type AccountStore } from './accounts';
import { CasinoApiProClient, CasinoApiProError, casinoApiProConfig, walletBinding, type CasinoApiProConfig } from './casinoApiPro';
import { demoDecimal, ProviderWalletError, type ProviderOperation } from './casinoApiProWallet';

export function verifyWalletSignature(secret: string, timestamp: unknown, signature: unknown, raw: Buffer, now = Date.now()) {
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256',secret).update(timestamp).update('.').update(raw).digest();
  return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}

export function installCasinoApiPro(app: Application, config = casinoApiProConfig(), store: AccountStore = accounts, request: typeof fetch = fetch) {
  const client = config ? new CasinoApiProClient(config,request) : undefined;
  const binding = config ? walletBinding(config) : '';
  app.use('/api/casinoapipro/wallet', express.raw({type:'application/json',limit:'16kb'}), (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!config) { res.status(503).json({error_code:'NOT_CONFIGURED'}); return; }
    if (!Buffer.isBuffer(req.body) || !verifyWalletSignature(config.walletSecret,req.get('x-timestamp'),req.get('x-signature'),req.body)) { res.status(401).json({error_code:'INVALID_REQUEST'}); return; }
    try { res.locals.callback = JSON.parse(req.body.toString('utf8')); next(); }
    catch { res.status(400).json({error_code:'INVALID_REQUEST'}); }
  });
  for (const operation of ['balance','debit','credit','refund','rollback'] as ProviderOperation[]) {
    app.post(`/api/casinoapipro/wallet/${operation}`, async (_req,res) => {
      try { res.json(await store.casinoApiProWallet.callback(operation,res.locals.callback,config!.currency,binding)); }
      catch (error) {
        if (error instanceof ProviderWalletError) res.status(error.status).json({error_code:error.code});
        else res.status(500).json({error_code:'WALLET_UNAVAILABLE'});
      }
    });
  }
  app.use('/api/casinoapipro', express.json({limit:'2kb'}), async (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({error:'Этот источник запросов не разрешён.'}); return; }
    const account = (await store.session(cookieToken(req.headers.cookie)))?.account;
    if (!account) { res.status(401).json({error:'Войди в онлайн-зал, чтобы играть на свой демобаланс.'}); return; }
    res.locals.accountId = account.id; next();
  });
  app.post('/api/casinoapipro/status', async (_req,res) => {
    const playerId = await store.casinoApiProWallet.player(res.locals.accountId);
    res.json({configured:!!config,walletConnected:!!config && await store.casinoApiProWallet.verified(binding),currency:config?.currency ?? 'USD',playerId,balance:demoDecimal(Math.round((await store.wallet.snapshot(res.locals.accountId)).balance * 100))});
  });
  const failure = (res: express.Response, error: unknown) => {
    if (error instanceof CasinoApiProError) res.status(error.status).json({error:error.message,code:error.code});
    else res.status(502).json({error:'Поставщик сейчас недоступен. Попробуй ещё раз.'});
  };
  app.get('/api/casinoapipro/games', async (_req,res) => {
    if (!client) { res.status(503).json({error:'Тестовый доступ Casino Api Pro ещё не настроен.'}); return; }
    try { res.json({games:await client.games(),currency:config!.currency}); }
    catch (error) { failure(res,error); }
  });
  const pending = new Set<string>(), launches = new Map<string,number[]>();
  app.post('/api/casinoapipro/sessions', async (req,res) => {
    if (!client) { res.status(503).json({error:'Тестовый доступ Casino Api Pro ещё не настроен.'}); return; }
    const accountId = String(res.locals.accountId), playerId = await store.casinoApiProWallet.player(accountId);
    if (!await store.casinoApiProWallet.verified(binding)) { res.status(409).json({code:'WALLET_NOT_VERIFIED',error:'Поставщик ещё не подтвердил подключение нашего кошелька. Сначала нужна проверка баланса в его кабинете.'}); return; }
    const recent = (launches.get(accountId) ?? []).filter(time => time > Date.now()-60000);
    if (pending.has(accountId) || recent.length >= 10) { res.status(429).json({error:'Подожди немного перед запуском следующей игры.'}); return; }
    if (launches.size > 10000) for (const [id,times] of launches) { if (times.at(-1)! < Date.now()-60000) launches.delete(id); }
    launches.set(accountId,[...recent,Date.now()]); pending.add(accountId);
    try { res.json(await client.launch(req.body?.gameId,playerId)); }
    catch (error) { failure(res,error); }
    finally { pending.delete(accountId); }
  });
}
