import { readFileSync } from 'node:fs';
import { PostgresDatabase } from '../database';
import { immutableLedgerTables } from './pg-ledger-schema';
import { digest, integer, rejectTron } from './tron-protocol';
import { nilePublicKeyAddress } from './nile-address';

type Address = { userId: string; address: string; publicKey: string };
export type NileDepositPool = { version: 1; network: 'nile'; asset: 'USDT_NILE_TEST'; startHeight: number; addresses: Address[] };
export function validateNileDepositPool(value: unknown, original: Address[], startHeight: number): NileDepositPool {
  const pool = value as NileDepositPool;
  if (!pool || Object.keys(pool).sort().join(',') !== 'addresses,asset,network,startHeight,version'
    || pool.version !== 1 || pool.network !== 'nile' || pool.asset !== 'USDT_NILE_TEST'
    || !Array.isArray(pool.addresses) || pool.addresses.length < 1 || pool.addresses.length + original.length > 100) rejectTron('invalid_deposit_pool');
  integer(pool.startHeight, startHeight);
  const users = new Set(original.map(a => a.userId)), addresses = new Set(original.map(a => a.address));
  for (const row of pool.addresses) {
    if (!row || Object.keys(row).sort().join(',') !== 'address,publicKey,userId' || !/^nile_customer_[a-zA-Z0-9_]{1,40}$/.test(row.userId)
      || users.has(row.userId) || addresses.has(row.address) || nilePublicKeyAddress(row.publicKey) !== row.address) rejectTron('invalid_deposit_pool');
    users.add(row.userId); addresses.add(row.address);
  }
  return pool;
}
export function loadNileDepositPool(file = process.env.NILE_DEPOSIT_POOL_FILE ?? '/config/deposit-pool.json'): NileDepositPool | undefined {
  try { const raw = readFileSync(file, 'utf8'); if (Buffer.byteLength(raw) > 65536) rejectTron('invalid_deposit_pool'); return JSON.parse(raw); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
// An additional manifest is sealed independently, preserving the original journal configuration.
export async function sealNileDepositPool(db: PostgresDatabase, expected: NileDepositPool | undefined, original: Address[], startHeight: number, readOnly: boolean) {
  if (expected) validateNileDepositPool(expected, original, startHeight);
  if (expected && !readOnly) {
    await db.exec(`CREATE TABLE IF NOT EXISTS deposit_pool(id BIGINT PRIMARY KEY CHECK(id=1), manifest TEXT NOT NULL);`);
    await immutableLedgerTables(db, ['deposit_pool'], 'sealed deposit pool');
    await db.prepare('INSERT INTO deposit_pool VALUES(1,?) ON CONFLICT DO NOTHING').run(JSON.stringify(expected));
  }
  if (!await db.hasTable('deposit_pool')) return undefined;
  const rows = await db.prepare('SELECT * FROM deposit_pool').all();
  if (!expected || rows.length !== 1 || rows[0].manifest !== JSON.stringify(expected)) rejectTron('deposit_pool_pin_mismatch');
  const triggers = (await db.triggers()).filter(name => name.startsWith('immutable_deposit_pool_')).sort();
  if (JSON.stringify(triggers) !== JSON.stringify(['immutable_deposit_pool_DELETE', 'immutable_deposit_pool_UPDATE'])) rejectTron('deposit_pool_corrupted');
  return expected;
}
export const depositPoolDigest = (pool: NileDepositPool | undefined) => pool ? digest(JSON.stringify(pool)) : null;
