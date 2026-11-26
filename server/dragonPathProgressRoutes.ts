import type { Application } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import type { PostgresDatabase } from './database';
import { createDemoWalletRequestLimit } from './demoWalletRequestLimit';
import { DRAGON_PATH_BELT_MAX, DRAGON_PATH_BELT_PATH } from '../src/shared/dragonPathBelt';
import { DRAGON_PATH_GAME } from '../src/shared/dragonPathProtocol';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

export async function dragonPathCompletedRounds(db: PostgresDatabase, accountId: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS completed FROM (
    SELECT 1 FROM demo_casino_sessions s
    WHERE s.account_id=? AND s.game_id=? AND s.state='settled' AND EXISTS (
      SELECT 1 FROM (
        SELECT s.id AS id UNION SELECT r.id FROM demo_casino_requests r
        WHERE r.account_id=s.account_id AND r.session_id=s.id
      ) operations JOIN demo_ledger l ON l.account_id=s.account_id AND l.operation_id=operations.id
      WHERE l.source=s.game_id AND l.entry_type IN ('bet', 'refund', 'rollback')
      HAVING BOOL_OR(l.entry_type='bet' AND l.amount_units<0) AND SUM(l.amount_units)<0
    ) LIMIT ?
  ) eligible`).get(accountId, DRAGON_PATH_GAME, DRAGON_PATH_BELT_MAX);
  return Number(row!.completed);
}

export function installDragonPathProgress(app: Application) {
  app.get(DRAGON_PATH_BELT_PATH, async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ error: 'origin-forbidden' });
      return;
    }
    try {
      const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
      if (!account) { res.status(401).json({ error: 'sign-in-required' }); return; }
      if (req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(409).json({ error: 'account-changed' }); return; }
      res.locals.accountId = account.id;
      next();
    } catch { res.status(503).json({ error: 'progress-unavailable' }); }
  }, createDemoWalletRequestLimit(), async (_req, res) => {
    try { res.json({ completedRounds: await dragonPathCompletedRounds(accounts.progression.db, res.locals.accountId) }); }
    catch { res.status(503).json({ error: 'progress-unavailable' }); }
  });
}
