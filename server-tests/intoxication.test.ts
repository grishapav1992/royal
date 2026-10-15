import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDrink, getIntoxication, intoxicatedMovement, MAX_SOBER_TIME_MS } from '../src/shared/intoxication';
import { IntoxicationStore } from '../server/intoxicationStore';

test('drinks build four sobriety stages and real time always removes the effect within thirty minutes', () => {
  const now = 1800000000000;
  assert.equal(getIntoxication(0, now).stage, 0);
  const first = addDrink(0, .18, now);
  assert.equal(getIntoxication(first, now).stage, 1);
  const second = addDrink(first, .26, now);
  assert.equal(getIntoxication(second, now).stage, 2);
  const third = addDrink(second, .38, now);
  assert.equal(getIntoxication(third, now).stage, 3);
  const capped = addDrink(third, .38, now);
  assert.equal(capped, now + MAX_SOBER_TIME_MS);
  assert.equal(getIntoxication(capped, now + 10 * 60000).stage, 2);
  assert.equal(getIntoxication(capped, now + 20 * 60000).stage, 1);
  assert.deepEqual(getIntoxication(capped, now + MAX_SOBER_TIME_MS), { level: 0, stage: 0, label: 'Трезв', remainingMs: 0 });
  assert.equal(addDrink(first, 0, now + 1000), first);
  assert.equal(addDrink(0, -1, now), 0);
  assert.equal(addDrink(0, Number.NaN, now), 0);
  assert.equal(addDrink(0, 10, now), now + MAX_SOBER_TIME_MS);
});

test('drunken movement stays deterministic, slows and sways, and cannot move a stationary player', () => {
  const now = 1800000000000;
  const input = { x: 1, y: 0, ms: 16, seq: 7 };
  const sober = intoxicatedMovement(0, input, input.seq, now);
  assert.deepEqual(sober, { x: 1, y: 0, speedMultiplier: 1 });
  const drunk = intoxicatedMovement(now + MAX_SOBER_TIME_MS, input, input.seq, now);
  assert.ok(drunk.y !== 0);
  assert.ok(drunk.speedMultiplier < 1);
  assert.ok(Math.abs(Math.hypot(drunk.x, drunk.y) - 1) < 1e-12);
  assert.deepEqual(drunk, intoxicatedMovement(now + MAX_SOBER_TIME_MS, input, input.seq, now));
  assert.deepEqual(intoxicatedMovement(now + MAX_SOBER_TIME_MS, { x: 0, y: 0, ms: 16 }, 7, now), { x: 0, y: 0, speedMultiplier: .72 });
  assert.deepEqual(intoxicatedMovement(now + MAX_SOBER_TIME_MS, input, input.seq, now + MAX_SOBER_TIME_MS), sober);
});

test('drinking survives database restart, decays offline, isolates accounts and preserves existing account data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'royal-drinking-'));
  const path = join(directory, 'accounts.sqlite');
  let db = new PostgresDatabase(path);
  (await db.exec(" CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO accounts VALUES('a','Антон'),('b','Борис');"));
  let now = 1800000000000;
  try {
    let drinking = new IntoxicationStore(db);
    const beer = (await drinking.consume('a', 'beer', now));
    const whisky = (await drinking.consume('a', 'whisky', now));
    assert.ok(whisky.soberAt > beer.soberAt);
    assert.equal((await drinking.read('b', now)).soberAt, 0);
    (await assert.rejects(async () => (await drinking.consume('a', 'invented-drink', now)), /Unknown drink/));
    (await assert.rejects(async () => (await drinking.consume('unknown-account', 'beer', now))));
    (await db.close()); db = new PostgresDatabase(path);
    drinking = new IntoxicationStore(db); now += 5 * 60000;
    assert.equal((await drinking.read('a', now)).soberAt, whisky.soberAt);
    const soft = (await drinking.consume('a', 'coffee', now));
    assert.equal(soft.soberAt, whisky.soberAt);
    assert.equal(soft.lastDrink, 'coffee');
    assert.equal((await drinking.read('a', now + MAX_SOBER_TIME_MS)).soberAt, 0);
    assert.equal((await db.prepare("SELECT name FROM accounts WHERE id='a'").get())!.name, 'Антон');
    (await db.prepare("DELETE FROM accounts WHERE id='a'").run());
    assert.equal((await db.prepare('SELECT count(*) AS count FROM player_drinking').get())!.count, 0);
  } finally { (await db.close()); rmSync(directory, { recursive: true, force: true }); }
});

test('drinking notifies live rooms only after a dose is stored successfully', async () => {
  const db = new PostgresDatabase(':memory:');
  (await db.exec(" CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('a');"));
  const events: { id: string; soberAt: number }[] = [];
  const now = 1800000000000;
  const drinking = new IntoxicationStore(db, async (id, state) => {
    const row = (await db.prepare('SELECT sober_at,last_drink,last_drink_at FROM player_drinking WHERE account_id=?').get(id))!;
    assert.equal(row.sober_at, state.soberAt);
    assert.equal(row.last_drink, state.lastDrink);
    assert.equal(row.last_drink_at, state.lastDrinkAt);
    events.push({ id, soberAt: state.soberAt });
  });
  try {
    const accepted = (await drinking.consume('a', 'beer', now));
    assert.deepEqual(events, [{ id: 'a', soberAt: accepted.soberAt }]);
    (await assert.rejects(async () => (await drinking.consume('unknown-account', 'beer', now))));
    (await assert.rejects(async () => (await drinking.consume('a', 'invented-drink', now))));
    assert.equal(events.length, 1, 'rejected orders must not update a live player');
  } finally { (await db.close()); }
});
