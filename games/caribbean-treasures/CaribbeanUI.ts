import {syncStakeSelect} from '../../src/ui/stakeSelection';
import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {confirmedPayout} from '../../src/shared/roundPrecision';
import {DEFAULT_GAME_STAKE, ROYAL_GAME_STAKE_UNITS as CARIBBEAN_STAKES, validGameStake} from '../../src/shared/gameStakes';
import {readGameHost} from '../../src/modules/GameHostContract';
import {
  CARIBBEAN_GAME, caribbeanInitialCost, validCaribbeanStake,
  type CaribbeanSettings, type CaribbeanStartMode, type CaribbeanView,
} from '../../src/shared/caribbeanTreasures';
import {
  CARIBBEAN_BONUS_SPINS, CARIBBEAN_LINE_COUNTS, CARIBBEAN_LINES, CARIBBEAN_SYMBOLS, settleCaribbeanFrame,
  validCaribbeanLineCount, type CaribbeanLineCount,
} from '../../src/shared/caribbeanTreasuresMath';
import {SlotDialog, slotOwnsKeyboard, type SlotDialogKind} from '../../src/ui/slotKit/SlotDialog';
import {CaribbeanAudio, type CaribbeanCue} from './CaribbeanAudio';
import {caribbeanOutcome, type CaribbeanOutcome} from './presentation';
import {crewMember, crewThumbnail, DEFAULT_CAPTAIN, type CrewId} from './CaribbeanCrew';
import {CaribbeanVoyageClient} from './CaribbeanVoyageClient';
import {Harbor} from './scene/harbor';
import {Pirate, soften} from './scene/pirate';
import {gunMuzzle, Stage, type Layout} from './scene/stage';
import {loadSymbols} from './scene/symbols';
import {ease} from './scene/clock';
import {CREW, newcomer, Voyage, voyageNext} from './scene/voyage';
import {MEDIA} from './scene/media';
import {money, points, signed, speech, t} from './scene/text';

const namesEn = ['Map', 'Compass', 'Pistol', 'Cutlass', 'Ruby', 'Parrot'];
const AUTO_COUNTS = [10, 25, 50, 100] as const;
/** A press right after the answer still belongs to the start, not to the skip. */
const SKIP_GUARD_MS = 350;
type AutoNote = '' | 'complete' | 'stopped' | 'funds' | 'error' | 'paused' | 'account';
type Sheet = '' | 'info' | 'history' | 'buy' | 'lines' | 'auto' | 'menu';
type Notice = {kind: '' | 'win' | 'quiet' | 'error'; say: string; ledger: string};
const icon = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  sound: icon('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor"/><path class="on" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/><path class="off" d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  music: icon('<path d="M9 18V6l10-2v11.5"/><circle cx="6.8" cy="18" r="2.4" fill="currentColor"/><circle cx="16.8" cy="15.6" r="2.4" fill="currentColor"/><path class="off" d="M3.5 4l17 17"/>'),
  history: icon('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
  info: icon('<path d="M9 9.2a3 3 0 1 1 4.6 2.6c-1 .7-1.6 1.2-1.6 2.4"/><circle cx="12" cy="18" r=".9" fill="currentColor"/>'),
  menu: icon('<path d="M4 6.5h16M4 12h16M4 17.5h16"/>'),
};
const WHEEL = Array.from({length: 8}, (_, i) => `<g transform="rotate(${i * 45})"><path d="M-4 -44h8l1.5-9a6 6 0 1 0-11 0z" fill="#7a4a24" stroke="#2c170a" stroke-width="1.4"/><circle cy="-55" r="4.6" fill="#b9823f" stroke="#2c170a" stroke-width="1.2"/><path d="M-2.4 -42l-1-8h2z" fill="#c79252"/></g>`).join('')
  + '<circle r="46" fill="none" stroke="#2c170a" stroke-width="9"/><circle r="46" fill="none" stroke="#d7a653" stroke-width="6"/><circle r="47.5" fill="none" stroke="#ffe9ad" stroke-width="1"/>'
  + Array.from({length: 8}, (_, i) => `<circle transform="rotate(${i * 45 + 22.5})" cy="-46" r="1.8" fill="#6b4312"/>`).join('');

export class CaribbeanUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private lifetime = new AbortController();
  private root: HTMLElement;
  private dialog: SlotDialog;
  private sheet: Sheet = '';
  private dialogTrigger?: HTMLElement;
  private disposed = false;
  private lines: CaribbeanLineCount = 20;
  private stake = DEFAULT_GAME_STAKE;
  private sessionKey = '';
  private account: string | null = null;
  private audio = new CaribbeanAudio();
  private unsubscribeAudio: () => void = () => {};
  private motion = new AbortController();
  private presenting = false;
  private paused = false;
  private displayed?: CaribbeanView;
  private visualPhase: 'idle' | 'waiting' | 'reels' | 'giant' | 'cannon' | 'wins' | 'sea' | 'outcome' = 'idle';
  private shownAt = 0;
  private tally?: string;
  private seen = '';
  private actionError = '';
  private autoCount: number = 10;
  private autoRemaining = 0;
  private autoRunning = false;
  private autoInFlight = false;
  private autoConfirm = false;
  private autoEpoch = 0;
  private autoTimer?: ReturnType<typeof setTimeout>;
  private autoNote: AutoNote = '';
  private lastBalance?: number;
  private voyages = new CaribbeanVoyageClient();
  private voyage: Voyage;
  private harbor: Harbor;
  private pirate: Pirate;
  private stage: Stage;
  private mode: 'wide' | 'portrait' | 'short' = 'wide';
  private observer: ResizeObserver;
  private frameRequest = 0;
  private lastFrame = 0;
  private loadFailed = false;
  private outcomes: {deviationMs: number; cue: string}[] = [];
  private motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private get reduced() { return this.motionPreference.matches; }
  private get english() { return this.services.i18n.language === 'en'; }
  get title() { return this.english ? 'Caribbean Treasures' : 'Карибские сокровища'; }
  private symbolName(symbol: number) { return this.english ? namesEn[symbol] : CARIBBEAN_SYMBOLS[symbol].name; }
  private get session() { return this.client.sessions.find(session => session.gameId === CARIBBEAN_GAME); }
  private get view() { return this.session?.view.caribbean; }
  private get active() { return this.session?.state === 'active'; }
  private get wallet() { return this.services.demoWallet.accountId === this.client.accountId ? this.services.demoWallet.wallet ?? this.client.wallet : undefined; }
  private price(mode: CaribbeanStartMode) { return caribbeanInitialCost({lines: this.lines, mode, stakeBasis: 'total'}, this.stake); }
  private canAfford(mode: CaribbeanStartMode) { return !!this.wallet && Math.round(this.wallet.balance * 100) >= Number(this.price(mode)); }
  private get blocked() {
    return this.presenting || this.paused || !this.client.accountId || !this.client.wallet || this.client.busy || this.client.loading || !!this.client.pending
      || this.services.demoWallet.busy || !!this.services.demoWallet.pending || this.services.demoWallet.hasExternalBusy('expansion');
  }

  constructor(host: HTMLElement) {
    speech.english = this.english; speech.locale = this.services.i18n.locale;
    this.root = document.createElement('section');
    this.root.className = 'ct-root';
    this.root.setAttribute('aria-label', this.title);
    this.root.innerHTML = `<canvas class="ct-harbor" aria-hidden="true"></canvas><div class="ct-shade" aria-hidden="true"></div><div class="ct-rocker" aria-hidden="true"><canvas class="ct-field"></canvas></div>
<canvas class="ct-pirate" aria-hidden="true"></canvas><canvas class="ct-rain" aria-hidden="true"></canvas><canvas class="ct-fx" aria-hidden="true"></canvas>
<div class="ct-board" role="img"></div><div class="ct-load" role="status"></div>
<header class="ct-top"><div class="ct-plaque"><h2></h2></div>
<button type="button" class="ct-crewmini" data-ct-action="crew"><span class="ct-ring"><img alt=""></span><span class="ct-txt"><b></b><small></small></span><span class="ct-add" hidden></span></button>
<div class="ct-tools"><button type="button" class="ct-tool" data-ct-action="sound">${ICONS.sound}</button><button type="button" class="ct-tool" data-ct-action="music">${ICONS.music}</button><button type="button" class="ct-tool" data-ct-action="history">${ICONS.history}</button><button type="button" class="ct-tool" data-ct-action="info">${ICONS.info}</button><button type="button" class="ct-lines" data-ct-action="lines"></button><button type="button" class="ct-menu" data-ct-action="menu">${ICONS.menu}</button></div></header>
<div class="ct-amount" hidden><small></small><b></b><em></em></div><div class="ct-choice" hidden></div>
<button type="button" class="ct-plate" data-ct-action="crew"><span class="ct-pl-top"><b></b><small></small></span><span class="ct-bar"><i></i></span><span class="ct-pl-next"></span><span class="ct-add" hidden></span></button>
<div class="ct-result"><span class="ct-course"><img src="${MEDIA}symbol-map.webp" alt=""><small></small><i></i></span><span class="ct-status" role="status" aria-live="polite"><b class="ct-say"></b><small class="ct-ledger"></small></span><b class="ct-sum" data-ct-payout></b><button type="button" class="ct-retry" data-ct-action="retry" hidden></button></div>
<div class="ct-console"><div class="ct-money"><small data-ct-label="balance"></small><p><b data-ct-balance></b><button type="button" class="ct-wallet" data-ct-action="wallet">+</button></p></div>
<div class="ct-stake"><small data-ct-label="stake"></small><p><button type="button" data-ct-action="stake-down">−</button><span class="ct-stake-field"><select data-ct-stake></select><output class="ct-held" hidden></output></span><button type="button" data-ct-action="stake-up">+</button></p></div>
<button type="button" class="ct-play" data-ct-action="play"><svg viewBox="-60 -60 120 120" aria-hidden="true"><g class="ct-wheel">${WHEEL}</g></svg><span><b></b><small></small></span></button>
<button type="button" class="ct-auto" data-ct-action="auto" aria-pressed="false"><b></b><small></small></button><button type="button" class="ct-buy" data-ct-action="buy"><b></b><small></small></button></div>
<div class="ct-backdrop" hidden><section class="ct-modal" role="dialog" aria-modal="true" tabindex="-1"></section></div><div class="ct-voyage" role="dialog" aria-modal="true" hidden></div>`;
    host.replaceChildren(this.root);
    this.element('h2').textContent = this.title;
    this.element('.ct-load').textContent = t('Поднимаем паруса', 'Raising the sails');
    this.element<HTMLSelectElement>('[data-ct-stake]').innerHTML = CARIBBEAN_STAKES.map(stake => `<option value="${stake}">${money(stake)}</option>`).join('');
    this.harbor = new Harbor(this.element<HTMLCanvasElement>('.ct-harbor'));
    this.pirate = new Pirate(this.element<HTMLCanvasElement>('.ct-pirate'));
    this.stage = new Stage(this.element<HTMLCanvasElement>('.ct-field'), this.element<HTMLCanvasElement>('.ct-fx'), this.element<HTMLCanvasElement>('.ct-rain'), this.harbor, this.pirate);
    this.stage.onCue = (cue, variant) => this.audio.cue(cue, variant);
    this.stage.lead = (cue, variant) => this.audio.lead(cue, variant);
    this.voyage = new Voyage(this.element('.ct-voyage'), {
      profile: () => this.voyages.profile,
      message: () => this.voyages.refused === 'round-active' ? t('Сменить героиню можно после раунда.', 'You can change the pirate after the round.') : this.voyages.refused ? t('Выбор не сохранён. Попробуй ещё раз.', 'The choice was not saved. Try again.') : this.voyages.failed ? t('Карта пока недоступна, играть можно.', 'The map is unavailable, you can still play.') : '',
      select: id => this.voyages.act('select', id), meet: id => this.voyages.act('meet', id),
      cue: cue => { this.audio.cue(cue); }, reduced: () => this.reduced, blocked: () => !!this.active || this.presenting || this.client.busy || !!this.client.pending, mode: () => this.mode,
      closed: () => this.afterDialog(),
    });
    this.dialog = new SlotDialog(this.element('.ct-modal'), this.element('.ct-backdrop'), 'data-ct-modal', action => this.modalAction(action), () => this.closeDialog());
    const signal = this.lifetime.signal;
    this.root.addEventListener('click', event => this.click(event), {signal});
    this.root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) || !target.matches('[data-ct-stake]')) return;
      if (!this.locked && validCaribbeanStake(target.value)) { this.stake = target.value; this.actionError = ''; }
      this.render();
    }, {signal});
    this.root.addEventListener('keydown', event => {
      if (!slotOwnsKeyboard(this.root, event)) return;
      if (this.voyage.keyboard(event) || this.dialog.keyboard(event, this.dialogKind)) return;
      if (event.key === 'Escape' && this.stage.tour) { event.preventDefault(); event.stopPropagation(); this.endTour(); }
    }, {signal, capture: true});
    this.root.closest('dialog')?.addEventListener('cancel', event => {
      if (!this.sheet && !this.voyage.open && !this.stage.tour) return;
      event.preventDefault(); event.stopPropagation();
      if (this.voyage.open) this.voyage.close(); else if (this.sheet) this.closeDialog(); else this.endTour();
    }, {signal});
    this.client.addEventListener('change', this.update, {signal});
    this.services.demoWallet.addEventListener('change', this.update, {signal});
    this.voyages.addEventListener('change', this.crewChanged, {signal});
    window.addEventListener('royal-account', this.update, {signal});
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.stopAuto('paused'); this.stopPresentation(); } else { this.render(); } this.run(); }, {signal});
    window.addEventListener('blur', () => this.stopAuto('paused'), {signal});
    window.addEventListener('offline', () => this.stopAuto('error'), {signal});
    this.motionPreference.addEventListener('change', () => { this.calm(); if (this.reduced) this.stopPresentation(); else this.render(); }, {signal});
    this.unsubscribeAudio = this.services.gameAudio.onPreferences(() => this.render());
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(this.root);
    this.calm(); this.layout();
    void this.load();
    this.update(); void this.client.refresh(); this.run();
  }

  private async load() {
    try {
      await Promise.all([this.harbor.load(), loadSymbols(), this.stage.load(), this.pirate.select(DEFAULT_CAPTAIN)]);
      if (this.disposed) return;
      this.layout(); this.showConfirmed(); this.loadFailed = false;
      const cover = this.element('.ct-load'); cover.classList.add('ct-off'); setTimeout(() => cover.remove(), 450);
      this.restorePirate();
    } catch { if (!this.disposed) { this.loadFailed = true; this.element('.ct-load').textContent = t('Рисунки не загрузились. Закрой игру и открой снова.', 'The art did not load. Close the game and open it again.'); } }
  }
  private calm() {
    const calm = this.reduced; this.stage.clock.reduced = this.stage.fx.reduced = calm; this.pirate.live = calm ? 0 : 1; this.harbor.calm = calm ? 0 : 1;
    if (calm) this.pirate.rest();
    this.root.dataset.motion = calm ? 'reduced' : 'full';
  }
  /** One loop for the whole scene. It stops with the window, the pause and the game. */
  private run() {
    if (this.frameRequest || this.disposed || this.paused || document.hidden) return;
    this.lastFrame = performance.now();
    const step = (now: number) => {
      this.frameRequest = 0;
      if (this.disposed || this.paused || document.hidden) return;
      const dt = Math.min(.05, Math.max(0, (now - this.lastFrame) / 1000)); this.lastFrame = now;
      this.harbor.time += dt; this.stage.step(dt); this.pirate.step(dt);
      this.stage.rock = this.reduced ? 0 : this.harbor.storm * .0075 * Math.sin(this.harbor.time * 1.05);
      const L = this.stage.L; if (L) { this.harbor.draw(L.W, L.H); this.stage.draw(); if (L.pirate.h > 60) this.pirate.draw(); }
      this.voyage.step(dt);
      this.frameRequest = requestAnimationFrame(step);
    };
    this.frameRequest = requestAnimationFrame(step);
  }

  /** The field keeps one place in every state of the same window. */
  private layout() {
    if (this.disposed) return;
    const W = this.root.clientWidth, H = this.root.clientHeight; if (W < 200 || H < 160) return;
    const mode = this.mode = W / H < .82 ? 'portrait' : H < 440 ? 'short' : 'wide', small = mode === 'wide' && (H < 760 || W < 1010), roomy = mode === 'portrait' && W >= 600;
    const v = (k: string, n: number) => this.root.style.setProperty('--' + k, Math.round(n * 10) / 10 + 'px');
    let b: number, bx: number, by: number, bw: number, bh: number, con: number, rh: number, ry: number, P = {x: 0, y: 0, w: 0, h: 0}, plate = {x: 0, y: 0, w: 0, h: 0}, place: {x: number; y: number; z: number}, muzzle: {x: number; y: number}, gun: Layout['gun'], plx = 0, tiny = false;
    if (mode === 'wide') {
      con = small ? 106 : 122; rh = small ? 46 : 52; b = small ? 24 : Math.min(36, 26 + W * .004);
      const top = small ? 60 : 66, capW = Math.min(Math.max(W * .272, 226), 430), ship = Math.min(Math.max(W * .056, 44), 150), availH = H - con - top - rh - b * 2 - (small ? 12 : 16), availW = W - capW - ship - b * 2;
      bw = Math.min(availW, availH * 1.5, 940); bh = bw / 1.5; bx = ship + b + Math.max(0, (availW - bw) * .5);
      // the field stands low: the sails of the galleon rise above it
      const slack = Math.max(0, availH - bh); ry = H - con - rh - (small ? 22 : 26) - Math.max(0, slack - 120) * .5; by = Math.max(top + b - 8, ry - (small ? 5 : 7) - b - bh);
      const free = W - (bx + bw + b);
      plate = {w: Math.min(free - 30, 300), h: small ? 74 : 84, x: 0, y: 0}; plate.x = bx + bw + b + (free - plate.w) / 2 + 4; plate.y = H - con - plate.h - (small ? 10 : 16);
      const ph = Math.min(H - con - top + (small ? 10 : 6) - plate.h * .45, (free + b * 1.5) * 1.5);
      P = {h: ph, w: ph * 2 / 3, x: 0, y: 0}; P.x = Math.min(W + P.w * .015 - P.w, bx + bw + b + free / 2 - P.w / 2 + 6); P.y = plate.y + plate.h * .62 - ph;
      const z = Math.max(W / 1600, H / 900), over = 1600 * z - W; place = {z, x: -Math.min(over, over * .12), y: Math.max(H - con + 18 - 900 * z, 8 - 92 * z)};
      const s = Math.min(190, Math.max(112, bx - b + 86)); gun = {x: Math.max(6, (bx - b) / 2 - s * .36), y: H - con + (small ? 2 : 0), s}; muzzle = gunMuzzle(gun); plx = bx + bw * (small ? .66 : .68);
    } else if (mode === 'portrait') {
      const low = H < 700; con = roomy ? 126 : low ? 178 : 212; rh = roomy ? 52 : 46; b = roomy ? 27 : W < 350 ? 11 : 16;
      bw = W - (W < 350 ? 8 : 12) - b * 2; bw = Math.min(bw, (H - con - rh - 14 - b * 2 - (roomy ? 330 : 58)) * 1.5); bh = bw / 1.5; bx = (W - bw) / 2; ry = H - con - rh - (roomy ? 24 : 3); by = ry - 5 - b - bh;
      const strip = by - b; tiny = strip < 170;
      if (!tiny) {
        const ph = Math.min(strip * (roomy ? 1.22 : 1.2), W * .84); P = {h: ph, w: ph * 2 / 3, x: W - ph * 2 / 3 + 2 - (roomy ? W * .06 : 0), y: Math.max(2, strip - ph * .84)};
        plate = {x: roomy ? bx - b : 8, y: strip - 92, w: roomy ? 270 : Math.min(176, W - P.w - 10), h: roomy ? 84 : 86};
      }
      const z = Math.max((strip + 40) / 470, W / 1600, roomy ? .86 : .52); place = {z, x: Math.max(W - 1600 * z, roomy ? -20 : -70 * z), y: strip - 505 * z}; muzzle = {x: place.x + 300 * z, y: place.y + 385 * z};
    } else {
      tiny = W < 700 || H < 310; con = 0; rh = tiny ? 40 : 46; b = tiny ? 10 : 15;
      const side = tiny ? 208 : Math.min(292, W * .335); v('side', side); bh = H - rh - b * 2 - (tiny ? 10 : 14); bw = bh * 1.5;
      if (bw > W - side - b * 2 - 20) { bw = W - side - b * 2 - 20; bh = bw / 1.5; }
      bx = W - side - 12 - b - bw; by = 4 + b; ry = by + bh + b + (tiny ? 2 : 3);
      const free = bx - b, ph = free > 70 ? Math.min(H, (free + 30) * 1.75) : 0; P = {h: ph, w: ph * 2 / 3, x: free / 2 - ph / 3 + 4, y: H - ph * .96};
      const z = Math.max(W / 1600, H / 620); place = {z, x: -30, y: -60 * z}; muzzle = {x: Math.max(10, bx - b - 16), y: by + bh * .42};
    }
    const data = this.root.dataset; data.mode = mode;
    for (const [name, on] of [['small', small], ['roomy', roomy], ['tiny', tiny], ['narrow', mode !== 'wide' && !roomy]] as const) this.root.toggleAttribute('data-' + name, on);
    for (const [k, n] of Object.entries({console: con, bx, by, bw, bh, b, rh, ry, rx: gun ? Math.max(bx - b, gun.x + gun.s * .8) : bx - b, px: plate.x, py: plate.y, pw: plate.w, ph: plate.h, plx})) v(k, n);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.harbor.place = place; this.harbor.resize(W, H, Math.min(dpr, 1.5));
    this.stage.layout({W, H, mode, board: {x: bx, y: by, w: bw, h: bh}, b, pirate: P, muzzle, gun}, dpr);
    const canvas = this.pirate.canvas; Object.assign(canvas.style, {left: P.x + 'px', top: P.y + 'px', width: P.w + 'px', height: P.h + 'px', display: P.h > 60 ? 'block' : 'none'});
    // the lower edge dissolves into the plate, so every drawing ends softly
    soften(canvas, mode === 'portrait' ? 'linear-gradient(transparent,#000 3%,#000 76%,transparent 86%)' : mode === 'short' ? 'linear-gradient(transparent,#000 3%)' : 'linear-gradient(transparent,#000 3%,#000 88%,transparent 99%)');
    if (P.h > 60) this.pirate.resize(P.w, P.h, dpr);
    this.render(); this.voyage.resize();
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private get dialogKind(): SlotDialogKind { return this.sheet === '' ? '' : this.sheet === 'history' || this.sheet === 'buy' ? this.sheet : 'info'; }
  private get locked() { return this.blocked || !!this.active || !!this.sheet || this.voyage?.open || this.autoRunning; }
  private get near() { return this.root.hasAttribute('data-narrow'); }
  private get choosing() { return !!this.active && this.view?.phase === 'choice' && (!this.presenting || this.visualPhase === 'outcome'); }
  private get recoverable() { return canRecoverOperation(this.client); }

  private click(event: Event) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.ct-board')) { if (this.stage.tour) this.endTour(); else this.skip(); return; }
    const button = event.target.closest<HTMLButtonElement>('[data-ct-action]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const action = button.dataset.ctAction!;
    if (action === 'play') this.play();
    else if (action === 'auto') { if (this.autoRunning) this.stopAuto('stopped'); else this.openSheet('auto', button); }
    else if (action === 'info' || action === 'history' || action === 'lines' || action === 'menu') this.openSheet(action, button);
    else if (action === 'buy') { if (!this.locked) this.openSheet('buy', button); }
    else if (action === 'crew') this.openVoyage(button);
    else if (action === 'wallet') window.dispatchEvent(new Event('royal-open-wallet'));
    else if (action === 'sound') this.toggleSound();
    else if (action === 'music') this.toggleMusic();
    else if (action === 'retry') this.recover();
    else if (action === 'choose-raid' || action === 'choose-flagship') { this.element('[data-ct-action=play]').focus({preventScroll: true}); void this.move('caribbean-' + action); }
    else if (action === 'stake-up' || action === 'stake-down') {
      if (this.locked) return;
      this.actionError = '';
      this.stake = (action === 'stake-up' ? CARIBBEAN_STAKES.find(stake => Number(stake) > Number(this.stake)) : [...CARIBBEAN_STAKES].reverse().find(stake => Number(stake) < Number(this.stake))) ?? this.stake;
      this.audio.cue('click'); this.render();
    }
  }
  private play() {
    if (this.presenting) { this.skip(); return; }
    if (this.recoverable) { this.recover(); return; }
    if (this.autoRunning) { if (this.autoConfirm) { this.autoConfirm = false; this.render(); this.pumpAuto(); } return; }
    if (this.active) void this.move('caribbean-spin'); else void this.start('normal');
  }
  /** Shows the confirmed result at once. It never sends anything. */
  private skip() {
    if (!this.presenting || this.visualPhase === 'waiting' || performance.now() - this.shownAt < SKIP_GUARD_MS) return;
    this.stage.clock.hurry = true; this.stage.fx.clear();
  }
  private toggleSound() { const p = this.services.gameAudio.getPreferences(); this.services.gameAudio.setMuted(!p.muted); void this.audio.enter(); }
  private toggleMusic() { this.audio.setMusic(!this.audio.musicEnabled()); void this.audio.enter(); this.render(); }
  private endTour() { this.stage.tour = null; this.render(); }

  private update = () => {
    if (this.disposed) return;
    if (this.account !== this.client.accountId) {
      this.stopAuto('account', false); this.voyage.close(); this.closeDialog();
      this.account = this.client.accountId; this.sessionKey = ''; this.seen = ''; this.lines = 20; this.stake = DEFAULT_GAME_STAKE; this.actionError = ''; this.lastBalance = undefined;
      this.stopPresentation(); this.voyages.setAccount(this.account); void this.pirate.select(DEFAULT_CAPTAIN);
    }
    if (this.wallet?.balance !== this.lastBalance) { this.actionError = ''; this.lastBalance = this.wallet?.balance; }
    const session = this.session, view = this.view, key = session && view ? session.id + ':' + view.revision : '';
    if (view && key !== this.sessionKey) {
      this.lines = view.settings.lines;
      this.stake = session?.state === 'active' ? view.lineStakeUnits : view.version === 1 ? DEFAULT_GAME_STAKE : validGameStake(view.lineStakeUnits) ? view.lineStakeUnits : DEFAULT_GAME_STAKE;
      this.sessionKey = key;
    }
    if (this.sheet === 'buy' && this.blocked) this.closeDialog();
    if (!this.presenting && this.seen !== this.sessionKey) { this.seen = this.sessionKey; this.showConfirmed(); if (session?.state === 'settled') void this.voyages.refresh(); }
    this.render(); this.restorePirate(); this.pumpAuto();
  };
  private amounts(view: CaribbeanView) {
    const frame = view.spins.at(-1)?.frame; if (!frame) return [];
    return settleCaribbeanFrame(frame.grid, view.settings.lines, view.lineStakeUnits, view.settings.stakeBasis === 'total' ? view.settings.lines : 1).linePayoutUnits.map(Number);
  }
  private outcome(view: CaribbeanView): CaribbeanOutcome { return caribbeanOutcome({...view, totalPayoutUnits: confirmedPayout(this.session, view.totalPayoutUnits)}); }
  /** The confirmed field without movement: opening, recovery, reduced motion, a hidden window. */
  private showConfirmed() {
    const view = this.view, frame = view?.spins.at(-1)?.frame;
    this.stage.setSea(this.active && view?.tactic ? view.tactic === 'raid' ? 'raid' : 'storm' : 'day');
    if (!frame) { this.stage.grid = Array.from({length: 24}, (_, i) => (i + Math.floor(i / 6) * 2) % 6); this.stage.block = null; }
    const fresh = !!view && !!frame && !(view.tactic && this.active && view.spins.at(-1)!.frame.mode === 'base');
    this.stage.show(frame, view && fresh ? this.amounts(view) : [], !view || BigInt(view.totalPayoutUnits) <= BigInt(view.costUnits));
  }
  private stopPresentation() {
    this.motion.abort(); this.tally = undefined; this.presenting = false; this.displayed = undefined; this.visualPhase = 'idle';
    this.audio.pause(); this.pirate.rest(); this.element('.ct-amount').hidden = true;
    this.seen = this.sessionKey; this.showConfirmed();
    if (!this.disposed) this.render();
  }

  private async start(mode: CaribbeanStartMode) {
    if (this.disposed || this.blocked || this.active || this.sheet) return;
    const price = this.price(mode);
    if (!this.canAfford(mode)) { this.actionError = t('Не хватает средств: нужно ', 'Not enough funds: need ') + money(price) + ' USDT.'; this.render(); return; }
    this.actionError = '';
    if (!this.autoRunning) this.autoNote = '';
    const settings: CaribbeanSettings = {lines: this.lines, mode, stakeBasis: 'total'}, before = this.session?.id;
    try { await this.perform(() => this.client.act({gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: this.stake, settings: {caribbean: settings}}), mode === 'normal', price, price); }
    catch (error) { this.actionError = this.client.pending ? '' : error instanceof Error ? error.message : this.client.error; }
    finally { this.update(); }
    return !!this.session && this.session.id !== before;
  }
  private async move(move: string) {
    const session = this.session, view = this.view;
    if (this.disposed || this.blocked || !session || !view || session.state !== 'active' || this.sheet || this.voyage.open) return;
    if (!session.view.actions.some(action => action.move === move && action.cost === 0)) return;
    const manualAutoChoice = this.autoRunning && !this.autoInFlight, epoch = this.autoEpoch;
    if (manualAutoChoice) this.autoInFlight = true;
    this.actionError = '';
    try { await this.perform(() => this.client.act({gameId: CARIBBEAN_GAME, action: 'move', sessionId: session.id, move, revision: view.revision}), move === 'caribbean-spin', view.costUnits); }
    catch (error) { this.actionError = this.client.pending ? '' : error instanceof Error ? error.message : this.client.error; }
    finally { if (manualAutoChoice && epoch === this.autoEpoch) this.autoInFlight = false; this.update(); }
  }
  /** A lost answer is asked for under the same operation. Nothing new is sent or charged. */
  private recover() {
    if (!this.recoverable || this.presenting || this.disposed) return;
    const request = this.client.pending as {move?: string; settings?: {caribbean?: {mode?: string}}} | null, mode = request?.settings?.caribbean?.mode;
    const rolls = request?.move ? request.move === 'caribbean-spin' : mode === undefined || mode === 'normal';
    this.element('[data-ct-action=play]').focus({preventScroll: true});
    void this.perform(() => this.client.retry(), rolls, this.active && this.view ? this.view.costUnits : this.stake).catch(() => {}).finally(() => this.update());
  }
  private until(signal: AbortSignal, work: Promise<unknown>) {
    return Promise.race([work, new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), {once: true}); })]);
  }
  private async accent(cue: CaribbeanCue, signal: AbortSignal, visual: () => void) {
    if (signal.aborted) return;
    const expected = this.stage.clock.hurry ? performance.now() : this.audio.cue(cue), ms = expected - performance.now() - 8;
    if (ms > 0) await this.until(signal, this.stage.clock.wait(ms / 1000));
    if (signal.aborted) return;
    visual(); this.outcomes.push({cue, deviationMs: performance.now() - expected}); if (this.outcomes.length > 40) this.outcomes.shift();
  }
  private offer = '';
  private hold?: number;
  /** The balance on screen never tells the result before the field does. */
  private async perform(action: () => Promise<unknown>, rolls: boolean, price: string, debit = '') {
    const previous = this.view, priorKey = this.sessionKey, account = this.client.accountId, stage = this.stage;
    this.motion.abort(); const motion = this.motion = new AbortController(), signal = motion.signal;
    stage.clock.hurry = false; stage.tour = null; this.element('.ct-amount').hidden = true; this.offer = price; const held = this.wallet?.balance; this.hold = held;
    this.tally = undefined; this.displayed = this.active ? previous : undefined; this.presenting = true; this.visualPhase = 'waiting';
    if (!this.reduced) { this.pirate.show('focus'); this.pirate.gesture('nod'); }
    void this.audio.enter();
    if (rolls && !this.reduced) stage.startRoll(); else stage.resetWins();
    const rolling = stage.clock.now;
    this.render();
    try {
      try { await action(); }
      catch (error) { if (rolls && !this.reduced && !signal.aborted) await this.until(signal, stage.abort()); throw error; }
      if (signal.aborted || this.disposed || account !== this.client.accountId || document.hidden || this.paused) return;
      const confirmed = this.view;
      if (!confirmed || this.sessionKey === priorKey) { if (rolls && !this.reduced) await this.until(signal, stage.abort()); return; }
      const before = this.session?.id === priorKey.split(':')[0] ? previous : undefined, hasSpin = confirmed.spins.length > (before?.spins.length ?? 0);
      this.seen = this.sessionKey;
      this.hold = debit && held !== undefined ? Math.round(held * 100 - Number(debit)) / 100 : debit === '' && before ? held : undefined;
      if (this.reduced) {
        this.displayed = confirmed; this.visualPhase = 'outcome'; this.showConfirmed(); this.render();
        this.audio.cue(confirmed.phase === 'complete' ? this.outcome(confirmed) : confirmed.phase === 'choice' || !hasSpin ? 'bonus' : 'click');
        return;
      }
      this.shownAt = performance.now(); this.render();
      if (!hasSpin) await this.revealSea(confirmed, signal);
      else {
        await this.until(signal, stage.clock.wait(Math.max(0, .6 - (stage.clock.now - rolling))));
        if (!signal.aborted) await this.revealSpin(confirmed, before, signal);
      }
    } finally {
      if (this.motion === motion && !this.disposed) {
        this.tally = undefined; this.presenting = false; this.displayed = undefined; this.visualPhase = 'idle'; this.offer = ''; this.hold = undefined; stage.clock.hurry = false;
        if (this.pirate.pose === 'focus') this.pirate.show('idle');
        this.render(); this.focusChoice();
        if (this.session?.state === 'settled') void this.voyages.refresh();
      }
    }
  }
  private async revealSea(confirmed: CaribbeanView, signal: AbortSignal) {
    this.displayed = confirmed; this.visualPhase = 'sea'; this.render();
    await this.accent('bonus', signal, () => { this.pirate.show('bonus', 2.2); this.pirate.gesture('win'); });
    if (signal.aborted) return;
    await this.until(signal, this.stage.enterSea(confirmed.tactic === 'raid' ? 'raid' : 'storm'));
  }
  private async revealSpin(confirmed: CaribbeanView, before: CaribbeanView | undefined, signal: AbortSignal) {
    const stage = this.stage, spin = confirmed.spins.at(-1)!, frame = spin.frame, from = BigInt(before?.totalPayoutUnits ?? '0'), total = BigInt(confirmed.totalPayoutUnits), cost = BigInt(confirmed.costUnits);
    this.displayed = {...confirmed, totalPayoutUnits: String(from)}; this.visualPhase = 'reels'; this.render();
    await this.until(signal, stage.stop(frame)); if (signal.aborted) return;
    if (frame.blockBefore) { this.visualPhase = 'giant'; this.render(); this.pirate.show('focus'); await this.until(signal, stage.giant()); if (signal.aborted) return; }
    if (frame.cannon && frame.block) { this.visualPhase = 'cannon'; this.render(); await this.until(signal, stage.cannon(frame.block, frame.grid)); if (signal.aborted) return; }
    else if (frame.block) { stage.block = {...frame.block}; stage.grid = [...frame.grid]; }
    // only a total above the whole accepted price is a profit
    const quiet = total <= cost;
    if (frame.wins.length) {
      this.displayed = confirmed; this.visualPhase = 'wins'; this.tally = String(from); this.render();
      const board = stage.L.board, to = {x: board.x + board.w - 20, y: board.y + board.h + stage.L.b + 26};
      const count = async () => {
        await stage.clock.wait(.35);
        if (!quiet) stage.coinsTo(to, Math.min(14, 4 + frame.wins.length * 2));
        const add = total - from;
        await stage.clock.tween(.5, u => { this.tally = String(from + add * BigInt(Math.round(u * 1000)) / 1000n); if (!signal.aborted) this.paintSum(); }, ease.out);
      };
      await this.until(signal, Promise.all([stage.wins(frame, this.amounts(confirmed), quiet), count()])); if (signal.aborted) return;
    }
    this.displayed = confirmed; this.tally = undefined;
    if (confirmed.phase === 'choice') { await this.accent('bonus', signal, () => { this.visualPhase = 'outcome'; this.render(); this.pirate.show('bonus'); }); return; }
    if (confirmed.phase !== 'complete') { this.visualPhase = 'outcome'; this.render(); if (frame.wins.length && !quiet) this.pirate.show('win', 1); else this.pirate.show('idle'); return; }
    const outcome = this.outcome(confirmed);
    await this.accent(outcome, signal, () => {
      this.visualPhase = 'outcome'; this.render();
      if (outcome === 'bigwin') { this.pirate.show('laugh', 2.8); this.pirate.gesture('big'); }
      else if (outcome === 'win') { this.pirate.show('win', 1.8); this.pirate.gesture('win'); }
      else if (outcome === 'return') this.pirate.show('idle');
      else { this.pirate.show('soft', 1.1); this.pirate.gesture('soft'); }
    });
    if (signal.aborted) return;
    if (outcome === 'bigwin') {
      const paid = BigInt(confirmedPayout(this.session, confirmed.totalPayoutUnits)), box = this.element('.ct-amount');
      box.querySelector('small')!.textContent = t('Крупный выигрыш', 'Big win'); box.querySelector('em')!.textContent = t('Чистый итог ', 'Net ') + signed(paid - cost);
      await this.until(signal, stage.treasure(u => { if (signal.aborted) return; box.hidden = false; box.querySelector('b')!.textContent = money(paid * BigInt(Math.round(u * 1000)) / 1000n); }));
      if (signal.aborted) return;
      box.hidden = true;
    }
    if (confirmed.tactic) await this.until(signal, stage.leaveSea());
  }

  /* Text and controls ------------------------------------------------------------- */
  private notice(): Notice {
    const view = this.presenting ? this.displayed : this.view, narrow = this.near, phase = this.visualPhase, active = !!this.active;
    const price = (units: string) => t(narrow ? 'Цена ' : 'Цена раунда ', narrow ? 'Price ' : 'Round price ') + money(units);
    if (!this.client.accountId) return {kind: '', say: t('Войди в зал, чтобы играть', 'Sign in to play'), ledger: ''};
    if (this.recoverable && !this.presenting) return {kind: 'error', say: t('Ответ не получен', 'No answer yet'), ledger: narrow ? t('Ставка не повторится', 'No second charge') : t('Повторной ставки не будет', 'There will be no second stake')};
    if (!this.presenting && (this.client.error || this.actionError)) return {kind: 'error', say: this.client.error || this.actionError, ledger: ''};
    if (!this.presenting && this.services.demoWallet.pending) return {kind: 'error', say: t('Проверь операцию общего кошелька', 'Check the shared wallet operation'), ledger: ''};
    if (this.presenting && phase === 'waiting') return {kind: '', say: this.reduced ? t('Подтверждаем ход', 'Confirming') : t('Барабаны пошли', 'The reels are off'), ledger: this.offer ? price(this.offer) : ''};
    const lines = `${t('Линий', 'Lines')}: ${this.lines}`;
    if (!view) return this.funds() ?? {kind: '', say: this.autoNote ? this.autoLabel() : t('Корабль готов', 'The ship is ready'), ledger: lines + t(', слева направо', ', left to right')};
    const frame = view.spins.at(-1)?.frame, cost = view.costUnits, visible = !this.presenting || phase === 'outcome';
    const soFar = price(cost) + (view.tactic && view.totalPayoutUnits !== '0' && !(this.root.hasAttribute('data-tiny') && this.mode === 'portrait') ? t(' · накоплено ', ' · so far ') + money(this.tally ?? view.totalPayoutUnits) : '');
    if (this.presenting && !visible) {
      const raid = view.tactic === 'raid', wins = frame?.wins.length ?? 0;
      const say = phase === 'sea' ? raid ? narrow ? t('Абордаж!', 'Boarding!') : t('Рейд на торговцев. Абордаж!', 'Merchant raid. Boarding!') : narrow ? t('Держим курс!', 'Hold the course!') : t('Штурм флагмана. Держим курс!', 'Flagship assault. Hold the course!')
        : phase === 'giant' ? narrow ? t('Гигантский символ', 'Giant symbol') : t('Из глубины поднимается гигантский символ', 'A giant symbol rises from the deep')
        : phase === 'cannon' ? t('Залп!', 'Fire!') : phase === 'wins' ? wins === 1 ? t('Совпала одна линия', 'One line matched') : t('Совпало линий: ', 'Lines matched: ') + wins : t('Барабаны остановились', 'The reels stop');
      return {kind: phase === 'wins' && frame ? BigInt(this.view?.totalPayoutUnits ?? '0') > BigInt(cost) ? 'win' : 'quiet' : '', say, ledger: soFar};
    }
    if (view.phase === 'choice') return {kind: '', say: narrow ? t('Выбери тактику', 'Choose a tactic') : t('Карта собрана. Выбери тактику', 'The map is complete. Choose a tactic'), ledger: soFar};
    if (view.phase === 'bonus') {
      const first = view.spins.length === 0 || view.spins.at(-1)!.frame.mode === 'base';
      return {kind: first || view.spins.at(-1)!.payoutUnits === '0' ? '' : BigInt(view.totalPayoutUnits) > BigInt(cost) ? 'win' : 'quiet', say: (narrow ? t('Вращений: ', 'Spins: ') : t('Бесплатных вращений: ', 'Free spins: ')) + view.remaining, ledger: view.version === 1 && !narrow ? soFar + t(' · прежние правила', ' · earlier rules') : soFar};
    }
    const paid = confirmedPayout(this.session, view.totalPayoutUnits), net = BigInt(paid) - BigInt(cost), outcome = this.outcome(view), series = !!view.tactic;
    const ledger = narrow ? price(cost) + t(' · итог ', ' · net ') + signed(net) : price(cost) + t(' · выплата ', ' · payout ') + money(paid) + t(' · чистый итог ', ' · net ') + signed(net);
    if (!this.presenting && this.autoRunning && this.autoConfirm) return {kind: outcome === 'win' || outcome === 'bigwin' ? 'win' : 'quiet', say: narrow ? t('Продолжить авто?', 'Continue auto?') : t('Серия завершена. Продолжить автоигру?', 'The series is over. Continue autoplay?'), ledger};
    if (!this.presenting) { const short = this.funds(); if (short) return short; if (this.stage.tour) return {kind: '', say: narrow ? t('Линии по очереди', 'Lines one by one') : t('Линии по очереди. Нажми на поле, чтобы закончить', 'Lines one by one. Tap the field to stop'), ledger: lines}; if (this.autoNote && !this.autoRunning) return {kind: '', say: this.autoLabel(), ledger}; }
    const say = outcome === 'bigwin' ? t('Крупный выигрыш', 'Big win') : outcome === 'win' ? series ? narrow ? t('Добыча на борту', 'Loot aboard') : t('Серия завершена, добыча на борту', 'The series is over, the loot is aboard') : t('Добыча раунда', 'Round loot')
      : outcome === 'return' ? t('Цена раунда вернулась', 'The price came back') : outcome === 'partial' ? narrow ? t('Вернулась часть', 'Part came back') : series ? t('Серия завершена, вернулась часть цены', 'The series is over, part of the price came back') : t('Вернулась часть ставки', 'Part of the stake came back') : t('Без выигрыша', 'No win');
    return {kind: outcome === 'win' || outcome === 'bigwin' ? 'win' : outcome === 'loss' ? '' : 'quiet', say, ledger};
  }
  private funds(): Notice | undefined {
    if (this.active || this.autoRunning || !this.wallet || this.canAfford('normal')) return undefined;
    return {kind: 'error', say: t('Не хватает средств', 'Not enough funds'), ledger: this.near ? t('Нужно ', 'Needed ') + money(this.price('normal')) : t('Для вращения нужно ', 'A spin needs ') + money(this.price('normal')) + ' USDT'};
  }
  private paintSum() {
    const view = this.presenting ? this.displayed : this.view, visible = !this.presenting || this.visualPhase === 'outcome';
    const units = this.tally ?? (!view ? '0' : view.phase === 'complete' && visible ? confirmedPayout(this.session, view.totalPayoutUnits) : view.totalPayoutUnits);
    const hidden = this.presenting && this.visualPhase === 'waiting' && !this.active;
    this.element('[data-ct-payout]').textContent = units === '0' || hidden ? '' : money(units);
  }
  private render() {
    if (this.disposed || !this.voyage) return;
    const view = this.presenting ? this.displayed : this.view, notice = this.notice(), active = !!this.active, choosing = this.choosing, busy = this.presenting || this.client.busy, data = this.root.dataset;
    const bonus = active && view?.phase === 'bonus', skipping = this.presenting && this.visualPhase !== 'waiting', tiny = this.root.hasAttribute('data-tiny'), narrow = this.near, retry = this.recoverable && !this.presenting;
    data.ctPhase = this.visualPhase; data.roundPhase = !this.presenting || this.visualPhase === 'outcome' ? view?.phase ?? 'idle' : 'revealing'; data.flow = retry ? 'error' : skipping ? 'show' : busy ? 'wait' : 'idle';
    data.outcome = (!this.presenting || this.visualPhase === 'outcome') && view?.phase === 'complete' ? this.outcome(view) : '';
    this.root.setAttribute('aria-busy', String(busy));
    const result = this.element('.ct-result'); result.dataset.kind = notice.kind;
    const say = this.element('.ct-say'), ledger = this.element('.ct-ledger'); if (say.textContent !== notice.say) say.textContent = notice.say; if (ledger.textContent !== notice.ledger) ledger.textContent = notice.ledger;
    this.paintSum(); this.element('.ct-sum').hidden = retry;
    const course = this.element('.ct-course'), all = view?.tactic ? CARIBBEAN_BONUS_SPINS[view.tactic] : 1, run = bonus && view ? all - view.remaining : 0;
    course.toggleAttribute('data-series', bonus); course.toggleAttribute('data-open', choosing); course.style.setProperty('--run', run / all * 100 + '%');
    course.querySelector('small')!.textContent = bonus ? (view!.tactic === 'raid' ? t('Рейд ', 'Raid ') : t('Штурм ', 'Assault ')) + run + '/' + all : choosing ? t('Карта', 'Map') : t('Бонус', 'Bonus');
    course.title = bonus ? '' : t('Карта абордажа открывается случайно после обычного вращения', 'The boarding map opens at random after an ordinary spin');
    const again = this.element<HTMLButtonElement>('[data-ct-action=retry]'); again.hidden = !retry; again.disabled = this.client.busy; again.textContent = narrow ? t('Проверить', 'Check') : t('Проверить тот же ход', 'Check the same move');
    this.element('[data-ct-label=balance]').textContent = t('Баланс', 'Balance'); this.element('[data-ct-balance]').textContent = this.wallet ? this.services.walletCoins(this.presenting && this.visualPhase !== 'outcome' && this.hold !== undefined ? this.hold : this.wallet.balance) : '...';
    const walletButton = this.element<HTMLButtonElement>('[data-ct-action=wallet]'); walletButton.disabled = !this.client.accountId; walletButton.setAttribute('aria-label', t('Открыть тестовый кошелёк', 'Open test wallet'));
    this.renderStake(); this.renderPlay(choosing, bonus, skipping, retry, view);
    const locked = this.locked, auto = this.element<HTMLButtonElement>('[data-ct-action=auto]'), buy = this.element<HTMLButtonElement>('[data-ct-action=buy]');
    auto.querySelector('b')!.textContent = this.autoRunning ? t('Стоп', 'Stop') : t('Авто', 'Auto'); auto.querySelector('small')!.textContent = this.autoRunning ? t('ещё ', 'left ') + this.autoRemaining : '';
    auto.setAttribute('aria-pressed', String(this.autoRunning)); auto.setAttribute('aria-label', this.autoRunning ? t('Остановить автоигру', 'Stop autoplay') : t('Автоигра', 'Autoplay'));
    auto.disabled = !this.autoRunning && (locked || !!this.client.error || !!this.actionError || !this.canAfford('normal'));
    buy.querySelector('b')!.textContent = this.mode === 'wide' ? t('Купить бонус', 'Buy bonus') : t('Бонус', 'Bonus'); buy.querySelector('small')!.textContent = active ? tiny ? '' : t('после раунда', 'after round') : money(this.price('buy-raid')) + (tiny ? '' : ' USDT');
    buy.disabled = locked || !this.canAfford('buy-raid');
    this.element('[data-ct-action=lines]').textContent = t('Линии ', 'Lines ') + this.lines;
    const muted = this.services.gameAudio.getPreferences().muted, music = this.audio.musicEnabled();
    for (const [name, label, pressed] of [['sound', muted ? t('Включить звук', 'Enable sound') : t('Выключить звук', 'Mute sound'), !muted], ['music', music ? t('Выключить музыку', 'Mute music') : t('Включить музыку', 'Enable music'), music], ['history', t('История раунда', 'Round history'), null], ['info', t('Правила и выплаты', 'Rules and payouts'), null], ['menu', t('Меню', 'Menu'), null]] as const) {
      const button = this.element('[data-ct-action=' + name + ']'); button.setAttribute('aria-label', label); button.title = label; if (pressed !== null) button.setAttribute('aria-pressed', String(pressed));
    }
    this.renderChoice(choosing); this.renderCrew();
    const frame = view?.spins.at(-1)?.frame, block = frame?.block;
    this.element('.ct-board').setAttribute('aria-label', t('Поле: 6 барабанов, 4 ряда', 'Field: 6 reels, 4 rows') + (block && !this.presenting ? t('. Гигантский символ: ', '. Giant symbol: ') + this.symbolName(block.symbol) + (frame?.cannon ? t('. Залп увеличил его с 2×2 до 3×3', '. The cannon enlarged it from 2×2 to 3×3') : ` (${block.size}×${block.size})`) : ''));
  }
  private renderStake() {
    const select = this.element<HTMLSelectElement>('[data-ct-stake]'), active = !!this.active, held = active || !!this.client.pending || this.presenting && !!this.offer, view = this.view;
    if (!active && !this.presenting) this.stake = syncStakeSelect(select, this.stake, CARIBBEAN_STAKES, this.locked); else syncStakeSelect(select, this.stake, CARIBBEAN_STAKES, true);
    const shown = active && view ? view.costUnits : this.offer || this.stake, output = this.element('.ct-held'), priced = held && shown !== this.stake;
    output.hidden = !priced; output.textContent = money(shown); this.element('.ct-stake-field').toggleAttribute('data-priced', priced);
    this.element('[data-ct-label=stake]').textContent = held ? t('Цена раунда', 'Round price') : t('Ставка за вращение', 'Spin stake');
    for (const direction of ['down', 'up'] as const) {
      const button = this.element<HTMLButtonElement>('[data-ct-action=stake-' + direction + ']');
      button.disabled = this.locked || (direction === 'down' ? Number(this.stake) <= Number(CARIBBEAN_STAKES[0]) : Number(this.stake) >= Number(CARIBBEAN_STAKES.at(-1)));
      button.setAttribute('aria-label', direction === 'down' ? t('Уменьшить ставку', 'Decrease the stake') : t('Увеличить ставку', 'Increase the stake'));
    }
  }
  /** One wheel starts a spin, opens the result at once and asks for a lost answer, so the keyboard focus never jumps. */
  private renderPlay(choosing: boolean, bonus: boolean, skipping: boolean, retry: boolean, view: CaribbeanView | undefined) {
    const play = this.element<HTMLButtonElement>('[data-ct-action=play]'), narrow = this.near, waiting = this.presenting && !skipping || this.client.busy && !this.presenting, confirm = this.autoRunning && this.autoConfirm;
    const off = waiting || !skipping && !retry && !confirm && (this.blocked || !!this.sheet || this.voyage.open || this.autoRunning || choosing || !this.active && !this.canAfford('normal'));
    const [top, bottom] = skipping ? [t('Итог', 'Result'), t('сразу', 'now')] : waiting ? [t('Ждём', 'Wait'), t('ответ', 'answer')] : retry ? narrow ? [t('Узнать', 'Check'), t('итог', 'result')] : [t('Проверить', 'Check'), t('тот же ход', 'same move')]
      : confirm ? [t('Дальше', 'Go on'), t('авто', 'auto')] : choosing ? [t('Тактика', 'Tactic'), t('выбери', 'choose')] : bonus ? narrow ? [t('Вращать', 'Spin'), t('ещё ', 'left ') + view!.remaining] : [t('Бесплатно', 'Free'), t('осталось ', 'left ') + view!.remaining] : [t('Вращать', 'Spin'), money(this.price('normal'))];
    play.querySelector('b')!.textContent = top; play.querySelector('small')!.textContent = bottom;
    play.setAttribute('aria-label', skipping ? t('Показать итог сразу', 'Show the result now') : top + ' ' + bottom); play.setAttribute('aria-disabled', String(off));
    play.classList.toggle('ct-turn', this.presenting || this.client.busy); play.classList.toggle('ct-skip', skipping);
  }
  private renderChoice(choosing: boolean) {
    const choice = this.element('.ct-choice'); choice.hidden = !choosing;
    const brief = this.root.hasAttribute('data-tiny') || this.mode === 'short', key = choosing ? [brief, this.blocked].join() : '';
    if (choice.dataset.key === key) return;
    choice.dataset.key = key;
    const off = this.blocked ? ' disabled' : '';
    choice.innerHTML = choosing ? `<h3>${brief ? t('Выбери тактику', 'Choose a tactic') : t('Карта абордажа собрана. Выбери тактику', 'The boarding map is complete. Choose a tactic')}</h3><div><button type="button" class="ct-card ct-raid" data-ct-action="choose-raid"${off}><em></em><i>14</i><span><b>${t('Рейд на торговцев', 'Merchant raid')}</b><small>${brief ? t('14 вращений, символ 2×2 с залпом', '14 spins, 2×2 symbol, broadside') : t('14 бесплатных вращений. Символ 2×2, залп растит его до 3×3', '14 free spins. A 2×2 symbol, a broadside grows it to 3×3')}</small></span></button><button type="button" class="ct-card ct-flag" data-ct-action="choose-flagship"${off}><em></em><i>6</i><span><b>${t('Штурм флагмана', 'Flagship assault')}</b><small>${brief ? t('6 вращений, символ 3×3', '6 spins, 3×3 symbol') : t('6 бесплатных вращений. Сразу символ 3×3', '6 free spins. A 3×3 symbol at once')}</small></span></button></div>` : '';
  }
  private focusChoice() {
    if (!this.choosing || this.sheet || this.voyage.open) return;
    const focused = document.activeElement; if (focused && focused !== document.body && !this.root.contains(focused)) return;
    this.element<HTMLButtonElement>('[data-ct-action=choose-raid]:not(:disabled)')?.focus({preventScroll: true});
  }

  /* Crew --------------------------------------------------------------------------- */
  private lastPoints?: {account: string; points: number};
  private crewChanged = () => {
    if (this.disposed) return;
    const profile = this.voyages.profile, last = this.lastPoints;
    if (profile && last?.account === profile.accountId && profile.points > last.points) for (const add of Array.from(this.root.querySelectorAll<HTMLElement>('.ct-add'))) { add.textContent = '+' + (profile.points - last.points); add.hidden = false; add.style.animation = 'none'; void add.offsetWidth; add.style.animation = ''; }
    this.lastPoints = profile ? {account: profile.accountId, points: profile.points} : undefined;
    this.renderCrew(); this.voyage.refresh(); this.restorePirate();
  };
  private renderCrew() {
    const profile = this.voyages.profile, shown = crewMember(this.pirate.id) ?? crewMember(profile?.selected ?? DEFAULT_CAPTAIN)!, name = this.english ? shown.en : shown.ru, fresh = newcomer(profile), way = profile && voyageNext(profile), need = way?.need ?? 0;
    const plate = this.element('.ct-plate'), mini = this.element('.ct-crewmini');
    plate.querySelector('b')!.textContent = name; plate.querySelector('small')!.textContent = profile ? t(`Команда ${profile.met.length} из ${CREW.length}`, `Crew ${profile.met.length} of ${CREW.length}`) : '';
    plate.querySelector<HTMLElement>('.ct-bar i')!.style.width = (fresh ? 100 : way?.fill ?? 0) + '%';
    plate.querySelector('.ct-pl-next')!.textContent = !profile ? this.voyages.failed ? t('Прогресс недоступен', 'Progress unavailable') : '' : fresh ? t('Новая пиратка ждёт', 'A new pirate is waiting') : !way!.next ? t('Вся команда в сборе', 'The whole crew is here') : this.mode === 'portrait' ? t(`Ещё ${need} ${points(need)}`, `${need} ${points(need)} to go`) : t(`До следующей ещё ${need} ${points(need)}`, `Next in ${need} ${points(need)}`);
    const thumb = crewThumbnail(shown.id), img = mini.querySelector('img')!; if (img.getAttribute('src') !== thumb) img.src = thumb;
    mini.querySelector<HTMLElement>('.ct-ring')!.style.setProperty('--p', String(fresh ? 100 : way?.fill ?? 0)); mini.querySelector('b')!.textContent = name;
    mini.querySelector('small')!.textContent = !profile ? '' : fresh ? t('новая!', 'new!') : way!.next ? t(`ещё ${need}`, `${need} to go`) : t('все', 'all');
    for (const button of [plate, mini] as HTMLButtonElement[]) { button.classList.toggle('ct-new', !!fresh); button.setAttribute('aria-label', t('Карта плавания. На палубе ', 'Voyage map. On deck ') + name); button.disabled = this.presenting || this.autoRunning || !this.account; }
  }
  /** The chosen pirate comes on deck between rounds, never in the middle of a reveal. */
  private restorePirate() {
    const wanted = this.voyages.profile?.selected;
    if (!wanted || this.presenting || this.pirate.id === wanted || this.wantedPirate === wanted) return;
    this.wantedPirate = wanted;
    void this.pirate.select(wanted).then(done => { if (this.wantedPirate === wanted) this.wantedPirate = undefined; if (done && !this.disposed) { if (!this.reduced) this.pirate.gesture('enter'); this.renderCrew(); } });
  }
  private wantedPirate?: CrewId;
  private openVoyage(trigger: HTMLElement) {
    if (this.presenting || this.sheet || this.voyage.open || this.autoRunning || !this.account) return;
    this.dialogTrigger = trigger; this.endTour(); void this.voyages.refresh();
    this.element('.ct-voyage').setAttribute('aria-label', t('Карта плавания', 'Voyage map'));
    this.setInert(true, '.ct-voyage'); void this.voyage.show(); this.render();
  }
  private setInert(on: boolean, keep = '') { for (const child of Array.from(this.root.children)) if (child instanceof HTMLElement) child.inert = on && !(keep && child.matches(keep)); }
  private afterDialog() {
    this.setInert(false); if (this.disposed) return;
    this.render();
    const trigger = this.dialogTrigger; this.dialogTrigger = undefined;
    if (trigger?.isConnected) (trigger.getClientRects().length ? trigger : this.element('[data-ct-action=play]')).focus({preventScroll: true});
    this.pumpAuto();
  }

  /* Autoplay ------------------------------------------------------------------------- */
  private autoLabel() {
    return {
      complete: t('Автоигра завершена', 'Autoplay complete'), stopped: t('Автоигра остановлена', 'Autoplay stopped'), funds: t('Авто остановлено: не хватает средств', 'Autoplay stopped: not enough funds'),
      error: t('Авто остановлено: проверь ход', 'Autoplay stopped: check the move'), paused: t('Авто остановлено при паузе', 'Autoplay stopped on pause'), account: t('Авто остановлено при смене аккаунта', 'Autoplay stopped on account change'), '': '',
    }[this.autoNote];
  }
  private stopAuto(note: AutoNote, notify = true) {
    clearTimeout(this.autoTimer); this.autoTimer = undefined; this.autoEpoch++;
    const running = this.autoRunning; this.autoRunning = false; this.autoRemaining = 0; this.autoInFlight = false; this.autoConfirm = false;
    if (running) this.autoNote = note;
    if (running && notify && !this.disposed) this.render();
  }
  private startAuto() {
    if (this.disposed || this.blocked || this.active || this.sheet || this.voyage.open || this.client.error || this.actionError || this.autoRunning || document.hidden || !this.canAfford('normal')) return;
    this.autoRunning = true; this.autoRemaining = this.autoCount; this.autoNote = ''; this.autoEpoch++; this.endTour(); this.pumpAuto();
  }
  private pumpAuto() {
    if (!this.autoRunning || this.disposed) return;
    if (this.paused || document.hidden) { this.stopAuto('paused'); return; }
    if (!this.client.accountId || this.account !== this.client.accountId) { this.stopAuto('account'); return; }
    if (this.autoInFlight) return;
    if (this.client.pending || this.client.error || this.actionError || this.services.demoWallet.pending) { this.stopAuto('error'); return; }
    if (this.blocked || this.sheet || this.voyage.open) return;
    if (this.active && this.view?.phase === 'choice') return;
    if (!this.active) {
      if (this.autoRemaining === 0) { this.stopAuto('complete'); return; }
      // the player confirms the result of a bonus before the next paid spin
      if (this.autoConfirm) { this.render(); return; }
      if (!this.canAfford('normal')) { this.stopAuto('funds'); return; }
    }
    if (this.autoTimer) return;
    const epoch = this.autoEpoch;
    this.autoTimer = setTimeout(() => { this.autoTimer = undefined; void this.nextAuto(epoch).catch(() => { if (epoch === this.autoEpoch && !this.disposed) this.stopAuto('error'); }); }, 500);
  }
  private async nextAuto(epoch: number) {
    if (epoch !== this.autoEpoch || !this.autoRunning || this.disposed) return;
    if (this.blocked || this.sheet || this.voyage.open || document.hidden || this.client.error || this.actionError) { this.pumpAuto(); return; }
    const continuation = !!this.active;
    if (continuation && this.view?.phase !== 'bonus') { this.pumpAuto(); return; }
    if (!continuation && !this.canAfford('normal')) { this.stopAuto('funds'); return; }
    this.autoInFlight = true;
    if (continuation) {
      const before = this.view?.revision; await this.move('caribbean-spin');
      if (epoch !== this.autoEpoch || !this.autoRunning || this.disposed) return;
      if (this.view?.revision === before) { this.autoInFlight = false; this.stopAuto('error'); return; }
      if (!this.active) this.autoConfirm = this.autoRemaining > 0;
    } else {
      const accepted = await this.start('normal');
      if (epoch !== this.autoEpoch || !this.autoRunning || this.disposed) return;
      if (!accepted) { this.autoInFlight = false; this.stopAuto('error'); return; }
      this.autoRemaining--;
    }
    if (epoch !== this.autoEpoch || !this.autoRunning || this.disposed) return;
    this.autoInFlight = false; this.render(); this.pumpAuto();
  }

  /* Sheets ----------------------------------------------------------------------------- */
  private openSheet(sheet: Exclude<Sheet, ''>, trigger?: HTMLElement) {
    if (this.disposed || this.voyage.open) return;
    if (!this.sheet) this.dialogTrigger = trigger;
    this.stopAuto('stopped', false);
    if (this.presenting) this.stopPresentation();
    this.stage.tour = null; this.sheet = sheet; this.buyMode = 'buy-raid';
    this.setInert(true, '.ct-backdrop'); this.paintSheet(); this.dialog.begin(this.dialogKind); this.render();
    this.dialog.focus(sheet === 'info');
    this.element('.ct-modal').querySelector<HTMLElement>('[aria-pressed=true]')?.focus({preventScroll: true});
  }
  private buyMode: 'buy-raid' | 'buy-flagship' = 'buy-raid';
  private paintSheet(focus = '') {
    const panel = this.element('.ct-modal'), view = this.view, title = {info: t('Правила и выплаты', 'Rules and payouts'), history: t('История раунда', 'Round history'), buy: t('Купить бонус', 'Buy the bonus'), lines: t('Линии', 'Lines'), auto: t('Автоигра', 'Autoplay'), menu: t('Меню', 'Menu')}[this.sheet as Exclude<Sheet, ''>];
    let body = '';
    if (this.sheet === 'info') body = this.rules();
    else if (this.sheet === 'history') body = this.history(view);
    else if (this.sheet === 'auto') body = `<p>${t('Платных вращений по ставке', 'Paid spins at')} ${money(this.stake)} USDT. ${t('Тактику бонуса выберешь сам, бесплатные вращения идут без списаний и не расходуют счётчик.', 'You choose the bonus tactic. Free spins go on without charges and do not use the count.')}</p><div class="ct-grid ct-two">${AUTO_COUNTS.map(count => `<button type="button" data-ct-modal="count:${count}" aria-pressed="${count === this.autoCount}">${count}</button>`).join('')}</div><div class="ct-foot"><button type="button" data-ct-modal="close">${t('Отмена', 'Cancel')}</button><button type="button" class="ct-main" data-ct-modal="auto-start">${t('Начать', 'Start')}</button></div>`;
    else if (this.sheet === 'buy') {
      const price = money(this.price(this.buyMode));
      body = `<p>${t('Ставка', 'Stake')} ${money(this.stake)} USDT, ${t('линий', 'lines')} ${this.lines}. ${t('Цена за всю серию', 'Price for the whole series')}: <b class="ct-buy-price">${price} USDT</b>. ${t('Продолжения бесплатны.', 'Continuations are free.')}</p><div class="ct-grid ct-two"><button type="button" data-ct-modal="mode:buy-raid" aria-pressed="${this.buyMode === 'buy-raid'}">${t('Рейд', 'Raid')}<small>${t('14 вращений', '14 spins')}</small></button><button type="button" data-ct-modal="mode:buy-flagship" aria-pressed="${this.buyMode === 'buy-flagship'}">${t('Флагман', 'Flagship')}<small>${t('6 вращений', '6 spins')}</small></button></div><div class="ct-foot"><button type="button" data-ct-modal="close">${t('Отмена', 'Cancel')}</button><button type="button" class="ct-main" data-ct-modal="buy">${t('Купить за', 'Buy for')} ${price}</button></div>`;
    } else if (this.sheet === 'lines') {
      const fixed = this.blocked || this.active;
      body = `<div class="ct-grid ct-four">${CARIBBEAN_LINE_COUNTS.map(count => `<button type="button" data-ct-modal="lines:${count}" aria-pressed="${count === this.lines}"${fixed ? ' disabled' : ''}>${count}</button>`).join('')}</div><button type="button" class="ct-wide" data-ct-modal="tour">${t('Показать на поле по очереди', 'Show on the field one by one')}</button><div class="ct-minis">${CARIBBEAN_LINES.slice(0, this.lines).map((line, i) => `<svg viewBox="0 0 62 46" role="img" aria-label="${t('Линия', 'Line')} ${i + 1}"><rect x=".5" y=".5" width="61" height="45" rx="4"/>${Array.from({length: 24}, (_, k) => { const on = line[k % 6] === Math.floor(k / 6); return `<circle class="${on ? 'on' : ''}" cx="${6 + k % 6 * 10}" cy="${17 + Math.floor(k / 6) * 8}" r="${on ? 2.9 : 1.5}"/>`; }).join('')}<polyline points="${line.map((row, column) => `${6 + column * 10},${17 + row * 8}`).join(' ')}"/><text x="31" y="10">${i + 1}</text></svg>`).join('')}</div>`;
    } else if (this.sheet === 'menu') {
      const muted = this.services.gameAudio.getPreferences().muted;
      body = `<div class="ct-grid ct-two">${[['sound', t('Звук', 'Sound'), !muted], ['music', t('Музыка', 'Music'), this.audio.musicEnabled()], ['go:lines', t('Линии ', 'Lines ') + this.lines, null], ['go:history', t('История', 'History'), null], ['go:info', t('Правила', 'Rules'), null], ['crew', t('Карта плавания', 'Voyage map'), null]].map(([key, label, on]) => `<button type="button" data-ct-modal="${key}"${on === null ? '' : ` aria-pressed="${on}"`}>${label}</button>`).join('')}</div>`;
    }
    panel.innerHTML = `<button type="button" class="ct-x" data-ct-modal="close" aria-label="${t('Закрыть', 'Close')}">×</button><h3>${title}</h3>${body}`;
    panel.setAttribute('aria-label', title);
    if (focus) Array.from(panel.querySelectorAll<HTMLElement>('[data-ct-modal]')).find(button => button.dataset.ctModal === focus)?.focus({preventScroll: true});
  }
  private modalAction(action: string) {
    const [name, value] = action.split(':');
    if (action === 'close') this.closeDialog();
    else if (name === 'count') { this.autoCount = AUTO_COUNTS.find(count => String(count) === value) ?? this.autoCount; this.paintSheet(action); }
    else if (name === 'auto-start') { this.closeDialog(); this.startAuto(); }
    else if (name === 'mode') { this.buyMode = value === 'buy-flagship' ? 'buy-flagship' : 'buy-raid'; this.paintSheet(action); }
    else if (name === 'buy') { const mode = this.buyMode; this.closeDialog(); this.element('[data-ct-action=play]').focus({preventScroll: true}); void this.start(mode); }
    else if (name === 'lines') { const lines = Number(value); if (!this.blocked && !this.active && validCaribbeanLineCount(lines)) this.lines = lines; this.actionError = ''; this.paintSheet(action); }
    else if (name === 'tour') { this.closeDialog(); this.stage.resetWins(); this.stage.tour = {line: 0, t: 0, count: this.lines}; this.render(); }
    else if (name === 'go') { this.sheet = value as Exclude<Sheet, ''>; this.paintSheet(); this.dialog.begin(this.dialogKind); this.dialog.focus(value === 'info'); }
    else if (name === 'crew') { const trigger = this.dialogTrigger; this.closeDialog(); if (trigger) this.openVoyage(trigger); }
    else if (name === 'sound') { this.toggleSound(); this.paintSheet(action); }
    else if (name === 'music') { this.toggleMusic(); this.paintSheet(action); }
  }
  private rules() {
    return `<p>${t('6 барабанов, 4 ряда. От 3 одинаковых подряд слева направо. На одной линии оплачивается самая длинная цепочка.', '6 reels, 4 rows. Match 3 or more identical symbols from the left. Only the longest run pays on each line.')}</p><table><thead><tr><th>${t('Символ', 'Symbol')}</th><th>3</th><th>4</th><th>5</th><th>6</th></tr></thead><tbody>${CARIBBEAN_SYMBOLS.map(symbol => `<tr><th>${this.symbolName(symbol.id)}</th>${symbol.pays.map(pay => `<td>×${pay}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      + [t('Общая ставка делится поровну между выбранными линиями. Коэффициенты относятся к этой доле ставки. Блок 2×2 может увеличиться залпом до 3×3. Расчёт выполняется по итоговому полю.', 'The total stake is split equally across the selected lines. Multipliers use that share of the stake. A cannon can grow a 2×2 block into 3×3. The final field determines payouts.'),
        t('Рейд: 14 вращений с блоком 2×2 и возможным залпом. Флагман: 6 вращений с блоком 3×3. Продления нет. Выплата всей серии начисляется в конце.', 'Raid: 14 spins with a 2×2 block and possible cannon. Flagship: 6 spins with a 3×3 block. No retriggers. The entire round is credited at the end.'),
        t('Бонусная карта открывается отдельным случайным событием после обычного вращения. Картинки карты в поле являются обычными оплачиваемыми символами. Выбирается первый набор из 1, 5, 10 или 20 фиксированных линий; отдельные маршруты не переключаются.', 'A separate random event after a base spin unlocks the bonus map. Map icons on the field are ordinary paying symbols. Select the first 1, 5, 10 or 20 fixed lines; individual routes cannot be switched.'),
        t('Теоретический RTP около 96%. Частота блоков и входа в бонус зависит от набора линий. RTP относится к полной игре на длинной дистанции.', 'Theoretical RTP is approximately 96%. Block and bonus entry probabilities depend on the line preset. RTP describes complete rounds over the long term.'),
        t('Автоигра запускает 10, 25, 50 или 100 обычных платных раундов по текущим линиям и ставке. Тактику бонуса выбираешь сам; бесплатные продолжения идут без счётчика, а после серии автоигра ждёт твоего подтверждения. Покупок бонуса в авто нет. «Стоп» отменяет следующие ходы, сохраняя уже принятый. Ошибка, неизвестный ответ, нехватка средств, пауза, смена аккаунта или закрытие останавливают авто.', 'Autoplay starts 10, 25, 50 or 100 normal paid rounds at the current lines and stake. Choose your bonus tactic yourself; free continuations do not use the count, and after a series autoplay waits for your confirmation. Auto never buys a bonus. Stop cancels future moves and preserves accepted operations. An error, unknown response, insufficient funds, pause, account change or closing stops auto.'),
        t('Очки команды дают завершённые платные раунды, по всей списанной сумме. Бесплатные вращения и выигрыш очков не добавляют. Героиня меняет только внешний вид.', 'Finished paid rounds give crew points, by the whole amount charged. Free spins and winnings add none. The pirate changes the look only.')].map(text => `<p>${text}</p>`).join('')
      + `<p class="ct-audio-credits">${t('Музыка', 'Music')}: <a href="https://opengameart.org/content/blackmoor-tides-epic-pirate-battle-theme" target="_blank" rel="noopener noreferrer">Blackmoor Tides</a> · <a href="https://www.matthewpablo.com" target="_blank" rel="noopener noreferrer">Matthew Pablo</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a>. ${t('Инструментальная петля, нормализация и короткие затухания. Звуковые эффекты: Kenney и Thimras, CC0.', 'Instrumental loop, normalization and short fades. Sound effects: Kenney and Thimras, CC0.')}</p>`;
  }
  private history(view: CaribbeanView | undefined) {
    if (!view) return `<p>${t('Вращений пока нет.', 'No spins yet.')}</p>`;
    const done = view.phase === 'complete', paid = done ? confirmedPayout(this.session, view.totalPayoutUnits) : view.totalPayoutUnits;
    return `<dl><dt>${t('Линий', 'Lines')}</dt><dd>${view.settings.lines}</dd>${view.version === 1 ? `<dt>${t('Ставка на линию', 'Stake per line')}</dt><dd>${money(view.lineStakeUnits)}</dd>` : ''}${view.tactic ? `<dt>${t('Серия', 'Series')}</dt><dd>${view.tactic === 'raid' ? t('Рейд · 14 вращений', 'Raid · 14 spins') : t('Флагман · 6 вращений', 'Flagship · 6 spins')}</dd>` : ''}<dt>${t('Цена раунда', 'Round price')}</dt><dd>${money(view.costUnits)}</dd><dt>${done ? t('Выплата', 'Payout') : t('Накоплено', 'So far')}</dt><dd>${money(paid)}</dd>${done ? `<dt>${t('Чистый итог', 'Net result')}</dt><dd data-ct-net>${signed(BigInt(paid) - BigInt(view.costUnits))}</dd>` : ''}</dl><ol class="ct-spins">${view.spins.map(spin => `<li><span>${spin.frame.mode === 'base' ? t('Обычное вращение', 'Base spin') : t('Бесплатное вращение', 'Free spin')}${spin.frame.block ? `, ${spin.frame.block.size}×${spin.frame.block.size}` : ''}${spin.frame.cannon ? t(', залп', ', broadside') : ''}</span><b>${money(spin.payoutUnits)}</b></li>`).join('')}</ol>`;
  }
  private closeDialog() {
    if (!this.sheet) return;
    this.sheet = ''; this.dialog.hide(); this.afterDialog();
  }

  pause() { this.paused = true; this.stopAuto('paused'); this.stopPresentation(); cancelAnimationFrame(this.frameRequest); this.frameRequest = 0; }
  resume() { this.paused = false; this.render(); this.run(); }
  getState() {
    return {
      gameId: CARIBBEAN_GAME, phase: this.view?.phase ?? 'ready', sessionId: this.session?.id ?? null, revision: this.view?.revision ?? 0, lines: this.lines, lineStakeUnits: this.stake, pendingId: this.client.pending?.id ?? null,
      presenting: this.presenting, visualPhase: this.visualPhase, mode: this.mode, loadFailed: this.loadFailed,
      autoplay: {running: this.autoRunning, remaining: this.autoRemaining, count: this.autoCount, timerPending: !!this.autoTimer, note: this.autoNote, waitingForTactic: this.autoRunning && this.view?.phase === 'choice', waitingForResult: this.autoConfirm},
      audio: this.audio.state(), captain: this.pirate.state, stage: this.stage.state, running: !!this.frameRequest, accents: [...this.stage.accents], outcomes: [...this.outcomes],
      voyage: this.voyages.profile ? {...this.voyages.profile, met: [...this.voyages.profile.met], reached: [...this.voyages.profile.reached], open: this.voyage.open} : null,
    };
  }
  destroy() {
    if (this.disposed) return;
    this.stopAuto('stopped', false); this.motion.abort(); this.stage.clock.cancel(); this.audio.pause(); this.disposed = true;
    cancelAnimationFrame(this.frameRequest); this.observer.disconnect(); this.lifetime.abort(); this.voyages.destroy(); this.voyage.close(); this.audio.destroy(); this.unsubscribeAudio(); this.dialog.destroy();
    this.stage.destroy(); this.harbor.destroy(); this.pirate.destroy(); this.root.remove();
  }
}
