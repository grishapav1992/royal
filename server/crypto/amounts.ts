import { validDecimal } from '../../src/shared/cryptoWallet';

// Decimal strings and integer arithmetic preserve the ledger's six-decimal unit.
export function decimal(value: unknown): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string') throw new Error('Invalid provider amount');
  const match = text.match(/^(\d+)(?:\.(\d+))?[eE](-?\d{1,2})$/);
  let result = text;
  if (match) {
    const digits = match[1] + (match[2] ?? ''), point = match[1].length + Number(match[3]);
    result = point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point);
  }
  if (!validDecimal(result)) throw new Error('Invalid provider amount');
  return result;
}
export function units(value: unknown, scale = 6, roundUp = false): bigint {
  const [whole, fraction = ''] = decimal(value).split('.');
  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0').slice(0, scale) || '0');
  return result + (roundUp && /[1-9]/.test(fraction.slice(scale)) ? 1n : 0n);
}
export function amount(value: bigint, scale = 6): string {
  if (value < 0n) throw new Error('Negative amount');
  const whole = value / 10n ** BigInt(scale), fraction = (value % 10n ** BigInt(scale)).toString().padStart(scale, '0').replace(/0+$/, '');
  return String(whole) + (fraction ? '.' + fraction : '');
}
export function providerNumber(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || units(numeric, 6) !== units(value, 6)) throw new Error('Provider amount loses precision');
  return numeric;
}
