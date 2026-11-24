import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {demoBalanceUnits} from '../server/demoWalletAmounts';
import {ProgressionStore} from '../server/progression/store';
import {instrumentProgressionWallet} from '../server/progression/sources';
import {CosmicCrewError, CosmicCrewStore} from '../server/cosmicCrew';
import {installCosmicCrew} from '../server/cosmicCrewRoutes';
import {COSMIC_CREW_GAME, cosmicCrewPoints, cosmicCrewUnlocked, validCosmicCrewProfile, validCosmicCrewRequest} from '../src/shared/cosmicCrew';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
import {seededRandom} from '../src/shared/draconaMath';

async function fixture() {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");
  const random = seededRandom(7), plain = new DemoWalletStore(db, max => Math.floor(random() * max));
  const progression = new ProgressionStore(db, {prerequisite: plain.ready}), wallet = instrumentProgressionWallet(db, plain, progression);
  await Promise.all([wallet.ready, progression.ready]);
  for (const account of ['alice', 'bob']) for (let i = 0; i < 3; i++) await wallet.operate(account, {id: randomUUID(), kind: 'deposit', amount: 100000});
  return {db, wallet, progression, crew: () => new CosmicCrewStore(db, progression.ready)};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const start = (stakeUnits: string, mode = 'normal') => ({id: randomUUID(), action: 'start' as const, gameId: COSMIC_CREW_GAME, stakeUnits, stakePolicyVersion: 1, settings: {luelon: {mode}}});
async function finish(f: Fixture, account: string, session: any) {
  let spins = 0;
  while (session.state === 'active') {
    session = (await f.wallet.expansion.operate(account, {id: randomUUID(), action: 'move', gameId: COSMIC_CREW_GAME, sessionId: session.id, move: 'luelon-spin', revision: session.view.luelon.revision} as any)).session;
    spins++;
  }
  return spins;
}
async function round(f: Fixture, account: string, stake: string, mode = 'normal') {
  const operation = start(stake, mode), reply = await f.wallet.expansion.operate(account, operation as any);
  return {operation, spins: await finish(f, account, reply.session)};
}
/** A committed settlement exactly as the progression outbox stores it. */
async function settle(f: Fixture, account: string, cents: number, options: {gameId?: string; at?: number; refunded?: number} = {}) {
  const sourceId = 'native:casino:' + randomUUID(), at = options.at ?? Date.now();
  assert.equal(await f.progression.acceptRound({sourceType: 'paid-game', sourceId, accountId: account, locationId: 'south-park', gameId: options.gameId ?? COSMIC_CREW_GAME, environment: 'VIRTUAL_USD', fundingSource: 'cash', acceptedAt: Date.now()}), true);
  await f.progression.recordSettled({sourceType: 'paid-game', sourceId, accountId: account, paidUnits: String(cents * 10000), refundedUnits: String((options.refunded ?? 0) * 10000), settledAt: at, outcome: options.refunded === cents ? 'refunded' : 'settled'});
}

test('the approved scale covers every cent boundary', () => {
  for (const [cents, points] of [[0, 0], [9, 0], [10, 1], [49, 1], [50, 2], [99, 2], [100, 3], [499, 3], [500, 5], [999, 5], [1000, 8], [4999, 8], [5000, 12], [10000, 12], [1350000, 12]]) assert.equal(cosmicCrewPoints(cents), points, String(cents));
  for (const cents of [-1, 1.5, NaN, Infinity]) assert.throws(() => cosmicCrewPoints(cents));
  assert.deepEqual(cosmicCrewUnlocked(99), ['racer']); assert.deepEqual(cosmicCrewUnlocked(100), ['racer', 'silver']);
});

test('the database scale equals the shared scale', async () => {
  const f = await fixture();
  try {
    const crew = f.crew(); await crew.ready; let expected = 0;
    for (const cents of [10, 49, 50, 99, 100, 499, 500, 999, 1000, 4999, 5000, 400, 13500]) { await settle(f, 'alice', cents); expected += cosmicCrewPoints(cents); assert.equal((await crew.snapshot('alice')).points, expected, String(cents)); }
  } finally { await f.db.close(); }
});

test('real rounds count once by the whole debited amount, with free spins and replays adding nothing', async () => {
  const f = await fixture();
  try {
    const crew = f.crew(); assert.equal((await crew.snapshot('alice')).points, 0);
    const first = await round(f, 'alice', '10'); assert.equal((await crew.snapshot('alice')).points, 1);
    await f.wallet.expansion.operate('alice', first.operation as any); assert.equal((await crew.snapshot('alice')).points, 1);
    await round(f, 'alice', '100'); assert.equal((await crew.snapshot('alice')).points, 4);
    // A mission for 0.10 x 40 costs 4.00 and has ten free spins.
    const mission = await round(f, 'alice', '10', 'cosmic-chaos'); assert(mission.spins >= 9);
    const profile = await crew.snapshot('alice'); assert.equal(profile.points, 7);
    assert.deepEqual(await Promise.all(Array.from({length: 6}, () => crew.snapshot('alice'))).then(list => list.map(item => item.points)), Array(6).fill(7));
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM cosmic_crew_rounds').get())!.n, 3);
    assert.equal((await crew.snapshot('bob')).points, 0);
  } finally { await f.db.close(); }
});

test('reading the crew changes neither the balance nor the ledger', async () => {
  const f = await fixture();
  try {
    const crew = f.crew(); await round(f, 'alice', '5000');
    const before = [await demoBalanceUnits(f.db, 'alice'), (await f.db.prepare('SELECT COUNT(*) AS n FROM demo_ledger').get())!.n];
    for (let i = 0; i < 3; i++) await crew.snapshot('alice');
    assert.deepEqual([await demoBalanceUnits(f.db, 'alice'), (await f.db.prepare('SELECT COUNT(*) AS n FROM demo_ledger').get())!.n], before);
  } finally { await f.db.close(); }
});

test('an unfinished mission counts only when it ends and blocks a character change', async () => {
  const f = await fixture();
  try {
    const crew = f.crew(); await crew.ready; for (let i = 0; i < 9; i++) await settle(f, 'alice', 5000);
    await crew.operate('alice', {action: 'reveal', characterId: 'silver'});
    const reply = await f.wallet.expansion.operate('alice', start('10', 'cosmic-chaos') as any);
    let profile = await crew.snapshot('alice'); assert.equal(profile.points, 108); assert.equal(profile.active, true);
    await assert.rejects(crew.operate('alice', {action: 'select', characterId: 'silver'}), (error: CosmicCrewError) => error.status === 409 && error.code === 'round-active');
    await finish(f, 'alice', reply.session);
    profile = await crew.snapshot('alice'); assert.equal(profile.points, 111); assert.equal(profile.active, false);
    assert.equal((await crew.operate('alice', {action: 'select', characterId: 'silver'})).selected, 'silver');
  } finally { await f.db.close(); }
});

test('rounds before the launch, other games, refunds and earlier totals stay outside', async () => {
  const f = await fixture();
  try {
    await settle(f, 'alice', 5000, {at: Date.now() - 60000});
    const crew = f.crew(); await crew.ready; await new Promise(resolve => setTimeout(resolve, 5));
    await settle(f, 'alice', 5000, {gameId: 'studio-velvet-reign'}); await settle(f, 'alice', 5000, {refunded: 5000});
    assert.equal((await crew.snapshot('alice')).points, 0);
    await settle(f, 'alice', 100); assert.equal((await crew.snapshot('alice')).points, 3);
    // A second store and a restart keep the launch moment and the credited rounds.
    const restarted = f.crew(); assert.equal((await restarted.snapshot('alice')).points, 3);
  } finally { await f.db.close(); }
});

test('a new character opens at the threshold, waits for its capsule and stays chosen', async () => {
  const f = await fixture();
  try {
    const crew = f.crew(); await crew.ready; for (let i = 0; i < 8; i++) await settle(f, 'alice', 5000);
    await settle(f, 'alice', 100);
    assert.equal((await crew.snapshot('alice')).points, 99);
    for (const action of ['select', 'reveal']) await assert.rejects(crew.operate('alice', {action, characterId: 'silver'}), (error: CosmicCrewError) => error.status === 403);
    await settle(f, 'alice', 10);
    let profile = await crew.snapshot('alice'); assert.deepEqual(profile.unlocked, ['racer', 'silver']); assert.deepEqual(profile.revealed, ['racer']); assert.equal(profile.selected, 'racer');
    profile = await crew.operate('alice', {action: 'reveal', characterId: 'silver'}); assert.deepEqual(profile.revealed, ['racer', 'silver']); assert.equal(profile.selected, 'racer');
    const chosen = await crew.operate('alice', {action: 'select', characterId: 'silver'}); assert.equal(chosen.selected, 'silver');
    assert.deepEqual(await crew.operate('alice', {action: 'select', characterId: 'silver'}), chosen, 'a lost response can be repeated');
    assert.equal((await f.crew().snapshot('alice')).selected, 'silver');
    assert.equal((await crew.snapshot('bob')).selected, 'racer');
  } finally { await f.db.close(); }
});

test('parallel choices and reads keep one consistent profile', async () => {
  const f = await fixture();
  try {
    const crew = f.crew(); await crew.ready; for (let i = 0; i < 9; i++) await settle(f, 'alice', 5000);
    await Promise.all([...Array.from({length: 5}, () => crew.operate('alice', {action: 'select', characterId: 'silver'})), ...Array.from({length: 5}, () => f.crew().snapshot('alice'))]);
    const profile = await crew.snapshot('alice'); assert.equal(profile.points, 108); assert.equal(profile.selected, 'silver'); assert.deepEqual(profile.revealed, ['racer', 'silver']);
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM cosmic_crew_rounds').get())!.n, 9);
  } finally { await f.db.close(); }
});

test('forged requests and profiles are rejected', () => {
  for (const value of [null, [], {}, {action: 'select'}, {action: 'buy', characterId: 'silver'}, {action: 'select', characterId: 'other'}, {action: 'select', characterId: 'silver', points: 100}]) assert.equal(validCosmicCrewRequest(value), false);
  const good = {version: 1, accountId: 'a', revision: 2, points: 100, unlocked: ['racer', 'silver'], revealed: ['racer', 'silver'], selected: 'silver', active: false};
  assert.equal(validCosmicCrewProfile(good), true);
  for (const bad of [{...good, points: 99}, {...good, unlocked: ['racer']}, {...good, revealed: ['racer']}, {...good, revealed: ['racer', 'racer']}, {...good, selected: 'other'}, {...good, extra: 1}, {...good, revision: -1}]) assert.equal(validCosmicCrewProfile(bad), false);
});

test('routes bind the session account, reject strangers and report failures without leaking details', async () => {
  const f = await fixture(), app = express();
  installCosmicCrew(app, f.crew(), async token => token ? {account: {id: 'alice'}} : null);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/cosmic-crew`, cookie = {Cookie: 'royal_session=' + 'a'.repeat(64)};
  try {
    assert.equal((await fetch(url)).status, 401);
    const signed = await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice'}});
    if (signed.status === 401) { // The cookie name belongs to the host; the bound handler is checked below.
      assert.fail('the test cookie must match the host session cookie');
    }
    assert.equal(signed.status, 200); assert.equal(signed.headers.get('cache-control'), 'private, no-store'); assert.equal(validCosmicCrewProfile(await signed.json()), true);
    assert.equal((await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'bob'}})).status, 409);
    assert.equal((await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice', 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example'}})).status, 403);
    const post = (body: string) => fetch(url, {method: 'POST', headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice', 'Content-Type': 'application/json'}, body});
    assert.equal((await post('{')).status, 400); assert.equal((await post('{"action":"select","characterId":"silver"}')).status, 403);
    await f.db.close();
    const failed = await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice'}}); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), {error: 'crew-unavailable'});
  } finally { server.close(); await f.db.close().catch(() => {}); }
});

test('a migration stopped by startup is repeated by the next request', async () => {
  const f = await fixture();
  await f.db.exec('ALTER TABLE progression_outbox RENAME TO progression_outbox_held');
  const crew = f.crew();
  await assert.rejects(crew.ready);
  await f.db.exec('ALTER TABLE progression_outbox_held RENAME TO progression_outbox');
  assert.deepEqual((await crew.snapshot('alice')).unlocked, ['racer']);
  await settle(f, 'alice', 100);
  assert.equal((await crew.snapshot('alice')).points, 3);
  await f.db.close();
});
