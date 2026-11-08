import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
import { startAuditLoadLockObserver } from '../scripts/audit-load-lock-observer';
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

test('the isolated lock observer correlates only an ungranted lock for the tracked backend and exact key',
  { timeout: 15_000 }, async () => {
    const cluster = await temporaryDatabase();
    const config = databaseConfig(cluster.env);
    const holder = new pg.Client(config), waiter = new pg.Client(config), other = new pg.Client(config);
    let observer: Awaited<ReturnType<typeof startAuditLoadLockObserver>> | undefined;
    const blocked: Promise<unknown>[] = [];
    const backend = async (client: pg.Client) => (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const waitOn = (client: pg.Client, key: string) => {
      const query = client.query(lockSql, [key]);
      void query.catch(() => {});
      blocked.push(query);
    };
    try {
      await Promise.all([holder.connect(), waiter.connect(), other.connect()]);
      const [holderPid, waiterPid, otherPid] = await Promise.all([backend(holder), backend(waiter), backend(other)]);
      const watchedKey = 'audit-load-lock-observer-test', otherKey = watchedKey + ':other';
      await holder.query('BEGIN');
      await holder.query(lockSql, [watchedKey]);
      await holder.query(lockSql, [otherKey]);
      const isBlocked = async (pid: number) => (await holder.query<{ blocked: boolean }>(
        'SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [holderPid, pid])).rows[0].blocked;
      waitOn(other, otherKey);
      await waitFor(() => isBlocked(otherPid), 'Expected a waiter on the other advisory key');

      observer = await startAuditLoadLockObserver(config);
      const samples: number[] = [], unmatched: number[] = [];
      observer.track(holderPid, watchedKey, waitMs => unmatched.push(waitMs));
      observer.track(otherPid, watchedKey, waitMs => unmatched.push(waitMs));
      const stop = observer.track(waiterPid, watchedKey, waitMs => samples.push(waitMs));
      const started = performance.now();
      waitOn(waiter, watchedKey);
      await waitFor(() => samples.length > 0, 'Expected a sampled wait on the tracked advisory key');
      assert(await isBlocked(waiterPid));
      assert(samples.every(waitMs => Number.isFinite(waitMs) && waitMs > 0 && waitMs <= performance.now() - started + 1));
      assert.deepEqual(unmatched, []);

      stop();
      const observed = samples.length;
      await observer.close();
      await observer.close();
      assert.equal(samples.length, observed);
      assert.equal(observer.failed, false);
      assert(await isBlocked(waiterPid));
      await holder.query('ROLLBACK');
      await Promise.all(blocked);
    } finally {
      await Promise.allSettled([observer?.close(), holder.end(), waiter.end(), other.end(), ...blocked]);
      await cluster.cleanup();
    }
  });
