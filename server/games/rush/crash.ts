import { randomBytes } from "crypto";

/**
 * The Crash multiplier follows `m(t) = exp(GROWTH_RATE * t)` where t is
 * seconds since round start. At GROWTH_RATE=0.06/s the curve hits 2x at
 * ~11.55s and 10x at ~38s, which lines up with typical Stake-style pacing.
 *
 * Server-side cashout validation just computes the inverse:
 *   secondsToReachMultiplier(m) = ln(m) / GROWTH_RATE
 * and compares against (now - start_at) plus a small grace window for
 * client-side animation jitter.
 */
export const GROWTH_RATE = 0.06;

/**
 * Crypto-strong uniform sample in [0, 1). 48 bits of entropy is way more
 * than we need but cheap and avoids float bias.
 */
function uniformRandom(): number {
  const buf = randomBytes(6);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + buf[i];
  return n / 2 ** 48;
}

/**
 * Pre-rolls the crash multiplier for the next round. Stake-style formula
 * with a 1% house edge:
 *   crash_at = max(1, 99 / (r * 100))   r ~ Uniform(0, 1)
 * giving 99% RTP for any fixed cashout target.
 */
export function rollCrashPoint(): number {
  const r = uniformRandom();
  if (r === 0) return 1;
  return Math.max(1, 99 / (r * 100));
}

/**
 * Multiplier visible to the player at `seconds` elapsed since round start.
 * Pure function - client and server agree on this number for the same t.
 */
export function multiplierAtElapsed(seconds: number): number {
  return Math.exp(GROWTH_RATE * seconds);
}

/**
 * Inverse of {@link multiplierAtElapsed}. Used server-side to decide
 * whether a cashout request landed in time.
 */
export function secondsToReachMultiplier(m: number): number {
  if (m < 1) throw new Error("multiplier must be >= 1");
  return Math.log(m) / GROWTH_RATE;
}
