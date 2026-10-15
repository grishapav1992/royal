import { CRYPTO_SETTLEMENT } from '../../src/shared/cryptoWallet';
import { validDisplayCurrency, validDisplayRate, type CryptoDisplayRate, type DisplayFiatCurrency } from '../../src/shared/cryptoDisplay';
import { CryptoError } from './config';

export class CryptoDisplayRates {
  private cache = new Map<DisplayFiatCurrency, CryptoDisplayRate>();
  private pending = new Map<DisplayFiatCurrency, Promise<CryptoDisplayRate>>();
  constructor(private estimate: (from: string, to: string, amount: string) => Promise<string>, private now = Date.now) {}
  get(currency: unknown): Promise<CryptoDisplayRate> {
    if (!validDisplayCurrency(currency)) return Promise.reject(new CryptoError(400, 'Выбери валюту отображения из списка.'));
    const cached = this.cache.get(currency);
    if (cached && validDisplayRate(cached, this.now())) return Promise.resolve(cached);
    const pending = this.pending.get(currency);
    if (pending) return pending;
    const request = this.estimate(CRYPTO_SETTLEMENT, currency.toLowerCase(), '1').then(usdtRate => {
      const updatedAt = this.now();
      const result = { currency, usdtRate, updatedAt, expiresAt: updatedAt + 60000 };
      if (!validDisplayRate(result, updatedAt)) throw new Error('Invalid provider display rate');
      this.cache.set(currency, result); return result;
    }).catch(() => { throw new CryptoError(503, 'Курс этой валюты сейчас недоступен. Баланс и пополнение доступны в USDT.'); })
      .finally(() => this.pending.delete(currency));
    this.pending.set(currency, request); return request;
  }
}
