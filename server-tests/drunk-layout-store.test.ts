import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { IntoxicationStore } from '../server/intoxicationStore';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';

const now = 1800000000000;
const validLayout = (layout: number) => assert.ok(Number.isInteger(layout) && layout >= 1 && layout <= 9);
async function fixture() {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL); INSERT INTO accounts VALUES('alice','Алиса'),('bob','Борис')");
  return db;
}

test('a drinking episode retains its layout through extra drinks, soft drinks, decay and restart; a new episode differs', async () => {
  let db = await fixture();
  const schema = db.schema;
  try {
    let drinking = new IntoxicationStore(db);
    assert.equal((await drinking.consume('alice', 'coffee', now)).controlLayout, 0);
    const first = await drinking.consume('alice', 'whisky', now);
    validLayout(first.controlLayout);
    for (let n = 0; n < 4; n++) {
      const another = await drinking.consume('alice', 'whisky', now);
      assert.equal(another.controlLayout, first.controlLayout);
    }
    assert.equal((await drinking.read('alice', now)).soberAt, now + MAX_SOBER_TIME_MS);
    assert.equal((await drinking.read('bob', now)).controlLayout, 0);
    await db.close();
    db = new PostgresDatabase(schema);
    drinking = new IntoxicationStore(db);
    assert.equal((await drinking.read('alice', now + 12 * 60000)).controlLayout, first.controlLayout);
    assert.equal((await drinking.consume('alice', 'coffee', now + 12 * 60000)).controlLayout, first.controlLayout);
    assert.equal((await drinking.consume('alice', 'whisky', now + 12 * 60000)).controlLayout, first.controlLayout);
    const soberTime = now + MAX_SOBER_TIME_MS * 2;
    const sober = await drinking.read('alice', soberTime);
    assert.equal(sober.soberAt, 0);
    assert.equal(sober.controlLayout, first.controlLayout, 'the previous layout is retained after recovery');
    assert.equal((await drinking.consume('alice', 'coffee', soberTime)).controlLayout, first.controlLayout);
    const next = await drinking.consume('alice', 'beer', soberTime);
    validLayout(next.controlLayout);
    assert.notEqual(next.controlLayout, first.controlLayout);
    assert.equal((await db.prepare("SELECT name FROM accounts WHERE id='alice'").get())!.name, 'Алиса');
  } finally { await db.dropSchema(); await db.close(); }
});

test('legacy drinking rows migrate once and concurrent readers persist one shared layout without changing drinking history', async () => {
  const db = await fixture(), otherDb = new PostgresDatabase(db.schema);
  try {
    await db.exec(`CREATE TABLE player_drinking(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      sober_at BIGINT NOT NULL DEFAULT 0 CHECK(sober_at >= 0),last_drink TEXT NOT NULL DEFAULT '',
      last_drink_at BIGINT NOT NULL DEFAULT 0 CHECK(last_drink_at >= 0))`);
    await db.prepare('INSERT INTO player_drinking VALUES(?,?,?,?),(?,?,?,?)').run(
      'alice', now + MAX_SOBER_TIME_MS, 'whisky', now - 1000, 'bob', now - 1000, 'beer', now - 5000);
    const first = new IntoxicationStore(db), second = new IntoxicationStore(otherDb);
    await Promise.all([first.ready, second.ready]);
    const states = await Promise.all(Array.from({ length: 20 }, (_, n) => (n % 2 ? first : second).read('alice', now)));
    validLayout(states[0].controlLayout);
    assert.equal(new Set(states.map(state => state.controlLayout)).size, 1);
    assert.deepEqual(await db.prepare("SELECT sober_at,last_drink,last_drink_at,control_layout FROM player_drinking WHERE account_id='alice'").get(), {
      sober_at: now + MAX_SOBER_TIME_MS, last_drink: 'whisky', last_drink_at: now - 1000, control_layout: states[0].controlLayout,
    });
    assert.deepEqual(await first.read('bob', now), { soberAt: 0, lastDrink: 'beer', lastDrinkAt: now - 5000, controlLayout: 0 });
    assert.deepEqual(await first.read('missing', now), { soberAt: 0, lastDrink: '', lastDrinkAt: 0, controlLayout: 0 });
    assert.equal((await db.columns('player_drinking')).find(column => column.name === 'control_layout')!.type, 'bigint');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM _royal_migrations WHERE id='game-drinking-control-layout-v1'").get())!.n, 1);
    await assert.rejects(db.prepare("UPDATE player_drinking SET control_layout=10 WHERE account_id='alice'").run(), /check constraint/);
  } finally { await db.dropSchema(); await Promise.all([db.close(), otherDb.close()]); }
});

test('concurrent drinks in different workers allocate one layout and preserve the thirty minute cap', async () => {
  const db = await fixture(), otherDb = new PostgresDatabase(db.schema);
  try {
    const first = new IntoxicationStore(db), second = new IntoxicationStore(otherDb);
    await Promise.all([first.ready, second.ready]);
    const states = await Promise.all(Array.from({ length: 12 }, (_, n) => (n % 2 ? first : second).consume('alice', 'whisky', now)));
    validLayout(states[0].controlLayout);
    assert.equal(new Set(states.map(state => state.controlLayout)).size, 1);
    const current = await first.read('alice', now);
    assert.equal(current.controlLayout, states[0].controlLayout);
    assert.equal(current.soberAt, now + MAX_SOBER_TIME_MS);
    const nextStates = await Promise.all(Array.from({ length: 6 }, (_, n) => (n % 2 ? first : second).consume('alice', 'wine', now + MAX_SOBER_TIME_MS)));
    assert.equal(new Set(nextStates.map(state => state.controlLayout)).size, 1);
    assert.notEqual(nextStates[0].controlLayout, current.controlLayout);
  } finally { await db.dropSchema(); await Promise.all([db.close(), otherDb.close()]); }
});

test('drinking callbacks observe committed layouts and failed orders emit no event', async () => {
  const db = await fixture(), reader = new PostgresDatabase(db.schema);
  const events: number[] = [];
  try {
    const drinking = new IntoxicationStore(db, async (id, state) => {
      const row = (await reader.prepare('SELECT sober_at,control_layout FROM player_drinking WHERE account_id=?').get(id))!;
      assert.equal(row.control_layout, state.controlLayout);
      assert.equal(row.sober_at, state.soberAt);
      events.push(state.controlLayout);
    });
    const accepted = await drinking.consume('alice', 'beer', now);
    assert.deepEqual(events, [accepted.controlLayout]);
    await assert.rejects(drinking.consume('missing', 'beer', now));
    await assert.rejects(drinking.consume('alice', 'unknown', now), /Unknown drink/);
    assert.deepEqual(events, [accepted.controlLayout]);
    assert.equal((await drinking.read('missing', now)).controlLayout, 0);
  } finally { await db.dropSchema(); await Promise.all([db.close(), reader.close()]); }
});

test('store startup waits for account prerequisites before applying its layout migration', async () => {
  const db = new PostgresDatabase(':memory:');
  try {
    const prerequisite = db.transaction(async () => db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice')"));
    const drinking = new IntoxicationStore(db, undefined, prerequisite);
    const accepted = await drinking.consume('alice', 'wine', now);
    validLayout(accepted.controlLayout);
    assert.equal((await drinking.read('alice', now)).controlLayout, accepted.controlLayout);
  } finally { await db.dropSchema(); await db.close(); }
});
