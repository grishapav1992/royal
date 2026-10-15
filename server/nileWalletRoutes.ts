import { open } from 'node:fs/promises';
import type { Application } from 'express';
import { accounts, allowedOrigin, cookieToken } from './accounts';
import { NILE_WALLET_SCOPE, gameAccountId, nileUnits, type NileWallet, type NileDeposit } from '../src/shared/nileWallet';
import { HttpRateLimits } from './requestRateLimit';

export function selectNileWallet(value: any, accountId: string, now = Date.now()): NileWallet {
  if (!gameAccountId(accountId) || !value || value.version !== 1 || value.ready !== true
    || Object.entries(NILE_WALLET_SCOPE).some(([key, expected]) => value[key] !== expected)
    || !Number.isSafeInteger(value.generatedAt) || value.generatedAt > now + 30000 || now - value.generatedAt > 120000
    || !Number.isSafeInteger(value.ledgerHeight) || value.ledgerHeight < 1 || !/^[a-f0-9]{64}$/.test(value.ledgerHash)
    || !Number.isSafeInteger(value.reconciledAt) || value.reconciledAt > now + 30000 || now - value.reconciledAt > 600000
    || !/^[a-f0-9]{64}$/.test(value.bindingsSha256) || !Array.isArray(value.wallets) || value.wallets.length > 100) throw new Error('Invalid Nile view');
  const ids = new Set(), addresses = new Set();
  for (const row of value.wallets) {
    if (!gameAccountId(row?.accountId) || ids.has(row.accountId) || addresses.has(row.address)
      || typeof row.address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(row.address)
      || !nileUnits(row.balanceUnits) || !Array.isArray(row.deposits) || row.deposits.length > 50) throw new Error('Invalid Nile wallet');
    const events = new Set(); let total = 0n;
    for (const event of row.deposits as NileDeposit[]) {
      if (!event || !/^[a-f0-9]{64}$/.test(event.txId) || !Number.isSafeInteger(event.logIndex) || event.logIndex < 0
        || !Number.isSafeInteger(event.height) || event.height < 1 || event.height > value.ledgerHeight
        || !nileUnits(event.amountUnits) || BigInt(event.amountUnits) === 0n || events.has(event.txId + ':' + event.logIndex)) throw new Error('Invalid Nile deposit');
      events.add(event.txId + ':' + event.logIndex); total += BigInt(event.amountUnits);
    }
    if (total > BigInt(row.balanceUnits)) throw new Error('Invalid Nile total');
    ids.add(row.accountId); addresses.add(row.address);
  }
  const wallet = value.wallets.find((row: any) => row.accountId === accountId);
  return wallet ? { ...NILE_WALLET_SCOPE, state: 'assigned', address: wallet.address, balanceUnits: wallet.balanceUnits,
    updatedAt: value.generatedAt, ledgerHeight: value.ledgerHeight, deposits: wallet.deposits.map(({txId,logIndex,height,amountUnits}: NileDeposit) => ({txId,logIndex,height,amountUnits})) }
    : { ...NILE_WALLET_SCOPE, state: 'unassigned' };
}
export function installNileWallet(app: Application, file = process.env.NILE_WALLET_VIEW_FILE, limits = new HttpRateLimits()) {
  app.use('/api/nile-wallet', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Cookie');
    if (!allowedOrigin(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Этот источник запросов не разрешён.' }); return; }
    const account = (await accounts.session(cookieToken(req.headers.cookie)))?.account;
    if (!account) { res.status(401).json({ error: 'Войди в аккаунт, чтобы посмотреть кошелёк.' }); return; }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'Тестовый кошелёк доступен только для просмотра.' }); return; }
    res.locals.accountId = account.id; next();
  }, limits.account());
  app.get('/api/nile-wallet', async (req, res) => {
    if (Object.keys(req.query).length) { res.status(400).json({ error: 'Параметры запроса не поддерживаются.' }); return; }
    if (!file) { res.json({ ...NILE_WALLET_SCOPE, state: 'disabled' }); return; }
    try {
      const handle = await open(file, 'r'); let value;
      try {
        const stat = await handle.stat(); if (!stat.isFile() || stat.size > 262144) throw new Error();
        value = JSON.parse(await handle.readFile('utf8'));
      } finally { await handle.close(); }
      res.json(selectNileWallet(value, res.locals.accountId));
    } catch { res.status(503).json({ error: 'Не удалось подтвердить актуальный тестовый баланс. Попробуй обновить позже.' }); }
  });
}
