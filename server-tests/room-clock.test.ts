import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoomClock } from '../src/network/RoomClock';

const epoch = 1_700_000_000_000;
function fixture(skew = 0) {
  let wall = epoch + skew, monotonic = 0;
  return {
    clock: new RoomClock(() => wall, () => monotonic),
    advance(ms: number) { wall += ms; monotonic += ms; },
    jumpWall(ms: number) { wall += ms; },
  };
}
const deadline = (clock: RoomClock, sample: number, soberAt: number) => {
  const { serverNow, localNow } = clock.snapshot(sample);
  return soberAt > serverNow ? localNow + soberAt - serverNow : 0;
};

test('movement patches with an unchanged clock do not prolong sobriety, including after an idle gap', () => {
  const { clock, advance } = fixture();
  assert.equal(deadline(clock, epoch, epoch + 5000), epoch + 5000);
  for (let patch = 0; patch < 9; patch++) {
    advance(50);
    assert.equal(deadline(clock, epoch, epoch + 5000), epoch + 5000);
  }
  advance(5000);
  assert.equal(deadline(clock, epoch, epoch + 5000), 0);
});

test('initial server/client clock skew is translated into a local absolute deadline', () => {
  for (const skew of [-7200000, 7200000]) {
    const { clock, advance } = fixture(skew);
    assert.equal(deadline(clock, epoch, epoch + 5000), epoch + skew + 5000);
    advance(250);
    assert.equal(deadline(clock, epoch, epoch + 5000), epoch + skew + 5000);
  }
});

test('local wall-clock changes preserve remaining time using monotonic elapsed time', () => {
  for (const jump of [-3600000, 3600000]) {
    const { clock, advance, jumpWall } = fixture();
    deadline(clock, epoch, epoch + 5000);
    advance(400); jumpWall(jump);
    assert.equal(deadline(clock, epoch, epoch + 5000), epoch + jump + 5000);
    advance(4600);
    assert.equal(deadline(clock, epoch, epoch + 5000), 0);
  }
});

test('a new sample replaces the anchor, including a corrected server wall clock', () => {
  const { clock, advance } = fixture();
  clock.snapshot(epoch);
  advance(800);
  assert.equal(clock.snapshot(epoch + 1000).serverNow, epoch + 1000);
  advance(150);
  assert.equal(clock.snapshot(epoch + 1000).serverNow, epoch + 1150);
  assert.equal(clock.snapshot(epoch - 1000).serverNow, epoch - 1000);
  advance(100);
  assert.equal(clock.snapshot(epoch - 1000).serverNow, epoch - 900);
});

test('reconnect resets elapsed time and a new join starts without an old anchor', () => {
  const { clock, advance } = fixture();
  clock.snapshot(epoch);
  advance(30000); clock.reset();
  assert.equal(clock.snapshot(epoch + 29900).serverNow, epoch + 29900);
  assert.equal(deadline(clock, epoch + 29900, epoch + 30900), epoch + 31000);
  const nextJoin = new RoomClock(() => epoch + 30000, () => 30000);
  assert.equal(nextJoin.snapshot(epoch + 29900).serverNow, epoch + 29900);
});

test('missing initial timestamps use the local clock without retaining invalid samples', () => {
  const { clock } = fixture();
  for (const sample of [0, -1, NaN, Infinity]) assert.deepEqual(clock.snapshot(sample), { serverNow: epoch, localNow: epoch });
});
