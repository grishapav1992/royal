import type { DemoWallet, WalletOperation, WalletResult } from '../shared/demoWallet';
import type { GameId, GameInput } from '../shared/gameCore';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';

export type WalletSettlement = { accountId: string; operation: WalletOperation; result: WalletResult };

export class WalletClient extends EventTarget {
  accountId: string | null = null;
  wallet?: DemoWallet;
  pending?: WalletOperation;
  busy = false;
  private externalLocks = new Set<string>();
  get externalBusy() { return this.externalLocks.size > 0; }
  hasExternalBusy(exceptOwner?: string) { return [...this.externalLocks].some(owner => owner !== exceptOwner); }
  setExternalBusy(owner: string, busy: boolean) {
    const before = this.externalBusy;
    if (busy) this.externalLocks.add(owner); else this.externalLocks.delete(owner);
    if (before !== this.externalBusy) this.notify();
  }
  error = '';
  private epoch = 0;
  private readVersion = 0;
  private key() { return `royal-demo-operation:${this.accountId}`; }
  private notify() { this.dispatchEvent(new Event('change')); }
  setAccount(id: string | null) {
    if (id === this.accountId) return;
    this.epoch++; this.accountId = id; this.wallet = undefined; this.pending = undefined; this.busy = false; this.externalLocks.clear(); this.error = '';
    if (id) {
      try {
        const value = sessionStorage.getItem(this.key());
        if (value) this.pending = JSON.parse(value);
      } catch { this.error = 'Не получилось восстановить незавершённую операцию.'; }
      void this.refresh();
    }
    this.notify();
  }
  async refresh() {
    if (!this.accountId) return;
    const epoch = this.epoch, version = ++this.readVersion, accountId = this.accountId;
    try {
      const response = await fetch('/api/demo-wallet', { credentials: 'same-origin', headers: { [WALLET_ACCOUNT_HEADER]: accountId }, signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (epoch !== this.epoch || version !== this.readVersion) return;
      this.acceptExternalWallet(accountId, result); this.error = '';
    } catch (error) {
      if (epoch !== this.epoch || version !== this.readVersion) return;
      this.error = error instanceof Error && /[а-я]/i.test(error.message) ? error.message : 'Не удалось обновить баланс. Проверь соединение.';
    }
    this.notify();
  }
  async operate(kind: 'deposit' | 'spin', amount: number): Promise<WalletResult> {
    if (this.pending && (kind !== this.pending.kind || amount !== this.pending.amount)) throw new Error('Сначала проверь предыдущую операцию в кошельке.');
    return this.send(this.pending ?? { id: crypto.randomUUID(), kind, amount });
  }
  async play(gameId: GameId, input: GameInput, amount: number): Promise<WalletResult> {
    if (this.pending) {
      const pending = this.pending;
      if (pending.kind !== 'play' || pending.gameId !== gameId || pending.amount !== amount || JSON.stringify(pending.input) !== JSON.stringify(input)) {
        throw new Error('Сначала проверь результат предыдущей игры.');
      }
      return this.send(pending);
    }
    return this.send({ id: crypto.randomUUID(), kind: 'play', amount, gameId, rulesVersion: 1, input: structuredClone(input) });
  }
  async retry(): Promise<WalletResult> {
    if (!this.pending) throw new Error('Нет неподтверждённой операции.');
    return this.send(this.pending);
  }
  acceptExternalWallet(accountId: string, wallet: DemoWallet) {
    if (accountId !== this.accountId) return;
    const newest = (value?: DemoWallet) => value?.entries.reduce((id, entry) => Math.max(id, entry.id), 0) ?? 0;
    // Responses can arrive out of order when a player changes cabinets during a request.
    if (newest(wallet) < newest(this.wallet)) return;
    this.readVersion++; this.wallet = wallet; this.notify();
  }
  private async send(operation: WalletOperation): Promise<WalletResult> {
    if (!this.accountId) throw new Error('Войди в аккаунт, чтобы играть на демомонеты.');
    if (this.busy) throw new Error('Дождись завершения операции.');
    if (this.externalBusy) throw new Error('Сначала проверь предыдущую операцию в другой игре.');
    // Save before sending, so reloading after an uncertain response preserves the same request ID.
    try { sessionStorage.setItem(this.key(), JSON.stringify(operation)); }
    catch { throw new Error('Для сохранения операции разреши хранилище браузера.'); }
    const epoch = this.epoch, storageKey = this.key(), accountId = this.accountId;
    this.pending = operation; this.busy = true; this.error = ''; this.readVersion++; this.notify();
    try {
      const response = await fetch('/api/demo-wallet/operations', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: accountId },
        body: JSON.stringify(operation), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (epoch !== this.epoch) throw new Error('Аккаунт изменился. Проверь баланс после входа.');
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429) {
          this.pending = undefined; sessionStorage.removeItem(storageKey);
        }
        throw new Error(result.error || 'Не удалось подтвердить операцию.');
      }
      this.acceptExternalWallet(accountId, result.wallet); this.pending = undefined; sessionStorage.removeItem(storageKey);
      this.readVersion++;
      this.dispatchEvent(new CustomEvent<WalletSettlement>('settlement', { detail: { accountId, operation, result } }));
      return result;
    } catch (error) {
      const message = error instanceof Error && /[а-я]/i.test(error.message) ? error.message : 'Ответ не получен. Нажми «Проверить операцию»: повторного списания не будет.';
      if (epoch === this.epoch) this.error = message;
      throw new Error(message);
    } finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
  }
}
export const demoWallet = new WalletClient();
export const coins = (value: number) => value.toLocaleString('ru-RU');
