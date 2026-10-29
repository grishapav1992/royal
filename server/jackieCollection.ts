import type { PostgresDatabase } from './database';
import { JACKIE_GAME, JACKIE_COLLECTION_MAX, JACKIE_LEGACY_COLLECTION_MAX } from '../src/shared/jackieChan';

/** Cosmetic progress shares the account transaction and never changes the wallet. */
export class JackieCollectionStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void>) {
    this.ready = prerequisite.then(() => db.exec(`
      CREATE TABLE IF NOT EXISTS demo_jackie_collection (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        units INTEGER NOT NULL CONSTRAINT demo_jackie_collection_units_v2_check CHECK(units BETWEEN 0 AND ${JACKIE_COLLECTION_MAX}));
      ALTER TABLE demo_jackie_collection DROP CONSTRAINT IF EXISTS demo_jackie_collection_units_check;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='demo_jackie_collection'::regclass AND conname='demo_jackie_collection_units_v2_check') THEN
          ALTER TABLE demo_jackie_collection ADD CONSTRAINT demo_jackie_collection_units_v2_check CHECK(units BETWEEN 0 AND ${JACKIE_COLLECTION_MAX});
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS demo_jackie_collection_rounds (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL, PRIMARY KEY(account_id,session_id));
    `));
  }
  async read(account: string): Promise<number> {
    const row = await this.db.prepare('SELECT units FROM demo_jackie_collection WHERE account_id=?').get(account);
    const units = Number(row?.units ?? 0);
    if (!Number.isSafeInteger(units) || units < 0 || units > JACKIE_COLLECTION_MAX) throw Error('Invalid Jackie progress');
    return units;
  }
  async complete(account: string, session: {id: string; gameId: string; stakeUnits: string; state: string}, version:1|2=2): Promise<number> {
    if (session.gameId !== JACKIE_GAME || session.state !== 'settled') throw Error('Jackie progress requires a completed paid series');
    const inserted = await this.db.prepare('INSERT INTO demo_jackie_collection_rounds(account_id,session_id) VALUES(?,?) ON CONFLICT DO NOTHING RETURNING session_id').get(account, session.id);
    const cap=version===1?JACKIE_LEGACY_COLLECTION_MAX:JACKIE_COLLECTION_MAX;
    if (inserted) await this.db.prepare(`INSERT INTO demo_jackie_collection(account_id,units) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET units=GREATEST(demo_jackie_collection.units,LEAST(${cap},demo_jackie_collection.units+EXCLUDED.units))`).run(account, Math.min(cap, Number(session.stakeUnits)));
    return this.read(account);
  }
}
