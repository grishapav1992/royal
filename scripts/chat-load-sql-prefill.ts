import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { CHAT_MODERATION_RULES_VERSION } from '../server/chatModerationRules';
import { fingerprintChatV2Envelope } from '../server/chatProtocolV2';
import { createChatMessageId } from '../src/shared/chat';
import { maskChatText } from '../src/shared/chatConduct';

export const CHAT_SQL_PREFILL_MAX_REQUESTS = 250_000;
const batchSize = 4_000;
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

/** Seed historical terminal rows within the caller's owned probe transaction. */
export async function seedChatSqlProbe(client: PoolClient, accounts: readonly string[], roomEpochs: readonly string[],
  requestCount: number): Promise<{ requests: number; publications: number }> {
  assert(Number.isSafeInteger(requestCount) && requestCount >= 0 && requestCount <= CHAT_SQL_PREFILL_MAX_REQUESTS,
    'Invalid SQL prefill request count');
  if (!requestCount) return { requests: 0, publications: 0 };
  assert(accounts.length > 0 && accounts.length <= accountLimit && new Set(accounts).size === accounts.length
    && accounts.every(account => /^[a-zA-Z0-9_-]{1,128}$/.test(account)), 'Invalid SQL prefill accounts');
  const rooms = roomEpochs.map(room => room.toLowerCase());
  assert(rooms.length === Math.ceil(accounts.length / roomCapacity) && new Set(rooms).size === rooms.length
    && rooms.every(room => uuid.test(room)), 'Invalid SQL prefill room epochs');

  const { rows: [state] } = await client.query(`
    SELECT floor(extract(epoch FROM transaction_timestamp()) * 1000)::bigint AS now_ms,
      current_setting('royal.chat_load_run_id', true) AS marker, pg_is_in_recovery() AS replica,
      (SELECT count(*)::int FROM chat_sql_probe.quota) AS buckets,
      NOT EXISTS (SELECT 1 FROM chat_sql_probe.lane)
        AND NOT EXISTS (SELECT 1 FROM chat_sql_probe.channel)
        AND NOT EXISTS (SELECT 1 FROM chat_sql_probe.quota WHERE pending <> 0) AS empty`);
  const now = Number(state.now_ms);
  assert(uuid.test(state.marker ?? '') && !state.replica && state.empty && state.buckets > 0
    && Number.isSafeInteger(now) && now > receiptMs, 'SQL prefill requires an empty owned probe primary');

  const receivedAt = (index: number) => now - receiptMs + windowMarginMs
    + Math.floor((index + .5) * (receiptMs - 2 * windowMarginMs) / requestCount);
  const lanes = accounts.slice(0, requestCount).map((account, index) => {
    const messages = Math.floor((requestCount - 1 - index) / accounts.length) + 1;
    const lastIndex = index + (messages - 1) * accounts.length;
    const bucket = createHash('sha256').update(account).digest().readUInt32BE(0) % state.buckets;
    return { account_id: account, bucket, next_seq: messages + 1, received_at: receivedAt(lastIndex) };
  });
  await client.query(`INSERT INTO chat_sql_probe.lane (account_id, bucket, next_seq, head_seq, received_at, fence)
    SELECT account_id, bucket, next_seq, next_seq, received_at, next_seq - 1
    FROM jsonb_to_recordset($1::jsonb) AS s(account_id text, bucket int, next_seq bigint, received_at bigint)`, [JSON.stringify(lanes)]);

  // Expired history still consumed sequence numbers when originally published.
  const channelSequences = rooms.map(() => 0);
  let publications = 0;
  for (let offset = 0; offset < requestCount; offset += batchSize) {
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
      return {
        account_id: accounts[accountIndex], message_id: messageId, account_seq: Math.floor(index / accounts.length) + 1,
        fingerprint: fingerprintChatV2Envelope(envelope), room_epoch: envelope.roomEpoch, origin_seq: index + 1,
        received_at: time, finalized_at: finalizedAt, publication_seq: ++channelSequences[roomIndex],
        publication_id: retained ? randomUUID() : null, body: retained ? `${sample.masked} ${index + 1}` : null,
      };
    });
    const result = await client.query(`
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
    publications += result.rowCount ?? 0;
  }
  const channels = rooms.flatMap((room_epoch, index) => channelSequences[index]
    ? [{ room_epoch, next_seq: channelSequences[index] + 1 }] : []);
  await client.query(`INSERT INTO chat_sql_probe.channel (room_epoch, location, next_seq)
    SELECT room_epoch, 'arcade', next_seq FROM jsonb_to_recordset($1::jsonb) AS s(room_epoch uuid, next_seq bigint)`,
  [JSON.stringify(channels)]);
  return { requests: requestCount, publications };
}
