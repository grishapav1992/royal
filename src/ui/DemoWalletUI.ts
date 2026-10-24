import { t as translateText, tr, locale } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import { demoWallet, coins } from '../wallet/WalletClient';
import {providerCoins} from '../shared/demoWallet';
import { NowPaymentsSandboxUI } from './NowPaymentsSandboxUI';
import '../wallet.css';

export class DemoWalletUI {
  private button = document.createElement('button');
  private dialog = document.createElement('dialog');
  private message = '';
  private sandbox: NowPaymentsSandboxUI;
  constructor(private scene: RoomScene) {
    this.button.type = 'button'; this.button.id = 'wallet-button'; this.button.className = 'wallet-button'; this.button.hidden = true;
    this.button.onclick = () => this.open();
    document.querySelector('.profile')!.prepend(this.button);
    this.dialog.id = 'wallet-dialog'; this.dialog.className = 'wallet-dialog';
    this.dialog.setAttribute('aria-labelledby', 'wallet-title');
    this.dialog.innerHTML = translateText(`<div class="wallet-heading"><div><span class="eyebrow">РОЯЛЬ · ДЕМО</span><h2 id="wallet-title">Мой кошелёк</h2></div><button class="icon-button" id="wallet-close" aria-label="Закрыть кошелёк">×</button></div>
      <p class="wallet-total"><strong id="wallet-balance">…</strong><span>виртуальных USDT</span></p>
      <p id="wallet-pending" class="wallet-note" role="status" hidden></p>
      <p class="wallet-description">Введи сумму и играй в автоматы клуба. Это бесплатные виртуальные USDT без реальных платежей и вывода.</p>
      <form id="wallet-deposit"><label for="wallet-amount">Сумма пополнения</label><div class="wallet-deposit-row"><input id="wallet-amount" type="number" inputmode="numeric" min="1" max="100000" step="1" value="1000" required><button class="primary-button" type="submit">Пополнить баланс</button></div></form>
      <p id="wallet-message" role="status" hidden></p><button id="wallet-retry" class="primary-button" hidden>Проверить операцию</button>
      <button id="wallet-refresh" class="text-button">Обновить баланс</button>
      <button id="wallet-provider-games" class="primary-button">Вернуться в зал</button>
      <h3>История операций</h3><ol id="wallet-history"></ol>
      <p class="wallet-note">Один виртуальный баланс для игр клуба. Сохранённые партии доступны после повторного входа.</p>`);
    document.body.append(this.dialog);
    this.sandbox = new NowPaymentsSandboxUI(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('#wallet-close')!.onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => scene.setLocked(!!document.querySelector('dialog[open]')));
    this.dialog.querySelector('form')!.onsubmit = event => {
      event.preventDefault(); const amount = this.dialog.querySelector<HTMLInputElement>('#wallet-amount')!.valueAsNumber;
      void this.perform(() => demoWallet.operate('deposit', amount));
    };
    this.dialog.querySelector<HTMLButtonElement>('#wallet-retry')!.onclick = () => {
      if (demoWallet.pending) void this.perform(() => demoWallet.retry());
    };
    this.dialog.querySelector<HTMLButtonElement>('#wallet-refresh')!.onclick = () => { void demoWallet.refresh(); };
    this.dialog.querySelector<HTMLButtonElement>('#wallet-provider-games')!.onclick = () => { this.dialog.close();  };
    demoWallet.addEventListener('change', () => this.render());
    window.addEventListener('royal-account', event => {
      demoWallet.setAccount((event as CustomEvent<string | null>).detail);
      if (!demoWallet.accountId) this.dialog.close();
    });
    window.addEventListener('royal-open-wallet', () => this.open());
    window.addEventListener('focus', () => { void demoWallet.refresh(); });
    this.render();
  }
  private open() {
    if (!demoWallet.accountId) return;
    this.message = ''; this.scene.setLocked(true); this.dialog.showModal(); this.render(); void demoWallet.refresh();
    this.sandbox.open();
  }
  private async perform(action: () => Promise<unknown>) {
    this.message = '';
    try { await action(); this.message = translateText('Баланс обновлён.'); } catch (error) { this.message = (error as Error).message; }
    this.render();
  }
  private render() {
    this.button.hidden = !demoWallet.accountId;
    this.button.textContent = tr`◈ ${demoWallet.wallet ? coins(demoWallet.wallet.balance) : '…'} USDT · Демо`;
    this.button.setAttribute('aria-label', translateText('Открыть демокошелёк'));
    this.dialog.querySelector('#wallet-balance')!.textContent = demoWallet.wallet ? coins(demoWallet.wallet.balance) : '…';
    const pending=this.dialog.querySelector<HTMLElement>('#wallet-pending')!,value=demoWallet.wallet?.pendingBalance;
    pending.hidden=!value||value==='0.00';
    pending.textContent=value?tr`Сохранённый выигрыш: ${providerCoins(value)} монет. Он автоматически поступит на доступный баланс, когда освободится место.`:'';
    const message = this.dialog.querySelector<HTMLElement>('#wallet-message')!;
    message.textContent = demoWallet.error || this.message || (demoWallet.pending ? translateText('Есть неподтверждённая операция. Проверь её перед новой ставкой или пополнением.') : '');
    message.hidden = !message.textContent;
    const retry = this.dialog.querySelector<HTMLButtonElement>('#wallet-retry')!;
    retry.hidden = !demoWallet.pending; retry.disabled = demoWallet.busy;
    this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#wallet-deposit input, #wallet-deposit button').forEach(el => { el.disabled = demoWallet.busy || !!demoWallet.pending; });
    const history = this.dialog.querySelector('#wallet-history')!; history.replaceChildren();
    for (const entry of demoWallet.wallet?.entries ?? []) {
      const row = document.createElement('li'); row.dataset.kind = entry.kind;
      const label = document.createElement('span');
      const action = { deposit: translateText('Демопополнение'), bet: translateText('ставка'), win: translateText('начисление'), refund: translateText('возврат ставки'), rollback: translateText('отмена операции') }[entry.kind];
      const gameName = (entry.gameName ? translateText(entry.gameName) : '') || (entry.source === 'casinoapipro' ? 'Casino Api Pro' : entry.source === 'royal-roulette' ? translateText('Рулетка') : 'Royal Coins');
      label.textContent = entry.kind === 'deposit' ? entry.source === 'nowpayments-sandbox' ? 'NOWPayments Sandbox' : action : `${gameName}: ${action}`;
      const amount = document.createElement('strong'); amount.textContent = `${entry.amount > 0 ? '+' : ''}${coins(entry.amount)}`;
      const detail = document.createElement('small'); detail.textContent = tr`${new Date(entry.createdAt).toLocaleString(locale)} · Остаток ${coins(entry.balance)}`;
      row.append(label, amount, detail); history.append(row);
    }
    if (!history.children.length) { const row = document.createElement('li'); row.textContent = translateText('Пока нет операций.'); history.append(row); }
  }
}
