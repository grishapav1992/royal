import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import pg from 'pg';
import { createChatMessageId } from '../src/shared/chat';
import { startLocalChatLoadStand } from './chat-load-stand';
import { ChatSqlProbe, type SqlProbeRequest } from './chat-load-sql-store';

test('owned synchronous SQL probe persists unique admissions, fences leases and records final effects', async () => {
  const root = resolve('artifacts', 'work');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'chat-sql-store-test-'));
  try {
    const stand = await startLocalChatLoadStand(directory);
    try {
      await assert.rejects(ChatSqlProbe.open(stand.chat, randomUUID()), /requires the owned synchronous primary/);
      const store = await ChatSqlProbe.open(stand.chat, stand.runId, 1_000);
      try {
        const roomEpoch = randomUUID();
        const request = (accountId: string, text: string, originSeq: number): SqlProbeRequest => ({
          accountId, location: 'arcade', originSeq,
          envelope: { roomEpoch, messageId: createChatMessageId(Date.now()), text, visitId: 1 },
        });
        const first = request('first', 'What the fuck', 1);
        const second = request('first', 'Второе спокойное сообщение', 2);
        const third = request('second', 'Добрый вечер, это отдельный аккаунт', 3);
        const expired = { ...third, envelope: {
          ...third.envelope, messageId: createChatMessageId(Date.now() - 25 * 60 * 60_000),
        } };
        assert.deepEqual((await store.admit([first, second, third, expired])).map(row => row.status),
          ['accepted', 'accepted', 'accepted', 'expired']);
        assert.deepEqual((await Promise.all([store.admit([first]), store.admit([first])])).flat().map(row => row.status),
          ['duplicate', 'duplicate']);
        assert.equal((await store.admit([{ ...first, envelope: { ...first.envelope, text: 'Изменённый текст' } }]))[0].status, 'id_conflict');
        const claims = (await Promise.all([store.claim(4), store.claim(4)])).flat();
        assert.deepEqual(new Set(claims.map(row => row.messageId)), new Set([first.envelope.messageId, third.envelope.messageId]));
        const locker = new pg.Client({ host: '127.0.0.1', port: stand.chat.port, database: stand.chat.role,
          user: stand.chat.role, password: stand.chat.password, ssl: false });
        try {
          await locker.connect();
          await locker.query('BEGIN');
          await locker.query("SELECT account_id FROM chat_sql_probe.lane WHERE account_id='first' FOR UPDATE");
          const waiting = store.finish(claims);
          await delay(1_100);
          await locker.query('COMMIT');
          assert((await waiting).every(row => row.status === 'stale'));
        } finally {
          await locker.end();
        }
        const retry = await store.claim(4);
        assert.equal(retry.length, 2);
        assert((await store.finish(claims)).every(row => row.status === 'stale'));
        assert((await Promise.all(retry.map(claim => store.finish([claim])))).flat().every(row => row.status === 'published'));
        const next = await store.claim(4);
        assert.deepEqual(next.map(row => row.messageId), [second.envelope.messageId]);
        assert.equal((await store.finish(next))[0].status, 'published');
        const abusive = request('abusive', Array(10).fill('идиот').join(' '), 4);
        assert.equal((await store.admit([abusive]))[0].status, 'accepted');
        assert.equal((await store.finish(await store.claim(4)))[0].status, 'rejected');
        assert.equal((await store.admit([request('abusive', 'Позднее сообщение', 5)]))[0].status, 'busy');
        const bucket = (account: string) => createHash('sha256').update(account).digest().readUInt32BE(0) % 32;
        const peer = Array.from({ length: 33 }, (_, index) => 'colliding-' + index);
        const sameBucket = peer.find((account, index) => peer.slice(index + 1).some(other => bucket(account) === bucket(other)))!;
        const sameBucketPeer = peer.find(account => account !== sameBucket && bucket(account) === bucket(sameBucket))!;
        assert.deepEqual((await Promise.all([
          store.admit([request(sameBucket, 'Первый новый участник', 6)]),
          store.admit([request(sameBucketPeer, 'Второй новый участник', 7)]),
        ])).flat().map(row => row.status), ['accepted', 'accepted']);
        assert.equal((await store.finish(await store.claim(4))).length, 2);
        const stats = await store.stats();
        assert.deepEqual({ ...stats, walLsn: undefined }, { accepted: 6, pending: 0, published: 5, rejected: 1, outbox: 1, walLsn: undefined });
        const inspector = new pg.Client({ host: '127.0.0.1', port: stand.chat.port, database: stand.chat.role,
          user: stand.chat.role, password: stand.chat.password, ssl: false });
        try {
          await inspector.connect();
          const feed = (await inspector.query(`
            SELECT publication_seq::int AS sequence, message_id, body FROM chat_sql_probe.feed ORDER BY publication_seq`)).rows;
          assert.deepEqual(feed.map(row => row.sequence), [1, 2, 3, 4, 5]);
          const publishedFirst = feed.find(row => row.message_id === first.envelope.messageId);
          assert.equal(publishedFirst?.body, 'What the f**k');
          assert.equal((await inspector.query('SELECT count(*)::int AS n FROM chat_sql_probe.request WHERE body IS NOT NULL')).rows[0].n, 0);
          assert.equal((await inspector.query('SELECT reason FROM chat_sql_probe.outbox')).rows[0].reason, 'profanity');
        } finally {
          await inspector.end();
        }
        const replica = new pg.Client({ host: '127.0.0.1', port: stand.replicaPort, database: stand.chat.role,
          user: stand.chat.role, password: stand.chat.password, ssl: false });
        try {
          await replica.connect();
          const deadline = performance.now() + 5_000;
          let replicated = false;
          while (!replicated && performance.now() < deadline) {
            if ((await replica.query("SELECT to_regclass('chat_sql_probe.outbox') IS NOT NULL AS present")).rows[0].present) {
              const { rows: [counts] } = await replica.query(`
                SELECT (SELECT count(*)::int FROM chat_sql_probe.request WHERE body IS NULL) AS finalized,
                  (SELECT count(*)::int FROM chat_sql_probe.feed) AS published,
                  (SELECT count(*)::int FROM chat_sql_probe.outbox) AS outbox`);
              replicated = counts.finalized === 6 && counts.published === 5 && counts.outbox === 1;
            }
            if (!replicated) await delay(50);
          }
          assert(replicated, 'Standby did not replay the probe outcomes');
        } finally {
          await replica.end();
        }
      } finally {
        await store.close();
      }
    } finally {
      await stand.cleanup();
    }
  } finally {
    await rmdir(directory);
  }
});
