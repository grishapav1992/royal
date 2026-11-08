import type { Application } from 'express';
import { accounts } from './accounts';
import { CryptoError } from './crypto/config';

// Install after the demo wallet router to share its authorization and request limit.
export function installClubFineRoutes(app: Application) {
  const path = '/api/demo-wallet/club-fine';
  app.get(path, async (_req, res) => {
    const accountId = res.locals.accountId;
    if (typeof accountId !== 'string') { res.sendStatus(401); return; }
    try {
      const serverNow = await accounts.clubSanctions.gameTime();
      res.json({ sanction: await accounts.clubSanctions.active(accountId, serverNow), serverNow });
    } catch { res.status(503).json({ error: 'Не удалось загрузить штраф.' }); }
  });
  app.post(path, async (req, res) => {
    const accountId = res.locals.accountId;
    if (typeof accountId !== 'string') { res.sendStatus(401); return; }
    try {
      const result = await accounts.clubSanctions.pay(accountId, req.body);
      if (result.status === 'paid' && !result.replayed) accounts.events.emit('club-fine-paid', accountId, result.receipt.sanctionId);
      res.json({ ...result, serverNow: await accounts.clubSanctions.gameTime() });
    } catch (error) {
      if (error instanceof CryptoError) res.status(error.status).json({ error: error.message });
      else res.status(503).json({ error: 'Ответ по оплате штрафа не подтверждён. Повтори тот же запрос.' });
    }
  });
}
