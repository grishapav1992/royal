import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { FinanceError } from './amount';
import { FinanceStore, type OperationKind } from './store';

// A service token authorizes simulation operators. This is not a browser wallet API.
export function createFinanceSandboxApp(store: FinanceStore, token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('FINANCE_SANDBOX_TOKEN must be 32 random bytes encoded as hex');
  const digest = createHash('sha256').update(token).digest();
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/healthz', async (_req, res) => {
    try {
      const { rows } = await store.pool.query("SELECT pg_is_in_recovery() OR current_setting('transaction_read_only')='on' AS read_only");
      if (rows[0].read_only) {
        res.status(503).json({ service: 'royal-finance-sandbox', environment: 'simulation', database: 'read_only' }); return;
      }
      await store.checkRuntimeRole();
      res.json({ service: 'royal-finance-sandbox', environment: 'simulation', database: 'ready' });
    } catch { res.status(503).json({ service: 'royal-finance-sandbox', environment: 'simulation', database: 'unavailable' }); }
  });
  app.use((req, res, next) => {
    if (req.get('origin') || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ code: 'service_only', error: 'Этот API предназначен для локального сервисного доступа.' }); return;
    }
    const authorization = req.get('authorization') ?? '';
    const candidate = /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1] ?? '';
    const candidateDigest = createHash('sha256').update(candidate).digest();
    if (!candidate || !timingSafeEqual(digest, candidateDigest)) {
      res.status(401).json({ code: 'unauthorized', error: 'Нужен сервисный токен.' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '4kb', strict: true }));
  app.use(async (_req, _res, next) => {
    try { await store.checkRuntimeRole(); }
    catch { throw new FinanceError(503, 'unsafe_runtime', 'Финансовый контур не прошёл проверку прав и схемы.'); }
    next();
  });
  app.post('/sandbox/users', async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'userId')) {
      throw new FinanceError(400, 'invalid_fields', 'Передай только userId.');
    }
    res.status(201).json(await store.createUser(req.body.userId));
  });
  app.post('/sandbox/operations', async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 3 || !['actor', 'kind', 'body'].every(key => Object.hasOwn(req.body, key))) {
      throw new FinanceError(400, 'invalid_fields', 'Нужны actor, kind и body.');
    }
    res.json(await store.execute(req.body.actor, req.get('idempotency-key'), req.body.kind as OperationKind, req.body.body));
  });
  app.get('/sandbox/wallets/:userId', async (req, res) => { res.json(await store.snapshot(req.params.userId)); });
  app.post('/sandbox/wallets/:userId/deposit-address', async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || req.body.network !== 'tron-sim-v1') {
      throw new FinanceError(400, 'simulation_only', 'Разрешена только сеть tron-sim-v1.');
    }
    res.json(await store.depositAddress(req.params.userId));
  });
  app.get('/sandbox/wallets/:userId/history', async (req, res) => { res.json(await store.history(req.params.userId)); });
  app.get('/sandbox/operations/:actor/:key', async (req, res) => { res.json(await store.operation(req.params.actor, req.params.key)); });
  app.get('/sandbox/reconciliation', async (_req, res) => { res.json(await store.reconcile()); });
  app.use((_req, res) => { res.status(404).json({ code: 'not_found', error: 'Маршрут не найден.' }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof FinanceError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
    if (error.type === 'entity.too.large') { res.status(413).json({ code: 'body_too_large', error: 'Слишком большой запрос.' }); return; }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ code: 'invalid_json', error: 'Некорректный JSON.' }); return; }
    res.status(503).json({ code: 'unconfirmed', error: 'Результат не подтверждён. Повтори запрос с тем же ключом.' });
  };
  app.use(errors);
  return app;
}
