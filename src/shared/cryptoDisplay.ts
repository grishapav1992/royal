import { t as translateText } from '../i18n/index';
import { validDecimal } from './cryptoWallet';

export const DISPLAY_FIAT_CURRENCIES = {
  RUB: translateText('Российский рубль'), USD: translateText('Доллар США'), EUR: translateText('Евро'), KZT: translateText('Казахстанский тенге'),
  UAH: translateText('Украинская гривна'), BYN: translateText('Белорусский рубль'), GEL: translateText('Грузинский лари'), AMD: translateText('Армянский драм'),
  GBP: translateText('Британский фунт'), TRY: translateText('Турецкая лира'), CNY: translateText('Китайский юань'), INR: translateText('Индийская рупия'),
  BRL: translateText('Бразильский реал'), AED: translateText('Дирхам ОАЭ'), JPY: translateText('Японская иена'), CAD: translateText('Канадский доллар'),
  AUD: translateText('Австралийский доллар'), PLN: translateText('Польский злотый'), CHF: translateText('Швейцарский франк'),
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
