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
import {CaribbeanCrewStore} from '../server/caribbeanCrew';
import {CaribbeanVoyageError, CaribbeanVoyageStore} from '../server/caribbeanVoyage';
import {installCaribbeanVoyage} from '../server/caribbeanVoyageRoutes';
import {CARIBBEAN_VOYAGE, CARIBBEAN_VOYAGE_GAME, caribbeanVoyagePoints, caribbeanVoyageReached, validCaribbeanVoyageProfile, validCaribbeanVoyageRequest} from '../src/shared/caribbeanVoyage';
import {CARIBBEAN_CREW} from '../games/caribbean-treasures/CaribbeanCrew';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';
import {seededRandom} from '../src/shared/draconaMath';

async function fixture() {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");
  const random = seededRandom(7), plain = new DemoWalletStore(db, max => Math.floor(random() * max));
  const progression = new ProgressionStore(db, {prerequisite: plain.ready}), wallet = instrumentProgressionWallet(db, plain, progression), earlier = new CaribbeanCrewStore(db);
  await Promise.all([wallet.ready, progression.ready, earlier.ready]);
  for (const account of ['alice', 'bob']) for (let i = 0; i < 3; i++) await wallet.operate(account, {id: randomUUID(), kind: 'deposit', amount: 100000});
  return {db, wallet, progression, earlier, voyage: () => new CaribbeanVoyageStore(db, progression.ready)};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const operate = async (f: Fixture, account: string, operation: any) => (f.wallet.expansion as any).operate(account, operation, 2, true, true, true, true, true, true, true, true, 2, 3, true);
const start = (stakeUnits: string, mode = 'normal') => ({id: randomUUID(), action: 'start' as const, gameId: CARIBBEAN_VOYAGE_GAME, stakeUnits, stakePolicyVersion: 1, settings: {caribbean: {lines: 20, mode, stakeBasis: 'total'}}});
async function finish(f: Fixture, account: string, session: any) {
  let moves = 0;
  while (session.state === 'active') {
    const move = session.view.caribbean.phase === 'choice' ? 'caribbean-choose-raid' : 'caribbean-spin';
    session = (await operate(f, account, {id: randomUUID(), action: 'move', gameId: CARIBBEAN_VOYAGE_GAME, sessionId: session.id, move, revision: session.view.caribbean.revision})).session;
    moves++;
  }
  return moves;
}
async function round(f: Fixture, account: string, stake: string, mode = 'normal') {
  const operation = start(stake, mode), reply = await operate(f, account, operation);
  return {operation, cost: Number(reply.session.view.caribbean.costUnits), moves: await finish(f, account, reply.session)};
}
/** A committed settlement exactly as the progression outbox stores it. */
async function settle(f: Fixture, account: string, cents: number, options: {gameId?: string; at?: number; refunded?: number} = {}) {
  const sourceId = 'native:casino:' + randomUUID(), at = options.at ?? Date.now();
  assert.equal(await f.progression.acceptRound({sourceType: 'paid-game', sourceId, accountId: account, locationId: 'south-park', gameId: options.gameId ?? CARIBBEAN_VOYAGE_GAME, environment: 'VIRTUAL_USD', fundingSource: 'cash', acceptedAt: Date.now() - 1} as any), true);
  await f.progression.recordSettled({sourceType: 'paid-game', sourceId, accountId: account, paidUnits: String(cents * 10000), refundedUnits: String((options.refunded ?? 0) * 10000), settledAt: at, outcome: options.refunded === cents ? 'refunded' : 'settled'} as any);
}

test('the approved scale covers every cent boundary and the route names every pirate once', () => {
  for (const [cents, points] of [[0, 0], [9, 0], [10, 1], [49, 1], [50, 2], [99, 2], [100, 3], [499, 3], [500, 5], [999, 5], [1000, 8], [4999, 8], [5000, 12], [10000, 12]]) assert.equal(caribbeanVoyagePoints(cents), points, String(cents));
  for (const cents of [-1, 1.5, NaN, Infinity]) assert.throws(() => caribbeanVoyagePoints(cents));
  assert.deepEqual(CARIBBEAN_VOYAGE.map(m => m.points), [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250]);
  assert.deepEqual(CARIBBEAN_VOYAGE.map(m => m.id), CARIBBEAN_CREW.map(m => m.id));
  assert.deepEqual(caribbeanVoyageReached(99), ['isabella']); assert.deepEqual(caribbeanVoyageReached(250), ['isabella', 'amara', 'mei']); assert.equal(caribbeanVoyageReached(3250).length, 11);
});

test('tokens become points one to one and opened pirates stay', async () => {
  const f = await fixture();
  try {
    await f.earlier.snapshot('alice');
    for (const [key, reward] of [['lesson-lines', 20], ['lesson-giant', 20], ['2026-10-28:daily-cargo', 50], ['2026-10-29:daily-cargo', 50]]) await f.db.prepare("INSERT INTO caribbean_crew_completed VALUES('alice',?,?,1)").run(key, reward);
    await f.db.prepare("INSERT INTO caribbean_crew_owned(account_id,character_id,cost,unlocked_at) VALUES('alice','freya',100,5)").run();
    await f.db.prepare("UPDATE caribbean_crew_profiles SET selected_id='freya' WHERE account_id='alice'").run();
    const voyage = f.voyage(), profile = await voyage.snapshot('alice');
    assert.equal(profile.points, 40); assert.deepEqual(profile.met, ['isabella', 'freya']); assert.deepEqual(profile.reached, ['isabella']); assert.equal(profile.selected, 'freya');
    assert.equal((await voyage.snapshot('bob')).points, 0);
    // A restart carries nothing over again.
    assert.equal((await f.voyage().snapshot('alice')).points, 40);
    await settle(f, 'alice', 5000); assert.equal((await voyage.snapshot('alice')).points, 52);
    const back = await voyage.operate('alice', {action: 'select', characterId: 'isabella'}); assert.equal(back.selected, 'isabella'); assert.deepEqual(back.met, ['isabella', 'freya']);
  } finally { await f.db.close(); }
});

test('the database scale equals the shared scale', async () => {
  const f = await fixture();
  try {
    const voyage = f.voyage(); await voyage.ready; let expected = 0;
    for (const cents of [10, 49, 50, 99, 100, 499, 500, 999, 1000, 4999, 5000, 400, 13500]) { await settle(f, 'alice', cents); expected += caribbeanVoyagePoints(cents); assert.equal((await voyage.snapshot('alice')).points, expected, String(cents)); }
  } finally { await f.db.close(); }
});

test('real rounds count once by the whole debited amount, with free spins and replays adding nothing', async () => {
  const f = await fixture();
  try {
    const voyage = f.voyage(); assert.equal((await voyage.snapshot('alice')).points, 0); let expected = 0;
    const first = await round(f, 'alice', '10'); expected += caribbeanVoyagePoints(first.cost); assert.equal((await voyage.snapshot('alice')).points, expected);
    await operate(f, 'alice', first.operation); assert.equal((await voyage.snapshot('alice')).points, expected);
    const raid = await round(f, 'alice', '10', 'buy-raid'); assert.equal(raid.moves, 14); assert(raid.cost > 100);
    expected += caribbeanVoyagePoints(raid.cost); assert.equal((await voyage.snapshot('alice')).points, expected);
    assert.deepEqual(await Promise.all(Array.from({length: 6}, () => voyage.snapshot('alice'))).then(list => list.map(item => item.points)), Array(6).fill(expected));
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM caribbean_voyage_rounds').get())!.n, 2);
    assert.equal((await voyage.snapshot('bob')).points, 0);
  } finally { await f.db.close(); }
});

test('reading the voyage changes neither the balance nor the ledger', async () => {
  const f = await fixture();
  try {
    const voyage = f.voyage(); await round(f, 'alice', '100');
    const before = [await demoBalanceUnits(f.db, 'alice'), (await f.db.prepare('SELECT COUNT(*) AS n FROM demo_ledger').get())!.n];
    for (let i = 0; i < 3; i++) await voyage.snapshot('alice');
    assert.deepEqual([await demoBalanceUnits(f.db, 'alice'), (await f.db.prepare('SELECT COUNT(*) AS n FROM demo_ledger').get())!.n], before);
  } finally { await f.db.close(); }
});

test('an unfinished series counts only when it ends and blocks a change of pirate, not a meeting', async () => {
  const f = await fixture();
  try {
    const voyage = f.voyage(); await voyage.ready; for (let i = 0; i < 9; i++) await settle(f, 'alice', 5000);
    const reply = await operate(f, 'alice', start('10', 'buy-flagship')); assert.equal(reply.session.state, 'active');
    let profile = await voyage.snapshot('alice'); assert.equal(profile.points, 108); assert.equal(profile.active, true);
    assert.deepEqual((await voyage.operate('alice', {action: 'meet', characterId: 'amara'})).met, ['isabella', 'amara']);
    await assert.rejects(voyage.operate('alice', {action: 'select', characterId: 'amara'}), (error: CaribbeanVoyageError) => error.status === 409 && error.code === 'round-active');
    await finish(f, 'alice', reply.session);
    profile = await voyage.snapshot('alice'); assert.equal(profile.points, 108 + caribbeanVoyagePoints(Number(reply.session.view.caribbean.costUnits))); assert.equal(profile.active, false);
    assert.equal((await voyage.operate('alice', {action: 'select', characterId: 'amara'})).selected, 'amara');
  } finally { await f.db.close(); }
});

test('rounds before the launch, other games, refunds and earlier totals stay outside', async () => {
  const f = await fixture();
  try {
    await settle(f, 'alice', 5000, {at: Date.now() - 60000});
    const voyage = f.voyage(); await voyage.ready; await new Promise(resolve => setTimeout(resolve, 5));
    await settle(f, 'alice', 5000, {gameId: 'studio-cosmic-escape'}); await settle(f, 'alice', 5000, {refunded: 5000});
    assert.equal((await voyage.snapshot('alice')).points, 0);
    await settle(f, 'alice', 100); assert.equal((await voyage.snapshot('alice')).points, 3);
    assert.equal((await f.voyage().snapshot('alice')).points, 3);
  } finally { await f.db.close(); }
});

test('a new pirate opens at the threshold, waits ashore and stays chosen', async () => {
  const f = await fixture();
  try {
    const voyage = f.voyage(); await voyage.ready; for (let i = 0; i < 8; i++) await settle(f, 'alice', 5000);
    await settle(f, 'alice', 100);
    assert.equal((await voyage.snapshot('alice')).points, 99);
    for (const action of ['select', 'meet']) await assert.rejects(voyage.operate('alice', {action, characterId: 'amara'}), (error: CaribbeanVoyageError) => error.status === 403);
    await settle(f, 'alice', 10);
    let profile = await voyage.snapshot('alice'); assert.deepEqual(profile.reached, ['isabella', 'amara']); assert.deepEqual(profile.met, ['isabella']); assert.equal(profile.selected, 'isabella');
    profile = await voyage.operate('alice', {action: 'meet', characterId: 'amara'}); assert.deepEqual(profile.met, ['isabella', 'amara']); assert.equal(profile.selected, 'isabella');
    const chosen = await voyage.operate('alice', {action: 'select', characterId: 'amara'}); assert.equal(chosen.selected, 'amara');
    assert.deepEqual(await voyage.operate('alice', {action: 'select', characterId: 'amara'}), chosen, 'a lost response can be repeated');
    assert.equal((await f.voyage().snapshot('alice')).selected, 'amara'); assert.equal((await voyage.snapshot('bob')).selected, 'isabella');
  } finally { await f.db.close(); }
});

test('forged requests and profiles are rejected', () => {
  for (const value of [null, [], {}, {action: 'select'}, {action: 'buy', characterId: 'amara'}, {action: 'select', characterId: 'other'}, {action: 'select', characterId: 'amara', points: 100}]) assert.equal(validCaribbeanVoyageRequest(value), false);
  const good = {version: 1, accountId: 'a', revision: 2, points: 100, reached: ['isabella', 'amara'], met: ['isabella', 'freya'], selected: 'freya', active: false};
  assert.equal(validCaribbeanVoyageProfile(good), true);
  for (const bad of [{...good, points: 99}, {...good, reached: ['isabella']}, {...good, met: ['isabella']}, {...good, met: ['freya']}, {...good, met: ['isabella', 'freya', 'freya']}, {...good, selected: 'other'}, {...good, extra: 1}, {...good, revision: -1}]) assert.equal(validCaribbeanVoyageProfile(bad), false);
});

test('routes bind the session account, reject strangers and report failures without leaking details', async () => {
  const f = await fixture(), app = express();
  installCaribbeanVoyage(app, f.voyage(), async token => token ? {account: {id: 'alice'}} : null);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/caribbean-voyage`, cookie = {Cookie: 'royal_session=' + 'a'.repeat(64)};
  try {
    assert.equal((await fetch(url)).status, 401);
    const signed = await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice'}});
    assert.equal(signed.status, 200); assert.equal(signed.headers.get('cache-control'), 'private, no-store'); assert.equal(validCaribbeanVoyageProfile(await signed.json()), true);
    assert.equal((await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'bob'}})).status, 409);
    assert.equal((await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice', 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example'}})).status, 403);
    const post = (body: string) => fetch(url, {method: 'POST', headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice', 'Content-Type': 'application/json'}, body});
    assert.equal((await post('{')).status, 400); assert.equal((await post('{"action":"select","characterId":"amara"}')).status, 403);
    await f.db.close();
    const failed = await fetch(url, {headers: {...cookie, [WALLET_ACCOUNT_HEADER]: 'alice'}}); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), {error: 'voyage-unavailable'});
  } finally { server.close(); await f.db.close().catch(() => {}); }
});

test('a migration stopped by startup is repeated by the next request', async () => {
  const f = await fixture();
  await f.db.exec('ALTER TABLE progression_outbox RENAME TO progression_outbox_held');
  const voyage = f.voyage();
  await assert.rejects(voyage.ready);
  await f.db.exec('ALTER TABLE progression_outbox_held RENAME TO progression_outbox');
  assert.deepEqual((await voyage.snapshot('alice')).met, ['isabella']);
  await settle(f, 'alice', 100);
  assert.equal((await voyage.snapshot('alice')).points, 3);
  await f.db.close();
});
