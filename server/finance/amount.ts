export const SIMULATED_ASSET = 'USDT_SIM' as const;
export const SCALE = 6;
export const MAX_UNITS = 10n ** 30n;

export function amountUnits(value: unknown, allowZero = false): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,30})$/.test(value)) {
    throw new FinanceError(400, 'invalid_amount', 'Сумма должна быть строкой целых минимальных единиц.');
  }
  const units = BigInt(value);
  if (units > MAX_UNITS || (!allowZero && units === 0n)) {
    throw new FinanceError(400, 'invalid_amount', 'Недопустимая сумма.');
  }
  return value;
}

export function parseUsdt(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,24})(\.[0-9]{1,6})?$/.test(value)) {
    throw new FinanceError(400, 'invalid_amount', 'Используй десятичную строку с точностью до 6 знаков.');
  }
  const [whole, fraction = ''] = value.split('.');
  return amountUnits((BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(SCALE, '0'))).toString());
}

export class FinanceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
