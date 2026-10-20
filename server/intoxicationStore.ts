import type { PostgresDatabase } from './database';
import { addDrink, getIntoxication } from '../src/shared/intoxication';
import { nextDrunkLayout } from '../src/shared/drunkControls';
import { DRINKS } from '../src/shared/world';
import { applyDrinkingControlLayoutMigration } from './game-database-migrations';

export type DrinkingState = { soberAt: number; lastDrink: string; lastDrinkAt: number; controlLayout: number };

export class IntoxicationStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, private changed?: (accountId: string, state: DrinkingState) => void | Promise<void>, prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = prerequisite.then(() => db.transaction(async () => db.exec(`CREATE TABLE IF NOT EXISTS player_drinking (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      sober_at INTEGER NOT NULL DEFAULT 0 CHECK(sober_at >= 0),
      last_drink TEXT NOT NULL DEFAULT '',
      last_drink_at INTEGER NOT NULL DEFAULT 0 CHECK(last_drink_at >= 0)
    );`))).then(() => applyDrinkingControlLayoutMigration(db));
  }
  private async load(accountId: string, now: number): Promise<DrinkingState> {
    const row = await this.db.prepare('SELECT sober_at,last_drink,last_drink_at,control_layout FROM player_drinking WHERE account_id=?').get(accountId);
    if (!row) return { soberAt: 0, lastDrink: '', lastDrinkAt: 0, controlLayout: 0 };
    const remaining = getIntoxication(Number(row.sober_at), now).remainingMs;
    return { soberAt: remaining ? now + remaining : 0, lastDrink: String(row.last_drink), lastDrinkAt: Number(row.last_drink_at), controlLayout: Number(row.control_layout) };
  }
  async read(accountId: string, now = Date.now()): Promise<DrinkingState> {
    await this.ready;
    const state = await this.load(accountId, now);
    if (!state.soberAt || state.controlLayout) return state;
    // Existing drinking sessions receive one shared layout even when workers join together.
    return this.db.transaction(async () => {
      const current = await this.load(accountId, now);
      if (!current.soberAt || current.controlLayout) return current;
      current.controlLayout = nextDrunkLayout(0);
      await this.db.prepare('UPDATE player_drinking SET control_layout=? WHERE account_id=?').run(current.controlLayout, accountId);
      return current;
    }, { lockKey: 'account:' + accountId });
  }
  async consume(accountId: string, drinkId: string, now = Date.now()): Promise<DrinkingState> {
    await this.ready;
    const drink = DRINKS.find(item => item.id === drinkId);
    if (!drink) throw new Error('Unknown drink');
    const state = await this.db.transaction(async () => {
      const current = await this.load(accountId, now);
      const soberAt = addDrink(current.soberAt, drink.strength, now);
      const startsEpisode = drink.strength > 0 && !current.soberAt;
      const controlLayout = startsEpisode || (current.soberAt && !current.controlLayout)
        ? nextDrunkLayout(current.controlLayout) : current.controlLayout;
      await this.db.prepare(`INSERT INTO player_drinking(account_id,sober_at,last_drink,last_drink_at,control_layout) VALUES(?,?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET sober_at=excluded.sober_at,last_drink=excluded.last_drink,last_drink_at=excluded.last_drink_at,control_layout=excluded.control_layout`).run(accountId, soberAt, drink.id, now, controlLayout);
      return { soberAt, lastDrink: drink.id, lastDrinkAt: now, controlLayout };
    }, { lockKey: 'account:' + accountId });
    await this.changed?.(accountId, state);
    return state;
  }
}
