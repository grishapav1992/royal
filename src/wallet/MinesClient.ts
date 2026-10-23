import { isUserMessage, t as translateText } from '../i18n/index';
import type { MinesOperation, MinesResult, MinesSession } from '../shared/minesGame';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { demoWallet } from './WalletClient';

/** Persists only the request, never unrevealed mine positions. */
export class MinesClient extends EventTarget {
  accountId: string | null = null;
  session: MinesSession | null = null;
  pending?: MinesOperation;
  busy = false;
  loading = false;
  ready = false;
  error = '';
  private epoch = 0;
  private readVersion = 0;
  private notify() { this.dispatchEvent(new Event('change')); }
  private key() { return `royal-nile-mines-operation:${this.accountId}`; }
  setAccount(accountId: string | null) {
    if (accountId === this.accountId) return;
    this.epoch++; this.readVersion++; this.accountId = accountId;
    this.session = null; this.pending = undefined; this.busy = false;
    this.loading = false; this.ready = false; this.error = '';
    if (accountId) {
      try {
        const stored = sessionStorage.getItem(this.key());
        if (stored) this.pending = JSON.parse(stored);
      } catch { this.error = translateText('Не удалось восстановить действие. Разреши хранилище браузера.'); }
      void this.refresh();
    }
    demoWallet.setExternalBusy('mines', !!this.pending);
    this.notify();
  }
  async refresh() {
    if (!this.accountId || this.busy) return;
    const epoch = this.epoch, version = ++this.readVersion;
    this.loading = true; this.notify();
    try {
      const response = await fetch('/api/game-wallet/mines', {
        credentials: 'same-origin', headers: { [WALLET_ACCOUNT_HEADER]: this.accountId },
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json() as MinesResult & { error?: string };
      if (!response.ok) throw new Error(result.error || translateText('Не удалось восстановить партию.'));
      if (epoch !== this.epoch || version !== this.readVersion) return;
      this.session = result.session; this.ready = true; this.error = '';
      demoWallet.acceptExternalWallet(this.accountId!, result.wallet);
    } catch (error) {
      if (epoch !== this.epoch || version !== this.readVersion) return;
      this.error = readableError(error, translateText('Не удалось восстановить партию. Проверь соединение.'));
    } finally {
      if (epoch === this.epoch && version === this.readVersion) { this.loading = false; this.notify(); }
    }
  }
  async act(operation: Omit<MinesOperation, 'id'>): Promise<MinesResult> {
    if (this.pending) throw new Error(translateText('Сначала проверь предыдущий ход.'));
    return this.send({ id: crypto.randomUUID(), ...operation } as MinesOperation);
  }
  async retry(): Promise<MinesResult> {
    if (!this.pending) throw new Error(translateText('Нет неподтверждённого хода.'));
    return this.send(this.pending);
  }
  private async send(operation: MinesOperation): Promise<MinesResult> {
    if (!this.accountId) throw new Error(translateText('Войди в аккаунт, чтобы играть.'));
    if (this.busy || demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('mines')) throw new Error(translateText('Дождись подтверждения предыдущей операции в кошельке.'));
    try { sessionStorage.setItem(this.key(), JSON.stringify(operation)); }
    catch { throw new Error(translateText('Разреши хранилище браузера для сохранения хода.')); }
    const epoch = this.epoch, accountId = this.accountId, key = this.key();
    let refreshAfterConflict = false;
    this.pending = operation; this.busy = true; this.error = ''; this.readVersion++; this.loading = false; this.notify();
    demoWallet.setExternalBusy('mines', true);
    try {
      const response = await fetch('/api/game-wallet/mines', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: accountId },
        body: JSON.stringify(operation), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json() as MinesResult & { error?: string };
      if (epoch !== this.epoch) throw new Error(translateText('Аккаунт изменился. Открой игру после входа.'));
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429) {
          this.pending = undefined; sessionStorage.removeItem(key);
        }
        if (response.status === 404 || response.status === 409) {
          this.ready = false; refreshAfterConflict = true;
        }
        throw new Error(result.error || translateText('Не удалось подтвердить ход.'));
      }
      this.session = result.session; this.ready = true; this.pending = undefined;
      sessionStorage.removeItem(key); this.readVersion++;
      demoWallet.acceptExternalWallet(accountId, result.wallet);
      return result;
    } catch (error) {
      const message = readableError(error, translateText('Ответ не получен. Нажми «Проверить ход»: действие повторится с тем же номером.'));
      if (epoch === this.epoch) this.error = message;
      throw new Error(message);
    } finally {
      if (epoch === this.epoch) {
        this.busy = false; demoWallet.setExternalBusy('mines', !!this.pending);
        demoWallet.dispatchEvent(new Event('change')); this.notify();
        if (refreshAfterConflict) void this.refresh();
      }
    }
  }
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error && isUserMessage(error.message) ? translateText(error.message) : fallback;
}

export const minesClient = new MinesClient();
demoWallet.addEventListener('change', () => minesClient.setAccount(demoWallet.accountId));
