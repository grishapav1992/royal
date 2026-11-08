import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { evaluateChatModeration, CHAT_MODERATION_RULES_VERSION, type ChatModerationState } from '../server/chatModerationRules';
import { fingerprintChatV2Envelope } from '../server/chatProtocolV2';
import { chatV2FirstAdmissionAge, isChatLocation, parseChatV2Send, type ChatLocation, type ChatV2Send } from '../src/shared/chat';
import { seedChatSqlProbe, type ChatSqlPrefillOptions } from './chat-load-sql-prefill';

export type SqlProbeRequest = Readonly<{ accountId: string; envelope: ChatV2Send; location: ChatLocation; originSeq: number }>;
type ReceiptKey = Readonly<{ accountId: string; messageId: string }>;
export type SqlProbeAdmission = ReceiptKey & { status: 'accepted' | 'duplicate' | 'id_conflict' | 'busy' | 'expired' };
export type SqlProbeCompletion = ReceiptKey & { status: 'published' | 'rejected' | 'stale' };
export type SqlProbeClaim = ReceiptKey & Readonly<{
  sequence: number; fence: number; receivedAt: number; originSeq: number;
  roomEpoch: string; location: ChatLocation; text: string; rulesVersion: number; state: ChatModerationState;
}>;
export type SqlProbeTiming = Readonly<{
  phase: 'admit' | 'claim' | 'idleClaim' | 'finish'; items: number; poolMs: number; workMs: number; commitMs: number;
}>;
export type SqlProbePartition = Readonly<{ index: number; count: number }>;
type SqlProbeAuthority = Readonly<{ hostId: string; systemIdentifier: string; expiresAtUnixMs: number; signal?: AbortSignal }>;

const role = 'royal_chat_load_chat';
const bucketCount = 32;
const bucketLimit = 640;
const accountLimit = 16;
const timeMs = "floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint";
const emptyState = '{"spam":[],"language":[]}';
const schema = 'chat_sql_probe';
const ddl = `
  CREATE SCHEMA ${schema};
  CREATE TABLE quota (bucket int PRIMARY KEY, pending int NOT NULL CHECK (pending BETWEEN 0 AND ${bucketLimit}));
  INSERT INTO quota SELECT bucket, 0 FROM generate_series(0, ${bucketCount - 1}) AS bucket;
  CREATE TABLE lane (
    account_id text PRIMARY KEY, bucket int NOT NULL REFERENCES quota(bucket),
    next_seq bigint NOT NULL DEFAULT 1, head_seq bigint NOT NULL DEFAULT 1, received_at bigint NOT NULL DEFAULT 0,
    pending int NOT NULL DEFAULT 0 CHECK (pending BETWEEN 0 AND ${accountLimit}),
    fence bigint NOT NULL DEFAULT 0, lease_until bigint NOT NULL DEFAULT 0, sanction_pending boolean NOT NULL DEFAULT false,
    conduct jsonb NOT NULL DEFAULT '${emptyState}', CHECK (next_seq - head_seq = pending)
  );
  CREATE INDEX lane_ready ON lane (lease_until, account_id) WHERE pending > 0 AND NOT sanction_pending;
  CREATE TABLE request (
    account_id text NOT NULL REFERENCES lane(account_id), message_id uuid NOT NULL, account_seq bigint NOT NULL,
    fingerprint text NOT NULL, room_epoch uuid NOT NULL, location text NOT NULL, visit_id bigint NOT NULL, origin_seq bigint NOT NULL,
    received_at bigint NOT NULL, rules_version int NOT NULL, body text, outcome text, finalized_at bigint,
    PRIMARY KEY (account_id, message_id), UNIQUE (account_id, account_seq),
    CHECK ((outcome IS NULL) = (body IS NOT NULL)), CHECK ((outcome IS NULL) = (finalized_at IS NULL))
  );
  CREATE TABLE channel (
    room_epoch uuid NOT NULL, location text NOT NULL, next_seq bigint NOT NULL DEFAULT 1, PRIMARY KEY (room_epoch, location)
  );
  CREATE TABLE feed (
    publication_id uuid PRIMARY KEY, room_epoch uuid NOT NULL, location text NOT NULL, publication_seq bigint NOT NULL,
    account_id text NOT NULL, message_id uuid NOT NULL, origin_seq bigint NOT NULL, body text NOT NULL,
    UNIQUE (room_epoch, location, publication_seq), UNIQUE (account_id, message_id),
    FOREIGN KEY (account_id, message_id) REFERENCES request(account_id, message_id)
  );
  CREATE TABLE outbox (
    account_id text NOT NULL, message_id uuid NOT NULL, room_epoch uuid NOT NULL, visit_id bigint NOT NULL,
    reason text NOT NULL CHECK (reason IN ('spam','profanity')), PRIMARY KEY (account_id, message_id),
    FOREIGN KEY (account_id, message_id) REFERENCES request(account_id, message_id)
  );`;

type LaneRow = {
  account_id: string; bucket: number; next_seq: string; head_seq: string; received_at: string;
  pending: number; fence: string; sanction_pending: boolean; lease_until: string;
};
type KeyRow = { account_id: string; message_id: string };
const key = (accountId: string, messageId: string) => accountId + '\0' + messageId;
const json = (rows: readonly unknown[]) => JSON.stringify(rows);

function integer(value: string | number) {
  const n = Number(value);
  assert(Number.isSafeInteger(n) && n >= 0, 'Invalid SQL probe counter');
  return n;
}

function bucketFor(accountId: string) {
  return createHash('sha256').update(accountId).digest().readUInt32BE(0) % bucketCount;
}

export function chatSqlQuotaPartition(accountId: string, count: number) {
  return bucketFor(accountId) % count;
}

function probeRows(rows: readonly SqlProbeRequest[]) {
  if (!rows.length || rows.length > 128) throw new RangeError('Invalid admission batch size');
  return rows.map(row => {
    const parsed = parseChatV2Send(row.envelope);
    if (!parsed.ok || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.accountId) || !isChatLocation(row.location)
      || !Number.isSafeInteger(row.originSeq) || row.originSeq < 1) throw new RangeError('Invalid SQL probe request');
    return { ...row, envelope: parsed.value, fingerprint: fingerprintChatV2Envelope(parsed.value) };
  });
}

/**
 * This store measures real writes on a synthetic stand. It has no application
 * entrypoint and never accepts an external connection string.
 */
export class ChatSqlProbe {
  private readonly verified = new WeakSet<pg.PoolClient>();
  private constructor(private readonly pool: pg.Pool, private readonly runId: string, private readonly leaseMs: number,
    private readonly onTiming?: (timing: SqlProbeTiming) => void, private readonly authority?: SqlProbeAuthority) {}

  static async open(chat: { port: number; role: string; password: string }, runId: string, leaseMs = 15_000,
    onTiming?: (timing: SqlProbeTiming) => void, authority?: SqlProbeAuthority) {
    assert(chat.role === role && Number.isInteger(chat.port) && chat.port > 0 && chat.port <= 65535
      && /^[a-f0-9]{64}$/.test(chat.password) && /^[a-f0-9-]{36}$/.test(runId)
      && Number.isSafeInteger(leaseMs) && leaseMs >= 10 && leaseMs <= 30_000, 'Invalid owned SQL probe configuration');
    const pool = new pg.Pool({ host: '127.0.0.1', port: chat.port, user: role, database: role, password: chat.password,
      ssl: false, max: 16, connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 8000,
      application_name: 'royal/chat-sql-probe', options: '-c search_path=' + schema + ',pg_catalog' });
    pool.on('error', () => { /* Operations surface connection failures. */ });
    const store = new ChatSqlProbe(pool, runId, leaseMs, onTiming, authority);
    try {
      await store.transaction(async client => {
        if (!authority) await store.verifyPrimary(client);
        return client.query(ddl);
      });
      return store;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  private requireCurrentAuthority() {
    if (!this.authority) return;
    this.authority.signal?.throwIfAborted();
    assert(Number.isSafeInteger(this.authority.expiresAtUnixMs) && Date.now() < this.authority.expiresAtUnixMs,
      'SQL probe authority expired');
  }

  private async verifyPrimary(client: pg.PoolClient) {
    const { rows: [evidence] } = await client.query(`
      SELECT session_user AS login, current_user AS role, current_database() AS database,
        current_setting('royal.chat_load_run_id', true) AS marker, pg_is_in_recovery() AS replica,
        current_setting('transaction_read_only') AS read_only, current_setting('fsync') AS fsync,
        current_setting('synchronous_commit') AS commit_mode, current_setting('synchronous_standby_names') AS standbys
      ${this.authority ? `, current_setting('royal.chat_load_node_id', true) AS host_id,
        (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier` : ''}`);
    assert(evidence.login === role && evidence.role === role && evidence.database === role && evidence.marker === this.runId
      && evidence.replica === false && evidence.read_only === 'off' && evidence.fsync === 'on' && evidence.commit_mode === 'on'
      && evidence.standbys, 'SQL probe requires the owned synchronous primary');
    if (this.authority) {
      assert(evidence.host_id === this.authority.hostId && evidence.system_identifier === this.authority.systemIdentifier
        && evidence.standbys === 'FIRST 1 (royal_chat_load_standby)', 'SQL probe primary identity changed');
    }
  }

  private async acquire() {
    this.requireCurrentAuthority();
    const client = await this.pool.connect();
    try {
      if (this.authority && !this.verified.has(client)) {
        await this.verifyPrimary(client);
        this.verified.add(client);
      }
      this.requireCurrentAuthority();
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  }

  private async read(text: string) {
    if (!this.authority) return this.pool.query(text);
    const client = await this.acquire();
    try { return await client.query(text); }
    finally { client.release(); }
  }

  private async transaction<T>(operation: (client: pg.PoolClient) => Promise<T>, phase?: 'admit' | 'claim' | 'finish', commitTimeoutMs = 8_000) {
    const started = performance.now();
    const client = await this.acquire();
    const acquired = performance.now();
    let commitStarted = false, warnedDuringCommit = false, destroyed = false;
    const notice = (message: { severity?: string }) => {
      if (commitStarted && message.severity === 'WARNING') warnedDuringCommit = true;
    };
    client.on('notice', notice);
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      this.requireCurrentAuthority();
      commitStarted = true;
      const committing = performance.now();
      const commit: pg.QueryConfig & { query_timeout: number } = { text: 'COMMIT', query_timeout: commitTimeoutMs };
      await client.query(commit);
      // PostgreSQL can commit locally while warning that the standby wait was
      // cancelled. A successful command tag alone is not a durable receipt.
      if (warnedDuringCommit) throw new Error('SQL probe commit lost synchronous confirmation');
      this.requireCurrentAuthority();
      if (phase && this.onTiming && Array.isArray(result)) {
        this.onTiming({ phase: phase === 'claim' && !result.length ? 'idleClaim' : phase, items: result.length,
          poolMs: acquired - started, workMs: committing - acquired, commitMs: performance.now() - committing });
      }
      return result;
    } catch (error) {
      if (!commitStarted) {
        try { await client.query('ROLLBACK'); }
        catch { destroyed = true; }
      } else destroyed = true;
      throw error;
    } finally {
      client.removeListener('notice', notice);
      client.release(destroyed);
    }
  }

  async admit(input: readonly SqlProbeRequest[]): Promise<SqlProbeAdmission[]> {
    const rows = probeRows(input);
    const accountIds = [...new Set(rows.map(row => row.accountId))].sort();
    return this.transaction(async client => {
      await client.query(`INSERT INTO lane (account_id, bucket)
        SELECT account_id, bucket FROM jsonb_to_recordset($1::jsonb) AS input(account_id text, bucket int)
        ORDER BY account_id ON CONFLICT DO NOTHING`,
      [json(accountIds.map(account_id => ({ account_id, bucket: bucketFor(account_id) })))]);
      const laneRows = (await client.query<LaneRow>(`SELECT * FROM lane WHERE account_id = ANY($1::text[])
        ORDER BY account_id FOR UPDATE`, [accountIds])).rows;
      const lanes = new Map(laneRows.map(row => [row.account_id, row]));
      const existing = (await client.query<KeyRow & { fingerprint: string }>(`
        SELECT r.account_id, r.message_id, r.fingerprint FROM request r
        JOIN jsonb_to_recordset($1::jsonb) AS i(account_id text, message_id uuid) USING (account_id, message_id)`,
      [json(rows.map(row => ({ account_id: row.accountId, message_id: row.envelope.messageId })))])).rows;
      const fingerprints = new Map(existing.map(row => [key(row.account_id, row.message_id), row.fingerprint]));
      const buckets = await this.lockQuotas(client, laneRows);
      const now = integer((await client.query(`SELECT ${timeMs} AS now`)).rows[0].now);
      const changedLanes = new Map<string, LaneRow>();
      const changedBuckets = new Map<number, number>();
      const fresh: Record<string, unknown>[] = [];
      const results: SqlProbeAdmission[] = [];
      for (const row of rows) {
        const { accountId, envelope: { messageId, roomEpoch, visitId, text } } = row;
        const id = key(accountId, messageId), lane = lanes.get(accountId)!;
        const prior = fingerprints.get(id);
        if (prior !== undefined) {
          // A write on the same locked lane makes the duplicate receipt wait
          // for a standby flush after its original transaction's WAL.
          if (prior === row.fingerprint) changedLanes.set(accountId, lane);
          results.push({ accountId, messageId, status: prior === row.fingerprint ? 'duplicate' : 'id_conflict' });
          continue;
        }
        const age = chatV2FirstAdmissionAge(messageId, now);
        if (age === 'expired') { results.push({ accountId, messageId, status: 'expired' }); continue; }
        assert(age === 'valid', 'Future UUID in SQL probe');
        const used = buckets.get(lane.bucket)!;
        if (lane.sanction_pending || lane.pending >= accountLimit || used >= bucketLimit) {
          results.push({ accountId, messageId, status: 'busy' });
          continue;
        }
        const seq = integer(lane.next_seq), receivedAt = Math.max(now, integer(lane.received_at));
        fresh.push({ account_id: accountId, message_id: messageId, account_seq: seq, fingerprint: row.fingerprint,
          room_epoch: roomEpoch, location: row.location, visit_id: visitId, origin_seq: row.originSeq, received_at: receivedAt,
          rules_version: CHAT_MODERATION_RULES_VERSION, body: text });
        lane.next_seq = String(seq + 1);
        lane.received_at = String(receivedAt);
        if (!lane.pending) lane.lease_until = String(receivedAt);
        lane.pending++;
        changedLanes.set(accountId, lane);
        buckets.set(lane.bucket, used + 1);
        changedBuckets.set(lane.bucket, used + 1);
        fingerprints.set(id, row.fingerprint);
        results.push({ accountId, messageId, status: 'accepted' });
      }
      if (changedLanes.size) await client.query(`
        WITH admitted AS (
          INSERT INTO request (account_id,message_id,account_seq,fingerprint,room_epoch,location,visit_id,origin_seq,received_at,rules_version,body)
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(account_id text,message_id uuid,account_seq bigint,
            fingerprint text,room_epoch uuid,location text,visit_id bigint,origin_seq bigint,received_at bigint,rules_version int,body text)
        ), advanced AS (
          UPDATE lane l SET next_seq=i.next_seq,received_at=i.received_at,pending=i.pending,lease_until=i.lease_until
          FROM jsonb_to_recordset($2::jsonb) AS i(account_id text,next_seq bigint,received_at bigint,pending int,lease_until bigint)
          WHERE i.account_id=l.account_id
        )
        UPDATE quota q SET pending=i.pending FROM jsonb_to_recordset($3::jsonb) AS i(bucket int,pending int)
        WHERE q.bucket=i.bucket`, [json(fresh), json([...changedLanes.values()]),
        json([...changedBuckets].map(([bucket, pending]) => ({ bucket, pending })))]);
      return results;
    }, 'admit');
  }

  async claim(limit: number, { index, count }: SqlProbePartition = { index: 0, count: 1 }): Promise<SqlProbeClaim[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new RangeError('Invalid claim batch size');
    if (!Number.isSafeInteger(count) || count < 1 || count > 8 || bucketCount % count !== 0
      || !Number.isSafeInteger(index) || index < 0 || index >= count) throw new RangeError('Invalid quota partition');
    return this.transaction(async client => {
      const leased = await client.query(`
        WITH ready AS (
          SELECT l.account_id FROM lane l WHERE l.pending > 0 AND NOT l.sanction_pending
            AND l.lease_until <= floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint
            AND l.bucket % $3::int = $4::int
          ORDER BY l.lease_until, l.account_id LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        UPDATE lane l SET fence=l.fence+1, lease_until=${timeMs}+$2 FROM ready
        WHERE ready.account_id=l.account_id RETURNING l.account_id,l.head_seq,l.fence,l.conduct`, [limit, this.leaseMs, count, index]);
      if (!leased.rowCount) return [];
      // Read the locked heads with a fresh READ COMMITTED snapshot. A lane
      // selected while another transaction finishes may expose a newer head.
      const result = await client.query(`
        SELECT i.*, r.message_id,r.received_at,r.origin_seq,r.room_epoch,r.location,r.rules_version,r.body
        FROM jsonb_to_recordset($1::jsonb) AS i(account_id text,head_seq bigint,fence bigint,conduct jsonb)
        JOIN request r ON r.account_id=i.account_id AND r.account_seq=i.head_seq WHERE r.outcome IS NULL`, [json(leased.rows)]);
      assert.equal(result.rowCount, leased.rowCount, 'SQL probe claim lost its current head');
      return result.rows.map(row => Object.freeze({ accountId: row.account_id, messageId: row.message_id,
        sequence: integer(row.head_seq), fence: integer(row.fence), receivedAt: integer(row.received_at),
        originSeq: integer(row.origin_seq), roomEpoch: row.room_epoch, location: row.location, rulesVersion: row.rules_version,
        text: row.body, state: row.conduct }));
    }, 'claim');
  }

  async finish(claims: readonly SqlProbeClaim[]): Promise<SqlProbeCompletion[]> {
    if (!claims.length || claims.length > 64 || new Set(claims.map(row => row.accountId)).size !== claims.length) {
      throw new RangeError('Invalid completion batch');
    }
    const prepared = claims.map(claim => ({
      claim, decision: evaluateChatModeration(claim.rulesVersion, claim.state, claim.text, claim.receivedAt),
    }));
    return this.transaction(async client => {
      const lanes = (await client.query<LaneRow>(`
        SELECT l.* FROM lane l WHERE l.account_id = ANY($1::text[]) ORDER BY l.account_id FOR UPDATE`,
      [claims.map(row => row.accountId)])).rows;
      const current = new Map(lanes.map(row => [row.account_id, row]));
      const fenced = prepared.filter(({ claim }) => {
        const row = current.get(claim.accountId);
        return row && row.pending > 0 && integer(row.head_seq) === claim.sequence && integer(row.fence) === claim.fence;
      });
      const now = integer((await client.query(`SELECT ${timeMs} AS now`)).rows[0].now);
      const active = fenced.filter(({ claim }) => integer(current.get(claim.accountId)!.lease_until) > now);
      const written = active.length ? await this.writeOutcomes(client, active, active.map(({ claim }) => current.get(claim.accountId)!)) : new Set<string>();
      const outcomes = new Map(active.filter(({ claim }) => written.has(claim.accountId))
        .map(({ claim, decision }) => [claim.accountId, decision.outcome]));
      return claims.map(({ accountId, messageId }) => {
        const outcome = outcomes.get(accountId);
        return { accountId, messageId, status: outcome === undefined ? 'stale' : outcome === 'publish' ? 'published' : 'rejected' };
      });
    }, 'finish');
  }

  private async writeOutcomes(client: pg.PoolClient,
    active: readonly { claim: SqlProbeClaim; decision: ReturnType<typeof evaluateChatModeration> }[], lanes: readonly LaneRow[]) {
    const rows = active.map(({ claim, decision }) => ({
      account_id: claim.accountId, message_id: claim.messageId, account_seq: claim.sequence, room_epoch: claim.roomEpoch,
      location: claim.location, origin_seq: claim.originSeq, outcome: decision.outcome, conduct: decision.state,
      body: decision.outcome === 'publish' ? decision.maskedText : null, publication_id: randomUUID(),
    }));
    const publications = rows.filter(row => row.outcome === 'publish');
    const feedInput = `jsonb_to_recordset($1::jsonb) AS i(account_id text,message_id uuid,room_epoch uuid,
      location text,origin_seq bigint,body text,publication_id uuid)`;
    if (publications.length) {
      const payload = json(publications);
      await client.query(`INSERT INTO channel (room_epoch,location) SELECT DISTINCT room_epoch,location FROM ${feedInput}
        ORDER BY room_epoch,location ON CONFLICT DO NOTHING`, [payload]);
      await client.query(`SELECT c.room_epoch FROM channel c JOIN (
        SELECT DISTINCT room_epoch,location FROM ${feedInput}
      ) s USING (room_epoch,location) ORDER BY c.room_epoch,c.location FOR UPDATE OF c`, [payload]);
    }
    // A wait on a shared channel must not hold quota rows needed for admission.
    await this.lockQuotas(client, lanes);
    const input = `jsonb_to_recordset($1::jsonb) AS i(account_id text,message_id uuid,account_seq bigint,
      room_epoch uuid,location text,outcome text,conduct jsonb,origin_seq bigint,body text,publication_id uuid)`;
    const { rows: [written] } = await client.query(`
      WITH checked_at AS MATERIALIZED (SELECT ${timeMs} AS now), items AS MATERIALIZED (
        SELECT i.*,l.bucket FROM ${input} JOIN lane l USING (account_id) CROSS JOIN checked_at
        WHERE l.lease_until > checked_at.now
      ), sizes AS (
        SELECT room_epoch,location,count(*) AS n FROM items WHERE outcome='publish' GROUP BY room_epoch,location
      ), allocated AS (
        UPDATE channel c SET next_seq=c.next_seq+s.n FROM sizes s WHERE c.room_epoch=s.room_epoch AND c.location=s.location
        RETURNING c.room_epoch,c.location,c.next_seq-s.n AS start
      ), completed AS (
        UPDATE request r SET outcome=i.outcome,body=NULL,finalized_at=${timeMs} FROM items i
        WHERE r.account_id=i.account_id AND r.message_id=i.message_id AND r.account_seq=i.account_seq AND r.outcome IS NULL
        RETURNING r.account_id,r.message_id,r.room_epoch,r.visit_id,r.outcome
      ), published AS (
        INSERT INTO feed (publication_id,room_epoch,location,publication_seq,account_id,message_id,origin_seq,body)
        SELECT i.publication_id,i.room_epoch,i.location,a.start+row_number() OVER (
          PARTITION BY i.room_epoch,i.location ORDER BY i.account_id,i.message_id)-1,i.account_id,i.message_id,i.origin_seq,i.body
        FROM items i JOIN allocated a USING (room_epoch,location) WHERE i.outcome='publish' RETURNING 1
      ), sanctions AS (
        INSERT INTO outbox (account_id,message_id,room_epoch,visit_id,reason)
        SELECT account_id,message_id,room_epoch,visit_id,outcome FROM completed WHERE outcome IN ('spam','profanity')
      ), advanced AS (
        UPDATE lane l SET head_seq=l.head_seq+1,pending=l.pending-1,conduct=i.conduct,
          lease_until=COALESCE((SELECT received_at FROM request WHERE account_id=l.account_id AND account_seq=l.head_seq+1),0),
          sanction_pending=i.outcome IN ('spam','profanity') FROM items i WHERE l.account_id=i.account_id
      ), budgets AS (
        UPDATE quota q SET pending=q.pending-i.n FROM (
          SELECT bucket,count(*)::int AS n FROM items GROUP BY bucket
        ) i WHERE q.bucket=i.bucket
      )
      SELECT ARRAY(SELECT account_id FROM completed) AS completed,(SELECT count(*) FROM items) AS eligible,
        (SELECT count(*) FROM published) AS published,(SELECT count(*) FROM items WHERE outcome='publish') AS expected_publications`,
    [json(rows)]);
    assert.equal(written.completed.length, integer(written.eligible), 'SQL probe completion lost its original request');
    assert.equal(integer(written.published), integer(written.expected_publications), 'SQL probe completion lost a publication');
    return new Set<string>(written.completed);
  }

  private async lockQuotas(client: pg.PoolClient, lanes: readonly LaneRow[]) {
    const result = await client.query<{ bucket: number; pending: number }>(`
      SELECT bucket,pending FROM quota WHERE bucket=ANY($1::int[]) ORDER BY bucket FOR NO KEY UPDATE`,
    [[...new Set(lanes.map(row => row.bucket))]]);
    return new Map(result.rows.map(row => [row.bucket, row.pending]));
  }

  async prefill(accounts: readonly string[], roomEpochs: readonly string[], count: number, options: ChatSqlPrefillOptions = {}) {
    assert(!options.fullHistory || this.authority, 'Full history requires a verified distributed primary');
    const result = await seedChatSqlProbe(operation => this.transaction(operation, undefined, 35_000), accounts, roomEpochs, count, options);
    const analyze = 'ANALYZE lane, request, channel, feed';
    if (options.fullHistory) await this.preparationQuery(analyze);
    else await this.transaction(client => client.query(analyze));
    return result;
  }

  private preparationQuery(text: string) {
    // Full history counts and ANALYZE are outside the timed workload.
    const query: pg.QueryConfig & { query_timeout: number } = { text, query_timeout: 125_000 };
    return this.transaction(async client => {
      await client.query("SET LOCAL statement_timeout='120s'");
      return client.query(query);
    });
  }

  async sample() {
    const pool = { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount };
    const { rows: [row] } = await this.read(`
      WITH clients AS (
        SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE datname=current_database()
          AND application_name='royal/chat-sql-probe' AND pid<>pg_backend_pid() AND state='active'
      )
      SELECT (SELECT count(*) FROM clients) AS active,
        (SELECT count(*) FROM clients WHERE wait_event_type='Lock') AS lock_waits,
        (SELECT count(*) FROM clients WHERE wait_event='SyncRep') AS sync_waits,
        (SELECT sum(pending) FROM quota) AS pending,
        greatest(0, pg_wal_lsn_diff(pg_current_wal_insert_lsn(), flush_lsn)) AS flush_lag,
        greatest(0, pg_wal_lsn_diff(pg_current_wal_insert_lsn(), replay_lsn)) AS replay_lag,
        coalesce(state='streaming' AND sync_state='sync' AND flush_lsn IS NOT NULL AND replay_lsn IS NOT NULL,false) AS replica_ready
      FROM (SELECT 1) AS sample LEFT JOIN pg_stat_replication ON application_name='royal_chat_load_standby'`);
    return { pool, active: integer(row.active), lockWaits: integer(row.lock_waits), syncWaits: integer(row.sync_waits),
      pending: integer(row.pending), replicaReady: row.replica_ready === true,
      flushLagBytes: row.replica_ready ? integer(row.flush_lag) : null,
      replayLagBytes: row.replica_ready ? integer(row.replay_lag) : null };
  }

  async stats(fullHistory = false) {
    assert(!fullHistory || this.authority, 'Full history requires a verified distributed primary');
    const sql = `
      SELECT count(*) AS accepted, count(*) FILTER (WHERE outcome IS NULL) AS pending,
        count(*) FILTER (WHERE outcome='publish') AS published,
        count(*) FILTER (WHERE outcome IS NOT NULL AND outcome <> 'publish') AS rejected,
        (SELECT count(*) FROM outbox) AS outbox, (SELECT sum(pending) FROM quota) AS quota,
        (SELECT count(*) FROM feed) AS feed, pg_current_wal_insert_lsn()::text AS wal_lsn,
        pg_database_size(current_database()) AS database_bytes FROM request`;
    const result = (await (fullHistory ? this.preparationQuery(sql) : this.read(sql))).rows[0];
    assert.equal(integer(result.pending), integer(result.quota), 'SQL probe quota mismatch');
    return { accepted: integer(result.accepted), pending: integer(result.pending), published: integer(result.published),
      rejected: integer(result.rejected), outbox: integer(result.outbox), feed: integer(result.feed),
      databaseBytes: integer(result.database_bytes), walLsn: result.wal_lsn as string };
  }

  close() { return this.pool.end(); }
}
