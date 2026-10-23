import { createHmac, timingSafeEqual } from 'node:crypto';
import { gameAccountId, nileUnits } from '../../src/shared/nileWallet';
import { amount } from '../crypto/amounts';

export type PaymentEvent = { event_id: string; user_id: string; payment_id: string; kind: 'deposit' | 'reserve' | 'paid' | 'refund';
  currency: 'USDT'; scale: 6; deposit_amount: string; available_delta_units: string; reserved_delta_units: string; created_at: number };
export const signedUnits = (value: unknown): value is string => typeof value === 'string' && /^-?(0|[1-9]\d{0,12})$/.test(value)
  && value !== '-0' && BigInt(value) >= -1000000000000n && BigInt(value) <= 1000000000000n;
export function validPaymentEvent(value: unknown): value is PaymentEvent {
  const row = value as PaymentEvent;
  if (!row || Object.keys(row).sort().join(',') !== 'available_delta_units,created_at,currency,deposit_amount,event_id,kind,payment_id,reserved_delta_units,scale,user_id'
    || !/^[a-f0-9]{64}$/.test(row.event_id) || !gameAccountId(row.user_id) || !gameAccountId(row.payment_id)
    || row.currency !== 'USDT' || row.scale !== 6 || !Number.isSafeInteger(row.created_at)
    || !signedUnits(row.available_delta_units) || !signedUnits(row.reserved_delta_units)) return false;
  const available = BigInt(row.available_delta_units), reserved = BigInt(row.reserved_delta_units);
  if (row.kind === 'deposit') return available > 0n && reserved === 0n && row.deposit_amount === amount(available);
  if (row.deposit_amount !== '0') return false;
  if (row.kind === 'reserve') return available < 0n && reserved === -available;
  if (row.kind === 'refund') return available > 0n && reserved === -available;
  return row.kind === 'paid' && available === 0n && reserved < 0n;
}
export function validateServiceSecret(secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Payment service secret must contain 32 random bytes encoded as hex');
  return secret;
}
export function serviceSignature(secret: string, purpose: 'request' | 'event', timestamp: string, method: string, path: string, body: string) {
  return createHmac('sha256', validateServiceSecret(secret)).update([purpose, timestamp, method, path, body].join('\n')).digest('hex');
}
export function verifyServiceSignature(secret: string, purpose: 'request' | 'event', timestamp: unknown, signature: unknown,
  method: string, path: string, body: string, now = Date.now()) {
  if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60000
    || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(serviceSignature(secret, purpose, timestamp, method, path, body), 'hex'));
}
export const validBalanceUnits = (value: unknown) => nileUnits(value) && BigInt(value as string) <= 1000000000000n;
