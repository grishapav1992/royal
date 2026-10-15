import { createHmac, timingSafeEqual } from 'node:crypto';
import { CryptoError, type CryptoConfig } from './config';
import { decimal, providerNumber } from './amounts';
import { CRYPTO_SETTLEMENT, validCurrency, type CryptoCurrency } from '../../src/shared/cryptoWallet';

type Json = Record<string, any>;
function sorted(value: any): any {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
export function validIpn(body: unknown, signature: unknown, secret: string): boolean {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const digest = createHmac('sha512', secret).update(JSON.stringify(sorted(body))).digest();
  return timingSafeEqual(digest, Buffer.from(signature, 'hex'));
}
export function totp(secret: string, now = Date.now()): string {
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest(), offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export interface CryptoProvider {
  currencies(): Promise<CryptoCurrency[]>;
  estimate(from: string, to: string, amount: string): Promise<string>;
  minimum(from: string, to: string): Promise<string>;
  fee(currency: string, amount: string): Promise<string>;
  validateAddress(currency: string, address: string, memo: string): Promise<void>;
  balance(): Promise<Json>;
  createPayment(id: string, currency: string, amount: string): Promise<Json>;
  payment(id: string): Promise<Json>;
  convert(currency: string, amount: string): Promise<Json>;
  conversion(id: string): Promise<Json>;
  createPayout(id: string, currency: string, address: string, memo: string, amount: string): Promise<Json>;
  payout(id: string): Promise<Json>;
  verify(batch: string): Promise<void>;
}
export const providerId = (value: unknown): string => {
  const id = String(value ?? '');
  if (!/^\d{1,30}$/.test(id)) throw new Error('Invalid provider identifier');
  return id;
};
export class NowPayments implements CryptoProvider {
  private token = ''; private expires = 0; private authenticating?: Promise<string>;
  private coins?: { until: number; values: CryptoCurrency[] };
  constructor(private config: CryptoConfig, private fetcher: typeof fetch = fetch) {}
  private async request(path: string, body?: Json, auth = false): Promise<any> {
    const headers: Record<string, string> = { 'x-api-key': this.config.apiKey, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = 'Bearer ' + await this.authenticate();
    try {
      const response = await this.fetcher('https://api.nowpayments.io/v1/' + path, { method: body ? 'POST' : 'GET', headers,
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000), redirect: 'error' });
      // Never retry money-changing requests, including authentication failures.
      if (!response.ok) { if (response.status === 401) this.expires = 0; throw new Error('Provider request rejected'); }
      const text = await response.text();
      if (text.length > 2000000) throw new Error('Provider response too large');
      return text === 'OK' || text === '"OK"' ? { ok: true } : JSON.parse(text);
    } catch { throw new CryptoError(503, 'Провайдер не подтвердил операцию. Проверь ее статус позже.'); }
  }
  private async authenticate() {
    if (this.token && this.expires > Date.now()) return this.token;
    if (!this.authenticating) this.authenticating = this.request('auth', { email: this.config.email, password: this.config.password }).then(row => {
      if (typeof row.token !== 'string' || row.token.length < 20) throw new Error('Invalid provider token');
      this.token = row.token; this.expires = Date.now() + 240000; return this.token;
    }).finally(() => { this.authenticating = undefined; });
    return this.authenticating;
  }
  async currencies() {
    if (this.coins && this.coins.until > Date.now()) return this.coins.values;
    const [full, enabled] = await Promise.all([this.request('full-currencies'), this.request('merchant/coins')]);
    if (!Array.isArray(full.currencies) || !Array.isArray(enabled.selectedCurrencies)
      || !enabled.selectedCurrencies.every((code: unknown) => typeof code === 'string' && validCurrency(code.toLowerCase()))) throw new Error('Invalid provider currencies');
    const allowed = new Set(enabled.selectedCurrencies.map((code: string) => code.toLowerCase()));
    const values = full.currencies.filter((row: Json) => row.enable === true && validCurrency(String(row.code).toLowerCase()) && allowed.has(String(row.code).toLowerCase()))
      .map((row: Json): CryptoCurrency => ({ code: String(row.code).toLowerCase(), name: String(row.name).slice(0, 80), network: String(row.network ?? row.code).slice(0, 40), memo: row.extra_id_exists === true }));
    this.coins = { until: Date.now() + 60000, values }; return values;
  }
  async estimate(from: string, to: string, value: string) {
    const row = await this.request('estimate?' + new URLSearchParams({ currency_from: from, currency_to: to, amount: value }));
    return decimal(row.estimated_amount);
  }
  async minimum(from: string, to: string) {
    const row = await this.request('min-amount?' + new URLSearchParams({ currency_from: from, currency_to: to }));
    return decimal(row.min_amount);
  }
  async fee(currency: string, value: string) {
    const row = await this.request('payout/fee?' + new URLSearchParams({ currency, amount: value }));
    return decimal(row.fee);
  }
  async validateAddress(currency: string, address: string, memo: string) {
    const row = await this.request('payout/validate-address', { currency, address, extra_id: memo || null });
    if (row.ok !== true && row.valid !== true && row.result !== true) throw new CryptoError(400, 'Проверь адрес, сеть и обязательный memo.');
  }
  balance() { return this.request('balance'); }
  createPayment(id: string, currency: string, value: string) {
    return this.request('payment', { price_amount: providerNumber(value), price_currency: CRYPTO_SETTLEMENT, pay_currency: currency,
      order_id: id, order_description: 'Royal USDT deposit', ipn_callback_url: this.config.origin + '/api/crypto-wallet/ipn',
      is_fixed_rate: false, is_fee_paid_by_user: false });
  }
  payment(id: string) { return this.request('payment/' + providerId(id)); }
  async convert(currency: string, value: string) {
    return (await this.request('conversion', { amount: providerNumber(value), from_currency: CRYPTO_SETTLEMENT, to_currency: currency }, true)).result;
  }
  async conversion(id: string) { return (await this.request('conversion/' + providerId(id), undefined, true)).result; }
  createPayout(id: string, currency: string, address: string, memo: string, value: string) {
    return this.request('payout', { ipn_callback_url: this.config.origin + '/api/crypto-wallet/ipn',
      withdrawals: [{ currency, address, extra_id: memo || null, amount: providerNumber(value), unique_external_id: id,
        payout_description: 'Royal withdrawal ' + id }] }, true);
  }
  async payout(id: string) {
    const row = await this.request('payout/' + providerId(id));
    const list = Array.isArray(row) ? row : row.withdrawals ?? [row];
    const result = list.find((entry: Json) => String(entry.id) === id);
    if (!result) throw new Error('Missing provider payout');
    return result;
  }
  async verify(batch: string) { await this.request('payout/' + providerId(batch) + '/verify', { verification_code: totp(this.config.twoFactorSecret) }, true); }
}
