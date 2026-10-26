import { readFileSync } from 'node:fs';
import { CryptoError } from '../crypto/config';
import { providerId } from '../crypto/nowpayments';
import { validCurrency } from '../../src/shared/cryptoWallet';
import type { SandboxCase } from '../../src/shared/nowpaymentsSandbox';

export const SANDBOX_API = 'https://api-sandbox.nowpayments.io/v1/';
export type SandboxConfig = { enabled: boolean; apiKey: string; ipnSecret: string; origin: string; currency: string };
export function sandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  const flag = env.NOWPAYMENTS_SANDBOX_ENABLED;
  if (flag && !['true', 'false'].includes(flag)) throw new Error('Invalid NOWPAYMENTS_SANDBOX_ENABLED');
  const secret = (name: string) => env[name + '_FILE'] ? readFileSync(env[name + '_FILE']!, 'utf8').trim() : env[name]?.trim() ?? '';
  const config = { enabled: flag === 'true', apiKey: secret('NOWPAYMENTS_SANDBOX_API_KEY'),
    ipnSecret: secret('NOWPAYMENTS_SANDBOX_IPN_SECRET'), origin: env.PUBLIC_ORIGIN ?? '',
    currency: env.NOWPAYMENTS_SANDBOX_CURRENCY ?? 'btc' };
  if (!validCurrency(config.currency)) throw new Error('Invalid NOWPAYMENTS_SANDBOX_CURRENCY');
  if (config.enabled) {
    const url = new URL(config.origin);
    if (url.protocol !== 'https:' || url.origin !== config.origin || !config.apiKey || config.ipnSecret.length < 16) {
      throw new Error('Configure separate Sandbox API/IPN keys and HTTPS PUBLIC_ORIGIN');
    }
    if (config.apiKey === secret('NOWPAYMENTS_API_KEY')) throw new Error('Use a separate Sandbox API key');
  }
  return config;
}
export interface SandboxProvider {
  create(id: string, amount: number, scenario: SandboxCase): Promise<Record<string, unknown>>;
  payment(id: string): Promise<Record<string, unknown>>;
}
export class SandboxNowPayments implements SandboxProvider {
  constructor(private config: SandboxConfig, private fetcher: typeof fetch = fetch) {}
  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(SANDBOX_API + path, { method: body ? 'POST' : 'GET',
        headers: { 'x-api-key': this.config.apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Sandbox request rejected');
      const text = await response.text();
      if (text.length > 128000) throw new Error('Sandbox response too large');
      const result = JSON.parse(text);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid Sandbox response');
      return result;
    } catch { throw new CryptoError(503, 'Sandbox NOWPayments не подтвердил ответ. Проверь ту же операцию позже.'); }
  }
  create(id: string, amount: number, scenario: SandboxCase) {
    return this.request('payment', { price_amount: amount, price_currency: 'usd', pay_currency: this.config.currency,
      order_id: id, order_description: 'Royal Sandbox: virtual balance only', case: scenario,
      ipn_callback_url: this.config.origin + '/api/nowpayments-sandbox/ipn' });
  }
  payment(id: string) { return this.request('payment/' + providerId(id)); }
}
