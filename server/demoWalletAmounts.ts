import type { PostgresDatabase } from './database';
import { applyDemoMoneySchemaMigrations } from './game-database-migrations';
import { casinoDemoSchema } from './demoCasino';
import { applySchemaMigration } from './database-migrations';

export const MAX_DEMO_UNITS = 100_000_000_000;
export class DemoCapacityError extends Error {}

export async function demoReservedUnits(db: PostgresDatabase, accountId: string): Promise<number> {
  // Partial unique indexes permit at most one active reservation for each game and account.
  const row = await db.prepare(`SELECT
    COALESCE((SELECT reserved_units FROM demo_mines_sessions WHERE account_id=? AND state='active'),0)
    + COALESCE((SELECT reserved_units FROM demo_flight_sessions WHERE account_id=? AND state='active'),0)
    + COALESCE((SELECT SUM(reserved_units) FROM demo_casino_sessions WHERE account_id=? AND state='active'),0)
    + COALESCE((SELECT count(*)*1000 FROM skin_purchases WHERE account_id=? AND state='reserved'),0)
    + COALESCE((SELECT SUM(reserved_units) FROM virtual_pvp_holds WHERE account_id=? AND state='held'),0)
    + COALESCE((SELECT SUM(reserved_units) FROM flag_tote_reservations WHERE account_id=?),0) AS units`).get(accountId, accountId, accountId, accountId, accountId, accountId);
  return Number(row!.units);
}

// Historical whole coins become exact units once; existing units stay unchanged.
export async function migrateDemoAmounts(db: PostgresDatabase) {
  await applyDemoMoneySchemaMigrations(db);
  await casinoDemoSchema(db);
  await applySchemaMigration(db, { id: 'common-skin-purchases-v1', statements: [
    `CREATE TABLE IF NOT EXISTS skin_purchases(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),
      state TEXT NOT NULL CHECK(state IN ('reserved','captured','refunded')),created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS skin_purchases_reserved ON skin_purchases(account_id) WHERE state='reserved'`,
  ] });
  await applySchemaMigration(db, { id: 'virtual-usdt-pvp-v1', statements: [
    `CREATE TABLE virtual_pvp_banks(match_id TEXT PRIMARY KEY,game_id TEXT NOT NULL,stake_units BIGINT NOT NULL CHECK(stake_units>0),
      state TEXT NOT NULL CHECK(state IN ('open','settled','refunded')),winner_id TEXT,reason TEXT NOT NULL DEFAULT '',
      fee_units BIGINT NOT NULL DEFAULT 0 CHECK(fee_units>=0),created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)`,
    `CREATE TABLE virtual_pvp_holds(match_id TEXT NOT NULL REFERENCES virtual_pvp_banks(match_id),account_id TEXT NOT NULL REFERENCES accounts(id),
      stake_units BIGINT NOT NULL CHECK(stake_units>0),reserved_units BIGINT NOT NULL CHECK(reserved_units>0),
      state TEXT NOT NULL CHECK(state IN ('held','settled','refunded')),PRIMARY KEY(match_id,account_id))`,
    `CREATE INDEX virtual_pvp_player_holds ON virtual_pvp_holds(account_id) WHERE state='held'`,
  ] });
  await applySchemaMigration(db, { id: 'flag-tote-v1', statements: [
    `CREATE TABLE flag_tote_rounds(id TEXT PRIMARY KEY,rules_version INTEGER NOT NULL CHECK(rules_version=1),
      opened_at BIGINT NOT NULL,closes_at BIGINT NOT NULL,finishes_at BIGINT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open','racing','settled','refunded')),outcome TEXT,settlement TEXT)`,
    `CREATE TABLE flag_tote_tickets(round_id TEXT NOT NULL REFERENCES flag_tote_rounds(id),sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 256),
      account_id TEXT NOT NULL REFERENCES accounts(id),id TEXT NOT NULL,country TEXT NOT NULL,
      stake_units BIGINT NOT NULL CHECK(stake_units IN (100,200,500,1000,2000,5000)),payout_units BIGINT CHECK(payout_units>=0),
      PRIMARY KEY(id),UNIQUE(round_id,sequence))`,
    `CREATE INDEX flag_tote_ticket_round ON flag_tote_tickets(round_id)`,
    `CREATE TABLE flag_tote_reservations(round_id TEXT NOT NULL REFERENCES flag_tote_rounds(id),account_id TEXT NOT NULL REFERENCES accounts(id),
      reserved_units BIGINT NOT NULL CHECK(reserved_units=1000000),PRIMARY KEY(round_id,account_id))`,
    `CREATE INDEX flag_tote_reserved_account ON flag_tote_reservations(account_id)`,
  ] });
}

export async function demoBalanceUnits(db: PostgresDatabase, accountId: string) {
  const row = (await db.prepare('SELECT balance,fraction_units FROM demo_wallets WHERE account_id=?').get(accountId));
  return Number(row?.balance ?? 0) * 100 + Number(row?.fraction_units ?? 0);
}

export async function saveDemoUnits(db: PostgresDatabase, accountId: string, units: number) {
  if (!Number.isSafeInteger(units) || units < 0 || units > MAX_DEMO_UNITS) throw new Error('Invalid demo balance');
  const save = async () => {
    if (units + await demoReservedUnits(db, accountId) > MAX_DEMO_UNITS) throw new DemoCapacityError('Demo wallet capacity is reserved for active game payouts');
    await db.prepare('INSERT INTO demo_wallets(account_id,balance,fraction_units) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET balance=excluded.balance,fraction_units=excluded.fraction_units').run(accountId,Math.floor(units / 100),units % 100);
  };
  if (db.inTransaction) await save();
  else await db.transaction(save, { lockKey: 'account:' + accountId });
}

export async function recordDemoUnits(db: PostgresDatabase, accountId: string, operationId: string, kind: 'deposit' | 'bet' | 'win' | 'refund' | 'rollback', amount: number, balance: number, source = 'royal-coins', gameName?: string) {
  const legacyKind = kind === 'refund' ? 'win' : kind === 'rollback' ? amount < 0 ? 'bet' : 'win' : kind;
  (await db.prepare('INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source,game_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(accountId,operationId,legacyKind,Math.trunc(amount / 100),Math.floor(balance / 100),Date.now(),amount,balance,kind,source,gameName ?? null));
}
