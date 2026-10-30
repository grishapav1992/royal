import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTsuEFa, playTsuEFa, publicTsuEFa } from '../server/pvp/tsu-e-fa';
import { TSU_E_FA_CHOICES } from '../src/shared/tsuEFa';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { PvpStore } from '../server/pvp/store';
import type { PvpRequest } from '../src/shared/pvp';

test('all sign pairs resolve identically in either submission order and reveal no pending opponent sign', () => {
  const expected = [[null, 0, 1], [1, null, 0], [0, 1, null]];
  for (const [a, left] of TSU_E_FA_CHOICES.entries()) for (const [b, right] of TSU_E_FA_CHOICES.entries()) for (const first of [0, 1] as const) {
    const initial = createTsuEFa(), choices = [left, right];
    const locked = playTsuEFa(initial, first, { kind: 'choose', round: 1, choice: choices[first] });
    assert.deepEqual(initial.choices, [null, null], 'rules do not mutate accepted state');
    const own = publicTsuEFa(locked, first), other = publicTsuEFa(locked, first === 0 ? 1 : 0);
    assert.equal(own.choice, choices[first]); assert.equal(other.choice, null); assert.equal(other.last, null);
    assert(!('choices' in other)); assert.deepEqual(other.locked, first === 0 ? [true, false] : [false, true]);
    own.score[0] = 99; assert.equal(locked.score[0], 0);
    assert.throws(() => playTsuEFa(locked, first, { kind: 'choose', round: 1, choice: choices[first] }));
    const result = playTsuEFa(locked, 1 - first, { kind: 'choose', round: 1, choice: choices[1 - first] });
    assert.equal(result.last!.winner, expected[a][b]); assert.deepEqual(result.last!.choices, choices);
    assert.deepEqual(result.score, expected[a][b] === null ? [0, 0] : expected[a][b] === 0 ? [1, 0] : [0, 1]);
    assert.throws(() => playTsuEFa(result, 0, { kind: 'choose', round: 1, choice: left }));
  }
});

test('malformed choices and future round tokens cannot alter state', () => {
  const state = createTsuEFa();
  for (const move of [null, [], {}, { kind: 'choose', round: 1, choice: 'lizard' }, { kind: 'choose', round: 2, choice: 'rock' },
    { kind: 'choose', round: 1, choice: 'rock', winner: 0 }, { kind: 'choose', round: '1', choice: 'rock' }]) assert.throws(() => playTsuEFa(state, 0, move));
  assert.throws(() => playTsuEFa(state, 2, { kind: 'choose', round: 1, choice: 'rock' }));
  assert.deepEqual(state, createTsuEFa());
});

async function fixture() {
  const db = new PostgresDatabase(':memory:'), a = randomUUID(), b = randomUUID(), now = Date.now();
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  for (const id of [a, b]) await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
  const common = new DemoWalletStore(db); await common.ready;
  for (const id of [a, b]) await common.operate(id, { id: randomUUID(), kind: 'deposit', amount: 200 });
  const ledger = new VirtualPvpLedger(db, common), store = new PvpStore(ledger); await store.ready;
  const actors = [a, b].map((accountId, side) => ({ accountId, name: ['Анна', 'Борис'][side], roomId: 'tsu-test' }));
  const people = actors.map(actor => ({ ...actor, connected: true, available: true }));
  await store.syncRoom('tsu-test', people, now);
  const created = await store.command(actors[0], { id: randomUUID(), action: 'create', gameId: 'tsu-e-fa', stakeUnits: '1100000', targetId: b }, now);
  const challengeId = created.active!.id;
  await store.command(actors[1], { id: randomUUID(), action: 'accept', challengeId }, now);
  for (const actor of actors) await store.command(actor, { id: randomUUID(), action: 'ready', challengeId }, now);
  const choice = (round: number, sign: 'rock' | 'scissors' | 'paper'): PvpRequest => ({ id: randomUUID(), action: 'move', challengeId, revision: 0, move: { kind: 'choose', round, choice: sign } });
  return { db, common, ledger, store, now, actors, people, challengeId, choice };
}

test('real wallet: simultaneous moves, tie, reload, replay and first-to-two settle exactly once', async () => {
  const c = await fixture(); try {
    const [a, b] = c.actors, first = c.choice(1, 'rock');
    await c.store.command(a, first, c.now);
    const opponent = await c.store.snapshot(b, c.now);
    assert.equal(opponent.tsuEFa!.choice, null); assert.equal(opponent.tsuEFa!.last, null);
    assert.equal(opponent.cards, null);
    const restarted = new PvpStore(c.ledger); await restarted.ready;
    assert.equal((await restarted.snapshot(a, c.now)).tsuEFa!.choice, 'rock');
    await restarted.command(b, c.choice(1, 'rock'), c.now);
    await restarted.command(a, first, c.now); // Lost response retried after a round already resolved.
    assert.deepEqual((await restarted.snapshot(a, c.now)).tsuEFa!.score, [0, 0]);
    await assert.rejects(restarted.command(a, { ...first, move: { kind: 'choose', round: 1, choice: 'paper' } }, c.now));
    const decisive = c.choice(2, 'rock');
    await Promise.all([restarted.command(a, decisive, c.now), restarted.command(b, c.choice(2, 'scissors'), c.now)]);
    assert.deepEqual((await restarted.snapshot(b, c.now)).tsuEFa!.score, [1, 0]);
    await assert.rejects(restarted.command(a, c.choice(2, 'paper'), c.now));
    await Promise.all([restarted.command(a, c.choice(3, 'paper'), c.now), restarted.command(b, c.choice(3, 'rock'), c.now)]);
    const final = await restarted.snapshot(a, c.now);
    assert.equal(final.active!.status, 'finished'); assert.equal(final.active!.winnerId, a.accountId);
    assert.deepEqual(final.tsuEFa!.score, [2, 0]); assert.deepEqual(final.tsuEFa!.last!.choices, ['paper', 'rock']);
    await restarted.command(a, decisive, c.now);
    assert.equal((await c.common.snapshot(a.accountId)).balance, 200.99);
    assert.equal((await c.common.snapshot(b.accountId)).balance, 198.9);
    const bank = await c.db.prepare('SELECT * FROM virtual_pvp_banks').get(); assert.equal(Number(bank!.fee_units), 11);
    assert.equal(Number((await c.db.prepare('SELECT count(*) AS n FROM virtual_pvp_holds').get())!.n), 2);
    await assert.rejects(restarted.adjudicate('tsu-test', c.challengeId, b.accountId, 'win', c.now));
  } finally { await c.db.close(); }
});

for (const chosen of [null, 0, 1] as const) test(`round timeout with chosen side ${chosen} refunds or settles the confirmed player`, async () => {
  const c = await fixture(); try {
    if (chosen !== null) await c.store.command(c.actors[chosen], c.choice(1, 'scissors'), c.now);
    for (let delta = 10000; delta <= 60000; delta += 10000) await c.store.syncRoom('tsu-test', c.people, c.now + delta);
    const final = await c.store.snapshot(c.actors[0], c.now + 60000);
    assert.equal(final.active!.status, 'finished'); assert.equal(final.active!.winnerId, chosen === null ? null : c.actors[chosen].accountId);
    for (let side = 0; side < 2; side++) assert.equal((await c.common.snapshot(c.actors[side].accountId)).balance, chosen === null ? 200 : chosen === side ? 200.99 : 198.9);
  } finally { await c.db.close(); }
});

test('lost room lease refunds the entire accepted match', async () => {
  const c = await fixture(); try {
    await c.store.command(c.actors[0], c.choice(1, 'paper'), c.now);
    await c.store.sweep(c.now + 15001);
    assert.equal((await c.store.snapshot(c.actors[0])).active!.reason, 'server');
    for (const actor of c.actors) assert.equal((await c.common.snapshot(actor.accountId)).balance, 200);
  } finally { await c.db.close(); }
});
