import { isUserMessage, t as translateText } from '../i18n/index';
import { validCasinoAction, validCasinoSession, type CasinoAction, type CasinoAsset, type CasinoSession } from '../shared/casinoSessions';
import type { DemoWallet } from '../shared/demoWallet';
import { validUsdtWallet, type UsdtWallet } from '../shared/usdtWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { demoWallet } from './WalletClient';
import { usdtWallet } from './UsdtClient';

type Reply = { wallet: DemoWallet | UsdtWallet; sessions: CasinoSession[]; session?: CasinoSession; replayed?: boolean };
export type NewCasinoAction = CasinoAction extends infer T ? T extends CasinoAction ? Omit<T, 'id'> : never : never;
function validDemo(value: unknown): value is DemoWallet {
  const w = value as DemoWallet;
  return !!w && Number.isFinite(w.balance) && w.balance >= 0 && Array.isArray(w.entries)
    && w.entries.every(e => Number.isSafeInteger(e.id) && Number.isFinite(e.amount) && Number.isFinite(e.balance));
}
export class CasinoClient extends EventTarget {
  accountId: string | null = null;
  wallet?: Reply['wallet']; sessions: CasinoSession[] = []; last?: CasinoSession;
  pending?: CasinoAction; busy = false; loading = false; error = '';
  private epoch = 0; private version = 0;
  constructor(readonly asset: CasinoAsset) { super(); }
  private key() { return this.asset === 'demo' ? `royal-casino:demo:${this.accountId}` : `royal-nile-casino:${this.asset}:${this.accountId}`; }
  private notify() { this.dispatchEvent(new Event('change')); }
  private lock() {
    if (this.asset === 'demo') demoWallet.setExternalBusy('casino', !!this.pending);
    else usdtWallet.externalBusy = !!this.pending;
  }
  setAccount(id: string | null) {
    if (id === this.accountId) return;
    this.epoch++; this.version++; this.accountId = id; this.wallet = undefined; this.sessions = []; this.last = undefined;
    this.pending = undefined; this.busy = false; this.loading = false; this.error = '';
    if (id) {
      try {
        const saved = sessionStorage.getItem(this.key());
        if (saved) {
          const op = JSON.parse(saved);
          if (op?.gameId === 'github-tower') sessionStorage.removeItem(this.key());
          else { if (!validCasinoAction(op)) throw Error(); this.pending = op; }
        }
      }
      catch { this.error = translateText('Не удалось восстановить ход. Проверь баланс перед игрой.'); }
    }
    this.lock(); this.notify(); if (id) void this.refresh();
  }
  private valid(value: unknown, operation?: CasinoAction): value is Reply {
    const r = value as Reply;
    if (!r || !(this.asset === 'demo' ? validDemo(r.wallet) : validUsdtWallet(r.wallet))
      || !Array.isArray(r.sessions) || !r.sessions.every(s => validCasinoSession(s) && s.state === 'active')
      || new Set(r.sessions.map(s => s.gameId)).size !== r.sessions.length) return false;
    return !operation || !!r.session && validCasinoSession(r.session) && typeof r.replayed === 'boolean'
      && r.session.gameId === operation.gameId && r.session.id === (operation.action === 'start' ? operation.id : operation.sessionId)
      && (operation.action !== 'start' || r.session.stakeUnits === operation.stakeUnits);
  }
  private accept(r: Reply) {
    this.wallet = r.wallet; this.sessions = r.sessions;
    if (r.session) this.last = r.session;
    if (this.asset === 'demo') demoWallet.acceptExternalWallet(this.accountId!, r.wallet as DemoWallet);
  }
  async refresh() {
    if (!this.accountId || this.busy) return;
    const epoch = this.epoch, version = ++this.version, account = this.accountId;
    this.loading = true; this.notify();
    try {
      const response = await fetch(`/api/${this.asset}-wallet/casino-sessions`, { credentials: 'same-origin', cache: 'no-store', headers: { [WALLET_ACCOUNT_HEADER]: account }, signal: AbortSignal.timeout(10000) });
      const r = await response.json();
      if (!response.ok) throw new Error(r.error);
      if (!this.valid(r)) throw new Error(translateText('Баланс и партия не подтверждены.'));
      if (epoch !== this.epoch || version !== this.version) return;
      this.accept(r); this.error = '';
    } catch (e) { if (epoch === this.epoch && version === this.version) this.error = this.message(e); }
    finally { if (epoch === this.epoch && version === this.version) { this.loading = false; this.notify(); } }
  }
  async act(action: NewCasinoAction) {
    if (this.pending) throw new Error(translateText('Сначала проверь предыдущий ход.'));
    return this.send({ ...action, id: crypto.randomUUID() } as CasinoAction);
  }
  async retry() { if (!this.pending) return; return this.send(this.pending); }
  private message(e: unknown) { return e instanceof Error && isUserMessage(e.message) ? translateText(e.message) : translateText('Ответ не получен. Нажми «Проверить ход», чтобы подтвердить ту же операцию.'); }
  private async send(op: CasinoAction) {
    if (!this.accountId || this.busy) throw new Error(translateText('Войди в аккаунт и дождись завершения хода.'));
    if (this.asset === 'demo' ? demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('casino') : usdtWallet.busy || !!usdtWallet.pending)
      throw new Error(translateText('Сначала проверь предыдущую операцию в кошельке.'));
    const epoch = this.epoch, account = this.accountId, key = this.key();
    try { sessionStorage.setItem(key, JSON.stringify(op)); } catch { throw new Error(translateText('Разреши хранилище браузера для сохранения хода.')); }
    this.pending = op; this.busy = true; this.loading = false; this.version++; this.error = ''; this.lock(); this.notify();
    try {
      const response = await fetch(`/api/${this.asset}-wallet/casino-sessions`, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: account }, body: JSON.stringify(op), signal: AbortSignal.timeout(15000) });
      const r = await response.json();
      if (epoch !== this.epoch) return;
      if (!response.ok) {
        if ([400, 403, 404, 409].includes(response.status)) { this.pending = undefined; sessionStorage.removeItem(key); }
        throw new Error(r.error);
      }
      if (!this.valid(r, op)) throw new Error(translateText('Ответ хода не подтверждён. Проверь ту же операцию.'));
      this.accept(r); this.pending = undefined; sessionStorage.removeItem(key); this.version++;
      if (this.asset === 'usdt') void usdtWallet.refresh();
    } catch (e) { if (epoch === this.epoch) { this.error = this.message(e); throw new Error(this.error); } }
    finally { if (epoch === this.epoch) { this.busy = false; this.lock(); this.notify(); if (!this.pending && this.error) void this.refresh(); } }
  }
}
export const casinoClients = { demo: new CasinoClient('demo'), usdt: new CasinoClient('usdt') };
demoWallet.addEventListener('change', () => {
  casinoClients.demo.setAccount(demoWallet.accountId); casinoClients.usdt.setAccount(null);
});
