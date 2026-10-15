import { validDecimal } from './cryptoWallet';

export const DISPLAY_FIAT_CURRENCIES = {
  RUB: 'Российский рубль', USD: 'Доллар США', EUR: 'Евро', KZT: 'Казахстанский тенге',
  UAH: 'Украинская гривна', BYN: 'Белорусский рубль', GEL: 'Грузинский лари', AMD: 'Армянский драм',
  GBP: 'Британский фунт', TRY: 'Турецкая лира', CNY: 'Китайский юань', INR: 'Индийская рупия',
  BRL: 'Бразильский реал', AED: 'Дирхам ОАЭ', JPY: 'Японская иена', CAD: 'Канадский доллар',
  AUD: 'Австралийский доллар', PLN: 'Польский злотый', CHF: 'Швейцарский франк',
} as const;
export type DisplayFiatCurrency = keyof typeof DISPLAY_FIAT_CURRENCIES;
export type CryptoDisplayRate = { currency: DisplayFiatCurrency; usdtRate: string; updatedAt: number; expiresAt: number };
export const validDisplayCurrency = (value: unknown): value is DisplayFiatCurrency =>
  typeof value === 'string' && Object.hasOwn(DISPLAY_FIAT_CURRENCIES, value);
export function validDisplayRate(value: unknown, now = Date.now()): value is CryptoDisplayRate {
  const row = value as CryptoDisplayRate | undefined;
  return !!row && validDisplayCurrency(row.currency) && validDecimal(row.usdtRate) && scaledRate(row.usdtRate) > 0n
    && Number.isSafeInteger(row.updatedAt) && Number.isSafeInteger(row.expiresAt)
    && row.updatedAt <= now + 5000 && row.expiresAt > now && row.expiresAt > row.updatedAt
    && row.expiresAt - row.updatedAt <= 120000;
}
function scaledRate(rate: string) {
  if (!validDecimal(rate)) throw new Error('Invalid display rate');
  const [whole, fraction = ''] = rate.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}
export function fiatEquivalent(usdtUnits: string, rate: string): string {
  if (!/^(0|[1-9]\d{0,12})$/.test(usdtUnits) || scaledRate(rate) <= 0n) throw new Error('Invalid display amount');
  const cents = (BigInt(usdtUnits) * scaledRate(rate) + 5n * 10n ** 21n) / 10n ** 22n;
  return String(cents / 100n) + '.' + String(cents % 100n).padStart(2, '0');
}
