import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import { startAuditLoadLockObserver, type AuditLoadLockHolder } from '../scripts/audit-load-lock-observer';
import { temporaryDatabase } from '../scripts/database-test';
import { databaseConfig } from '../server/database';

const lockSql = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';

async function waitFor(condition: () => boolean | Promise<boolean>, message: string) {
  const deadline = performance.now() + 3000;
  do {
    if (await condition()) return;
    await pause(10);
  } while (performance.now() < deadline);
  assert.fail(message);
}

test('the isolated lock observer identifies the granted holder and excludes earlier waiters and unrelated keys',
  { timeout: 15_000 }, async () => {
    const cluster = await temporaryDatabase();
    const config = databaseConfig(cluster.env);
    const holder = new pg.Client(config), waiter = new pg.Client(config);
    const queued = new pg.Client(config), other = new pg.Client(config);
    let observer: Awaited<ReturnType<typeof startAuditLoadLockObserver>> | undefined;
    const blocked: Promise<unknown>[] = [];
    const backend = async (client: pg.Client) => (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const waitOn = (client: pg.Client, key: string) => {
      const query = client.query(lockSql, [key]);
      void query.catch(() => {});
      blocked.push(query);
      return query;
    };
    try {
      const clients = [holder, waiter, queued, other];
      await Promise.all(clients.map(client => client.connect()));
      const [holderPid, waiterPid, queuedPid, otherPid] = await Promise.all(clients.map(backend));
      const watchedKey = 'audit-load-lock-observer-test', otherKey = watchedKey + ':other';
      await holder.query('BEGIN');
      await holder.query(lockSql, [watchedKey]);
      await holder.query(lockSql, [otherKey]);
      const { rows: [expectedHolder] } = await holder.query<AuditLoadLockHolder>(`SELECT pid,
        (EXTRACT(EPOCH FROM xact_start) * 1000)::float8 AS "transactionStartMs"
        FROM pg_stat_activity WHERE pid = pg_backend_pid()`);
      const blockers = async (pid: number) => (await holder.query<{ blockers: number[] }>(
        'SELECT pg_blocking_pids($1::integer) AS blockers', [pid])).rows[0].blockers;
      waitOn(other, otherKey);
      await waitFor(async () => (await blockers(otherPid)).includes(holderPid), 'Expected a waiter on the other advisory key');
      await queued.query('BEGIN');
      await queued.query(lockSql, [watchedKey + ':unrelated-granted']);
      const queuedWait = waitOn(queued, watchedKey);
      await waitFor(async () => (await blockers(queuedPid)).includes(holderPid), 'Expected an earlier waiter on the watched key');

      observer = await startAuditLoadLockObserver(config);
      const samples: { waitMs: number; holders: AuditLoadLockHolder[] }[] = [], unmatched: number[] = [];
      observer.track(holderPid, watchedKey, waitMs => unmatched.push(waitMs));
      observer.track(otherPid, watchedKey, waitMs => unmatched.push(waitMs));
      const stop = observer.track(waiterPid, watchedKey, (waitMs, holders) => samples.push({ waitMs, holders }));
      const started = performance.now();
      waitOn(waiter, watchedKey);
      await waitFor(() => samples.length > 0, 'Expected a sampled wait on the tracked advisory key');
      assert.deepEqual((await blockers(waiterPid)).sort(), [holderPid, queuedPid].sort());
      for (const { waitMs, holders } of samples) {
        assert(Number.isFinite(waitMs) && waitMs > 0 && waitMs <= performance.now() - started + 1);
        assert.deepEqual(holders, [expectedHolder]);
      }
      assert.deepEqual(unmatched, []);

      stop();
      const observed = samples.length;
      await observer.close();
      await observer.close();
      assert.equal(samples.length, observed);
      assert.equal(observer.failed, false);
      assert((await blockers(waiterPid)).includes(holderPid));
      await holder.query('ROLLBACK');
      await queuedWait;
      await queued.query('ROLLBACK');
      await Promise.all(blocked);
    } finally {
      await Promise.allSettled([observer?.close(), holder.end(), waiter.end(), queued.end(), other.end(), ...blocked]);
      await cluster.cleanup();
    }
  });
