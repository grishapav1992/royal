import type { PostgresDatabase } from './database';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { isLegacyTowerState, legacyCasinoPayout, verifyLegacyCasinoRetirement } from './games/legacyCasinoSessions';

export async function removedCasinoSchema(db: PostgresDatabase) {
  await db.exec(`CREATE TABLE IF NOT EXISTS removed_casino_settlements (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL, original_payload TEXT NOT NULL,
    payout_units BIGINT NOT NULL CHECK(payout_units>0), reason TEXT NOT NULL,
    created_at BIGINT NOT NULL, PRIMARY KEY(account_id,session_id),
    FOREIGN KEY(account_id,session_id) REFERENCES demo_casino_sessions(account_id,id))`);
}

/** Runs inside the wallet's account transaction, including the native journal projection. */
export async function settleRemovedCasino(db: PostgresDatabase, accountId: string) {
  if (!db.inTransaction) throw Error('Removed game settlement requires the account transaction');
  const rows = await db.prepare("SELECT id,payload FROM demo_casino_sessions WHERE account_id=? AND game_id='github-tower' AND state='active'").all(accountId);
  for (const row of rows) {
    const before = JSON.parse(String(row.payload));
    if (!isLegacyTowerState(before) || before.id !== row.id || before.state !== 'active') throw Error('Invalid removed game state');
    const after = { ...structuredClone(before), state: 'cashed_out' as const };
    if (!verifyLegacyCasinoRetirement(before, after)) throw Error('Invalid removed game settlement');
    const payout = Number(legacyCasinoPayout(before));
    if (!Number.isSafeInteger(payout) || payout <= 0) throw Error('Invalid removed game payout');
    if (await db.prepare('SELECT 1 FROM removed_casino_settlements WHERE account_id=? AND session_id=?').get(accountId, before.id)) {
      throw Error('Removed game receipt conflicts with active state');
    }
    const reason = before.choices.length ? 'cashout' : 'refund';
    await db.prepare('INSERT INTO removed_casino_settlements VALUES(?,?,?,?,?,?)')
      .run(accountId, before.id, row.payload, payout, reason, Date.now());
    await db.prepare("UPDATE demo_casino_sessions SET state='cashed_out',payload=?,reserved_units=0 WHERE account_id=? AND id=? AND state='active'")
      .run(JSON.stringify(after), accountId, before.id);
    const balance = await demoBalanceUnits(db, accountId) + payout;
    await saveDemoUnits(db, accountId, balance);
    await recordDemoUnits(db, accountId, before.id, reason === 'refund' ? 'refund' : 'win', payout, balance, before.gameId, 'Завершение удалённой игры');
  }
}
