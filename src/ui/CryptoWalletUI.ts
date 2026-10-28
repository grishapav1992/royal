import { t as translateText, tr, locale } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import { cryptoWallet } from '../wallet/CryptoClient';
import { usdtUnits, type CryptoQuote, type CryptoCurrency, type CryptoOperation } from '../shared/cryptoWallet';
import { formatNileUnits } from '../shared/nileWallet';
import { paymentQr } from '../wallet/paymentQr';
import { DISPLAY_FIAT_CURRENCIES, fiatEquivalent, validDisplayCurrency, validDisplayRate, type CryptoDisplayRate } from '../shared/cryptoDisplay';
import '../crypto-wallet.css';
import { TelegramStarsUI } from './TelegramStarsUI';

const states: Record<string, string> = { creating: translateText('Подготовка'), waiting: translateText('Ожидает перевода'), confirming: translateText('Подтверждается в сети'),
  confirmed: translateText('Обменивается'), sending: translateText('Отправляется'), finished: translateText('Завершено'), partially_paid: translateText('Получена неполная сумма'),
  expired: translateText('Срок платежа истек'), refunded: translateText('Средства возвращены'), failed: translateText('Требуется проверка'), rejected: translateText('Отклонено'), review: translateText('Требуется проверка сервиса'),
  queued: translateText('Вывод принят'), preparing: translateText('Подготовка вывода'), conversion_sending: translateText('Обмен'), converting: translateText('Обмен'), converted: translateText('Обмен завершен'),
  payout_preparing: translateText('Подготовка выплаты'), payout_sending: translateText('Отправка выплаты'), verifying: translateText('Подтверждение выплаты'), processing: translateText('Обрабатывается') };
export class CryptoWalletUI {
  private stars: TelegramStarsUI;
  private button = document.createElement('button'); private dialog = document.createElement('dialog');
  private paymentDialog = document.createElement('dialog'); private payment?: CryptoOperation;
  private displayCurrency = 'USDT'; private displayRate?: CryptoDisplayRate; private rateRevision = 0; private rateLoading = false; private rateError = '';
  private poll?: ReturnType<typeof setInterval>; private quote?: CryptoQuote; private loadingCurrencies?: Promise<void>; private currencyAccount = '';
  private working = false;
  private currencies: CryptoCurrency[] = [];
  private qrAddress = '';
  constructor(private scene: RoomScene) {
    this.button.id = 'crypto-wallet-button'; this.button.type = 'button'; this.button.className = 'wallet-button'; this.button.hidden = true;
    this.button.textContent = translateText('Денежный баланс'); this.button.onclick = () => this.show(); document.querySelector('.profile')!.prepend(this.button);
    this.dialog.id = 'crypto-wallet-dialog'; this.dialog.className = 'wallet-dialog crypto-wallet'; this.dialog.setAttribute('aria-labelledby', 'crypto-wallet-title');
    this.dialog.innerHTML = translateText(`<div class="wallet-heading"><div><span class="eyebrow">РОЯЛЬ · ПОПОЛНЕНИЕ</span><h2 id="crypto-wallet-title">Денежный баланс</h2></div><button type="button" class="icon-button" id="crypto-wallet-close" aria-label="Закрыть пополнение баланса">×</button></div>
      <p class="wallet-description">Реальные средства. Этот баланс хранится отдельно от тестового баланса клуба. Ставки на реальные средства пока недоступны.</p>
      <p id="crypto-wallet-message" role="status" aria-live="polite"></p>
      <section id="crypto-wallet-summary" hidden><p class="wallet-total"><strong id="crypto-wallet-balance"></strong><span id="crypto-wallet-balance-unit">USDT доступно</span></p><p id="crypto-wallet-usdt" hidden></p><p id="crypto-wallet-reserved"></p></section>
      <label>Валюта отображения<select id="crypto-display-currency"><option value="USDT">USDT</option></select></label>
      <p id="crypto-display-rate-note" class="wallet-note" role="status"></p><button type="button" id="crypto-display-rate-refresh" class="text-button" hidden>Обновить курс</button>
      <form id="crypto-deposit-form"><p class="wallet-note">Выбери сумму, монету и сеть. Нажми «Оплатить», чтобы открыть реквизиты и QR-код поверх игры.</p>
      <p class="wallet-note">Оплатить можно из кошелька в Telegram, другого криптокошелька или с биржи, если они поддерживают выбранную монету и сеть.</p>
      <fieldset id="crypto-deposit-fields" disabled><label>Сумма пополнения в USDT<input id="crypto-deposit-amount" inputmode="decimal" autocomplete="off" required value="20"></label>
      <p id="crypto-deposit-equivalent" class="wallet-note" hidden></p>
      <label>Валюта и сеть оплаты<select id="crypto-deposit-currency" required><option value="">Доступны после подключения сервиса</option></select></label><button type="submit" class="primary-button">Оплатить</button></fieldset>
      <p class="wallet-note">Средства обмениваются в USDT. Зачисляется фактически полученная сумма после комиссий. Отправляй только выбранную монету в указанной сети.</p></form>
      <div id="crypto-deposit-qr-placeholder" class="crypto-qr-placeholder"><strong>QR-код для оплаты</strong><span>Появится после создания платежа</span></div>
      <button type="button" id="crypto-deposit-continue" class="primary-button" hidden>Продолжить оплату</button>
      <section id="crypto-deposit-details" hidden><h3>Реквизиты созданного платежа</h3><p id="crypto-deposit-info"></p><p id="crypto-deposit-network" class="crypto-payment-network"></p>
      <figure class="crypto-payment-qr"><img id="crypto-deposit-qr" width="240" height="240" alt="QR-код адреса для пополнения" hidden><figcaption id="crypto-deposit-qr-note">QR-код содержит только адрес. Сумму и сеть проверь в кошельке перед переводом.</figcaption></figure>
      <label>Адрес для этого платежа<input id="crypto-deposit-address" readonly spellcheck="false"></label><button id="crypto-deposit-copy" type="button" class="text-button">Скопировать адрес</button>
      <div id="crypto-deposit-memo" class="crypto-payment-memo" hidden><label>Обязательный memo или тег<input id="crypto-deposit-memo-value" readonly spellcheck="false"></label><button id="crypto-deposit-memo-copy" type="button" class="text-button">Скопировать memo</button><p>Укажи этот memo в кошельке отдельно. Без него перевод может не зачислиться.</p></div>
      <p class="wallet-note">Эти реквизиты относятся к созданному платежу. Для другой валюты или сети создай новый платеж.</p></section>
      <section id="crypto-wallet-content" hidden>
      <form id="crypto-withdraw-form"><h3>Вывести</h3><label>Списать USDT<input id="crypto-withdraw-amount" inputmode="decimal" autocomplete="off" required value="10"></label>
      <label>Валюта и сеть вывода<select id="crypto-withdraw-currency" required></select></label><label>Адрес получателя<input id="crypto-withdraw-address" required autocomplete="off" spellcheck="false" maxlength="200"></label>
      <label>Memo или тег назначения, если нужен<input id="crypto-withdraw-memo" autocomplete="off" spellcheck="false" maxlength="128"></label><button type="submit" class="primary-button">Рассчитать вывод</button></form>
      <section id="crypto-withdraw-preview" hidden><p id="crypto-withdraw-calculation"></p><p class="wallet-note">Курс и сетевая комиссия могут измениться. При ухудшении расчета ниже указанного минимума вывод останется на проверке. Резерв комиссии остается у сервиса.</p>
      <button id="crypto-withdraw-confirm" type="button" class="primary-button">Подтвердить вывод</button></section><h3>История операций</h3><ol id="crypto-wallet-history"></ol></section>
      <button id="crypto-wallet-retry" type="button" class="primary-button" hidden>Проверить отправленную операцию</button><button id="crypto-wallet-refresh" type="button" class="text-button">Обновить баланс</button>`);
    this.paymentDialog.id = 'crypto-payment-dialog'; this.paymentDialog.className = 'wallet-dialog crypto-wallet crypto-payment';
    this.paymentDialog.setAttribute('aria-labelledby', 'crypto-payment-title');
    this.paymentDialog.innerHTML = translateText(`<div class="wallet-heading"><div><span class="eyebrow">РОЯЛЬ · ПОПОЛНЕНИЕ</span><h2 id="crypto-payment-title">Оплата</h2></div><button type="button" class="icon-button" id="crypto-payment-close" aria-label="Закрыть оплату">×</button></div>
      <p id="crypto-payment-message" role="status" aria-live="polite"></p><p id="crypto-payment-feedback" role="status" aria-live="polite"></p><p id="crypto-payment-result" class="crypto-payment-result" hidden></p><button type="button" id="crypto-payment-refresh" class="text-button">Проверить оплату</button>`);
    this.paymentDialog.append(this.el('#crypto-deposit-details'));
    const returnButton = document.createElement('button'); returnButton.type = 'button'; returnButton.className = 'text-button'; returnButton.textContent = translateText('Вернуться к балансу');
    returnButton.onclick = () => this.paymentDialog.close(); this.paymentDialog.append(returnButton);
    document.body.append(this.dialog, this.paymentDialog);
    this.stars = new TelegramStarsUI(this.dialog);
    this.dialog.addEventListener('close', () => this.stars.close());
    this.el<HTMLButtonElement>('#crypto-payment-close').onclick = () => this.paymentDialog.close();
    this.el<HTMLButtonElement>('#crypto-payment-refresh').onclick = () => { void cryptoWallet.refresh(); };
    this.el<HTMLButtonElement>('#crypto-deposit-continue').onclick = () => this.showPayment();
    const displaySelect = this.el<HTMLSelectElement>('#crypto-display-currency');
    for (const [code, label] of Object.entries(DISPLAY_FIAT_CURRENCIES)) displaySelect.append(new Option(`${code} · ${label}`, code));
    displaySelect.onchange = () => { this.displayCurrency = displaySelect.value; void this.loadDisplayRate(); };
    this.el<HTMLButtonElement>('#crypto-display-rate-refresh').onclick = () => { void this.loadDisplayRate(); };
    this.el<HTMLInputElement>('#crypto-deposit-amount').oninput = () => this.renderDisplay();
    this.el<HTMLButtonElement>('#crypto-wallet-close').onclick = () => this.dialog.close();
    this.el<HTMLButtonElement>('#crypto-wallet-refresh').onclick = () => { void cryptoWallet.refresh(); };
    this.el<HTMLButtonElement>('#crypto-wallet-retry').onclick = () => { void this.run(async () => {
      const op = await cryptoWallet.retryTransfer(); this.message(translateText('Операция проверена. Смотри историю.'));
      if (op?.kind === 'deposit' && op.address && !['review', 'failed', 'expired', 'rejected', 'finished', 'refunded'].includes(op.state)) this.showPayment(op);
    }); };
    this.el<HTMLFormElement>('#crypto-deposit-form').onsubmit = event => { event.preventDefault(); void this.run(async () => {
      if (cryptoWallet.wallet?.state !== 'enabled') throw new Error(translateText('Создание платежа станет доступно после подключения сервиса.'));
      const op = await cryptoWallet.send('deposits', { id: crypto.randomUUID(), amountUnits: usdtUnits(this.el<HTMLInputElement>('#crypto-deposit-amount').value.trim().replace(',', '.')), currency: this.el<HTMLSelectElement>('#crypto-deposit-currency').value });
      this.message(states[op.state] ?? translateText('Платеж подготовлен.'));
      if (op.address && !['review', 'failed', 'expired', 'rejected', 'finished', 'refunded'].includes(op.state)) this.showPayment(op);
    }); };
    this.el<HTMLFormElement>('#crypto-withdraw-form').oninput = () => { this.quote = undefined; this.el<HTMLElement>('#crypto-withdraw-preview').hidden = true; };
    this.el<HTMLFormElement>('#crypto-withdraw-form').onsubmit = event => { event.preventDefault(); void this.run(async () => {
      const quote = await cryptoWallet.quote({ id: crypto.randomUUID(), amountUnits: usdtUnits(this.el<HTMLInputElement>('#crypto-withdraw-amount').value.trim().replace(',', '.')),
        currency: this.el<HTMLSelectElement>('#crypto-withdraw-currency').value, address: this.el<HTMLInputElement>('#crypto-withdraw-address').value.trim(), memo: this.el<HTMLInputElement>('#crypto-withdraw-memo').value.trim() });
      this.quote = quote; this.el<HTMLElement>('#crypto-withdraw-preview').hidden = false;
      this.el('#crypto-withdraw-calculation').textContent = tr`Списать ${formatNileUnits(quote.amountUnits)} USDT. Примерно ${quote.estimatedAmount} ${quote.currency.toUpperCase()} до комиссий. Сетевая комиссия примерно ${quote.networkFee}. Резерв: две расчетные сетевые комиссии. Минимум к отправке: ${quote.minimumReceive}. Адрес: ${quote.address}${quote.memo ? ', memo: ' + quote.memo : ''}. Расчет действует две минуты.`;
    }); };
    this.el<HTMLButtonElement>('#crypto-withdraw-confirm').onclick = () => { void this.run(async () => {
      if (!this.quote || Date.now() >= this.quote.expiresAt) throw new Error(translateText('Расчет устарел. Рассчитай вывод еще раз.'));
      const op = await cryptoWallet.send('withdrawals', { id: crypto.randomUUID(), quoteId: this.quote.id });
      this.quote = undefined; this.el<HTMLElement>('#crypto-withdraw-preview').hidden = true; this.message(states[op.state] ?? translateText('Вывод принят.'));
    }); };
    this.el<HTMLButtonElement>('#crypto-deposit-copy').onclick = () => { void this.copyPaymentValue('#crypto-deposit-address',
      translateText('Адрес скопирован. Проверь валюту и сеть перед переводом.'), translateText('Скопируй адрес из поля вручную.')); };
    this.el<HTMLButtonElement>('#crypto-deposit-memo-copy').onclick = () => { void this.copyPaymentValue('#crypto-deposit-memo-value',
      translateText('Memo скопирован. Укажи его в кошельке вместе с адресом.'), translateText('Скопируй memo из поля вручную.')); };
    this.dialog.addEventListener('close', () => { clearInterval(this.poll); scene.setLocked(!!document.querySelector('dialog[open]')); });
    cryptoWallet.addEventListener('change', () => this.render());
    window.addEventListener('royal-account', event => {
      this.paymentDialog.close(); this.dialog.close(); this.payment = undefined; this.quote = undefined; this.currencyAccount = ''; this.loadingCurrencies = undefined; this.working = false;
      this.rateRevision++; this.displayCurrency = 'USDT'; this.displayRate = undefined; this.rateLoading = false; this.rateError = '';
      this.el<HTMLSelectElement>('#crypto-display-currency').value = 'USDT';
      this.currencies = []; this.clearDeposit(); this.el<HTMLFormElement>('#crypto-deposit-form').reset();
      this.el<HTMLSelectElement>('#crypto-deposit-currency').replaceChildren(new Option(translateText('Доступны после подключения сервиса'), ''));
      this.el<HTMLFormElement>('#crypto-withdraw-form').reset(); this.el<HTMLElement>('#crypto-withdraw-preview').hidden = true;
      cryptoWallet.setAccount((event as CustomEvent<string | null>).detail); this.render();
    });
    window.addEventListener('royal-open-crypto-wallet', () => this.show());
    this.paymentDialog.addEventListener('close', () => { scene.setLocked(!!document.querySelector('dialog[open]')); this.render(); });
  }
  private el<T extends Element = HTMLElement>(selector: string) { return (this.dialog.querySelector<T>(selector) ?? this.paymentDialog.querySelector<T>(selector))!; }
  private message(text: string) { this.el('#crypto-wallet-message').textContent = text; }
  private async copyPaymentValue(selector: string, success: string, failure: string) {
    const paymentId = this.payment?.id, account = cryptoWallet.accountId;
    let message = success;
    try { await navigator.clipboard.writeText(this.el<HTMLInputElement>(selector).value); }
    catch { message = failure; }
    if (account === cryptoWallet.accountId && paymentId === this.payment?.id && this.paymentDialog.open
      && !this.el<HTMLElement>('#crypto-deposit-details').hidden) this.el('#crypto-payment-feedback').textContent = message;
  }
  private async run(fn: () => Promise<void>) {
    if (this.working) return;
    this.working = true;
    const account = cryptoWallet.accountId;
    this.dialog.querySelectorAll<HTMLButtonElement>('form button,#crypto-withdraw-confirm').forEach(button => { button.disabled = true; });
    try { await fn(); } catch (error) { if (account === cryptoWallet.accountId) this.message(error instanceof Error ? translateText(error.message) : translateText('Операция не подтверждена.')); }
    finally { if (account === cryptoWallet.accountId) { this.working = false; this.render(); } }
  }
  private show() {
    if (!cryptoWallet.accountId) return;
    this.scene.setLocked(true); if (!this.dialog.open) this.dialog.showModal();
    this.stars.open();
    clearInterval(this.poll); this.poll = setInterval(() => {
      void cryptoWallet.refresh();
      if (this.displayRate && !validDisplayRate(this.displayRate) && !this.rateLoading) void this.loadDisplayRate();
    }, 15000); void cryptoWallet.refresh(); this.render();
    if (this.displayRate && !validDisplayRate(this.displayRate) && !this.rateLoading) void this.loadDisplayRate();
  }
  private showPayment(operation?: CryptoOperation) {
    const wallet = cryptoWallet.wallet;
    const deposit = operation ?? (wallet?.state === 'enabled' ? this.pendingDeposit(wallet.operations) : undefined);
    if (!deposit) return;
    this.payment = deposit; this.el('#crypto-payment-feedback').textContent = ''; this.renderDeposit(deposit); this.scene.setLocked(true);
    if (!this.paymentDialog.open) this.paymentDialog.showModal();
  }
  private pendingDeposit(operations: CryptoOperation[]) {
    const payable = (op: CryptoOperation) => op.kind === 'deposit' && op.address && !['finished', 'expired', 'failed', 'refunded', 'rejected', 'review'].includes(op.state);
    return this.payment && payable(this.payment) ? this.payment : operations.find(payable);
  }
  private async loadDisplayRate() {
    const revision = ++this.rateRevision, currency = this.displayCurrency, account = cryptoWallet.accountId;
    this.displayRate = undefined; this.rateError = ''; this.rateLoading = currency !== 'USDT'; this.renderDisplay();
    if (!validDisplayCurrency(currency)) { this.rateLoading = false; this.renderDisplay(); return; }
    try {
      const rate = await cryptoWallet.displayRate(currency);
      if (revision === this.rateRevision && account === cryptoWallet.accountId) this.displayRate = rate;
    } catch { if (revision === this.rateRevision && account === cryptoWallet.accountId) this.rateError = translateText('Курс сейчас недоступен. Суммы показаны в USDT. Попробуй обновить курс позже.'); }
    finally { if (revision === this.rateRevision && account === cryptoWallet.accountId) { this.rateLoading = false; this.renderDisplay(); } }
  }
  private renderDisplay() {
    const wallet = cryptoWallet.wallet, rate = this.displayRate;
    const usable = !!rate && rate.currency === this.displayCurrency && validDisplayRate(rate);
    this.el<HTMLSelectElement>('#crypto-display-currency').disabled = wallet?.state !== 'enabled' || wallet.cryptoDepositsEnabled === false;
    this.el<HTMLElement>('#crypto-wallet-usdt').hidden = !usable;
    if (wallet?.state === 'enabled') {
      this.el('#crypto-wallet-balance').textContent = usable ? '≈ ' + fiatEquivalent(wallet.balanceUnits, rate.usdtRate) : formatNileUnits(wallet.balanceUnits);
      this.el('#crypto-wallet-balance-unit').textContent = (usable ? rate.currency : 'USDT') + translateText(' доступно');
      this.el('#crypto-wallet-usdt').textContent = translateText('Баланс в USDT: ') + formatNileUnits(wallet.balanceUnits);
    }
    const equivalent = this.el<HTMLElement>('#crypto-deposit-equivalent'); equivalent.hidden = true;
    if (usable) {
      try { equivalent.textContent = '≈ ' + fiatEquivalent(usdtUnits(this.el<HTMLInputElement>('#crypto-deposit-amount').value.trim().replace(',', '.')), rate.usdtRate) + ' ' + rate.currency + translateText(' до комиссий'); equivalent.hidden = false; } catch { /* The amount is validated again when the user pays. */ }
    }
    const note = this.el('#crypto-display-rate-note');
    note.textContent = wallet?.state === 'enabled' && wallet.cryptoDepositsEnabled === false ? translateText('Баланс хранится в USDT.')
      : this.displayCurrency === 'USDT' ? translateText('Баланс хранится в USDT. Можно выбрать валюту страны для отображения примерного эквивалента.')
      : this.rateLoading ? translateText('Получаем курс…') : usable ? tr`1 USDT ≈ ${rate.usdtRate} ${rate.currency}. Расчет NOWPayments на ${new Date(rate.updatedAt).toLocaleTimeString(locale)}. Эквивалент меняется с курсом; баланс хранится в USDT.`
        : this.rateError || translateText('Курс устарел. Обнови его, чтобы увидеть эквивалент. Суммы показаны в USDT.');
    this.el<HTMLButtonElement>('#crypto-display-rate-refresh').hidden = this.displayCurrency === 'USDT' || wallet?.state !== 'enabled';
    this.el<HTMLButtonElement>('#crypto-display-rate-refresh').disabled = this.rateLoading;
  }
  private loadCurrencies() {
    if (this.loadingCurrencies || this.currencyAccount === cryptoWallet.accountId || !this.dialog.open) return;
    const account = cryptoWallet.accountId;
    this.loadingCurrencies = cryptoWallet.currencies().then(coins => {
      if (account !== cryptoWallet.accountId || cryptoWallet.wallet?.state !== 'enabled' || cryptoWallet.wallet.cryptoDepositsEnabled === false) return;
      this.currencies = coins;
      for (const selector of ['#crypto-deposit-currency', '#crypto-withdraw-currency']) {
        const select = this.el<HTMLSelectElement>(selector); select.replaceChildren();
        for (const coin of coins) { const option = document.createElement('option'); option.value = coin.code; option.textContent = `${coin.name} (${coin.code.toUpperCase()}) · ${coin.network.toUpperCase()}${coin.memo ? translateText(' · нужен memo') : ''}`; select.append(option); }
        if (coins.some(coin => coin.code === 'usdttrc20')) select.value = 'usdttrc20';
      }
      this.currencyAccount = account ?? '';
      this.render();
    }).catch(() => { if (account === cryptoWallet.accountId && cryptoWallet.wallet?.state === 'enabled' && cryptoWallet.wallet.cryptoDepositsEnabled !== false)
      this.message(translateText('Список валют временно недоступен. Обнови баланс позже.')); })
      .finally(() => { if (account === cryptoWallet.accountId) this.loadingCurrencies = undefined; });
  }
  private clearDeposit() {
    this.el('#crypto-payment-feedback').textContent = '';
    this.qrAddress = ''; this.el<HTMLImageElement>('#crypto-deposit-qr').removeAttribute('src'); this.el<HTMLElement>('#crypto-deposit-qr').hidden = true;
    this.el<HTMLElement>('#crypto-deposit-details').hidden = true;
    this.el<HTMLElement>('#crypto-deposit-qr-placeholder').hidden = cryptoWallet.wallet?.state === 'enabled' && cryptoWallet.wallet.cryptoDepositsEnabled === false;
    this.el<HTMLInputElement>('#crypto-deposit-address').value = ''; this.el<HTMLInputElement>('#crypto-deposit-memo-value').value = '';
    this.el<HTMLElement>('#crypto-deposit-memo').hidden = true; this.el('#crypto-deposit-info').textContent = ''; this.el('#crypto-deposit-network').textContent = '';
    this.el<HTMLElement>('#crypto-payment-result').hidden = true;
    this.el<HTMLButtonElement>('#crypto-deposit-continue').hidden = true;
  }
  private renderDeposit(deposit?: CryptoOperation) {
    if (!deposit) { this.clearDeposit(); return; }
    this.el('#crypto-payment-message').textContent = states[deposit.state] ?? translateText('Проверяется');
    this.el<HTMLElement>('#crypto-payment-result').hidden = true;
    this.el<HTMLElement>('#crypto-deposit-details').hidden = false; this.el<HTMLElement>('#crypto-deposit-qr-placeholder').hidden = true;
    this.el<HTMLInputElement>('#crypto-deposit-address').value = deposit.address;
    this.el<HTMLButtonElement>('#crypto-deposit-continue').hidden = false;
    this.el('#crypto-deposit-info').textContent = tr`Отправь ${deposit.payAmount} ${deposit.currency.toUpperCase()}. ${states[deposit.state] ?? translateText('Проверяется')}.`;
    const coin = this.currencies.find(coin => coin.code === deposit.currency);
    this.el('#crypto-deposit-network').textContent = coin ? tr`Валюта: ${coin.name} (${coin.code.toUpperCase()}). Сеть: ${coin.network.toUpperCase()}.` : tr`Направление платежа: ${deposit.currency.toUpperCase()}.`;
    this.el<HTMLElement>('#crypto-deposit-memo').hidden = !deposit.memo;
    this.el<HTMLInputElement>('#crypto-deposit-memo-value').value = deposit.memo;
    this.el('#crypto-deposit-qr-note').textContent = deposit.memo
      ? translateText('QR-код содержит только адрес. Сумму и сеть проверь в кошельке, обязательный memo укажи отдельно.')
      : translateText('QR-код содержит только адрес. Сумму и сеть проверь в кошельке перед переводом.');
    if (this.qrAddress !== deposit.address) {
      const image = this.el<HTMLImageElement>('#crypto-deposit-qr'); image.hidden = true; image.removeAttribute('src');
      try { image.src = paymentQr(deposit.address); image.hidden = false; this.qrAddress = deposit.address; }
      catch { this.qrAddress = ''; this.el('#crypto-deposit-qr-note').textContent = translateText('QR-код недоступен. Скопируй адрес из поля ниже и проверь реквизиты.'); }
    }
  }
  private render() {
    const wallet = cryptoWallet.wallet;
    const cryptoEnabled = wallet?.state === 'enabled' && wallet.cryptoDepositsEnabled !== false;
    this.el<HTMLFormElement>('#crypto-deposit-form').hidden = wallet?.state === 'enabled' && !cryptoEnabled;
    this.el<HTMLElement>('#crypto-deposit-qr-placeholder').hidden = wallet?.state === 'enabled' && !cryptoEnabled;
    if (wallet?.state === 'enabled' && !cryptoEnabled) {
      this.currencies = []; this.currencyAccount = '';
      if (!cryptoWallet.transfer && !cryptoWallet.pending) this.message(cryptoWallet.error);
      if (this.displayCurrency !== 'USDT') {
        this.rateRevision++; this.displayCurrency = 'USDT'; this.displayRate = undefined; this.rateLoading = false; this.rateError = '';
        this.el<HTMLSelectElement>('#crypto-display-currency').value = 'USDT';
      }
    }
    this.button.hidden = !cryptoWallet.accountId;
    this.button.textContent = translateText('Денежный баланс');
    this.el<HTMLElement>('#crypto-wallet-content').hidden = wallet?.state !== 'enabled';
    this.el<HTMLElement>('#crypto-wallet-summary').hidden = wallet?.state !== 'enabled';
    this.el<HTMLFieldSetElement>('#crypto-deposit-fields').disabled = !cryptoEnabled || !this.currencies.length || this.working || cryptoWallet.busy || !!cryptoWallet.transfer || !!cryptoWallet.pending;
    this.el<HTMLButtonElement>('#crypto-wallet-retry').hidden = !cryptoWallet.transfer;
    this.el<HTMLButtonElement>('#crypto-wallet-retry').disabled = cryptoWallet.busy;
    this.dialog.querySelectorAll<HTMLButtonElement>('form button,#crypto-withdraw-confirm').forEach(button => { button.disabled = this.working || cryptoWallet.busy || !!cryptoWallet.transfer || !!cryptoWallet.pending; });
    this.renderDisplay();
    if (wallet?.state !== 'enabled') { this.payment = undefined; this.clearDeposit(); this.paymentDialog.close(); this.message(cryptoWallet.error || translateText('Криптовалютные платежи еще не подключены. Оплата станет доступна после подключения сервиса.')); return; }
    this.el('#crypto-wallet-reserved').textContent = translateText('Зарезервировано на вывод: ') + formatNileUnits(wallet.reservedUnits) + ' USDT';
    this.el<HTMLElement>('#crypto-withdraw-form').hidden = !wallet.withdrawalsEnabled;
    if (cryptoEnabled) this.loadCurrencies();
    const updated = this.payment && wallet.operations.find(op => op.kind === 'deposit' && op.id === this.payment!.id);
    if (updated) this.payment = updated;
    const active = this.paymentDialog.open ? this.payment : undefined;
    if (active && ['finished', 'expired', 'failed', 'refunded', 'rejected', 'review'].includes(active.state)) {
      this.clearDeposit(); this.el('#crypto-payment-message').textContent = states[active.state];
      this.el('#crypto-payment-result').textContent = active.state === 'finished' ? tr`На баланс зачислено ${formatNileUnits(active.creditedUnits)} USDT.` : translateText('Проверь состояние пополнения в истории операций.');
      this.el<HTMLElement>('#crypto-payment-result').hidden = false;
    } else this.renderDeposit(this.paymentDialog.open ? active : this.pendingDeposit(wallet.operations));
    const list = this.el('#crypto-wallet-history'); list.replaceChildren();
    for (const op of wallet.operations) {
      const li = document.createElement('li'), text = document.createElement('span'), refresh = document.createElement('button');
      text.textContent = `${op.kind === 'deposit' ? translateText('Пополнение') : translateText('Вывод')}: ${formatNileUnits(op.kind === 'deposit' && op.state === 'finished' ? op.creditedUnits : op.amountUnits)} USDT · ${op.currency.toUpperCase()} · ${states[op.state] ?? translateText('Проверяется')}${op.txHash ? ' · tx: ' + op.txHash : ''}`;
      refresh.type = 'button'; refresh.className = 'text-button'; refresh.textContent = translateText('Проверить'); refresh.disabled = cryptoWallet.busy;
      refresh.onclick = () => { void this.run(() => cryptoWallet.refreshOperation(op.id)); }; li.append(text, refresh); list.append(li);
    }
    if (!wallet.operations.length) list.textContent = translateText('Операций пока нет.');
    if (cryptoWallet.error) this.message(cryptoWallet.error);
  }
}
