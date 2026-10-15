import express, { type Application } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { MiraError, MiraService } from './mira';
import { MiraMemoryStore } from './miraMemory';

export function installMira(app: Application) {
  const memory = new MiraMemoryStore(accounts.schema, accounts.ready);
  const service = new MiraService(fetch, memory, Date.now, id => accounts.drinking.read(id));
  app.use('/api/npc/mira', express.json({ limit: '4kb' }), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account) { res.status(401).json({ error: 'Войди в онлайн-зал, чтобы поговорить с Мирой.' }); return; }
    res.locals.accountId = account.id; res.locals.accountName = account.name; next();
  });
  app.get('/api/npc/mira', async (_req, res) => {
    try { res.json(await service.resume(res.locals.accountId, res.locals.accountName)); }
    catch { res.status(500).json({ error: 'Не получилось вспомнить разговор. Попробуй позже.' }); }
  });
  app.post('/api/npc/mira', async (req, res) => {
    try { res.json(await service.respond(res.locals.accountId, req.body?.message)); }
    catch (error) { res.status(error instanceof MiraError ? error.status : 500).json({ error: error instanceof MiraError ? error.message : 'Не получилось поговорить с Мирой.' }); }
  });
  app.post('/api/npc/mira/reset', async (_req, res) => {
    try { await service.reset(res.locals.accountId); res.json({ ok: true }); }
    catch (error) { res.status(error instanceof MiraError ? error.status : 500).json({ error: 'Дождись ответа Миры.' }); }
  });
  return memory.ready;
}
