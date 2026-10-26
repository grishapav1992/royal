import { DEMO_BETS, type WalletResult } from '../shared/demoWallet';
import { FRUITS_PAYTABLE, GAME_CATALOG, rouletteRedNumbers, type GameInput, type GameRound, type RouletteInput } from '../shared/gameCore';
import { COINS_THEMES, type CoinsThemeId } from '../shared/gameThemes';
import { demoWallet, coins, type WalletSettlement } from '../wallet/WalletClient';
import { nilePlay } from '../wallet/NilePlayClient';
import { NILE_BETS } from '../shared/nilePlay';
import { formatNileUnits } from '../shared/nileWallet';
import { usdtWallet } from '../wallet/UsdtClient';
import { cryptoWallet } from '../wallet/CryptoClient';
import { USDT_BETS } from '../shared/usdtWallet';

const redNumbers = new Set<number>(rouletteRedNumbers);
const numberColor = (value: number) => value === 0 ? 'green' : redNumbers.has(value) ? 'red' : 'black';
const fruitSymbols = ['🍒', '🍋', '🍇', '7'] as const;
type LegacyGameId = 'royal-coins' | 'royal-fruits' | 'royal-roulette';
const legacyGame = (id: string): id is LegacyGameId => ['royal-coins', 'royal-fruits', 'royal-roulette'].includes(id);

export class RoyalCoins {
  private root = document.createElement('div');
  private alive = true;
  private spinning = false;
  private nile = false;
  private usdt = false;
  private crypto = false;
  private get cash() { return this.crypto ? cryptoWallet : usdtWallet; }
  private gameId: LegacyGameId = 'royal-coins';
  private themeId: CoinsThemeId = 'classic';
  private symbols = [0, 1, 4];
  private hasResult = false;
  private update = () => this.render();
  private onSettlement = (event: Event) => {
    const { accountId, operation, result } = (event as CustomEvent<WalletSettlement>).detail;
    if (!this.alive || this.spinning || this.nile || this.usdt || accountId !== demoWallet.accountId || operation.kind === 'deposit') return;
    const gameId = operation.kind === 'play' ? operation.gameId : 'royal-coins';
    if (gameId !== this.gameId) return;
    this.showWalletResult(result); this.render();
  };
  constructor(container: HTMLElement) {
    this.nile=!demoWallet.pending&&nilePlay.wallet?.state==='assigned'&&BigInt(nilePlay.wallet.balanceUnits)>0n;
    this.usdt=!demoWallet.pending&&!nilePlay.pending&&usdtWallet.wallet?.state==='assigned'&&BigInt(usdtWallet.wallet.balanceUnits)>0n;
    const cash = cryptoWallet.wallet;
    if (!demoWallet.pending && !nilePlay.pending && !usdtWallet.pending && cash?.state === 'enabled' && cash.gamesEnabled && BigInt(cash.balanceUnits) > 0n) { this.crypto = true; this.usdt = true; }
    if(this.usdt)this.nile=false;
    this.root.className = 'royal-coins';
    this.root.innerHTML = `<div class="coins-marquee"><span>РОЯЛЬ · ТЕСТОВЫЕ ИГРЫ</span><h3>Royal Coins</h3><p>Твой кошелёк. Твоя удача.</p></div>
      <div class="coins-selectors"><label for="coins-game">Игра<select id="coins-game"><option value="royal-coins">Royal Coins</option><option value="royal-fruits">Royal Fruits</option><option value="royal-roulette">Рулетка</option></select></label>
      <label for="coins-currency">Баланс для игры<select id="coins-currency"><option value="demo">Демомонеты</option><option value="nile">USDT (Nile)</option><option value="usdt" hidden>USDT · TRON</option><option value="crypto" hidden>USDT · криптокошелек</option></select></label>
      <label for="coins-theme" id="coins-theme-control">Оформление<select id="coins-theme">${COINS_THEMES.map(theme => `<option value="${theme.id}">${theme.name}</option>`).join('')}</select></label></div>
      <div class="coins-reels" role="img" aria-label="Барабаны"><span>♛</span><span>◆</span><span>★</span></div>
      <table class="fruits-paytable" hidden><caption>Три одинаковых на центральной линии</caption><thead><tr><th scope="col">Комбинация</th><th scope="col">Начисление</th></tr></thead><tbody>${FRUITS_PAYTABLE.map(row => `<tr><th scope="row" aria-label="Три символа: ${row.label}"><span aria-hidden="true">${fruitSymbols[row.symbol]} ${fruitSymbols[row.symbol]} ${fruitSymbols[row.symbol]}</span></th><td>×${row.multiplier}</td></tr>`).join('')}</tbody></table>
      <div id="roulette-table" hidden><div class="roulette-wheel" role="img" aria-label="Колесо рулетки"><div class="roulette-number" data-color="green">?</div></div>
        <div class="roulette-bets"><label for="roulette-bet">На что ставим<select id="roulette-bet"><option value="red">Красное · ×2</option><option value="black">Чёрное · ×2</option><option value="even">Чётное · ×2</option><option value="odd">Нечётное · ×2</option><option value="number">Одно число · ×36</option></select></label>
        <label for="roulette-number" id="roulette-number-control" hidden>Число<select id="roulette-number">${Array.from({ length: 37 }, (_, value) => `<option value="${value}">${value}</option>`).join('')}</select></label></div>
      </div>
      <p id="coins-result" role="status">Выбери ставку и запусти барабаны.</p>
      <div class="coins-controls"><label>Баланс<strong id="coins-balance">…</strong></label><label for="coins-bet">Ставка<select id="coins-bet"></select></label></div>
      <button id="coins-spin" class="primary-button">Крутить</button><button id="coins-wallet" class="text-button">Пополнить демобаланс</button>
      <p class="coins-rules"></p><p class="coins-rtp"></p><small>Бесплатные демомонеты и тестовый USDT Nile не имеют денежной стоимости. Переводы и вывод USDT недоступны.</small>`;
    container.replaceChildren(this.root);
    this.setBets();
    this.element<HTMLButtonElement>('#coins-spin').onclick = () => { void this.spin(); };
    this.element<HTMLButtonElement>('#coins-wallet').onclick = () => window.dispatchEvent(new Event(this.crypto ? 'royal-open-crypto-wallet' : this.usdt ? 'royal-open-usdt-wallet' : this.nile ? 'royal-open-nile-wallet' : 'royal-open-wallet'));
    this.element<HTMLSelectElement>('#coins-currency').onchange = event => {
      this.nile = (event.target as HTMLSelectElement).value === 'nile';
      this.crypto = (event.target as HTMLSelectElement).value === 'crypto';
      this.usdt = this.crypto || (event.target as HTMLSelectElement).value === 'usdt';
      if (this.nile || (this.usdt && this.gameId === 'royal-fruits')) this.gameId = 'royal-coins';
      this.setBets(); this.resetResult(); this.render();
      if (this.nile) void nilePlay.refresh();
      if (this.usdt) void this.cash.refresh();
    };
    this.element<HTMLSelectElement>('#coins-game').onchange = event => {
      this.gameId = (event.target as HTMLSelectElement).value as LegacyGameId;
      this.resetResult(); this.render();
    };
    this.element<HTMLSelectElement>('#coins-theme').onchange = event => {
      this.themeId = (event.target as HTMLSelectElement).value as CoinsThemeId;
      this.render();
    };
    this.element<HTMLSelectElement>('#roulette-bet').onchange = () => this.render();
    this.element<HTMLSelectElement>('#coins-bet').onchange = () => { this.resetResult(); this.render(); };
    demoWallet.addEventListener('change', this.update);
    demoWallet.addEventListener('settlement', this.onSettlement);
    nilePlay.addEventListener('change', this.update);
    usdtWallet.addEventListener('change', this.update);
    cryptoWallet.addEventListener('change', this.update);
    this.render(); void demoWallet.refresh();
  }
  private element<T extends Element = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  private setBets(amount?: string) {
    this.element('#coins-bet').innerHTML = this.usdt
      ? USDT_BETS.map(bet => `<option value="${bet}">${formatNileUnits(bet)} USDT</option>`).join('') : this.nile
      ? NILE_BETS.map(bet => `<option value="${bet}">${formatNileUnits(bet)} USDT (Nile)</option>`).join('')
      : DEMO_BETS.map(bet => `<option value="${bet}" ${bet === 100 ? 'selected' : ''}>${bet} монет</option>`).join('');
    if (amount) this.element<HTMLSelectElement>('#coins-bet').value = amount;
  }
  private resetResult() {
    this.hasResult = false;
    this.symbols = this.gameId === 'royal-fruits' ? [0, 1, 2] : [0, 1, 4];
    this.element('#coins-result').textContent = this.gameId === 'royal-roulette'
      ? 'Выбери ставку и запусти колесо.' : 'Выбери ставку и запусти барабаны.';
  }
  private restorePending() {
    const pending = demoWallet.pending;
    if (pending?.kind === 'spin' || (pending?.kind === 'play' && legacyGame(pending.gameId))) {
      if (this.nile || this.usdt) { this.nile = false; this.usdt = false; this.crypto = false; this.setBets(); }
      const pendingGame = pending.kind === 'play' ? pending.gameId : 'royal-coins';
      if (legacyGame(pendingGame) && pendingGame !== this.gameId) { this.gameId = pendingGame; this.resetResult(); }
      this.element<HTMLSelectElement>('#coins-bet').value = String(pending.amount);
      if (pending.kind === 'play' && pending.gameId === 'royal-roulette' && 'bet' in pending.input) {
        this.element<HTMLSelectElement>('#roulette-bet').value = pending.input.bet as string;
        if ('number' in pending.input) this.element<HTMLSelectElement>('#roulette-number').value = String(pending.input.number);
      }
    } else if (nilePlay.pending && !pending) {
      this.nile = true; this.usdt = false; this.crypto = false; this.gameId = 'royal-coins'; this.setBets(nilePlay.pending.stakeUnits);
    } else if ((usdtWallet.pending || cryptoWallet.pending) && !pending) {
      this.crypto = !!cryptoWallet.pending;
      const round=this.cash.pending!;this.usdt=true;this.nile=false;this.gameId=round.gameId;this.setBets(round.stakeUnits);
      if(round.gameId==='royal-roulette'&&'bet' in round.input){this.element<HTMLSelectElement>('#roulette-bet').value=round.input.bet;if('number' in round.input)this.element<HTMLSelectElement>('#roulette-number').value=String(round.input.number);}
    }
  }
  private render() {
    if (!this.alive) return;
    this.restorePending();
    const roulette = this.gameId === 'royal-roulette';
    const fruits = this.gameId === 'royal-fruits';
    const theme = COINS_THEMES.find(item => item.id === this.themeId)!;
    const symbolArt = fruits ? fruitSymbols : theme.symbols;
    const locked = this.spinning || demoWallet.busy || demoWallet.externalBusy || nilePlay.busy || usdtWallet.busy || !!demoWallet.pending || !!nilePlay.pending || !!usdtWallet.pending || !!cryptoWallet.pending || cryptoWallet.busy;
    this.root.dataset.currency = this.crypto ? 'crypto' : this.usdt ? 'usdt' : this.nile ? 'nile' : 'demo';
    this.root.dataset.game = this.gameId; this.root.dataset.theme = fruits ? 'fruits' : this.themeId;
    const game = this.element<HTMLSelectElement>('#coins-game'); game.value = this.gameId; game.disabled = locked;
    const rouletteOption = game.querySelector<HTMLOptionElement>('[value="royal-roulette"]')!;
    rouletteOption.disabled = this.nile; rouletteOption.hidden = this.nile;
    const fruitsOption = game.querySelector<HTMLOptionElement>('[value="royal-fruits"]')!;
    fruitsOption.disabled = this.nile || this.usdt; fruitsOption.hidden = this.nile || this.usdt;
    const currency = this.element<HTMLSelectElement>('#coins-currency'); currency.value = this.crypto ? 'crypto' : this.usdt ? 'usdt' : this.nile ? 'nile' : 'demo'; currency.disabled = locked;
    const cryptoOption=currency.querySelector<HTMLOptionElement>('[value="crypto"]')!;cryptoOption.hidden=!(cryptoWallet.wallet?.state==='enabled'&&cryptoWallet.wallet.gamesEnabled)&&!cryptoWallet.pending;cryptoOption.disabled=cryptoOption.hidden;
    const mainnetOption=currency.querySelector<HTMLOptionElement>('[value="usdt"]')!;mainnetOption.hidden=usdtWallet.wallet?.state!=='assigned'&&!usdtWallet.pending;mainnetOption.disabled=mainnetOption.hidden;
    this.element('.coins-marquee span').textContent=this.usdt?'РОЯЛЬ · ИГРЫ НА USDT':'РОЯЛЬ · ТЕСТОВЫЕ ИГРЫ';
    const heading=this.root.closest('dialog')?.querySelector('.mini-top .eyebrow');if(heading)heading.textContent=this.usdt?'РОЯЛЬ / USDT · TRON':'РОЯЛЬ / ТЕСТОВЫЕ ИГРЫ';
    this.element('small').textContent=this.crypto?'Баланс USDT с пополнением и выводом через криптокошелек.':this.usdt?'Настоящий USDT в сети TRON (TRC-20). Вывод из личного кабинета пока не подключен.':'Бесплатные демомонеты и тестовый USDT Nile не имеют денежной стоимости. Переводы и вывод USDT недоступны.';
    this.element<HTMLSelectElement>('#coins-theme').disabled = locked;
    this.element('#coins-theme-control').hidden = roulette || fruits;
    this.element('.coins-reels').hidden = roulette;
    this.element('#roulette-table').hidden = !roulette;
    this.element('.fruits-paytable').hidden = !fruits;
    this.element('.coins-marquee h3').textContent = roulette ? 'Рулетка' : fruits ? 'Royal Fruits' : 'Royal Coins';
    this.element('.coins-marquee p').textContent = roulette ? 'Одно колесо. 37 возможных чисел.' : fruits ? 'Три барабана. Одна линия. Четыре символа.' : theme.subtitle;
    this.element<HTMLSelectElement>('#roulette-bet').disabled = locked;
    this.element<HTMLSelectElement>('#roulette-number').disabled = locked;
    this.element('#roulette-number-control').hidden = this.element<HTMLSelectElement>('#roulette-bet').value !== 'number';
    this.root.querySelectorAll('.coins-reels span').forEach((el, index) => { el.textContent = symbolArt[this.symbols[index]]; });
    this.element('.coins-reels').setAttribute('aria-label', `Символы: ${this.symbols.map(id => fruits ? FRUITS_PAYTABLE[id].label : symbolArt[id]).join(' ')}`);
    this.element('.coins-rules').textContent = roulette
      ? 'Красное, чёрное, чётное или нечётное: ×2. Одно число: ×36. Ноль проигрывает всем ставкам, кроме ставки на число 0. Начисление включает возврат ставки.'
      : fruits ? 'Выигрывают только три одинаковых символа. Два одинаковых не дают выплаты. Множитель применяется ко всей ставке, начисление включает её возврат. Без бонусов и бесплатных вращений.'
      : 'Три одинаковых: ×12. Два одинаковых: возврат ставки. Все разные: 0. Начисление включает возврат ставки. Оформление не меняет правила и выплаты.';
    const spec = GAME_CATALOG.find(item => item.id === this.gameId)!;
    const rtp = spec.rtp ? (100 * spec.rtp.numerator / spec.rtp.denominator).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '';
    this.element('.coins-rtp').textContent = `Теоретический RTP: ${rtp}%. ${fruits ? 'Вероятность выигрыша: 10%. ' : ''}Это средний возврат на большой дистанции, а результат отдельной игры случаен.`;
    if (this.usdt) { this.renderUsdt(); return; }
    if (this.nile) { this.renderNile(); return; }
    this.element<HTMLButtonElement>('#coins-wallet').textContent = 'Пополнить демобаланс';
    this.element('#coins-balance').textContent = demoWallet.wallet ? coins(demoWallet.wallet.balance) : '…';
    const spin = this.element<HTMLButtonElement>('#coins-spin'), bet = this.element<HTMLSelectElement>('#coins-bet');
    const pendingGame = demoWallet.pending?.kind === 'spin' || (demoWallet.pending?.kind === 'play' && legacyGame(demoWallet.pending.gameId));
    spin.textContent = this.spinning ? 'Крутим…' : pendingGame ? 'Проверить результат' : 'Крутить';
    spin.disabled = this.spinning || demoWallet.busy || demoWallet.externalBusy || cryptoWallet.busy || !!cryptoWallet.pending || !demoWallet.accountId || (!pendingGame && (!demoWallet.wallet || demoWallet.wallet.balance < Number(bet.value))) || (!!demoWallet.pending && !pendingGame) || !!nilePlay.pending || !!usdtWallet.pending;
    bet.disabled = locked;
    this.element<HTMLButtonElement>('#coins-wallet').disabled = !demoWallet.accountId;
    if (!this.spinning && pendingGame) this.element('#coins-result').textContent = demoWallet.error || 'Ставка ожидает подтверждения. Проверь результат перед новой игрой.';
    else if (!this.spinning && !demoWallet.accountId) this.element('#coins-result').textContent = 'Войди в онлайн-зал, чтобы пополнить кошелёк и играть.';
    else if (!this.spinning && !this.hasResult && !demoWallet.pending && demoWallet.wallet && demoWallet.wallet.balance < Number(bet.value)) this.element('#coins-result').textContent = 'Для этой ставки не хватает монет. Пополни баланс или выбери меньшую ставку.';
  }
  private renderNile() {
    const wallet = nilePlay.wallet, assigned = wallet?.state === 'assigned' ? wallet : undefined, pending = !!nilePlay.pending;
    const spin = this.element<HTMLButtonElement>('#coins-spin'), bet = this.element<HTMLSelectElement>('#coins-bet');
    this.element('#coins-balance').textContent = assigned?.ready ? formatNileUnits(assigned.balanceUnits) + ' USDT (Nile)' : '…';
    spin.textContent = this.spinning ? 'Крутим…' : pending ? 'Проверить результат' : 'Крутить';
    spin.disabled = this.spinning || nilePlay.busy || cryptoWallet.busy || !!cryptoWallet.pending || !nilePlay.accountId || !!demoWallet.pending || !!usdtWallet.pending || (!pending && (!assigned?.ready || BigInt(assigned.balanceUnits) < BigInt(bet.value) || BigInt(assigned.maxStakeUnits) < BigInt(bet.value)));
    bet.disabled = this.spinning || nilePlay.busy || pending || !!demoWallet.pending;
    this.element<HTMLButtonElement>('#coins-wallet').textContent = 'Пополнить USDT';
    this.element<HTMLButtonElement>('#coins-wallet').disabled = !nilePlay.accountId;
    if (!this.spinning && pending) this.element('#coins-result').textContent = nilePlay.error || 'Ставка ожидает подтверждения. Проверь результат перед новой игрой.';
    if (!this.spinning && !pending && !this.hasResult) {
      const message = !nilePlay.accountId ? 'Войди в онлайн-зал, чтобы подключить тестовый кошелёк.' : nilePlay.error || (!assigned ? 'Нажми «Пополнить USDT», чтобы получить личный адрес.' : !assigned.ready ? 'Подтверждение баланса временно недоступно. Обнови кошелёк.' : BigInt(assigned.balanceUnits) < BigInt(bet.value) ? 'Недостаточно тестовых USDT для этой ставки.' : BigInt(assigned.maxStakeUnits) < BigInt(bet.value) ? 'Недостаточно резерва для выплаты. Выбери меньшую ставку или попробуй позже.' : '');
      if (message) this.element('#coins-result').textContent = message;
    }
  }
  private renderUsdt() {
    const client=this.cash,wallet=client.wallet,assigned=wallet&&(wallet.state==='assigned'||wallet.state==='enabled')?wallet:undefined,pending=!!client.pending;
    const maxStake=assigned&&this.gameId!=='royal-fruits'?assigned.maxStakeUnits[this.gameId]:'0';
    const spin=this.element<HTMLButtonElement>('#coins-spin'),bet=this.element<HTMLSelectElement>('#coins-bet');
    this.element('#coins-balance').textContent=assigned?.ready?formatNileUnits(assigned.balanceUnits)+' USDT':'…';
    spin.textContent=this.spinning?'Крутим…':pending?'Проверить результат':'Крутить';
    spin.disabled=this.spinning||client.busy||!client.accountId||!!demoWallet.pending||!!nilePlay.pending||(!pending&&(!assigned?.ready||BigInt(assigned.balanceUnits)<BigInt(bet.value)||BigInt(maxStake)<BigInt(bet.value)));
    bet.disabled=this.spinning||client.busy||pending||!!demoWallet.pending||!!nilePlay.pending;
    this.element<HTMLButtonElement>('#coins-wallet').textContent=this.crypto?'Открыть криптокошелек':'Пополнить USDT · TRON';
    if(!this.spinning&&pending)this.element('#coins-result').textContent=client.error||'Ставка ожидает подтверждения. Проверь результат.';
    if(!this.spinning&&!pending&&!this.hasResult){const message=client.error||(!assigned?'Кошелек USDT еще не подключен.':!assigned.ready?'Подтверждение баланса временно недоступно.':BigInt(assigned.balanceUnits)<BigInt(bet.value)?'Недостаточно USDT для ставки.':BigInt(maxStake)<BigInt(bet.value)?'Недостаточно резерва для выплаты. Выбери меньшую ставку.':'');if(message)this.element('#coins-result').textContent=message;}
  }
  private rouletteInput(): RouletteInput {
    const bet = this.element<HTMLSelectElement>('#roulette-bet').value as 'red' | 'black' | 'even' | 'odd' | 'number';
    return bet === 'number' ? { bet, number: Number(this.element<HTMLSelectElement>('#roulette-number').value) } : { bet };
  }
  private async spin() {
    if (this.spinning) return;
    if (this.usdt) { await this.spinUsdt(); return; }
    if (this.nile) { await this.spinNile(); return; }
    const amount = Number(this.element<HTMLSelectElement>('#coins-bet').value);
    this.hasResult = false;
    this.spinning = true; this.root.classList.add('spinning'); this.render();
    this.element('#coins-result').textContent = 'Проверяем ставку и результат…';
    try {
      const input = this.gameId === 'royal-roulette' ? this.rouletteInput() : {};
      const operation = demoWallet.pending ? demoWallet.retry() : this.gameId === 'royal-coins' ? demoWallet.operate('spin', amount) : demoWallet.play(this.gameId, input, amount);
      const [result] = await Promise.all([operation, this.animationDelay()]);
      if (!this.alive) return;
      this.showWalletResult(result);
    } catch (error) { if (this.alive) this.element('#coins-result').textContent = (error as Error).message; }
    finally { this.spinning = false; this.root.classList.remove('spinning'); this.render(); }
  }
  private showWalletResult(result: WalletResult) {
    if (result.gameRound) this.showGameRound(result.gameRound);
    else if (result.round) {
      this.symbols = result.round.symbols;
      this.showPayout(result.round.multiplier, result.round.bet, result.round.payout);
    }
  }
  private animationDelay() { return new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650)); }
  private showGameRound(round: GameRound) {
    let prefix = '';
    if ('symbols' in round.outcome) this.symbols = round.outcome.symbols;
    if ('number' in round.outcome) {
      const value = round.outcome.number, color = numberColor(value);
      const result = this.element('.roulette-number'); result.textContent = String(value); result.dataset.color = color;
      const colorLabel = color === 'red' ? 'красное' : color === 'black' ? 'чёрное' : 'зелёное';
      prefix = `Выпало ${value}, ${colorLabel}. `;
      this.element('.roulette-wheel').setAttribute('aria-label', `Результат: ${value}, ${colorLabel}`);
    }
    this.showPayout(round.multiplier, Number(round.stakeUnits) / 100, Number(round.payoutUnits) / 100, prefix);
  }
  private showPayout(multiplier: number, bet: number, payout: number, prefix = '') {
    this.hasResult = true;
    this.element('#coins-result').textContent = prefix + (multiplier > 1 ? `Начислено ${coins(payout)} монет! Ставка ${coins(bet)}.` : multiplier === 1 ? `Ставка ${coins(bet)} возвращена.` : `Без выигрыша. Списано ${coins(bet)} монет.`);
  }
  private async spinNile() {
    const stake = nilePlay.pending?.stakeUnits ?? this.element<HTMLSelectElement>('#coins-bet').value;
    this.hasResult = false;
    this.spinning = true; this.root.classList.add('spinning'); this.render(); this.element('#coins-result').textContent = 'Подтверждаем тестовую ставку…';
    try {
      const [result] = await Promise.all([nilePlay.spin(stake), this.animationDelay()]); if (!this.alive) return;
      const round = result.round; this.symbols = round.symbols;
      this.hasResult = true;
      this.element('#coins-result').textContent = round.multiplier > 1 ? `Начислено ${formatNileUnits(round.payoutUnits)} USDT (Nile)! Ставка ${formatNileUnits(round.stakeUnits)}.` : round.multiplier === 1 ? `Ставка ${formatNileUnits(round.stakeUnits)} USDT (Nile) возвращена.` : `Без выигрыша. Списано ${formatNileUnits(round.stakeUnits)} USDT (Nile).`;
    } catch (e) { if (this.alive) this.element('#coins-result').textContent = (e as Error).message; }
    finally { this.spinning = false; this.root.classList.remove('spinning'); this.render(); }
  }
  private async spinUsdt() {
    if (this.gameId === 'royal-fruits') return;
    const pending=this.cash.pending,stake=pending?.stakeUnits??this.element<HTMLSelectElement>('#coins-bet').value,input=pending?.input??(this.gameId==='royal-coins'?{}:this.rouletteInput());
    this.hasResult=false;this.spinning=true;this.root.classList.add('spinning');this.render();this.element('#coins-result').textContent='Подтверждаем ставку USDT…';
    try {
      const [result]=await Promise.all([this.cash.play(this.gameId,input,stake),this.animationDelay()]);if(!this.alive)return;
      const round=result.round;if('symbols' in round.outcome)this.symbols=round.outcome.symbols;
      let prefix='';if('number' in round.outcome){const n=round.outcome.number;this.element('.roulette-number').textContent=String(n);this.element<HTMLElement>('.roulette-number').dataset.color=numberColor(n);prefix=`Выпало ${n}. `;}
      this.hasResult=true;this.element('#coins-result').textContent=prefix+(round.multiplier>1?`Начислено ${formatNileUnits(round.payoutUnits)} USDT! Ставка ${formatNileUnits(round.stakeUnits)}.`:round.multiplier===1?`Ставка ${formatNileUnits(round.stakeUnits)} USDT возвращена.`:`Без выигрыша. Списано ${formatNileUnits(round.stakeUnits)} USDT.`);
    } catch(e){if(this.alive)this.element('#coins-result').textContent=(e as Error).message;}
    finally{this.spinning=false;this.root.classList.remove('spinning');this.render();}
  }
  destroy() { this.alive = false; demoWallet.removeEventListener('change', this.update); demoWallet.removeEventListener('settlement', this.onSettlement); nilePlay.removeEventListener('change', this.update); usdtWallet.removeEventListener('change', this.update); cryptoWallet.removeEventListener('change', this.update); this.root.remove(); }
}
