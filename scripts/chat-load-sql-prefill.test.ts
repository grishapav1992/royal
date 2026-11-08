import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { chatMessageIdTimestamp, createChatMessageId } from '../src/shared/chat';
import { CHAT_SQL_PREFILL_MAX_REQUESTS, seedChatSqlProbe } from './chat-load-sql-prefill';
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
        const client = await pool.connect();
        try {
          await assert.rejects(seedChatSqlProbe(client, accounts, rooms, CHAT_SQL_PREFILL_MAX_REQUESTS + 1), /Invalid SQL prefill request count/);
          await client.query('BEGIN');
          try {
            assert.deepEqual(await seedChatSqlProbe(client, accounts, rooms, 64), { requests: 64, publications: 32 });
            await assert.rejects(seedChatSqlProbe(client, accounts, rooms, 64), /requires an empty owned probe primary/);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        } finally { client.release(); }

        const { rows } = await pool.query(`
          SELECT r.account_id, r.message_id, r.room_epoch, r.origin_seq::int AS seq, r.account_seq::int AS account_seq,
            r.received_at, r.body AS pending_body, r.outcome, r.finalized_at,
            f.publication_seq::int AS publication_seq, f.body AS published_body
          FROM chat_sql_probe.request r LEFT JOIN chat_sql_probe.feed f USING (account_id, message_id)
          ORDER BY r.origin_seq`);
        assert.equal(rows.length, 64);
        const hour = 60 * 60_000, now = Date.now();
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
          assert.equal(row.published_body === null, Number(row.finalized_at) < now - 24 * hour);
          if (row.published_body) assert(!row.published_body.includes('Fuck'));
        }
        assert(rows.some(row => row.published_body?.includes('F**k')));
        const { rows: [remaining] } = await pool.query(`SELECT
          (SELECT count(*) FROM chat_sql_probe.lane WHERE next_seq <> head_seq OR pending <> 0) AS lanes,
          (SELECT sum(pending) FROM chat_sql_probe.quota) AS quota,
          (SELECT count(*) FROM chat_sql_probe.outbox) AS sanctions`);
        assert.deepEqual(remaining, { lanes: '0', quota: '0', sanctions: '0' });

        const envelope = { messageId: createChatMessageId(Date.now()), roomEpoch: rooms[0], visitId: 1, text: 'New live message' };
        assert.equal((await store.admit([{ accountId: accounts[0], envelope, location: 'arcade', originSeq: 65 }]))[0].status, 'accepted');
        const claims = await store.claim(4);
        assert.equal(claims.length, 1);
        assert.equal(claims[0].sequence, 4);
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
