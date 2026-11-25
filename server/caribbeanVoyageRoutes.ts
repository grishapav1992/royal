import express, {type Application, type RequestHandler} from 'express';
import {accounts, allowedOrigin, cookieToken} from './accounts';
import {createDemoWalletRequestLimit} from './demoWalletRequestLimit';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
import {CaribbeanVoyageError, CaribbeanVoyageStore} from './caribbeanVoyage';

type Session = (token: string | undefined) => Promise<{account: {id: string}} | null | undefined>;

/** The voyage shares the account database. It is not part of the wallet and never blocks a round. */
export function installCaribbeanVoyage(app: Application, store = new CaribbeanVoyageStore(accounts.progression.db, accounts.ready), session: Session = token => accounts.session(token)) {
  app.use('/api/caribbean-voyage', async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({error: 'origin-forbidden'}); return; }
    try {
      const account = (await session(cookieToken(req.headers.cookie)))?.account;
      if (!account) { res.status(401).json({error: 'sign-in-required'}); return; }
      if (req.get(WALLET_ACCOUNT_HEADER) !== account.id) { res.status(409).json({error: 'account-changed'}); return; }
      res.locals.accountId = account.id; next();
    } catch { res.status(503).json({error: 'voyage-unavailable'}); }
  }, createDemoWalletRequestLimit(), express.json({limit: '1kb', inflate: false}));
  app.use('/api/caribbean-voyage', ((error, _req, res, next) => {
    if (error?.status >= 400 && error.status < 500) res.status(error.status).json({error: 'invalid-request'}); else next(error);
  }) as express.ErrorRequestHandler);
  const handle = (action: (account: string, body: unknown) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { res.json(await action(res.locals.accountId, req.body)); }
    catch (error) { res.status(error instanceof CaribbeanVoyageError ? error.status : 503).json({error: error instanceof CaribbeanVoyageError ? error.code : 'voyage-unavailable'}); }
  };
  app.get('/api/caribbean-voyage', handle(account => store.snapshot(account)));
  app.post('/api/caribbean-voyage', handle((account, body) => store.operate(account, body)));
}
