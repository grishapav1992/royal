import { StandError } from './load-stand-contract';

export const STAND_CHAT_MAX_CLOCK_OFFSET_MS = 50;
const sampleCount = 3;
const wallResolutionMs = 1;

type Clock = { wallNow: () => number; monotonicNow: () => number };
const runtimeClock: Clock = { wallNow: Date.now, monotonicNow: () => performance.now() };

function mark(clock: Clock) {
  const before = clock.monotonicNow(), wall = clock.wallNow(), after = clock.monotonicNow();
  return { before, wall, after };
}

function assertClockConsistency(start: ReturnType<typeof mark>, end: ReturnType<typeof mark>, driftMs = 0) {
  const elapsed = end.wall - start.wall;
  const allowance = wallResolutionMs + driftMs;
  if (elapsed < 0 || elapsed < end.before - start.after - allowance
    || elapsed > end.after - start.before + allowance) throw new StandError('stand-chat-local-clock-changed');
}

/** Bound server minus local wall time without assuming symmetric request delays. */
export async function sampleStandClock(readServerTime: () => Promise<unknown>, clock: Clock = runtimeClock) {
  const first = mark(clock);
  let last = first, lowerOffsetMs = -Infinity, upperOffsetMs = Infinity, maxRoundTripMs = 0;
  for (let index = 0; index < sampleCount; index++) {
    const start = index === 0 ? first : mark(clock);
    const serverTime = await readServerTime();
    last = mark(clock);
    assertClockConsistency(start, last);
    if (typeof serverTime !== 'number' || !Number.isSafeInteger(serverTime) || serverTime < 1) {
      throw new StandError('invalid-stand-chat-clock-sample');
    }
    // The remote sample lies between the two local reads. Include rounding of both wall clocks.
    lowerOffsetMs = Math.max(lowerOffsetMs, serverTime - last.wall - wallResolutionMs);
    upperOffsetMs = Math.min(upperOffsetMs, serverTime - start.wall + wallResolutionMs);
    maxRoundTripMs = Math.max(maxRoundTripMs, Math.ceil(last.after - start.before));
  }
  assertClockConsistency(first, last);
  if (lowerOffsetMs > upperOffsetMs) throw new StandError('stand-chat-clock-offset-changed');
  if (lowerOffsetMs < -STAND_CHAT_MAX_CLOCK_OFFSET_MS || upperOffsetMs > STAND_CHAT_MAX_CLOCK_OFFSET_MS) {
    throw new StandError('stand-chat-clock-offset-unverified');
  }
  return {
    proof: { checkedAtUnixMs: last.wall, lowerOffsetMs, upperOffsetMs, maxRoundTripMs, samples: sampleCount },
    assertLocalClock: () => {
      const end = mark(clock);
      // Allow at most 10 ppm of local drift between the short, strict probes.
      assertClockConsistency(first, end, Math.min(20, (end.after - first.before) / 100_000));
    },
  };
}
