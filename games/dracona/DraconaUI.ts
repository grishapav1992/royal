import { COLS, CREST, PORTAL, SIZE, SYMBOLS, DRACONA_MATH, type Grid, type Movement, type Step } from '../../src/shared/draconaMath';
import { CharacterDirector } from './character';
import { MagicEffects } from './effects';
import { Autoplay } from './autoplay';
import { DraconaAudio } from './audio';
import { readGameHost } from '../../src/modules/GameHostContract';
import { locale } from '../../src/i18n/index';
import { DRACONA_GAME, DRACONA_BETS, DRACONA_RULES, type DraconaView } from '../../src/shared/dracona';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const amount = (value: number) => value.toLocaleString(locale);
const asset = (symbol: number) => `/assets/dracona/${SYMBOLS[symbol].file}`;
const image = (symbol: number) => `<img src="${asset(symbol)}" alt="${SYMBOLS[symbol].name}" draggable="false">`;
const icons = {
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7v.1"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8q4 4 0 8M19 5q7 7 0 14"/>',
  arrow: '<path d="M19 7v5h-5M19 12a7 7 0 1 0-1 5"/>',
  chevron: '<path d="m8 4 8 8-8 8"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  volumeOff: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const initial: Grid = [0, 1, 2, 3, 4, 4, 5, 0, 1, 2, 1, 2, 4, 3, 5, 2, 0, 3, 4, 1];
const SPEEDS = {
  normal: { factor: 1, spin: 1050, tick: 85, drop: 420, transfer: 850, gap: 450 },
  fast: { factor: 0.45, spin: 400, tick: 55, drop: 180, transfer: 380, gap: 220 },
  turbo: { factor: 0.2, spin: 160, tick: 35, drop: 100, transfer: 200, gap: 120 },
} as const;
type Speed = keyof typeof SPEEDS;

export class Dracona {
  private hostServices = readGameHost();
  private client = this.hostServices.expansionClient;
  private wallet = this.hostServices.demoWallet;
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
  private board: HTMLElement;
  private reserve: HTMLElement;
  private cells: HTMLElement[] = [];
  private hero: CharacterDirector;
  private effects: MagicEffects;
  private audio: DraconaAudio;
  private grid = [...initial];
  private runes = Array(SIZE).fill(1) as number[];
  private reserveGrid: Grid = [0, 1, 2, 3];
  private bet = 100;
  private busy = false;
  private bonusRemaining = 0;
  private bonusIssued = 0;
  private bonusTotal = 0;
  private bonusSpinActive = false;
  private lockedBet = 100;
  private transfers = 0;
  private speed: Speed = 'normal';
  private spinSpeed: Speed = 'normal';
  private autoplay: Autoplay;
  private alive = true;
  private spinNumber = 0;
  private bets: number[] = [...DRACONA_BETS];
  private review = false;
  private dialog: HTMLDialogElement;

  constructor(private host: HTMLElement) {
    this.document = host.ownerDocument;
    this.window = this.document.defaultView!;
    host.innerHTML = this.hostServices.i18n.t(this.markup());
    this.root = host.querySelector<HTMLElement>('.game')!;
    this.board = this.find('#board');
    this.reserve = this.find('#reserve-grid');
    this.dialog = this.find<HTMLDialogElement>('#dialog');
    this.hero = new CharacterDirector(this.find('#hero'));
    this.audio = new DraconaAudio(this.hostServices.gameAudio, this.document, fetch, state => { this.root.dataset.audioState = JSON.stringify(state); });
    this.effects = new MagicEffects(this.find<HTMLCanvasElement>('#magic-canvas'), kind => { void this.audio.play(kind === 'win' ? 'cascade' : kind); });
    this.cells = Array.from({ length: SIZE }, (_, index) => {
      const cell = this.document.createElement('div');
      cell.className = 'cell'; cell.setAttribute('role', 'gridcell'); cell.dataset.index = String(index);
      this.board.append(cell); return cell;
    });
    this.draw(this.grid);
    this.drawReserve(this.reserveGrid);
    this.autoplay = new Autoplay(async () => {
      if (this.autoplay.state.completed > 0) await pause(SPEEDS[this.speed].gap);
      if (!this.alive || this.autoplay.state.stopping) return false;
      return this.spin(undefined, true);
    }, () => this.controls());
    this.bind();
    this.client.addEventListener('change', this.changed);
    this.wallet.addEventListener('change', this.changed);
    this.stopAudio = this.hostServices.gameAudio.onPreferences(preferences => {
      this.effects.enabled = !preferences.muted;
      const sound = this.find('#sound');
      sound.innerHTML = icon(this.effects.enabled ? 'sound' : 'volumeOff');
      sound.setAttribute('aria-pressed', String(this.effects.enabled));
      sound.setAttribute('aria-label', this.effects.enabled ? 'Выключить звук' : 'Включить звук');
    });
    this.sync();
    void this.client.refresh();
    this.document.fonts.ready.then(() => this.root.classList.add('ready')).catch(() => this.root.classList.add('ready'));
  }

  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }

  private markup() {
    return `<main class="game" data-phase="idle" data-bonus="false">
      <div class="manor" aria-hidden="true"></div><div class="atmosphere" aria-hidden="true"></div>
      <header class="topbar"><span class="brand"><span class="brand-stone"></span>ROYAL<span class="brand-caption">PRIVATE COLLECTION</span></span><span class="edition">ЛУННОЕ ПОМЕСТЬЕ · ДЕМО</span><div class="tools"><button id="sound" class="icon-button" aria-label="Включить звук" aria-pressed="false">${icon('volumeOff')}</button><button id="rules" class="icon-button" aria-label="Правила игры">${icon('info')}</button></div></header>
      <section class="title-block" aria-labelledby="game-title"><span class="eyebrow">МАГИЯ ХРАНИТ СВОИ ТАЙНЫ</span><h1 id="game-title">Дракона</h1><p><span></span>НАСЛЕДИЕ МАЛФОЕВ<span></span></p></section>
      <div class="play-area">
        <aside class="character-area"><div class="hero resting" id="hero"><img class="hero-layer visible" src="/assets/dracona/hero-idle-a.png" alt="Героиня с волшебной палочкой"><img class="hero-layer" alt="" aria-hidden="true"></div><div class="hero-caption"><i></i><span id="hero-caption">Каждый шкаф хранит секрет.</span></div></aside>
        <section class="cabinet-area" aria-label="Игровое поле"><div class="cabinet">
          <div class="door door-left" aria-hidden="true"><span class="door-diamond"></span></div><div class="door door-right" aria-hidden="true"><span class="door-diamond"></span></div>
          <div class="cabinet-crown" aria-hidden="true"><span></span><img src="/assets/dracona/crest.webp" alt=""><span></span></div>
          <div class="board-frame"><div class="board" id="board" role="grid" aria-label="Поле: пять столбцов и четыре строки" aria-rowcount="4" aria-colcount="5"></div><div class="board-flash" aria-hidden="true"></div></div>
          <div class="cabinet-foot" aria-hidden="true"><span></span>✧<span></span></div>
        </div><div class="status-strip"><span class="status-dot"></span><p id="status" role="status" aria-live="polite">Собери 5 одинаковых символов рядом</p><span class="round-marker" id="round-marker">01</span></div></section>
        <aside class="portal-area"><div class="portal-card"><span class="eyebrow">ПО ТУ СТОРОНУ</span><div class="reserve-frame"><div class="reserve" id="reserve-grid" aria-label="Символы для обмена через шкаф"></div></div><h2>Исчезающий<br>шкаф</h2><p>Четыре символа.<br>Один магический обмен.</p><div class="transfer-dots" id="transfer-dots" aria-label="Переносы"><i></i><i></i><i></i></div></div><div class="bonus-card" id="bonus-card"><img src="/assets/dracona/crest.webp" alt="Фамильный герб"><div><strong id="bonus-label">Память поместья</strong><p id="bonus-description">3 герба открывают бонус</p></div></div></aside>
      </div>
      <section class="controls" aria-label="Управление игрой"><div class="balance-value"><span class="control-label">БАЛАНС</span><strong id="balance">10 000</strong><small>тестовых монет</small></div><div class="bet-control"><span class="control-label">СТАВКА</span><div><button id="bet-down" class="bet-step" aria-label="Уменьшить ставку">−</button><strong id="bet-value">100</strong><button id="bet-up" class="bet-step" aria-label="Увеличить ставку">+</button></div></div><div class="win-value"><span class="control-label">ВЫИГРЫШ</span><strong id="win-value">0</strong><small id="win-note">за вращение</small></div><button id="spin" class="spin-button"><span class="spin-label">ВРАЩАТЬ</span>${icon('arrow')}</button>
        <div class="playback-controls"><label class="speed-control"><span class="control-label">СКОРОСТЬ</span><select id="speed" aria-label="Скорость вращений"><option value="normal">Обычная</option><option value="fast">Быстрая</option><option value="turbo">Турбо</option></select></label><div class="auto-control"><label class="control-label" for="autoplay-count">АВТО</label><select id="autoplay-count" aria-label="Количество автовращений"><option value="10">10</option><option value="25">25</option><option value="50">50</option></select><button id="autoplay" class="autoplay-button" aria-label="Запустить автовращения">СТАРТ</button></div><span id="autoplay-progress" class="autoplay-progress" role="status" aria-live="polite">10 подряд</span></div>
      </section>
      <footer class="bottom-line"><span>5 × 4 · Каскады · Магические переносы</span><span id="bottom-hint">Шкаф меняет блоки 2 × 2</span><span class="demo-badge">ДЕМО</span></footer>
      ${this.review ? `<div class="review-controls" aria-label="Просмотр сцен"><span>Просмотр сцен</span><button data-scene="portal">Перенос</button><button data-scene="bonus">Бонус</button><button data-scene="miss">Спокойная реакция</button></div>` : ''}
      <canvas id="magic-canvas" aria-hidden="true"></canvas><div class="floating-layer" id="floating-layer" aria-hidden="true"></div>
      <dialog id="dialog"><button id="dialog-close" class="dialog-close" aria-label="Закрыть">${icon('close')}</button><div id="dialog-content"></div></dialog>
    </main>`;
  }

  private bind() {
    this.find('#spin').addEventListener('click', () => void this.spin());
    this.find('#bet-down').addEventListener('click', () => this.changeBet(-1));
    this.find('#bet-up').addEventListener('click', () => this.changeBet(1));
    this.find('#rules').addEventListener('click', () => this.showRules());
    this.find('#sound').addEventListener('click', () => {
      void this.hostServices.gameAudio.unlock();
      this.hostServices.gameAudio.setMuted(!this.hostServices.gameAudio.getPreferences().muted);
    });
    this.find('#speed').addEventListener('change', () => {
      const speed = this.find<HTMLSelectElement>('#speed').value;
      if (speed === 'normal' || speed === 'fast' || speed === 'turbo') this.speed = speed;
    });
    this.find('#autoplay-count').addEventListener('change', () => this.controls());
    this.find('#autoplay').addEventListener('click', () => {
      if (this.autoplay.state.active) { this.autoplay.stop(); return; }
      if (this.busy || this.dialog.open || !this.alive) return;
      const count = Number(this.find<HTMLSelectElement>('#autoplay-count').value);
      if (![10, 25, 50].includes(count)) return;
      void this.autoplay.start(count).catch(error => { this.status('Автовращения остановлены. Можно продолжить вручную.'); console.error(error); });
    });
    this.find('#dialog-close').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', event => { if (event.target === this.dialog) { const r = this.dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.dialog.close(); } });
    this.root.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => button.addEventListener('click', () => void this.spin(button.dataset.scene as 'portal' | 'bonus' | 'miss')));
    this.window.addEventListener('keydown', event => { if (event.code === 'Space' && !this.dialog.open && event.target === this.document.body) { event.preventDefault(); void this.spin(); } }, { signal: this.controller.signal });
    this.window.addEventListener('pagehide', () => { this.destroy(); }, { once: true, signal: this.controller.signal });
  }

  private changeBet(direction: number) { if (this.busy || this.autoplay.state.active || this.bonusRemaining > 0) return; const index = this.bets.indexOf(this.bet); this.bet = this.bets[Math.max(0, Math.min(this.bets.length - 1, index + direction))]; this.controls(); }

  private controls() {
    const free = this.bonusRemaining > 0;
    const auto = this.autoplay.state;
    const pending = this.client.pending;
    const ready = !!this.client.accountId && this.client.accountId === this.wallet.accountId && (this.wallet.wallet !== undefined || this.client.wallet !== undefined);
    const blocked = this.client.busy || this.client.loading || this.wallet.busy || !!this.wallet.pending || this.wallet.hasExternalBusy('expansion');
    const retry = pending?.gameId === DRACONA_GAME;
    const locked = this.busy || auto.active || blocked || !!pending;
    this.find('#balance').textContent = amount(this.balance);
    this.find('#bet-value').textContent = amount(free ? this.lockedBet : this.bet);
    const spin = this.find<HTMLButtonElement>('#spin'); spin.disabled = !ready || this.busy || auto.active || blocked || (pending ? !retry : !free && this.balance < this.bet);
    spin.querySelector('.spin-label')!.textContent = this.busy || this.client.busy ? 'МАГИЯ…' : retry ? 'ПРОВЕРИТЬ' : free ? 'БЕСПЛАТНО' : 'ВРАЩАТЬ';
    this.find<HTMLButtonElement>('#bet-down').disabled = locked || free || this.bet === this.bets[0];
    this.find<HTMLButtonElement>('#bet-up').disabled = locked || free || this.bet === this.bets.at(-1);
    this.find<HTMLSelectElement>('#autoplay-count').disabled = locked;
    const autoButton = this.find<HTMLButtonElement>('#autoplay');
    autoButton.disabled = auto.active ? auto.stopping : !ready || locked || (!free && this.balance < this.bet);
    autoButton.textContent = auto.active ? auto.stopping ? 'СТОП…' : 'СТОП' : 'СТАРТ';
    autoButton.setAttribute('aria-label', auto.active ? 'Остановить автовращения' : 'Запустить автовращения');
    autoButton.dataset.active = String(auto.active);
    this.find('#autoplay-progress').textContent = auto.active
      ? auto.stopping ? 'Завершаем спин' : `Готово: ${auto.completed} / ${auto.total}`
      : auto.total > 0 ? `${auto.completed === auto.total ? 'Завершено' : 'Остановлено'}: ${auto.completed} / ${auto.total}`
      : `${this.find<HTMLSelectElement>('#autoplay-count').value} подряд`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => { button.disabled = locked; });
    this.root.dataset.bonus = String(free || this.bonusSpinActive);
    this.root.setAttribute('aria-busy', String(this.busy));
    this.find('#bonus-label').textContent = free ? 'Память поместья' : 'Память поместья';
    this.find('#bonus-description').textContent = free ? `Осталось вращений: ${this.bonusRemaining}` : '3 герба открывают бонус';
    this.find('#bottom-hint').textContent = free ? 'Серебряные руны сохраняются в бонусе' : 'Шкаф меняет блоки 2 × 2';
  }

  private draw(grid: Grid, movements?: Movement[]) {
    const cellHeight = this.cells[0]?.getBoundingClientRect().height || 90;
    this.cells.forEach((cell, index) => {
      const symbol = grid[index], rune = this.runes[index];
      cell.className = 'cell' + (symbol === PORTAL ? ' portal-symbol' : symbol === CREST ? ' crest-symbol' : '') + (rune > 1 ? ' runed' : '');
      cell.innerHTML = image(symbol) + (rune > 1 ? `<span class="rune">×${rune}</span>` : '') + (symbol >= PORTAL ? `<small class="special-label">${SYMBOLS[symbol].short}</small>` : '');
      cell.setAttribute('aria-label', `${index + 1}: ${SYMBOLS[symbol].name}${rune > 1 ? `, руна ×${rune}` : ''}`);
      const movement = movements?.find(m => m.to === index);
      if (movement && movement.from !== movement.to && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const fromRow = Math.floor(movement.from / COLS), row = Math.floor(index / COLS);
        cell.querySelector('img')!.animate([{ transform: `translateY(${(fromRow - row) * (cellHeight + 3)}px)`, opacity: movement.from < 0 ? 0 : 1 }, { transform: 'translateY(0)', opacity: 1 }], { duration: SPEEDS[this.spinSpeed].drop, easing: 'cubic-bezier(.2,.65,.3,1)' });
      }
    });
    this.grid = [...grid];
  }

  private drawReserve(grid: Grid) { this.reserveGrid = [...grid]; this.reserve.innerHTML = grid.map(symbol => `<div>${image(symbol)}</div>`).join(''); }
  private status(message: string) { this.find('#status').textContent = this.hostServices.i18n.translateMessage(message); }
  private wait(ms: number) { return pause(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.round(ms * SPEEDS[this.spinSpeed].factor)); }

  private applyView(view: DraconaView) {
    this.bonusRemaining = view.remaining;
    this.bonusIssued = view.bonusAwarded;
    this.bonusTotal = Number(view.totalPayoutUnits) / 100;
    this.lockedBet = Number(this.session!.stakeUnits) / 100;
    this.presented = this.session!.id + ':' + view.revision;
  }

  private sync() {
    if (!this.alive) return;
    if (this.owner !== this.client.accountId) {
      this.audio.cancel();
      this.owner = this.client.accountId;
      this.autoplay.stop();
      this.presented = '';
      this.bonusRemaining = 0; this.bonusIssued = 0; this.bonusTotal = 0;
      if (this.dialog.open) this.dialog.close();
      if (!this.busy) { this.runes.fill(1); this.draw(initial); this.drawReserve([0, 1, 2, 3]); }
    }
    const session = this.session, view = session?.view.dracona;
    if (!this.busy && view && this.presented !== session!.id + ':' + view.revision) {
      this.applyView(view);
      const result = view.history.at(-1)!.result;
      this.runes = [...result.runes]; this.draw(result.grid); this.drawReserve(result.reserve);
      this.find('#win-value').textContent = amount(result.payout);
      this.find('#win-note').textContent = view.remaining ? 'начисление после бонуса' : 'за вращение';
      this.status(view.remaining ? `Бонус сохранен. Осталось вращений: ${view.remaining}` : 'Последний результат восстановлен');
    }
    if (!this.busy && !view && !this.presented) { this.runes.fill(1); this.draw(initial); this.drawReserve([0, 1, 2, 3]); }
    if (!this.client.accountId) this.status('Войди в аккаунт Royal для игры на демомонеты');
    else if (this.client.pending && !this.busy) this.status(this.client.pending.gameId === DRACONA_GAME ? 'Проверь сохраненный ход. Повторного списания не будет.' : 'Сначала проверь незавершенный ход в другой игре.');
    this.controls();
  }

  private async spin(_scene?: 'portal' | 'bonus' | 'miss', automatic = false): Promise<boolean> {
    if (this.busy || this.dialog.open || !this.alive || (this.autoplay.state.active && !automatic)) return false;
    if (!this.client.accountId || this.client.accountId !== this.wallet.accountId || this.client.busy || this.client.loading || this.wallet.busy || this.wallet.pending || this.wallet.hasExternalBusy('expansion')) return false;
    const account = this.client.accountId;
    const before = this.session;
    const wasFree = before?.state === 'active';
    if (!this.client.pending && !wasFree && this.balance < this.bet) { this.status('Недостаточно демомонет'); return false; }
    this.spinSpeed = this.speed;
    this.busy = true; this.transfers = 0;
    this.root.dataset.phase = 'waiting'; this.controls();
    this.status('Подтверждаем ход в общем кошельке');
    let completed = false;
    try {
      void this.hostServices.gameAudio.unlock();
      if (this.client.pending) {
        if (this.client.pending.gameId !== DRACONA_GAME) return false;
        await this.client.retry();
      } else if (wasFree) {
        await this.client.act({ gameId: DRACONA_GAME, action: 'move', sessionId: before.id, move: 'dracona-spin', revision: before.view.dracona!.revision });
      } else {
        await this.client.act({ gameId: DRACONA_GAME, action: 'start', stakeUnits: String(this.bet * 100), settings: { dracona: { mode: 'normal' } } });
      }
      if (!this.alive || account !== this.client.accountId) return false;
      const session = this.session, view = session?.view.dracona;
      if (!session || !view) throw Error('Результат не подтвержден. Проверь сохраненный ход.');
      const result = view.history.at(-1)!.result;
      const free = view.revision > 1;
      this.bonusSpinActive = free;
      this.spinNumber++;
      this.runes = free ? [...view.history[view.history.length - 2].result.runes] : Array(SIZE).fill(1);
      this.find('#win-value').textContent = '0';
      this.find('#win-note').textContent = view.remaining ? 'начисление после бонуса' : 'за вращение';
      this.find('#round-marker').textContent = String(this.spinNumber).padStart(2, '0');
      this.find('#hero-caption').textContent = 'Посмотрим, что скрывает шкаф.';
      this.root.dataset.phase = 'spinning';
      this.find('#transfer-dots').querySelectorAll('i').forEach(dot => dot.classList.remove('lit'));
      this.audio.begin(this.spinSpeed);
      void this.hero.cast().catch(error => console.error(error)); this.effects.cue('cast');
      this.effects.cast(this.find('#hero').getBoundingClientRect(), this.board.getBoundingClientRect());
      this.board.classList.add('spinning');
      const duration = SPEEDS[this.spinSpeed].spin, started = performance.now();
      while (performance.now() - started < duration) {
        if (!this.alive || account !== this.client.accountId) return false;
        this.cells.forEach((cell, index) => { cell.innerHTML = image((index + Math.floor((performance.now() - started) / 85)) % 6); });
        await pause(SPEEDS[this.spinSpeed].tick);
      }
      this.board.classList.remove('spinning');
      for (const step of result.steps) {
        if (!this.alive || account !== this.client.accountId) return false;
        await this.present(step);
      }
      this.runes = [...result.runes]; this.draw(result.grid); this.drawReserve(result.reserve);
      this.applyView(view);
      await this.hero.react(result.bonusAward > 0 ? 'bonus' : result.payout > 0 ? 'win' : 'neutral');
      if (!this.alive || account !== this.client.accountId) return false;
      if (!free && !result.bonusAward) {
        if (result.payout >= this.bet * 10) void this.audio.play('finish');
        else if (result.payout === 0) void this.audio.play('fizzle');
      }
      this.find('#hero-caption').textContent = result.bonusAward ? 'Поместье помнит каждое заклинание.' : result.payout > 0 ? 'Мне нравится эта магия.' : 'У каждого секрета свое время.';
      if (result.bonusAward > 0 && !free) this.showBonus(result.bonusAward);
      else if (free && view.remaining === 0) this.showBonusResult();
      completed = true;
    } catch (error) {
      this.autoplay.stop();
      if (this.alive && account === this.client.accountId) {
        this.status(this.client.error || (error instanceof Error ? error.message : 'Не удалось подтвердить ход. Проверь сохраненную операцию.'));
        await this.hero.react('neutral').catch(() => {});
      }
    } finally {
      this.busy = false; this.bonusSpinActive = false; this.board.classList.remove('spinning'); this.root.dataset.phase = 'idle';
      if (this.alive) this.sync();
    }
    return completed;
  }

  private async present(step: Step) {
    if (step.type === 'initial') { this.draw(step.grid); this.drawReserve(step.reserve); void this.audio.play('settle'); await this.wait(260); }
    if (step.type === 'win') {
      this.root.dataset.phase = 'winning'; this.effects.cue('win');
      step.clusters.flatMap(c => c.cells).forEach(index => this.cells[index].classList.add('winning'));
      this.find('#win-value').textContent = amount(step.total);
      const factor = Math.max(...step.clusters.map(c => c.factor));
      this.status(`Магическая комбинация · +${amount(step.payout)}${factor > 1 ? ` · руна ×${factor}` : ''}`);
      await this.wait(600);
      step.clusters.flatMap(c => c.cells).forEach(index => this.cells[index].classList.add('vanishing'));
      await this.wait(230);
    }
    if (step.type === 'drop') { this.root.dataset.phase = 'falling'; this.draw(step.grid, step.movements); void this.audio.play('settle'); await this.wait(450); }
    if (step.type === 'portal') {
      this.root.dataset.phase = 'portal'; this.effects.cue('portal');
      this.status(`Исчезающий шкаф · перенос ${step.number}`);
      this.find('#hero-caption').textContent = 'Одно движение. Четыре новых символа.';
      step.cells.forEach(index => this.cells[index].classList.add('portal-target'));
      this.reserve.classList.add('opening');
      await this.transfer(step);
      this.runes = [...step.runes]; this.draw(step.grid); this.drawReserve(step.reserveAfter);
      this.transfers = step.number;
      Array.from(this.find('#transfer-dots').querySelectorAll('i')).forEach((dot, index) => dot.classList.toggle('lit', index < this.transfers));
      this.reserve.classList.remove('opening');
      step.cells.forEach(index => this.cells[index].classList.add('arrived'));
      await this.wait(450);
    }
    if (step.type === 'final') {
      this.find('#win-value').textContent = amount(step.total);
      this.status(step.bonusAward > 0 ? `${step.crestCount} герба · ${step.bonusAward} бесплатных вращений` : step.total > 0 ? `Выигрыш ${amount(step.total)} тестовых монет` : this.transfers ? 'Обмен завершен. Следующее заклинание впереди.' : 'Магия затихла. Сделай новый взмах.');
    }
  }

  private async transfer(step: Extract<Step, { type: 'portal' }>) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = this.find('#floating-layer'), source = this.reserve.getBoundingClientRect(), targetA = this.cells[step.cells[0]].getBoundingClientRect(), targetB = this.cells[step.cells[3]].getBoundingClientRect();
    const ghost = this.document.createElement('div'); ghost.className = 'transfer-ghost';
    ghost.innerHTML = step.reserveBefore.map(symbol => `<div>${image(symbol)}</div>`).join('');
    Object.assign(ghost.style, { left: `${targetA.left}px`, top: `${targetA.top}px`, width: `${targetB.right - targetA.left}px`, height: `${targetB.bottom - targetA.top}px` });
    layer.append(ghost);
    const animation = ghost.animate([{ transform: `translate(${source.left - targetA.left}px,${source.top - targetA.top}px) scale(.55)`, opacity: 0 }, { offset: 0.2, opacity: 1 }, { transform: 'translate(0,0) scale(1)', opacity: 1 }], { duration: SPEEDS[this.spinSpeed].transfer, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'both' });
    try { await animation.finished; } finally { ghost.remove(); }
  }

  private showDialog(title: string, body: string, eyebrow = 'НАСЛЕДИЕ МАЛФОЕВ') {
    this.autoplay.stop();
    this.find('#dialog-content').innerHTML = `<span class="eyebrow">${eyebrow}</span><h2>${title}</h2>${body}<button class="dialog-primary" id="dialog-continue">ПРОДОЛЖИТЬ</button>`;
    this.find('#dialog-continue').addEventListener('click', () => this.dialog.close());
    this.dialog.showModal();
  }

  private showBonus(count: number) {
    this.effects.cue('bonus');
    this.showDialog('Память поместья', `<img class="dialog-emblem" src="/assets/dracona/crest.webp" alt="Фамильный герб"><div class="bonus-count">${count}<span>БЕСПЛАТНЫХ ВРАЩЕНИЙ</span></div><p>Шкаф открывается на каждом вращении. Переносы оставляют серебряные руны от ×2 до ×5. Зачарованный резерв иногда приносит четыре одинаковых символа.</p>`, 'ПОМЕСТЬЕ ПРОБУЖДАЕТСЯ');
  }
  private showBonusResult() { void this.audio.play('finish'); this.showDialog('Магия сохранена', `<div class="bonus-count">${amount(this.bonusTotal)}<span>ТЕСТОВЫХ МОНЕТ ЗА БОНУС</span></div><p>Серебряные руны гаснут. Поместье снова ждет твоего заклинания.</p>`, 'БОНУС ЗАВЕРШЕН'); this.runes.fill(1); this.draw(this.grid); }

  private showRules() {
    const legacy = this.session?.view.dracona?.version === 1;
    const prices = [2.5,5.5,12,30,80].map(value => (value * (legacy ? 1 : DRACONA_MATH.payNumerator / DRACONA_MATH.payDenominator)).toLocaleString(locale,{maximumFractionDigits:6}));
    const rounding = legacy ? 'целой тестовой монеты' : '0,01 тестовой монеты вниз для каждой группы';
    this.showDialog('Тайны шкафа', `<div class="rules-copy"><p><b>Автовращения.</b> Выбери серию из 10, 25 или 50 вращений и нажми «Старт». Скорость настраивается отдельно: обычная, быстрая или турбо. Изменение скорости применяется со следующего спина. «Стоп» завершает текущий спин и отменяет оставшиеся. При открытии бонуса, правил, нехватке монет или ошибке серия останавливается.</p><p><b>Каскады.</b> Пять одинаковых символов, соединенных по горизонтали или вертикали, дают выигрыш. Они исчезают, остальные падают, сверху приходят новые. До 8 каскадов за вращение.</p><p><b>Переносы.</b> Символ шкафа дает обмен участка 2 × 2 с четырьмя символами по ту сторону. После обмена поле снова проверяется. До 3 переносов за вращение.</p><p><b>Память поместья.</b> Три герба на одном показе поля открывают 8 бесплатных вращений. Во время бонуса три герба добавляют еще 2, максимум 20 за серию. Ставка фиксируется при входе в бонус. В 45% бонусных вращений резерв зачарован: все четыре его символа одинаковые.</p><p><b>Серебряные руны.</b> В бонусе каждый перенос повышает руны своих клеток на один, от ×2 до ×5. Для группы берется наибольшая руна, множители не перемножаются. После бонуса руны сбрасываются.</p><p><b>Выплаты за группу.</b> 5–6 символов: ${prices[0]} ставки; 7–8: ${prices[1]}; 9–11: ${prices[2]}; 12–15: ${prices[3]}; 16–20: ${prices[4]}. Затем применяется ценность символа: зелье ×1,3, кольцо ×1,2, книга ×1,1, ключ ×1, изумруд ×0,9, перо ×0,8, и руна. Итог округляется до ${rounding}.</p><p>${DRACONA_RULES}</p></div>`);
  }
  getState() { return { gameId: DRACONA_GAME, ready: !!this.client.accountId, busy: this.busy, remaining: this.bonusRemaining, autoplay: this.autoplay.state, audio: this.audio.getState() }; }
  destroy() {
    if (!this.alive) return;
    this.alive = false; this.autoplay.stop(); this.controller.abort();
    this.client.removeEventListener('change', this.changed); this.wallet.removeEventListener('change', this.changed);
    this.stopAudio?.(); this.audio.destroy(); this.hero.destroy(); this.effects.destroy();
    if (this.dialog.open) this.dialog.close();
    this.host.replaceChildren();
  }
}
