import type { PostgresDatabase } from './database';
import { addDrink, getIntoxication } from '../src/shared/intoxication';
import { DRINKS } from '../src/shared/world';

export type DrinkingState = { soberAt: number; lastDrink: string; lastDrinkAt: number };

export class IntoxicationStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, private changed?: (accountId: string, state: DrinkingState) => void | Promise<void>, prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = prerequisite.then(() => db.transaction(async () => db.exec(`CREATE TABLE IF NOT EXISTS player_drinking (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      sober_at INTEGER NOT NULL DEFAULT 0 CHECK(sober_at >= 0),
      last_drink TEXT NOT NULL DEFAULT '',
      last_drink_at INTEGER NOT NULL DEFAULT 0 CHECK(last_drink_at >= 0)
    );`)));
  }
  async read(accountId: string, now = Date.now()): Promise<DrinkingState> {
    await this.ready;
    const row = (await this.db.prepare('SELECT sober_at,last_drink,last_drink_at FROM player_drinking WHERE account_id=?').get(accountId));
    if (!row) return { soberAt: 0, lastDrink: '', lastDrinkAt: 0 };
    const remaining = getIntoxication(Number(row.sober_at), now).remainingMs;
    return { soberAt: remaining ? now + remaining : 0, lastDrink: String(row.last_drink), lastDrinkAt: Number(row.last_drink_at) };
  }
  async consume(accountId: string, drinkId: string, now = Date.now()): Promise<DrinkingState> {
    await this.ready;
    const drink = DRINKS.find(item => item.id === drinkId);
    if (!drink) throw new Error('Unknown drink');
    const state = await this.db.transaction(async () => {
    const soberAt = addDrink((await this.read(accountId, now)).soberAt, drink.strength, now);
    (await this.db.prepare(`INSERT INTO player_drinking(account_id,sober_at,last_drink,last_drink_at) VALUES(?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET sober_at=excluded.sober_at,last_drink=excluded.last_drink,last_drink_at=excluded.last_drink_at`).run(accountId, soberAt, drink.id, now));
    return { soberAt, lastDrink: drink.id, lastDrinkAt: now };
    }, { lockKey: 'account:' + accountId });
    await this.changed?.(accountId, state);
    return state;
  }
}
