import type { PostgresDatabase } from './database';
import { JACKIE_GAME } from '../src/shared/jackieChan';

/** Cosmetic progress shares the account transaction and never changes the wallet. */
export class JackieCollectionStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void>) {
    this.ready = prerequisite.then(() => db.exec(`
      CREATE TABLE IF NOT EXISTS demo_jackie_collection (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        units INTEGER NOT NULL CHECK(units BETWEEN 0 AND 90000));
      CREATE TABLE IF NOT EXISTS demo_jackie_collection_rounds (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL, PRIMARY KEY(account_id,session_id));
    `));
  }
  async read(account: string): Promise<number> {
    const row = await this.db.prepare('SELECT units FROM demo_jackie_collection WHERE account_id=?').get(account);
    const units = Number(row?.units ?? 0);
    if (!Number.isSafeInteger(units) || units < 0 || units > 90000) throw Error('Invalid Jackie progress');
    return units;
  }
  async complete(account: string, session: {id: string; gameId: string; stakeUnits: string; state: string}): Promise<number> {
    if (session.gameId !== JACKIE_GAME || session.state !== 'settled') throw Error('Jackie progress requires a completed paid series');
    const inserted = await this.db.prepare('INSERT INTO demo_jackie_collection_rounds(account_id,session_id) VALUES(?,?) ON CONFLICT DO NOTHING RETURNING session_id').get(account, session.id);
    if (inserted) await this.db.prepare('INSERT INTO demo_jackie_collection(account_id,units) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET units=LEAST(90000,demo_jackie_collection.units+EXCLUDED.units)').run(account, Math.min(90000, Number(session.stakeUnits)));
    return this.read(account);
  }
}
