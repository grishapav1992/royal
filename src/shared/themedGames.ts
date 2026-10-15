export const WHEEL_RISKS = ['low', 'medium', 'high'] as const;
export type WheelRisk = typeof WHEEL_RISKS[number];
export type WheelInput = { readonly risk: WheelRisk };
export const WHEEL_SEGMENT_COUNT = 50;
export const WHEEL_MAX_MULTIPLIER = 49;
export const WHEEL_RTP = Object.freeze({ numerator: 49, denominator: 50 });

// Integer hundredths keep the exact total return at 4900 / 50 / 100.
export const WHEEL_MULTIPLIER_CENTS: Readonly<Record<WheelRisk, readonly number[]>> = Object.freeze({
  low: Object.freeze(Array.from({ length: 50 }, (_, i) => i % 10 === 0 ? 0 : i % 10 === 9 ? 180 : 100)),
  medium: Object.freeze(Array.from({ length: 50 }, (_, i) => i % 2 === 0 ? 0 : i < 30 ? 100 : i < 46 ? 300 : 500)),
  high: Object.freeze(Array.from({ length: 50 }, (_, i) => i === 24 ? 4900 : 0)),
});
export const WHEEL_MULTIPLIERS: Readonly<Record<WheelRisk, readonly number[]>> = Object.freeze({
  low: Object.freeze(WHEEL_MULTIPLIER_CENTS.low.map(value => value / 100)),
  medium: Object.freeze(WHEEL_MULTIPLIER_CENTS.medium.map(value => value / 100)),
  high: Object.freeze(WHEEL_MULTIPLIER_CENTS.high.map(value => value / 100)),
});

export function wheelMultiplier(risk: WheelRisk, segment: number): number {
  if (!(WHEEL_RISKS as readonly unknown[]).includes(risk) || !Number.isSafeInteger(segment)
    || segment < 0 || segment >= WHEEL_SEGMENT_COUNT) throw new RangeError('Invalid wheel outcome');
  return WHEEL_MULTIPLIERS[risk][segment];
}
