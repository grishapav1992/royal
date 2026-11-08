import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryConfig } from 'pg';
import { CHAT_MODERATION_RULES_VERSION } from '../server/chatModerationRules';
import { fingerprintChatV2Envelope } from '../server/chatProtocolV2';
import { createChatMessageId } from '../src/shared/chat';
import { maskChatText } from '../src/shared/chatConduct';

export const CHAT_SQL_PREFILL_MAX_REQUESTS = 250_000;
export const CHAT_SQL_FULL_PREFILL_REQUESTS = 333 * 48 * 60 * 60;
const batchSize = 40_000;
const roomCapacity = 30;
const accountLimit = 10_000;
const historyMs = 24 * 60 * 60_000;
const receiptMs = 2 * historyMs;
const windowMarginMs = 60_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const samples = [
  'Anyone at the roulette table? This is a synthetic message.',
  'Привет. Увидимся у входа через пару минут.',
  'Salut tout le monde, je vous retrouve près de la table.',
  'Fuck, I picked the wrong table. Back in a minute.',
].map(text => ({ text, masked: maskChatText(text) }));

type RunTransaction = <T>(operation: (client: PoolClient) => Promise<T>) => Promise<T>;
export type ChatSqlPrefillOptions = { fullHistory?: boolean; signal?: AbortSignal; onProgress?: (committed: number) => void };

function preparationWrite(client: PoolClient, text: string, values: unknown[]) {
  const query: QueryConfig & { query_timeout: number } = { text, values, query_timeout: 35_000 };
  return client.query(query);
}

/** The caller attests the owned stand before allowing the full-history profile. */
export async function seedChatSqlProbe(transaction: RunTransaction, accounts: readonly string[], roomEpochs: readonly string[],
  requestCount: number, options: ChatSqlPrefillOptions = {}): Promise<{ requests: number; publications: number }> {
  const maximum = options.fullHistory ? CHAT_SQL_FULL_PREFILL_REQUESTS : CHAT_SQL_PREFILL_MAX_REQUESTS;
  assert(Number.isSafeInteger(requestCount) && requestCount >= 0 && requestCount <= maximum,
    'Invalid SQL prefill request count');
  options.signal?.throwIfAborted();
  if (!requestCount) return { requests: 0, publications: 0 };
  assert(accounts.length > 0 && accounts.length <= accountLimit && new Set(accounts).size === accounts.length
    && accounts.every(account => /^[a-zA-Z0-9_-]{1,128}$/.test(account)), 'Invalid SQL prefill accounts');
  const rooms = roomEpochs.map(room => room.toLowerCase());
  assert(rooms.length === Math.ceil(accounts.length / roomCapacity) && new Set(rooms).size === rooms.length
    && rooms.every(room => uuid.test(room)), 'Invalid SQL prefill room epochs');

  const { rows: [state] } = await transaction(client => client.query(`
    SELECT floor(extract(epoch FROM transaction_timestamp()) * 1000)::bigint AS now_ms,
      current_setting('royal.chat_load_run_id', true) AS marker, pg_is_in_recovery() AS replica,
      (SELECT count(*)::int FROM chat_sql_probe.quota) AS buckets,
      NOT EXISTS (SELECT 1 FROM chat_sql_probe.lane)
        AND NOT EXISTS (SELECT 1 FROM chat_sql_probe.channel)
        AND NOT EXISTS (SELECT 1 FROM chat_sql_probe.quota WHERE pending <> 0) AS empty`));
  const now = Number(state.now_ms);
  assert(uuid.test(state.marker ?? '') && !state.replica && state.empty && state.buckets > 0
    && Number.isSafeInteger(now) && now > receiptMs, 'SQL prefill requires an empty owned probe primary');

  const interval = (receiptMs - 2 * windowMarginMs) / requestCount;
  const receivedAt = (index: number) => now - receiptMs + windowMarginMs + Math.floor((index + .5) * interval);
  const buckets = accounts.map(account => createHash('sha256').update(account).digest().readUInt32BE(0) % state.buckets);
  // Expired history still consumed sequence numbers when originally published.
  const channelSequences = rooms.map(() => 0);
  let publications = 0;
  for (let offset = 0; offset < requestCount; offset += batchSize) {
    options.signal?.throwIfAborted();
    const lanes = new Map<number, { account_id: string; bucket: number; next_seq: number; received_at: number }>();
    const channels = new Set<number>();
    const records = Array.from({ length: Math.min(batchSize, requestCount - offset) }, (_, withinBatch) => {
      const index = offset + withinBatch;
      const accountIndex = index % accounts.length;
      const roomIndex = Math.floor(accountIndex / roomCapacity);
      const time = receivedAt(index);
      const finalizedAt = time + 100;
      const retained = finalizedAt >= now - historyMs;
      const sample = samples[index % samples.length];
      const messageId = createChatMessageId(time);
      const envelope = { messageId, roomEpoch: rooms[roomIndex], visitId: 1, text: `${sample.text} ${index + 1}` };
      const account_seq = Math.floor(index / accounts.length) + 1;
      const account_id = accounts[accountIndex];
      lanes.set(accountIndex, { account_id, bucket: buckets[accountIndex], next_seq: account_seq + 1, received_at: time });
      channels.add(roomIndex);
      return {
        account_id, message_id: messageId, account_seq,
        fingerprint: fingerprintChatV2Envelope(envelope), room_epoch: envelope.roomEpoch, origin_seq: index + 1,
        received_at: time, finalized_at: finalizedAt, publication_seq: ++channelSequences[roomIndex],
        publication_id: retained ? randomUUID() : null, body: retained ? `${sample.masked} ${index + 1}` : null,
      };
    });
    const channelRows = [...channels].map(index => ({ room_epoch: rooms[index], next_seq: channelSequences[index] + 1 }));
    publications += await transaction(async client => {
      // Each commit leaves a consistent historical prefix, including when the process is interrupted.
      await client.query("SET LOCAL statement_timeout='30s'");
      const insertedLanes = await preparationWrite(client, `INSERT INTO chat_sql_probe.lane AS l (account_id, bucket, next_seq, head_seq, received_at, fence)
        SELECT account_id, bucket, next_seq, next_seq, received_at, next_seq - 1
        FROM jsonb_to_recordset($1::jsonb) AS s(account_id text, bucket int, next_seq bigint, received_at bigint)
        ON CONFLICT (account_id) DO UPDATE SET next_seq=excluded.next_seq,head_seq=excluded.head_seq,
          received_at=excluded.received_at,fence=excluded.fence
        WHERE l.pending=0 AND l.next_seq=l.head_seq AND l.next_seq<excluded.next_seq`, [JSON.stringify([...lanes.values()])]);
      assert.equal(insertedLanes.rowCount, lanes.size, 'SQL prefill account state changed');
      const result = await preparationWrite(client, `
        WITH seed AS MATERIALIZED (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS s(account_id text, message_id uuid, account_seq bigint,
            fingerprint text, room_epoch uuid, origin_seq bigint, received_at bigint, finalized_at bigint,
            publication_seq bigint, publication_id uuid, body text)
        ), receipts AS (
          INSERT INTO chat_sql_probe.request (account_id, message_id, account_seq, fingerprint, room_epoch,
            location, visit_id, origin_seq, received_at, rules_version, outcome, finalized_at)
          SELECT account_id, message_id, account_seq, fingerprint, room_epoch,
            'arcade', 1, origin_seq, received_at, $2, 'publish', finalized_at FROM seed
          RETURNING account_id, message_id
        )
        INSERT INTO chat_sql_probe.feed (publication_id, room_epoch, location, publication_seq, account_id, message_id, origin_seq, body)
        SELECT s.publication_id, s.room_epoch, 'arcade', s.publication_seq, s.account_id, s.message_id, s.origin_seq, s.body
        FROM seed s JOIN receipts USING (account_id, message_id) WHERE s.publication_id IS NOT NULL`,
      [JSON.stringify(records), CHAT_MODERATION_RULES_VERSION]);
      const advanced = await preparationWrite(client, `INSERT INTO chat_sql_probe.channel AS c (room_epoch, location, next_seq)
        SELECT room_epoch, 'arcade', next_seq FROM jsonb_to_recordset($1::jsonb) AS s(room_epoch uuid, next_seq bigint)
        ON CONFLICT (room_epoch, location) DO UPDATE SET next_seq=excluded.next_seq WHERE c.next_seq<excluded.next_seq`,
      [JSON.stringify(channelRows)]);
      assert.equal(advanced.rowCount, channels.size, 'SQL prefill channel state changed');
      return result.rowCount ?? 0;
    });
    options.onProgress?.(offset + records.length);
  }
  options.signal?.throwIfAborted();
  return { requests: requestCount, publications };
}
