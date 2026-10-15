import { DEMO_BETS } from '../shared/demoWallet';
import type { FlightOperation, FlightResult, FlightSession } from '../shared/flightGame';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { demoWallet } from './WalletClient';

export type FlightSettlement = { accountId: string; session: FlightSession };
type FlightAction = { action: 'start'; amount: number; autoCashout: number } | { action: 'cashout'; sessionId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function restoredOperation(value: unknown): FlightOperation | undefined {
  if (!value || typeof value !== 'object') return;
  const op = value as Record<string, unknown>;
  if (typeof op.id !== 'string' || !uuid.test(op.id)) return;
  if (op.action === 'cashout' && typeof op.sessionId === 'string' && uuid.test(op.sessionId)) return { id: op.id, action: 'cashout', sessionId: op.sessionId };
  if (op.action === 'start' && DEMO_BETS.includes(op.amount as typeof DEMO_BETS[number])
    && typeof op.autoCashout === 'number' && Number.isFinite(op.autoCashout) && op.autoCashout >= 1.1 && op.autoCashout <= 100) {
    return { id: op.id, action: 'start', amount: op.amount as number, autoCashout: op.autoCashout };
  }
}

/** The persisted request keeps its UUID until the server confirms its result. */
export class FlightClient extends EventTarget {
  accountId: string | null = null;
  session: FlightSession | null = null;
  pending?: FlightOperation;
  busy = false;
  loading = false;
  ready = false;
  error = '';
  confirmedAt = 0;
  private serverNow = 0;
  private epoch = 0;
  private readVersion = 0;
  private poll?: ReturnType<typeof setTimeout>;
  private lastSettlement = '';
  private notify() { this.dispatchEvent(new Event('change')); }
  private key() { return `royal-flight-operation:${this.accountId}`; }
  private lock() { demoWallet.setExternalBusy('flight', this.busy || !!this.pending); }
  private visibility = () => {
    if (!document.hidden) { this.ready = false; this.notify(); void this.refresh(); }
  };
  constructor() { super(); document.addEventListener('visibilitychange', this.visibility); }
  setAccount(accountId: string | null) {
    if (accountId === this.accountId) return;
    clearTimeout(this.poll); this.epoch++; this.readVersion++; this.accountId = accountId;
    this.session = null; this.pending = undefined; this.busy = false; this.loading = false; this.ready = false;
    this.error = ''; this.confirmedAt = 0; this.serverNow = 0; this.lastSettlement = '';
    if (accountId) {
      try {
        const stored = sessionStorage.getItem(this.key());
        if (stored) {
          this.pending = restoredOperation(JSON.parse(stored));
          if (!this.pending) { this.error = 'Не удалось прочитать сохранённую операцию. Обнови состояние игры.'; sessionStorage.removeItem(this.key()); }
        }
      } catch { this.error = 'Не удалось восстановить операцию. Разреши хранилище браузера.'; }
    }
    this.lock(); this.notify();
    if (accountId) void this.refresh();
  }
  /** A monotonic server clock, used only for connection freshness, never for payouts. */
  serverTime() { return this.serverNow + Math.max(0, performance.now() - this.confirmedAt); }
  isFresh() { return this.ready && this.confirmedAt > 0 && this.serverTime() - this.serverNow < 2500; }
  async refresh() {
    if (!this.accountId || this.busy || this.loading) return;
    clearTimeout(this.poll);
    const accountId = this.accountId, epoch = this.epoch, version = ++this.readVersion;
    this.loading = true; this.notify();
    try {
      const response = await fetch('/api/demo-wallet/flight', {
        credentials: 'same-origin', cache: 'no-store', headers: { [WALLET_ACCOUNT_HEADER]: accountId }, signal: AbortSignal.timeout(10000),
      });
      const result = await response.json() as FlightResult & { error?: string };
      if (epoch !== this.epoch || version !== this.readVersion) return;
      if (!response.ok) throw new Error(result.error || 'Не удалось восстановить полёт.');
      this.accept(accountId, result); if (!this.pending) this.error = '';
    } catch (error) {
      if (epoch !== this.epoch || version !== this.readVersion) return;
      this.error = readableError(error, 'Нет свежего подтверждения сервера. Проверяем состояние полёта…');
      this.ready = false;
    } finally {
      if (epoch === this.epoch && version === this.readVersion) { this.loading = false; this.notify(); this.schedule(); }
    }
  }
  async act(action: FlightAction): Promise<FlightResult> {
    if (this.pending) throw new Error('Сначала проверь предыдущую операцию полёта.');
    if (!this.ready) throw new Error('Дождись восстановления состояния полёта.');
    return this.send({ id: crypto.randomUUID(), ...action });
  }
  async retry(): Promise<FlightResult> {
    if (!this.pending) throw new Error('Нет неподтверждённой операции полёта.');
    return this.send(this.pending);
  }
  private accept(accountId: string, result: FlightResult) {
    this.session = result.session; this.serverNow = result.serverNow; this.confirmedAt = performance.now(); this.ready = true;
    demoWallet.acceptExternalWallet(accountId, result.wallet);
    if (result.session && result.session.state !== 'active') {
      const key = `${result.session.id}:${result.session.state}`;
      if (key !== this.lastSettlement) {
        this.lastSettlement = key;
        this.dispatchEvent(new CustomEvent<FlightSettlement>('settlement', { detail: { accountId, session: result.session } }));
      }
    }
  }
  private schedule() {
    clearTimeout(this.poll);
    if (!this.accountId) return;
    this.poll = setTimeout(() => { if (!document.hidden) void this.refresh(); else this.schedule(); }, this.session?.state === 'active' ? 1000 : this.pending || !this.ready ? 2000 : 5000);
  }
  private async send(operation: FlightOperation): Promise<FlightResult> {
    if (!this.accountId || this.accountId !== demoWallet.accountId) throw new Error('Войди в аккаунт, чтобы играть.');
    if (this.busy || demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('flight')) throw new Error('Дождись подтверждения предыдущей операции.');
    const epoch = this.epoch, accountId = this.accountId, key = this.key();
    try { sessionStorage.setItem(key, JSON.stringify(operation)); }
    catch { throw new Error('Разреши хранилище браузера для сохранения операции.'); }
    clearTimeout(this.poll); this.readVersion++; this.loading = false;
    this.pending = operation; this.busy = true; this.error = ''; this.lock(); this.notify();
    let refreshAfterConflict = false;
    try {
      const response = await fetch('/api/demo-wallet/flight', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: accountId },
        body: JSON.stringify(operation), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json() as FlightResult & { error?: string };
      if (epoch !== this.epoch) throw new Error('Аккаунт изменился. Открой игру после входа.');
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429) {
          this.pending = undefined; sessionStorage.removeItem(key);
        }
        if (response.status === 404 || response.status === 409) { this.ready = false; refreshAfterConflict = true; }
        throw new Error(result.error || 'Не удалось подтвердить полёт.');
      }
      this.accept(accountId, result); this.pending = undefined; sessionStorage.removeItem(key); this.readVersion++;
      return result;
    } catch (error) {
      const message = readableError(error, 'Ответ не получен. Нажми «Проверить полёт»: операция повторится с тем же номером.');
      if (epoch === this.epoch) this.error = message;
      throw new Error(message);
    } finally {
      if (epoch === this.epoch) {
        this.busy = false; this.lock(); this.notify();
        if (refreshAfterConflict) void this.refresh(); else this.schedule();
      }
    }
  }
}
function readableError(error: unknown, fallback: string) { return error instanceof Error && /[а-я]/i.test(error.message) ? error.message : fallback; }
export const flightClient = new FlightClient();
demoWallet.addEventListener('change', () => flightClient.setAccount(demoWallet.accountId));
