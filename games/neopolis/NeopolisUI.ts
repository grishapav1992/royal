import {syncStakeSelect} from '../../src/ui/stakeSelection';
import {stakeRulesHtml} from '../../src/ui/stakeRules';
import {confirmedPayout} from '../../src/shared/roundPrecision';
import {ROYAL_GAME_BETS as NEOPOLIS_BETS, gameBetCents} from '../../src/shared/gameStakes';
import { readGameHost } from '../../src/modules/GameHostContract';
import { NEOPOLIS_GAME, neopolisPointUnits, neopolisPaytable } from '../../src/shared/neopolis';
import { BOSSES, HEROES, NEOPOLIS_RULES_VERSION, neopolisBosses, initialTeam, readyTeam, type Hero, type Team, type Battle, type Frame } from '../../src/shared/neopolisMath';
import { neopolisCopy } from './copy';
import { SCENES, medal, portrait, skyline, symbolArt } from './art';
import { dissolveNeopolisSymbols, dropNeopolisSymbols, NeopolisReels } from './NeopolisReels';
import { HERO_COLORS, NeopolisEffects } from './NeopolisEffects';
import { NeopolisBoss } from './NeopolisBoss';
import { NeopolisWeather } from './NeopolisWeather';
import { NeopolisAudio } from './NeopolisAudio';
import { NeopolisFeedback } from './NeopolisFeedback';
import { waitMotion, type Accent } from './NeopolisMotion';

const AUTO_COUNTS = [10, 25, 50, 100] as const;
const initialGrid = [0,1,2,3,4, 2,3,4,5,0, 4,5,0,1,2, 1,2,3,4,5];
const EMBLEMS = ['◆','ϟ','◈'] as const;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);

export class NeopolisUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private wallet = this.services.demoWallet;
  private get copy() { return neopolisCopy(this.services.i18n.language, this.wallet.wallet?.asset === 'USDT_NILE_TEST'); }
  readonly title = this.copy.title;
  private root: HTMLElement;
  private dialog: HTMLDialogElement;
  private life = new AbortController();
  private animation = new AbortController();
  private reels?: NeopolisReels;
  private effects: NeopolisEffects;
  private boss: NeopolisBoss;
  private weather: NeopolisWeather;
  private quake: Animation[] = [];
  private struck: Hero[] = [];
  /** The rescue was already shown before the current spin. */
  private rescuedBefore = false;
  private autoCount: number = AUTO_COUNTS[0];
  private coverClosed?: (confirmed: boolean) => void;
  private coverObserver: ResizeObserver;
  private audio: NeopolisAudio;
  private feedback: NeopolisFeedback;
  private presentationUnits = 0;
  private roundBeforeUnits = 0;
  private winChain = 0;
  private scene = -1;
  private sceneKey = '';
  private presentationBattle: Battle | null = null;
  private presentationTeam?: Team;
  private stopAudio?: () => void;
  private owner = this.client.accountId;
  private seen = '';
  private busy = false;
  private alive = true;
  private paused = false;
  private fast = false;
  private autoRunning = false;
  private autoRemaining = 0;
  private autoTimer?: number;
  private autoEpoch = 0;
  private bet = 0.1;
  private selected: Hero = 'granite';
  private changed = () => this.sync();
  private get session() { return this.client.sessions.find(session => session.gameId === NEOPOLIS_GAME); }
  private get view() { return this.session?.view.neopolis; }
  private get team(): Team { return this.busy && this.presentationTeam ? this.presentationTeam : this.view && !this.view.team.complete ? this.view.team : initialTeam(this.selected); }
  private get battle() { return this.busy ? this.presentationBattle : this.session?.state === 'active' ? this.view?.battle ?? null : null; }
  private get legacy() { return this.view?.version === 1 && !!this.battle; }
  private get mode() { const battle = this.battle; return !battle ? 'base' : battle.won ? 'rescue' : 'battle'; }
  private get stakeLocked() { return this.session?.state === 'active'; }
  private get rulesVersion() { return this.stakeLocked ? this.view!.version : NEOPOLIS_RULES_VERSION; }
  private get collectionLocked() { return !!this.view && !this.view.team.complete; }
  private get balance() { return this.wallet.accountId === this.client.accountId ? (this.wallet.wallet?.balance ?? this.client.wallet?.balance ?? 0) : 0; }
  private money(n: number) { return n.toLocaleString(this.services.i18n.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  private number(n: number) { return n.toLocaleString(this.services.i18n.locale, { maximumFractionDigits: 2 }); }
  private find<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>('[data-np="' + name + '"]')!; }
  private more(hero: Hero) { return { granite: this.copy.graniteMore, impulse: this.copy.impulseMore, prism: this.copy.prismMore }[hero]; }
  private detail(hero: Hero) { return { granite: this.copy.graniteDetail, impulse: this.copy.impulseDetail, prism: this.copy.prismDetail }[hero]; }
  private power(hero: Hero) { return { granite: this.copy.granitePower, impulse: this.copy.impulsePower, prism: this.copy.prismPower }[hero]; }

  constructor(private host: HTMLElement) {
    const c = this.copy, doc = host.ownerDocument;
    this.root = doc.createElement('section'); this.root.className = 'np'; this.root.lang = this.services.i18n.language;
    this.root.setAttribute('aria-label', this.title);
    const tool = (name: string, label: string, text: string, extra = '') => '<button type="button" class="np-tool" data-np="' + name + '" aria-label="' + label + '" title="' + label + '"' + extra + '>' + text + '</button>';
    this.root.innerHTML = '<div class="np-scene">' + skyline + '<div class="np-arena" data-np="arena" aria-hidden="true"><div class="np-trio"></div></div><div class="np-grid">'
      + '<header class="np-rail"><h1 class="np-brand">' + c.title + '</h1><ol class="np-path" aria-label="' + c.campaign + '">'
      + BOSSES.map((boss, index) => '<li data-boss-index="' + index + '">' + medal(boss.id) + '<b>' + c[boss.id] + '<em> ' + c[('short' + index) as 'short0'] + '</em></b><span class="np-ticks" aria-hidden="true">' + '<u></u>'.repeat(boss.shield) + '<u data-core></u>'.repeat(boss.core) + '</span></li>').join('')
      + '</ol><div class="np-tools"><label class="np-tool np-fast" title="' + c.fast + '"><input type="checkbox" data-np="fast" aria-label="' + c.fast + '"><span aria-hidden="true">»</span></label>' + tool('sound', c.sound, '♪', ' aria-pressed="false"') + tool('rules', c.rules, '?') + '</div></header>'
      + '<section class="np-team" aria-label="' + c.team + '">'
      + HEROES.map(hero => '<button type="button" class="np-hero" data-hero="' + hero + '" data-active="false" aria-pressed="false"><span class="np-portrait">' + portrait(hero) + '</span><span class="np-hero-copy"><strong>' + c[hero] + '</strong><span>' + this.power(hero) + '</span><span data-hero-state></span></span><span class="np-pips" aria-hidden="true"><i></i><i></i><i></i></span></button>').join('')
      + '</section><section class="np-field"><div class="np-board-shell"><div class="np-board" role="grid" aria-label="' + c.field + '" aria-colcount="5" aria-rowcount="4" data-np="board"></div></div></section>'
      + '<aside class="np-foe" data-np="boss"><div class="np-foe-box"><p class="np-foe-title" data-np="boss-title"></p><h2 data-np="boss-name"></h2><div class="np-boss-meters">'
      + (['shield','core'] as const).map(key => '<div class="np-meter" data-meter="' + key + '"><span>' + c[key] + '</span><em data-np="' + key + '-label"></em><div class="np-segments" data-np="' + key + '"></div></div>').join('')
      + '<ol class="np-steps"><li data-step="team"><i>1</i><span>' + c.stepTeam + '</span><em></em></li><li data-step="null"><i>2</i><span>' + c.stepNull + '</span><em></em></li></ol><p class="np-rescue-note">' + c.rescueNote + '</p></div>'
      + '<p class="np-spins"><span data-np="remaining-label"></span><b data-np="remaining"></b></p></div></aside>'
      + '<div class="np-outcome"><div class="np-outcome-text"><p role="status" aria-live="polite" data-np="status">' + c.collect + '</p><small data-np="lock"></small></div><strong data-np="gain"></strong></div>'
      + '<footer class="np-controls"><div class="np-value"><span>' + c.balance + '</span><strong data-np="balance">0</strong><small class="np-prototype">' + c.prototype + '</small></div><label class="np-stake"><span>' + c.sumStake + '</span><select data-np="bet" aria-label="' + c.bet + '">' + NEOPOLIS_BETS.map(bet => '<option value="' + bet + '"' + (bet === this.bet ? ' selected' : '') + '>' + this.money(bet) + '</option>').join('') + '</select></label><div class="np-value np-win"><span data-np="win-label">' + c.win + '</span><strong data-np="win">' + this.money(0) + '</strong><small data-np="credit">' + c.lastRound + '</small></div><button type="button" class="np-spin" data-np="spin"><span>' + c.spin + '</span><em data-np="spin-count"></em></button><button type="button" class="np-auto" data-np="auto" aria-pressed="false" aria-expanded="false">' + c.autoplay + '</button></footer></div>'
      + '<div class="np-cutin" data-np="cutin" aria-hidden="true"><i></i><span class="np-cutin-art"></span><div><b></b><span></span></div></div>'
      + '<div class="np-callout" data-np="callout" aria-hidden="true"></div><div class="np-flash" data-np="flash" aria-hidden="true"></div><div class="np-verdict" data-np="verdict" aria-hidden="true"><b></b><span></span></div></div>'
      + '<div class="np-auto-panel" data-np="auto-panel" role="dialog" aria-label="' + c.autoTitle + '" hidden><h3>' + c.autoTitle + '</h3><div class="np-auto-counts" role="group" aria-label="' + c.autoSpins + '">' + AUTO_COUNTS.map(count => '<button type="button" data-auto-count="' + count + '" aria-pressed="false">' + count + '</button>').join('') + '</div><button type="button" class="np-primary" data-np="auto-start">' + c.autoStart + '</button></div>'
      + '<dialog class="np-dialog" data-np="dialog"><button type="button" data-np="close" class="np-close" aria-label="' + c.close + '">×</button><div data-np="dialog-body"></div></dialog>';
    host.replaceChildren(this.root); this.dialog = this.find<HTMLDialogElement>('dialog');
    const still = () => this.motionOptions(this.animation.signal).paused(), reduced = () => this.reducedMotion;
    this.effects = new NeopolisEffects(this.root.querySelector('.np-scene')!, still, reduced);
    this.boss = new NeopolisBoss(this.find('arena'), this.find('boss'), this.effects, still, reduced);
    this.weather = new NeopolisWeather(this.root.querySelector('.np-weather')!, () => this.mode === 'rescue' ? 3 : Math.max(0, this.scene), still, reduced);
    this.coverObserver = new ResizeObserver(() => this.placeCover()); this.coverObserver.observe(this.root);
    this.audio = new NeopolisAudio(this.services.gameAudio,doc);
    this.feedback = new NeopolisFeedback(this.root,this.copy,n=>this.money(n),units=>{
      this.presentationUnits=units; this.find('win').textContent=this.money(units/100);
    },()=>this.reducedMotion,(kind,cells)=>this.effects.play(kind==='win' ? 'win' : 'celebrate',cells));
    this.setScene(0);
    this.draw(initialGrid);
    const options = { signal: this.life.signal };
    this.find('spin').addEventListener('click', () => { void this.spin(); }, options);
    this.find<HTMLSelectElement>('bet').addEventListener('change', event => { if (!this.stakeLocked && !this.blocked && !this.autoRunning && !this.client.pending) this.bet = Number((event.target as HTMLSelectElement).value); this.controls(); }, options);
    this.find<HTMLInputElement>('fast').addEventListener('change', event => { this.fast = (event.target as HTMLInputElement).checked; }, options);
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button => button.addEventListener('click', () => {
      if (this.collectionLocked || this.busy || this.autoRunning || this.client.pending) return;
      this.selected = button.dataset.hero as Hero; this.updateTeam();
    }, options));
    this.find('auto').addEventListener('click', () => {
      if (this.autoRunning) this.stopAuto();
      else if (!this.blocked && !this.client.pending && !this.client.error) this.toggleAuto(this.find('auto-panel').hidden);
    }, options);
    this.root.querySelectorAll<HTMLButtonElement>('[data-auto-count]').forEach(button => button.addEventListener('click', () => {
      this.autoCount = Number(button.dataset.autoCount); this.controls();
    }, options));
    this.find('auto-start').addEventListener('click', () => {
      if (this.autoRunning || this.blocked || this.client.pending || this.client.error) return;
      this.toggleAuto(false);
      this.autoRunning = true; this.autoRemaining = this.autoCount; const epoch = ++this.autoEpoch; this.controls();
      void this.nextAuto(epoch);
    }, options);
    this.root.addEventListener('pointerdown', event => { if (!(event.target as Element).closest('.np-auto-panel, [data-np="auto"]')) this.toggleAuto(false); }, options);
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.find('auto-panel').hidden) return;
      event.preventDefault(); event.stopPropagation(); this.toggleAuto(false); this.find('auto').focus({ preventScroll: true });
    }, options);
    doc.defaultView!.addEventListener('offline', () => this.stopAuto(), options);
    this.find('rules').addEventListener('click', () => this.showRules(), options);
    this.find('close').addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('close', () => {
      const closed = this.coverClosed; this.coverClosed = undefined;
      this.updatePause(); this.controls(); closed?.(this.dialog.returnValue === 'continue');
    }, options);
    this.dialog.addEventListener('toggle', this.updatePause, options);
    doc.addEventListener('visibilitychange', this.updatePause, options);
    this.find('sound').addEventListener('click', () => {
      void this.audio.start();
      this.services.gameAudio.setMuted(!this.services.gameAudio.getPreferences().muted);
    }, options);
    this.stopAudio = this.services.gameAudio.onPreferences(preferences => {
      this.find('sound').setAttribute('aria-pressed', String(!preferences.muted));
      this.find('sound').textContent = preferences.muted ? '♫' : '♪';
    });
    this.client.addEventListener('change', this.changed); this.wallet.addEventListener('change', this.changed);
    this.sync(); void this.client.refresh();
  }

  private cellMarkup(symbol: number, emblem = -1, hit = false, event = '') {
    const label = this.copy[('symbol' + symbol) as keyof typeof this.copy] + (emblem >= 0 ? ' · ' + this.copy[HEROES[emblem]] : '');
    return '<div role="gridcell" class="np-cell' + (hit ? ' np-hit' : '') + '" data-symbol="' + symbol + '" data-effect="' + event + '" aria-label="' + label + '">' + symbolArt(symbol) + (emblem >= 0 ? '<span class="np-emblem" data-emblem="' + HEROES[emblem] + '">' + EMBLEMS[emblem] + '</span>' : '') + '</div>';
  }
  private draw(grid: number[], emblems: number[] = [], cells: number[] = [], event = '') {
    this.find('board').innerHTML = Array.from({ length: 4 }, (_, row) => '<div role="row" class="np-row">' + grid.slice(row * 5, row * 5 + 5).map((symbol, col) => {
      const index = row * 5 + col;
      return this.cellMarkup(symbol, emblems[index], cells.includes(index), event);
    }).join('') + '</div>').join('');
  }
  private get reducedMotion() { return this.host.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  private motionOptions(signal: AbortSignal) { return { signal, fast: this.fast, paused: () => this.paused || this.dialog.open && this.dialog.dataset.view === 'rules' || this.host.ownerDocument.hidden, audio:this.audio }; }
  private status(text: string) { this.find('status').textContent = text; }
  private updateTeam() {
    const team = this.team, empowered = this.mode === 'battle' && this.battle!.shield === 0;
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((button, index) => {
      const active = team.charges[index] === 3, hero = HEROES[index];
      button.dataset.active = String(active); button.disabled = this.collectionLocked || this.busy || this.autoRunning || !!this.client.pending;
      button.setAttribute('aria-pressed', String(team.starter === hero));
      button.setAttribute('aria-label', this.copy[hero] + ' · ' + this.power(hero) + ' · ' + team.charges[index] + '/3');
      button.querySelector('[data-hero-state]')!.textContent = !active ? fill(this.copy.emblems, { n: team.charges[index] }) : empowered ? this.more(hero) : this.detail(hero);
      button.querySelectorAll<HTMLElement>('.np-pips i').forEach((pip, i) => pip.dataset.filled = String(i < team.charges[index]));
    });
  }
  private controls() {
    if (!this.alive) return;
    const battle = this.battle, mode = this.mode, pending = this.client.pending, blocked = this.blocked;
    this.root.dataset.mode = mode; this.root.dataset.battle = String(mode !== 'base');
    this.root.dataset.empowered = String(mode === 'battle' && battle!.shield === 0);
    this.find<HTMLButtonElement>('spin').disabled = blocked || this.autoRunning;
    this.find('spin').querySelector('span')!.textContent = this.busy ? this.copy.waiting : pending?.gameId === NEOPOLIS_GAME ? this.copy.retry : mode === 'rescue' ? this.copy.rewardSpin : mode === 'battle' ? this.copy.freeSpin : this.copy.spin;
    this.find('spin-count').textContent = battle ? String(battle.remaining) : this.money(this.bet);
    this.find<HTMLSelectElement>('bet').disabled = blocked || this.stakeLocked || this.autoRunning || !!pending;
    const auto = this.find<HTMLButtonElement>('auto');
    auto.disabled = !this.autoRunning && (blocked || !!pending || !!this.client.error);
    auto.textContent = this.autoRunning ? this.copy.stopAuto + ' (' + this.autoRemaining + ')' : this.copy.autoplay;
    auto.setAttribute('aria-pressed', String(this.autoRunning));
    auto.setAttribute('aria-label', this.autoRunning ? this.copy.stopAuto + '. ' + fill(this.copy.autoRemaining, { n: this.autoRemaining }) : this.copy.autoplay);
    this.find<HTMLButtonElement>('auto-start').disabled = auto.disabled;
    this.root.querySelectorAll<HTMLButtonElement>('[data-auto-count]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.autoCount) === this.autoCount)));
    this.bet=Number(syncStakeSelect(this.find<HTMLSelectElement>('bet'),String(this.bet),NEOPOLIS_BETS,blocked||this.stakeLocked||this.autoRunning||!!pending,1));
    this.find('balance').textContent = this.money(this.balance);
    this.root.querySelector('.np-prototype')!.textContent = this.copy.prototype;
    this.find('lock').textContent = this.stakeLocked ? this.copy.bonusStakeLock : this.collectionLocked ? this.copy.cycleLock : this.copy.choose;
    this.find('remaining-label').textContent = mode === 'rescue' ? this.copy.rewardLeft : this.copy.remaining;
    this.find('remaining').textContent = battle ? String(battle.remaining) : '';
    this.audio.setScene(this.scene, mode !== 'base');
    this.updateTeam();
  }
  private toggleAuto(open: boolean) {
    this.find('auto-panel').hidden = !open; this.find('auto').setAttribute('aria-expanded', String(open));
    if (open) this.root.querySelector<HTMLButtonElement>('[data-auto-count="' + this.autoCount + '"]')!.focus({ preventScroll: true });
  }
  private get blocked() {
    const pending = this.client.pending;
    return this.busy || this.dialog.open || this.motionOptions(this.animation.signal).paused() || !this.client.accountId || this.client.accountId !== this.wallet.accountId || this.client.busy || this.client.loading || this.wallet.busy || !!this.wallet.pending || this.wallet.hasExternalBusy('expansion') || (!!pending && pending.gameId !== NEOPOLIS_GAME);
  }
  private stopAuto() {
    this.autoEpoch++;
    this.host.ownerDocument.defaultView!.clearTimeout(this.autoTimer); this.autoTimer = undefined;
    this.autoRunning = false; this.autoRemaining = 0;
    if (this.alive) this.controls();
  }
  private async nextAuto(epoch: number) {
    if (epoch !== this.autoEpoch) return;
    this.autoTimer = undefined;
    if (!this.autoRunning) return;
    if (!this.alive || this.blocked || this.client.pending || this.client.error) { this.stopAuto(); return; }
    // The budget counts paid starts. Accepted bonus continuations stay free.
    if (this.session?.state !== 'active') {
      if (this.autoRemaining <= 0) { this.stopAuto(); return; }
      if (this.balance < this.bet) { this.stopAuto(); this.status(this.copy.lowBalance); return; }
      this.autoRemaining--;
    }
    const completed = await this.spin(true);
    if (epoch !== this.autoEpoch) return;
    if (!completed) { this.stopAuto(); return; }
    // The campaign result waits for the player; closing it ends the paid series.
    if (completed === 'campaign' && !await this.showSummary()) { if (epoch === this.autoEpoch) this.stopAuto(); return; }
    if (epoch !== this.autoEpoch) return;
    if (!this.autoRunning) return;
    if (this.autoRemaining <= 0 && this.session?.state !== 'active') { this.stopAuto(); return; }
    this.autoTimer = this.host.ownerDocument.defaultView!.setTimeout(() => { void this.nextAuto(epoch); }, this.fast ? 250 : 650);
  }
  private updatePause = () => {
    const paused = this.motionOptions(this.animation.signal).paused();
    if (paused && this.autoRunning) this.stopAuto();
    this.root.dataset.paused = String(paused); this.audio.pause(paused);
  };
  private setScene(index: number, transition = false) {
    const rescued = this.mode === 'rescue', key = index + ':' + rescued;
    if (this.sceneKey === key) return;
    this.root.querySelectorAll('.np-city-previous').forEach(image => image.remove());
    const current = this.root.querySelector<HTMLImageElement>('.np-city-current')!, background = SCENES[rescued ? 0 : index].background;
    if (transition && !this.reducedMotion && this.scene >= 0) {
      const previous = current.cloneNode() as HTMLImageElement;
      previous.className = 'np-city-previous'; current.after(previous);
      previous.addEventListener('animationend', () => previous.remove(), {once:true,signal:this.life.signal});
    }
    this.scene = index; this.sceneKey = key; this.root.dataset.boss = SCENES[index].id;
    this.root.style.setProperty('--np-costumes', 'url("' + SCENES[index].costumes + '")');
    if (current.getAttribute('src') !== background) current.src = background;
    this.find('boss-name').textContent = rescued ? this.copy.rescued : this.copy[SCENES[index].id];
    this.find('boss-title').textContent = rescued ? '' : [this.copy.nullTitle,this.copy.vesperaTitle,this.copy.aeonTitle][index];
  }
  private updateBoss(transition = false) {
    const battle = this.battle, mode = this.mode, index = battle?.boss ?? 0, defeated = battle ? battle.defeated ?? (battle.won ? 1 : 0) : 0;
    this.setScene(index, transition);
    this.root.dataset.legacy = String(this.legacy);
    this.root.querySelectorAll<HTMLElement>('[data-boss-index]').forEach((chapter,i) => {
      const { shield, core } = BOSSES[i], hits = i < defeated ? shield + core : battle && i === index ? shield - battle.shield + core - battle.core : 0;
      chapter.dataset.state = i < defeated ? 'defeated' : i === index ? 'current' : 'locked';
      chapter.setAttribute('aria-current', String(i === index && i >= defeated));
      chapter.setAttribute('aria-label', fill(this.copy.hits, { b: this.copy[BOSSES[i].id], n: hits, m: shield + core }));
      chapter.querySelectorAll<HTMLElement>('.np-ticks u').forEach((tick, n) => { tick.dataset.hit = String(n < hits); });
    });
    for (const key of ['shield','core'] as const) {
      const max = BOSSES[index][key], value = battle?.[key] ?? max;
      if (this.find(key).childElementCount !== max) this.find(key).innerHTML = '<i></i>'.repeat(max);
      this.find(key + '-label').textContent = fill(this.copy.of, { n: value, m: max });
      this.find(key).querySelectorAll('i').forEach((segment, i) => segment.dataset.destroyed = String(i >= value));
    }
    const team = this.team, joined = team.charges.filter(charge => charge === 3).length, ready = readyTeam(team);
    const step = (name: string) => this.root.querySelector<HTMLElement>('[data-step="' + name + '"]')!;
    step('team').dataset.done = String(ready); step('team').querySelector('em')!.textContent = fill(this.copy.of, { n: joined, m: 3 });
    step('null').dataset.done = 'false'; step('null').querySelector('em')!.textContent = ready ? this.copy.stepOpen : this.copy.stepLater;
    if (mode === 'rescue') this.boss.hide();
    else this.boss.show(index, battle, battle ? 0 : ready ? .34 : .8 - (team.charges.reduce((sum, charge) => sum + charge, 0) - 3) * .07);
  }
  private sync() {
    if (!this.alive) return;
    if (this.owner !== this.client.accountId) {
      this.stopAuto();
      this.owner = this.client.accountId; this.animation.abort(); this.animation = new AbortController();
      this.reels = undefined;
      this.effects.clear(); this.presentationTeam = undefined; this.presentationBattle = null;
      this.audio.cancelEffects(); this.feedback.clear(); this.feedback.setAmount(0);
      this.busy = false; this.seen = ''; this.selected = 'granite'; this.bet = 0.1; delete this.root.dataset.power;
      if (this.dialog.open) this.dialog.close();
      this.draw(initialGrid); this.find('win').textContent = this.money(0); this.find('gain').textContent = '';
      this.status(this.copy.collect);
      this.find('win-label').textContent = this.copy.win; this.find('credit').textContent = this.copy.lastRound;
      this.clearStory();
    }
    const view = this.view, marker = this.session?.id + ':' + view?.revision;
    if (!this.busy && view && this.seen !== marker) {
      this.seen = marker; this.bet = Number(this.session!.stakeUnits) / 100; this.selected = view.team.starter;
      this.draw(view.history.at(-1)!.result.grid);
      this.feedback.setAmount(Number(confirmedPayout(this.session,view.totalPayoutUnits)));
      this.find('win-label').textContent = view.battle ? this.copy.total : this.copy.payout;
      if (this.session!.state !== 'active') this.boss.snap();
      this.find('credit').textContent = this.session!.state === 'active' ? this.copy.held : this.copy.credited;
      this.status(view.capped ? this.copy.cap : this.session!.state === 'active' ? this.copy.saved : this.copy.settled);
    }
    if (!this.client.accountId) this.status(this.copy.signin);
    else if (this.client.pending && !this.busy) this.status(this.client.pending.gameId === NEOPOLIS_GAME ? this.copy.error : this.copy.otherPending);
    if (this.autoRunning && !this.busy && (this.client.pending || this.client.error)) this.stopAuto();
    this.updateBoss(); this.controls();
    this.services.reactions.observeExpansionOutcome(this.root, NEOPOLIS_GAME, this.session, this.client.accountId, this.busy, !!this.client.pending);
  }
  private async wait(ms: number, signal: AbortSignal) {
    const duration=this.reducedMotion ? 0 : this.fast ? ms/4 : ms,options=this.motionOptions(signal);
    if (!duration && !options.paused()) return;
    await waitMotion(this.root,duration,options);
  }
  /* Story beats. They replay confirmed frames only and stop with the presentation. */
  private replay(element: HTMLElement, name: string) { element.classList.remove(name); void element.offsetWidth; element.classList.add(name); }
  private clearStory() {
    this.stopShake();
    for (const [name, shown] of [['cutin','np-cutin-on'],['callout','np-callout-on'],['verdict','np-verdict-on'],['flash','np-flash-on']] as const) this.find(name).classList.remove(shown);
    this.root.querySelectorAll('.np-striking, .np-joining').forEach(card => card.classList.remove('np-striking','np-joining'));
    delete this.root.dataset.power; delete this.root.dataset.fx;
  }
  private heroCard(hero: Hero) { return this.root.querySelector<HTMLElement>('[data-hero="' + hero + '"]')!; }
  private flashScreen() { if (!this.reducedMotion) this.replay(this.find('flash'), 'np-flash-on'); }
  private stopShake() { for (const move of this.quake) move.cancel(); this.quake = []; }
  private shake(power: number, duration: number) {
    if (this.reducedMotion) return;
    const at = (left: number) => (Math.random() * 2 - 1) * power * left + 'px';
    const steps: Keyframe[] = Array.from({ length: 8 }, (_, i) => ({ transform: 'translate(' + at(1 - i / 8) + ',' + at(1 - i / 8) + ')' }));
    this.stopShake();
    // Chrome can lose hit testing for a whole subtree after such an animation,
    // so only parts without controls move: the city, the villain and the reels.
    this.quake = ['.np-city','.np-arena','.np-board'].map(part => this.root.querySelector(part)!.animate([...steps, { transform: 'none' }], { duration }));
  }
  private callout(title: string, note: string) {
    if (this.reducedMotion) return;
    this.find('callout').innerHTML = escape(title) + (note ? '<small>' + escape(note) + '</small>' : '');
    this.replay(this.find('callout'), 'np-callout-on');
  }
  private async verdict(title: string, note: string, duration: number, signal: AbortSignal) {
    const banner = this.find('verdict');
    banner.querySelector('b')!.textContent = title; banner.querySelector('span')!.textContent = note;
    if (!this.reducedMotion) { banner.style.animationDuration = duration * (this.fast ? .25 : 1) + 'ms'; this.replay(banner, 'np-verdict-on'); }
    await this.wait(duration, signal);
    banner.classList.remove('np-verdict-on');
  }
  private async cutin(hero: Hero, signal: AbortSignal) {
    if (this.fast || this.reducedMotion) return;
    const band = this.find('cutin');
    band.style.setProperty('--np-hero', HERO_COLORS[hero]);
    band.querySelector('.np-cutin-art')!.innerHTML = portrait(hero);
    band.querySelector('b')!.textContent = this.power(hero); band.querySelector(':scope > div > span')!.textContent = this.copy[hero];
    this.replay(band, 'np-cutin-on');
    await this.wait(700, signal);
  }
  private async presentHit(frame: Frame, signal: AbortSignal) {
    const battle = frame.battle!, heroes = this.struck.length ? this.struck : [this.team.starter], target = this.boss.target(), last = battle.core === 0;
    for (const hero of heroes) {
      this.replay(this.heroCard(hero), 'np-striking'); this.effects.strike(hero, target, last);
      await this.wait(last ? 160 : 110, signal);
    }
    await this.wait(260, signal);
    if (signal.aborted) return;
    const shielded = this.boss.shielded, broken = shielded && battle.shield === 0, who = heroes.map(hero => this.copy[hero]).join(', ');
    this.boss.hit(); this.shake(shielded ? 7 : 12, 380); this.effects.glow(target, '#fff', 120, 300);
    this.audio.play(broken ? 'shield-break' : 'boss-hit');
    this.presentationBattle = structuredClone(battle); this.updateBoss(); this.controls();
    if (broken) {
      this.flashScreen(); this.shake(14, 520); this.effects.ring(this.boss.centre(), '#fff1c0', 300, 900, 12);
      this.callout(this.copy.shieldDown, this.copy.powersUp);
      this.status(fill(this.copy.shieldStatus, { b: this.copy[BOSSES[battle.boss ?? 0].id] }));
    } else if (shielded) {
      this.callout(this.copy.plateBroken, fill(this.copy.left, { n: battle.shield })); this.status(fill(this.copy.hitShield, { h: who }));
    } else {
      this.callout(last ? this.copy.lastNode : this.copy.nodeBroken, last ? '' : fill(this.copy.left, { n: battle.core })); this.status(fill(this.copy.hitNode, { h: who }));
    }
    await this.wait(broken ? 1000 : last ? 420 : 720, signal);
  }
  private async presentDefeat(frame: Frame, signal: AbortSignal) {
    const index = frame.battle!.boss ?? 0, centre = this.boss.centre();
    this.status(this.copy.finisher); this.audio.play('finisher');
    for (const hero of HEROES) { this.replay(this.heroCard(hero), 'np-striking'); this.effects.beam(this.effects.hero(hero), centre, HERO_COLORS[hero], 1400, 15); }
    await this.wait(720, signal);
    if (signal.aborted) return;
    this.flashScreen(); this.shake(18, 700); this.audio.play('boss-defeated'); this.boss.die(this.fast ? 700 : 1900);
    await this.wait(950, signal);
    if (signal.aborted) return;
    // The rescue scene waits until the team attack has finished its cascades.
    this.presentationBattle = { ...structuredClone(frame.battle!), won: false };
    this.updateBoss(); this.controls();
    const seal = this.root.querySelector('[data-boss-index="' + index + '"] .np-medal');
    this.effects.ring(this.effects.point(seal), '#ffd98a', 70, 700, 5);
    this.effects.burst(this.effects.point(seal), 26, { speed: 150, life: 800, size: 5, color: '#ffd98a', shape: 'shard' });
    this.status(this.copy[('defeated' + index) as 'defeated0'] + ' · ' + this.copy.extra);
    await this.verdict(this.copy[('defeated' + index) as 'defeated0'], this.copy.extra, 1900, signal);
  }
  private async presentArrival(frame: Frame, signal: AbortSignal) {
    const battle = frame.battle!, index = battle.boss ?? 0, place = [this.copy.location0,this.copy.location1,this.copy.location2][index], first = !this.presentationBattle;
    if (first) for (const [cell, symbol] of frame.grid.entries()) if (symbol === 7) {
      this.effects.bolt(this.effects.cell(cell), this.boss.centre(), '#b06bff', 800); this.effects.ring(this.effects.cell(cell), '#d9b0ff', 80, 700);
    }
    this.audio.play('boss-arrival'); this.shake(7, 600);
    if (first) await this.wait(700, signal);
    if (signal.aborted) return;
    this.flashScreen();
    this.presentationBattle = structuredClone(battle); this.updateBoss(!first); this.controls();
    if (first) { this.boss.show(index, battle, 0); this.status(this.copy.triggered); }
    else {
      this.boss.enter(); this.root.querySelectorAll<HTMLElement>('.np-hero').forEach(card => this.replay(card, 'np-joining'));
      this.status(fill(this.copy.arenaNow, { a: place }));
    }
    this.effects.portal(this.boss.centre(), index === 1 ? '#ff7642' : index === 2 ? '#82d7ff' : '#b078ff', 150, 1500);
    if (first && !this.autoRunning) await this.wait(500, signal);
    else { await this.wait(350, signal); await this.verdict(this.copy[BOSSES[index].id], place + ' · ' + fill(this.copy.spinsAward, { n: neopolisBosses(this.view!.version)[index].spins }), 1800, signal); }
  }
  private async present(frame: Frame, signal: AbortSignal) {
    await this.wait(0,signal);
    if (signal.aborted) return;
    if (frame.kind==='cascade' && !this.reducedMotion) await dissolveNeopolisSymbols(this.find('board'),frame.cells,this.motionOptions(signal));
    if (signal.aborted) return;
    this.root.dataset.fx = frame.hero ?? frame.kind;
    if (frame.kind === 'boss-hit') return this.presentHit(frame, signal);
    if (frame.kind === 'boss-defeated') return this.presentDefeat(frame, signal);
    if (frame.kind === 'boss-arrival') return this.presentArrival(frame, signal);
    const finishing = frame.kind === 'finisher';
    if (frame.battle !== undefined) this.presentationBattle = frame.battle && { ...structuredClone(frame.battle), won: this.rescuedBefore };
    for (const index of frame.emblems) if (index >= 0 && this.presentationTeam && this.presentationTeam.charges[index] < 3) {
      this.presentationTeam.charges[index]++;
      if (this.presentationTeam.charges[index] < 3) continue;
      const hero = HEROES[index];
      this.replay(this.heroCard(hero), 'np-joining'); this.status(fill(this.copy.joined, { h: this.copy[hero], p: this.power(hero) }));
    }
    this.root.dataset.power = frame.hero ?? (finishing ? 'team' : '');
    this.updateBoss(); this.controls();
    if (frame.hero) {
      const hero = frame.hero;
      this.struck.push(hero); this.status(this.copy[hero] + ' · ' + this.power(hero));
      this.replay(this.heroCard(hero), 'np-striking');
      await this.cutin(hero, signal);
      if (signal.aborted) return;
      this.audio.play(hero); this.effects.play(hero, frame.cells, hero);
      if (hero === 'granite') this.shake(11, 430); else if (hero === 'impulse') this.shake(5, 220);
      if (!this.reducedMotion && hero !== 'impulse') {
        const cells = this.root.querySelectorAll('.np-board [role=gridcell]');
        for (const cell of frame.cells) cells[cell]?.classList.add(hero === 'granite' ? 'np-smashed' : 'np-warping');
        await this.wait(hero === 'granite' ? 260 : 190, signal);
        if (signal.aborted) return;
      }
    }
    const falling = frame.kind === 'cascade' || frame.hero === 'granite';
    this.draw(frame.grid, frame.emblems, falling || frame.kind==='win' ? [] : frame.cells, frame.hero ?? frame.kind);
    if (frame.kind==='win') {
      const recorded=this.view!.history.at(-1)!;
      const earned=Number(neopolisPointUnits(this.session!.stakeUnits,frame.points,this.view!.version,this.view!.origin));
      const total=this.roundBeforeUnits+Math.min(earned,Number(recorded.payoutUnits));
      const best=[...frame.wins].sort((a,b)=>b.points-a.points)[0];
      if (best) this.status(this.copy[('symbol'+best.symbol) as 'symbol0']+' ×'+best.count+' · '+fill(this.copy.linesPaid,{n:frame.wins.length}));
      await this.feedback.win(frame,this.presentationUnits,total,this.motionOptions(signal),this.winChain++);
      return;
    }
    if (finishing) { this.effects.play('finisher', frame.cells); this.shake(6, 300); this.status(this.copy.finisher); }
    if (falling && !this.reducedMotion) await dropNeopolisSymbols(this.find('board'), frame.cells, this.motionOptions(signal));
    if (signal.aborted) return;
    await this.wait(frame.hero || finishing ? 560 : frame.kind==='cascade' ? 60 : 110, signal);
  }
  private async spin(automatic = false): Promise<false | 'round' | 'campaign'> {
    if (!this.alive || this.blocked || this.autoRunning && !automatic) return false;
    if (!this.client.pending && this.session?.state !== 'active' && this.balance < this.bet) { this.status(this.copy.lowBalance); return false; }
    let completed: false | 'round' | 'campaign' = false;
    this.toggleAuto(false);
    const owner = this.client.accountId, animation = this.animation;
    this.presentationTeam = structuredClone(this.team);
    this.presentationBattle = this.session?.state === 'active' ? structuredClone(this.view?.battle ?? null) : null;
    this.audio.cancelEffects(); this.feedback.clear(); this.winChain=0;
    this.feedback.setAmount(this.session?.state==='active' ? Number(this.view?.totalPayoutUnits ?? 0) : 0);
    this.struck = []; this.rescuedBefore = !!this.presentationBattle?.won; this.find('gain').textContent = '';
    this.busy = true; this.controls(); this.status(this.copy.waiting);
    this.effects.clear(); this.clearStory(); this.updateBoss();
    let landing: Frame | undefined;
    const reels = this.reducedMotion ? undefined : new NeopolisReels(this.find('board'), this.motionOptions(animation.signal), col => {
      if (!landing) return;
      const cells = [0,1,2,3].map(row => row * 5 + col);
      const scatters = cells.filter(cell => landing!.grid[cell] === 7);
      if (scatters.length) this.effects.play('scatter',scatters);
      for (const cell of cells) if (landing.emblems[cell] >= 0) this.effects.play('emblem',[cell],HEROES[landing.emblems[cell]]);
    },col=>{
      const sounds:Accent[]=[{cue:'stop',variant:col}],cells=[0,1,2,3].map(row=>row*5+col);
      if(landing && cells.some(cell=>landing!.grid[cell]===7)) sounds.push({cue:'scatter'});
      if(landing && cells.some(cell=>landing!.emblems[cell]>=0)) sounds.push({cue:'emblem'});
      return sounds;
    });
    this.reels = reels;
    try {
      void this.audio.start().then(() => { if (this.alive && !animation.signal.aborted && reels && this.reels===reels) this.audio.spinning(true); });
      const before = this.session;
      if (this.client.pending) await this.client.retry();
      else if (before?.state === 'active') await this.client.act({ gameId: NEOPOLIS_GAME, action: 'move', sessionId: before.id, move: 'neopolis-spin', revision: before.view.neopolis!.revision });
      else await this.client.act({ gameId: NEOPOLIS_GAME, action: 'start', stakeUnits: String(gameBetCents(this.bet)), settings: { neopolis: { hero: this.selected } } });
      if (!this.alive || owner !== this.client.accountId || animation.signal.aborted) return false;
      const view = this.view;
      if (!view) throw Error(this.copy.error);
      const spin = view.history.at(-1)!;
      this.roundBeforeUnits=Number(view.totalPayoutUnits)-Number(spin.payoutUnits);
      this.feedback.setAmount(this.roundBeforeUnits);
      this.status(this.copy.spinning);
      if (reels) {
        const first = spin.result.frames[0];
        landing = first;
        await reels.finish(Array.from({ length: 5 }, (_, col) => Array.from({ length: 4 }, (_, row) => {
          const cell = row * 5 + col;
          return this.cellMarkup(first.grid[cell], first.emblems[cell]);
        })));
        reels.destroy(); if (this.reels === reels) this.reels = undefined;
        this.audio.spinning(false);
      }
      for (const frame of spin.result.frames) {
        if (!this.alive || animation.signal.aborted) return false;
        await this.present(frame, animation.signal);
      }
      if (animation.signal.aborted) return false;
      this.draw(spin.result.grid); this.clearStory();
      if (view.battle?.won && !this.rescuedBefore && this.session?.state === 'active') {
        this.presentationBattle = structuredClone(view.battle); this.flashScreen(); this.updateBoss(true); this.controls();
        this.status(this.copy.victory);
        await this.verdict(this.copy.rescued, this.copy.rewardLeft + ': ' + view.battle.remaining, 2000, animation.signal);
        if (animation.signal.aborted) return false;
      }
      if (this.session?.state==='settled') await this.feedback.finish(Number(confirmedPayout(this.session,view.totalPayoutUnits)),Number(this.session.stakeUnits),this.motionOptions(animation.signal));
      if (animation.signal.aborted) return false;
      this.seen = ''; this.busy = false; this.sync();
      const message = view.capped ? this.copy.cap : spin.result.finisher ? (view.battle?.won ? this.copy.victory : this.copy.finisher) + ' · ' + this.copy.extra : spin.result.finished ? (view.battle?.won ? this.copy.rescued : this.copy.escaped) + '. ' + this.copy.finished : spin.result.triggered ? this.copy.triggered : spin.result.unlocked.length ? this.copy.unlocked + ': ' + spin.result.unlocked.map(hero => this.copy[hero]).join(', ') : view.battle?.shield === 0 && !spin.result.empowered ? this.copy.empowered : this.copy.settled;
      const round=this.feedback.getState().round;
      const signed=round ? (round.net<0 ? '−' : round.net>0 ? '+' : '')+this.number(Math.abs(round.net)/100) : '';
      const result=round?.tier==='partial' ? this.copy.partialReturn : round?.tier==='even' ? this.copy.evenReturn : round?.tier==='loss' ? this.copy.noPayout : message;
      const gained = Number(spin.payoutUnits); this.find('gain').textContent = gained > 0 ? '+' + this.money(gained / 100) : '';
      this.status(result+(round ? ' · '+this.copy.roundNet+': '+signed : ''));
      completed = spin.result.finished ? 'campaign' : 'round';
      if (!this.autoRunning && spin.result.triggered) this.showIntro();
      else if (!this.autoRunning && spin.result.finished) void this.showSummary();
    } catch (error) {
      if (this.alive && owner === this.client.accountId) {
        this.stopAuto();
        this.status(this.client.error || (error instanceof Error ? error.message : this.copy.error));
      }
    } finally {
      reels?.destroy(); if (this.reels === reels) this.reels = undefined;
      if (this.alive && owner === this.client.accountId) {
        this.audio.spinning(false);
        this.busy = false; this.presentationTeam = undefined; this.clearStory();
        this.effects.clear(); this.sync();
      }
    }
    return completed;
  }
  /** Full-scene pages keep to the game's own area, beside the connected chat. */
  private placeCover() {
    const style = this.dialog.style;
    if (this.dialog.dataset.view === 'rules') { for (const name of ['left','top','width','height']) style.removeProperty(name); return; }
    const box = this.root.getBoundingClientRect();
    style.left = box.left + 'px'; style.top = box.top + 'px'; style.width = box.width + 'px'; style.height = box.height + 'px';
  }
  private openCover(view: 'intro' | 'summary', html: string, closed?: (confirmed: boolean) => void) {
    this.toggleAuto(false); this.dialog.dataset.view = view; this.find('dialog-body').innerHTML = html;
    this.find('notice-continue').addEventListener('click', () => this.dialog.close('continue'), { once: true, signal: this.life.signal });
    this.dialog.returnValue = ''; this.coverClosed = closed; this.placeCover(); this.dialog.showModal();
    this.find('notice-continue').focus({ preventScroll: true }); this.updatePause(); this.controls();
  }
  private showIntro() {
    const c = this.copy, { shield, core, spins, id } = neopolisBosses(this.view!.version)[0];
    this.openCover('intro', '<div class="np-cover-back" aria-hidden="true"></div><div class="np-cover-art" aria-hidden="true" data-villain="' + id + '"></div><div class="np-cover-box"><small>' + c.introKicker + '</small><h2>' + c[id] + '</h2><p>' + c.nullTitle + '</p><ol class="np-plan"><li><b>' + shield + '</b>' + c.planShield + '</li><li><b>' + core + '</b>' + c.planCore + '</li><li><b>' + spins + '</b>' + c.planSpins + '</li></ol><button type="button" class="np-primary" data-np="notice-continue">' + c.toBattle + '</button></div>');
  }
  /** Resolves with true when the player confirmed the result and may go on. */
  private showSummary(): Promise<boolean> {
    const c = this.copy, view = this.view, battle = view?.battle;
    if (!battle || !this.session) return Promise.resolve(true);
    const defeated = battle.defeated ?? (battle.won ? 1 : 0), bosses = view.version === 1 ? BOSSES.slice(0, 1) : BOSSES;
    const cell = (label: string, value: string, name = '') => '<div' + name + '><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    return new Promise(resolve => this.openCover('summary', '<div class="np-cover-art" aria-hidden="true"></div><div class="np-cover-box"><small>' + c.campaignOver + '</small><h2>' + (battle.won ? c.rescued : c.escaped) + '</h2><ul class="np-fallen">'
      + bosses.map((boss, index) => '<li data-state="' + (index < defeated ? 'defeated' : 'locked') + '">' + medal(boss.id) + '<span>' + c[((index < defeated ? 'defeated' : 'standing') + index) as 'defeated0'] + '</span></li>').join('')
      + '</ul><dl>' + cell(c.sumSpins, String(battle.played)) + cell(c.sumStake, this.money(Number(this.session!.stakeUnits) / 100)) + cell(c.sumPay, this.money(Number(confirmedPayout(this.session, view.totalPayoutUnits)) / 100), ' class="np-sum-pay"') + '</dl><p>' + c.credited + '</p><button type="button" class="np-primary" data-np="notice-continue">' + (this.autoRunning ? c.continue : c.newTeam) + '</button></div>', resolve));
  }
  private showRules() {
    this.stopAuto(); this.toggleAuto(false); this.dialog.dataset.view = 'rules'; this.placeCover();
    const c = this.copy, pay = (value: number) => value.toLocaleString(this.services.i18n.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const [nullBoss, vespera, aeon] = neopolisBosses(this.rulesVersion);
    const campaign = fill(c.rulesBoss, { start: nullBoss.spins, second: vespera.spins, third: aeon.spins });
    const bonusPay = this.rulesVersion === NEOPOLIS_RULES_VERSION ? c.rulesBonusPay : '';
    this.find('dialog-body').innerHTML = '<span class="np-dialog-kicker">ROYAL ORIGINALS / NEOPOLIS</span><h2>' + c.rules + '</h2>'
      + stakeRulesHtml() + [c.rulesBase,c.rulesTeam,c.rulesHeroes,this.legacy ? c.rulesLegacy : campaign,bonusPay,c.rulesMoney,c.autoHelp].filter(Boolean).map(text => '<p>' + text + '</p>').join('')
      + '<h3>' + (this.stakeLocked ? c.bonusPayouts : c.payouts) + '</h3><table><thead><tr><th>' + c.symbol + '</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>'
      + neopolisPaytable(this.rulesVersion, this.stakeLocked ? this.view!.origin : this.team, this.stakeLocked).map((pays, index) => '<tr><th>' + symbolArt(index) + c[('symbol' + index) as keyof typeof c] + '</th>' + pays.map(value => '<td>×' + pay(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    if (!this.dialog.open) this.dialog.showModal(); this.updatePause(); this.controls();
  }
  pause() { this.paused = true; this.updatePause(); this.controls(); }
  resume() { this.paused = false; this.updatePause(); this.controls(); }
  getState() { return { gameId: NEOPOLIS_GAME, language: this.services.i18n.language, ready: !!this.client.accountId, busy: this.busy, autoplay: { running: this.autoRunning, remaining: this.autoRemaining, count: this.autoCount }, selected: this.selected, team: this.team, battle: this.view?.battle ?? null, revision: this.view?.revision ?? 0, stake: this.bet, audio: this.audio.getState(),feedback:this.feedback.getState() }; }
  destroy() {
    if (!this.alive) return;
    this.alive = false; this.stopAuto(); this.animation.abort(); this.life.abort(); this.stopAudio?.();
    this.coverObserver.disconnect(); this.weather.destroy(); this.boss.destroy(); this.effects.destroy();
    this.audio.destroy();
    this.feedback.destroy();
    this.client.removeEventListener('change', this.changed); this.wallet.removeEventListener('change', this.changed);
    if (this.dialog.open) this.dialog.close(); this.root.remove();
  }
}
