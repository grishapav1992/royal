import { t as translateText } from '../i18n/index';
import { gameAccountId, nileUnits } from './nileWallet';
import { validUsdtRound, type UsdtRound } from './usdtWallet';

export const CRYPTO_SETTLEMENT = 'usdttrc20';
export type CryptoCurrency = { code: string; name: string; network: string; memo: boolean };
export type CryptoOperation = { id: string; kind: 'deposit' | 'withdrawal'; state: string; amountUnits: string;
  creditedUnits: string; currency: string; address: string; memo: string; payAmount: string; txHash: string; createdAt: number };
export type CryptoQuote = { id: string; amountUnits: string; currency: string; address: string; memo: string;
  estimatedAmount: string; networkFee: string; minimumReceive: string; expiresAt: number };
export type CryptoWallet = { state: 'disabled' } | { state: 'enabled'; provider: 'nowpayments'; asset: 'USDT'; scale: 6;
  balanceUnits: string; reservedUnits: string; withdrawalsEnabled: boolean; gamesEnabled: boolean;
  cryptoDepositsEnabled?: boolean;
  ready: boolean; maxStakeUnits: Record<'royal-coins' | 'royal-roulette', string>;
  operations: CryptoOperation[]; rounds: UsdtRound[] };
export const validCurrency = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{2,24}$/.test(value);
export const validDecimal = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,12})(\.\d{1,18})?$/.test(value);
export function usdtUnits(value: string): string {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value)) throw new Error(translateText('Укажи сумму USDT, не больше шести знаков после запятой.'));
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (units <= 0n || units > 1000000000000n) throw new Error(translateText('Сумма должна быть от 0,000001 до 1 000 000 USDT.'));
  return String(units);
}
export function validCryptoWallet(value: unknown): value is CryptoWallet {
  const row = value as any;
  if (row?.state === 'disabled') return true;
  return row?.state === 'enabled' && row.provider === 'nowpayments' && row.asset === 'USDT' && row.scale === 6
    && nileUnits(row.balanceUnits) && nileUnits(row.reservedUnits) && typeof row.withdrawalsEnabled === 'boolean'
    && (row.cryptoDepositsEnabled === undefined || typeof row.cryptoDepositsEnabled === 'boolean')
    && typeof row.gamesEnabled === 'boolean' && typeof row.ready === 'boolean'
    && row.maxStakeUnits && ['royal-coins', 'royal-roulette'].every(id => nileUnits(row.maxStakeUnits[id]))
    && Array.isArray(row.operations) && row.operations.length <= 50 && row.operations.every((op: any) => gameAccountId(op.id)
      && ['deposit', 'withdrawal'].includes(op.kind) && typeof op.state === 'string' && op.state.length <= 64
      && nileUnits(op.amountUnits) && nileUnits(op.creditedUnits) && validCurrency(op.currency)
      && ['address', 'memo', 'payAmount', 'txHash'].every(key => typeof op[key] === 'string' && op[key].length <= 512)
      && Number.isSafeInteger(op.createdAt)) && Array.isArray(row.rounds) && row.rounds.length <= 50 && row.rounds.every(validUsdtRound);
}
