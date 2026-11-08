import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleStandClock } from '../scripts/load-stand-clock';

const baseTime = 1_800_000_000_000;

function fakeClock() {
  let monotonic = 0, wallOffset = 0;
  return {
    clock: { monotonicNow: () => monotonic, wallNow: () => baseTime + monotonic + wallOffset },
    advance(ms: number) { monotonic += ms; },
    stepWall(ms: number) { wallOffset += ms; },
  };
}

test('clock probes bound asymmetric travel and detect a later local wall-clock step', async () => {
  const { clock, advance, stepWall } = fakeClock();
  const travel = [[6, 14], [2, 8], [8, 2]];
  const sampled = await sampleStandClock(async () => {
    const [outbound, inbound] = travel.shift()!;
    advance(outbound);
    const remote = clock.wallNow() + 4;
    advance(inbound);
    return remote;
  }, clock);
  assert.deepEqual(sampled.proof, {
    checkedAtUnixMs: baseTime + 40, lowerOffsetMs: 1, upperOffsetMs: 7, maxRoundTripMs: 20, samples: 3,
  });
  advance(2000);
  assert.doesNotThrow(sampled.assertLocalClock);
  stepWall(10);
  assert.throws(sampled.assertLocalClock, /stand-chat-local-clock-changed/);
});

test('clock probes refuse malformed, inconsistent or unbounded samples', async () => {
  const missing = fakeClock();
  await assert.rejects(sampleStandClock(async () => undefined, missing.clock), /invalid-stand-chat-clock-sample/);
  const distant = fakeClock();
  await assert.rejects(sampleStandClock(async () => distant.clock.wallNow() + 51, distant.clock), /stand-chat-clock-offset-unverified/);
  const slow = fakeClock();
  await assert.rejects(sampleStandClock(async () => {
    slow.advance(60);
    const remote = slow.clock.wallNow();
    slow.advance(60);
    return remote;
  }, slow.clock), /stand-chat-clock-offset-unverified/);
  const changing = fakeClock();
  let probes = 0;
  await assert.rejects(sampleStandClock(async () => changing.clock.wallNow() + 5 * probes++, changing.clock),
    /stand-chat-clock-offset-changed/);
  const stepped = fakeClock();
  await assert.rejects(sampleStandClock(async () => {
    const remote = stepped.clock.wallNow();
    stepped.stepWall(-10);
    return remote;
  }, stepped.clock), /stand-chat-local-clock-changed/);
});

test('long measurement tolerates bounded clock drift and refuses a larger local change', async () => {
  const { clock, advance, stepWall } = fakeClock();
  const sampled = await sampleStandClock(async () => clock.wallNow(), clock);
  advance(1800_000);
  stepWall(6);
  assert.doesNotThrow(sampled.assertLocalClock);
  stepWall(40);
  assert.throws(sampled.assertLocalClock, /stand-chat-local-clock-changed/);
});
