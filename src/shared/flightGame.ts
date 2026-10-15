import type { DemoWallet } from './demoWallet';

export const FLIGHT_MIN_AUTO_CASHOUT = 1.10;
export const FLIGHT_MAX_MULTIPLIER = 100;
export const FLIGHT_GROWTH_MS = 10_000;
export const FLIGHT_ENTROPY_SIZE = 2 ** 32;
export const FLIGHT_RTP = Object.freeze({ numerator: 98, denominator: 100 });

export type FlightOperation =
  | { id: string; action: 'start'; amount: number; autoCashout: number }
  | { id: string; action: 'cashout'; sessionId: string };
export type FlightSession = {
  id: string;
  state: 'active' | 'lost' | 'cashed_out';
  amount: number;
  autoCashout: number;
  startedAt: number;
  multiplier: number;
  cashoutValue: number;
  payout: number;
  settledAt: number | null;
  reason: 'manual' | 'auto' | 'crash' | null;
};
export type FlightResult = { wallet: DemoWallet; session: FlightSession | null; serverNow: number };

export function flightAutoCashoutCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('Invalid flight target');
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 110 || cents > 10_000 || value !== cents / 100) throw new RangeError('Invalid flight target');
  return cents;
}

export function flightTimeForCents(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 98 || cents > 10_001) throw new RangeError('Invalid flight multiplier');
  return Math.max(0, Math.ceil(Math.log(cents / 100) * FLIGHT_GROWTH_MS));
}

/** Public growth schedule only. The hidden end of a flight stays on the server. */
export function flightMultiplierCentsAt(startedAt: number, now: number): number {
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(now)) throw new RangeError('Invalid flight clock');
  const elapsed = Math.max(0, now - startedAt);
  let low = 100, high = 10_000;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (flightTimeForCents(mid) <= elapsed) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function flightMultiplierAt(startedAt: number, now: number): number {
  return flightMultiplierCentsAt(startedAt, now) / 100;
}
