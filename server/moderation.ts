import type { PostgresDatabase } from './database';
import { SECURITY_BAN_MS, SECURITY_WARNING_MS, type SecurityDecision } from '../src/shared/security';

export class ModerationStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void> = Promise.resolve()) {
    // Legacy profanity sanctions stay separate from this discipline table.
    this.ready = prerequisite.then(() => db.transaction(async () => db.exec(`CREATE TABLE IF NOT EXISTS chat_conduct_discipline (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      warned_until INTEGER NOT NULL DEFAULT 0, banned_until INTEGER NOT NULL DEFAULT 0
    )`)));
  }
  async banUntil(id: string, now = Date.now()): Promise<number> {
    await this.ready;
    const row = (await this.db.prepare('SELECT banned_until FROM chat_conduct_discipline WHERE account_id=?').get(id));
    return Number(row?.banned_until ?? 0) > now ? Number(row!.banned_until) : 0;
  }
  async record(id: string, now = Date.now()): Promise<SecurityDecision> {
    await this.ready;
    return this.db.transaction(async () => {
    const row = (await this.db.prepare('SELECT warned_until,banned_until FROM chat_conduct_discipline WHERE account_id=?').get(id));
    if (Number(row?.banned_until ?? 0) > now) return { kind: 'ejecting', until: Number(row!.banned_until) };
    const repeat = Number(row?.warned_until ?? 0) > now;
    const until = now + (repeat ? SECURITY_BAN_MS : SECURITY_WARNING_MS);
    (await this.db.prepare(`INSERT INTO chat_conduct_discipline(account_id,warned_until,banned_until) VALUES(?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET warned_until=excluded.warned_until,banned_until=excluded.banned_until`)
      .run(id, repeat ? 0 : until, repeat ? until : 0));
    return { kind: repeat ? 'ejecting' : 'warning', until };
    }, { lockKey: 'account:' + id });
  }
  async eject(id: string, now = Date.now(), reason: 'collision' | 'profanity' = 'collision'): Promise<SecurityDecision> {
    await this.ready;
    return this.db.transaction(async () => {
    const until=Math.max(await this.banUntil(id,now),now+SECURITY_BAN_MS);
    (await this.db.prepare(`INSERT INTO chat_conduct_discipline(account_id,warned_until,banned_until) VALUES(?,0,?)
      ON CONFLICT(account_id) DO UPDATE SET warned_until=0,banned_until=excluded.banned_until`).run(id,until));
    return { kind: 'ejecting', until, reason };
    }, { lockKey: 'account:' + id });
  }
}
