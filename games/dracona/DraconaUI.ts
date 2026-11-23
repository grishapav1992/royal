import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {stakeRulesHtml} from '../../src/ui/stakeRules';
import {ROYAL_GAME_BETS as DRACONA_BETS, validGameBet, gameBetCents} from '../../src/shared/gameStakes';
import { CREST, SIZE, SYMBOLS, DRACONA_MATH, type Grid, type Step } from '../../src/shared/draconaMath';
import { CharacterDirector } from './character';
import { MagicEffects } from './effects';
import { Autoplay, AUTO_SPIN_COUNTS } from './autoplay';
import { DraconaAudio } from './audio';
import { CabinetBoard, reducedMotion } from './board';
import { SceneLayout, wandTip } from './layout';
import { draconaText as T } from './text';
import { readGameHost } from '../../src/modules/GameHostContract';
import { language, locale } from '../../src/i18n/index';
import { DRACONA_GAME, DRACONA_RULES, type DraconaView } from '../../src/shared/dracona';
import { syncStakeSelect } from '../../src/ui/stakeSelection';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const amount = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CREST_IMAGE = '/assets/dracona/crest.webp';
const icons = {
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7v.1"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8q4 4 0 8M19 5q7 7 0 14"/>',
  arrow: '<path d="M19 7v5h-5M19 12a7 7 0 1 0-1 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  volumeOff: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const initial: Grid = [0, 1, 2, 3, 4, 4, 5, 0, 2, 1, 3, 1, 5, 2, 4, 3, 1, 0, 4, 2];
/** Presentation only. The factor scales every phase of a spin. */
const SPEEDS = {
  normal: { factor: 1, gap: 450 },
  fast: { factor: 0.5, gap: 220 },
  turbo: { factor: 0.26, gap: 120 },
} as const;
type Speed = keyof typeof SPEEDS;
type Tone = 'quiet' | 'win' | 'big';
const BIG_WIN = 10;

export class Dracona {
  private hostServices = readGameHost();
  private client = this.hostServices.expansionClient;
  private wallet = this.hostServices.demoWallet;
  private get currency() { return this.wallet.wallet?.asset === 'USDT_NILE_TEST' ? 'USDT' : T('тестовых монет'); }
  private get unit() { return this.wallet.wallet?.asset === 'USDT_NILE_TEST' ? 'USDT' : T('тест. монеты'); }
  private document: Document;
  private window: Window;
  private controller = new AbortController();
  private owner = this.client.accountId;
  private presented = '';
  private stopAudio?: () => void;
  private changed = () => this.sync();
  private get session() { return this.client.sessions.find(session => session.gameId === DRACONA_GAME); }
  private get balance() { return this.wallet.accountId === this.client.accountId ? (this.wallet.wallet?.balance ?? this.client.wallet?.balance ?? 0) : 0; }
  private root: HTMLElement;
  private board: CabinetBoard;
  private layout: SceneLayout;
  private hero: CharacterDirector;
  private effects: MagicEffects;
  private audio: DraconaAudio;
  private runes = Array(SIZE).fill(1) as number[];
  private shown: Grid = [...initial];
  private bet = 0.1;
  private busy = false;
  private bonusRemaining = 0;
  private bonusIssued = 0;
  private bonusPlayed = 0;
  private bonusTotal = 0;
  private bonusSpinActive = false;
  private lockedBet = 0.1;
  private transfers = 0;
  private crests = 0;
  private speed: Speed = 'normal';
  private spinSpeed: Speed = 'normal';
  private autoplay: Autoplay;
  private autoCount: number = AUTO_SPIN_COUNTS[0];
  private autoAccepted = 0;
  private alive = true;
  private bets: number[] = [...DRACONA_BETS];
  private dialog: HTMLDialogElement;
  private autoDialog: HTMLDialogElement;
  /** Resolves with true after the player confirms the open result. */
  private answer?: Promise<boolean>;
  private confirmed = false;
  private counting = 0;
  /** The balance before the payout of the round being shown. */
  private heldBalance?: number;

  constructor(private host: HTMLElement) {
    this.document = host.ownerDocument;
    this.window = this.document.defaultView!;
    host.innerHTML = this.markup();
    this.root = host.querySelector<HTMLElement>('.game')!;
    this.dialog = this.find<HTMLDialogElement>('#dialog');
    this.autoDialog = this.find<HTMLDialogElement>('#auto-dialog');
    this.layout = new SceneLayout(this.root, () => this.board?.refresh());
    this.board = new CabinetBoard(this.find('#board'), this.find('#marks'), this.root.querySelector<SVGSVGElement>('#contour')!, this.find('#floating-layer'), this.find('#reserve-grid'), () => this.layout.current);
    this.hero = new CharacterDirector(this.find('#hero'), T('Героиня с волшебной палочкой'));
    this.audio = new DraconaAudio(this.hostServices.gameAudio, this.document, fetch, state => { this.root.dataset.audioState = JSON.stringify(state); });
    this.effects = new MagicEffects(this.find<HTMLCanvasElement>('#magic-canvas'), kind => { void this.audio.play(kind === 'win' ? 'cascade' : kind); });
    this.restart();
    this.autoplay = new Autoplay(async () => {
      if (this.autoplay.state.completed > 0) await pause(SPEEDS[this.speed].gap);
      if (!this.alive || this.autoplay.state.stopping || this.bonusRemaining > 0) return false;
      return this.spin(true);
    }, () => this.controls(), () => this.finishRound());
    this.bind();
    this.client.addEventListener('change', this.changed);
    this.wallet.addEventListener('change', this.changed);
    this.stopAudio = this.hostServices.gameAudio.onPreferences(preferences => {
      this.effects.enabled = !preferences.muted;
      const sound = this.find('#sound');
      sound.innerHTML = icon(this.effects.enabled ? 'sound' : 'volumeOff');
      sound.setAttribute('aria-pressed', String(this.effects.enabled));
      sound.setAttribute('aria-label', T(this.effects.enabled ? 'Выключить звук' : 'Включить звук'));
    });
    this.sync();
    void this.client.refresh();
  }

  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }

  private markup() {
    const counts = AUTO_SPIN_COUNTS.map(count => `<button type="button" role="radio" class="auto-count" data-auto-count="${count}" aria-checked="${count === this.autoCount}" tabindex="${count === this.autoCount ? 0 : -1}">${count}</button>`).join('');
    const crests = [0, 1, 2].map(() => `<img src="${CREST_IMAGE}" alt="" draggable="false">`).join('');
    return `<main class="game" data-phase="idle" data-bonus="false" data-shut="false" data-tone="quiet">
      <div class="manor" aria-hidden="true"></div><div class="night" aria-hidden="true"></div>
      <div class="hero resting" id="hero"><img class="hero-layer visible" src="/assets/dracona/hero-idle-a.png" alt=""><img class="hero-layer" alt="" aria-hidden="true"></div>
      <section class="cabinet" aria-label="${T('Игровое поле')}">
        <div class="door door-left" aria-hidden="true"><i></i></div><div class="door door-right" aria-hidden="true"></div>
        <header class="crown"><div class="crown-face"><div class="crests" id="crests" role="img">${crests}</div><h1>${T('Дракона')}</h1></div></header>
        <div class="frame"><div class="board" id="board" role="grid" aria-label="${T('Поле: пять столбцов и четыре строки')}" aria-rowcount="4" aria-colcount="5"></div>
          <svg class="contour" id="contour" aria-hidden="true" preserveAspectRatio="none"><path d=""/></svg>
          <div class="leaves" aria-hidden="true"><div class="leaf leaf-left"><i></i><b></b></div><div class="leaf leaf-right"><i></i><b></b></div><span class="seam"></span></div>
          <div class="marks" id="marks" aria-hidden="true"></div></div>
        <div class="foot" aria-hidden="true"><span></span><i></i><span></span></div>
        <div class="plaque"><div class="plaque-text"><p id="status" role="status" aria-live="polite"></p><small id="win-note"></small></div><strong id="win-value"></strong></div>
      </section>
      <aside class="niche">
        <div class="exchange"><span class="niche-label">${T('По ту сторону')}</span><div class="reserve" id="reserve-grid" aria-label="${T('Символы для обмена через шкаф')}"></div><div class="transfer"><div class="transfer-dots" id="transfer-dots" aria-hidden="true"><i></i><i></i><i></i></div><span class="niche-label" id="transfer-count"></span></div></div>
        <div class="memory"><div class="crests niche-crests" aria-hidden="true">${crests}</div><div class="memory-text"><strong id="bonus-label"></strong><p id="bonus-description"></p></div><div class="saved" id="saved"><span class="niche-label">${T('Накоплено')}</span><strong id="bonus-total"></strong><span class="niche-label" id="bonus-unit"></span></div></div>
      </aside>
      <section class="controls" aria-label="${T('Управление игрой')}">
        <div class="balance-value"><span class="control-label"><span id="balance-label"></span><span class="label-unit" id="balance-unit"></span></span><strong id="balance"></strong></div>
        <div class="bet-control"><span class="control-label" id="bet-label"></span><div><button type="button" id="bet-down" class="bet-step" aria-label="${T('Уменьшить ставку')}">−</button><select id="bet-select" aria-label="${T('Ставка за вращение')}">${this.bets.map(value => `<option value="${value}">${amount(value)}</option>`).join('')}</select><button type="button" id="bet-up" class="bet-step" aria-label="${T('Увеличить ставку')}">+</button></div></div>
        <label class="speed-control"><span class="button-top">${T('Скорость')}</span><select id="speed" aria-label="${T('Скорость вращений')}"><option value="normal">${T('Обычная')}</option><option value="fast">${T('Быстрая')}</option><option value="turbo">${T('Турбо')}</option></select></label>
        <button type="button" id="autoplay" class="autoplay-button" aria-haspopup="dialog"><span class="button-top" id="auto-top"></span><span class="button-main" id="auto-main"></span></button>
        <button type="button" id="spin" class="spin-button"><span class="spin-text"><span class="spin-label"></span><small class="spin-price"></small></span>${icon('arrow')}</button>
      </section>
      <div class="tools"><button type="button" id="sound" class="icon-button" aria-pressed="false">${icon('volumeOff')}</button><button type="button" id="rules" class="icon-button" aria-label="${T('Правила игры')}">${icon('info')}</button></div>
      <canvas id="magic-canvas" aria-hidden="true"></canvas><div class="floating-layer" id="floating-layer" aria-hidden="true"></div>
      <dialog id="dialog"><div class="rain" id="rain" aria-hidden="true"></div><button type="button" id="dialog-close" class="dialog-close" aria-label="${T('Закрыть')}">${icon('close')}</button><div id="dialog-content"></div></dialog>
      <dialog id="auto-dialog" aria-labelledby="auto-title"><button type="button" id="auto-close" class="dialog-close" aria-label="${T('Закрыть')}">${icon('close')}</button>
        <span class="eyebrow" id="auto-price"></span><h2 id="auto-title">${T('Автоигра')}</h2><div class="auto-counts" role="radiogroup" aria-label="${T('Платных вращений')}">${counts}</div>
        <p>${T('Бесплатные вращения не расходуют серию. Остановить её можно в любой момент.')}</p>
        <div class="dialog-actions"><button type="button" class="dialog-secondary" id="auto-cancel">${T('Отмена')}</button><button type="button" class="dialog-primary" id="autoplay-start">${T('Старт')}</button></div></dialog>
    </main>`;
  }

  private bind() {
    const signal = this.controller.signal;
    this.find('#spin').addEventListener('click', () => void this.spin());
    this.find('#bet-down').addEventListener('click', () => this.changeBet(-1));
    this.find('#bet-up').addEventListener('click', () => this.changeBet(1));
    this.find('#bet-select').addEventListener('change', () => {
      const value = Number(this.find<HTMLSelectElement>('#bet-select').value);
      if (!this.busy && !this.autoplay.state.active && !this.bonusRemaining && validGameBet(value)) { this.bet = value; this.controls(); }
    });
    this.find('#rules').addEventListener('click', () => this.showRules());
    this.find('#sound').addEventListener('click', () => {
      void this.hostServices.gameAudio.unlock();
      this.hostServices.gameAudio.setMuted(!this.hostServices.gameAudio.getPreferences().muted);
    });
    this.find('#speed').addEventListener('change', () => {
      const speed = this.find<HTMLSelectElement>('#speed').value;
      if (speed === 'normal' || speed === 'fast' || speed === 'turbo') this.speed = speed;
    });
    this.find('#autoplay').addEventListener('click', () => {
      if (this.autoplay.state.active) { this.autoplay.stop(); return; }
      this.openAutoplay();
    });
    const counts = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-auto-count]'));
    const choose = (button: HTMLButtonElement) => {
      this.autoCount = Number(button.dataset.autoCount);
      for (const item of counts) { item.setAttribute('aria-checked', String(item === button)); item.tabIndex = item === button ? 0 : -1; }
    };
    counts.forEach((button, index) => {
      button.addEventListener('click', () => choose(button));
      button.addEventListener('keydown', event => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = counts[(index + step + counts.length) % counts.length];
        choose(next); next.focus();
      });
    });
    this.find('#autoplay-start').addEventListener('click', () => this.startAutoplay());
    for (const selector of ['#auto-close', '#auto-cancel']) this.find(selector).addEventListener('click', () => this.autoDialog.close());
    this.find('#dialog-close').addEventListener('click', () => this.dialog.close());
    for (const dialog of [this.dialog, this.autoDialog]) dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    this.autoDialog.addEventListener('close', () => { if (this.alive) this.find('#autoplay').focus({ preventScroll: true }); });
    this.window.addEventListener('keydown', event => {
      if (event.code === 'Space' && !this.dialog.open && !this.autoDialog.open && event.target === this.document.body) { event.preventDefault(); void this.spin(); }
    }, { signal });
    this.document.addEventListener('visibilitychange', () => { if (this.document.hidden) this.pause(); }, { signal });
    this.window.addEventListener('pagehide', () => { this.destroy(); }, { once: true, signal });
  }

  private changeBet(direction: number) {
    if (this.busy || this.autoplay.state.active || this.bonusRemaining > 0) return;
    const next = direction > 0 ? this.bets.find(value => value > this.bet) : [...this.bets].reverse().find(value => value < this.bet);
    if (next !== undefined) this.bet = next;
    this.controls();
  }

  /** The shared service accepts a new operation from this game right now. */
  private available() {
    const ready = !!this.client.accountId && this.client.accountId === this.wallet.accountId && (this.wallet.wallet !== undefined || this.client.wallet !== undefined);
    const blocked = this.client.busy || this.client.loading || this.wallet.busy || !!this.wallet.pending || this.wallet.hasExternalBusy('expansion');
    return { ready, blocked };
  }

  private controls() {
    const free = this.bonusRemaining > 0, auto = this.autoplay.state, pending = this.client.pending;
    const { ready, blocked } = this.available();
    const retry = pending?.gameId === DRACONA_GAME, locked = this.busy || auto.active || blocked || !!pending;
    const bonus = free || this.bonusSpinActive;
    this.find('#balance-label').textContent = T('Баланс');
    this.find('#balance-unit').textContent = ', ' + this.unit;
    const balance = this.find('#balance');
    balance.textContent = amount(this.heldBalance ?? this.balance); balance.dataset.long = String(balance.textContent.length > 8);
    this.find('#bet-label').textContent = `${T(bonus ? 'Ставка бонуса' : 'Ставка')}, ${this.unit}`;
    const selected = Number(syncStakeSelect(this.find<HTMLSelectElement>('#bet-select'), String(free ? this.lockedBet : this.bet), this.bets, locked || free, 1));
    if (!free) this.bet = selected;
    const spin = this.find<HTMLButtonElement>('#spin');
    spin.disabled = !ready || this.busy || auto.active || blocked || (pending ? !retry : !free && this.balance < this.bet);
    const working = this.busy || this.client.busy;
    this.find('.spin-label').textContent = T(working ? 'МАГИЯ' : retry ? 'ПРОВЕРИТЬ' : free ? 'БЕСПЛАТНО' : 'ВРАЩАТЬ');
    this.find('.spin-price').textContent = retry && !working ? T('раунд без новой ставки') : bonus ? T('без новой ставки') : T('за {0} {1}', amount(working ? this.lockedBet : this.bet), this.unit);
    this.find<HTMLButtonElement>('#rules').disabled = this.busy;
    this.find<HTMLButtonElement>('#bet-down').disabled = locked || free || this.bet === this.bets[0];
    this.find<HTMLButtonElement>('#bet-up').disabled = locked || free || this.bet === this.bets.at(-1);
    const autoButton = this.find<HTMLButtonElement>('#autoplay'), left = Math.max(0, auto.total - this.autoAccepted);
    autoButton.disabled = auto.active ? auto.stopping : !ready || locked || free || this.balance < this.bet;
    this.find('#auto-top').textContent = auto.active ? auto.stopping ? T('Завершаем') : T('Осталось {0}', left) : T('Автоигра');
    this.find('#auto-main').textContent = T(auto.active ? auto.stopping ? 'Стоп…' : 'Стоп' : 'Выбрать');
    autoButton.setAttribute('aria-label', auto.active ? T('Остановить автоигру, осталось {0}', left) : T('Открыть автоигру'));
    autoButton.dataset.active = String(auto.active);
    this.root.dataset.bonus = String(bonus);
    this.root.setAttribute('aria-busy', String(this.busy));
    this.find('#bonus-label').textContent = bonus ? T('{0} из {1}', this.bonusPlayed, this.bonusIssued) : T('Память поместья');
    this.find('#bonus-description').textContent = T(bonus ? 'Бесплатные вращения' : '3 герба дают 8 бесплатных вращений');
    this.find('#bonus-total').textContent = amount(this.bonusTotal);
    this.find('#bonus-unit').textContent = this.unit;
    this.find('#transfer-count').textContent = T('Переносы: {0} из 3', this.transfers);
    this.find('#transfer-dots').querySelectorAll('i').forEach((dot, index) => dot.classList.toggle('lit', index < this.transfers));
  }

  private draw(grid: Grid) { this.shown = [...grid]; this.board.draw(grid, this.runes); }

  /** Lights only the crests that the confirmed field has already shown. */
  private showCrests(count: number) {
    this.crests = Math.min(3, count);
    this.root.querySelectorAll('.crests').forEach(row => [1, 0, 2].forEach((position, order) => row.children[position].classList.toggle('lit', order < this.crests)));
    this.find('#crests').setAttribute('aria-label', T('Гербы на поле: {0} из 3', this.crests));
  }
  private observeCrests(grid: Grid) { this.showCrests(Math.max(this.crests, grid.filter(symbol => symbol === CREST).length)); }

  private report(title: string, note = '', value = '', tone: Tone = 'quiet') {
    this.counting++;
    this.find('#status').textContent = this.hostServices.i18n.translateMessage(title);
    this.find('#win-note').textContent = this.hostServices.i18n.translateMessage(note);
    this.find('#win-value').textContent = value;
    this.root.dataset.tone = tone;
  }

  private async count(target: HTMLElement, from: number, to: number, prefix: string, duration: number) {
    const token = ++this.counting;
    if (!reducedMotion() && duration > 0) {
      const started = performance.now();
      for (;;) {
        const t = (performance.now() - started) / duration;
        if (t >= 1) break;
        target.textContent = prefix + amount(from + (to - from) * t);
        await pause(32);
        if (!this.alive || token !== this.counting) return;
      }
    }
    if (token === this.counting) target.textContent = prefix + amount(to);
  }

  private wait(ms: number) { return pause(reducedMotion() ? 0 : Math.round(ms * SPEEDS[this.spinSpeed].factor)); }
  private get factor() { return SPEEDS[this.spinSpeed].factor; }
  private shut(value: boolean) { this.root.dataset.shut = String(value); }

  private applyView(view: DraconaView) {
    this.bonusRemaining = view.remaining;
    this.bonusIssued = view.bonusAwarded;
    this.bonusPlayed = view.freePlayed;
    this.bonusTotal = Number(this.session?.state === 'settled' ? this.session.returnedUnits : view.totalPayoutUnits) / 100;
    this.lockedBet = Number(this.session!.stakeUnits) / 100;
    this.presented = this.session!.id + ':' + view.revision;
  }

  private sync() {
    if (!this.alive) return;
    if (this.owner !== this.client.accountId) {
      this.audio.cancel(); this.board.cancel(); this.effects.clear();
      this.owner = this.client.accountId;
      this.autoplay.stop(); this.heldBalance = undefined;
      this.presented = '';
      this.bonusRemaining = 0; this.bonusIssued = 0; this.bonusPlayed = 0; this.bonusTotal = 0; this.transfers = 0;
      if (this.dialog.open) this.dialog.close();
      if (this.autoDialog.open) this.autoDialog.close();
      if (!this.busy) this.restart();
    }
    const session = this.session, view = session?.view.dracona;
    if (!this.busy && view && this.presented !== session!.id + ':' + view.revision) {
      this.applyView(view);
      const result = view.history.at(-1)!.result;
      this.runes = [...result.runes]; this.draw(result.grid); this.board.drawReserve(result.reserve);
      this.transfers = result.transfers; this.showCrests(result.crestCount);
      const value = result.payout > 0 ? amount(result.payout) : '';
      if (view.remaining) this.report(T('Бонус сохранен'), T('Осталось вращений: {0}', this.bonusRemaining), value);
      else this.report(T('Последний результат'), T('Восстановлен сохранённый раунд'), value);
    }
    if (!this.busy && !view && !this.presented) this.resting();
    if (!this.client.accountId) this.report(T('Вход не выполнен'), T('Войди в аккаунт Royal для игры на {0}', this.currency));
    else if (canRecoverOperation(this.client) && !this.busy) this.report(T('Раунд не завершён'), T(this.client.pending?.gameId === DRACONA_GAME ? 'Проверь сохраненный ход. Повторного списания не будет.' : 'Сначала проверь незавершенный ход в другой игре.'));
    this.controls();
  }

  private resting() { this.runes.fill(1); this.draw(initial); this.board.drawReserve([0, 1, 2, 3]); this.showCrests(0); }
  private restart() {
    this.resting();
    this.report(T('Собери 5 одинаковых рядом'), T('Группы исчезают, сверху падают новые'));
  }

  private async spin(automatic = false): Promise<boolean> {
    if (this.busy || this.dialog.open || this.autoDialog.open || !this.alive || (this.autoplay.state.active && !automatic)) return false;
    const { ready, blocked } = this.available();
    if (!ready || blocked) return false;
    const account = this.client.accountId, before = this.session, wasFree = before?.state === 'active';
    if (!this.client.pending && !wasFree && this.balance < this.bet) { this.report(T('Не хватает средств'), T('Недостаточно {0}', this.currency)); return false; }
    this.spinSpeed = this.speed;
    const opening = this.client.pending ? undefined : this.balance - (wasFree ? 0 : this.bet);
    this.busy = true; this.transfers = 0; this.answer = undefined;
    if (!wasFree) this.lockedBet = this.bet;
    this.bonusSpinActive = wasFree;
    this.board.cancel(); this.effects.clear(); this.showCrests(0);
    this.root.dataset.phase = 'waiting'; this.shut(!reducedMotion());
    this.root.style.setProperty('--factor', String(this.factor));
    this.report(T('Подтверждаем ход'), T(wasFree ? 'Бесплатное вращение, ставка не списывается' : 'Двери шкафа откроются с результатом'));
    this.controls();
    const closing = performance.now();
    let completed = false, accepted = false;
    try {
      void this.hostServices.gameAudio.unlock();
      if (this.client.pending) {
        if (this.client.pending.gameId !== DRACONA_GAME) return false;
        await this.client.retry();
      } else if (wasFree) {
        await this.client.act({ gameId: DRACONA_GAME, action: 'move', sessionId: before.id, move: 'dracona-spin', revision: before.view.dracona!.revision });
      } else {
        await this.client.act({ gameId: DRACONA_GAME, action: 'start', stakeUnits: String(gameBetCents(this.bet)), settings: { dracona: { mode: 'normal' } } });
      }
      if (!this.alive || account !== this.client.accountId) return false;
      const session = this.session, view = session?.view.dracona;
      if (!session || !view) throw Error(T('Результат не подтвержден. Проверь сохраненный ход.'));
      accepted = true; this.heldBalance = opening;
      if (automatic && view.revision === 1) this.autoAccepted++;
      const result = view.history.at(-1)!.result, free = view.revision > 1;
      const collected = Number(view.totalPayoutUnits) / 100 - result.payout;
      this.bonusSpinActive = free;
      this.lockedBet = Number(session.stakeUnits) / 100;
      this.runes = free ? [...view.history[view.history.length - 2].result.runes] : Array(SIZE).fill(1);
      if (free) { this.bonusPlayed = view.freePlayed; this.bonusIssued = view.bonusAwarded - result.bonusAward; this.bonusTotal = collected; }
      this.root.dataset.phase = 'spinning'; this.controls();
      this.audio.begin(this.spinSpeed);
      void this.hero.cast().catch(error => console.error(error)); this.effects.cue('cast');
      if (this.layout.current.hero) this.effects.cast(wandTip(this.find('#hero').getBoundingClientRect()), this.find('#board').getBoundingClientRect(), this.factor);
      // The doors finish closing and the spell reaches them before the confirmed field appears.
      if (!reducedMotion()) await pause(Math.max(430 * this.factor, 520 * this.factor - (performance.now() - closing)));
      for (const step of result.steps) {
        if (!this.alive || account !== this.client.accountId) return false;
        await this.present(step, free);
      }
      if (!this.alive || account !== this.client.accountId) return false;
      this.runes = [...result.runes]; this.draw(result.grid); this.board.drawReserve(result.reserve);
      this.applyView(view); this.heldBalance = undefined;
      const entered = result.bonusAward > 0 && !free, ended = free && view.remaining === 0;
      const paid = session.state === 'settled' && !free ? Number(session.returnedUnits) / 100 : result.payout;
      this.conclude(paid, result.bonusAward, free);
      this.controls();
      await this.hero.react(result.bonusAward > 0 ? 'bonus' : paid > 0 ? 'win' : 'neutral', this.spinSpeed === 'turbo' || (!free && paid < this.lockedBet && !result.bonusAward));
      if (!this.alive || account !== this.client.accountId) return false;
      if (entered) this.showBonus(result.bonusAward);
      else if (ended) this.showBonusResult();
      completed = true;
    } catch (error) {
      this.autoplay.stop();
      if (this.alive && account === this.client.accountId) {
        this.report(T('Ход не подтверждён'), this.client.error || (error instanceof Error ? error.message : T('Не удалось подтвердить ход. Проверь сохраненную операцию.')));
        await this.hero.react('neutral').catch(() => {});
      }
    } finally {
      this.busy = false; this.bonusSpinActive = false; this.heldBalance = undefined; this.shut(false); this.root.dataset.phase = 'idle';
      if (this.alive) { if (!completed) { this.board.cancel(); this.effects.clear(); if (accepted) this.presented = ''; } this.sync(); }
    }
    return completed;
  }

  /** The confirmed total of a paid round. A bonus keeps its own total until it ends. */
  private conclude(paid: number, award: number, free: boolean) {
    if (award > 0 && !free) this.report(T('Три герба'), T('Бесплатных вращений: {0}', award), paid > 0 ? amount(paid) : '', 'win');
    else if (free) this.report(T(paid > 0 ? 'Вращение принесло' : 'Обмен завершён'), award > 0 ? T('Бесплатных вращений: {0}', '+' + award) : T('Выплата всей серии после бонуса'), paid > 0 ? '+' + amount(paid) : '', paid > 0 ? 'win' : 'quiet');
    else if (paid === 0) { this.report(T('Магия затихла'), T('Сделай новый взмах')); void this.audio.play('fizzle'); }
    else if (paid < this.lockedBet) this.report(T('Выплата раунда'), T('Меньше ставки раунда'), `${amount(paid)} ${this.unit}`);
    else {
      const big = paid >= this.lockedBet * BIG_WIN;
      this.report(T('Выигрыш раунда'), T('Начислено на баланс'), `${amount(paid)} ${this.unit}`, big ? 'big' : 'win');
      if (big) { void this.audio.play('finish'); this.effects.dust(this.board.cells.map(cell => cell.getBoundingClientRect()), 1.6); }
    }
  }

  private async present(step: Step, free: boolean) {
    if (step.type === 'initial') {
      this.draw(step.grid); this.board.drawReserve(step.reserve);
      this.shut(false);
      this.report(T('Собери 5 одинаковых рядом'), T('Группы исчезают, сверху падают новые'));
      const duration = this.board.fall(this.factor);
      const landing = setTimeout(() => { if (this.alive) void this.audio.play('settle'); }, duration * 0.55);
      await pause(duration);
      clearTimeout(landing);
      if (!this.alive) return;
      if (duration === 0) void this.audio.play('settle');
      this.observeCrests(step.grid);
      await this.wait(220);
    }
    if (step.type === 'win') {
      this.root.dataset.phase = 'winning'; this.effects.cue('win');
      this.board.highlight(step.clusters, amount);
      const largest = step.clusters.reduce((a, b) => b.payout > a.payout ? b : a), factor = Math.max(...step.clusters.map(cluster => cluster.factor));
      this.report(`${T(SYMBOLS[largest.symbol].short)} × ${largest.cells.length}${factor > 1 ? `, ${T('руна')} ×${factor}` : ''}`, T(free ? 'Сумма добавится к накопленному в бонусе' : 'Промежуточная сумма раунда'), '', 'win');
      void this.count(this.find('#win-value'), step.total - step.payout, step.total, '+', 380 * this.factor);
      await this.wait(1000);
      if (!this.alive) return;
      this.effects.dust(this.board.vanish(), this.factor);
      await this.wait(300);
    }
    if (step.type === 'drop') {
      this.root.dataset.phase = 'falling'; this.draw(step.grid);
      const duration = this.board.drop(step.movements, this.factor);
      const landing = setTimeout(() => { if (this.alive) void this.audio.play('settle'); }, duration * 0.6);
      await pause(duration + (reducedMotion() ? 0 : 60 * this.factor));
      clearTimeout(landing);
      if (this.alive) this.observeCrests(step.grid);
    }
    if (step.type === 'portal') {
      this.root.dataset.phase = 'portal'; this.effects.cue('portal');
      this.report(T('Исчезающий шкаф'), T('Перенос {0} из 3: блок меняется местами с резервом', step.number), this.find('#win-value').textContent ?? '', this.root.dataset.tone as Tone);
      this.board.target(step.cells);
      await this.wait(360);
      if (!this.alive) return;
      await this.board.swap(step.cells, step.reserveBefore, step.cells.map(index => this.shown[index]) as Grid, 880 * this.factor);
      if (!this.alive) return;
      this.runes = [...step.runes]; this.transfers = step.number;
      this.draw(step.grid); this.board.drawReserve(step.reserveAfter); this.board.arrived(step.cells);
      this.observeCrests(step.grid); this.controls();
      await this.wait(520);
    }
  }

  private openAutoplay() {
    const button = this.find<HTMLButtonElement>('#autoplay');
    if (button.disabled || this.busy || this.dialog.open || this.autoDialog.open || !this.alive) return;
    this.find('#auto-price').textContent = T('Каждое вращение стоит {0} {1}', amount(this.bet), this.unit);
    this.autoDialog.showModal();
    this.root.querySelector<HTMLButtonElement>(`[data-auto-count="${this.autoCount}"]`)?.focus();
  }

  private startAutoplay() {
    if (!this.autoDialog.open || this.busy || this.autoplay.state.active || this.bonusRemaining > 0) return;
    this.autoDialog.close();
    this.autoAccepted = 0;
    void this.autoplay.start(this.autoCount).catch(error => { this.report(T('Ход не подтверждён'), error instanceof Error ? error.message : ''); console.error(error); });
  }

  /** Free continuations belong to the counted paid spin. A dismissed result ends the series. */
  private async finishRound() {
    while (this.alive && !this.autoplay.state.stopping) {
      if (this.answer) {
        const confirmed = await this.answer;
        this.answer = undefined;
        if (!confirmed) { this.autoplay.stop(); return; }
      }
      if (this.bonusRemaining <= 0) return;
      await pause(SPEEDS[this.speed].gap);
      if (!this.alive || this.autoplay.state.stopping) return;
      if (!await this.spin(true)) { this.autoplay.stop(); return; }
    }
  }

  private showDialog(title: string, body: string, eyebrow: string) {
    this.confirmed = false;
    this.find('#rain').replaceChildren();
    this.find('#dialog-content').innerHTML = `<span class="eyebrow">${eyebrow}</span><h2>${title}</h2>${body}<button type="button" class="dialog-primary" id="dialog-continue">${T('ПРОДОЛЖИТЬ')}</button>`;
    this.find('#dialog-continue').addEventListener('click', () => { this.confirmed = true; this.dialog.close(); });
    this.answer = new Promise(resolve => this.dialog.addEventListener('close', () => {
      this.find('#rain').replaceChildren();
      resolve(this.confirmed);
    }, { once: true }));
    this.dialog.showModal();
    this.find('#dialog-continue').focus({ preventScroll: true });
  }

  private showBonus(count: number) {
    this.effects.cue('bonus');
    this.showDialog(T('Память поместья'), `<img class="dialog-emblem" src="${CREST_IMAGE}" alt="${T('Фамильный герб')}"><div class="bonus-count">${count}<span>${T('бесплатных вращений')}</span></div><p>${T('Шкаф открывается на каждом вращении. Переносы оставляют серебряные руны от ×2 до ×5. Зачарованный резерв иногда приносит четыре одинаковых символа.')}</p>`, T('Поместье пробуждается'));
    void this.answer?.then(() => { if (this.alive && !this.busy && this.bonusRemaining > 0) this.report(T('Бонус открыт'), T('Перенос будет в каждом вращении')); });
  }

  private showBonusResult() {
    const total = this.bonusTotal, big = total >= this.lockedBet * BIG_WIN;
    void this.audio.play('finish');
    this.showDialog(T('Магия сохранена'), `<img class="dialog-emblem" src="${CREST_IMAGE}" alt="${T('Фамильный герб')}"><div class="bonus-count"><b id="bonus-result"></b><span>${T('{0} за бонус', this.currency)}</span></div><p>${T('Серебряные руны гаснут. Поместье снова ждет твоего заклинания.')}</p>`, T('Бонус завершён'));
    if (big && !reducedMotion()) this.find('#rain').append(...Array.from({ length: 30 }, (_, i) => {
      const drop = this.document.createElement('i');
      drop.style.cssText = `left:${(i * 137) % 100}%;--size:${7 + (i % 4) * 3}px;animation-duration:${2200 + (i * 211) % 1500}ms;animation-delay:${(i * 83) % 1400}ms`;
      return drop;
    }));
    void this.count(this.find('#bonus-result'), 0, total, '', total > 0 ? 900 : 0);
    this.runes.fill(1); this.draw(this.shown); this.showCrests(0);
    void this.answer?.then(() => { if (this.alive && !this.busy) this.report(T('Бонус завершён'), T('Начислено на баланс'), `${amount(total)} ${this.unit}`, big ? 'big' : total > 0 ? 'win' : 'quiet'); });
  }

  private showRules() {
    if (this.busy || this.dialog.open || this.autoDialog.open) return;
    this.autoplay.stop();
    const legacy = this.session?.view.dracona?.version === 1;
    const prices = [2.5, 5.5, 12, 30, 80].map(value => (value * (legacy ? 1 : DRACONA_MATH.payNumerator / DRACONA_MATH.payDenominator)).toLocaleString(locale, { maximumFractionDigits: 6 }));
    const rounding = T(this.currency === 'USDT' ? legacy ? 'целого USDT' : '0,01 USDT вниз для каждой группы' : legacy ? 'целой тестовой монеты' : '0,01 тестовой монеты вниз для каждой группы');
    const part = (title: string, text: string) => `<p><b>${T(title)}</b> ${text}</p>`;
    this.showDialog(T('Тайны шкафа'), `<div class="rules-copy" tabindex="0">${
      part('Автоигра.', T('Выбери 10, 25, 50 или 100 платных вращений и нажми «Старт». Бесплатные вращения проходят сами и не расходуют серию. «Стоп» завершает текущее вращение и отменяет остаток. Серия также останавливается при закрытии итога бонуса, открытии правил, нехватке средств или ошибке.'))}${
      part('Скорость.', T('Обычная, быстрая или турбо. Изменение применяется со следующего вращения.'))}${
      part('Каскады.', T('Пять одинаковых символов, соединенных по горизонтали или вертикали, дают выигрыш. Они исчезают, остальные падают, сверху приходят новые. До 8 каскадов за вращение.'))}${
      part('Переносы.', T('Символ шкафа дает обмен участка 2 × 2 с четырьмя символами по ту сторону. После обмена поле снова проверяется. До 3 переносов за вращение.'))}${
      part('Память поместья.', T('Три герба на одном показе поля открывают 8 бесплатных вращений. Во время бонуса три герба добавляют еще 2, максимум 20 за серию. Ставка фиксируется при входе в бонус. В 45% бонусных вращений резерв зачарован: все четыре его символа одинаковые.'))}${
      part('Серебряные руны.', T('В бонусе каждый перенос повышает руны своих клеток на один, от ×2 до ×5. Для группы берется наибольшая руна, множители не перемножаются. После бонуса руны сбрасываются.'))}${
      part('Выплаты за группу.', T('5–6 символов: {0} ставки; 7–8: {1}; 9–11: {2}; 12–15: {3}; 16–20: {4}. Затем применяется ценность символа: зелье ×1,3, кольцо ×1,2, книга ×1,1, ключ ×1, изумруд ×0,9, перо ×0,8, и руна. Итог округляется до {5}.', ...prices, rounding))}<p>${T(DRACONA_RULES)}</p>${stakeRulesHtml(language === 'en')}</div>`, T('НАСЛЕДИЕ МАЛФОЕВ'));
    this.answer = undefined;
  }

  pause() { this.autoplay.stop(); this.audio.cancel(); this.effects.clear(); }
  getState() { return { gameId: DRACONA_GAME, ready: !!this.client.accountId, busy: this.busy, remaining: this.bonusRemaining, autoplay: this.autoplay.state, accepted: this.autoAccepted, layout: this.layout.current.profile, audio: this.audio.getState() }; }
  destroy() {
    if (!this.alive) return;
    this.alive = false; this.autoplay.stop(); this.controller.abort();
    this.client.removeEventListener('change', this.changed); this.wallet.removeEventListener('change', this.changed);
    this.layout.destroy(); this.board.cancel(); this.stopAudio?.(); this.audio.destroy(); this.hero.destroy(); this.effects.destroy();
    for (const dialog of [this.dialog, this.autoDialog]) if (dialog.open) dialog.close();
    this.host.replaceChildren();
  }
}
