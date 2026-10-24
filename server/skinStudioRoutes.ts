import express, { type Application, type RequestHandler } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';
import { SkinStudioError, type SkinStudioStore } from './skinStudio';

export async function installSkinStudio(app: Application, store: SkinStudioStore = accounts.skinStudio,
  session: (token: string | undefined) => Promise<{ account: { id: string; skin: number | null } } | null | undefined> = token => accounts.session(token), startWorker = true) {
  await store.ready;
  app.get('/api/skin-studio/assets/:id', async (req, res) => {
    try {
      const account = (await session(cookieToken(req.headers.cookie)))?.account;
      const asset = await store.asset(String(req.params.id), account?.id);
      if (!asset) { res.status(404).end(); return; }
      if (!asset.public) res.setHeader('Vary', 'Cookie');
      res.setHeader('Cache-Control', asset.public ? 'public, max-age=31536000, immutable' : 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.type('png').send(asset.image);
    } catch { res.status(503).end(); }
  });
  app.use('/api/skin-studio', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    try {
      const account = (await session(cookieToken(req.headers.cookie)))?.account;
      if (!account || account.skin === null || req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(401).json({ error: 'Войди в свой аккаунт и выбери персонажа.' }); return; }
      res.locals.accountId = account.id; next();
    } catch { res.status(503).json({ error: 'Не удалось проверить аккаунт.' }); }
  }, express.json({ limit: '1600kb', inflate: false }));
  const handle = (action: (req: express.Request, id: string) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { res.json(await action(req, res.locals.accountId)); }
    catch (error) { res.status(error instanceof SkinStudioError ? error.status : 503).json({ error: error instanceof SkinStudioError ? error.message : 'Не удалось проверить генерацию. Обнови её статус.' }); }
  };
  app.get('/api/skin-studio', handle((_req, id) => store.snapshot(id)));
  app.post('/api/skin-studio/generations', handle((req, id) => store.create(id, req.body)));
  app.post('/api/skin-studio/choose', handle((req, id) => {
    if (!req.body || Object.keys(req.body).sort().join(',') !== 'jobId,skinId' || typeof req.body.jobId !== 'string' || typeof req.body.skinId !== 'string') throw new SkinStudioError(400, 'Выбери один из готовых образов.');
    return store.choose(id, req.body.jobId, req.body.skinId);
  }));
  app.post('/api/skin-studio/equip', handle((req, id) => {
    if (!req.body || Object.keys(req.body).join(',') !== 'skinId' || typeof req.body.skinId !== 'string') throw new SkinStudioError(400, 'Выбери образ из гардероба.');
    return store.equip(id, req.body.skinId);
  }));
  app.use('/api/skin-studio', ((error, _req, res, _next) => {
    res.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'Некорректный запрос генерации.' });
  }) as express.ErrorRequestHandler);
  const tick = () => { void store.tick().catch(() => { console.error('Skin studio worker temporarily unavailable'); }); };
  const timer = startWorker ? setInterval(tick, 2000) : undefined; timer?.unref(); if (startWorker) tick();
  return async () => { clearInterval(timer); await store.drain(); };
}
