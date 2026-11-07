import type { PoolConfig } from 'pg';
import { databaseConfig, PostgresDatabase } from './database';
import { generatedAppearance } from '../src/shared/skinStudio';

export const CHAT_GAME_AUTHORIZATION_BATCH_LIMIT = 50;
const batchBudgetMs = 1000;
const temporaryDatabaseErrors = new Set(['55P03', '57014', '57P01', '57P02', '57P03', '53300',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

export type ChatGameSession = Readonly<{ accountId: string; sessionHash: string }>;
export type ChatGameAdmission = Readonly<{
  authorizedAt: number;
  clearanceGeneration: number;
  equippedSkinId: string | null;
}>;
export type ClubConductState = Readonly<{ clearanceGeneration: number; stateVersion: number }>;

export class ChatAuthorizationUnavailable extends Error {}

type AuthorizationRow = {
  replica: boolean;
  authorized_at: number;
  account_id: string | null;
  clearance_generation: number | null;
  appearance: unknown;
  expired_episode_id: string | null;
};

function counter(value: unknown) {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid club conduct counter');
  return number;
}

function boundedTimeout(value: number | false | undefined, ceiling: number) {
  return typeof value === 'number' && value > 0 ? Math.min(value, ceiling) : ceiling;
}

async function initializeClubConductState(db: PostgresDatabase) {
  await db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS club_conduct_state (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      clearance_generation BIGINT NOT NULL CHECK (clearance_generation >= 0),
      state_version BIGINT NOT NULL CHECK (state_version >= clearance_generation)
    )`));
}

/** Call in the same account transaction that persists the corresponding game decision. */
export async function advanceClubConductState(db: PostgresDatabase, accountId: string, cleared: boolean): Promise<ClubConductState> {
  if (!db.inTransaction) throw new Error('Club conduct state requires an account transaction');
  return db.transaction(async () => {
    const row = await db.prepare(`
      INSERT INTO club_conduct_state (account_id, clearance_generation, state_version)
      VALUES (?, ?, 1)
      ON CONFLICT (account_id) DO UPDATE
      SET clearance_generation = club_conduct_state.clearance_generation + excluded.clearance_generation,
          state_version = club_conduct_state.state_version + 1
      RETURNING clearance_generation, state_version`).get(accountId, Number(cleared));
    if (!row) throw new Error('Missing club conduct state');
    return { clearanceGeneration: counter(row.clearance_generation), stateVersion: counter(row.state_version) };
  }, { lockKey: 'account:' + accountId });
}

/** Game writers normalize expiry under their existing account lock before changing an episode. */
export function normalizeExpiredClubSanction(db: PostgresDatabase, accountId: string,
  { expectedEpisodeId = null, now }: { expectedEpisodeId?: string | null; now?: number } = {}) {
  return db.transaction(async () => {
    const expired = await db.prepare(`
      DELETE FROM club_sanctions
      WHERE account_id = ? AND (?::text IS NULL OR episode_id = ?)
        AND expires_at <= COALESCE(?::bigint, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint)
      RETURNING episode_id`).get(accountId, expectedEpisodeId, expectedEpisodeId, now ?? null);
    if (expired) return advanceClubConductState(db, accountId, true);
  }, { lockKey: 'account:' + accountId });
}

/**
 * Game-side authorization for chat workers. Each bulk read observes the primary's
 * session snapshot. This pool is independent of the game and wallet pool.
 */
export class ChatGameAuthorization {
  private readonly database: Promise<PostgresDatabase>;
  private inFlight = 0;
  readonly ready: Promise<void>;

  constructor(schema: string, prerequisite: Promise<void>, private readonly maxBatches = 4,
    config: PoolConfig = databaseConfig()) {
    if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 16) throw new RangeError('Invalid chat authorization budget');
    this.database = prerequisite.then(async () => {
      const db = new PostgresDatabase(schema, { existingSchema: true, config: {
        ...config, application_name: 'royal/chat-authorization', max: Math.min(config.max ?? 4, maxBatches, 4),
        connectionTimeoutMillis: boundedTimeout(config.connectionTimeoutMillis, 1000),
        statement_timeout: boundedTimeout(config.statement_timeout, 1000),
        lock_timeout: boundedTimeout(config.lock_timeout, 500),
      } });
      try {
        await initializeClubConductState(db);
        return db;
      } catch (error) {
        await db.close();
        throw error;
      }
    });
    this.ready = this.database.then(() => {});
    this.ready.catch(() => {});
  }

  admit(sessions: readonly ChatGameSession[]): Promise<(ChatGameAdmission | null)[]> {
    return this.withBudget(sessions, async (db, references, deadline) => {
      let rows = await this.readAdmission(db, references);
      // A fresh episode can expire during the first pass. Retry boundedly with a
      // new session snapshot, so a logout during expiry normalization wins.
      for (let pass = 0; pass < 2; pass++) {
        const expired = new Map(rows.flatMap(row => row.account_id && row.expired_episode_id
          ? [[row.account_id, row.expired_episode_id] as const] : []));
        if (!expired.size) break;
        for (const [accountId, episodeId] of expired) {
          if (performance.now() >= deadline) throw new ChatAuthorizationUnavailable('Club sanction expiry budget exhausted');
          await normalizeExpiredClubSanction(db, accountId, { expectedEpisodeId: episodeId });
        }
        rows = await this.readAdmission(db, references);
      }
      if (rows.some(row => row.expired_episode_id)) throw new ChatAuthorizationUnavailable('Club sanction expiry is in progress');
      return rows.map(row => row.account_id ? {
        authorizedAt: counter(row.authorized_at), clearanceGeneration: counter(row.clearance_generation ?? 0),
        equippedSkinId: generatedAppearance(row.appearance)?.skinId ?? null,
      } : null);
    });
  }

  /** A later login cannot replace the original session. No conduct generation is refreshed here. */
  verifyPublication(sessions: readonly ChatGameSession[]): Promise<(number | null)[]> {
    return this.withBudget(sessions, async (db, references) => {
      const rows = await db.prepare(`
        WITH authority AS (
          SELECT pg_is_in_recovery() AS replica, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint AS authorized_at
        )
        SELECT authority.*, s.account_id
        FROM unnest(?::text[], ?::text[]) WITH ORDINALITY AS input(account_id, session_hash, ordinal)
        CROSS JOIN authority
        LEFT JOIN sessions s ON s.hash = input.session_hash AND s.account_id = input.account_id AND s.expires > authority.authorized_at
        ORDER BY input.ordinal
      `).all(...this.parameters(references));
      if (rows.some(row => row.replica)) throw new ChatAuthorizationUnavailable('Game authorization requires the primary');
      return rows.map(row => row.account_id ? counter(row.authorized_at) : null);
    });
  }

  private async readAdmission(db: PostgresDatabase, references: readonly ChatGameSession[]) {
    const rows = await db.prepare(`
      WITH authority AS (
        SELECT pg_is_in_recovery() AS replica, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint AS authorized_at
      )
      SELECT authority.*, a.id AS account_id, a.appearance, state.clearance_generation,
        CASE WHEN sanction.expires_at <= authority.authorized_at THEN sanction.episode_id END AS expired_episode_id
      FROM unnest(?::text[], ?::text[]) WITH ORDINALITY AS input(account_id, session_hash, ordinal)
      CROSS JOIN authority
      LEFT JOIN sessions s ON s.hash = input.session_hash AND s.account_id = input.account_id AND s.expires > authority.authorized_at
      LEFT JOIN accounts a ON a.id = s.account_id
      LEFT JOIN club_conduct_state state ON state.account_id = a.id
      LEFT JOIN club_sanctions sanction ON sanction.account_id = a.id
      ORDER BY input.ordinal
    `).all(...this.parameters(references)) as AuthorizationRow[];
    if (rows.some(row => row.replica)) throw new ChatAuthorizationUnavailable('Game authorization requires the primary');
    return rows;
  }

  private parameters(sessions: readonly ChatGameSession[]) {
    return [sessions.map(row => row.accountId), sessions.map(row => row.sessionHash)];
  }

  private async withBudget<T>(sessions: readonly ChatGameSession[],
    action: (db: PostgresDatabase, sessions: readonly ChatGameSession[], deadline: number) => Promise<T[]>) {
    if (sessions.length > CHAT_GAME_AUTHORIZATION_BATCH_LIMIT || sessions.some(session =>
      !session.accountId || session.accountId.length > 128 || !/^[a-f0-9]{64}$/.test(session.sessionHash))) {
      throw new RangeError('Invalid chat authorization batch');
    }
    if (!sessions.length) return [];
    if (this.inFlight >= this.maxBatches) throw new ChatAuthorizationUnavailable('Game authorization budget exhausted');
    const references = sessions.map(({ accountId, sessionHash }) => ({ accountId, sessionHash }));
    this.inFlight++;
    try {
      const db = await this.database;
      const deadline = performance.now() + batchBudgetMs;
      const result = await action(db, references, deadline);
      if (performance.now() >= deadline) throw new ChatAuthorizationUnavailable('Game authorization batch timed out');
      return result;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code && (temporaryDatabaseErrors.has(code) || /^08[0-9A-Z]{3}$/.test(code))) {
        throw new ChatAuthorizationUnavailable('Game authorization temporarily unavailable', { cause: error });
      }
      throw error;
    } finally {
      this.inFlight--;
    }
  }

  async close() { await (await this.database.catch(() => undefined))?.close(); }
}
