import { randomUUID, createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../server/database';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from '../../server/demoWalletAmounts';
import { legacyCasinoReservation, type LegacyTowerState } from '../../server/games/legacyCasinoSessions';
import type { NilePlayLedger } from '../../server/finance/nile-play-ledger';

export const savedTower = (choices: number[] = [1], stakeUnits = '1000'): LegacyTowerState => ({
  id: randomUUID(), gameId: 'github-tower', rulesVersion: 1, state: 'active', stakeUnits,
  settings: { difficulty: 'easy' }, choices, cards: [], dragons: Array(9).fill(0),
});

/** Fixtures represent a wager accepted by the removed version, never a current API start. */
export async function seedDemoTower(db: PostgresDatabase, account: string, state = savedTower()) {
  const seed = async () => {
    const balance = await demoBalanceUnits(db, account) - Number(state.stakeUnits);
    await db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)')
      .run(account, state.id, state.gameId, state.state, JSON.stringify(state), Number(legacyCasinoReservation(state)));
    await saveDemoUnits(db, account, balance);
    await recordDemoUnits(db, account, state.id, 'bet', -Number(state.stakeUnits), balance, state.gameId, 'Historical removed game');
    const op = { id: state.id, gameId: state.gameId, action: 'start', stakeUnits: state.stakeUnits, settings: state.settings };
    await db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)')
      .run(account, state.id, JSON.stringify([op.id, op.gameId, op.action, op.stakeUnits, state.settings.difficulty]), state.id, Date.now());
    return state;
  };
  return db.inTransaction ? seed() : db.transaction(seed, { lockKey: 'account:' + account });
}

export async function seedNativeTower(ledger: NilePlayLedger, account: string, state = savedTower()) {
  await ledger.nativeTransaction(account, async context => {
    await ledger.db.prepare('INSERT INTO accounts(id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
    await saveDemoUnits(ledger.db, account, Number(context.available / 10000n));
    await seedDemoTower(ledger.db, account, state);
    await context.post(context.available - BigInt(state.stakeUnits) * 10000n,
      context.reserved + legacyCasinoReservation(state) * 10000n,
      createHash('sha256').update('historical-test:' + state.id).digest('hex'));
  });
  return state;
}
