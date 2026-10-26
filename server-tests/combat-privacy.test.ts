import test from 'node:test';
import assert from 'node:assert/strict';
import { defineServer, defineRoom, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { CombatGame } from '../server/combatGame';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { combatView, type CombatView } from '../src/shared/combatView';
import { neutralCombatInput } from '../src/shared/combat';
import { ACTIVITIES, type ActivitiesMessage } from '../src/shared/activities';

function assertPublic(state: CombatView, viewer: number, sequences: number[]) {
  state.fighters.forEach((fighter, index) => {
    assert.deepEqual(Object.keys(fighter).sort(), ['action', 'health', 'inputSequence', 'x', 'y']);
    assert.equal(fighter.inputSequence, index === viewer ? sequences[index] : 0);
  });
}

test('public combat views isolate control acknowledgements and exclude internal or future fighter fields', () => {
  const game = new CombatGame('privacy'); game.state.players = ['a', 'b']; game.start();
  game.state.fighters.forEach((fighter, index) => Object.assign(fighter, {
    input: {...neutralCombatInput(), kick: true}, inputSequence: 7 + index, cooldown: .65,
    inputAt: 1000, stun: .18, futurePrivateField: 'private',
  }));
  assertPublic(combatView(game.state, 'a'), 0, [7, 8]);
  assertPublic(combatView(game.state, 'b'), 1, [7, 8]);
  assertPublic(combatView(game.state), -1, [7, 8]);
  const detached = combatView(game.state, 'a'); detached.players[0] = 'changed'; detached.fighters[0].health = 1;
  assert.equal(game.state.players[0], 'a'); assert.equal(game.state.fighters[0].health, 100);
});

test('real modern and legacy clients receive private-safe full snapshots and live updates with their own acknowledgement', {timeout: 20000}, async () => {
  const transport = new WebSocketTransport({maxPayload: 8192, pingInterval: 0});
  const server = defineServer({transport, rooms: {lobby: defineRoom(LobbyRoom)}, greet: false, gracefullyShutdown: false});
  const clients: Room[] = [], messages: ActivitiesMessage[][] = [[], [], []];
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!check()) { assert(Date.now() < deadline, 'combat update did not arrive'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  try {
    await accounts.ready; await server.listen(0, '127.0.0.1');
    const address = transport.server!.address(); assert(address && typeof address !== 'string');
    const endpoint = 'http://127.0.0.1:' + address.port;
    for (let index = 0; index < 3; index++) {
      const auth = await accounts.login('combat-privacy-' + crypto.randomUUID() + '@example.test', 'Local-privacy-123!');
      await accounts.select(auth.account.id, index % 2);
      await accounts.wallet.operate(auth.account.id, {id: crypto.randomUUID(), kind: 'deposit', amount: 200});
      const client = new Client(endpoint, {headers: {Cookie: 'royal_session=' + auth.token}});
      const options = index === 2 ? {} : {activityProtocol: 1};
      const room = index ? await client.joinById(clients[0].roomId, options) : await client.create('lobby', options);
      room.reconnection.enabled = false; room.onMessage('*', () => {});
      room.onMessage('activities', value => messages[index].push(value)); clients.push(room);
    }
    const authoritative = matchMaker.getLocalRoomById(clients[0].roomId) as LobbyRoom;
    const activities = (authoritative as any).activities;
    // The fixture alone positions its own accounts; wire commands still use the real lobby handlers.
    for (const client of clients) Object.assign(authoritative.state.players.get(client.sessionId)!, {hall: 'tables', ...ACTIVITIES['mortal-kombat'].entry});
    for (const client of clients.slice(0, 2)) client.send('activity', {type: 'join', id: 'mortal-kombat'});
    await until(() => activities.combat.state.players.length === 2);
    const match = activities.combat.state.id;
    for (const client of clients.slice(0, 2)) client.send('activity', {type: 'combat-ready', match, stake: 1});
    await until(() => activities.combat.state.phase === 'countdown');
    for (const [index, client] of clients.slice(0, 2).entries()) client.send('activity', {
      type: 'combat-input', match, seq: 7 + index, input: {...neutralCombatInput(), kick: true},
    });
    await until(() => activities.combat.state.fighters[1].inputSequence === 8);
    for (const rows of messages) rows.length = 0;
    for (const client of clients) client.send('activities');
    await until(() => messages.every(rows => rows.some(value => !('patch' in value) && value.combat)));
    await until(() => messages.slice(0, 2).every(rows => rows.some(value => 'patch' in value && value.combat)));
    messages.forEach((rows, index) => {
      for (const value of rows) if (value.combat) assertPublic(value.combat, index === 2 ? -1 : index, [7, 8]);
    });
    assert(messages[2].every(value => !('patch' in value)), 'an already open legacy page keeps full snapshots');
    clients[0].send('activity', {type: 'combat-input', match, seq: 8, input: neutralCombatInput()});
    await until(() => activities.combat.state.fighters[0].inputSequence === 8);
    assert.equal(activities.combat.state.fighters[1].input.kick, true, 'serialization does not alter the server simulation');
  } finally {
    await Promise.allSettled(clients.filter(client => client.connection.isOpen).map(client => client.leave()));
    await server.gracefullyShutdown(false); await accounts.close();
  }
});
