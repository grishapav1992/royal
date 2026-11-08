import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { chatMessageIdTimestamp, createChatMessageId } from '../src/shared/chat';
import { CHAT_SQL_PREFILL_MAX_REQUESTS } from './chat-load-sql-prefill';
import { ChatSqlProbe } from './chat-load-sql-store';
import { startLocalChatLoadStand } from './chat-load-stand';

test('synthetic prefill retains recent masked history and advances live account and channel sequences', async () => {
  const root = resolve('artifacts', 'work');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'chat-sql-prefill-test-'));
  try {
    const stand = await startLocalChatLoadStand(directory);
    try {
      const store = await ChatSqlProbe.open(stand.chat, stand.runId);
      const pool = new pg.Pool({ host: '127.0.0.1', port: stand.chat.port, database: stand.chat.role,
        user: stand.chat.role, password: stand.chat.password, ssl: false });
      try {
        const accounts = Array.from({ length: 31 }, (_, index) => `synthetic-${index}`);
        const rooms = [randomUUID(), randomUUID()];
        const requestCount = 80_032, committed: number[] = [];
        await assert.rejects(store.prefill(accounts, rooms, CHAT_SQL_PREFILL_MAX_REQUESTS + 1), /Invalid SQL prefill request count/);
        await assert.rejects(store.prefill(accounts, rooms, requestCount, { fullHistory: true }), /requires a verified distributed primary/);
        assert.deepEqual(await store.prefill(accounts, rooms, requestCount, { onProgress: count => committed.push(count) }),
          { requests: requestCount, publications: requestCount / 2 });
        assert.deepEqual(committed, [40_000, 80_000, requestCount]);
        await assert.rejects(store.prefill(accounts, rooms, requestCount), /requires an empty owned probe primary/);

        const { rows } = await pool.query(`
          SELECT r.account_id, r.message_id, r.room_epoch, r.origin_seq::int AS seq, r.account_seq::int AS account_seq,
            r.received_at, r.body AS pending_body, r.outcome, r.finalized_at,
            f.publication_seq::int AS publication_seq, f.body AS published_body
          FROM chat_sql_probe.request r LEFT JOIN chat_sql_probe.feed f USING (account_id, message_id)
          ORDER BY r.origin_seq`);
        assert.equal(rows.length, requestCount);
        const hour = 60 * 60_000, now = Date.now();
        const referenceTime = Number(rows[0].received_at) + 48 * hour - 60_000 - Math.floor((48 * hour - 120_000) / (2 * requestCount));
        for (const [index, row] of rows.entries()) {
          const time = Number(row.received_at);
          assert.equal(chatMessageIdTimestamp(row.message_id), time);
          assert(time > now - 48 * hour && time < now - 60_000);
          assert.equal(row.outcome, 'publish');
          assert.equal(row.pending_body, null);
          assert.equal(row.seq, index + 1);
          assert.equal(row.account_id, accounts[index % accounts.length]);
          assert.equal(row.room_epoch, rooms[Math.floor((index % accounts.length) / 30)]);
          assert.equal(row.account_seq, Math.floor(index / accounts.length) + 1);
          assert.equal(row.published_body === null, Number(row.finalized_at) < referenceTime - 24 * hour);
          if (row.published_body) assert(!row.published_body.includes('Fuck'));
        }
        assert(rows.some(row => row.published_body?.includes('F**k')));
        const { rows: [remaining] } = await pool.query(`SELECT
          (SELECT count(*) FROM chat_sql_probe.lane WHERE next_seq <> head_seq OR pending <> 0) AS lanes,
          (SELECT sum(pending) FROM chat_sql_probe.quota) AS quota,
          (SELECT count(*) FROM chat_sql_probe.outbox) AS sanctions`);
        assert.deepEqual(remaining, { lanes: '0', quota: '0', sanctions: '0' });

        const envelope = { messageId: createChatMessageId(Date.now()), roomEpoch: rooms[0], visitId: 1, text: 'New live message' };
        assert.equal((await store.admit([{ accountId: accounts[0], envelope, location: 'arcade', originSeq: requestCount + 1 }]))[0].status, 'accepted');
        const claims = await store.claim(4);
        assert.equal(claims.length, 1);
        assert.equal(claims[0].sequence, Math.ceil(requestCount / accounts.length) + 1);
        assert.equal((await store.finish(claims))[0].status, 'published');
        const publication = await pool.query('SELECT publication_seq::int AS seq FROM chat_sql_probe.feed WHERE message_id=$1', [envelope.messageId]);
        assert.deepEqual(publication.rows, [{ seq: rows.filter(row => row.room_epoch === rooms[0]).length + 1 }]);
      } finally {
        await pool.end();
        await store.close();
      }
    } finally { await stand.cleanup(); }
  } finally { await rmdir(directory); }
});

test('an interrupted history load leaves only committed prefix rows and counters', async () => {
  const root = resolve('artifacts', 'work');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'chat-sql-prefill-abort-'));
  try {
    const stand = await startLocalChatLoadStand(directory);
    try {
      const store = await ChatSqlProbe.open(stand.chat, stand.runId);
      try {
        const controller = new AbortController(), roomEpoch = randomUUID();
        await assert.rejects(store.prefill(['synthetic'], [roomEpoch], 80_000, {
          signal: controller.signal, onProgress: committed => {
            assert.equal(committed, 40_000);
            controller.abort();
          },
        }), { name: 'AbortError' });
        const { accepted, pending, published, feed, outbox } = await store.stats();
        assert.deepEqual({ accepted, pending, published, feed, outbox }, { accepted: 40_000, pending: 0, published: 40_000, feed: 0, outbox: 0 });
        await assert.rejects(store.prefill(['synthetic'], [roomEpoch], 80_000), /requires an empty owned probe primary/);
        const envelope = { messageId: createChatMessageId(Date.now()), roomEpoch, visitId: 1, text: 'One more test message' };
        assert.equal((await store.admit([{ accountId: 'synthetic', envelope, location: 'arcade', originSeq: 40_001 }]))[0].status, 'accepted');
        const claims = await store.claim(1);
        assert.equal(claims[0].sequence, 40_001);
        assert.equal((await store.finish(claims))[0].status, 'published');
      } finally { await store.close(); }
    } finally { await stand.cleanup(); }
  } finally { await rmdir(directory); }
});
