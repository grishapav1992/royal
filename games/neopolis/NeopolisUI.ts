import { readGameHost } from '../../src/modules/GameHostContract';
import { NEOPOLIS_GAME, NEOPOLIS_BETS, type NeopolisView } from '../../src/shared/neopolis';
import { HEROES, initialTeam, readyTeam, PAYTABLE, type Hero, type Team, type Frame } from '../../src/shared/neopolisMath';
import { neopolisCopy } from './copy';
import { noticeArt, portrait, skyline, symbolArt } from './art';

const initialGrid = [0,1,2,3,4, 2,3,4,5,0, 4,5,0,1,2, 1,2,3,4,5];
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);

export class NeopolisUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private wallet = this.services.demoWallet;
  private copy = neopolisCopy(this.services.i18n.language);
  readonly title = this.copy.title;
  private root: HTMLElement;
  private dialog: HTMLDialogElement;
  private life = new AbortController();
  private animation = new AbortController();
  private stopAudio?: () => void;
  private owner = this.client.accountId;
  private seen = '';
  private busy = false;
  private alive = true;
  private paused = false;
  private fast = false;
  private bet = 100;
  private selected: Hero = 'granite';
  private changed = () => this.sync();
  private get session() { return this.client.sessions.find(session => session.gameId === NEOPOLIS_GAME); }
  private get view() { return this.session?.view.neopolis; }
  private get team(): Team { return this.view && !this.view.team.complete ? this.view.team : initialTeam(this.selected); }
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
      + '<header class="np-top"><span class="np-brand">ROYAL <b>ORIGINALS</b><small>NEOPOLIS / CHAPTER 01</small></span><span class="np-prototype">' + c.prototype + '</span><div class="np-tools"><button data-np="sound" aria-label="' + c.sound + '" aria-pressed="false">♪</button><button data-np="rules" aria-label="' + c.rules + '">?</button></div></header>'
      + '<div class="np-title"><span>' + c.subtitle + '</span><h1>' + c.title + '</h1><i></i></div>'
      + '<div class="np-layout"><aside class="np-team"><div class="np-section-label"><span>01</span>' + c.team + '</div><p class="np-team-hint" data-np="team-hint">' + c.choose + '</p>'
      + HEROES.map((hero, index) => '<button class="np-hero" data-hero="' + hero + '" data-active="false" aria-pressed="false"><span class="np-portrait">' + portrait(hero) + '</span><span class="np-hero-copy"><small>0' + (index + 1) + ' / <span data-hero-state></span></small><strong>' + c[hero] + '</strong><b>' + this.power(hero) + '</b><span class="np-hero-detail">' + { granite:c.graniteDetail, impulse:c.impulseDetail, prism:c.prismDetail }[hero] + '</span><span class="np-pips" aria-hidden="true"><i></i><i></i><i></i></span></span></button>').join('')
      + '</aside><section class="np-machine"><div class="np-machine-top"><span data-np="mode">' + c.base + '</span><b>' + c.lines + '</b></div><div class="np-board-shell"><div class="np-board" role="grid" aria-label="' + c.field + '" aria-colcount="5" aria-rowcount="4" data-np="board"></div><div class="np-event" data-np="event" aria-hidden="true"></div></div><div class="np-transmission"><span class="np-live-dot"></span><p role="status" aria-live="polite" data-np="status">' + c.collect + '</p></div><div class="np-spin-meta"><span data-np="remaining">NEOPOLIS / SECTOR 07</span><span data-np="win-note">' + c.coins + '</span></div></section>'
      + '<aside class="np-boss" data-np="boss"><div class="np-section-label"><span>02</span>' + c.threat + '</div><div class="np-villain">' + portrait('null') + '<span class="np-target-ring"></span></div><div class="np-villain-name"><small>CLASSIFIED / 000</small><h2>' + c.null + '</h2></div><div class="np-boss-meters"><label>' + c.shield + '<span data-np="shield-label">3 / 3</span></label><div class="np-segments" data-np="shield"><i></i><i></i><i></i></div><label>' + c.core + '<span data-np="core-label">3 / 3</span></label><div class="np-segments np-core" data-np="core"><i></i><i></i><i></i></div></div><p data-np="boss-hint">' + c.awaiting + '</p></aside></div>'
      + '<footer class="np-controls"><div class="np-value"><span>' + c.balance + '</span><strong data-np="balance">0</strong><small>' + c.coins + '</small></div><label class="np-stake"><span>' + c.bet + '</span><select data-np="bet" aria-label="' + c.bet + '">' + NEOPOLIS_BETS.map(bet => '<option value="' + bet + '"' + (bet === this.bet ? ' selected' : '') + '>' + bet + '</option>').join('') + '</select></label><div class="np-value np-win"><span data-np="win-label">' + c.win + '</span><strong data-np="win">0</strong><small data-np="credit">' + c.coins + '</small></div><button class="np-spin" data-np="spin"><span>' + c.spin + '</span><b aria-hidden="true">↻</b></button><label class="np-fast"><input type="checkbox" data-np="fast">' + c.fast + '</label></footer>'
      + '<p class="np-cycle-lock" data-np="lock"></p><dialog class="np-dialog" data-np="dialog"><button data-np="close" class="np-close" aria-label="' + c.close + '">×</button><div data-np="dialog-body"></div></dialog>';
    host.replaceChildren(this.root); this.dialog = this.find<HTMLDialogElement>('dialog');
    this.draw(initialGrid);
    const options = { signal: this.life.signal };
    this.find('spin').addEventListener('click', () => { void this.spin(); }, options);
    this.find<HTMLSelectElement>('bet').addEventListener('change', event => { if (!this.collectionLocked && !this.busy) this.bet = Number((event.target as HTMLSelectElement).value); this.controls(); }, options);
    this.find<HTMLInputElement>('fast').addEventListener('change', event => { this.fast = (event.target as HTMLInputElement).checked; }, options);
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(button => button.addEventListener('click', () => {
      if (this.collectionLocked || this.busy || this.client.pending) return;
      this.selected = button.dataset.hero as Hero; this.updateTeam();
    }, options));
    this.find('rules').addEventListener('click', () => this.showRules(), options);
    this.find('close').addEventListener('click', () => this.dialog.close(), options);
    this.dialog.addEventListener('close', () => this.controls(), options);
    this.find('sound').addEventListener('click', () => {
      void this.services.gameAudio.unlock();
      this.services.gameAudio.setMuted(!this.services.gameAudio.getPreferences().muted);
    }, options);
    this.stopAudio = this.services.gameAudio.onPreferences(preferences => {
      this.find('sound').setAttribute('aria-pressed', String(!preferences.muted));
      this.find('sound').textContent = preferences.muted ? '♫' : '♪';
    });
    this.client.addEventListener('change', this.changed); this.wallet.addEventListener('change', this.changed);
    this.sync(); void this.client.refresh();
  }

  private draw(grid: number[], emblems: number[] = [], cells: number[] = [], event = '') {
    this.find('board').innerHTML = Array.from({ length: 4 }, (_, row) => '<div role="row" class="np-row">' + grid.slice(row * 5, row * 5 + 5).map((symbol, col) => {
      const index = row * 5 + col, emblem = emblems[index];
      const label = this.copy[('symbol' + symbol) as keyof typeof this.copy] + (emblem >= 0 ? ' · ' + this.copy[HEROES[emblem]] : '');
      return '<div role="gridcell" class="np-cell' + (cells.includes(index) ? ' np-hit' : '') + '" data-symbol="' + symbol + '" data-effect="' + event + '" aria-label="' + label + '">' + symbolArt(symbol) + (emblem >= 0 ? '<span class="np-emblem" data-emblem="' + HEROES[emblem] + '">' + ['◆','ϟ','◈'][emblem] + '</span>' : '') + '</div>';
    }).join('') + '</div>').join('');
  }
  private status(text: string) { this.find('status').textContent = text; }
  private updateTeam() {
    const team = this.team;
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((button, index) => {
      const active = team.charges[index] === 3, hero = HEROES[index];
      button.dataset.active = String(active); button.disabled = this.collectionLocked || this.busy || !!this.client.pending;
      button.setAttribute('aria-pressed', String(team.starter === hero));
      button.setAttribute('aria-label', this.copy[hero] + ' · ' + this.power(hero) + ' · ' + team.charges[index] + '/3');
      button.querySelector('[data-hero-state]')!.textContent = team.starter === hero ? this.copy.starter : active ? this.copy.active : this.copy.locked + ' ' + team.charges[index] + '/3';
      button.querySelectorAll('.np-pips i').forEach((pip, i) => (pip as HTMLElement).dataset.filled = String(i < team.charges[index]));
    });
    this.find('team-hint').textContent = this.collectionLocked ? this.copy.collect : this.copy.choose;
  }
  private controls() {
    if (!this.alive) return;
    const view = this.view, free = this.session?.state === 'active', pending = this.client.pending;
    const blocked = this.busy || this.paused || this.dialog.open || !this.client.accountId || this.client.accountId !== this.wallet.accountId || this.client.busy || this.client.loading || this.wallet.busy || !!this.wallet.pending || this.wallet.hasExternalBusy('expansion') || (!!pending && pending.gameId !== NEOPOLIS_GAME);
    this.find<HTMLButtonElement>('spin').disabled = blocked;
    this.find('spin').querySelector('span')!.textContent = this.busy ? this.copy.waiting : pending?.gameId === NEOPOLIS_GAME ? this.copy.retry : free ? this.copy.freeSpin : this.copy.spin;
    this.find<HTMLSelectElement>('bet').disabled = blocked || this.collectionLocked || !!pending;
    this.find<HTMLSelectElement>('bet').value = String(this.bet);
    this.find('balance').textContent = this.number(this.balance);
    this.find('lock').textContent = this.collectionLocked ? this.copy.cycleLock : '';
    this.find('mode').textContent = free ? this.copy.bonus : this.copy.base;
    this.find('remaining').textContent = free ? this.copy.remaining + ': ' + view!.battle!.remaining : 'NEOPOLIS / SECTOR 07';
    this.root.dataset.battle = String(free);
    this.updateTeam();
  }
  private updateBoss(view?: NeopolisView) {
    const battle = view?.battle, active = !!battle;
    this.find('boss').dataset.active = String(active || readyTeam(this.team));
    for (const key of ['shield','core'] as const) {
      const value = battle?.[key] ?? 3;
      this.find(key + '-label').textContent = value + ' / 3';
      this.find(key).querySelectorAll('i').forEach((segment, index) => segment.dataset.destroyed = String(index >= value));
    }
    this.find('boss-hint').textContent = battle?.won ? this.copy.victory : battle?.shield === 0 ? this.copy.empowered : active ? this.copy.bonus : readyTeam(this.team) ? this.copy.teamReady : this.copy.awaiting;
  }
  private sync() {
    if (!this.alive) return;
    if (this.owner !== this.client.accountId) {
      this.owner = this.client.accountId; this.animation.abort(); this.animation = new AbortController();
      this.busy = false; this.seen = ''; this.selected = 'granite'; this.bet = 100; delete this.root.dataset.power;
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
      this.find('win').textContent = this.number(Number(view.totalPayoutUnits) / 100);
      this.find('win-label').textContent = view.battle ? this.copy.total : this.copy.win;
      this.find('credit').textContent = this.session!.state === 'active' ? this.copy.held : this.copy.credited;
      this.status(view.capped ? this.copy.cap : this.session!.state === 'active' ? this.copy.saved : this.copy.settled);
    }
    if (!this.client.accountId) this.status(this.copy.signin);
    else if (this.client.pending && !this.busy) this.status(this.client.pending.gameId === NEOPOLIS_GAME ? this.copy.error : this.copy.otherPending);
    this.updateBoss(view); this.controls();
    this.services.reactions.observeExpansionOutcome(this.root, NEOPOLIS_GAME, this.session, this.client.accountId, this.busy, !!this.client.pending);
  }
  private async wait(ms: number, signal: AbortSignal) {
    const reduced = this.host.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = (duration: number) => new Promise<void>(resolve => {
      if (signal.aborted) { resolve(); return; }
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, duration); signal.addEventListener('abort', finish, { once: true });
    });
    await delay(reduced ? 0 : this.fast ? ms / 4 : ms);
    while ((this.paused || this.dialog.open || this.host.ownerDocument.hidden) && !signal.aborted) await delay(100);
  }
  private async present(frame: Frame, signal: AbortSignal) {
    if (signal.aborted) return;
    this.root.dataset.power = frame.hero ?? (frame.kind === 'finisher' ? 'team' : '');
    this.draw(frame.grid, frame.emblems, frame.cells, frame.hero ?? frame.kind);
    const label = frame.hero ? this.power(frame.hero) : frame.kind === 'win' ? this.copy.cascade : frame.kind === 'finisher' ? this.copy.finisher : '';
    const banner = this.find('event'); banner.textContent = label; banner.classList.toggle('np-event-visible', !!label);
    if (frame.hero) {
      this.status(this.copy[frame.hero] + ' · ' + this.power(frame.hero));
      this.services.gameAudio.effect(frame.hero === 'granite' ? 'explosion' : 'laser', .35);
    } else if (frame.kind === 'win') this.services.gameAudio.effect('coin', .3);
    await this.wait(frame.hero || frame.kind === 'finisher' ? 750 : frame.kind === 'win' ? 480 : 200, signal);
  }
  private async spin() {
    if (!this.alive || this.busy || this.find<HTMLButtonElement>('spin').disabled) return;
    if (!this.client.pending && this.session?.state !== 'active' && this.balance < this.bet) { this.status(this.copy.lowBalance); return; }
    const owner = this.client.accountId, animation = this.animation;
    this.busy = true; this.controls(); this.status(this.copy.waiting);
    try {
      void this.services.gameAudio.unlock();
      const before = this.session;
      if (this.client.pending) await this.client.retry();
      else if (before?.state === 'active') await this.client.act({ gameId: NEOPOLIS_GAME, action: 'move', sessionId: before.id, move: 'neopolis-spin', revision: before.view.neopolis!.revision });
      else await this.client.act({ gameId: NEOPOLIS_GAME, action: 'start', stakeUnits: String(this.bet * 100), settings: { neopolis: { hero: this.selected } } });
      if (!this.alive || owner !== this.client.accountId || animation.signal.aborted) return;
      const view = this.view;
      if (!view) throw Error(this.copy.error);
      const spin = view.history.at(-1)!;
      this.status(this.copy.spinning);
      for (const frame of spin.result.frames) {
        if (!this.alive || animation.signal.aborted) return;
        await this.present(frame, animation.signal);
      }
      if (animation.signal.aborted) return;
      this.draw(spin.result.grid); this.find('event').classList.remove('np-event-visible');
      delete this.root.dataset.power;
      this.seen = ''; this.busy = false; this.sync();
      const message = view.capped ? this.copy.cap : spin.result.finisher ? this.copy.finisher + ' · ' + this.copy.extra : spin.result.finished ? (view.battle?.won ? this.copy.victory : this.copy.escaped) + '. ' + this.copy.finished : spin.result.triggered ? this.copy.triggered : spin.result.unlocked.length ? this.copy.unlocked + ': ' + spin.result.unlocked.map(hero => this.copy[hero]).join(', ') : view.battle?.shield === 0 && !spin.result.empowered ? this.copy.empowered : this.copy.settled;
      this.status(message);
      if (spin.result.triggered || spin.result.finished) this.showNotice(spin.result.triggered ? this.copy.bonus : view.battle?.won ? this.copy.victory : this.copy.escaped, spin.result.triggered ? this.copy.remaining + ': 10. ' + this.copy.rulesBoss : this.copy.total + ': ' + this.number(Number(view.totalPayoutUnits) / 100) + ' ' + this.copy.coins + '. ' + this.copy.finished);
    } catch (error) {
      if (this.alive && owner === this.client.accountId) this.status(this.client.error || (error instanceof Error ? error.message : this.copy.error));
    } finally {
      if (this.alive && owner === this.client.accountId) { this.busy = false; delete this.root.dataset.power; this.sync(); }
    }
  }
  private showNotice(title: string, message: string) {
    this.find('dialog-body').innerHTML = noticeArt(this.session?.state === 'active') + '<span class="np-dialog-kicker">ROYAL ORIGINALS / NEOPOLIS</span><h2>' + escape(title) + '</h2><p>' + escape(message) + '</p><button class="np-notice-continue" data-np="notice-continue">' + this.copy.continue + '</button>';
    this.find('notice-continue').addEventListener('click', () => this.dialog.close(), { once: true, signal: this.life.signal });
    this.dialog.showModal(); this.controls();
  }
  private showRules() {
    const c = this.copy;
    this.find('dialog-body').innerHTML = '<span class="np-dialog-kicker">ROYAL ORIGINALS / NEOPOLIS</span><h2>' + c.rules + '</h2>'
      + [c.rulesBase,c.rulesTeam,c.rulesHeroes,c.rulesBoss,c.rulesMoney].map(text => '<p>' + text + '</p>').join('')
      + '<h3>' + c.payouts + '</h3><table><thead><tr><th>' + c.symbol + '</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>'
      + PAYTABLE.map((pays, index) => '<tr><th>' + c[('symbol' + index) as keyof typeof c] + '</th>' + pays.map(pay => '<td>×' + pay + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    if (!this.dialog.open) this.dialog.showModal(); this.controls();
  }
  pause() { this.paused = true; this.controls(); }
  resume() { this.paused = false; this.controls(); }
  getState() { return { gameId: NEOPOLIS_GAME, language: this.services.i18n.language, ready: !!this.client.accountId, busy: this.busy, selected: this.selected, team: this.team, battle: this.view?.battle ?? null, revision: this.view?.revision ?? 0, stake: this.bet }; }
  destroy() {
    if (!this.alive) return;
    this.alive = false; this.animation.abort(); this.life.abort(); this.stopAudio?.();
    this.client.removeEventListener('change', this.changed); this.wallet.removeEventListener('change', this.changed);
    if (this.dialog.open) this.dialog.close(); this.root.remove();
  }
}
