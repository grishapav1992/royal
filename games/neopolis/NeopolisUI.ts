import {GAME_BETS as NEOPOLIS_BETS} from '../../src/shared/gameStakes';
import { readGameHost } from '../../src/modules/GameHostContract';
import { NEOPOLIS_GAME, neopolisPointUnits, neopolisPaytable } from '../../src/shared/neopolis';
import { BOSSES, HEROES, initialTeam, readyTeam, type Hero, type Team, type Battle, type Frame } from '../../src/shared/neopolisMath';
import { neopolisCopy } from './copy';
import { SCENES, noticeArt, portrait, skyline, symbolArt } from './art';
import { dissolveNeopolisSymbols, dropNeopolisSymbols, NeopolisReels } from './NeopolisReels';
import { NeopolisEffects } from './NeopolisEffects';
import { NeopolisAudio } from './NeopolisAudio';
import { NeopolisFeedback } from './NeopolisFeedback';
import { waitMotion, type Accent } from './NeopolisMotion';

const AUTO_COUNTS = [10, 25, 50, 100] as const;
const initialGrid = [0,1,2,3,4, 2,3,4,5,0, 4,5,0,1,2, 1,2,3,4,5];
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
  private audio: NeopolisAudio;
  private feedback: NeopolisFeedback;
  private presentationUnits = 0;
  private roundBeforeUnits = 0;
  private winChain = 0;
  private scene = -1;
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
  private get battle() { return this.busy ? this.presentationBattle : this.view?.battle ?? null; }
  private get legacy() { return this.view?.version === 1 && !!this.view.battle; }
  private get stakeLocked() { return this.session?.state === 'active'; }
  private get collectionLocked() { return !!this.view && !this.view.team.complete; }
  private get balance() { return this.wallet.accountId === this.client.accountId ? (this.wallet.wallet?.balance ?? this.client.wallet?.balance ?? 0) : 0; }
  private number(n: number) { return n.toLocaleString(this.services.i18n.locale, { maximumFractionDigits: 2 }); }
  private find<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>('[data-np="' + name + '"]')!; }
  private power(hero: Hero) { return { granite: this.copy.granitePower, impulse: this.copy.impulsePower, prism: this.copy.prismPower }[hero]; }

  constructor(private host: HTMLElement) {
    const c = this.copy, doc = host.ownerDocument;
    this.root = doc.createElement('section'); this.root.className = 'np'; this.root.lang = this.services.i18n.language;
    this.root.setAttribute('aria-label', this.title);
    this.root.innerHTML = skyline
      + '<header class="np-top"><span class="np-brand">ROYAL <b>ORIGINALS</b><small>NEOPOLIS / CHAPTER 01</small></span><span class="np-prototype">' + c.prototype + '</span><div class="np-tools"><label class="np-fast"><input type="checkbox" data-np="fast">' + c.fast + '</label><button data-np="sound" aria-label="' + c.sound + '" aria-pressed="false">♪</button><button data-np="rules" aria-label="' + c.rules + '">?</button></div></header>'
      + '<div class="np-title"><span>' + c.subtitle + '</span><h1>' + c.title + '</h1><ol class="np-campaign-track" aria-label="' + c.campaign + '">' + BOSSES.map((boss,index) => '<li data-boss-index="' + index + '"><small>0' + (index + 1) + '</small><span>' + c[boss.id] + '</span></li>').join('') + '</ol></div>'
      + '<div class="np-content"><div class="np-layout"><aside class="np-team"><div class="np-section-label"><span>01</span>' + c.team + '</div><p class="np-team-hint" data-np="team-hint">' + c.choose + '</p>'
      + HEROES.map((hero, index) => '<button class="np-hero" data-hero="' + hero + '" data-active="false" aria-pressed="false"><span class="np-portrait">' + portrait(hero) + '</span><span class="np-hero-copy"><small>0' + (index + 1) + ' / <span data-hero-state></span></small><strong>' + c[hero] + '</strong><b>' + this.power(hero) + '</b><span class="np-hero-detail">' + { granite:c.graniteDetail, impulse:c.impulseDetail, prism:c.prismDetail }[hero] + '</span><span class="np-pips" aria-hidden="true"><i></i><i></i><i></i></span></span></button>').join('')
      + '</aside><section class="np-machine"><div class="np-machine-top"><span data-np="mode">' + c.base + '</span><b>' + c.lines + '</b></div><div class="np-board-shell"><div class="np-board" role="grid" aria-label="' + c.field + '" aria-colcount="5" aria-rowcount="4" data-np="board"></div><div class="np-event" data-np="event" aria-hidden="true"></div><div class="np-ability-card" data-np="ability-card" aria-hidden="true"></div><div class="np-chapter" data-np="chapter" aria-hidden="true"></div></div><div class="np-transmission"><span class="np-live-dot"></span><p role="status" aria-live="polite" data-np="status">' + c.collect + '</p></div><div class="np-spin-meta"><span data-np="remaining">' + c.location0 + '</span><span data-np="win-note">' + c.coins + '</span></div></section>'
      + '<aside class="np-boss" data-np="boss"><div class="np-section-label"><span data-np="boss-number">01</span>' + c.threat + '</div><div class="np-villain" data-np="villain">' + portrait('null') + '<span class="np-target-ring"></span></div><div class="np-villain-name"><small data-np="boss-title">' + c.nullTitle + '</small><h2 data-np="boss-name">' + c.null + '</h2></div><div class="np-boss-meters"><label>' + c.shield + '<span data-np="shield-label">3 / 3</span></label><div class="np-segments" data-np="shield"><i></i><i></i><i></i></div><label>' + c.core + '<span data-np="core-label">3 / 3</span></label><div class="np-segments np-core" data-np="core"><i></i><i></i><i></i></div></div><p data-np="boss-hint">' + c.awaiting + '</p></aside></div></div>'
      + '<footer class="np-controls"><div class="np-value"><span>' + c.balance + '</span><strong data-np="balance">0</strong><small>' + c.coins + '</small></div><label class="np-stake"><span>' + c.bet + '</span><select data-np="bet" aria-label="' + c.bet + '">' + NEOPOLIS_BETS.map(bet => '<option value="' + bet + '"' + (bet === this.bet ? ' selected' : '') + '>' + bet + '</option>').join('') + '</select></label><div class="np-value np-win"><span data-np="win-label">' + c.win + '</span><strong data-np="win">0</strong><small data-np="credit">' + c.coins + '</small></div><button class="np-spin" data-np="spin"><span>' + c.spin + '</span><b aria-hidden="true">↻</b></button><div class="np-auto"><label><span>' + c.autoSpins + '</span><select data-np="auto-count" aria-label="' + c.autoSpins + '" title="' + c.autoHelp + '">' + AUTO_COUNTS.map(count => '<option value="' + count + '">' + count + '</option>').join('') + '</select></label><button data-np="auto" aria-pressed="false">' + c.autoplay + '</button></div></footer>'
      + '<p class="np-cycle-lock" data-np="lock"></p><dialog class="np-dialog" data-np="dialog"><button data-np="close" class="np-close" aria-label="' + c.close + '">×</button><div data-np="dialog-body"></div></dialog>';
    host.replaceChildren(this.root); this.dialog = this.find<HTMLDialogElement>('dialog');
    this.effects = new NeopolisEffects(this.root.querySelector('.np-layout')!, () => this.motionOptions(this.animation.signal).paused(), () => this.reducedMotion);
    this.audio = new NeopolisAudio(this.services.gameAudio,doc);
    this.feedback = new NeopolisFeedback(this.root,this.copy,n=>this.number(n),units=>{
      this.presentationUnits=units; this.find('win').textContent=this.number(units/100);
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
      else if (!this.blocked && !this.client.pending && !this.client.error) {
        const count = Number(this.find<HTMLSelectElement>('auto-count').value);
        if (!AUTO_COUNTS.some(value => value === count)) return;
        this.autoRunning = true; this.autoRemaining = count; const epoch = ++this.autoEpoch; this.controls();
        void this.nextAuto(epoch);
      }
    }, options);
    doc.defaultView!.addEventListener('offline', () => this.stopAuto(), options);
    this.find('rules').addEventListener('click', () => this.showRules(), options);
    this.find('close').addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('close', () => { this.updatePause(); this.controls(); }, options);
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
    return '<div role="gridcell" class="np-cell' + (hit ? ' np-hit' : '') + '" data-symbol="' + symbol + '" data-effect="' + event + '" aria-label="' + label + '">' + symbolArt(symbol) + (emblem >= 0 ? '<span class="np-emblem" data-emblem="' + HEROES[emblem] + '">' + ['◆','ϟ','◈'][emblem] + '</span>' : '') + '</div>';
  }
  private draw(grid: number[], emblems: number[] = [], cells: number[] = [], event = '') {
    this.find('board').innerHTML = Array.from({ length: 4 }, (_, row) => '<div role="row" class="np-row">' + grid.slice(row * 5, row * 5 + 5).map((symbol, col) => {
      const index = row * 5 + col;
      return this.cellMarkup(symbol, emblems[index], cells.includes(index), event);
    }).join('') + '</div>').join('');
  }
  private get reducedMotion() { return this.host.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  private motionOptions(signal: AbortSignal) { return { signal, fast: this.fast, paused: () => this.paused || this.dialog.open || this.host.ownerDocument.hidden, audio:this.audio }; }
  private status(text: string) { this.find('status').textContent = text; }
  private updateTeam() {
    const team = this.team;
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((button, index) => {
      const active = team.charges[index] === 3, hero = HEROES[index];
      button.dataset.active = String(active); button.disabled = this.collectionLocked || this.busy || this.autoRunning || !!this.client.pending;
      button.setAttribute('aria-pressed', String(team.starter === hero));
      button.setAttribute('aria-label', this.copy[hero] + ' · ' + this.power(hero) + ' · ' + team.charges[index] + '/3');
      button.querySelector('[data-hero-state]')!.textContent = team.starter === hero ? this.copy.starter : active ? this.copy.active : this.copy.locked + ' ' + team.charges[index] + '/3';
      button.querySelectorAll('.np-pips i').forEach((pip, i) => (pip as HTMLElement).dataset.filled = String(i < team.charges[index]));
    });
    this.find('team-hint').textContent = this.collectionLocked ? this.copy.collect : this.copy.choose;
  }
  private controls() {
    if (!this.alive) return;
    const battle = this.battle, free = this.busy ? !!battle : this.session?.state === 'active', pending = this.client.pending;
    const blocked = this.blocked;
    this.find<HTMLButtonElement>('spin').disabled = blocked || this.autoRunning;
    this.find('spin').querySelector('span')!.textContent = this.busy ? this.copy.waiting : pending?.gameId === NEOPOLIS_GAME ? this.copy.retry : free ? this.copy.freeSpin : this.copy.spin;
    this.find<HTMLSelectElement>('bet').disabled = blocked || this.stakeLocked || this.autoRunning || !!pending;
    this.find<HTMLSelectElement>('auto-count').disabled = blocked || this.autoRunning || !!pending;
    const auto = this.find<HTMLButtonElement>('auto');
    auto.disabled = !this.autoRunning && (blocked || !!pending || !!this.client.error);
    auto.textContent = this.autoRunning ? this.copy.stopAuto + ' (' + this.autoRemaining + ')' : this.copy.autoplay;
    auto.setAttribute('aria-pressed', String(this.autoRunning));
    auto.setAttribute('aria-label', this.autoRunning ? this.copy.stopAuto + '. ' + this.copy.autoRemaining.replace('{n}', String(this.autoRemaining)) : this.copy.autoplay);
    this.find<HTMLSelectElement>('bet').value = String(this.bet);
    this.find('balance').textContent = this.number(this.balance);
    this.root.querySelector('.np-prototype')!.textContent = this.copy.prototype;
    this.find('balance').parentElement!.querySelector('small')!.textContent = this.copy.coins;
    this.find('lock').textContent = this.stakeLocked ? this.copy.bonusStakeLock : this.collectionLocked ? this.copy.cycleLock : '';
    this.find('mode').textContent = free ? (this.legacy ? this.copy.legacyBattle : this.copy.bonus + ' · ' + this.copy[BOSSES[battle?.boss ?? 0].id]) : this.copy.base;
    this.find('remaining').textContent = free ? this.copy.remaining + ': ' + battle!.remaining : [this.copy.location0,this.copy.location1,this.copy.location2][this.scene];
    this.root.dataset.battle = String(free);
    this.audio.setScene(this.scene,free);
    this.updateTeam();
  }
  private get blocked() {
    const pending = this.client.pending;
    return this.busy || this.motionOptions(this.animation.signal).paused() || !this.client.accountId || this.client.accountId !== this.wallet.accountId || this.client.busy || this.client.loading || this.wallet.busy || !!this.wallet.pending || this.wallet.hasExternalBusy('expansion') || (!!pending && pending.gameId !== NEOPOLIS_GAME);
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
    if (this.scene === index) return;
    this.root.querySelectorAll('.np-city-previous').forEach(image => image.remove());
    const current = this.root.querySelector<HTMLImageElement>('.np-city-current')!;
    if (transition && !this.reducedMotion && this.scene >= 0) {
      const previous = current.cloneNode() as HTMLImageElement;
      previous.className = 'np-city-previous'; current.after(previous);
      previous.addEventListener('animationend', () => previous.remove(), {once:true,signal:this.life.signal});
    }
    this.scene = index; this.root.dataset.boss = SCENES[index].id;
    this.root.style.setProperty('--np-costumes', 'url("' + SCENES[index].costumes + '")');
    current.src = SCENES[index].background;
    this.find('villain').innerHTML = portrait(SCENES[index].id) + '<span class="np-target-ring"></span>';
    this.find('boss-name').textContent = this.copy[SCENES[index].id];
    this.find('boss-title').textContent = [this.copy.nullTitle,this.copy.vesperaTitle,this.copy.aeonTitle][index];
    this.find('boss-number').textContent = '0' + (index + 1);
  }
  private updateBoss() {
    const battle = this.battle, active = !!battle, index = battle?.boss ?? 0;
    this.setScene(index);
    this.root.dataset.legacy = String(this.legacy);
    this.root.querySelectorAll<HTMLElement>('[data-boss-index]').forEach((chapter,i) => {
      chapter.dataset.state = i < (battle?.defeated ?? (battle?.won ? 1 : 0)) ? 'defeated' : i === index ? 'current' : 'locked';
      chapter.setAttribute('aria-current', String(i === index));
    });
    this.find('boss').dataset.active = String(active || readyTeam(this.team));
    for (const key of ['shield','core'] as const) {
      const max = BOSSES[index][key], value = battle?.[key] ?? max;
      if (this.find(key).childElementCount !== max) this.find(key).innerHTML = '<i></i>'.repeat(max);
      this.find(key + '-label').textContent = value + ' / ' + max;
      this.find(key).querySelectorAll('i').forEach((segment, index) => segment.dataset.destroyed = String(index >= value));
    }
    this.find('boss-hint').textContent = battle?.won ? this.copy.victory : battle?.shield === 0 ? this.copy.empowered : active ? this.copy.bonus : readyTeam(this.team) ? this.copy.teamReady : this.copy.awaiting;
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
      this.draw(initialGrid); this.find('win').textContent = '0';
      this.status(this.copy.collect);
      this.find('win-label').textContent = this.copy.win; this.find('credit').textContent = this.copy.coins;
      this.find('event').classList.remove('np-event-visible');
    }
    const view = this.view, marker = this.session?.id + ':' + view?.revision;
    if (!this.busy && view && this.seen !== marker) {
      this.seen = marker; this.bet = Number(this.session!.stakeUnits) / 100; this.selected = view.team.starter;
      this.draw(view.history.at(-1)!.result.grid);
      this.feedback.setAmount(Number(view.totalPayoutUnits));
      this.find('win-label').textContent = view.battle ? this.copy.total : this.copy.payout;
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
  private async present(frame: Frame, signal: AbortSignal) {
    await this.wait(0,signal);
    if (signal.aborted) return;
    if (frame.kind==='cascade' && !this.reducedMotion) await dissolveNeopolisSymbols(this.find('board'),frame.cells,this.motionOptions(signal));
    if (signal.aborted) return;
    const beforeShield = this.presentationBattle?.shield;
    if (frame.battle !== undefined) this.presentationBattle = structuredClone(frame.battle);
    if (frame.kind === 'boss-arrival') this.setScene(frame.battle?.boss ?? 0, true);
    for (const index of frame.emblems) if (index >= 0 && this.presentationTeam) this.presentationTeam.charges[index] = Math.min(3,this.presentationTeam.charges[index] + 1);
    this.root.dataset.power = frame.hero ?? (frame.kind === 'finisher' ? 'team' : '');
    this.root.dataset.fx = frame.hero ?? frame.kind;
    this.updateBoss(); this.controls();
    const falling = frame.kind === 'cascade' || frame.hero === 'granite';
    this.draw(frame.grid, frame.emblems, falling || frame.kind==='win' ? [] : frame.cells, frame.hero ?? frame.kind);
    const label = frame.hero ? this.power(frame.hero) : frame.kind === 'finisher' ? this.copy.finisher : frame.kind === 'boss-hit' && beforeShield && frame.battle?.shield === 0 ? this.copy.empowered : '';
    const banner = this.find('event'); banner.textContent = label; banner.classList.toggle('np-event-visible', !!label);
    const card = this.find('ability-card'); card.classList.toggle('np-ability-visible', !!frame.hero);
    if (frame.hero) card.innerHTML = portrait(frame.hero) + '<small>' + this.copy[frame.hero] + '</small><strong>' + this.power(frame.hero) + '</strong>';
    const chapter = this.find('chapter'), arrival = frame.kind === 'boss-arrival', defeated = frame.kind === 'boss-defeated';
    chapter.classList.toggle('np-chapter-visible', arrival || defeated);
    if (arrival || defeated) {
      const index = frame.battle?.boss ?? 0;
      chapter.innerHTML = '<small>' + (arrival ? this.copy.newArena : this.copy.bossDefeated) + ' · ' + this.copy.chapter + ' ' + (index + 1) + '/3</small><strong>' + this.copy[BOSSES[index].id] + '</strong><span>' + (arrival ? [this.copy.location0,this.copy.location1,this.copy.location2][index] + ' · ' + this.copy.spinsAward.replace('{n}',String(BOSSES[index].spins)) : this.copy.extra) + '</span>';
    }
    if (frame.kind==='win') {
      const recorded=this.view!.history.at(-1)!;
      const earned=Number(neopolisPointUnits(this.session!.stakeUnits,frame.points,this.view!.version,this.view!.origin));
      const total=this.roundBeforeUnits+Math.min(earned,Number(recorded.payoutUnits));
      await this.feedback.win(frame,this.presentationUnits,total,this.motionOptions(signal),this.winChain++);
      return;
    }
    if (frame.hero) {
      this.status(this.copy[frame.hero] + ' · ' + this.power(frame.hero));
      this.audio.play(frame.hero);
      this.effects.play(frame.hero,frame.cells,frame.hero);
    }
    if (frame.kind === 'finisher' || arrival || defeated || frame.kind === 'boss-hit') {
      this.effects.play(frame.kind === 'boss-hit' && beforeShield && frame.battle?.shield === 0 ? 'shield-break' : frame.kind as 'finisher' | 'boss-arrival' | 'boss-defeated' | 'boss-hit',frame.cells);
      this.audio.play(frame.kind === 'boss-hit' && beforeShield && frame.battle?.shield === 0 ? 'shield-break' : frame.kind as 'finisher' | 'boss-arrival' | 'boss-defeated' | 'boss-hit');
    }
    if (falling && !this.reducedMotion) await dropNeopolisSymbols(this.find('board'), frame.cells, this.motionOptions(signal));
    if (signal.aborted) return;
    await this.wait(arrival ? 1250 : defeated ? 950 : frame.hero || frame.kind === 'finisher' ? 750 : frame.kind === 'boss-hit' ? 400 : frame.kind==='cascade' ? 60 : 110, signal);
  }
  private async spin(automatic = false) {
    if (!this.alive || this.blocked || this.autoRunning && !automatic) return false;
    if (!this.client.pending && this.session?.state !== 'active' && this.balance < this.bet) { this.status(this.copy.lowBalance); return false; }
    let completed = false;
    const owner = this.client.accountId, animation = this.animation;
    this.presentationTeam = structuredClone(this.team);
    this.presentationBattle = this.session?.state === 'active' ? structuredClone(this.view?.battle ?? null) : null;
    this.audio.cancelEffects(); this.feedback.clear(); this.winChain=0;
    this.feedback.setAmount(this.session?.state==='active' ? Number(this.view?.totalPayoutUnits ?? 0) : 0);
    this.busy = true; this.controls(); this.status(this.copy.waiting);
    this.effects.clear(); this.updateBoss();
    this.find('event').classList.remove('np-event-visible');
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
      else await this.client.act({ gameId: NEOPOLIS_GAME, action: 'start', stakeUnits: String(this.bet * 100), settings: { neopolis: { hero: this.selected } } });
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
      this.draw(spin.result.grid); this.find('event').classList.remove('np-event-visible');
      delete this.root.dataset.power; delete this.root.dataset.fx;
      this.find('ability-card').classList.remove('np-ability-visible'); this.find('chapter').classList.remove('np-chapter-visible');
      if (this.session?.state==='settled') await this.feedback.finish(Number(view.totalPayoutUnits),Number(this.session.stakeUnits),this.motionOptions(animation.signal));
      if (animation.signal.aborted) return false;
      this.seen = ''; this.busy = false; this.sync();
      const message = view.capped ? this.copy.cap : spin.result.finisher ? this.copy.finisher + ' · ' + this.copy.extra : spin.result.finished ? (view.battle?.won ? this.copy.victory : this.copy.escaped) + '. ' + this.copy.finished : spin.result.triggered ? this.copy.triggered : spin.result.unlocked.length ? this.copy.unlocked + ': ' + spin.result.unlocked.map(hero => this.copy[hero]).join(', ') : view.battle?.shield === 0 && !spin.result.empowered ? this.copy.empowered : this.copy.settled;
      const round=this.feedback.getState().round;
      const signed=round ? (round.net<0 ? '−' : round.net>0 ? '+' : '')+this.number(Math.abs(round.net)/100) : '';
      const result=round?.tier==='partial' ? this.copy.partialReturn : round?.tier==='even' ? this.copy.evenReturn : round?.tier==='loss' ? this.copy.noPayout : message;
      this.status(result+(round ? ' · '+this.copy.roundNet+': '+signed : ''));
      completed = true;
      if (!this.autoRunning && (spin.result.triggered || spin.result.finished)) this.showNotice(spin.result.triggered ? this.copy.bonus : view.battle?.won ? this.copy.victory : this.copy.escaped, spin.result.triggered ? this.copy.remaining + ': 10. ' + this.copy.rulesBoss : this.copy.total + ': ' + this.number(Number(view.totalPayoutUnits) / 100) + ' ' + this.copy.coins + '. ' + this.copy.finished);
    } catch (error) {
      if (this.alive && owner === this.client.accountId) {
        this.stopAuto();
        this.status(this.client.error || (error instanceof Error ? error.message : this.copy.error));
      }
    } finally {
      reels?.destroy(); if (this.reels === reels) this.reels = undefined;
      if (this.alive && owner === this.client.accountId) {
        this.audio.spinning(false);
        this.busy = false; this.presentationTeam = undefined; delete this.root.dataset.power; delete this.root.dataset.fx;
        this.find('ability-card').classList.remove('np-ability-visible'); this.find('chapter').classList.remove('np-chapter-visible');
        this.effects.clear(); this.sync();
      }
    }
    return completed;
  }
  private showNotice(title: string, message: string) {
    this.find('dialog-body').innerHTML = noticeArt(this.session?.state === 'active',BOSSES[this.battle?.boss ?? 0].id) + '<span class="np-dialog-kicker">ROYAL ORIGINALS / NEOPOLIS</span><h2>' + escape(title) + '</h2><p>' + escape(message) + '</p><button class="np-notice-continue" data-np="notice-continue">' + this.copy.continue + '</button>';
    this.find('notice-continue').addEventListener('click', () => this.dialog.close(), { once: true, signal: this.life.signal });
    this.dialog.showModal(); this.updatePause(); this.controls();
  }
  private showRules() {
    this.stopAuto();
    const c = this.copy;
    this.find('dialog-body').innerHTML = '<span class="np-dialog-kicker">ROYAL ORIGINALS / NEOPOLIS</span><h2>' + c.rules + '</h2>'
      + [c.rulesBase,c.rulesTeam,c.rulesHeroes,this.legacy ? c.rulesLegacy : c.rulesBoss,c.rulesMoney,c.autoHelp].map(text => '<p>' + text + '</p>').join('')
      + '<h3>' + (this.stakeLocked ? c.bonusPayouts : c.payouts) + '</h3><table><thead><tr><th>' + c.symbol + '</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>'
      + neopolisPaytable(this.session?.state === 'active' ? this.view!.version : 4, this.session?.state === 'active' ? this.view!.origin : this.team).map((pays, index) => '<tr><th>' + c[('symbol' + index) as keyof typeof c] + '</th>' + pays.map(pay => '<td>×' + this.number(pay) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    if (!this.dialog.open) this.dialog.showModal(); this.updatePause(); this.controls();
  }
  pause() { this.paused = true; this.updatePause(); this.controls(); }
  resume() { this.paused = false; this.updatePause(); this.controls(); }
  getState() { return { gameId: NEOPOLIS_GAME, language: this.services.i18n.language, ready: !!this.client.accountId, busy: this.busy, autoplay: { running: this.autoRunning, remaining: this.autoRemaining }, selected: this.selected, team: this.team, battle: this.view?.battle ?? null, revision: this.view?.revision ?? 0, stake: this.bet, audio: this.audio.getState(),feedback:this.feedback.getState() }; }
  destroy() {
    if (!this.alive) return;
    this.alive = false; this.stopAuto(); this.animation.abort(); this.life.abort(); this.stopAudio?.();
    this.effects.destroy();
    this.audio.destroy();
    this.feedback.destroy();
    this.client.removeEventListener('change', this.changed); this.wallet.removeEventListener('change', this.changed);
    if (this.dialog.open) this.dialog.close(); this.root.remove();
  }
}
