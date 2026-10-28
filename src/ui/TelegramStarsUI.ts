import { t, tr } from '../i18n/index';
import '../i18n/paymentMethodsEn';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { gameAccountId, formatNileUnits } from '../shared/nileWallet';
import { cryptoWallet } from '../wallet/CryptoClient';

type Order = { id: string; stars: number; amountUnits: string; status: string; botUrl: string; expiresAt: number };
type Snapshot = { enabled: boolean; unitsPerStar: string; termsUrl: string; operations: Order[] };
export class TelegramStarsUI {
  private section = document.createElement('section');
  private snapshot?: Snapshot; private account: string | null = null; private revision = 0; private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: { id: string; stars: number; termsAccepted: true };
  constructor(parent: HTMLElement) {
    this.section.id = 'telegram-stars'; this.section.hidden = true;
    this.section.innerHTML = t(`<h3>Telegram Stars</h3><p>Оплати Stars в боте. Подтверждённый платёж пополнит денежный баланс в USDT.</p>
      <form id="stars-form"><label>Количество Stars<input id="stars-amount" type="number" min="100" max="10000" step="1" required value="100"></label>
      <p id="stars-rate"></p><label><input id="stars-terms" type="checkbox" required>Принимаю <a id="stars-terms-link" target="_blank" rel="noopener noreferrer">условия оплаты</a></label>
      <button id="stars-create" class="primary-button" type="submit">Создать счёт Stars</button></form>
      <p id="stars-message" role="status" aria-live="polite"></p><ol id="stars-history"></ol>`);
    parent.querySelector('#crypto-deposit-form')!.before(this.section);
    this.el<HTMLFormElement>('#stars-form').onsubmit = event => { event.preventDefault(); void this.create(); };
    this.el<HTMLInputElement>('#stars-amount').oninput = () => this.rate();
    window.addEventListener('royal-account', event => {
      this.close(); this.revision++; this.account = (event as CustomEvent<string | null>).detail;
      this.busy = false; this.snapshot = undefined; this.pending = undefined; this.section.hidden = true;
      this.el<HTMLFormElement>('#stars-form').reset(); this.el('#stars-history').replaceChildren(); this.el('#stars-message').textContent = '';
      if (this.account) try {
        const saved = JSON.parse(sessionStorage.getItem(this.key()) ?? 'null');
        if (saved && gameAccountId(saved.id) && Number.isInteger(saved.stars) && saved.stars >= 100 && saved.stars <= 10000 && saved.termsAccepted === true) this.pending = saved;
      } catch { /* The server history is still available without browser storage. */ }
    });
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string) { return this.section.querySelector<T>(selector)!; }
  private key() { return 'royal-stars-pending:' + this.account; }
  private async request(body?: unknown) {
    if (!this.account) throw new Error(t('Войди в аккаунт.'));
    const account = this.account, revision = this.revision;
    const response = await fetch('/api/crypto-wallet/stars', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { [WALLET_ACCOUNT_HEADER]: account, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const value = await response.json();
    if (revision !== this.revision) throw new Error(t('Аккаунт изменился. Проверь баланс после входа.'));
    if (!response.ok) throw new Error(typeof value.error === 'string' ? t(value.error) : t('Платёж Stars не подтверждён.'));
    return value;
  }
  private rate() {
    if (!this.snapshot?.enabled) return;
    const stars = this.el<HTMLInputElement>('#stars-amount').value;
    this.el('#stars-rate').textContent = /^\d{1,5}$/.test(stars)
      ? tr`${stars} Stars: ${formatNileUnits(String(BigInt(stars) * BigInt(this.snapshot.unitsPerStar)))} USDT на баланс` : '';
  }
  private async refresh() {
    const revision = this.revision;
    try {
      const value = await this.request();
      if (revision !== this.revision) return;
      if (value.enabled && (!/^[1-9]\d{0,6}$/.test(value.unitsPerStar) || !/^https:\/\//.test(value.termsUrl))) throw new Error();
      if (!Array.isArray(value.operations)) throw new Error();
      this.snapshot = value; this.section.hidden = !value.enabled && !value.operations.length;
      this.el<HTMLFormElement>('#stars-form').hidden = !value.enabled && !this.pending;
      this.el<HTMLAnchorElement>('#stars-terms-link').href = value.termsUrl || '#';
      this.rate(); this.el('#stars-history').replaceChildren();
      for (const order of value.operations as Order[]) {
        if (!gameAccountId(order.id) || !/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=pay_[a-f0-9-]{36}$/.test(order.botUrl)) continue;
        const item = document.createElement('li');
        const labels: Record<string, string> = { waiting: t('Ожидает оплаты'), checkout: t('Подтверждается'), paid: t('Зачислено'), refunded: t('Возврат Stars, требуется сверка') };
        item.textContent = `${order.stars} Stars · ${formatNileUnits(order.amountUnits)} USDT · ${labels[order.status] ?? order.status} `;
        if (order.status === 'waiting' && order.expiresAt > Date.now()) {
          const link = document.createElement('a'); link.href = order.botUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = t('Оплатить в Telegram'); item.append(link);
        }
        this.el('#stars-history').append(item);
      }
      this.el<HTMLButtonElement>('#stars-create').textContent = this.pending ? t('Проверить сохранённый платёж Stars') : t('Создать счёт Stars');
      void cryptoWallet.refresh();
    } catch { if (revision === this.revision && !this.section.hidden) this.el('#stars-message').textContent = t('Платёж Stars не подтверждён.'); }
  }
  private async create() {
    if (this.busy || !this.account) return;
    const revision = this.revision;
    this.busy = true; this.el<HTMLButtonElement>('#stars-create').disabled = true;
    try {
      if (!this.pending) {
        this.pending = { id: crypto.randomUUID(), stars: Number(this.el<HTMLInputElement>('#stars-amount').value), termsAccepted: true };
        // Persist before sending so a lost response retries the same order and amount.
        sessionStorage.setItem(this.key(), JSON.stringify(this.pending));
      }
      await this.request(this.pending);
      if (revision !== this.revision) return;
      sessionStorage.removeItem(this.key()); this.pending = undefined;
      this.el('#stars-message').textContent = t('Счёт создан. Открой ссылку «Оплатить в Telegram» ниже.');
      await this.refresh();
    } catch (error) { if (revision === this.revision) this.el('#stars-message').textContent = error instanceof Error ? error.message : t('Платёж Stars не подтверждён.'); }
    finally { if (revision === this.revision) { this.busy = false; this.el<HTMLButtonElement>('#stars-create').disabled = false; } }
  }
  open() { if (this.account) { void this.refresh(); clearInterval(this.timer); this.timer = setInterval(() => { void this.refresh(); }, 15000); } }
  close() { clearInterval(this.timer); }
}
