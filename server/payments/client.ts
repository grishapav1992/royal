import { readFileSync } from 'node:fs';
import { gameAccountId } from '../../src/shared/nileWallet';
import { validCryptoWallet } from '../../src/shared/cryptoWallet';
import { CryptoError } from '../crypto/config';
import type { PaymentCredits } from './credits';
import { serviceSignature, validateServiceSecret } from './protocol';

export type PaymentClientConfig = { url: string; requestSecret: string; eventSecret: string };
export function paymentClientConfig(env: NodeJS.ProcessEnv = process.env): PaymentClientConfig {
  const secret = (name: string) => env[name + '_FILE'] ? readFileSync(env[name + '_FILE']!, 'utf8').trim() : env[name] ?? '';
  const config = { url: env.PAYMENTS_SERVICE_URL ?? '', requestSecret: secret('PAYMENTS_REQUEST_SECRET'), eventSecret: secret('PAYMENTS_EVENT_SECRET') };
  if (config.url) {
    const url = new URL(config.url);
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid private payment service URL');
    validateServiceSecret(config.requestSecret); validateServiceSecret(config.eventSecret);
  } else if (config.requestSecret || config.eventSecret) throw new Error('Configure PAYMENTS_SERVICE_URL with the service secrets');
  return config;
}
export class PaymentClient {
  readonly ready = Promise.resolve();
  constructor(readonly config: PaymentClientConfig, private credits: PaymentCredits, private fetcher: typeof fetch = fetch) {}
  private async call(action: string, userId: string, value?: unknown, ipnSignature?: string) {
    if (!this.config.url) throw new CryptoError(503, 'Криптовалютные платежи еще не подключены.');
    if (userId && !gameAccountId(userId)) throw new CryptoError(400, 'Некорректный игрок.');
    const path = userId ? '/internal/users/' + userId + '/' + action : action.startsWith('admin/') ? '/internal/'+action : '/internal/ipn';
    const method = value === undefined ? 'GET' : 'POST', body = value === undefined ? '' : JSON.stringify(value), timestamp = String(Date.now());
    let response: Response, row: any;
    try {
      response = await this.fetcher(new URL(path, this.config.url), { method, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(17000), headers: {
        'Content-Type': 'application/json', 'x-royal-payments-timestamp': timestamp,
        'x-royal-payments-signature': serviceSignature(this.config.requestSecret, 'request', timestamp, method, path, body),
        ...(ipnSignature ? { 'x-nowpayments-sig': ipnSignature } : {}),
      } });
      const text = await response.text(); if (text.length > (action.startsWith('admin/')?1048576:128000)) throw new Error('Payment response too large'); row = JSON.parse(text);
    } catch { throw new CryptoError(503, 'Платежный сервис временно недоступен. Проверь ту же операцию позже.'); }
    if (!response.ok) throw new CryptoError([400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503,
      typeof row.error === 'string' && /[а-я]/i.test(row.error) ? row.error : 'Платежный сервис не подтвердил операцию.');
    return row;
  }
  async snapshot(userId: string) {
    if (!this.config.url) return { state: 'disabled' as const };
    const row = await this.call('snapshot', userId);
    if (!validCryptoWallet(row)) throw new CryptoError(503, 'Платежный баланс не подтвержден.');
    if (row.state === 'disabled') return row;
    const local = await this.credits.snapshot(userId);
    if (local.balanceUnits !== row.balanceUnits || local.reservedUnits !== row.reservedUnits) throw new CryptoError(503, 'Подтвержденный платеж обновляет баланс. Повтори проверку позже.');
    return { ...row, ...local };
  }
  currencies() { return this.call('currencies', '00000000-0000-4000-8000-000000000000'); }
  displayRate(currency: unknown) { return this.call('display-rate', '00000000-0000-4000-8000-000000000000', { currency }); }
  deposit(id: string, value: unknown) { return this.call('deposits', id, value); }
  stars(id: string, value?: unknown) {
    if (!this.config.url && value !== undefined) throw new CryptoError(503, 'Оплата Telegram Stars пока не подключена.');
    return this.config.url ? this.call('stars', id, value) : Promise.resolve({ enabled: false, operations: [] });
  }
  quote(id: string, value: unknown) { return this.call('quotes', id, value); }
  withdraw(id: string, value: unknown) { return this.call('withdrawals', id, value); }
  refresh(id: string, operation: string) { return this.call('operations/' + operation + '/refresh', id, {}); }
  admin(action:'report'|'adjust'|'refresh',actorId:string,value:unknown){ return this.call('admin/'+action,'',{actorId,value}); }
  async receiveIpn(body: unknown, signature: unknown) {
    if (typeof signature !== 'string') throw new CryptoError(401, 'Некорректное уведомление.');
    return this.call('ipn', '', body, signature);
  }
  async play(_id: string, _value: unknown): Promise<never> { throw new CryptoError(503, 'Игры на платном балансе еще не подключены.'); }
}
