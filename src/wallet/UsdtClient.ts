import { isUserMessage, t as translateText } from '../i18n/index';
import { validUsdtWallet, validUsdtRequest, validUsdtRound, type UsdtWallet, type UsdtRequest, type UsdtResult, type UsdtGameId } from '../shared/usdtWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { GameInput } from '../shared/gameCore';

export class UsdtClient extends EventTarget {
  externalBusy = false;
  accountId: string | null = null; wallet?: UsdtWallet; pending?: UsdtRequest; busy = false; error = '';
  private epoch = 0; private version = 0;
  private key() { return 'royal-mainnet-round:' + this.accountId; }
  private notify() { this.dispatchEvent(new Event('change')); }
  setAccount(id: string | null) {
    if (id === this.accountId) return;
    this.epoch++; this.version++; this.accountId = id; this.wallet = undefined; this.pending = undefined; this.busy = false; this.error = '';
    if (id) {
      try { const saved = sessionStorage.getItem(this.key()); if (saved) { const row = JSON.parse(saved); if (!validUsdtRequest(row)) throw new Error(); this.pending = row; } }
      catch { this.error = translateText('Не удалось восстановить незавершенную ставку USDT.'); }
      void this.refresh();
    }
    this.notify();
  }
  async refresh() {
    if (!this.accountId) return;
    const epoch = this.epoch, version = ++this.version, accountId = this.accountId; this.wallet = undefined; this.notify();
    try {
      const response = await fetch('/api/usdt-wallet', { credentials: 'same-origin', cache: 'no-store', headers: { [WALLET_ACCOUNT_HEADER]: accountId }, signal: AbortSignal.timeout(10000) });
      const row = await response.json(); if (!response.ok) throw new Error(row.error);
      if (!validUsdtWallet(row)) throw new Error(translateText('Баланс USDT не подтвержден.'));
      if (epoch !== this.epoch || version !== this.version) return;
      this.wallet = row; this.error = '';
    } catch (e) { if (epoch !== this.epoch || version !== this.version) return; this.error = this.message(e); }
    this.notify();
  }
  private message(e: unknown) { return e instanceof Error && isUserMessage(e.message) ? translateText(e.message) : translateText('Ответ не получен. Проверь ту же операцию позже.'); }
  async play(gameId: UsdtGameId, input: GameInput, stakeUnits: string): Promise<UsdtResult> {
    if (this.externalBusy) throw new Error(translateText('Сначала проверь предыдущий ход в игре USDT.'));
    if (!this.accountId || this.busy) throw new Error(translateText('Войди в аккаунт и дождись завершения операции.'));
    const operation = this.pending ?? { id: crypto.randomUUID(), stakeUnits, gameId, input };
    if (!validUsdtRequest(operation) || operation.gameId !== gameId || operation.stakeUnits !== stakeUnits || JSON.stringify(operation.input) !== JSON.stringify(input)) throw new Error(translateText('Сначала проверь результат предыдущей ставки USDT.'));
    const key = this.key(), epoch = this.epoch, accountId = this.accountId;
    try { sessionStorage.setItem(key, JSON.stringify(operation)); } catch { throw new Error(translateText('Для сохранения ставки разреши хранилище браузера.')); }
    this.pending = operation; this.busy = true; this.version++; this.error = ''; this.notify();
    try {
      const response = await fetch('/api/usdt-wallet/rounds', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: accountId }, body: JSON.stringify(operation), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (epoch !== this.epoch) throw new Error(translateText('Аккаунт изменился. Проверь результат после входа.'));
      if (!response.ok) {
        if ([400, 409].includes(response.status)) { this.pending = undefined; sessionStorage.removeItem(key); }
        throw new Error(result.error);
      }
      if (!validUsdtWallet(result.wallet) || !validUsdtRound(result.round) || result.round.id !== operation.id
        || result.round.stakeUnits !== operation.stakeUnits || result.round.gameId !== operation.gameId
        || JSON.stringify(result.round.input) !== JSON.stringify(operation.input) || typeof result.replayed !== 'boolean') throw new Error(translateText('Ответ ставки не подтвержден. Повтори проверку той же операции.'));
      this.wallet = result.wallet; this.pending = undefined; sessionStorage.removeItem(key); this.version++; return result;
    } catch (e) { const message = this.message(e); if (epoch === this.epoch) this.error = message; throw new Error(message); }
    finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
  }
}
export const usdtWallet = new UsdtClient();
