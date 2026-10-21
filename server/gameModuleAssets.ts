import express from 'express';
import { resolve } from 'node:path';

/** Independently installed packages override the baseline included with the host release. */
export function installGameModuleAssets(app: express.Application, root = resolve('game-modules'), baseline = resolve('module-dist')) {
 const options: Parameters<typeof express.static>[1] = {
  dotfiles: 'deny', index: false, redirect: false, fallthrough: true,
  setHeaders(res, path) {
   res.setHeader('X-Content-Type-Options', 'nosniff');
   res.setHeader('Cache-Control', path.endsWith('/active.json') ? 'no-store' : 'public, max-age=31536000, immutable');
  },
 };
 app.use('/game-modules', express.static(root, options), express.static(baseline, options));
 app.use('/game-modules', (_req, res) => {
  res.status(404).setHeader('Cache-Control', 'no-store').json({ error: 'Game resource is unavailable' });
 });
 app.use('/game-modules', (error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error.status === 403 ? 403 : error.status === 404 ? 404 : 500;
  res.status(status).setHeader('Cache-Control', 'no-store').json({ error: 'Game resource is unavailable' });
 });
}
