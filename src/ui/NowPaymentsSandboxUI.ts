import { t } from '../i18n/index';
import { demoWallet, coins } from '../wallet/WalletClient';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { validSandboxCase, type SandboxSnapshot, type SandboxCase } from '../shared/nowpaymentsSandbox';

type Pending = { id: string; amount: number; scenario: SandboxCase };
export class NowPaymentsSandboxUI {
  private section = document.createElement('section');
  private account: string | null = null;
  private epoch = 0;
  private snapshot?: SandboxSnapshot;
  private pending?: Pending;
  private busy = false;
  private message = '';
  private polling?: ReturnType<typeof setInterval>;
  constructor(private dialog: HTMLDialogElement) {
    this.section.id = 'nowpayments-sandbox'; this.section.hidden = true;
    this.section.innerHTML = `<h3>NOWPayments Sandbox</h3><p>${t('Тестовое пополнение общего баланса для игр Royal, ателье и поединков. Реальные деньги не используются, вывод недоступен.')}</p>
      <form id="sandbox-deposit"><label for="sandbox-amount">${t('Сумма тестового пополнения')}</label><input id="sandbox-amount" type="number" min="1" max="100000" step="1" value="1000" required>
      <label for="sandbox-case">${t('Сценарий платежа')}</label><select id="sandbox-case"><option value="success">${t('Успешный платёж')}</option><option value="partially_paid">${t('Частичная оплата')}</option><option value="failed">${t('Неудачный платёж')}</option></select>
      <button type="submit" class="primary-button">${t('Создать тестовый платёж')}</button></form>
      <p id="sandbox-message" role="status"></p><button type="button" id="sandbox-retry" class="text-button" hidden>${t('Проверить сохранённое пополнение')}</button>
      <button type="button" id="sandbox-refresh" class="text-button">${t('Проверить тестовые платежи')}</button><ol id="sandbox-history"></ol>
      <p class="wallet-note">${t('NOWPayments сам воспроизводит выбранный сценарий. После подтверждения средства поступят на виртуальный игровой баланс. Не отправляй криптовалюту на тестовые адреса.')}</p>`;
    const history = dialog.querySelector('#wallet-history')!;
    history.parentElement!.insertBefore(this.section, history.previousElementSibling);
    this.section.querySelector('form')!.onsubmit = event => { event.preventDefault(); void this.create(); };
    this.section.querySelector<HTMLButtonElement>('#sandbox-retry')!.onclick = () => { void this.create(); };
    this.section.querySelector<HTMLButtonElement>('#sandbox-refresh')!.onclick = () => { void this.refresh(true); };
    demoWallet.addEventListener('change', () => this.bind());
    dialog.addEventListener('close', () => clearInterval(this.polling));
    this.bind();
  }
  private key() { return 'royal-nowpayments-sandbox:' + this.account; }
  private bind() {
    if (this.account === demoWallet.accountId) return;
    this.account = demoWallet.accountId; this.epoch++; this.snapshot = undefined; this.pending = undefined; this.message = ''; this.busy = false;
    try {
      const raw = this.account && sessionStorage.getItem(this.key());
      if (raw) {
        const value = JSON.parse(raw);
        if (typeof value.id === 'string' && Number.isInteger(value.amount) && validSandboxCase(value.scenario)) this.pending = value;
      }
    } catch { this.message = t('Не удалось восстановить тестовое пополнение. Проверь историю перед новой попыткой.'); }
    this.render();
  }
  open() {
    this.bind(); void this.refresh(); clearInterval(this.polling);
    this.polling = setInterval(() => { if (this.dialog.open && this.snapshot?.enabled && !this.busy) void this.refresh(); }, 5000);
  }
  private async request(path = '', body?: unknown) {
    const account = this.account, epoch = this.epoch;
    if (!account) throw new Error(t('Войди в свой аккаунт.'));
    const response = await fetch('/api/nowpayments-sandbox' + path, { method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store', headers: { [WALLET_ACCOUNT_HEADER]: account, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (account !== this.account || epoch !== this.epoch) throw new Error(t('Аккаунт изменился. Проверь баланс после входа.'));
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : t('Sandbox не подтвердил ответ.'));
    return result;
  }
  private async refresh(verify = false) {
    if (!this.account || this.busy) return;
    const epoch = this.epoch; this.busy = true;
    try {
      const row: SandboxSnapshot = await this.request();
      if (verify && row.enabled) {
        for (const op of row.operations.slice(0, 5)) if (op.paymentId && !['finished', 'failed', 'expired', 'refunded', 'partially_paid'].includes(op.status)) {
          await this.request('/deposits/' + op.id + '/refresh', {});
        }
        this.snapshot = await this.request(); await demoWallet.refresh();
      } else { this.snapshot = row; if (row.enabled) await demoWallet.refresh(); }
      this.message = '';
    } catch (error) { if (epoch === this.epoch) this.message = (error as Error).message; }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  private async create() {
    if (!this.account || this.busy || !this.snapshot?.enabled) return;
    const epoch = this.epoch;
    this.message = '';
    try {
      const amount = this.section.querySelector<HTMLInputElement>('#sandbox-amount')!.valueAsNumber;
      const scenario = this.section.querySelector<HTMLSelectElement>('#sandbox-case')!.value;
      if (!this.pending && (!Number.isInteger(amount) || amount < 1 || amount > 100000 || !validSandboxCase(scenario))) throw new Error(t('Проверь сумму и сценарий тестового платежа.'));
      const pending = this.pending ?? { id: crypto.randomUUID(), amount, scenario: scenario as SandboxCase };
      sessionStorage.setItem(this.key(), JSON.stringify(pending)); this.pending = pending; this.busy = true; this.render();
      await this.request('/deposits', pending);
      sessionStorage.removeItem(this.key()); this.pending = undefined;
      this.snapshot = await this.request(); this.message = t('Тестовый платёж создан. Ожидаем подтверждение NOWPayments.');
    } catch (error) { if (epoch === this.epoch) this.message = (error as Error).message; }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  private render() {
    this.section.hidden = !this.account || !this.snapshot?.enabled;
    const disabled = this.dialog.querySelector<HTMLElement>('#sandbox-disabled-note');
    if (disabled) disabled.hidden = !this.account || this.snapshot?.enabled !== false;
    this.section.querySelector('#sandbox-message')!.textContent = this.message;
    this.section.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,select,button').forEach(el => { el.disabled = this.busy; });
    const retry = this.section.querySelector<HTMLButtonElement>('#sandbox-retry')!; retry.hidden = !this.pending;
    this.section.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = this.busy || !!this.pending;
    const history = this.section.querySelector('#sandbox-history')!; history.replaceChildren();
    const names: Record<string, string> = { creating: 'Создаётся', waiting: 'Ожидание', confirming: 'Подтверждается', confirmed: 'Подтверждён', sending: 'Зачисляется',
      finished: 'Завершён', partially_paid: 'Оплачен частично', failed: 'Неуспешен', expired: 'Истёк', refunded: 'Возвращён', review: 'Ожидает проверки', credit_pending: 'Ожидает места на игровом балансе' };
    if (this.snapshot?.enabled) for (const op of this.snapshot.operations) {
      const row = document.createElement('li'); row.dataset.sandboxId = op.id;
      row.textContent = `${t(names[op.status] ?? 'Ожидает проверки')} · ${coins(op.amount)} USDT · ${t('Зачислено')}: ${coins(op.creditedAmount)} · ${new Date(op.createdAt).toLocaleString()}`; history.append(row);
    }
  }
}
