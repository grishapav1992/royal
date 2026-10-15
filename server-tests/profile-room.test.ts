import { DEFAULT_APPEARANCE, serializeAppearance } from '../src/shared/appearance';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientState, LocalPresence } from '@colyseus/core';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts, AccountStore } from '../server/accounts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function drained(...stores: AccountStore[]) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    if (stores.every(store => store.events.health().pendingEvents === 0)) return;
  }
  throw new Error('Account event bridge did not drain');
}
async function login(remote: AccountStore) {
  const result = await accounts.login(`profile-room-${randomUUID()}@example.test`, 'profile-test-password');
  await accounts.select(result.account.id, 0, 'Первое имя');
  await drained(accounts, remote);
  return { ...result, auth: (await accounts.session(result.token))! };
}
function roomFixture(context: TestContext, auth: NonNullable<Awaited<ReturnType<AccountStore['session']>>>) {
  const room = new LobbyRoom();
  const leaves: number[] = [];
  const client: any = { sessionId: randomUUID(), state: ClientState.JOINING, readyState: 1, auth, send() {}, leave(code: number) { leaves.push(code); } };
  context.mock.method(room, 'onMessage', () => {});
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate();
  // Colyseus adds the authenticated client before invoking either room lifecycle callback.
  room.clients.push(client);
  return { room, client, leaves, close: async () => { await room.onDispose(); room.clock.clear(); } };
}
function delayedProfile(context: TestContext) {
  const read = deferred(), release = deferred();
  const original = accounts.currentAccount.bind(accounts);
  let first = true;
  context.mock.method(accounts, 'currentAccount', async (id: string) => {
    const held = first; first = false;
    const snapshot = await original(id);
    if (held) { read.resolve(); await release.promise; }
    return snapshot;
  });
  return { read, release };
}
function assertProfile(fixture: ReturnType<typeof roomFixture>, name: string, skin: number) {
  const player = fixture.room.state.players.get(fixture.client.sessionId)!;
  assert.ok(player);
  assert.equal(player.name, name); assert.equal(player.skin, skin);
  assert.equal(fixture.client.auth.account.name, name); assert.equal(fixture.client.auth.account.skin, skin);
  assert.deepEqual(fixture.leaves, []);
}

test('room profile refresh preserves account events across join and reconnect database delays', { timeout: 15000 }, async context => {
  await accounts.ready;
  const remote = new AccountStore(accounts.schema), presence = new LocalPresence();
  try {
    await remote.ready;
    await Promise.all([accounts.events.connect(presence), remote.events.connect(presence)]);
    await context.test('joining uses the current profile instead of the reservation auth snapshot', async context => {
      const session = await login(remote);
      await remote.select(session.account.id, 4, 'Имя после брони'); await drained(accounts, remote);
      assert.equal(session.auth.account.skin, 0);
      const fixture = roomFixture(context, session.auth);
      try {
        await fixture.room.onJoin(fixture.client, {}, session.auth);
        assertProfile(fixture, 'Имя после брони', 4);
      } finally { await fixture.close(); await accounts.logout(session.token); }
    });
    await context.test('a delayed join snapshot cannot overwrite newer remote name and skin events', async context => {
      const session = await login(remote), fixture = roomFixture(context, session.auth), held = delayedProfile(context);
      let joining: Promise<unknown> | undefined;
      try {
        joining = fixture.room.onJoin(fixture.client, {}, session.auth);
        await held.read.promise;
        await remote.select(session.account.id, 4, 'Имя во время входа'); await drained(accounts, remote);
        assert.equal(fixture.room.state.players.has(fixture.client.sessionId), false);
        assert.equal(fixture.client.auth.account.name, 'Имя во время входа');
        assert.equal(fixture.client.auth.account.skin, 4);
        held.release.resolve(); await joining;
        assertProfile(fixture, 'Имя во время входа', 4);
      } finally { held.release.resolve(); await joining?.catch(() => {}); await fixture.close(); await accounts.logout(session.token); }
    });
    await context.test('reconnect retains profile events while another access query is pending', async context => {
      const session = await login(remote), fixture = roomFixture(context, session.auth);
      const held = deferred(), profileRead = deferred();
      let reconnecting: Promise<unknown> | undefined;
      try {
        await fixture.room.onJoin(fixture.client, {}, session.auth);
        const active = accounts.active.bind(accounts), currentAccount = accounts.currentAccount.bind(accounts);
        context.mock.method(accounts, 'active', async (hash: string) => { const result = await active(hash); await held.promise; return result; });
        context.mock.method(accounts, 'currentAccount', async (id: string) => { const result = await currentAccount(id); profileRead.resolve(); return result; });
        const player = fixture.room.state.players.get(fixture.client.sessionId)!;
        player.connected = false; fixture.client.state = ClientState.RECONNECTING;
        reconnecting = fixture.room.onReconnect(fixture.client); await profileRead.promise;
        await remote.select(session.account.id, 4, 'Имя при возврате'); await drained(accounts, remote);
        assertProfile(fixture, 'Имя при возврате', 4); assert.equal(player.connected, false);
        held.resolve(); await reconnecting;
        assertProfile(fixture, 'Имя при возврате', 4); assert.equal(player.connected, true);
      } finally { held.resolve(); await reconnecting?.catch(() => {}); await fixture.close(); await accounts.logout(session.token); }
    });
    await context.test('a delayed join snapshot retains a custom appearance changed by another process', async context => {
      const session = await login(remote), fixture = roomFixture(context, session.auth), held = delayedProfile(context);
      let joining: Promise<unknown> | undefined;
      const appearance = { ...DEFAULT_APPEARANCE, body: 2, hat: 6, tattoo: 5 };
      try {
        joining = fixture.room.onJoin(fixture.client, {}, session.auth); await held.read.promise;
        await remote.select(session.account.id, undefined, 'Кастомный игрок', appearance); await drained(accounts, remote);
        held.release.resolve(); await joining;
        assertProfile(fixture, 'Кастомный игрок', 0);
        assert.equal(fixture.room.state.players.get(fixture.client.sessionId)!.appearance, serializeAppearance(appearance));
        assert.deepEqual(fixture.client.auth.account.appearance, appearance);
      } finally { held.release.resolve(); await joining?.catch(() => {}); await fixture.close(); await accounts.logout(session.token); }
    });
    for (const changedField of ['name', 'skin'] as const) {
      await context.test(`a ${changedField} event preserves itself without discarding the other current profile field`, async context => {
        const session = await login(remote);
        await remote.select(session.account.id, 3, 'Имя без события'); await drained(accounts, remote);
        const fixture = roomFixture(context, session.auth), held = delayedProfile(context);
        let joining: Promise<unknown> | undefined;
        try {
          joining = fixture.room.onJoin(fixture.client, {}, session.auth); await held.read.promise;
          if (changedField === 'name') await remote.rename(session.account.id, 'Новое имя');
          else await remote.select(session.account.id, 4);
          await drained(accounts, remote);
          held.release.resolve(); await joining;
          assertProfile(fixture, changedField === 'name' ? 'Новое имя' : 'Имя без события', changedField === 'name' ? 3 : 4);
        } finally { held.release.resolve(); await joining?.catch(() => {}); await fixture.close(); await accounts.logout(session.token); }
      });
    }
  } finally { await Promise.all([remote.close(), accounts.close()]); }
});
