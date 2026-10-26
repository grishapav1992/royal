import '../ez-slots-game.css';
import SlotMachine, { type SlotRows } from '../vendor/ezslots/Slots.js';
import { DEMO_BETS, type WalletResult } from '../shared/demoWallet';
import { FRUITS_PAYTABLE, GAME_CATALOG, isValidFruitsOutcome, type FruitsRound } from '../shared/gameCore';
import { coins, demoWallet, type WalletSettlement } from '../wallet/WalletClient';

const fruitSymbols = ['🍒', '🍋', '🍇', '7'] as const;
const fruitKeys = FRUITS_PAYTABLE.map(row => row.key);
const fruitRules = GAME_CATALOG.find(game => game.id === 'royal-fruits')!;

export class EZSlotsGame {
  private readonly root = document.createElement('section');
  private readonly machine: SlotMachine;
  private alive = true;
  private spinning = false;
  private animating = false;
  private round?: FruitsRound;
  private message = 'Выбери ставку и запусти барабаны.';
  private resultAccount: string | null = null;
  private accountId: string | null = demoWallet.accountId;
  private accountEpoch = 0;
  private readonly update = () => {
    if (this.accountId !== demoWallet.accountId) {
      this.accountEpoch++; this.accountId = demoWallet.accountId;
      this.machine.CancelSpin(); this.spinning = false; this.animating = false;
      this.resetResult();
    }
    this.render();
  };
  private readonly onSettlement = (event: Event) => {
    const { accountId, operation, result } = (event as CustomEvent<WalletSettlement>).detail;
    if (!this.alive || this.spinning || accountId !== demoWallet.accountId || operation.kind !== 'play' || operation.gameId !== 'royal-fruits') return;
    try {
      const round = this.checkedRound(result, operation.amount);
      this.machine.SetResult(this.rows(round));
      this.showRound(round, accountId);
      this.render();
    } catch {
      this.message = 'Результат не удалось показать. Проверь операцию в кошельке.';
      this.render();
    }
  };

  constructor(container: HTMLElement) {
    this.root.className = 'ez-slots-game';
    this.root.dataset.game = 'royal-fruits';
    this.root.dataset.library = 'EZSlotsJS';
    this.root.innerHTML = `
      <header class="ez-fruits-header"><span>ИГРЫ РОЯЛЯ · ДЕМО</span><h3>Royal Fruits</h3><p>Три барабана. Одна линия. Твоя удача.</p></header>
      <div class="ez-fruits-line-label"><span aria-hidden="true">▶</span> Оплачивается только центральная линия <span aria-hidden="true">◀</span></div>
      <div class="ez-fruits-stage" aria-hidden="true"></div>
      <div class="ez-fruits-outcome" role="img" aria-label="Результат ещё не получен"></div>
      <p id="ez-fruits-result" class="ez-fruits-result" role="status">${this.message}</p>
      <div class="ez-fruits-controls"><div class="ez-fruits-balance-label">Демобаланс<strong id="ez-fruits-balance">…</strong></div>
        <label for="ez-fruits-bet">Ставка<select id="ez-fruits-bet">${DEMO_BETS.map(amount => `<option value="${amount}">${coins(amount)}</option>`).join('')}</select></label>
        <button id="ez-fruits-spin" class="primary-button">Крутить</button>
      </div>
      <button id="ez-fruits-wallet" class="text-button">Пополнить демобаланс</button>
      <table class="ez-fruits-paytable"><caption>Три одинаковых на центральной линии</caption><thead><tr><th scope="col">Комбинация</th><th scope="col">Начисление</th></tr></thead><tbody>${FRUITS_PAYTABLE.map(row => `<tr><th scope="row" aria-label="Три символа: ${row.label}"><span aria-hidden="true">${fruitSymbols[row.symbol]} ${fruitSymbols[row.symbol]} ${fruitSymbols[row.symbol]}</span></th><td>×${row.multiplier}</td></tr>`).join('')}</tbody></table>
      <p class="ez-fruits-rules">Начисление включает ставку. Другие комбинации не выигрывают. RTP ${100 * fruitRules.rtp.numerator / fruitRules.rtp.denominator}% на длинной дистанции.</p>
      <footer class="ez-fruits-footer"><span>Бесплатные демомонеты не имеют денежной стоимости.</span><a href="/licenses/ezslots/NOTICE.txt" target="_blank" rel="noopener">Барабаны EZSlotsJS</a></footer>`;
    container.replaceChildren(this.root);
    this.machine = new SlotMachine(this.element('.ez-fruits-stage'), {
      reelCount: 3,
      minBet: DEMO_BETS[0],
      maxBet: DEMO_BETS[DEMO_BETS.length - 1],
      symbols: Object.fromEntries(FRUITS_PAYTABLE.map(row => [row.key, fruitSymbols[row.symbol]])),
      theme: SlotMachine.defaultThemes.golden,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    this.machine.SpinPressed(async amount => {
      const accountId = demoWallet.accountId, epoch = this.accountEpoch;
      const result = this.ownPending() ? await demoWallet.retry() : await demoWallet.play('royal-fruits', {}, amount);
      if (!this.alive || accountId !== demoWallet.accountId || epoch !== this.accountEpoch) return null;
      this.round = this.checkedRound(result, amount);
      this.animating = true;
      this.render();
      return this.rows(this.round);
    });
    this.element<HTMLButtonElement>('#ez-fruits-spin').onclick = () => { void this.spin(); };
    this.element<HTMLButtonElement>('#ez-fruits-wallet').onclick = () => window.dispatchEvent(new Event('royal-open-wallet'));
    this.element<HTMLSelectElement>('#ez-fruits-bet').onchange = () => this.render();
    demoWallet.addEventListener('change', this.update);
    demoWallet.addEventListener('settlement', this.onSettlement);
    this.render();
    void demoWallet.refresh();
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private ownPending() {
    const pending = demoWallet.pending;
    return pending?.kind === 'play' && pending.gameId === 'royal-fruits' && pending.rulesVersion === 1 &&
      pending.input !== null && typeof pending.input === 'object' && Object.keys(pending.input).length === 0 ? pending : undefined;
  }

  private rows(round: FruitsRound): SlotRows {
    return round.outcome.symbols.map(symbol => [
      fruitKeys[(symbol + 1) % fruitKeys.length],
      fruitKeys[symbol],
      fruitKeys[(symbol + 2) % fruitKeys.length],
    ]);
  }

  private checkedRound(result: WalletResult, amount: number): FruitsRound {
    const round = result.gameRound;
    if (round?.gameId !== 'royal-fruits' || round.rulesVersion !== 1 || !round.input || Object.keys(round.input).length !== 0 ||
      !isValidFruitsOutcome(round.outcome?.symbols, round.multiplier) || round.stakeUnits !== String(BigInt(amount) * 100n) ||
      round.payoutUnits !== String(BigInt(round.stakeUnits) * BigInt(round.multiplier))) {
      throw new Error('Результат сервера не удалось показать. Проверь операцию в кошельке.');
    }
    return round;
  }

  private showRound(round: FruitsRound, accountId: string | null) {
    this.round = round;
    this.resultAccount = accountId;
    const stake = Number(BigInt(round.stakeUnits)) / 100;
    const payout = Number(BigInt(round.payoutUnits)) / 100;
    this.message = payout > 0 ? `Начислено ${coins(payout)} демомонет! Ставка ${coins(stake)}.` : `Без выигрыша. Ставка ${coins(stake)} демомонет.`;
    this.root.dataset.result = payout > 0 ? 'win' : 'loss';
    this.element('.ez-fruits-outcome').setAttribute('aria-label', `Центральная линия: ${round.outcome.symbols.map(symbol => FRUITS_PAYTABLE[symbol].label).join(', ')}`);
  }

  private resetResult() {
    this.round = undefined; this.resultAccount = null;
    this.message = 'Выбери ставку и запусти барабаны.';
    delete this.root.dataset.result;
    this.element('.ez-fruits-outcome').setAttribute('aria-label', 'Результат ещё не получен');
    this.machine.SetResult([['lemon', 'cherry', 'grape'], ['grape', 'lemon', 'seven'], ['seven', 'grape', 'cherry']]);
  }

  private render() {
    if (!this.alive) return;
    if (this.accountId !== demoWallet.accountId) { this.update(); return; }
    if (this.resultAccount && this.resultAccount !== demoWallet.accountId) this.resetResult();
    const pending = this.ownPending();
    const foreignPending = Boolean(demoWallet.pending && !pending);
    const bet = this.element<HTMLSelectElement>('#ez-fruits-bet');
    if (pending) bet.value = String(pending.amount);
    const busy = this.spinning || demoWallet.busy || demoWallet.externalBusy;
    bet.disabled = busy || Boolean(demoWallet.pending);
    if (!busy) this.machine.SetBet(Number(bet.value));
    const spin = this.element<HTMLButtonElement>('#ez-fruits-spin');
    spin.disabled = busy || foreignPending || !demoWallet.accountId || !demoWallet.wallet || (!pending && demoWallet.wallet.balance < Number(bet.value));
    spin.textContent = this.spinning ? (this.animating ? 'Барабаны крутятся…' : 'Получаем результат…') : pending ? 'Проверить результат' : 'Крутить';
    this.root.classList.toggle('spinning', this.spinning);
    this.root.setAttribute('aria-busy', String(this.spinning));
    this.element('#ez-fruits-balance').textContent = demoWallet.wallet ? coins(demoWallet.wallet.balance) : '…';
    const message = foreignPending ? 'Есть незавершённая операция другой игры. Открой кошелёк и проверь её результат.' :
      demoWallet.externalBusy ? 'Сначала проверь операцию в другой игре.' :
      pending && !busy ? (demoWallet.error || 'Операция сохранена. Проверь результат без повторного списания.') :
      !this.spinning && demoWallet.error ? demoWallet.error : this.message;
    this.element('#ez-fruits-result').textContent = message;
  }

  private async spin() {
    if (this.element<HTMLButtonElement>('#ez-fruits-spin').disabled || this.spinning) return;
    const accountId = demoWallet.accountId, epoch = this.accountEpoch;
    this.machine.SetBet(Number(this.element<HTMLSelectElement>('#ez-fruits-bet').value));
    this.spinning = true;
    this.animating = false;
    this.render();
    try {
      const shown = await this.machine.Spin();
      if (shown && this.alive && accountId === demoWallet.accountId && epoch === this.accountEpoch && this.round) this.showRound(this.round, accountId);
    } catch (error) {
      if (this.alive && accountId === demoWallet.accountId && epoch === this.accountEpoch) this.message = error instanceof Error ? error.message : 'Не удалось получить результат. Проверь операцию в кошельке.';
    } finally {
      if (epoch === this.accountEpoch) {
        this.spinning = false; this.animating = false; this.render();
      }
    }
  }

  destroy() {
    this.alive = false;
    demoWallet.removeEventListener('change', this.update);
    demoWallet.removeEventListener('settlement', this.onSettlement);
    this.machine.Remove();
    this.root.remove();
  }
}
