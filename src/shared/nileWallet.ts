import { locale, language } from '../i18n/index';
export const NILE_WALLET_SCOPE = { network: 'nile', asset: 'USDT_NILE_TEST', scale: 6, testOnly: true, spendable: false } as const;
export type NileDeposit = { txId: string; logIndex: number; height: number; amountUnits: string };
export type NileWallet = typeof NILE_WALLET_SCOPE & (
  { state: 'disabled' | 'unassigned' } |
  { state: 'assigned'; address: string; balanceUnits: string; updatedAt: number; ledgerHeight: number; deposits: NileDeposit[] }
);
export const gameAccountId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const nileUnits = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,32})$/.test(value);
export function formatNileUnits(value: string) {
  if (!nileUnits(value)) throw new Error('Invalid Nile units');
  const number = BigInt(value), whole = (number / 1000000n).toLocaleString(locale);
  const fraction = (number % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return whole + (fraction ? (language === 'en' ? '.' : ',') + fraction : '');
}
