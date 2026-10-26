import { randomUUID } from 'node:crypto';
import type { PostgresDatabase } from './database';
import { applyProviderWalletSchemaMigrations, applyProviderPlayerIndexMigration } from './game-database-migrations';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits, MAX_DEMO_UNITS, DemoCapacityError } from './demoWalletAmounts';

export class ProviderWalletError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export type ProviderOperation = 'balance' | 'debit' | 'credit' | 'refund' | 'rollback';
function fail(status = 400, code = 'INVALID_REQUEST'): never { throw new ProviderWalletError(status,code); }
export const demoDecimal = (units: number) => `${Math.floor(units / 100)}.${String(units % 100).padStart(2,'0')}`;
function amountUnits(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return fail();
  const [whole, fraction = ''] = value.split('.');
  const units = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(units) || units > MAX_DEMO_UNITS) return fail();
  return units;
}
function identifier(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) return fail();
  return value;
}

export class CasinoApiProWallet {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = prerequisite.then(() => db.transaction(async () => db.exec(`CREATE TABLE IF NOT EXISTS capro_players (
      player_id TEXT PRIMARY KEY, account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      wallet_binding TEXT, balance_read_at INTEGER);
      CREATE TABLE IF NOT EXISTS capro_transactions (
      transaction_id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES capro_players(player_id),
      operation TEXT NOT NULL, amount_units INTEGER NOT NULL, currency TEXT NOT NULL,
      fingerprint TEXT NOT NULL, response TEXT NOT NULL, reversed_by TEXT, created_at INTEGER NOT NULL);`))
      .then(() => applyProviderWalletSchemaMigrations(db)).then(() => applyProviderPlayerIndexMigration(db)));
  }
  async player(accountId: string) {
    await this.ready;
    const existing = (await this.db.prepare('SELECT player_id FROM capro_players WHERE account_id=?').get(accountId));
    if (existing) return String(existing.player_id);
    return this.db.transaction(async () => {
      const inserted = await this.db.prepare('INSERT INTO capro_players(player_id,account_id) VALUES (?,?) ON CONFLICT(account_id) DO NOTHING RETURNING player_id').get(`royal_${randomUUID()}`,accountId);
      return String((inserted ?? await this.db.prepare('SELECT player_id FROM capro_players WHERE account_id=?').get(accountId))!.player_id);
    }, { lockKey: 'account:'+accountId });
  }
  async connected(playerId: string, binding: string) {
    await this.ready;
    return (await this.db.prepare('SELECT wallet_binding FROM capro_players WHERE player_id=?').get(playerId))?.wallet_binding === binding;
  }
  async verified(binding: string) {
    await this.ready;
    return !!(await this.db.prepare('SELECT 1 FROM capro_players WHERE wallet_binding=? LIMIT 1').get(binding));
  }
  async callback(operation: ProviderOperation, value: unknown, currency: string, binding = '') {
    await this.ready;
    const body = value as Record<string,unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail();
    const playerId = identifier(body.playerId);
    if (body.currency !== currency) return fail(422,'CURRENCY_MISMATCH');
    const player = (await this.db.prepare('SELECT account_id FROM capro_players WHERE player_id=?').get(playerId));
    if (!player) return fail(403,'PLAYER_NOT_FOUND');
    const accountId = String(player.account_id);
    if (operation === 'balance') {
      return this.db.transaction(async () => {
        (await this.db.prepare('UPDATE capro_players SET wallet_binding=?,balance_read_at=? WHERE player_id=?').run(binding,Date.now(),playerId));
        return { balance: demoDecimal(await demoBalanceUnits(this.db,accountId)), currency };
      }, { lockKey: 'account:'+accountId });
    }
    const transactionId = identifier(body.transactionId), amount = amountUnits(body.amount);
    if (operation !== 'credit' && amount === 0) return fail();
    const reference = operation === 'refund' || operation === 'rollback' ? identifier(body.referenceTransactionId) : '';
    const fingerprint = JSON.stringify([operation,playerId,amount,currency,reference,body.roundId ?? null,body.gameId ?? null]);
    try { return await this.db.transaction(async () => {
      const previous = (await this.db.prepare('SELECT fingerprint,response FROM capro_transactions WHERE transaction_id=?').get(transactionId));
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409,'INVALID_REQUEST');
        return { ...JSON.parse(String(previous.response)), duplicate: true };
      }
      let change = operation === 'debit' ? -amount : amount;
      if (reference) {
        const original = (await this.db.prepare('SELECT * FROM capro_transactions WHERE transaction_id=?').get(reference));
        if (!original || original.player_id !== playerId || original.currency !== currency) fail(404,'TRANSACTION_NOT_FOUND');
        if (original.reversed_by) fail(409,'ALREADY_REVERSED');
        if (!['debit','credit'].includes(String(original.operation)) || (operation === 'refund' && original.operation !== 'debit') || original.amount_units !== amount) fail();
        change = original.operation === 'debit' ? amount : -amount;
      }
      const balance = await demoBalanceUnits(this.db,accountId) + change;
      if (balance < 0) fail(402,'INSUFFICIENT_FUNDS');
      if (balance > MAX_DEMO_UNITS) fail(400,'BALANCE_LIMIT');
      try { await saveDemoUnits(this.db,accountId,balance); }
      catch (error) { if (error instanceof DemoCapacityError) fail(400,'BALANCE_LIMIT'); throw error; }
      const kind = operation === 'debit' ? 'bet' : operation === 'credit' ? 'win' : operation;
      const name = typeof body.gameName === 'string' ? body.gameName.slice(0,120) : undefined;
      await recordDemoUnits(this.db,accountId,`capro:${transactionId}`,kind,change,balance,'casinoapipro',name);
      const result = { balance: demoDecimal(balance), currency, reference: `capro:${transactionId}`, duplicate: false };
      (await this.db.prepare('INSERT INTO capro_transactions(transaction_id,player_id,operation,amount_units,currency,fingerprint,response,created_at) VALUES (?,?,?,?,?,?,?,?)').run(transactionId,playerId,operation,amount,currency,fingerprint,JSON.stringify(result),Date.now()));
      if (reference) (await this.db.prepare('UPDATE capro_transactions SET reversed_by=? WHERE transaction_id=?').run(transactionId,reference));
      return result;
    }, { lockKey: 'account:'+accountId }); }
    catch (error) {
      if ((error as { code?: string; constraint?: string }).code !== '23505' || (error as { constraint?: string }).constraint !== 'capro_transactions_pkey') throw error;
      const previous = await this.db.prepare('SELECT fingerprint,response FROM capro_transactions WHERE transaction_id=?').get(transactionId);
      if (!previous || previous.fingerprint !== fingerprint) fail(409,'INVALID_REQUEST');
      return { ...JSON.parse(String(previous.response)), duplicate: true };
    }
  }
}
