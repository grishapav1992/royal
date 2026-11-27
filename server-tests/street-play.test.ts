import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STREET, STREET_OBSTACLES } from '../src/shared/street';
import { SEATS, DRINKS, ALL_DRINKS, hallObstacles } from '../src/shared/world';
import { findPath, walkable } from '../src/game/navigation';
import { StreetLife } from '../src/game/StreetLife';
import {
  STREET_KIOSK, KIOSK_DRINK_IDS, SNOW_DRIFTS, MAX_SNOWBALLS, SNOW_RANGE, SNOW_ROLL_MAX, SNOWMAN_LIMIT, SNOWMAN_COMPLETE_MS,
  atStreetKiosk, nearSnowDrift, placeSnowball, snowballLanding, snowRollRadius, streetEvening,
} from '../src/shared/streetPlay';
import { StreetSnow, type SnowballEvent } from '../server/streetSnow';
import { LobbyState, Player } from '../server/state';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';

const benchSeats = SEATS.filter(seat => seat.hall === 'street');

test('kiosk, bench seats and snow drifts are reachable from the street entrance', () => {
  const obstacles = hallObstacles('street');
  assert.equal(benchSeats.length, 6);
  for (const target of [STREET_KIOSK.approach, ...benchSeats.map(s => s.entry), ...SNOW_DRIFTS]) {
    assert(walkable(target.x, target.y, obstacles, 12), JSON.stringify(target));
    assert(findPath(STREET.spawn, target, obstacles).length, JSON.stringify(target));
  }
  assert(atStreetKiosk({ hall: 'street', ...STREET_KIOSK.approach }));
  assert(!atStreetKiosk({ hall: 'arcade', ...STREET_KIOSK.approach }));
  assert(!walkable(STREET_KIOSK.x, STREET_KIOSK.y - 30, obstacles));
  for (const seat of benchSeats) assert(Math.hypot(seat.x - seat.entry.x, seat.y - seat.entry.y) <= 60);
});

test('decorative pedestrians never walk through the kiosk', () => {
  const life = new StreetLife(), o = STREET_KIOSK.obstacle;
  for (let i = 0; i < 4000; i++) {
    for (const p of life.advance(100).pedestrians) assert(!(p.x > o.x - 8 && p.x < o.x + o.w + 8 && p.y > o.y - 8 && p.y < o.y + o.h + 8), JSON.stringify(p));
  }
});

test('kiosk drinks stay off Mira\'s bar menu and persist as known drinks', () => {
  for (const id of KIOSK_DRINK_IDS) assert(ALL_DRINKS.some(d => d.id === id), id);
  assert(!DRINKS.some(d => d.id === 'cocoa' || d.id === 'mulled-wine'));
  assert.equal(ALL_DRINKS.find(d => d.id === 'cocoa')!.strength, 0);
  assert(ALL_DRINKS.find(d => d.id === 'mulled-wine')!.strength > 0);
});

test('throws keep their direction, stop at the range and snow balls grow to a limit', () => {
  const from = { x: 1000, y: 1000 };
  const far = snowballLanding(from, { x: 2000, y: 1000 });
  assert.deepEqual(far, { x: 1000 + SNOW_RANGE, y: 1000 });
  assert.deepEqual(snowballLanding(from, { x: 1100, y: 1050 }), { x: 1100, y: 1050 });
  assert.equal(snowRollRadius(0), 10);
  assert(snowRollRadius(400) > 20 && snowRollRadius(400) < SNOW_ROLL_MAX);
  assert.equal(snowRollRadius(100000), SNOW_ROLL_MAX);
});

test('snowman placement stacks smaller balls, refuses blocking spots and keeps the limit', () => {
  const spot = { x: 1545, y: 1112 };
  assert.equal(placeSnowball(spot, 30, [], STREET_OBSTACLES).kind, 'new');
  assert.equal(placeSnowball(spot, 14, [], STREET_OBSTACLES).kind, 'refused');
  assert.equal(placeSnowball({ x: 840, y: 1000 }, 30, [], STREET_OBSTACLES).kind, 'refused', 'the entrance stays clear');
  assert.equal(placeSnowball({ x: 1180, y: 1120 }, 30, [], STREET_OBSTACLES).kind, 'refused', 'not on a bench');
  assert.equal(placeSnowball({ x: 1500, y: 700 }, 30, [], STREET_OBSTACLES).kind, 'refused', 'only on the front snow');
  const base = { id: 'a', ...spot, parts: [30], builder: 'A', complete: false, meltAt: 0 };
  assert.deepEqual(placeSnowball({ x: spot.x + 10, y: spot.y }, 22, [base], STREET_OBSTACLES), { kind: 'stack', id: 'a' });
  assert.equal(placeSnowball({ x: spot.x + 10, y: spot.y }, 29, [base], STREET_OBSTACLES).kind, 'refused');
  assert.equal(placeSnowball({ x: spot.x, y: spot.y }, 12, [{ ...base, parts: [30, 22, 16], complete: true }], STREET_OBSTACLES).kind, 'refused');
  const many = Array.from({ length: SNOWMAN_LIMIT }, (_, i) => ({ ...base, id: 'm' + i, x: 400 + i * 120, y: 1150 }));
  assert.equal(placeSnowball({ x: 2000, y: 1010 }, 30, many, STREET_OBSTACLES).kind, 'refused');
});

function snowRoom() {
  const state = new LobbyState(), events: SnowballEvent[] = [], snow = new StreetSnow(state, e => events.push(e));
  const add = (id: string, x: number, y: number) => { const p = new Player(); Object.assign(p, { hall: 'street', x, y, name: id }); state.players.set(id, p); return p; };
  return { state, events, snow, add };
}

test('snowballs come from a drift, at most three, and hit only players who both opted in', () => {
  const { events, snow, add } = snowRoom(), drift = SNOW_DRIFTS[1];
  const a = add('a', drift.x, drift.y - 10), b = add('b', drift.x + 200, drift.y - 20), c = add('c', drift.x - 200, drift.y - 20);
  assert.match(String(snow.pick('c', c, 0)), /сугробу/);
  for (let i = 0; i < 5; i++) snow.pick('a', a, i * 1000);
  assert.equal(a.snowballs, MAX_SNOWBALLS);
  snow.throw('a', a, { x: b.x, y: b.y - 36 }, 10000);
  assert.equal(events.length, 1); assert.deepEqual(events[0].hits, [], 'no hit without opt-in');
  snow.fight(a, true); snow.fight(b, true);
  snow.throw('a', a, { x: b.x, y: b.y - 36 }, 10100);
  assert.equal(events.length, 1, 'throw cooldown');
  snow.throw('a', a, { x: b.x, y: b.y - 36 }, 11000);
  assert.deepEqual(events[1].hits, ['b']); assert(b.snowHitUntil > 11000);
  snow.throw('a', a, { x: c.x, y: c.y - 36 }, 12000);
  assert.deepEqual(events[2].hits, [], 'a player who did not opt in is never hit');
  assert.equal(a.snowballs, 0);
  snow.throw('a', a, { x: b.x, y: b.y }, 13000); assert.equal(events.length, 3, 'empty hands');
  a.snowballs = 2; a.hall = 'arcade'; snow.tick(14000); assert.equal(a.snowballs, 0, 'snow melts indoors');
  a.hall = 'street'; a.seat = 'street-bench-0-0'; snow.pick('a', a, 20000); assert.equal(a.snowballs, 0, 'not while seated');
});

test('a rolled ball grows over snow, becomes a base, stacks to a finished snowman and melts', () => {
  const { state, snow, add } = snowRoom();
  const p = add('p', 1400, 1150); p.facing = 'right';
  assert.equal(snow.roll('p', p), undefined); assert.equal(p.snowRoll, 10);
  for (let x = 1400; x <= 1900; x += 20) { p.x = x; snow.tick(0); }
  assert(p.snowRoll >= 20, String(p.snowRoll));
  p.x = 1500; p.y = 1112;
  assert.equal(snow.drop('p', p, 1000), undefined); assert.equal(state.snowmen.size, 1); assert.equal(p.snowRoll, 0);
  const id = [...state.snowmen.keys()][0], snowman = state.snowmen.get(id)!;
  const stack = (radius: number, now: number) => { snow.roll('p', p); p.snowRoll = radius; p.x = snowman.x - 34; p.y = snowman.y; return snow.drop('p', p, now); };
  assert.equal(stack(snowman.parts.split(',').map(Number)[0] - 6, 2000), undefined);
  assert.equal(snowman.complete, false);
  assert.equal(stack(12, 3000), undefined);
  assert.equal(snowman.complete, true); assert.equal(snowman.parts.split(',').length, 3); assert.equal(snowman.meltAt, 3000 + SNOWMAN_COMPLETE_MS);
  assert.match(String(stack(10, 4000)), /готов/);
  snow.tick(3000 + SNOWMAN_COMPLETE_MS); assert.equal(state.snowmen.size, 0);
  snow.roll('p', p); p.seat = 'street-bench-0-0'; snow.tick(5000); assert.equal(p.snowRoll, 0, 'sitting down crumbles the ball');
});

test('evening follows Moscow time with a half-hour transition', () => {
  const at = (h: number, m: number) => Date.UTC(2026, 10, 27, h - 3, m);
  assert.equal(streetEvening(at(12, 0)), 0);
  assert.equal(streetEvening(at(16, 45)), .5);
  assert.equal(streetEvening(at(22, 0)), 1);
  assert.equal(streetEvening(at(3, 0)), 1);
  assert.equal(streetEvening(at(8, 15)), .5);
});

test('the room seats players on street benches and serves kiosk drinks only at the kiosk', async context => {
  const session = await accounts.login(`street-play-${crypto.randomUUID()}@example.test`, 'Street-play-password-42!'); await accounts.select(session.account.id, 0);
  const notices: unknown[] = [];
  const client: any = { sessionId: 'street-play-test', auth: await accounts.session(session.token), send(type: string, value: unknown) { if (type === 'notice') notices.push(value); }, leave() {} };
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, data: unknown) => unknown>();
  context.mock.method(room, 'onMessage', (name: string, callback: any) => { handlers.set(name, callback); });
  context.mock.method(room, 'setPatchRate', () => {}); context.mock.method(room, 'setSimulationInterval', () => {}); context.mock.method(room, 'broadcast', () => {}); context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  room.onCreate(); await room.onJoin(client, {}, client.auth);
  try {
    const p = room.state.players.get(client.sessionId)!, seat = benchSeats[1];
    Object.assign(p, { hall: 'street', ...seat.entry });
    handlers.get('sit')!(client, seat.id);
    assert.equal(p.seat, seat.id); assert.equal(p.action, 'sit'); assert.deepEqual({ x: p.x, y: p.y }, { x: seat.x, y: seat.y });
    handlers.get('stand')!(client, undefined);
    assert.equal(p.seat, ''); assert.deepEqual({ x: p.x, y: p.y }, seat.entry);
    await handlers.get('drink')!(client, 'cocoa');
    assert.equal(p.action, 'idle', 'no drinks away from the kiosk');
    Object.assign(p, STREET_KIOSK.approach);
    await handlers.get('drink')!(client, 'beer');
    assert.equal(p.action, 'idle', 'bar drinks are not sold at the kiosk');
    await handlers.get('drink')!(client, 'mulled-wine');
    assert.equal(p.action, 'drink'); assert.equal(p.drink, 'mulled-wine'); assert(p.soberAt > Date.now());
    p.action = 'idle'; p.drink = '';
    Object.assign(p, { x: SNOW_DRIFTS[2].x, y: SNOW_DRIFTS[2].y - 8 });
    handlers.get('snow-pick')!(client, undefined);
    assert.equal(p.snowballs, 1);
    assert(nearSnowDrift(p));
  } finally { room.onDispose(); room.clock.clear(); await accounts.logout(session.token); }
});

import { ROOF } from '../src/shared/rooftop';
import { ROOF_SNOW_DRIFTS, ROOF_FIREWORKS, nearFireworks, fireworkBurst, type FireworkEvent } from '../src/shared/streetPlay';

test('roof benches, drifts and the fireworks crate are reachable without closing the roof loop', () => {
  const obstacles = hallObstacles('roof'), roofSeats = SEATS.filter(seat => seat.hall === 'roof');
  assert.equal(roofSeats.length, 6);
  for (const target of [ROOF_FIREWORKS.approach, ...roofSeats.map(s => s.entry), ...ROOF_SNOW_DRIFTS]) {
    assert(walkable(target.x, target.y, obstacles, 12), JSON.stringify(target));
    assert(findPath(ROOF.spawn, target, obstacles).length, JSON.stringify(target));
  }
  const loop = [...ROOF.loop, ROOF.loop[0]];
  for (let i = 1; i < loop.length; i++) assert(findPath(loop[i - 1], loop[i], obstacles).length, 'roof loop ' + i);
  assert(nearFireworks({ hall: 'roof', ...ROOF_FIREWORKS.approach }));
  assert(!nearFireworks({ hall: 'street', ...ROOF_FIREWORKS.approach }));
  for (let id = 1; id < 50; id++) { const b = fireworkBurst(id); assert(b.y < 300 && b.x > 300 && b.x < 1950, JSON.stringify(b)); }
});

test('roof snowballs stay on the roof, rolling stays on the street and rockets keep a pause', () => {
  const state = new LobbyState(), events: SnowballEvent[] = [], rockets: FireworkEvent[] = [];
  const snow = new StreetSnow(state, e => events.push(e), e => rockets.push(e));
  const add = (id: string, hall: string, x: number, y: number) => { const p = new Player(); Object.assign(p, { hall, x, y, name: id, snowFight: true }); state.players.set(id, p); return p; };
  const drift = ROOF_SNOW_DRIFTS[1];
  const a = add('a', 'roof', drift.x, drift.y - 10), b = add('b', 'roof', drift.x + 150, drift.y - 20), c = add('c', 'street', drift.x + 150, drift.y - 20);
  snow.pick('a', a, 0); assert.equal(a.snowballs, 1);
  snow.throw('a', a, { x: b.x, y: b.y - 36 }, 1000);
  assert.equal(events[0].hall, 'roof'); assert.deepEqual(events[0].hits, ['b']); assert.equal(c.snowHitUntil, 0);
  snow.tick(2000); assert.equal(a.snowballs, 0);
  assert.match(String(snow.roll('a', a)), /снегу перед казино/); assert.equal(a.snowRoll, 0);
  assert.match(String(snow.firework('a', a, 3000)), /ящику/);
  Object.assign(a, ROOF_FIREWORKS.approach);
  const first = snow.firework('a', a, 3000);
  assert(first && typeof first === 'object'); assert.equal(rockets.length, 1);
  assert.match(String(snow.firework('a', a, 3000 + ROOF_FIREWORKS.cooldownMs - 1)), /несколько секунд/);
  assert(typeof snow.firework('a', a, 3000 + ROOF_FIREWORKS.cooldownMs) === 'object'); assert.equal(rockets.length, 2);
  c.hall = 'street'; Object.assign(c, ROOF_FIREWORKS.approach); assert.equal(snow.firework('c', c, 1e9), undefined, 'only from the roof');
});
