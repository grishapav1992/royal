import { emitImportedOutcome } from './importedMotion/Outcome';
import { decorateImportedGame } from './ImportedGameThemes';
import { t as translateText, tr, locale } from '../i18n/index';
import { emitGameOutcome, observeGameOutcome } from './gameReactions';
import '../original-games.css';
import { DEMO_BETS, type DemoWallet } from '../shared/demoWallet';
import type { GameInput, GameRound } from '../shared/gameCore';
import {
  diceOdds, limboOdds, minesOdds, PLINKO_RISKS, KENO_RISKS,
  getPlinkoMultipliers, getKenoMultipliers, getPlinkoRtp, getKenoRtp,
  getDiceRtpForStake, getMinesRtp, getLimboRtp, getLimboWinProbability,
} from '../shared/originalGames';
import type { MinesOperation } from '../shared/minesGame';
import { demoWallet, coins, type WalletSettlement } from '../wallet/WalletClient';
import { minesClient } from '../wallet/MinesClient';

export type OriginalGameId = 'royal-dice' | 'royal-mines' | 'royal-plinko' | 'royal-limbo' | 'royal-keno';
type PlinkoRisk = typeof PLINKO_RISKS[number];
type KenoRisk = typeof KENO_RISKS[number];
const SVG_NS = 'http://www.w3.org/2000/svg';
const gameDetails: Record<OriginalGameId, { name: string; mark: string; subtitle: string; rules: string }> = {
  'royal-dice': { name: 'Dice', mark: '⚄', subtitle: translateText('Выбери сторону. Брось вызов удаче.'), rules: translateText('Выпадает число от 0,00 до 99,99. «Меньше» выигрывает при результате строго ниже порога, «Не меньше» при результате равном порогу или выше. Порог меняет шанс и множитель.') },
  'royal-mines': { name: 'Mines', mark: '◆', subtitle: translateText('Открывай камни. Забирай вовремя.'), rules: translateText('На поле 25 клеток скрыты мины. Каждый безопасный камень увеличивает множитель. После первого камня можно забрать выплату. Попадание на мину завершает партию без выплаты. Закрытие окна сохраняет активную партию.') },
  'royal-plinko': { name: 'Plinko', mark: '●', subtitle: translateText('Один шар. Множество путей.'), rules: translateText('На каждом ряду шар идёт влево или вправо с равными шансами. Начисление зависит от конечного кармана. Риск меняет выплаты, количество рядов меняет распределение результатов.') },
  'royal-limbo': { name: 'Limbo', mark: '↗', subtitle: translateText('Назначь цель. Поймай множитель.'), rules: translateText('Задай целевой множитель до ставки. Если выпавший множитель достигнет цели, начисление равно ставке, умноженной на цель. Чем выше цель, тем меньше вероятность выигрыша.') },
  'royal-keno': { name: 'Keno', mark: '✦', subtitle: translateText('Твои числа. Десять возможностей.'), rules: translateText('Выбери от 1 до 10 чисел из 40. Сервер вытягивает 10 разных чисел. Выплата определяется количеством совпадений и выбранным риском. Таблица показывает полное начисление, включая возврат ставки.') },
};
const riskLabels: Record<string, string> = { easy: translateText('Низкий'), medium: translateText('Средний'), hard: translateText('Высокий'), expert: translateText('Эксперт'), classic: translateText('Классика'), low: translateText('Низкий'), high: translateText('Высокий') };
const multiplierText = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 4 })}×`;
const decimal = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });

/** Vanilla DOM adaptation of vFair game controls and board presentation. */
export class OriginalGameView {
  private root = document.createElement('section');
  private alive = true;
  private working = false;
  private accountId: string | null = demoWallet.accountId;
  private accountEpoch = 0;
  private lastRound?: GameRound;
  private kenoVisible?: { account: string | null; balance?: number; entries: DemoWallet['entries'] };
  private picks = new Set<number>([1, 2, 3]);
  private drawn = new Set<number>();
  private highlightedBucket: number | null = null;
  private cancelAnimation?: () => void;
  private message = translateText('Выбери ставку и начинай.');
  private update = () => {
    if (this.accountId !== demoWallet.accountId) {
      this.accountEpoch++; this.cancelAnimation?.(); this.working = false;
      this.kenoVisible = undefined;
      this.accountId = demoWallet.accountId; this.resetResult();
    }
    this.render();
  };
  private settlement = (event: Event) => {
    const { accountId, operation, result } = (event as CustomEvent<WalletSettlement>).detail;
    if (!this.alive || this.working || accountId !== demoWallet.accountId || operation.kind !== 'play' || operation.gameId !== this.gameId || !result.gameRound) return;
    void this.showRound(result.gameRound, false);
  };

  constructor(container: HTMLElement, private gameId: OriginalGameId) {
    const detail = gameDetails[gameId];
    this.root.className = 'original-game'; this.root.dataset.game = gameId;
    this.root.innerHTML = tr`<header class="original-header"><div class="original-brand"><span class="original-mark" aria-hidden="true">${detail.mark}</span><div><span class="original-eyebrow">ROYAL ORIGINALS</span><h3>${detail.name}</h3></div></div><div class="original-wallet"><span>Баланс USDT</span><strong id="original-balance">…</strong><button type="button" id="original-wallet" aria-label="Пополнить баланс USDT">+</button></div></header>
      <div class="original-layout"><aside class="original-controls"><p class="original-subtitle">${detail.subtitle}</p><label class="original-label" for="original-bet">Ставка, USDT</label><select id="original-bet" data-game-input>${DEMO_BETS.map(value => `<option value="${value}" ${value === 100 ? 'selected' : ''}>${value}</option>`).join('')}</select>
        ${this.controlsMarkup()}<div id="original-odds" class="original-odds"></div><button type="button" id="original-play" class="original-play">Играть</button><button type="button" id="original-refresh" class="original-secondary" hidden>Восстановить партию</button><p class="original-demo-note">Бесплатные USDT</p></aside>
        <div class="original-board-wrap"><div id="original-board" class="original-board">${this.boardMarkup()}</div><div id="original-paytable" class="original-paytable"></div></div></div>
      <div id="original-result" class="original-result" role="status" aria-live="polite">${this.message}</div><section class="original-history-wrap" aria-label="История этой игры"><span class="original-label">Последние ставки</span><div id="original-history" class="original-history"></div></section>
      <details class="original-rules"><summary>Правила и выплаты</summary><p>${detail.rules}</p><p>Множители показывают полное начисление. Выплата округляется вниз до сотой USDT. Результат и баланс подтверждает сервер.</p><p id="original-rtp"></p></details>`;
    decorateImportedGame(this.root, this.gameId);
    container.replaceChildren(this.root);
    this.element<HTMLButtonElement>('#original-play').onclick = () => { void this.play(); };
    this.element<HTMLButtonElement>('#original-wallet').onclick = () => window.dispatchEvent(new Event('royal-open-wallet'));
    this.element<HTMLButtonElement>('#original-refresh').onclick = () => { void minesClient.refresh(); };
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-game-input]').forEach(control => {
      if (control.id === 'original-dice-slider') return;
      control.addEventListener('input', () => {
        if (this.isLocked()) return;
        this.lastRound = undefined; this.drawn.clear(); this.highlightedBucket = null;
        this.message = translateText('Выбери ставку и начинай.');
        if (this.gameId === 'royal-dice') this.syncDiceLimits();
        if (this.gameId === 'royal-plinko') this.drawPlinko();
        this.render();
      });
    });
    if (this.gameId === 'royal-keno') {
      this.root.querySelectorAll<HTMLButtonElement>('[data-keno-number]').forEach(button => {
        button.onclick = () => {
          if (this.isLocked()) return;
          const value = Number(button.dataset.kenoNumber);
          if (this.picks.has(value)) this.picks.delete(value); else if (this.picks.size < 10) this.picks.add(value);
          this.lastRound = undefined; this.drawn.clear(); this.message = translateText('Числа выбраны. Можно играть.'); this.render();
        };
      });
      this.element<HTMLButtonElement>('#original-keno-clear').onclick = () => { if (!this.isLocked()) { this.picks.clear(); this.drawn.clear(); this.lastRound = undefined; this.render(); } };
    }
    if (this.gameId === 'royal-mines') {
      this.root.querySelectorAll<HTMLButtonElement>('[data-mine-cell]').forEach(button => {
        button.onclick = () => { void this.mineAction('reveal', Number(button.dataset.mineCell)); };
      });
    }
    if (this.gameId === 'royal-dice') this.syncDiceLimits();
    if (this.gameId === 'royal-plinko') this.drawPlinko();
    demoWallet.addEventListener('change', this.update); demoWallet.addEventListener('settlement', this.settlement);
    minesClient.addEventListener('change', this.update); minesClient.setAccount(demoWallet.accountId);
    this.render(); void demoWallet.refresh();
    if (this.gameId === 'royal-mines' && minesClient.accountId && !minesClient.loading) void minesClient.refresh();
  }

  private element<T extends Element = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  private resetResult() {
    this.lastRound = undefined; this.drawn.clear(); this.highlightedBucket = null;
    this.message = translateText('Выбери ставку и начинай.'); this.root.dataset.result = 'idle';
    if (this.gameId === 'royal-keno') this.root.dataset.kenoPresentation = 'idle';
    if (this.gameId === 'royal-dice') {
      this.element('#original-dice-value').textContent = '00,00';
      const marker = this.element('#original-dice-marker'); marker.hidden = true;
      marker.style.removeProperty('left'); marker.querySelector('span')!.textContent = '0,00';
    } else if (this.gameId === 'royal-limbo') {
      this.element('#original-limbo-value').textContent = '1,00×';
      this.element('#original-limbo-curve').style.removeProperty('stroke-dashoffset');
    } else if (this.gameId === 'royal-plinko') {
      const ball = this.element('#original-plinko-ball');
      ball.setAttribute('hidden', ''); ball.setAttribute('cx', '320'); ball.setAttribute('cy', '13');
      this.root.querySelectorAll('[data-plinko-bucket]').forEach(bucket => bucket.classList.remove('is-hit'));
    }
  }
  private controlsMarkup() {
    if (this.gameId === 'royal-dice') return translateText(`<label class="original-label" for="original-dice-mode">Условие выигрыша</label><select id="original-dice-mode" data-game-input><option value="rollUnder">Меньше порога</option><option value="rollOver">Не меньше порога</option></select><label class="original-label" for="original-dice-target">Порог</label><input id="original-dice-target" type="number" value="50" step="0.01" data-game-input>`);
    if (this.gameId === 'royal-plinko') return tr`<label class="original-label" for="original-risk">Риск</label><select id="original-risk" data-game-input>${PLINKO_RISKS.map(risk => `<option value="${risk}" ${risk === 'medium' ? 'selected' : ''}>${riskLabels[risk]}</option>`).join('')}</select><label class="original-label" for="original-rows">Ряды</label><select id="original-rows" data-game-input>${Array.from({ length: 9 }, (_, index) => index + 8).map(rows => `<option value="${rows}" ${rows === 12 ? 'selected' : ''}>${rows}</option>`).join('')}</select>`;
    if (this.gameId === 'royal-limbo') {
      const limits = limboOdds.getLimits().targetMultiplier;
      return tr`<label class="original-label" for="original-limbo-target">Целевой множитель</label><div class="original-input-suffix"><input id="original-limbo-target" type="number" value="2" min="${limits.min}" max="${limits.max}" step="0.01" data-game-input><span>×</span></div>`;
    }
    if (this.gameId === 'royal-keno') return tr`<label class="original-label" for="original-risk">Риск</label><select id="original-risk" data-game-input>${KENO_RISKS.map(risk => `<option value="${risk}">${riskLabels[risk]}</option>`).join('')}</select><div class="original-selection"><span>Выбрано <strong id="original-keno-count">3 / 10</strong></span><button type="button" id="original-keno-clear">Очистить</button></div>`;
    return tr`<label class="original-label" for="original-mine-count">Мины на поле</label><select id="original-mine-count" data-game-input>${Array.from({ length: 24 }, (_, index) => index + 1).map(count => tr`<option value="${count}" ${count === 3 ? 'selected' : ''}>${count} мин · ${25 - count} камней</option>`).join('')}</select><div class="original-mines-score"><span>Камни <strong id="original-mines-gems">0</strong></span><span>Множитель <strong id="original-mines-multiplier">1×</strong></span></div>`;
  }
  private boardMarkup() {
    if (this.gameId === 'royal-dice') return translateText(`<div class="original-dice-display"><div class="original-die" aria-hidden="true">⚄</div><strong id="original-dice-value">00,00</strong><span>РЕЗУЛЬТАТ БРОСКА</span></div><div class="original-dice-scale"><div class="original-dice-track"><div id="original-dice-marker" hidden><span>0,00</span></div><input id="original-dice-slider" aria-label="Порог на шкале" type="range" value="50" step="0.01" data-game-input></div><div class="original-dice-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div></div>`);
    if (this.gameId === 'royal-plinko') return translateText(`<svg id="original-plinko-svg" viewBox="0 0 640 470" role="img" aria-label="Поле Plinko"><defs><radialGradient id="original-ball-fill"><stop offset="0" stop-color="#fff8df"/><stop offset="1" stop-color="#ff9b38"/></radialGradient></defs><g id="original-plinko-pins"></g><g id="original-plinko-buckets"></g><circle id="original-plinko-ball" cx="320" cy="13" r="7" fill="url(#original-ball-fill)" hidden/></svg>`);
    if (this.gameId === 'royal-limbo') return translateText(`<div class="original-limbo-orbit" aria-hidden="true"><span></span><span></span><span></span></div><svg class="original-limbo-chart" viewBox="0 0 600 360" aria-hidden="true"><path class="original-limbo-grid" d="M30 90H570M30 180H570M30 270H570M150 30V330M300 30V330M450 30V330"/><path id="original-limbo-curve" d="M30 310 C130 310 190 265 285 230 S430 100 565 45"/><circle id="original-limbo-dot" cx="565" cy="45" r="7"/></svg><div class="original-limbo-display"><span>ВЫПАВШИЙ МНОЖИТЕЛЬ</span><strong id="original-limbo-value">1,00×</strong><p>Цель <b id="original-limbo-goal">2×</b></p></div>`);
    if (this.gameId === 'royal-keno') return tr`<div class="original-grid original-keno-grid" aria-label="Выбор чисел Keno">${Array.from({ length: 40 }, (_, index) => index + 1).map(number => tr`<button type="button" data-keno-number="${number}" aria-label="Число ${number}" aria-pressed="false">${number}<span class="original-keno-gem" aria-hidden="true">◆</span></button>`).join('')}</div><p class="original-board-caption" id="original-keno-hits">Выбери от 1 до 10 чисел</p>`;
    return tr`<div class="original-grid original-mines-grid" aria-label="Поле Mines, 5 на 5">${Array.from({ length: 25 }, (_, cell) => tr`<button type="button" data-mine-cell="${cell}" aria-label="Клетка ${cell + 1}, закрыта"><span class="original-mine-cover" aria-hidden="true">✦</span><span class="original-mine-symbol" aria-hidden="true"></span></button>`).join('')}</div><p class="original-board-caption" id="original-mines-caption">Начни партию, чтобы открыть клетку</p>`;
  }

  private isLocked() { return this.working || demoWallet.busy || !!demoWallet.pending || minesClient.busy || !!minesClient.pending || demoWallet.hasExternalBusy('mines'); }
  private amount() { return Number(this.element<HTMLSelectElement>('#original-bet').value); }
  private risk() { return this.element<HTMLSelectElement>('#original-risk').value; }
  private input(): GameInput {
    if (this.gameId === 'royal-dice') return { gameMode: this.element<HTMLSelectElement>('#original-dice-mode').value as 'rollUnder' | 'rollOver', sliderValue: Number(this.element<HTMLInputElement>('#original-dice-target').value) };
    if (this.gameId === 'royal-plinko') return { rows: Number(this.element<HTMLSelectElement>('#original-rows').value), risk: this.risk() as PlinkoRisk };
    if (this.gameId === 'royal-limbo') return { targetMultiplier: Number(this.element<HTMLInputElement>('#original-limbo-target').value) };
    if (this.gameId === 'royal-keno') return { picks: [...this.picks].sort((a, b) => a - b), risk: this.risk() as KenoRisk };
    return {};
  }
  private syncDiceLimits() {
    const mode = this.element<HTMLSelectElement>('#original-dice-mode').value as 'rollUnder' | 'rollOver';
    const limits = diceOdds.getLimits(mode).sliderValue;
    const target = this.element<HTMLInputElement>('#original-dice-target'), slider = this.element<HTMLInputElement>('#original-dice-slider');
    target.min = slider.min = String(limits.min); target.max = slider.max = String(limits.max);
    slider.value = target.value;
    slider.oninput = () => { if (!this.isLocked()) { target.value = slider.value; this.lastRound = undefined; this.render(); } };
  }
  private restorePending() {
    if (this.gameId === 'royal-mines' && minesClient.pending?.action === 'start') {
      this.element<HTMLSelectElement>('#original-bet').value = String(minesClient.pending.amount);
      this.element<HTMLSelectElement>('#original-mine-count').value = String(minesClient.pending.mineCount);
    }
    const pending = demoWallet.pending;
    if (pending?.kind !== 'play' || pending.gameId !== this.gameId) return;
    this.element<HTMLSelectElement>('#original-bet').value = String(pending.amount);
    const input = pending.input;
    if ('gameMode' in input && 'sliderValue' in input) {
      this.element<HTMLSelectElement>('#original-dice-mode').value = input.gameMode;
      this.element<HTMLInputElement>('#original-dice-target').value = String(input.sliderValue); this.syncDiceLimits();
    } else if ('rows' in input && 'risk' in input) {
      const rows = this.element<HTMLSelectElement>('#original-rows');
      const changed = rows.value !== String(input.rows) || this.risk() !== input.risk;
      rows.value = String(input.rows); this.element<HTMLSelectElement>('#original-risk').value = input.risk;
      if (changed) this.drawPlinko();
    } else if ('targetMultiplier' in input) this.element<HTMLInputElement>('#original-limbo-target').value = String(input.targetMultiplier);
    else if ('picks' in input && 'risk' in input) { this.picks = new Set(input.picks); this.element<HTMLSelectElement>('#original-risk').value = input.risk; }
  }
  private render() {
    if (!this.alive) return;
    if (this.gameId === 'royal-mines') {
      const session = minesClient.session;
      observeGameOutcome(this.root, { gameId: this.gameId, account: minesClient.accountId ?? '', sessionId: session?.id ?? '', active: session?.state === 'active', busy: minesClient.busy, pending: !!minesClient.pending,
        spentUnits: String(Math.round((session?.amount ?? 0) * 100)), returnedUnits: String(Math.round((session?.payout ?? 0) * 100)) });
    }
    this.restorePending();
    const locked = this.isLocked(), session = this.gameId === 'royal-mines' ? minesClient.session : null;
    const active = session?.state === 'active';
    const ownPending = demoWallet.pending?.kind === 'play' && demoWallet.pending.gameId === this.gameId;
    this.root.dataset.pending = String(locked); this.root.dataset.working = String(this.working);
    const visibleBalance = this.kenoVisible?.account === demoWallet.accountId ? this.kenoVisible.balance : demoWallet.wallet?.balance;
    this.element('#original-balance').textContent = visibleBalance === undefined ? '…' : coins(visibleBalance);
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-game-input]').forEach(control => { control.disabled = locked || !!active; });
    this.element<HTMLButtonElement>('#original-wallet').disabled = !demoWallet.accountId || locked;
    let valid = true;
    try { this.renderOdds(); } catch { valid = false; this.element('#original-odds').textContent = translateText('Проверь настройки игры.'); }
    if (this.gameId === 'royal-keno') { this.renderKeno(); valid = valid && this.picks.size > 0; }
    if (this.gameId === 'royal-mines') this.renderMines();
    const play = this.element<HTMLButtonElement>('#original-play');
    play.textContent = this.working || demoWallet.busy || minesClient.busy ? translateText('Подтверждаем…')
      : this.gameId === 'royal-mines' && minesClient.pending ? translateText('Проверить ход')
      : ownPending ? translateText('Проверить результат')
      : active ? tr`Забрать ${coins(session.payout)} USDT`
      : this.gameId === 'royal-mines' ? translateText('Начать партию')
      : this.gameId === 'royal-plinko' ? translateText('Бросить шар') : this.gameId === 'royal-dice' ? translateText('Бросить кубик') : translateText('Играть');
    const retry = !!ownPending || (this.gameId === 'royal-mines' && !!minesClient.pending);
    play.disabled = this.working || demoWallet.busy || minesClient.busy || demoWallet.hasExternalBusy('mines') || !demoWallet.accountId
      || (!!demoWallet.pending && !ownPending) || (this.gameId !== 'royal-mines' && !!minesClient.pending)
      || (!retry && (!valid || !demoWallet.wallet || (!active && demoWallet.wallet.balance < this.amount())))
      || (this.gameId === 'royal-mines' && !retry && (!minesClient.ready || minesClient.loading || (!!active && session.revealed.length === 0)));
    const refresh = this.element<HTMLButtonElement>('#original-refresh');
    refresh.hidden = this.gameId !== 'royal-mines' || minesClient.ready || !demoWallet.accountId;
    refresh.disabled = minesClient.loading || minesClient.busy;
    refresh.textContent = minesClient.loading ? translateText('Восстанавливаем…') : translateText('Восстановить партию');
    let message = this.message;
    if (!demoWallet.accountId) message = translateText('Войди в онлайн-зал, чтобы играть на USDT.');
    else if (this.gameId === 'royal-mines' && minesClient.pending) message = minesClient.error || translateText('Предыдущий ход ожидает подтверждения. Проверь его перед следующим.');
    else if (ownPending) message = demoWallet.error || translateText('Ставка ожидает подтверждения. Нажми «Проверить результат».');
    else if (demoWallet.pending || minesClient.pending) message = translateText('Сначала проверь предыдущую операцию в её игре или кошельке.');
    else if (this.gameId === 'royal-mines' && !minesClient.ready) message = minesClient.error || translateText('Проверяем незавершённую партию…');
    else if (!locked && !active && demoWallet.wallet && demoWallet.wallet.balance < this.amount()) message = translateText('Недостаточно USDT. Нажми + у баланса или уменьши ставку.');
    else if (!locked && demoWallet.error) message = demoWallet.error;
    else if (!locked && active && !minesClient.error && this.message === translateText('Выбери ставку и начинай.')) message = session.revealed.length
      ? translateText('Партия восстановлена. Открой клетку или забери начисление.')
      : translateText('Партия восстановлена. Выбери первую клетку.');
    this.element('#original-result').textContent = message;
    this.renderHistory();
  }
  private renderOdds() {
    let label = '', rtp = 0.98, rtpNote = '';
    const odds = this.element('#original-odds');
    if (this.gameId === 'royal-dice') {
      const mode = this.element<HTMLSelectElement>('#original-dice-mode').value as 'rollUnder' | 'rollOver';
      const sliderValue = Number(this.element<HTMLInputElement>('#original-dice-target').value);
      if (!this.element<HTMLInputElement>('#original-dice-target').checkValidity()) throw new Error('Invalid threshold');
      const value = diceOdds.calculate({ gameMode: mode, sliderValue });
      rtp = getDiceRtpForStake({ gameMode: mode, sliderValue }, BigInt(this.amount()) * 100n);
      rtpNote = tr`RTP для ставки ${coins(this.amount())} USDT и выбранного порога. Учтено округление выплаты до сотой USDT. `;
      label = tr`<span>Шанс <strong>${percent(value.winChance)}%</strong></span><span>Начисление <strong>${multiplierText(value.multiplier)}</strong></span>`;
      const track = this.element('.original-dice-track'); track.setAttribute('style', `--dice-threshold:${sliderValue}%;`); track.setAttribute('data-mode', mode);
      this.element<HTMLInputElement>('#original-dice-slider').value = String(sliderValue);
    } else if (this.gameId === 'royal-limbo') {
      const input = this.element<HTMLInputElement>('#original-limbo-target');
      if (!input.checkValidity()) throw new Error('Invalid target');
      const value = limboOdds.calculate({ targetMultiplier: Number(input.value) });
      rtp = getLimboRtp(value.targetMultiplier);
      rtpNote = translateText('RTP для выбранной цели. Учтены округления выпавшего множителя. ');
      label = tr`<span>Шанс <strong>${percent(getLimboWinProbability(value.targetMultiplier) * 100)}%</strong></span><span>Начисление <strong>${multiplierText(value.targetMultiplier)}</strong></span>`;
      this.element('#original-limbo-goal').textContent = multiplierText(value.targetMultiplier);
    } else if (this.gameId === 'royal-plinko') {
      const rows = Number(this.element<HTMLSelectElement>('#original-rows').value), risk = this.risk() as PlinkoRisk;
      const table = getPlinkoMultipliers(rows, risk); rtp = getPlinkoRtp(rows, risk);
      label = tr`<span>Ряды <strong>${rows}</strong></span><span>Максимум <strong>${multiplierText(Math.max(...table))}</strong></span>`;
    } else if (this.gameId === 'royal-keno') {
      const table = this.picks.size ? getKenoMultipliers(this.picks.size, this.risk() as KenoRisk) : [0];
      if (this.picks.size) rtp = getKenoRtp(this.picks.size, this.risk() as KenoRisk);
      label = tr`<span>Числа <strong>${this.picks.size} / 10</strong></span><span>Максимум <strong>${multiplierText(Math.max(...table))}</strong></span>`;
      const hitCount = this.lastRound?.gameId === 'royal-keno' ? this.lastRound.outcome.hits.length : -1;
      this.element('#original-paytable').innerHTML = table.map((value, hits) => tr`<div class="original-pay-cell ${hits === hitCount ? 'is-hit' : ''}"><span>${hits} совп.</span><strong>${multiplierText(value)}</strong></div>`).join('');
    } else {
      const session = minesClient.session;
      const count = session?.state === 'active' ? session.mineCount : Number(this.element<HTMLSelectElement>('#original-mine-count').value);
      const next = session?.state === 'active' ? session.nextMultiplier : minesOdds.getMultiplier(count, 1);
      const revealCount = session?.state === 'active' ? Math.min(session.revealed.length + 1, 25 - count) : 1;
      rtp = getMinesRtp(count, revealCount);
      const gemsWord = revealCount % 10 === 1 && revealCount % 100 !== 11 ? translateText('камня') : translateText('камней');
      rtpNote = tr`RTP для выплаты после ${revealCount} ${gemsWord}. Округление множителей учтено. `;
      label = tr`<span>Следующий камень <strong>${next == null ? translateText('Все открыты') : multiplierText(next)}</strong></span>`;
    }
    odds.innerHTML = label;
    this.element('#original-rtp').textContent = this.gameId === 'royal-keno' && !this.picks.size
      ? translateText('Выбери числа, чтобы увидеть RTP таблицы.')
      : tr`Теоретический RTP ${percent(rtp * 100)}%. ${rtpNote}Это средний возврат на большой дистанции, отдельный раунд случаен.`;
  }
  private renderKeno() {
    const locked = this.isLocked();
    this.element('#original-keno-count').textContent = `${this.picks.size} / 10`;
    this.element<HTMLButtonElement>('#original-keno-clear').disabled = locked;
    this.root.querySelectorAll<HTMLButtonElement>('[data-keno-number]').forEach(button => {
      const number = Number(button.dataset.kenoNumber), selected = this.picks.has(number), drawn = this.drawn.has(number);
      button.classList.toggle('is-selected', selected); button.classList.toggle('is-drawn', drawn); button.classList.toggle('is-hit', selected && drawn);
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', tr`Число ${number}${selected ? translateText(', выбрано') : ''}${drawn ? translateText(', выпало') : ''}`);
      button.disabled = locked || (!selected && this.picks.size >= 10);
    });
    const hits = [...this.drawn].filter(number => this.picks.has(number)).length;
    this.element('#original-keno-hits').textContent = this.drawn.size ? tr`Выпало ${this.drawn.size} из 10 · Совпадения: ${hits}` : translateText('Выбери от 1 до 10 чисел');
  }
  private renderMines() {
    const session = minesClient.session, active = session?.state === 'active', locked = this.isLocked();
    if (active) {
      this.element<HTMLSelectElement>('#original-bet').value = String(session.amount);
      this.element<HTMLSelectElement>('#original-mine-count').value = String(session.mineCount);
    }
    const mineCells = active ? [] : session?.mineCells ?? [];
    this.root.querySelectorAll<HTMLButtonElement>('[data-mine-cell]').forEach(button => {
      const cell = Number(button.dataset.mineCell), revealed = session?.revealed.includes(cell) ?? false;
      const mine = mineCells.includes(cell), gem = revealed && !mine;
      button.classList.toggle('is-revealed', revealed); button.classList.toggle('is-gem', gem); button.classList.toggle('is-mine', mine);
      button.classList.toggle('is-finished', !!session && !active);
      button.disabled = !active || locked || revealed || !minesClient.ready || minesClient.loading;
      button.querySelector('.original-mine-symbol')!.textContent = mine ? '✹' : gem ? '◆' : '';
      button.setAttribute('aria-label', tr`Клетка ${cell + 1}, ${mine ? translateText('мина') : gem ? translateText('камень') : translateText('закрыта')}`);
    });
    this.element('#original-mines-gems').textContent = String(session ? session.revealed.filter(cell => !mineCells.includes(cell)).length : 0);
    this.element('#original-mines-multiplier').textContent = multiplierText(session?.multiplier ?? 1);
    this.element('#original-mines-caption').textContent = active ? translateText('Открой клетку или забери начисление') : session?.state === 'lost' ? translateText('Мина. Партия завершена.') : session?.state === 'cashed_out' ? tr`Начислено ${coins(session.payout)} USDT` : translateText('Начни партию, чтобы открыть клетку');
  }
  private renderHistory() {
    const walletEntries = this.kenoVisible?.account === demoWallet.accountId ? this.kenoVisible.entries : demoWallet.wallet?.entries;
    const entries = walletEntries?.filter(entry => entry.source === this.gameId) ?? [];
    const groups = new Map<string, { stake?: number; payout?: number }>();
    for (const entry of entries) {
      if (!groups.has(entry.operationId)) groups.set(entry.operationId, {});
      const item = groups.get(entry.operationId)!;
      if (entry.kind === 'bet') item.stake = (item.stake ?? 0) - entry.amount;
      if (entry.kind === 'win') item.payout = (item.payout ?? 0) + entry.amount;
    }
    const container = this.element('#original-history'); container.replaceChildren();
    for (const item of [...groups.values()].filter(item => item.stake !== undefined || item.payout !== undefined).slice(0, 6)) {
      const chip = document.createElement('div'); chip.className = 'original-history-chip';
      if (item.stake !== undefined && item.payout !== undefined) chip.dataset.result = item.payout >= item.stake ? 'win' : 'loss';
      const stake = document.createElement('span'), payout = document.createElement('strong');
      stake.textContent = item.stake === undefined ? translateText('Ставка вне текущей истории') : tr`Ставка ${coins(item.stake)}`;
      payout.textContent = item.payout === undefined ? translateText('Партия начата') : tr`${coins(item.payout)} USDT`;
      chip.append(stake, payout); container.append(chip);
    }
    if (!container.childElementCount) container.textContent = translateText('Здесь появятся подтверждённые ставки.');
  }

  private async play() {
    if (this.working) return;
    if (this.gameId === 'royal-mines') { await this.mineAction(minesClient.session?.state === 'active' ? 'cashout' : 'start'); return; }
    const ownPending = demoWallet.pending?.kind === 'play' && demoWallet.pending.gameId === this.gameId;
    if ((demoWallet.pending && !ownPending) || minesClient.busy || minesClient.pending || demoWallet.busy) return;
    const epoch = this.accountEpoch;
    if (this.gameId === 'royal-keno') {
      this.lastRound = undefined;
      this.root.dataset.kenoPresentation = 'pending';
      if (!ownPending && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.kenoVisible = { account: demoWallet.accountId, balance: demoWallet.wallet?.balance, entries: demoWallet.wallet?.entries.map(entry => ({ ...entry })) ?? [] };
      }
    }
    this.highlightedBucket = null;
    this.root.querySelectorAll('[data-plinko-bucket]').forEach(bucket => bucket.classList.remove('is-hit'));
    this.working = true; this.message = translateText('Сервер подтверждает ставку…'); this.root.dataset.result = 'idle'; this.drawn.clear(); this.render();
    try {
      const result = ownPending ? await demoWallet.retry() : await demoWallet.play(this.gameId, this.input(), this.amount());
      if (this.alive && epoch === this.accountEpoch && result.gameRound) await this.showRound(result.gameRound, this.gameId === 'royal-keno' ? !ownPending : true);
    } catch (error) { if (this.alive && epoch === this.accountEpoch) this.message = error instanceof Error ? translateText(error.message) : translateText('Не удалось подтвердить результат.'); }
    finally { if (this.alive && epoch === this.accountEpoch) { this.kenoVisible = undefined; this.working = false; this.render(); } }
  }
  private async mineAction(action: 'start' | 'reveal' | 'cashout', cell?: number) {
    if (this.working || demoWallet.busy || demoWallet.pending || minesClient.busy || !minesClient.accountId) return;
    if (!minesClient.pending && (!minesClient.ready || minesClient.loading)) return;
    const session = minesClient.session;
    if (!minesClient.pending && action !== 'start' && (!session || session.state !== 'active')) return;
    const epoch = this.accountEpoch;
    let completed: {spentUnits:string;returnedUnits:string} | undefined;
    this.working = true; this.message = translateText('Сервер подтверждает ход…'); this.render();
    try {
      const operation = action === 'start' ? { action, amount: this.amount(), mineCount: Number(this.element<HTMLSelectElement>('#original-mine-count').value) }
        : action === 'reveal' ? { action, sessionId: session!.id, cell: cell! } : { action, sessionId: session!.id };
      const result = minesClient.pending ? await minesClient.retry() : await minesClient.act(operation as Omit<MinesOperation, 'id'>);
      if (!this.alive || epoch !== this.accountEpoch || !result.session) return;
      if (result.session.state !== 'active') completed = {spentUnits:String(Math.round(result.session.amount*100)),returnedUnits:String(Math.round(result.session.payout*100))};
      this.root.dataset.result = result.session.state === 'lost' ? 'loss' : result.session.state === 'cashed_out' ? 'win' : 'idle';
      this.message = result.session.state === 'lost' ? translateText('Попалась мина. Можно начать новую партию.')
        : result.session.state === 'cashed_out' ? tr`Начислено ${coins(result.session.payout)} USDT. Партия завершена.`
        : result.session.revealed.length ? tr`Камень открыт. ${multiplierText(result.session.multiplier)}. Можно забрать начисление или продолжить.` : translateText('Партия началась. Выбери первую клетку.');
    } catch (error) { if (this.alive && epoch === this.accountEpoch) this.message = error instanceof Error ? translateText(error.message) : translateText('Не удалось подтвердить ход.'); }
    finally { if (this.alive && epoch === this.accountEpoch) { this.working = false; this.render(); if(completed)emitImportedOutcome(this.root,{gameId:this.gameId,...completed}); } }
  }
  private async showRound(round: GameRound, animate: boolean) {
    if (!this.alive || round.gameId !== this.gameId) return;
    const accountId = demoWallet.accountId, epoch = this.accountEpoch;
    let presentationLanded = animate;
    if (round.gameId !== 'royal-keno' || !this.kenoVisible) this.lastRound = round;
    const payout = Number(round.payoutUnits) / 100, stake = Number(round.stakeUnits) / 100;
    if (round.gameId === 'royal-keno') {
      this.root.dataset.kenoPresentation = 'drawing';
      if (this.kenoVisible?.balance !== undefined) this.kenoVisible.balance = Math.max(0, this.kenoVisible.balance - stake);
    }
    this.message = translateText('Результат подтверждён. Показываем…');
    if (round.gameId === 'royal-keno') this.render();
    try {
      if (round.gameId === 'royal-dice') {
        const marker = this.element('#original-dice-marker'); marker.hidden = false;
        await this.animation(animate ? 500 : 0, progress => {
          const value = round.outcome.rolledValue * progress;
          this.element('#original-dice-value').textContent = decimal(value);
          marker.style.left = `${Math.min(98, Math.max(2, value))}%`; marker.querySelector('span')!.textContent = decimal(value);
        });
      } else if (round.gameId === 'royal-limbo') {
        await this.animation(animate ? 850 : 0, progress => {
          const value = 1 + (round.outcome.rolledMultiplier - 1) * (1 - Math.pow(1 - progress, 3));
          this.element('#original-limbo-value').textContent = `${decimal(value)}×`;
          this.element('#original-limbo-curve').setAttribute('style', `stroke-dashoffset:${1000 * (1 - progress)};`);
        });
      } else if (round.gameId === 'royal-plinko') {
        await this.animatePlinko(round.outcome.path, animate);
      } else if (round.gameId === 'royal-keno') {
        this.drawn.clear();
        presentationLanded = await this.animation(animate ? 1000 : 0, progress => {
          this.drawn = new Set(round.outcome.drawnNumbers.slice(0, Math.ceil(progress * 10))); this.renderKeno();
        });
      }
    } catch {
      presentationLanded = false;
      // The server has settled the round, so a visual failure must not block play.
    }
    if (!this.alive || accountId !== demoWallet.accountId || epoch !== this.accountEpoch) return;
    if (round.gameId === 'royal-keno') {
      this.lastRound = round; this.kenoVisible = undefined;
      this.root.dataset.kenoPresentation = 'settled';
    }
    if (round.gameId === 'royal-dice') {
      this.element('#original-dice-value').textContent = decimal(round.outcome.rolledValue);
      const marker = this.element('#original-dice-marker'); marker.hidden = false;
      marker.style.left = `${Math.min(98, Math.max(2, round.outcome.rolledValue))}%`;
      marker.querySelector('span')!.textContent = decimal(round.outcome.rolledValue);
    } else if (round.gameId === 'royal-limbo') {
      this.element('#original-limbo-value').textContent = `${decimal(round.outcome.rolledMultiplier)}×`;
      this.element('#original-limbo-curve').style.strokeDashoffset = '0';
    } else if (round.gameId === 'royal-keno') {
      this.drawn = new Set(round.outcome.drawnNumbers); this.renderKeno();
    } else if (round.gameId === 'royal-plinko') {
      const ball = this.element('#original-plinko-ball'); ball.removeAttribute('hidden');
      ball.setAttribute('cx', String(320 + (round.outcome.bucket - round.input.rows / 2) * 550 / (round.input.rows + 2)));
      ball.setAttribute('cy', '420');
      this.highlightedBucket = round.outcome.bucket;
      this.root.querySelectorAll('[data-plinko-bucket]').forEach(bucket => bucket.classList.toggle('is-hit', Number((bucket as SVGElement).dataset.plinkoBucket) === this.highlightedBucket));
    }
    this.root.dataset.result = payout >= stake ? 'win' : 'loss';
    const prefix = round.gameId === 'royal-dice' ? tr`Выпало ${decimal(round.outcome.rolledValue)}. `
      : round.gameId === 'royal-limbo' ? tr`Выпало ${multiplierText(round.outcome.rolledMultiplier)}. `
      : round.gameId === 'royal-keno' ? tr`Совпадений: ${round.outcome.hits.length}. ` : '';
    this.message = prefix + (payout > 0 ? tr`Начислено ${coins(payout)} USDT · ${multiplierText(round.multiplier)}` : tr`Без выплаты. Ставка ${coins(stake)} USDT.`);
    this.render();
    if (animate && presentationLanded && !document.hidden) {
      emitGameOutcome(this.root, round.stakeUnits, round.payoutUnits);
      emitImportedOutcome(this.root, {gameId:this.gameId,spentUnits:round.stakeUnits,returnedUnits:round.payoutUnits});
    }
  }
  private drawPlinko() {
    const rows = Number(this.element<HTMLSelectElement>('#original-rows').value), table = getPlinkoMultipliers(rows, this.risk() as PlinkoRisk);
    const spacing = 550 / (rows + 2), rowHeight = 380 / rows;
    const pins = this.element('#original-plinko-pins'), buckets = this.element('#original-plinko-buckets');
    pins.replaceChildren(); buckets.replaceChildren();
    for (let row = 0; row < rows; row++) for (let pin = 0; pin < row + 3; pin++) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(320 + (pin - (row + 2) / 2) * spacing)); circle.setAttribute('cy', String(40 + row * rowHeight)); circle.setAttribute('r', String(rows > 13 ? 3 : 3.7)); pins.append(circle);
    }
    table.forEach((value, bucket) => {
      const group = document.createElementNS(SVG_NS, 'g'), rect = document.createElementNS(SVG_NS, 'rect'), text = document.createElementNS(SVG_NS, 'text');
      const x = 320 + (bucket - rows / 2) * spacing;
      group.dataset.plinkoBucket = String(bucket); group.style.setProperty('--bucket-hue', String(8 + 42 * (1 - Math.abs(bucket - rows / 2) / (rows / 2))));
      rect.setAttribute('x', String(x - spacing / 2 + 1)); rect.setAttribute('y', '427'); rect.setAttribute('width', String(spacing - 2)); rect.setAttribute('height', '30'); rect.setAttribute('rx', '5');
      text.setAttribute('x', String(x)); text.setAttribute('y', '446'); text.setAttribute('font-size', rows > 13 ? '9' : '11'); text.textContent = `${value}×`;
      const title = document.createElementNS(SVG_NS, 'title'); title.textContent = tr`Карман ${bucket + 1}: ${multiplierText(value)}`;
      group.append(title, rect, text); buckets.append(group);
    });
    this.element('#original-plinko-ball').setAttribute('hidden', '');
  }
  private async animatePlinko(path: number[], animate: boolean) {
    const rows = path.length, spacing = 550 / (rows + 2), rowHeight = 380 / rows;
    const points = [{ x: 320, y: 12 }]; let x = 320;
    path.forEach((direction, row) => { x += direction === 1 ? spacing / 2 : -spacing / 2; points.push({ x, y: 40 + row * rowHeight + rowHeight / 2 }); });
    points.push({ x, y: 420 });
    const ball = this.element('#original-plinko-ball'); ball.removeAttribute('hidden');
    await this.animation(animate ? 1200 : 0, progress => {
      const step = Math.min(points.length - 2, Math.floor(progress * (points.length - 1))), local = Math.min(1, progress * (points.length - 1) - step);
      const start = points[step], end = points[step + 1];
      ball.setAttribute('cx', String(start.x + (end.x - start.x) * local));
      ball.setAttribute('cy', String(start.y + (end.y - start.y) * local - Math.sin(local * Math.PI) * 6));
    });
  }
  private animation(duration: number, frame: (progress: number) => void) {
    this.cancelAnimation?.();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (!duration || document.hidden || motion.matches) { if (this.alive) frame(1); return Promise.resolve(this.alive && !document.hidden); }
    return new Promise<boolean>((resolve, reject) => {
      const start = performance.now(); let request = 0, finished = false;
      const finish = (error?: unknown, landed = false) => {
        if (finished) return;
        finished = true; cancelAnimationFrame(request); clearTimeout(timeout);
        document.removeEventListener('visibilitychange', visibility);
        motion.removeEventListener('change', reduced);
        if (this.cancelAnimation === cancel) this.cancelAnimation = undefined;
        if (error !== undefined) reject(error); else resolve(landed);
      };
      const cancel = () => finish();
      const draw = (progress: number) => {
        try { frame(progress); } catch (error) { finish(error); return false; }
        return true;
      };
      const complete = () => { if (!finished) { if (this.alive) draw(1); finish(); } };
      const visibility = () => { if (document.hidden) complete(); };
      const reduced = () => { if (motion.matches) complete(); };
      // RAF can stop in background tabs or embedded browsers. Always finish the confirmed result.
      const timeout = window.setTimeout(complete, duration + 250);
      this.cancelAnimation = cancel;
      document.addEventListener('visibilitychange', visibility);
      motion.addEventListener('change', reduced);
      const tick = (now: number) => {
        if (finished) return;
        if (!this.alive) { finish(); return; }
        const progress = Math.min(1, Math.max(0, (now - start) / duration));
        if (!draw(progress)) return;
        if (progress < 1) request = requestAnimationFrame(tick); else finish(undefined, true);
      };
      request = requestAnimationFrame(tick);
    });
  }
  destroy() {
    this.alive = false; this.kenoVisible = undefined; this.cancelAnimation?.();
    demoWallet.removeEventListener('change', this.update); demoWallet.removeEventListener('settlement', this.settlement);
    minesClient.removeEventListener('change', this.update); this.root.remove();
  }
}
