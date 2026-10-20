import { t as translateText, tr, locale } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import { usdtWallet } from '../wallet/UsdtClient';
import { formatNileUnits } from '../shared/nileWallet';
import '../usdt-wallet.css';

export class UsdtWalletUI {
  private button = document.createElement('button');
  private dialog = document.createElement('dialog');
  private poll?: ReturnType<typeof setInterval>;
  constructor(private scene: RoomScene) {
    this.button.id = 'usdt-wallet-button'; this.button.type = 'button'; this.button.className = 'wallet-button'; this.button.hidden = true;
    this.button.textContent = translateText('Кошелек USDT'); this.button.onclick = () => this.show();
    document.querySelector('.profile')!.prepend(this.button);
    this.dialog.id = 'usdt-wallet-dialog'; this.dialog.className = 'wallet-dialog'; this.dialog.setAttribute('aria-labelledby', 'usdt-wallet-title');
    this.dialog.innerHTML = translateText(`<div class="wallet-heading"><div><span class="eyebrow">TRON MAINNET · TRC-20</span><h2 id="usdt-wallet-title">Мой баланс USDT</h2></div><button type="button" class="icon-button" id="usdt-wallet-close" aria-label="Закрыть кошелек USDT">×</button></div>
      <p class="wallet-description">Настоящий USDT. После подтверждения перевода баланс доступен для ставок в Hi-Lo и Dragon Tower.</p>
      <p id="usdt-wallet-message" role="status"></p><section id="usdt-wallet-content" hidden>
      <p class="wallet-total"><strong id="usdt-wallet-balance"></strong><span>USDT на игровом балансе</span></p>
      <label for="usdt-wallet-address">Кошелек сервиса для пополнения</label><input id="usdt-wallet-address" readonly autocomplete="off" spellcheck="false">
      <button type="button" id="usdt-wallet-copy" class="text-button">Скопировать адрес</button>
      <p class="wallet-note">Отправляй только USDT в основной сети TRON (TRC-20) с привязанного кошелька игрока. Комиссия сети оплачивается отдельно.</p>
      <label for="usdt-wallet-sender">Твой привязанный кошелек игрока</label><input id="usdt-wallet-sender" readonly autocomplete="off" spellcheck="false">
      <p id="usdt-wallet-updated" class="wallet-description"></p><h3>Подтвержденные пополнения</h3><ol id="usdt-wallet-history"></ol>
      <h3>Последние игры</h3><ol id="usdt-wallet-rounds"></ol></section>
      <p class="wallet-note">Вывод из личного кабинета пока не подключен.</p><button type="button" id="usdt-wallet-refresh" class="primary-button">Обновить баланс</button>`);
    document.body.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('#usdt-wallet-close')!.onclick = () => this.dialog.close();
    this.dialog.querySelector<HTMLButtonElement>('#usdt-wallet-refresh')!.onclick = () => { void usdtWallet.refresh(); };
    this.dialog.addEventListener('close', () => { clearInterval(this.poll); scene.setLocked(!!document.querySelector('dialog[open]')); });
    this.dialog.querySelector<HTMLButtonElement>('#usdt-wallet-copy')!.onclick = async () => {
      const row = usdtWallet.wallet, accountId = usdtWallet.accountId;
      if (row?.state !== 'assigned' || !row.ready) return;
      try { await navigator.clipboard.writeText(row.address); if (accountId === usdtWallet.accountId) this.message(translateText('Адрес скопирован. Сеть: TRON (TRC-20).')); }
      catch { if (accountId === usdtWallet.accountId) this.message(translateText('Скопируй адрес из поля вручную.')); }
    };
    usdtWallet.addEventListener('change', () => this.render());
    window.addEventListener('royal-account', event => { this.dialog.close(); usdtWallet.setAccount((event as CustomEvent<string | null>).detail); this.render(); });
    window.addEventListener('royal-open-usdt-wallet', () => this.show());
    window.addEventListener('focus', () => { void usdtWallet.refresh(); });
  }
  private message(value: string) { this.dialog.querySelector('#usdt-wallet-message')!.textContent = value; }
  private show() {
    if (!usdtWallet.accountId) return;
    this.scene.setLocked(true); if (!this.dialog.open) this.dialog.showModal();
    clearInterval(this.poll); this.poll = setInterval(() => { if (!usdtWallet.busy) void usdtWallet.refresh(); }, 10000);
    void usdtWallet.refresh();
  }
  private render() {
    const wallet = usdtWallet.wallet;
    this.button.hidden = wallet?.state !== 'assigned' && !usdtWallet.pending;
    this.button.textContent = wallet?.state === 'assigned' && wallet.ready ? formatNileUnits(wallet.balanceUnits) + ' USDT' : translateText('Кошелек USDT');
    const ready = wallet?.state === 'assigned' && wallet.ready;
    this.dialog.querySelector<HTMLElement>('#usdt-wallet-content')!.hidden = !ready;
    this.dialog.querySelector<HTMLInputElement>('#usdt-wallet-address')!.value = ready ? wallet.address : '';
    this.dialog.querySelector<HTMLInputElement>('#usdt-wallet-sender')!.value = ready ? wallet.senderAddress : '';
    this.dialog.querySelector('#usdt-wallet-balance')!.textContent = ready ? formatNileUnits(wallet.balanceUnits) : '';
    const deposits = this.dialog.querySelector('#usdt-wallet-history')!, rounds = this.dialog.querySelector('#usdt-wallet-rounds')!;
    deposits.replaceChildren(); rounds.replaceChildren();
    if (!ready) { this.message(usdtWallet.error || (wallet?.state === 'assigned' ? translateText('Подтверждение баланса временно недоступно. Обнови его позже.') : translateText('Кошелек USDT для этого аккаунта пока не подключен.'))); return; }
    this.dialog.querySelector('#usdt-wallet-updated')!.textContent = translateText('Подтверждено: ') + new Date(wallet.updatedAt).toLocaleString(locale);
    for (const d of wallet.deposits) {
      const li = document.createElement('li'), amount = document.createElement('strong'), link = document.createElement('a');
      amount.textContent = '+' + formatNileUnits(d.amountUnits) + ' USDT'; link.textContent = translateText('Перевод в TRONSCAN');
      link.href = 'https://tronscan.org/#/transaction/' + d.txId; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(amount, link); deposits.append(li);
    }
    for (const round of wallet.casinoRounds ?? []) {
      const li = document.createElement('li');
      li.textContent = tr`${round.gameId === 'github-hilo' ? 'Hi-Lo' : 'Dragon Tower'}: ставка ${formatNileUnits(round.stakeUnits)}, начислено ${formatNileUnits(round.payoutUnits)} USDT`;
      rounds.append(li);
    }
    for (const round of wallet.rounds) {
      const li = document.createElement('li'); li.textContent = tr`${round.gameId === 'royal-coins' ? 'Royal Coins' : translateText('Рулетка')}: ставка ${formatNileUnits(round.stakeUnits)}, начислено ${formatNileUnits(round.payoutUnits)} USDT`; rounds.append(li);
    }
    if (!wallet.deposits.length) { const li = document.createElement('li'); li.textContent = translateText('Пополнений пока нет.'); deposits.append(li); }
    this.message(translateText('Баланс подтвержден. Переводы зачисляются автоматически.'));
  }
}
