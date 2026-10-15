import type { RequestHandler } from 'express';

export type DemoWalletRequestLimitOptions = {
  limit?: number;
  windowMs?: number;
  maxAccounts?: number;
  now?: () => number;
};

/** Limit reads, rejected writes and replays before they can perform wallet database work. */
export function createDemoWalletRequestLimit(options: DemoWalletRequestLimitOptions = {}): RequestHandler {
  const limit = options.limit ?? 240;
  const windowMs = options.windowMs ?? 60_000;
  const maxAccounts = options.maxAccounts ?? 10_000;
  const now = options.now ?? Date.now;
  if (![limit, windowMs, maxAccounts].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('Invalid wallet request limit');
  }
  const windows = new Map<string, { count: number; until: number }>();
  let nextCleanup = 0;
  return (_req, res, next) => {
    const timestamp = now();
    if (timestamp >= nextCleanup) {
      for (const [key, entry] of windows) if (entry.until <= timestamp) windows.delete(key);
      nextCleanup = timestamp + windowMs;
    }
    const accountId: string = res.locals.accountId;
    let entry = windows.get(accountId);
    if (!entry || entry.until <= timestamp) {
      if (!entry && windows.size >= maxAccounts) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        res.status(429).json({ error: 'Кошелёк занят. Повтори запрос через минуту.' });
        return;
      }
      entry = { count: 0, until: timestamp + windowMs };
      windows.set(accountId, entry);
    }
    if (entry.count >= limit) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((entry.until - timestamp) / 1000)));
      res.status(429).json({ error: 'Слишком много запросов к кошельку. Подожди и повтори запрос.' });
      return;
    }
    entry.count++;
    next();
  };
}
