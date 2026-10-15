import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { validCryptoWallet, validCurrency, validDecimal, type CryptoWallet, type CryptoOperation, type CryptoQuote, type CryptoCurrency } from '../shared/cryptoWallet';
import { validUsdtRequest, validUsdtRound, type UsdtRequest, type UsdtGameId } from '../shared/usdtWallet';
import type { GameInput } from '../shared/gameCore';
import { validDisplayRate, type CryptoDisplayRate, type DisplayFiatCurrency } from '../shared/cryptoDisplay';

type Transfer = { path: 'deposits' | 'withdrawals'; value: Record<string, string> };
export class CryptoClient extends EventTarget {
  accountId: string | null = null; wallet?: CryptoWallet; pending?: UsdtRequest; transfer?: Transfer;
  busy = false; error = ''; private epoch = 0; private revision = 0;
  private key(kind: string) { return 'royal-crypto-' + kind + ':' + this.accountId; }
  private notify() { this.dispatchEvent(new Event('change')); }
  setAccount(id: string | null) {
    if (id === this.accountId) return;
    this.epoch++; this.revision++; this.accountId = id; this.wallet = undefined; this.pending = undefined; this.transfer = undefined; this.busy = false; this.error = '';
    if (id) {
      try {
        const round = sessionStorage.getItem(this.key('round')), transfer = sessionStorage.getItem(this.key('transfer'));
        if (round) { const value = JSON.parse(round); if (!validUsdtRequest(value)) throw new Error(); this.pending = value; }
        if (transfer) { const value = JSON.parse(transfer); if (!['deposits', 'withdrawals'].includes(value.path) || typeof value.value?.id !== 'string') throw new Error(); this.transfer = value; }
      } catch { this.error = 'Не удалось восстановить операцию. Проверь историю кошелька.'; }
      void this.refresh();
    }
    this.notify();
  }
  private async request(path: string, body?: unknown) {
    if (!this.accountId) throw new Error('Войди в аккаунт.');
    const epoch = this.epoch;
    const response = await fetch('/api/crypto-wallet' + path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: { [WALLET_ACCOUNT_HEADER]: this.accountId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const value = await response.json();
    if (epoch !== this.epoch) throw new Error('Аккаунт изменился. Проверь операцию после входа.');
    if (!response.ok) throw Object.assign(new Error(typeof value.error === 'string' ? value.error : 'Операция не подтверждена.'), { status: response.status });
    return value;
  }
  async refresh() {
    if (!this.accountId || this.busy) return;
    const epoch = this.epoch, revision = ++this.revision;
    try {
      const row = await this.request('');
      if (!validCryptoWallet(row)) throw new Error('Не удалось подтвердить баланс.');
      if (epoch !== this.epoch || revision !== this.revision) return;
      this.wallet = row; this.error = '';
    } catch (error) { if (epoch === this.epoch && revision === this.revision) { this.wallet = undefined; this.error = this.message(error); } }
    this.notify();
  }
  private message(error: unknown) { return error instanceof Error && /[а-я]/i.test(error.message) ? error.message : 'Ответ не получен. Проверь ту же операцию позже.'; }
  async currencies(): Promise<CryptoCurrency[]> {
    const row = await this.request('/currencies');
    if (!Array.isArray(row.currencies) || !row.currencies.every((coin: CryptoCurrency) => validCurrency(coin.code) && typeof coin.name === 'string' && typeof coin.network === 'string' && typeof coin.memo === 'boolean')) throw new Error('Список валют недоступен.');
    return row.currencies;
  }
  async quote(value: Record<string, string>): Promise<CryptoQuote> {
    const row = await this.request('/quotes', value);
    if (row.id !== value.id || row.amountUnits !== value.amountUnits || row.currency !== value.currency || row.address !== value.address || row.memo !== value.memo
      || ![row.estimatedAmount, row.networkFee, row.minimumReceive].every(validDecimal) || !Number.isSafeInteger(row.expiresAt)) throw new Error('Расчет не подтвержден.');
    return row;
  }
  async displayRate(currency: DisplayFiatCurrency): Promise<CryptoDisplayRate> {
    const row = await this.request('/display-rate', { currency });
    if (!validDisplayRate(row) || row.currency !== currency) throw new Error('Курс валюты не подтвержден.');
    return row;
  }
  async send(path: Transfer['path'], value: Record<string, string>): Promise<CryptoOperation> {
    if (!this.accountId) throw new Error('Войди в аккаунт.');
    if (this.busy || this.pending) throw new Error('Дождись подтверждения предыдущей операции.');
    if (this.transfer && (path !== this.transfer.path || JSON.stringify(value) !== JSON.stringify(this.transfer.value))) throw new Error('Сначала проверь ранее отправленную операцию.');
    const epoch = this.epoch, key = this.key('transfer');
    sessionStorage.setItem(key, JSON.stringify({ path, value }));
    this.transfer = { path, value }; this.busy = true; this.revision++; this.notify();
    try {
      const result = await this.request('/' + path, value);
      if (result.id !== value.id || result.kind !== (path === 'deposits' ? 'deposit' : 'withdrawal') || typeof result.state !== 'string') throw new Error('Ответ операции не подтвержден.');
      if (epoch !== this.epoch) throw new Error('Аккаунт изменился.');
      this.transfer = undefined; sessionStorage.removeItem(key); this.error = ''; return result;
    } catch (error) {
      if (epoch === this.epoch) {
        if ([400, 409].includes((error as any)?.status)) { this.transfer = undefined; sessionStorage.removeItem(key); }
        this.error = this.message(error);
      }
      throw new Error(this.message(error));
    }
    finally { if (epoch === this.epoch) { this.busy = false; this.notify(); void this.refresh(); } }
  }
  async retryTransfer() { if (!this.transfer) return; return this.send(this.transfer.path, this.transfer.value); }
  async refreshOperation(id: string) { await this.request('/operations/' + encodeURIComponent(id) + '/refresh', {}); await this.refresh(); }
  async play(gameId: UsdtGameId, input: GameInput, stakeUnits: string) {
    if (!this.accountId) throw new Error('Войди в аккаунт.');
    if (this.busy || this.transfer) throw new Error('Дождись подтверждения перевода.');
    const operation = this.pending ?? { id: crypto.randomUUID(), gameId, input, stakeUnits };
    if (!validUsdtRequest(operation) || operation.gameId !== gameId || operation.stakeUnits !== stakeUnits || JSON.stringify(operation.input) !== JSON.stringify(input)) throw new Error('Сначала проверь предыдущую ставку.');
    const epoch = this.epoch, key = this.key('round');
    sessionStorage.setItem(key, JSON.stringify(operation)); this.pending = operation; this.busy = true; this.revision++; this.notify();
    try {
      const result = await this.request('/rounds', operation);
      if (!validCryptoWallet(result.wallet) || !validUsdtRound(result.round) || result.round.id !== operation.id || result.round.gameId !== operation.gameId
        || result.round.stakeUnits !== operation.stakeUnits || JSON.stringify(result.round.input) !== JSON.stringify(operation.input) || typeof result.replayed !== 'boolean') throw new Error('Ставка не подтверждена.');
      if (epoch !== this.epoch) throw new Error('Аккаунт изменился.');
      this.wallet = result.wallet; this.pending = undefined; sessionStorage.removeItem(key); this.error = ''; return result;
    } catch (error) {
      if (epoch === this.epoch) {
        if ([400, 409].includes((error as any)?.status)) { this.pending = undefined; sessionStorage.removeItem(key); }
        this.error = this.message(error);
      }
      throw new Error(this.message(error));
    }
    finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
  }
}
export const cryptoWallet = new CryptoClient();
