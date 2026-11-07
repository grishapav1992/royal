import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ClubSanctionStore } from '../server/clubSanctions';
import { PostgresDatabase } from '../server/database';
import { ModerationStore } from '../server/moderation';

const MINUTE = 60_000;

async function fixture(context: TestContext) {
  const db = new PostgresDatabase(':memory:');
  context.after(() => db.close());
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('a'), ('b')");
  return { db, store: new ClubSanctionStore(db) };
}

test('legacy migration imports active bans once and preserves existing marks and legacy history', async context => {
  const { db, store } = await fixture(context);
  await db.exec("INSERT INTO accounts VALUES ('c'), ('d'), ('e')");
  const now = Date.now(), until = now + 5 * MINUTE;
  const { outcome: { sanction: modern } } = await store.recordViolation('b', { id: 'modern', reason: 'spam' }, now);
  const { outcome: { sanction: expiredModern } } = await store.recordViolation('e', { id: 'expired', reason: 'spam' }, now - 21 * MINUTE);
  const legacyReady = new ModerationStore(db).ready.then(async () => {
    await db.prepare(`INSERT INTO chat_conduct_discipline (account_id, warned_until, banned_until)
      VALUES ('a',0,?), ('b',0,?), ('c',0,?), ('d',?,0), ('e',0,?)`)
      .run(until, until, now - 1, until, until);
  });
  const migrated = new ClubSanctionStore(db, legacyReady);
  const imported = await migrated.active('a', now);
  assert(imported);
  assert.match(imported.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(imported, { id: imported.id, until, amountCents: 0, revision: 1 });
  assert.equal((await db.prepare("SELECT initial_pursuit_id FROM club_sanctions WHERE account_id='a'").get())?.initial_pursuit_id, null);
  assert.deepEqual(await migrated.active('b', now), modern);
  assert.equal(await migrated.active('c', now), null);
  assert.equal(await migrated.active('d', now), null);
  assert.equal(await migrated.active('e', now), null);
  assert.equal((await db.prepare("SELECT episode_id FROM club_sanctions WHERE account_id='e'").get())?.episode_id, expiredModern.id);
  await db.close();

  const reopened = new PostgresDatabase(db.schema, { existingSchema: true });
  context.after(() => reopened.close());
  assert.deepEqual(await new ClubSanctionStore(reopened).active('a', now), imported);
  await reopened.prepare("DELETE FROM club_sanctions WHERE account_id='a'").run();
  assert.equal(await new ClubSanctionStore(reopened).active('a', now), null);
  assert.equal(Number((await reopened.prepare("SELECT banned_until FROM chat_conduct_discipline WHERE account_id='a'").get())?.banned_until), until);
});

test('the first violation assigns a persistent account sanction before a guard capture', async context => {
  const { db, store } = await fixture(context);
  const at = 1_000;
  const first = await store.recordViolation('a', { id: 'event', reason: 'spam', pursuitId: 'first' }, at);
  const { sanction } = first.outcome;
  assert.equal(first.replayed, false);
  assert.deepEqual(first.outcome, { opened: true, sanction: { id: sanction.id, until: at + 20 * MINUTE, amountCents: 1000, revision: 1 } });
  await db.close();

  const reopened = new PostgresDatabase(db.schema, { existingSchema: true });
  context.after(() => reopened.close());
  const restored = new ClubSanctionStore(reopened);
  assert.deepEqual(await restored.active('a', at + MINUTE), sanction);
  assert.equal(await restored.active('b', at + MINUTE), null);
  assert.deepEqual(await restored.recordViolation('a', { id: 'event', reason: 'spam', pursuitId: 'first' }, at + MINUTE),
    { outcome: first.outcome, replayed: true });
});

test('the first chase settles without extension and a repeat adds ten minutes to the remaining time once', async context => {
  const { store } = await fixture(context);
  const { outcome: { sanction: first } } = await store.recordViolation('a', { id: 'v1', reason: 'collision', pursuitId: 'p1' }, 0);
  const initial = await store.recordCapture('a', { pursuitId: 'p1', sanctionId: first.id }, MINUTE);
  assert.deepEqual(initial, { outcome: { sanction: first, kind: 'initial' }, replayed: false });
  const capture = { pursuitId: 'p2', sanctionId: first.id };
  const attempts = await Promise.all([store.recordCapture('a', capture, 15 * MINUTE), store.recordCapture('a', capture, 15 * MINUTE)]);
  const extended = { ...first, until: 30 * MINUTE, amountCents: 1500, revision: 2 };
  assert.equal(attempts.filter(attempt => !attempt.replayed).length, 1);
  for (const result of attempts) assert.deepEqual(result.outcome, { sanction: extended, kind: 'repeat' });
  assert.deepEqual(await store.active('a', 15 * MINUTE), extended);
});

test('a first violation in the toilet can be followed by a repeat chase without an initial chase', async context => {
  const { store } = await fixture(context);
  const { outcome } = await store.recordViolation('a', { id: 'toilet', reason: 'profanity' }, 0);
  const result = await store.recordCapture('a', { pursuitId: 'seen-on-floor', sanctionId: outcome.sanction.id }, 3 * MINUTE);
  assert.equal(result.outcome?.kind, 'repeat');
  assert.equal(result.outcome?.sanction.until, 30 * MINUTE);
});

test('expiry clears the payable sanction and stale events cannot change a fresh episode', async context => {
  const { store } = await fixture(context);
  const originalEvent = { id: 'v1', reason: 'spam' as const, pursuitId: 'p1' };
  const { outcome: original } = await store.recordViolation('a', originalEvent, 0);
  const old = original.sanction;
  const oldCapture = { pursuitId: 'p1', sanctionId: old.id };
  assert.equal(await store.active('a', old.until), null);
  assert.deepEqual(await store.recordCapture('a', oldCapture, old.until), { outcome: null, replayed: false });
  assert.deepEqual(await store.recordViolation('a', originalEvent, old.until), { outcome: original, replayed: true });
  assert.equal(await store.active('a', old.until), null);

  const { outcome: { sanction: fresh, opened } } = await store.recordViolation('a', { id: 'v2', reason: 'profanity' }, old.until);
  assert.equal(opened, true);
  assert.notEqual(fresh.id, old.id);
  assert.deepEqual(fresh, { id: fresh.id, until: old.until + 20 * MINUTE, amountCents: 1000, revision: 1 });
  assert.deepEqual(await store.recordCapture('a', oldCapture, old.until), { outcome: null, replayed: true });
  assert.deepEqual(await store.recordCapture('a', { ...oldCapture, pursuitId: 'old-repeat' }, old.until),
    { outcome: null, replayed: false });
  assert.deepEqual(await store.active('a', old.until), fresh);
});

test('concurrent violations create one episode and reserve only the first pursuit as initial', async context => {
  const { db, store } = await fixture(context);
  const otherWorker = new ClubSanctionStore(db);
  const [first, second] = await Promise.all([
    store.recordViolation('a', { id: 'spam', reason: 'spam', pursuitId: 'p1' }, 0),
    otherWorker.recordViolation('a', { id: 'words', reason: 'profanity', pursuitId: 'p2' }, 0),
  ]);
  assert.deepEqual(second.outcome.sanction, first.outcome.sanction);
  assert.equal([first, second].filter(event => event.outcome.opened).length, 1);
  const captures = await Promise.all([
    store.recordCapture('a', { pursuitId: 'p1', sanctionId: first.outcome.sanction.id }, 0),
    otherWorker.recordCapture('a', { pursuitId: 'p2', sanctionId: second.outcome.sanction.id }, 0),
  ]);
  assert.deepEqual(captures.map(result => result.outcome?.kind).sort(), ['initial', 'repeat']);
  assert.equal((await store.active('a', 0))?.amountCents, 1500);
});
