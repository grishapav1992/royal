import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { Client } from '@colyseus/core';
import { accounts } from '../server/accounts';
import type { Guards } from '../server/guards';
import { LobbyRoom } from '../server/LobbyRoom';
import { ROOF_STAIR_ROUTE, STREET_ROOF_STAIRS } from '../src/shared/rooftop';
import type { ClubSanction } from '../src/shared/security';
import { STAIR_WINDOW } from '../src/shared/stairWindow';
import { STREET } from '../src/shared/street';
import { hallLinks, type HallId } from '../src/shared/world';

type Handler = (client: Client, value?: unknown) => void | Promise<void>;
type RoomInternals = { access: Map<string, { sanction?: ClubSanction | null }>; guards: Guards };

async function markedVisitor(context: TestContext, oldBan = false) {
  const room = new LobbyRoom();
  const handlers = new Map<string, Handler>();
  context.mock.method(room, 'onMessage', (type: string, handler: Handler) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  const reserve = context.mock.method(room, 'allowReconnection', async () => {});
  room.onCreate();

  const login = await accounts.login(`club-entry-${randomUUID()}@example.test`, 'Club-entry-test-password!');
  context.after(async () => {
    room.onDispose();
    room.clock.clear();
    await accounts.logout(login.token);
  });
  await accounts.select(login.account.id, 0);
  const { outcome: { sanction } } = await accounts.clubSanctions.recordViolation(login.account.id, {
    id: randomUUID(), reason: 'spam',
  });
  if (oldBan) {
    await accounts.moderation.eject(login.account.id);
    assert(await accounts.moderation.banUntil(login.account.id) > Date.now());
  }

  const closes: (number | undefined)[] = [];
  const client = {
    sessionId: randomUUID(),
    send() {},
    leave(code?: number) { closes.push(code); },
  } as unknown as Client;
  const headers = new Headers({ Cookie: 'royal_session=' + login.token });
  const auth = await room.onAuth(client, {}, { headers, ip: '127.0.0.1' });
  assert.equal(auth.account.id, login.account.id);
  client.auth = auth;
  room.clients.push(client);
  await room.onJoin(client, {}, auth);

  const player = room.state.players.get(client.sessionId)!;
  const internals = room as unknown as RoomInternals;
  const guard = room.state.guards.get('security')!;
  let sequence = 0;
  const send = (type: string, value: unknown) => handlers.get(type)!(client, value);
  const input = (x = 0, y = 0, ms = 0) => send('inputs', {
    revision: player.hallRevision, inputs: [{ seq: ++sequence, x, y, ms }],
  });
  const position = () => ({ hall: player.hall, x: player.x, y: player.y, revision: player.hallRevision });
  const checkMark = async () => {
    assert.deepEqual(internals.access.get(client.sessionId)?.sanction, sanction);
    assert.deepEqual(await accounts.clubSanctions.active(login.account.id), sanction);
  };
  const cross = async (target: HallId) => {
    const link = hallLinks(player.hall as HallId).find(candidate => candidate.target === target);
    assert(link, `no route from ${player.hall} to ${target}`);
    const revision = player.hallRevision;
    Object.assign(player, link.door.entry);
    await input();
    assert.deepEqual(position(), { hall: target, ...link.arrival.arrival, revision: revision + 1 });
    assert.equal(player.security, '');
  };
  const reconnect = async () => {
    const before = position();
    const calls = reserve.mock.callCount();
    room.onDrop(client, 1006);
    assert.equal(player.connected, false);
    assert.equal(reserve.mock.callCount(), calls + 1, 'the marked visitor can reserve a reconnect');
    await room.onReconnect(client);
    assert.equal(player.connected, true);
    assert.deepEqual(position(), before);
    assert.deepEqual(closes, []);
    await checkMark();
  };
  return { player, guard, guards: internals.guards, client, input, send, cross, reconnect, position, checkMark };
}

test('a marked account can authenticate, spawn outside, use the main entrance and reconnect inside', async context => {
  const visitor = await markedVisitor(context, true);
  assert.deepEqual(visitor.position(), { hall: 'street', ...STREET.spawn, revision: 0 });
  assert.equal(visitor.player.connected, true);
  await visitor.checkMark();
  await visitor.cross('arcade');
  const entryY = visitor.player.y;
  await visitor.input(0, 1, 50);
  assert(visitor.player.y > entryY, 'the visitor can move normally after passing the entrance');
  await visitor.reconnect();
});

test('a marked account can use the roof and restroom doors, reconnect in shelter and escape a pursuit there', async context => {
  const visitor = await markedVisitor(context);
  Object.assign(visitor.player, STREET_ROOF_STAIRS.entry);
  await visitor.input();
  assert.equal(visitor.player.hall, 'street', 'ground position alone cannot use the stair exit');
  visitor.player.stairStep = ROOF_STAIR_ROUTE.length - 1;
  await visitor.cross('roof');
  assert.equal(visitor.player.stairStep, 0);
  await visitor.cross('toilet');
  await visitor.reconnect();
  await visitor.cross('github');
  await visitor.checkMark();

  const capture = context.mock.method(accounts.clubSanctions, 'recordCapture');
  Object.assign(visitor.guard, { hall: 'github', x: 2940, y: 410, facing: 'up', phase: 'idle' });
  visitor.guards.tick(.05);
  assert.equal(visitor.guard.target, visitor.client.sessionId, 'a visible marked visitor is pursued on the playable floor');
  await visitor.cross('toilet');
  visitor.guards.tick(.05);
  assert.equal(visitor.guard.target, '');

  Object.assign(visitor.guard, { hall: 'toilet', x: 400, y: 500, facing: 'up', phase: 'idle' });
  visitor.guards.tick(.05);
  assert.equal(visitor.guard.target, '');
  assert.equal(capture.mock.callCount(), 0);
  assert.equal(visitor.player.security, '');
  await visitor.checkMark();
});

test('a marked account enters the card salon only from the real window platform and current revision', async context => {
  const visitor = await markedVisitor(context);
  Object.assign(visitor.player, STAIR_WINDOW.outside);
  const revision = visitor.player.hallRevision;
  await visitor.send('stair-window', { revision });
  assert.equal(visitor.player.hall, 'street', 'ground coordinates do not confer window access');
  visitor.player.stairStep = STAIR_WINDOW.landingIndex;
  await visitor.send('stair-window', { revision: revision - 1 });
  assert.equal(visitor.player.hall, 'street', 'a stale command cannot travel');
  await visitor.send('stair-window', { revision });
  assert.deepEqual(visitor.position(), { hall: 'github', ...STAIR_WINDOW.arrival, revision: revision + 1 });
  assert.equal(visitor.player.stairStep, 0);
  assert.equal(visitor.player.security, '');
  await visitor.checkMark();
});
