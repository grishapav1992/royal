import { randomUUID } from 'node:crypto';
import type { PostgresDatabase } from './database';
import { applySchemaMigration } from './database-migrations';

export const ACCOUNT_LEASE_MS = 45000;
export const ACCOUNT_LEASE_RENEW_MS = 10000;

export type AccountLease = {
  accountId: string;
  token: string;
  sessionHash: string;
  roomId: string;
  sessionId: string;
  deadline: number;
};

const dbNow = '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT';

export class AccountLeaseStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void> = db.ready,
    private readonly now: () => number = () => performance.now()) {
    this.ready = prerequisite.then(() => applySchemaMigration(db, {
      id: 'game-account-lobby-leases-v1',
      statements: [`CREATE TABLE lobby_account_leases (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        lease_token TEXT NOT NULL,
        session_hash TEXT NOT NULL,
        room_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        expires_at BIGINT NOT NULL)`],
    }));
  }

  async claim(accountId: string, sessionHash: string, roomId: string, sessionId: string): Promise<AccountLease | undefined> {
    await this.ready;
    const token = randomUUID(), started = this.now();
    const row = await this.db.prepare(`INSERT INTO lobby_account_leases(account_id,lease_token,session_hash,room_id,session_id,expires_at)
      SELECT ?,?,?,?,?,${dbNow}+? FROM sessions AS authenticated
      WHERE hash=? AND account_id=? AND expires>${dbNow}
        AND NOT EXISTS(SELECT 1 FROM chat_conduct_discipline AS discipline
          WHERE discipline.account_id=authenticated.account_id AND discipline.banned_until>${dbNow})
      ON CONFLICT(account_id) DO UPDATE SET lease_token=excluded.lease_token,session_hash=excluded.session_hash,
        room_id=excluded.room_id,session_id=excluded.session_id,expires_at=excluded.expires_at
      WHERE lobby_account_leases.expires_at<=${dbNow}
      RETURNING expires_at-${dbNow} AS remaining_ms`)
      .get(accountId, token, sessionHash, roomId, sessionId, ACCOUNT_LEASE_MS, sessionHash, accountId);
    if (!row) return;
    // Starting before the query makes this deadline conservative even after pool
    // waits or delayed replies. No host wall clock is compared with the DB clock.
    return { accountId, token, sessionHash, roomId, sessionId, deadline: started + Math.min(ACCOUNT_LEASE_MS, Number(row.remaining_ms)) };
  }

  async renew(leases: readonly AccountLease[]): Promise<Map<string, AccountLease>> {
    await this.ready;
    if (!leases.length) return new Map();
    const started = this.now();
    const rows = await this.db.prepare(`UPDATE lobby_account_leases AS held SET expires_at=${dbNow}+?
      FROM jsonb_to_recordset(?::jsonb) AS wanted(account_id TEXT,lease_token TEXT)
      WHERE held.account_id=wanted.account_id AND held.lease_token=wanted.lease_token AND held.expires_at>${dbNow}
        AND EXISTS(SELECT 1 FROM sessions WHERE hash=held.session_hash AND account_id=held.account_id AND expires>${dbNow})
        AND NOT EXISTS(SELECT 1 FROM chat_conduct_discipline AS discipline
          WHERE discipline.account_id=held.account_id AND discipline.banned_until>${dbNow})
      RETURNING held.lease_token,held.expires_at-${dbNow} AS remaining_ms`)
      .all(ACCOUNT_LEASE_MS, JSON.stringify(leases.map(lease => ({ account_id: lease.accountId, lease_token: lease.token }))));
    const original = new Map(leases.map(lease => [lease.token, lease]));
    const renewed = new Map<string, AccountLease>();
    for (const row of rows) {
      const lease = original.get(String(row.lease_token));
      if (lease) renewed.set(lease.token, { ...lease, deadline: started + Math.min(ACCOUNT_LEASE_MS, Number(row.remaining_ms)) });
    }
    return renewed;
  }

  async release(leases: readonly AccountLease[]): Promise<void> {
    await this.ready;
    if (!leases.length) return;
    await this.db.prepare(`DELETE FROM lobby_account_leases AS held
      USING jsonb_to_recordset(?::jsonb) AS wanted(account_id TEXT,lease_token TEXT)
      WHERE held.account_id=wanted.account_id AND held.lease_token=wanted.lease_token`)
      .run(JSON.stringify(leases.map(lease => ({ account_id: lease.accountId, lease_token: lease.token }))));
  }
}
