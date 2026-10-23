import type { PostgresDatabase } from '../server/database';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';

function assertLocal(db: PostgresDatabase, schema: string) {
  const options = db.pool.options;
  if (process.env.NODE_ENV === 'production' || db.schema !== schema || options.host !== '127.0.0.1'
    || Number(options.port) !== 55587 || options.database !== 'royal_atelier_local') {
    throw new Error('Test credits require the isolated local atelier database');
  }
}

/** A one-time test credit for each player, never a reset of their spent balance. */
export async function fundLocalAtelierAccounts(game: PostgresDatabase) {
  assertLocal(game, 'royal_game');
  const players = await game.prepare('SELECT id FROM accounts WHERE skin IS NOT NULL').all();
  let credited = 0;
  for (const player of players) {
    const id = String(player.id);
    const added = await game.transaction(async () => {
      if (await game.prepare("SELECT 1 FROM demo_ledger WHERE account_id=? AND source='local-atelier'").get(id)) return false;
      const balance = await demoBalanceUnits(game, id) + 5000;
      await saveDemoUnits(game, id, balance);
      await recordDemoUnits(game, id, id, 'deposit', 5000, balance, 'local-atelier', 'Локальный тест ателье');
      return true;
    }, { lockKey: 'account:' + id });
    if (added) credited++;
  }
  return credited;
}
