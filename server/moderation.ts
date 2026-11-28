import type { PostgresDatabase } from './database';

// The table holds bans from the former warning system. ClubSanctionStore migrates
// active rows into club sanctions once, so the schema stays for older databases.
export class ModerationStore {
  readonly ready: Promise<void>;
  constructor(db: PostgresDatabase, prerequisite: Promise<void> = Promise.resolve()) {
    // Legacy profanity sanctions stay separate from this discipline table.
    this.ready = prerequisite.then(() => db.transaction(async () => db.exec(`CREATE TABLE IF NOT EXISTS chat_conduct_discipline (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      warned_until INTEGER NOT NULL DEFAULT 0, banned_until INTEGER NOT NULL DEFAULT 0
    )`)));
  }
}
