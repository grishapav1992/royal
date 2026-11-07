import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { Activities } from '../server/activities';
import { PvpRoom } from '../server/pvp/room';

test('a late funded match starts the local table only when both participants are on its floor', async context => {
  const people = ['a', 'b'].map(id => ({
    sessionId: id, accountId: id, name: id, hall: 'tables', x: 1, y: 1,
    connected: true, available: true, playing: false, activity: '', ears: false, seat: '', action: 'idle',
    facing: 'down', moving: false,
  }));
  const activities = new Activities(id => people.find(player => player.sessionId === id), () => {}, () => {}, () => {});
  const match = { id: 'funded', gameId: 'hockey', status: 'playing', creatorId: 'a', opponentId: 'b', disconnected: [] };
  let resolveFirst!: () => void;
  let calls = 0;
  const room = new PvpRoom({ roomId: () => 'club', people: () => people, send: () => {}, activities }, async () => {
    if (++calls === 1) await new Promise<void>(resolve => { resolveFirst = resolve; });
    return { status: 200, value: { matches: [match], snapshots: [] } };
  });
  context.after(() => room.stop());

  room.tick();
  await setImmediate();
  people[0].connected = false;
  people[0].hall = 'street';
  resolveFirst();
  await setImmediate();
  assert.equal(activities.wagers.size, 0);
  assert.equal(people[0].playing, false);

  people[0].connected = true;
  people[0].hall = 'arcade';
  room.tick();
  await setImmediate();
  assert.equal(activities.wagers.size, 0);
  assert.equal(people[0].playing, false);

  people[0].hall = 'tables';
  room.tick();
  await setImmediate();
  assert.deepEqual(activities.wagers.get('hockey'), ['a', 'b']);
});
