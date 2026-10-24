import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ClientState } from '@colyseus/core';
import { accounts, AccountStore } from '../server/accounts';
import { PostgresDatabase } from '../server/database';
import { LobbyRoom } from '../server/LobbyRoom';
import { SKIN_THEME } from '../src/shared/skinStudio';

test('a selected generated skin persists and reaches active players through account events', async context => {
  await accounts.ready;
  const remote = new AccountStore(accounts.schema), db = new PostgresDatabase(accounts.schema);
  await remote.ready;
  const login = await accounts.login('skin-profile-' + randomUUID() + '@example.test', 'skin-profile-password');
  await accounts.select(login.account.id, 0);
  const auth = (await accounts.session(login.token))!;
  const room = new LobbyRoom(), client: any = { sessionId: randomUUID(), state: ClientState.JOINING, readyState: 1, auth, send() {}, leave() {} };
  context.mock.method(room, 'onMessage', () => {}); context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {}); context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); room.clients.push(client);
  try {
    await room.onJoin(client, {}, auth);
    const job = randomUUID(), skin = randomUUID();
    await db.prepare("INSERT INTO skin_jobs(id,account_id,theme,prompt,state,created_at) VALUES (?,?,?,?,'ready',?)")
      .run(job, login.account.id, SKIN_THEME.id, 'Космический пират', Date.now());
    await db.prepare('INSERT INTO generated_skins(id,job_id,variant,image) VALUES (?,?,0,?)').run(skin, job, Buffer.from('test-artwork'));
    const event = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Generated appearance event was not delivered')), 3000);
      accounts.events.once('appearance', (id, value) => { clearTimeout(timeout); assert.equal(id, login.account.id); assert.equal(value.skinId, skin); resolve(); });
    });
    await accounts.skinStudio.choose(login.account.id, job, skin); await event;
    const expected = { version: 2, skinId: skin, theme: SKIN_THEME.id };
    assert.deepEqual((await remote.session(login.token))?.account.appearance, expected);
    assert.deepEqual(JSON.parse(room.state.players.get(client.sessionId)!.appearance), expected);
    assert.deepEqual(client.auth.account.appearance, expected);
    await assert.rejects(() => accounts.select(login.account.id, 0, undefined, expected));
    await accounts.select(login.account.id, 4);
    assert.equal((await accounts.skinStudio.snapshot(login.account.id)).wardrobe.length, 1);
    await accounts.skinStudio.equip(login.account.id, skin);
    assert.deepEqual((await accounts.session(login.token))?.account.appearance, expected);
  } finally {
    await room.onDispose(); room.clock.clear();
    await Promise.all([db.close(), remote.close(), accounts.close()]);
  }
});
