import { randomUUID } from 'node:crypto';
import type { PostgresDatabase } from './database';
import { applySchemaMigration } from './database-migrations';
import type { ClubSanction, ClubViolation } from '../src/shared/security';

const INITIAL_DURATION_MS = 20 * 60 * 1000;
const REPEAT_DURATION_MS = 10 * 60 * 1000;
const INITIAL_AMOUNT_CENTS = 1000;
const REPEAT_AMOUNT_CENTS = 500;

type Violation = { id: string; reason: ClubViolation; pursuitId?: string };
type ViolationOutcome = { sanction: ClubSanction; opened: boolean };
type Capture = { pursuitId: string; sanctionId: string };
type CaptureOutcome = { sanction: ClubSanction; kind: 'initial' | 'repeat' };
type EventResult<T> = { outcome: T; replayed: boolean };
type ActiveSanction = { sanction: ClubSanction; initialPursuitId: string | null };

export class ClubSanctionStore {
  readonly ready: Promise<void>;

  constructor(private db: PostgresDatabase, prerequisite: Promise<void> = Promise.resolve()) {
    this.ready = prerequisite.then(async () => {
      await db.transaction(async () => db.exec(`
      CREATE TABLE IF NOT EXISTS club_sanctions (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL,
        initial_pursuit_id TEXT,
        expires_at BIGINT NOT NULL,
        amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
        revision INTEGER NOT NULL CHECK (revision > 0)
      );
      CREATE TABLE IF NOT EXISTS club_sanction_events (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('violation', 'capture')),
        event_id TEXT NOT NULL,
        reason TEXT,
        outcome JSONB NOT NULL,
        PRIMARY KEY (account_id, kind, event_id)
      );
      `));
      if (!await db.hasTable('chat_conduct_discipline')) return;
      await applySchemaMigration(db, {
        id: 'game-club-legacy-marks-v1',
        statements: [`INSERT INTO club_sanctions
          (account_id, episode_id, initial_pursuit_id, expires_at, amount_cents, revision)
          SELECT account_id, gen_random_uuid()::text, NULL, banned_until, 0, 1
          FROM chat_conduct_discipline
          WHERE banned_until > EXTRACT(EPOCH FROM statement_timestamp()) * 1000
          ON CONFLICT (account_id) DO NOTHING`],
      });
    });
  }

  async active(accountId: string, now = Date.now()): Promise<ClubSanction | null> {
    await this.ready;
    return (await this.readActive(accountId, now))?.sanction ?? null;
  }

  recordViolation(accountId: string, violation: Violation, now?: number): Promise<EventResult<ViolationOutcome>> {
    return this.applyEvent(accountId, 'violation', violation.id, now, async at => {
      const active = await this.readActive(accountId, at);
      if (active) return { sanction: active.sanction, opened: false };

      const sanction: ClubSanction = {
        id: randomUUID(), until: at + INITIAL_DURATION_MS, amountCents: INITIAL_AMOUNT_CENTS, revision: 1,
      };
      await this.db.prepare(`INSERT INTO club_sanctions
        (account_id, episode_id, initial_pursuit_id, expires_at, amount_cents, revision) VALUES (?,?,?,?,?,?)
        ON CONFLICT (account_id) DO UPDATE SET episode_id=excluded.episode_id,
          initial_pursuit_id=excluded.initial_pursuit_id, expires_at=excluded.expires_at,
          amount_cents=excluded.amount_cents, revision=excluded.revision
      `).run(accountId, sanction.id, violation.pursuitId ?? null, sanction.until, sanction.amountCents, sanction.revision);
      return { sanction, opened: true };
    }, violation.reason);
  }

  recordCapture(accountId: string, capture: Capture, now?: number): Promise<EventResult<CaptureOutcome | null>> {
    return this.applyEvent<CaptureOutcome | null>(accountId, 'capture', capture.pursuitId, now, async at => {
      const active = await this.readActive(accountId, at);
      if (!active || active.sanction.id !== capture.sanctionId) return null;
      if (active.initialPursuitId === capture.pursuitId) return { sanction: active.sanction, kind: 'initial' };

      const sanction = {
        id: active.sanction.id,
        until: active.sanction.until + REPEAT_DURATION_MS,
        amountCents: active.sanction.amountCents + REPEAT_AMOUNT_CENTS,
        revision: active.sanction.revision + 1,
      };
      await this.db.prepare('UPDATE club_sanctions SET expires_at=?, amount_cents=?, revision=? WHERE account_id=?')
        .run(sanction.until, sanction.amountCents, sanction.revision, accountId);
      return { sanction, kind: 'repeat' };
    });
  }

  private async readActive(accountId: string, now: number): Promise<ActiveSanction | null> {
    const row = await this.db.prepare(`SELECT episode_id, initial_pursuit_id, expires_at, amount_cents, revision
      FROM club_sanctions WHERE account_id=? AND expires_at>?`).get(accountId, now);
    if (!row) return null;
    return {
      initialPursuitId: row.initial_pursuit_id as string | null,
      sanction: { id: String(row.episode_id), until: Number(row.expires_at), amountCents: Number(row.amount_cents), revision: Number(row.revision) },
    };
  }

  private async applyEvent<T>(
    accountId: string, kind: 'violation' | 'capture', id: string, now: number | undefined,
    change: (at: number) => Promise<T>, reason?: ClubViolation,
  ): Promise<EventResult<T>> {
    await this.ready;
    return this.db.transaction(async () => {
      const prior = await this.db.prepare('SELECT outcome FROM club_sanction_events WHERE account_id=? AND kind=? AND event_id=?')
        .get(accountId, kind, id);
      if (prior) return { outcome: prior.outcome as T, replayed: true };

      const outcome = await change(now ?? Date.now());
      await this.db.prepare('INSERT INTO club_sanction_events (account_id,kind,event_id,reason,outcome) VALUES (?,?,?,?,?::jsonb)')
        .run(accountId, kind, id, reason ?? null, JSON.stringify(outcome));
      return { outcome, replayed: false };
    }, { lockKey: 'account:' + accountId });
  }
}
