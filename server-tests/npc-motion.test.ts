import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NpcMotion } from '../src/network/NpcMotion';

type Guest = { x: number; y: number; hall: string; moving: boolean; seat: string; mood: string };
const guest = (x: number, moving = true, extra: Partial<Guest> = {}): Guest => ({ x, y: 200, hall: 'arcade', moving, seat: '', mood: moving ? 'walking' : 'resting', ...extra });
const close = (actual: number, expected: number) => assert(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);

test('10 Hz guest positions render at constant speed despite duplicate 20 Hz room patches', () => {
  const motion = new NpcMotion<Guest>({ isMoving: view => view.moving });
  let nextPacket = 0;
  for (let frame = 0; frame <= 120; frame++) {
    const now = frame * 1000 / 60;
    while (nextPacket <= now + 1e-7) {
      motion.push(guest(Math.floor(nextPacket / 100) * 6.5), nextPacket);
      nextPacket += 50;
    }
    const rendered = motion.sample(now)!;
    if (now >= 150) close(rendered.x, (now - 150) * .065);
  }
});

test('buffer absorbs packet jitter without pauses or jumps between received samples', () => {
  const motion = new NpcMotion<Guest>();
  const arrivals = [0, 120, 190, 315, 395, 510, 590, 710, 795, 910, 1000];
  let next = 0, previous = 0;
  for (let now = 0; now <= 1000; now += 10) {
    while (next < arrivals.length && arrivals[next] <= now) {
      motion.push(guest(next * 6.5), arrivals[next]);
      next++;
    }
    const current = motion.sample(now)!.x;
    if (now > 200) {
      assert(current - previous > .4, `unexpected pause at ${now}`);
      assert(current - previous < 1, `unexpected jump at ${now}`);
    }
    previous = current;
  }
});

test('a long stationary hold stays still until departure and keeps motion metadata aligned', () => {
  const motion = new NpcMotion<Guest>({ isMoving: view => view.moving });
  for (let at = 0; at <= 2000; at += 50) motion.push(guest(0, false, { seat: 'lounge' }), at);
  motion.push(guest(6.5), 2100);
  const resting = motion.sample(2100)!;
  close(resting.x, 0); assert.equal(resting.seat, 'lounge'); assert.equal(resting.moving, false);
  const walking = motion.sample(2200)!;
  close(walking.x, 3.25); assert.equal(walking.seat, ''); assert.equal(walking.moving, true); assert.equal(walking.mood, 'walking');
});

test('arrival does not switch to seated or drinking metadata before reaching the destination', () => {
  const motion = new NpcMotion<Guest>({ isMoving: view => view.moving });
  motion.push(guest(0), 0);
  motion.push(guest(6.5, false, { seat: 'bar', mood: 'drinking' }), 100);
  const walking = motion.sample(200)!;
  close(walking.x, 3.25); assert.equal(walking.moving, true); assert.equal(walking.seat, '');
  const arrived = motion.sample(250)!;
  close(arrived.x, 6.5); assert.equal(arrived.moving, false); assert.equal(arrived.seat, 'bar'); assert.equal(arrived.mood, 'drinking');
});

test('missing packets hold the last authoritative position without unbounded extrapolation', () => {
  const motion = new NpcMotion<Guest>();
  motion.push(guest(0), 0); motion.push(guest(6.5), 100);
  close(motion.sample(500)!.x, 6.5);
  close(motion.sample(10000)!.x, 6.5);
  motion.push(guest(13), 10000);
  close(motion.sample(10000)!.x, 6.5);
  close(motion.sample(10150)!.x, 13);
});

test('hall changes and teleports reset immediately without crossing the room', () => {
  const motion = new NpcMotion<Guest>();
  motion.push(guest(0), 0); motion.push(guest(6.5), 100);
  motion.push(guest(30, false, { hall: 'tables' }), 150);
  assert.deepEqual(motion.sample(150), guest(30, false, { hall: 'tables' }));
  motion.push(guest(700, false, { hall: 'tables' }), 200);
  close(motion.sample(200)!.x, 700);
});

test('snapshots and sampled views cannot mutate stored history; stale packets are ignored', () => {
  let now = 0;
  const motion = new NpcMotion<Guest>({ now: () => now });
  const first = guest(0); motion.push(first); first.x = 999;
  now = 100; motion.push(guest(6.5)); motion.push(guest(900), 50);
  now = 200; const rendered = motion.sample()!; close(rendered.x, 3.25); rendered.x = 999;
  close(motion.sample()!.x, 3.25);
  motion.reset(); assert.equal(motion.sample(), undefined);
});
