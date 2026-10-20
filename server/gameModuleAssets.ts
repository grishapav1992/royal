import express from 'express';
import { resolve } from 'node:path';

/** Public client packages live outside the application image and have no access to game data. */
export function installGameModuleAssets(app: express.Application, root = resolve('game-modules')) {
 app.use('/game-modules', express.static(root, {
  dotfiles: 'deny', index: false, redirect: false, fallthrough: false,
  setHeaders(res, path) {
   res.setHeader('X-Content-Type-Options', 'nosniff');
   res.setHeader('Cache-Control', path.endsWith('/active.json') ? 'no-store' : 'public, max-age=31536000, immutable');
  },
 }));
 app.use('/game-modules', (error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error.status === 403 ? 403 : error.status === 404 ? 404 : 500;
  res.status(status).setHeader('Cache-Control', 'no-store').json({ error: 'Game resource is unavailable' });
 });
}
