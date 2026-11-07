import type { PostgresDatabase } from '../server/database';

export const MAX_RETAINED_AUDIT_HISTORY_ROWS = 1_000_000;
const yearMs = 365 * 24 * 60 * 60 * 1000;
const batchRows = 10_000;
const depositUnits = 100;
const syntheticAccount = "'6c60c83c-406f-4b15-9a11-' || lpad(to_hex(account_number),12,'0')";

/** Seed committed canonical postings in the owned load database and let normal capture record them. */
export async function seedRetainedAuditHistory(game: PostgresDatabase, input: {
  rows: number; beforeMs: number; playerAccount: string; playerOpeningUnits: number;
}, signal?: AbortSignal) {
  const { rows, beforeMs, playerAccount, playerOpeningUnits } = input;
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_RETAINED_AUDIT_HISTORY_ROWS ||
      !Number.isSafeInteger(beforeMs) || beforeMs < yearMs ||
      !Number.isSafeInteger(playerOpeningUnits) || playerOpeningUnits < 0) {
    throw new Error('Invalid retained audit history fixture');
  }
  const accounts = Math.min(rows, 1000), playerRows = Math.ceil(rows / accounts);
  const playerEndingUnits = playerOpeningUnits + playerRows * depositUnits;
  if (!Number.isSafeInteger(playerEndingUnits) || game.schema !== 'test_audit_load_game') {
    throw new Error('Expected an isolated retained audit history fixture');
  }
  const fromMs = beforeMs - yearMs;
  signal?.throwIfAborted();
  const isolated = await game.prepare(`SELECT 1 WHERE current_database()='royal_test'
    AND host(inet_server_addr())='127.0.0.1' AND NOT pg_is_in_recovery()`).get();
  if (!isolated) throw new Error('Expected the isolated audit primary');

  await game.transaction(async () => {
    const player = await game.prepare(`SELECT (balance::bigint*100+fraction_units)::text AS units
      FROM demo_wallets WHERE account_id=? FOR UPDATE`).get(playerAccount);
    if (player?.units !== String(playerOpeningUnits)) throw new Error('Unexpected retained fixture opening balance');
    await game.prepare(`INSERT INTO accounts(id,email,name,password,created_at)
      SELECT id,id || '@example.invalid','Audit history','',0
      FROM (SELECT ${syntheticAccount} AS id
        FROM generate_series(2,?::integer) AS history_accounts(account_number)) accounts`).run(accounts);
    await game.prepare(`INSERT INTO demo_wallets(account_id) SELECT ${syntheticAccount}
      FROM generate_series(2,?::integer) AS history_accounts(account_number)`).run(accounts);
  });

  const insertBatch = game.prepare(`WITH sequence AS (
      SELECT ordinal,(ordinal-1)%?::integer+1 AS account_number,(ordinal-1)/?::integer+1 AS deposit_number
      FROM generate_series(?::integer,?::integer) AS history_rows(ordinal)
    ), deposits AS (
      SELECT ordinal,CASE WHEN account_number=1 THEN ?::text ELSE ${syntheticAccount} END AS account_id,
        CASE WHEN account_number=1 THEN ?::bigint ELSE 0 END+deposit_number*${depositUnits} AS balance_units
      FROM sequence
    ), inserted AS (
      INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source)
      SELECT account_id,'6c60c83c-406f-4b15-9a12-' || lpad(to_hex(ordinal),12,'0'),'deposit',1,(balance_units/100)::integer,
        ?::bigint+(ordinal::bigint-1)*?::bigint/?::integer,${depositUnits},balance_units,'deposit','royal-coins'
      FROM deposits ORDER BY ordinal
      RETURNING account_id
    ), increments AS (
      SELECT account_id,count(*)::integer AS deposits FROM inserted GROUP BY account_id
    )
    UPDATE demo_wallets w SET balance=w.balance+i.deposits FROM increments i WHERE w.account_id=i.account_id`);
  for (let first = 1; first <= rows; first += batchRows) {
    signal?.throwIfAborted();
    const last = Math.min(first + batchRows - 1, rows);
    await game.transaction(async () => {
      const result = await insertBatch.run(accounts, accounts, first, last, playerAccount, playerOpeningUnits,
        fromMs, yearMs - 1, Math.max(1, rows - 1));
      if (result.changes !== Math.min(last - first + 1, accounts)) throw new Error('Retained fixture wallet update was incomplete');
      signal?.throwIfAborted();
    });
  }
  return { rows, accounts, fromMs, toMs: beforeMs, playerRows, playerEndingUnits };
}
