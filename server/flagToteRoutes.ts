import {isUnpublishedArcadeGame} from '../src/shared/arcadeCatalog';
import type { Application } from 'express';
import type { FlagToteStore } from './flagTote';
import { WalletError } from './demoWallet';
import { TOTE_HEADER } from '../src/shared/flagTote';

/** Installed below the common wallet's cookie, account, origin, size and rate guards. */
export function installFlagToteRoutes(app: Application, store: FlagToteStore) {
  app.use('/api/demo-wallet/flag-tote', (req, res, next) => {
    if (req.get(TOTE_HEADER) !== '1') { res.status(409).json({ error: 'Обнови страницу для тотализатора.' }); return; }
    next();
  });
  app.get('/api/demo-wallet/flag-tote', async (req, res) => {
    if (Object.keys(req.query).length) { res.status(400).json({ error: 'Параметры раунда не поддерживаются.' }); return; }
    try { res.json(await store.snapshot(res.locals.accountId)); }
    catch { res.status(500).json({ error: 'Не удалось проверить общий раунд. Повтори запрос.' }); }
  });
  app.post('/api/demo-wallet/flag-tote', async (req, res) => {
    try { if(isUnpublishedArcadeGame('flag-tote')&&!await store.hasAcceptedOperation(res.locals.accountId,req.body?.id))throw new WalletError(410,'Эта игра недоступна. Новая ставка не принята.');res.json(await store.bet(res.locals.accountId, req.body)); }
    catch (error) {
      if (error instanceof WalletError) res.status(error.status).json({ error: error.message });
      else { console.error('Flag tote operation failed'); res.status(500).json({ error: 'Ответ не подтверждён. Проверь ту же ставку.' }); }
    }
  });
  // One shared backend clock, independent of whether any game window remains open.
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void store.advance().catch(() => console.error('Flag tote clock failed')).finally(() => { running = false; });
  };
  const timer = setInterval(tick, 1000); timer.unref(); tick();
  return () => clearInterval(timer);
}
