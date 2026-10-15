import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ClientState } from '@colyseus/core';
import { AccountStore, accounts } from '../server/accounts';
import { AccountLeaseStore, ACCOUNT_LEASE_MS } from '../server/accountLeases';
import { PostgresDatabase } from '../server/database';
import { LobbyRoom } from '../server/LobbyRoom';

async function fixture(store: AccountStore) {
  const login = await store.login(`lease-${randomUUID()}@example.test`, 'Lease-test-password!');
  await store.select(login.account.id, 0);
  const auth = (await store.session(login.token))!;
  return { login, auth };
}

test('independent PostgreSQL connections grant one account owner and fence stale renewals and releases', async () => {
  const store = new AccountStore(':memory:');
  const secondDatabase = new PostgresDatabase(store.schema);
  const otherWorker = new AccountLeaseStore(secondDatabase, store.ready);
  try {
    const { auth } = await fixture(store);
    const contenders = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? otherWorker : store.lobbyLeases).claim(auth.account.id, auth.hash, 'room-' + index, 'client-' + index)));
    const winners = contenders.filter(lease => lease !== undefined);
    assert.equal(winners.length, 1);
    const old = winners[0]!;
    assert((await otherWorker.renew([old])).has(old.token));
    await secondDatabase.prepare('UPDATE lobby_account_leases SET expires_at=0 WHERE account_id=?').run(auth.account.id);
    const replacement = (await otherWorker.claim(auth.account.id, auth.hash, 'replacement-room', 'replacement-client'))!;
    assert(replacement); assert.notEqual(old.token, replacement.token);
    assert.equal((await store.lobbyLeases.renew([old])).size, 0);
    await store.lobbyLeases.release([old]);
    assert((await otherWorker.renew([replacement])).has(replacement.token), 'a late old owner cannot remove the replacement');
    await otherWorker.release([replacement]);
    assert(await store.lobbyLeases.claim(auth.account.id, auth.hash, 'returned-room', 'returned-client'));
  } finally { await secondDatabase.close(); await store.close(); }
});

test('revoked or expired authentication cannot obtain or renew a lease', async () => {
  const store = new AccountStore(':memory:');
  const database = new PostgresDatabase(store.schema);
  try {
    const { login, auth } = await fixture(store);
    const lease = (await store.lobbyLeases.claim(auth.account.id, auth.hash, 'room', 'client'))!;
    assert(lease);
    await store.logout(login.token);
    assert.equal((await store.lobbyLeases.renew([lease])).size, 0);
    assert.equal(await store.lobbyLeases.claim(auth.account.id, auth.hash, 'other-room', 'other-client'), undefined);
    await store.lobbyLeases.release([lease]);
    const valid = await store.login(login.account.email, 'Lease-test-password!');
    const active = (await store.session(valid.token))!;
    await database.prepare('UPDATE sessions SET expires=0 WHERE hash=?').run(active.hash);
    assert.equal(await store.lobbyLeases.claim(active.account.id, active.hash, 'room', 'client'), undefined);
  } finally { await database.close(); await store.close(); }
});

test('a committed ban blocks account claims and renewals even without a security event', async () => {
  const store = new AccountStore(':memory:');
  const database = new PostgresDatabase(store.schema);
  try {
    const { auth } = await fixture(store);
    const warning = await store.moderation.record(auth.account.id);
    assert.equal(warning.kind, 'warning');
    const lease = (await store.lobbyLeases.claim(auth.account.id, auth.hash, 'room', 'client'))!;
    assert(lease, 'a warning must not prevent entry');
    assert((await store.lobbyLeases.renew([lease])).has(lease.token));
    let securityEvents = 0;
    store.events.on('security', () => { securityEvents++; });
    await store.moderation.eject(auth.account.id);
    assert.equal(securityEvents, 0, 'the checkpoint must work when the publisher misses the event');
    assert.equal((await store.lobbyLeases.renew([lease])).size, 0);
    await store.lobbyLeases.release([lease]);
    assert.equal(await store.lobbyLeases.claim(auth.account.id, auth.hash, 'banned-room', 'banned-client'), undefined);
    await database.prepare('UPDATE chat_conduct_discipline SET banned_until=0 WHERE account_id=?').run(auth.account.id);
    assert(await store.lobbyLeases.claim(auth.account.id, auth.hash, 'returned-room', 'returned-client'));
  } finally { await database.close(); await store.close(); }
});

test('a ban or logout committed while a join waits for its claim returns the correct auth rejection', async context => {
  const claim = accounts.lobbyLeases.claim.bind(accounts.lobbyLeases);
  for (const reason of ['ban', 'logout'] as const) {
    const { login, auth } = await fixture(accounts);
    const room = new LobbyRoom();
    const client = { sessionId: 'rejected-' + reason, auth, state: ClientState.JOINING, readyState: 1, leave() {}, send() {} };
    const intercepted = context.mock.method(accounts.lobbyLeases, 'claim', async (...args: Parameters<typeof claim>) => {
      if (reason === 'ban') await accounts.moderation.eject(auth.account.id);
      else await accounts.logout(login.token);
      return claim(...args);
    });
    try {
      await assert.rejects(room.onJoin(client as any, {}, auth), { code: reason === 'ban' ? 403 : 401 });
      assert.equal(room.state.players.size, 0);
      assert.equal((room as any).accountLeases.size, 0);
    } finally { intercepted.mock.restore(); await room.onDispose(); room.clock.clear(); await accounts.logout(login.token); }
  }
});

test('local lease deadlines use monotonic query start time instead of the application wall clock', async context => {
  const store = new AccountStore(':memory:');
  const database = new PostgresDatabase(store.schema);
  let monotonic = 1000;
  let wallTime = -(10 ** 13);
  const worker = new AccountLeaseStore(database, store.ready, () => monotonic);
  try {
    const { auth } = await fixture(store);
    context.mock.method(Date, 'now', () => wallTime);
    const lease = (await worker.claim(auth.account.id, auth.hash, 'room', 'client'))!;
    assert(lease.deadline > monotonic + ACCOUNT_LEASE_MS - 1000);
    assert(lease.deadline <= monotonic + ACCOUNT_LEASE_MS);
    monotonic = 2000;
    wallTime = 10 ** 13;
    const renewed = (await worker.renew([lease])).get(lease.token)!;
    assert(renewed.deadline > monotonic + ACCOUNT_LEASE_MS - 1000);
    assert(renewed.deadline <= monotonic + ACCOUNT_LEASE_MS);
  } finally { await database.close(); await store.close(); }
});

test('one account cannot join two different rooms even when both rooms have free seats', async () => {
  const { login, auth } = await fixture(accounts);
  const first = new LobbyRoom(), second = new LobbyRoom();
  const client = (sessionId: string) => ({ sessionId, auth, state: ClientState.JOINING, readyState: 1, leave() {}, send() {} });
  const original = client('original-owner'), duplicate = client('duplicate-owner');
  try {
    await first.onJoin(original as any, {}, auth);
    await assert.rejects(second.onJoin(duplicate as any, {}, auth), { code: 409 });
    assert.equal(first.state.players.size, 1); assert.equal(second.state.players.size, 0);
    await first.onLeave(original as any);
    await second.onJoin(duplicate as any, {}, auth);
    assert.equal(second.state.players.size, 1);
  } finally { await first.onDispose(); await second.onDispose(); first.clock.clear(); second.clock.clear(); await accounts.logout(login.token); }
});

test('closing a socket while its account claim finishes releases ownership before rejecting the join', async context => {
  const { login, auth } = await fixture(accounts);
  const room = new LobbyRoom();
  const client = { sessionId: 'closing-lease', auth, state: ClientState.JOINING, readyState: 1, leave() {}, send() {} };
  const claim = accounts.lobbyLeases.claim.bind(accounts.lobbyLeases);
  context.mock.method(accounts.lobbyLeases, 'claim', async (...args: Parameters<typeof claim>) => {
    const lease = await claim(...args); client.readyState = 2; return lease;
  });
  try {
    await assert.rejects(room.onJoin(client as any, {}, auth), { code: 401 });
    assert.equal(room.state.players.size, 0);
    const replacement = await claim(auth.account.id, auth.hash, 'other-room', 'other-client');
    assert(replacement, 'the rejected join must not leave its owner behind');
    await accounts.lobbyLeases.release([replacement]);
  } finally { await room.onDispose(); room.clock.clear(); await accounts.logout(login.token); }
});

test('a dropped connection retains its account through reconnection grace and a final leave frees it', async context => {
  const { login, auth } = await fixture(accounts);
  const room = new LobbyRoom();
  const client = { sessionId: 'grace-lease', auth, state: ClientState.JOINED, readyState: 1, leave() {}, send() {} };
  context.mock.method(room, 'allowReconnection', () => new Promise(() => {}) as any);
  try {
    await room.onJoin(client as any, {}, auth);
    room.onDrop(client as any);
    assert.equal(await accounts.lobbyLeases.claim(auth.account.id, auth.hash, 'other-room', 'other-client'), undefined);
    await room.onLeave(client as any);
    const returned = await accounts.lobbyLeases.claim(auth.account.id, auth.hash, 'other-room', 'returned-client');
    assert(returned); await accounts.lobbyLeases.release([returned]);
  } finally { await room.onDispose(); room.clock.clear(); await accounts.logout(login.token); }
});

test('an expired account owner cannot keep moving through server simulation without a new client message', async context => {
  const { login, auth } = await fixture(accounts);
  const room = new LobbyRoom();
  const closes: number[] = [];
  const client = { sessionId: 'expired-lease', auth, state: ClientState.JOINED, readyState: 1, leave(code: number) { closes.push(code); }, send() {} };
  context.mock.method(room, 'broadcast', () => {});
  try {
    await room.onJoin(client as any, {}, auth); room.clients.push(client as any);
    const player = room.state.players.get(client.sessionId)!;
    const before = { x: player.x, y: player.y };
    const control = (room as any).controls.get(client.sessionId);
    control.dx = 1; control.dy = 0; control.at = Date.now();
    (room as any).accountLeases.get(client.sessionId).deadline = performance.now() - 1;
    (room as any).tick(.05);
    assert.equal(player.x, before.x); assert.equal(player.y, before.y);
    assert.equal(player.connected, false); assert.equal(player.moving, false);
    assert.equal(room.state.players.has(client.sessionId), false, 'NPC simulation must also lose its reference to the fenced avatar');
    assert.equal((room as any).access.get(client.sessionId).active, false);
    assert.deepEqual(closes, [4001]);
  } finally { await room.onLeave(client as any); await room.onDispose(); room.clock.clear(); await accounts.logout(login.token); }
});

test('overlapping heartbeats do not start extra queries and a delayed renewal cannot resurrect a fenced owner', async context => {
  const { login, auth } = await fixture(accounts);
  const room = new LobbyRoom();
  const client = { sessionId: 'late-renewal', auth, state: ClientState.JOINED, readyState: 1, leave() {}, send() {} };
  let finish!: () => void;
  const delayed = new Promise<void>(resolve => { finish = resolve; });
  let renewals = 0;
  try {
    await room.onJoin(client as any, {}, auth);
    const lease = (room as any).accountLeases.get(client.sessionId);
    context.mock.method(accounts.lobbyLeases, 'renew', async () => {
      renewals++; await delayed;
      return new Map([[lease.token, { ...lease, deadline: performance.now() + ACCOUNT_LEASE_MS }]]);
    });
    const pending = (room as any).renewAccountLeases();
    await (room as any).renewAccountLeases();
    assert.equal(renewals, 1);
    lease.deadline = performance.now() - 1;
    (room as any).tick(.05);
    finish(); await pending;
    assert.equal((room as any).accountLeases.size, 0);
    assert.equal(room.state.players.size, 0);
    assert.equal((room as any).access.get(client.sessionId).active, false);
    const replacement = await accounts.lobbyLeases.claim(auth.account.id, auth.hash, 'new-room', 'new-client');
    assert(replacement); await accounts.lobbyLeases.release([replacement]);
  } finally { finish?.(); await room.onDispose(); room.clock.clear(); await accounts.logout(login.token); }
});
