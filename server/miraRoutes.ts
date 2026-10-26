import { miraLanguage, miraText } from './miraLanguages';
import express, { type Application } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { MiraError, MiraService } from './mira';
import { MiraMemoryStore } from './miraMemory';

export function installMira(app: Application) {
  const memory = new MiraMemoryStore(accounts.schema, accounts.ready);
<<<<<<< HEAD
  const service = new MiraService(fetch, memory, Date.now, id => accounts.drinking.read(id));
  app.use('/api/npc/mira', express.json({ limit: '4kb', inflate: false }), async (req, res, next) => {
=======
  const service = new MiraService(fetch, memory, Date.now, id => accounts.drinking.read(id), id => accounts.skinStudio.appearanceContext(id));
  app.use('/api/npc/mira', express.json({ limit: '4kb' }), async (req, res, next) => {
>>>>>>> origin/main
    res.setHeader('Cache-Control', 'no-store');
    res.locals.miraLanguage = miraLanguage(req.get('Accept-Language'));
    res.setHeader('Content-Language', res.locals.miraLanguage);
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: miraText[res.locals.miraLanguage as keyof typeof miraText].origin }); return; }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account) { res.status(401).json({ error: miraText[res.locals.miraLanguage as keyof typeof miraText].login }); return; }
    res.locals.accountId = account.id; res.locals.accountName = account.name; next();
  });
  app.get('/api/npc/mira', async (req, res) => {
    try { res.json(await service.resume(res.locals.accountId, res.locals.accountName, res.locals.miraLanguage)); }
    catch { res.status(500).json({ error: miraText[res.locals.miraLanguage as keyof typeof miraText].remember }); }
  });
  app.post('/api/npc/mira', async (req, res) => {
    try { res.json(await service.respond(res.locals.accountId, req.body?.message, res.locals.miraLanguage)); }
    catch (error) { res.status(error instanceof MiraError ? error.status : 500).json({ error: error instanceof MiraError ? error.message : miraText[res.locals.miraLanguage as keyof typeof miraText].talk }); }
  });
  app.post('/api/npc/mira/reset', async (_req, res) => {
    try { await service.reset(res.locals.accountId, res.locals.miraLanguage); res.json({ ok: true }); }
    catch (error) { res.status(error instanceof MiraError ? error.status : 500).json({ error: miraText[res.locals.miraLanguage as keyof typeof miraText].reset }); }
  });
  return memory.ready;
}
