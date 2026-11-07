import { t, tr } from '../i18n/index';
import { SKIN_UUID } from '../shared/skinStudio';
import type { ClubFineRequest, ClubFineResponse, ClubFineStatus, ClubSanction } from '../shared/security';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { coins, demoWallet } from '../wallet/WalletClient';
import type { PlayerControls } from './PlayerControls';
import './club-fine.css';

const fineUrl = '/api/demo-wallet/club-fine';
class FineRequestError extends Error {}
const paymentMessages = {
  paid: 'Штраф оплачен.',
  changed: 'Условия штрафа изменились. Проверь срок и сумму.',
  inactive: 'Нет активного штрафа для оплаты.',
  insufficient: 'На общем балансе недостаточно средств для оплаты штрафа.',
  'id-conflict': 'Этот номер оплаты уже использован. Начни новую оплату.',
};

function validRequest(value: unknown): value is ClubFineRequest {
  const request = value as ClubFineRequest | null;
  return !!request && typeof request.id === 'string' && SKIN_UUID.test(request.id)
    && typeof request.sanctionId === 'string' && SKIN_UUID.test(request.sanctionId)
    && Number.isSafeInteger(request.revision) && request.revision > 0
    && Number.isSafeInteger(request.amountCents) && request.amountCents > 0;
}

function validSnapshot(value: unknown): value is ClubFineStatus {
  const snapshot = value as ClubFineStatus | null;
  if (!snapshot || !Number.isSafeInteger(snapshot.serverNow)) return false;
  const sanction = snapshot.sanction;
  return sanction === null || (!!sanction && typeof sanction.id === 'string' && SKIN_UUID.test(sanction.id)
    && Number.isSafeInteger(sanction.until) && Number.isSafeInteger(sanction.revision) && sanction.revision > 0
    && Number.isSafeInteger(sanction.amountCents) && sanction.amountCents >= 0);
}

export class ClubFineUI {
  private readonly trigger = document.createElement('button');
  private readonly dialog = document.createElement('dialog');
  private readonly countdown: HTMLElement;
  private readonly quote: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pay: HTMLButtonElement;
  private accountId: string | null = null;
  private epoch = 0;
  private readVersion = 0;
  private sanction: ClubSanction | null = null;
  private pending?: ClubFineRequest;
  private clockOffset = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private paying = false;
  private message = '';

  constructor(scene: PlayerControls) {
    this.trigger.type = 'button'; this.trigger.id = 'club-fine-open'; this.trigger.className = 'primary-button club-fine-trigger';
    this.trigger.setAttribute('aria-haspopup', 'dialog'); this.trigger.setAttribute('aria-controls', 'club-fine-dialog');
    this.trigger.textContent = t('Штраф'); this.trigger.hidden = true;
    document.querySelector('.workspace')!.before(this.trigger);

    this.dialog.id = 'club-fine-dialog'; this.dialog.className = 'security-dialog';
    this.dialog.setAttribute('aria-labelledby', 'club-fine-title');
    this.dialog.innerHTML = t('<h2 id="club-fine-title">Клубный штраф</h2><p id="club-fine-countdown"></p><p id="club-fine-quote"></p><p id="club-fine-status" role="status"></p><button type="button" id="club-fine-pay" class="primary-button">Оплатить штраф</button><button type="button" id="club-fine-close" class="text-button" autofocus>Закрыть</button>');
    this.countdown = this.dialog.querySelector('#club-fine-countdown')!;
    this.quote = this.dialog.querySelector('#club-fine-quote')!;
    this.status = this.dialog.querySelector('#club-fine-status')!;
    this.pay = this.dialog.querySelector('#club-fine-pay')!;
    document.body.append(this.dialog);

    this.trigger.onclick = () => {
      if (this.dialog.open) return;
      scene.setLocked(true); this.dialog.showModal();
      this.render(); void this.refresh();
    };
    this.pay.onclick = () => { void this.submit(); };
    this.dialog.querySelector<HTMLButtonElement>('#club-fine-close')!.onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => {
      const anotherDialog = !!document.querySelector('dialog[open]');
      scene.setLocked(anotherDialog);
      this.render(); void this.refresh();
      if (!anotherDialog && document.activeElement === document.body && !this.trigger.hidden) this.trigger.focus({ preventScroll: true });
    });
    window.addEventListener('royal-account', event => this.bind((event as CustomEvent<string | null>).detail));
    window.addEventListener('royal-club-sanction', () => { void this.refresh(); });
    window.addEventListener('focus', () => { void this.refresh(); });
  }

  private storageKey() { return 'royal-club-fine:' + this.accountId; }

  private bind(accountId: string | null) {
    if (accountId === this.accountId) return;
    this.epoch++;
    this.accountId = accountId;
    this.sanction = null; this.pending = undefined; this.message = ''; this.paying = false;
    if (this.dialog.open) this.dialog.close();
    if (accountId) {
      try {
        const request: unknown = JSON.parse(sessionStorage.getItem(this.storageKey()) || 'null');
        if (validRequest(request)) {
          const { id, sanctionId, revision, amountCents } = request;
          this.pending = { id: id.toLowerCase(), sanctionId: sanctionId.toLowerCase(), revision, amountCents };
        }
      } catch { /* The current status can still load if session storage is unavailable. */ }
      void this.refresh();
    }
    this.render();
  }

  private async request(accountId: string, operation?: ClubFineRequest): Promise<unknown> {
    const response = await fetch(fineUrl, {
      method: operation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { [WALLET_ACCOUNT_HEADER]: accountId, ...(operation ? { 'Content-Type': 'application/json' } : {}) },
      body: operation ? JSON.stringify(operation) : undefined, signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    if (!response.ok) throw new FineRequestError(typeof value?.error === 'string' ? t(value.error) : '');
    return value;
  }

  private apply(snapshot: ClubFineStatus) {
    this.sanction = snapshot.sanction;
    this.clockOffset = snapshot.serverNow - Date.now();
  }

  private async refresh() {
    const accountId = this.accountId;
    if (!accountId || this.paying) return;
    const epoch = this.epoch, version = ++this.readVersion;
    const current = () => epoch === this.epoch && version === this.readVersion;
    try {
      const snapshot = await this.request(accountId);
      if (current() && validSnapshot(snapshot)) {
        // Let the server validate the price the player is seeing in the open dialog.
        const shown = this.sanction, next = snapshot.sanction;
        const quoteChanged = shown && next && (shown.id !== next.id || shown.revision !== next.revision || shown.amountCents !== next.amountCents);
        if (!this.dialog.open || !this.remaining() || !quoteChanged) this.apply(snapshot);
      }
    } catch { /* Keep the visible quote and any pending payment available for retry. */ }
    if (current()) this.render();
  }

  private remaining() { return Math.max(0, (this.sanction?.until ?? 0) - Date.now() - this.clockOffset); }

  private async submit() {
    const accountId = this.accountId, sanction = this.sanction;
    if (!accountId || this.paying) return;
    let operation = this.pending;
    if (!operation) {
      if (!sanction?.amountCents || !this.remaining()) return;
      operation = { id: crypto.randomUUID(), sanctionId: sanction.id, revision: sanction.revision, amountCents: sanction.amountCents };
      try { sessionStorage.setItem(this.storageKey(), JSON.stringify(operation)); }
      catch { this.message = t('Не удалось сохранить запрос на оплату штрафа.'); this.render(); return; }
      this.pending = operation;
    }
    const epoch = this.epoch;
    this.readVersion++;
    this.paying = true; this.message = ''; this.render();
    try {
      const result = await this.request(accountId, operation);
      if (epoch !== this.epoch) return;
      if (!validSnapshot(result)) throw new Error();
      const payment = result as ClubFineResponse;
      if (!Object.hasOwn(paymentMessages, payment.status)) throw new Error();
      if (payment.status === 'paid') {
        const receipt = payment.receipt;
        if (!validRequest(receipt) || !Number.isSafeInteger(receipt.paidAt) || receipt.id !== operation.id
          || receipt.sanctionId !== operation.sanctionId || receipt.revision !== operation.revision
          || receipt.amountCents !== operation.amountCents) throw new Error();
        void demoWallet.refresh();
      }
      this.apply(payment);
      this.pending = undefined;
      try { sessionStorage.removeItem(this.storageKey()); } catch { /* A restored operation can be safely replayed. */ }
      this.message = t(paymentMessages[payment.status]);
    } catch (error) {
      if (epoch === this.epoch) this.message = error instanceof FineRequestError && error.message
        ? error.message : t('Ответ по оплате штрафа не подтверждён. Повтори тот же запрос.');
    } finally {
      if (epoch === this.epoch) {
        this.paying = false;
        this.render(); void this.refresh();
      }
    }
  }

  private render() {
    clearTimeout(this.timer);
    const remaining = this.remaining(), sanction = remaining ? this.sanction : null;
    this.trigger.hidden = !this.accountId || !(sanction || this.pending);
    const seconds = Math.ceil(remaining / 1000);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.countdown.textContent = sanction ? tr`До окончания штрафа ${time}` : t('Активного штрафа нет.');
    this.quote.textContent = sanction?.amountCents ? tr`К оплате ${coins(sanction.amountCents / 100)} виртуальных USDT` : '';
    this.pay.hidden = !(this.pending || sanction?.amountCents);
    this.pay.disabled = this.paying;
    this.pay.textContent = this.pending ? tr`Повторить оплату ${coins(this.pending.amountCents / 100)} виртуальных USDT` : t('Оплатить штраф');
    const status = this.paying ? t('Подтверждаем оплату штрафа…') : this.message;
    if (this.status.textContent !== status) this.status.textContent = status;
    if (remaining) this.timer = setTimeout(() => this.render(), Math.min(remaining, this.dialog.open ? 1000 : 2_147_483_647));
  }
}
