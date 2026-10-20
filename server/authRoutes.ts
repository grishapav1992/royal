import express, { type Application, type Request, type Response } from 'express';
import { accounts, allowedOrigin, AuthError, cookieToken, SESSION_AGE } from './accounts';

export function installAuth(app: Application) {
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN?.startsWith('https://')) throw new Error('PUBLIC_ORIGIN must be an HTTPS URL in production');
  app.set('trust proxy', 1);
  const attempts = new Map<string, { count: number; until: number }>();
  let hashing = 0;
  const timer = setInterval(() => { for (const [key, value] of attempts) if (value.until < Date.now()) attempts.delete(key); }, 60000); timer.unref();
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  app.use('/api/auth', (_req, res, next) => { res.setHeader('Cache-Control','no-store'); next(); }, express.json({ limit: '4kb' }), (req, res, next) => {
    if (!allowedOrigin(req.get('origin'))) { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    next();
  });
  const token = (req: Request) => cookieToken(req.headers.cookie);
  const guarded = (action: (req: Request, res: Response) => void | Promise<void>) => async (req: Request, res: Response) => {
    try { await action(req,res); } catch (error) {
      if (error instanceof AuthError) res.status(error.status).json({ error: error.message });
      else { console.error('Account operation failed'); res.status(500).json({ error: 'Не получилось войти. Попробуй ещё раз.' }); }
    }
  };
  app.post('/api/auth/login', guarded(async (req,res) => {
    const keys = [`ip:${req.ip}`, `email:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0,254) : ''}`];
    for (const key of keys) {
      let entry = attempts.get(key);
      if (!entry || entry.until < Date.now()) { entry = { count: 0, until: Date.now() + 15 * 60000 }; attempts.set(key,entry); }
      if (entry.count >= (key.startsWith('ip:') ? 80 : 10)) { res.setHeader('Retry-After', Math.ceil((entry.until-Date.now())/1000)); throw new AuthError(429,'Слишком много попыток. Попробуй через 15 минут.'); }
      entry.count++;
    }
    if (hashing >= 4) throw new AuthError(429,'Сервер занят. Попробуй через несколько секунд.');
    hashing++;
    try {
      const result = await accounts.login(req.body?.email,req.body?.password);
      await accounts.logout(token(req));
      res.cookie('royal_session',result.token,{...cookieOptions,maxAge:SESSION_AGE});
      res.json({ account: result.account });
    } finally { hashing--; }
  }));
  app.get('/api/auth/me', guarded(async (req,res) => { res.json({ account: (await accounts.session(token(req)))?.account ?? null }); }));
  app.post('/api/auth/character', guarded(async (req,res) => {
    const session = await accounts.session(token(req));
    if (!session) throw new AuthError(401,'Войди в аккаунт ещё раз.');
    await accounts.select(session.account.id,req.body?.skin,req.body?.name,req.body?.appearance);
    res.json({ account: (await accounts.session(token(req)))?.account ?? null });
  }));
  app.post('/api/auth/profile', guarded(async (req,res) => {
    const session = await accounts.session(token(req));
    if (!session) throw new AuthError(401,'Войди в аккаунт ещё раз.');
    await accounts.rename(session.account.id,req.body?.name);
    res.json({ account: (await accounts.session(token(req)))?.account ?? null });
  }));
  app.post('/api/auth/logout', guarded(async (req,res) => {
    await accounts.logout(token(req)); res.clearCookie('royal_session',cookieOptions); res.json({ ok: true });
  }));
}
