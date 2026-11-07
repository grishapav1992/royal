import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import {
  advanceClubConductState, ChatAuthorizationUnavailable, ChatGameAuthorization, normalizeExpiredClubSanction,
} from '../server/chatGameAuthorization';
import { ClubSanctionStore } from '../server/clubSanctions';
import { PostgresDatabase } from '../server/database';

const sessionHash = () => randomBytes(32).toString('hex');

async function fixture(context: TestContext) {
  const db = new PostgresDatabase(':memory:');
  await db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, appearance JSONB);
    CREATE TABLE sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires BIGINT NOT NULL);
    INSERT INTO accounts (id) VALUES ('alice'), ('bob');
  `);
  const sanctions = new ClubSanctionStore(db);
  const auth = new ChatGameAuthorization(db.schema, sanctions.ready);
  context.after(async () => {
    try { await auth.close(); await db.dropSchema(); }
    finally { await db.close(); }
  });
  await auth.ready;
  const newSession = async (accountId: string, expires = Date.now() + 60_000) => {
    const hash = sessionHash();
    await db.prepare('INSERT INTO sessions (hash, account_id, expires) VALUES (?, ?, ?)').run(hash, accountId, expires);
    return { accountId, sessionHash: hash };
  };
  return { db, sanctions, auth, newSession };
}

test('bulk admission binds the original session and stores the observed appearance', async context => {
  const { db, auth, newSession } = await fixture(context);
  const alice = await newSession('alice');
  const expiredBob = await newSession('bob', Date.now() - 1000);
  const skinId = randomUUID();
  await db.prepare('UPDATE accounts SET appearance=?::jsonb WHERE id=?')
    .run(JSON.stringify({ version: 2, skinId, theme: 'south-park' }), 'alice');

  const result = await auth.admit([expiredBob, alice, { ...alice, accountId: 'bob' }, alice]);
  assert.equal(result[0], null);
  assert.equal(result[2], null);
  assert(result[1]);
  assert.equal(result[1].clearanceGeneration, 0);
  assert.equal(result[1].equippedSkinId, skinId);
  assert.deepEqual(result[3], result[1]);

  const [authorizedAt] = await auth.verifyPublication([alice]);
  assert(authorizedAt && authorizedAt >= result[1].authorizedAt);
  await db.prepare('DELETE FROM sessions WHERE hash=?').run(alice.sessionHash);
  const later = await newSession('alice');
  const verified = await auth.verifyPublication([alice, later]);
  assert.equal(verified[0], null);
  assert(verified[1]);
});

test('two expiry normalizers clear a single old episode and share its new generation', async context => {
  const { db, auth, newSession, sanctions } = await fixture(context);
  const alice = await newSession('alice');
  const old = await sanctions.recordViolation('alice', { id: 'old', reason: 'spam' }, Date.now() - 21 * 60_000);

  const [first, second] = await Promise.all([auth.admit([alice]), auth.admit([alice, alice])]);
  assert.equal(first[0]?.clearanceGeneration, 1);
  assert.equal(second[0]?.clearanceGeneration, 1);
  assert.deepEqual(second[0], second[1]);
  assert.equal(await db.prepare('SELECT episode_id FROM club_sanctions WHERE account_id=?').get('alice'), undefined);
  assert.deepEqual(await db.prepare('SELECT clearance_generation,state_version FROM club_conduct_state WHERE account_id=?').get('alice'),
    { clearance_generation: 1, state_version: 1 });

  await sanctions.recordViolation('alice', { id: 'fresh', reason: 'spam' });
  assert.equal(await normalizeExpiredClubSanction(db, 'alice', { expectedEpisodeId: old.outcome.sanction.id }), undefined);
  assert(await sanctions.active('alice'));
  assert.equal((await auth.admit([alice]))[0]?.clearanceGeneration, 1);
});

test('clearance and state changes use the existing account transaction and roll back together', async context => {
  const { db, auth, newSession } = await fixture(context);
  const alice = await newSession('alice');
  await assert.rejects(advanceClubConductState(db, 'alice', true), /requires an account transaction/);
  await assert.rejects(db.transaction(() => advanceClubConductState(db, 'alice', true), { lockKey: 'account:bob' }), /same lock key/);
  await assert.rejects(db.transaction(async () => {
    await advanceClubConductState(db, 'alice', true);
    throw new Error('rollback');
  }, { lockKey: 'account:alice' }), /rollback/);
  assert.equal((await auth.admit([alice]))[0]?.clearanceGeneration, 0);

  const update = (cleared: boolean) => db.transaction(() => advanceClubConductState(db, 'alice', cleared), { lockKey: 'account:alice' });
  assert.deepEqual(await update(false), { clearanceGeneration: 0, stateVersion: 1 });
  assert.deepEqual(await update(true), { clearanceGeneration: 1, stateVersion: 2 });
  assert.equal((await auth.admit([alice]))[0]?.clearanceGeneration, 1);
});

test('a busy authorization pool fails temporarily before adding unbounded waiters', async context => {
  const { db, newSession } = await fixture(context);
  const alice = await newSession('alice');
  let allow!: () => void;
  const ready = new Promise<void>(done => { allow = done; });
  const auth = new ChatGameAuthorization(db.schema, ready, 1);
  try {
    await assert.rejects(auth.admit(Array.from({ length: 51 }, () => alice)), /Invalid chat authorization batch/);
    const queued = { ...alice };
    const first = auth.verifyPublication([queued]);
    queued.sessionHash = sessionHash();
    try {
      await assert.rejects(auth.admit([alice]), ChatAuthorizationUnavailable);
    } finally {
      allow();
      assert((await first)[0]);
    }
    assert((await auth.admit([alice]))[0]);
  } finally {
    await auth.close();
  }
});

test('an account lock timeout is retryable without clearing a sanction outside its transaction', async context => {
  const { db, auth, sanctions, newSession } = await fixture(context);
  const alice = await newSession('alice');
  await sanctions.recordViolation('alice', { id: 'old', reason: 'spam' }, Date.now() - 21 * 60_000);
  let acquired!: () => void;
  let release!: () => void;
  const locked = new Promise<void>(done => { acquired = done; });
  const finish = new Promise<void>(done => { release = done; });
  const holding = db.transaction(async () => {
    acquired();
    await finish;
  }, { lockKey: 'account:alice' });
  await locked;
  try {
    await assert.rejects(auth.admit([alice]), error => error instanceof ChatAuthorizationUnavailable
      && (error.cause as NodeJS.ErrnoException).code === '55P03');
    assert.equal(await db.prepare('SELECT account_id FROM club_conduct_state WHERE account_id=?').get('alice'), undefined);
  } finally {
    release();
    await holding;
  }
  assert.equal((await auth.admit([alice]))[0]?.clearanceGeneration, 1);
});
