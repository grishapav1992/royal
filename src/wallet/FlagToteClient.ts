import { demoWallet } from './WalletClient';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { TOTE_HEADER, validToteBet, validToteSnapshot, type ToteBet, type ToteReply } from '../shared/flagTote';

/** Shared host transport. Modules never construct a wallet or another pending-operation store. */
export class FlagToteClient extends EventTarget {
  accountId: string | null = null;
  snapshot?: ToteReply;
  pending?: ToteBet;
  busy = false;
  error = '';
  private epoch = 0;
  private reading = false;
  private receivedAt = 0;
  private clockAt = 0;
  private timer?: ReturnType<typeof setInterval>;
  private users = 0;
  constructor() { super(); demoWallet.addEventListener('change', () => this.syncAccount()); }
  private key() { return 'royal-flag-tote:' + this.accountId; }
  private notify() { this.dispatchEvent(new Event('change')); }
  private syncAccount() {
    if (this.accountId === demoWallet.accountId) return;
    this.epoch++; this.accountId = demoWallet.accountId; this.snapshot = undefined; this.pending = undefined; this.busy = false; this.reading = false; this.error = '';
    if (this.accountId) {
      try { const saved = sessionStorage.getItem(this.key()); if (saved) { const op = JSON.parse(saved); if (!validToteBet(op)) throw Error(); this.pending = op; } }
      catch { this.error = 'Не удалось прочитать сохранённую ставку. Обнови страницу.'; }
    }
    demoWallet.setExternalBusy('flag-tote', !!this.pending); this.notify();
    if (this.accountId && this.users) void this.refresh();
  }
  subscribe(callback: () => void) {
    this.users++; this.addEventListener('change', callback); this.syncAccount();
    if (!this.timer) this.timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, 3000);
    void this.refresh();
    return () => { this.removeEventListener('change', callback); if (!--this.users) { clearInterval(this.timer); this.timer = undefined; } };
  }
  serverTime() { return this.snapshot ? this.clockAt + Math.max(0, performance.now() - this.receivedAt) : Date.now(); }
  private accept(reply: unknown, account: string, started: number) {
    if (!validToteSnapshot(reply) || !('wallet' in reply)) throw Error('Не удалось проверить данные тотализатора.');
    const r = reply as ToteReply;
    if (!this.snapshot || r.serverNow >= this.snapshot.serverNow) {
      this.snapshot = r; this.receivedAt = performance.now(); this.clockAt = r.serverNow + Math.min(1500, (this.receivedAt - started) / 2);
    }
    demoWallet.acceptExternalWallet(account, r.wallet);
  }
  async refresh() {
    if (!this.accountId || this.reading || this.busy) return;
    const epoch = this.epoch, account = this.accountId, started = performance.now(); this.reading = true;
    try {
      const r = await fetch('/api/demo-wallet/flag-tote', { credentials: 'same-origin', headers: { [WALLET_ACCOUNT_HEADER]: account, [TOTE_HEADER]: '1' }, signal: AbortSignal.timeout(10000) });
      const value = await r.json(); if (epoch !== this.epoch) return;
      if (!r.ok) throw Error(value.error || 'Не удалось проверить общий раунд.');
      this.accept(value, account, started); this.error = '';
    } catch (e) { if (epoch === this.epoch) this.error = e instanceof Error ? e.message : 'Нет связи с общим раундом.'; }
    finally { if (epoch === this.epoch) { this.reading = false; this.notify(); } }
  }
  async bet(country: ToteBet['country'], stakeUnits: string) {
    if (this.pending) throw Error('Сначала проверь отправленную ставку.');
    if (!this.snapshot) throw Error('Сначала обнови общий раунд.');
    return this.send({ id: crypto.randomUUID(), roundId: this.snapshot.round.id, rulesVersion: 1, country, stakeUnits });
  }
  retry() { if (!this.pending) return Promise.reject(Error('Нет неподтверждённой ставки.')); return this.send(this.pending); }
  private async send(op: ToteBet) {
    if (!this.accountId || !validToteBet(op)) throw Error('Войди в аккаунт для ставки.');
    if (this.busy || demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('flag-tote')) throw Error('Сначала проверь предыдущую операцию в кошельке.');
    const epoch = this.epoch, account = this.accountId, key = this.key(), started = performance.now();
    try { sessionStorage.setItem(key, JSON.stringify(op)); } catch { throw Error('Для сохранения ставки разреши хранилище браузера.'); }
    this.pending = op; this.busy = true; demoWallet.setExternalBusy('flag-tote', true); this.notify();
    try {
      const response = await fetch('/api/demo-wallet/flag-tote', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: account, [TOTE_HEADER]: '1' }, body: JSON.stringify(op), signal: AbortSignal.timeout(15000) });
      const value = await response.json(); if (epoch !== this.epoch) throw Error('Аккаунт изменился. Проверь ставку после входа.');
      if (!response.ok) {
        if ([400, 403, 404, 409].includes(response.status)) { sessionStorage.removeItem(key); this.pending = undefined; }
        throw Error(value.error || 'Ответ не подтверждён. Проверь ту же ставку.');
      }
      this.accept(value, account, started); sessionStorage.removeItem(key); this.pending = undefined; this.error = '';
      return value as ToteReply;
    } catch (e) {
      const message = e instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(e.name) ? e.message : 'Ответ не получен. Проверь ту же ставку: повторного списания не будет.';
      if (epoch === this.epoch) this.error = message; throw Error(message);
    } finally { if (epoch === this.epoch) { this.busy = false; demoWallet.setExternalBusy('flag-tote', !!this.pending); this.notify(); } }
  }
}
export const flagToteClient = new FlagToteClient();
