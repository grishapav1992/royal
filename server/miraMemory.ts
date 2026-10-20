import type { MiraLanguage } from './miraLanguages';
import { PostgresDatabase } from './database';

export type MiraTurn = { role: 'user' | 'assistant'; content: string };
export type MiraEmotion = 'neutral' | 'smile' | 'tease' | 'concern';
export type MiraMemory = {
  turns: MiraTurn[]; facts: string[]; impression: string; warmth: number; strikes: number;
  language?: MiraLanguage;
  lastSeen: number; visits: number; cooldownUntil: number;
  repeats: { key: string; count: number; at: number }[]; choices: string[];
  drinkOffer?: string | null; emotion?: MiraEmotion; drinkRefused?: boolean; alcoholRefused?: boolean; lastOfferAt?: number;
};
export interface MiraMemoryRepository {
  read(id: string): MiraMemory | undefined | Promise<MiraMemory | undefined>;
  write(id: string, memory: MiraMemory): void | Promise<void>;
  delete(id: string): void | Promise<void>;
}
export const blankMiraMemory = (): MiraMemory => ({ turns: [], facts: [], impression: '', warmth: 0, strikes: 0, lastSeen: 0, visits: 0, cooldownUntil: 0, repeats: [], choices: [] });

export class MiraMemoryStore implements MiraMemoryRepository {
  private db: PostgresDatabase;
  readonly ready: Promise<void>;
  constructor(name = 'royal_game', prerequisite: Promise<void> = Promise.resolve()) {
    this.db = new PostgresDatabase(name);
    this.ready = prerequisite.then(() => this.db.transaction(async () => this.db.exec(`
      CREATE TABLE IF NOT EXISTS mira_memory (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        data TEXT NOT NULL, updated_at INTEGER NOT NULL
      );`)));
  }
  async read(id: string) {
    await this.ready;
    const row = (await this.db.prepare('SELECT data FROM mira_memory WHERE account_id=?').get(id));
    if (!row) return undefined;
    const memory = JSON.parse(String(row.data)) as MiraMemory;
    if (!Array.isArray(memory.turns) || !Array.isArray(memory.facts) || !Array.isArray(memory.repeats) || !Number.isFinite(memory.lastSeen)) throw new Error('Invalid Mira memory');
    return memory;
  }
  async write(id: string, memory: MiraMemory) {
    await this.ready;
    (await this.db.prepare('INSERT INTO mira_memory(account_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(id, JSON.stringify(memory), memory.lastSeen));
  }
  async delete(id: string) { await this.ready; await this.db.prepare('DELETE FROM mira_memory WHERE account_id=?').run(id); }
  async close() { await this.ready; await this.db.close(); }
}
