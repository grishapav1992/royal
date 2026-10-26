import { readGameHost } from '../../src/modules/GameHostContract';
import { FOREST_HEART_GAME, validForestHeartSession, type ForestHeartView } from '../../src/shared/forestHeart';
import { FOREST_HEART_ROTORS, FOREST_HEART_STAKES } from '../../src/shared/forestHeartMath';
import type { ExpansionSession } from '../../src/shared/casinoExpansion';
import type { NewExpansionAction } from '../../src/wallet/ExpansionClient';
import { ForestAudio, type ForestCue } from './ForestAudio';
import { forestCopy } from './copy';
import { forestScene, forestRoundTier, rootPaths } from './presentation';

const petals = () => '<img src="/assets/forest-heart/v1/flower.webp" alt="" draggable="false">';
const crystal = '<svg viewBox="0 0 70 90" aria-hidden="true"><path d="m35 3 27 24-5 39-22 21L9 64 7 27Z"/><path d="M35 3 24 32l11 55 15-54ZM7 27l55 0M9 64l48 2M24 32l26 1" fill="none"/></svg>';

export class ForestHeartUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private wallet = this.services.demoWallet;
  private c = forestCopy(this.services.i18n.language === 'en');
  private doc: Document;
  private root: HTMLElement;
  private dialog: HTMLDialogElement;
  private audio: ForestAudio;
  private controller = new AbortController();
  private motion = new AbortController();
  private owner = this.client.accountId;
  private shown?: ExpansionSession;
  private alive = true;
  private busy = false;
  private paused = false;
  private forceReduced = false;
  private fast = false;
  private stake = 1000;
  private status = '';
  private stopPreferences: () => void;
  private media: MediaQueryList;
  private timing: { cue: string; mode: string; latencyMs: number; skewMs: number }[] = [];
  private presentationCount = 0;
  private change = () => this.sync();
  private visibility = () => { if (this.doc.hidden) this.pause(); else this.resume(); };
  private mediaChange = () => { this.cancel(); this.paint(); };
  constructor(private host: HTMLElement) {
    this.doc = host.ownerDocument;
    this.media = this.doc.defaultView!.matchMedia('(prefers-reduced-motion: reduce)');
    try { this.forceReduced = localStorage.getItem('forest-heart-reduced') === '1'; } catch {}
    const c = this.c;
    host.innerHTML = `<main class="fh" tabindex="0" data-stage="idle">
      <div class="fh-forest" aria-hidden="true"></div><div class="fh-mist" aria-hidden="true"></div>
      <div class="fh-fireflies" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <header class="fh-top"><span class="fh-brand">♛ <b>ROYAL</b><small>${c.collection.split(' · ')[1]}</small></span><div><button data-fh="sound" aria-label="${c.sound}" aria-pressed="false">♪</button><button data-fh="rules" aria-label="${c.rules}">i</button></div></header>
      <div class="fh-world"><section class="fh-machine" aria-labelledby="fh-title"><div class="fh-title"><span>${c.subtitle}</span><h1 id="fh-title">${c.title}</h1><i aria-hidden="true">❦</i></div>
        <div class="fh-network"><aside class="fh-source"><span>${c.source}</span><div>${crystal}</div><strong data-fh="energy">×1</strong><small>${c.energy}</small></aside>
        <div class="fh-board-frame"><div class="fh-board" role="group" aria-label="${c.field}">${Array.from({ length: 25 }, (_, i) => `<button type="button" class="fh-cell" data-cell="${i}" disabled><svg viewBox="0 0 100 100" aria-hidden="true"><path class="fh-root-shadow"/><path class="fh-root-bark"/><path class="fh-root-grain"/><path class="fh-root-light"/></svg><span class="fh-lock" aria-hidden="true">◆</span><span class="fh-turn" aria-hidden="true">↻</span></button>`).join('')}</div><div class="fh-vine fh-vine-top" aria-hidden="true">❧</div><div class="fh-vine fh-vine-bottom" aria-hidden="true">❧</div></div>
        <aside class="fh-flowers">${[0, 1, 2].map(i => `<div class="fh-flower" data-flower="${i}">${petals()}<small>${c.flower} ${i + 1}</small><span></span></div>`).join('')}</aside></div>
        <div class="fh-story"><span class="fh-story-gem" aria-hidden="true">✧</span><p data-fh="status" role="status" aria-live="polite">${c.ready}</p></div>
        <div class="fh-bonus" hidden><span>✧ ${c.bonus}</span><div>${[0, 1, 2, 3].map(i => `<i data-bud="${i}">◆</i>`).join('')}</div><small data-fh="remaining"></small></div>
      </section><aside class="fh-character" aria-hidden="true"><div class="fh-aura"></div><img class="fh-elf fh-elf-idle" src="/assets/forest-heart/v1/elf.webp" alt="" draggable="false"><img class="fh-elf fh-elf-spell" src="/assets/forest-heart/v1/elf-spell.webp" alt="" draggable="false"><div class="fh-character-caption"><span>✧</span>${this.services.i18n.language === 'en' ? 'Keeper of the ancient light' : 'Хранительница древнего света'}</div></aside></div>
      <footer class="fh-controls"><div class="fh-money"><span>${c.balance}</span><strong data-fh="balance">…</strong><small>USDT · ${this.services.i18n.language === 'en' ? 'Virtual' : 'Виртуальные'}</small></div><div class="fh-bet"><span>${c.stake}</span><div><button data-fh="lower" aria-label="${c.lower}">−</button><strong data-fh="stake">10</strong><button data-fh="higher" aria-label="${c.higher}">+</button></div><small>USDT</small></div><div class="fh-total"><span data-fh="total-label">${c.total}</span><strong data-fh="total">0</strong><small data-fh="net">USDT</small></div><div class="fh-action"><button class="fh-spin" data-fh="spin">${c.spin}<span aria-hidden="true">↻</span></button><button class="fh-pass" data-fh="pass" hidden>${c.pass}</button><button class="fh-retry" data-fh="retry" hidden>${c.retry}</button><button class="fh-refresh" data-fh="refresh" hidden>${c.refresh}</button></div><label class="fh-fast"><input data-fh="fast" type="checkbox">${this.services.i18n.language === 'en' ? 'Fast' : 'Быстро'}</label></footer>
      <div class="fh-footnote"><span>5 × 5 · ${c.energy} · ${this.services.i18n.language === 'en' ? 'LIVING ROOTS' : 'ЖИВЫЕ КОРНИ'}</span><span data-fh="credit-note"></span></div>
      <button class="fh-skip" data-fh="skip" hidden>${c.confirm}</button>
      <dialog class="fh-dialog" data-fh="dialog"><button class="fh-dialog-close" data-fh="close" aria-label="${c.close}">×</button><span>${c.info}</span><h2>${c.rules}</h2><p>${c.rulesText}</p><p>${c.energyText}</p><p>${c.rtp}</p><p>${c.recovery}</p><fieldset><legend>${c.sound}</legend><label><input data-fh="music" type="checkbox" checked>${c.music}</label><label><input data-fh="motion" type="checkbox">${c.motion}</label></fieldset><small>ROYAL · ${c.title} · v1</small></dialog>
    </main>`;
    this.root = host.querySelector('.fh')!; this.dialog = this.find<HTMLDialogElement>('dialog');
    this.audio = new ForestAudio(this.services.gameAudio, this.doc);
    const bind = (name: string, callback: () => void) => this.find(name).addEventListener('click', callback, { signal: this.controller.signal });
    bind('spin', () => void this.act()); bind('pass', () => void this.act('forest-pass'));
    bind('retry', () => void this.act('retry')); bind('refresh', () => void this.client.refresh());
    bind('skip', () => this.cancel()); bind('lower', () => this.changeStake(-1)); bind('higher', () => this.changeStake(1));
    bind('sound', () => { this.services.gameAudio.setMuted(!this.services.gameAudio.getPreferences().muted); void this.audio.unlock(); });
    bind('rules', () => { this.pause(); this.dialog.showModal(); }); bind('close', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.resume(), { signal: this.controller.signal });
    this.find<HTMLInputElement>('motion').checked = this.reduced;
    this.find('motion').addEventListener('change', () => {
      this.forceReduced = this.find<HTMLInputElement>('motion').checked;
      try { localStorage.setItem('forest-heart-reduced', this.forceReduced ? '1' : '0'); } catch {}
      this.cancel(); this.paint();
    }, { signal: this.controller.signal });
    this.find('music').addEventListener('change', () => this.audio.setMusic(this.find<HTMLInputElement>('music').checked), { signal: this.controller.signal });
    this.find('fast').addEventListener('change', () => { this.fast = this.find<HTMLInputElement>('fast').checked; }, { signal: this.controller.signal });
    this.root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => {
      button.addEventListener('click', () => { const rotor = FOREST_HEART_ROTORS.indexOf(Number(button.dataset.cell)); if (rotor >= 0) void this.act('forest-turn-' + rotor); }, { signal: this.controller.signal });
      button.addEventListener('keydown', event => {
        const list = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cell]:not(:disabled)')), index = list.indexOf(button);
        const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
        if (direction) { event.preventDefault(); list[(index + direction + list.length) % list.length]?.focus(); }
      }, { signal: this.controller.signal });
    });
    this.doc.addEventListener('visibilitychange', this.visibility);
    this.media.addEventListener('change', this.mediaChange);
    this.client.addEventListener('change', this.change); this.wallet.addEventListener('change', this.change);
    this.stopPreferences = this.services.gameAudio.onPreferences(p => {
      const on = !p.muted && p.volume > 0;
      this.find('sound').setAttribute('aria-pressed', String(on)); this.find('sound').textContent = on ? '♫' : '♪';
      this.find('sound').dataset.muted = String(!on);
    });
    this.paint(); this.sync(); void this.client.refresh();
  }
  private get reduced() { return this.forceReduced || this.media.matches; }
  private get view() { return this.shown?.view.forestHeart; }
  private find<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-fh="${name}"]`)!; }
  private number(units: number) { return (units / 100).toLocaleString(this.services.i18n.locale, { maximumFractionDigits: 2 }); }
  private snapshot() { return this.client.sessions.find(s => s.gameId === FOREST_HEART_GAME); }
  private changeStake(delta: number) {
    if (this.blocked() || this.view?.stage === 'choice' || this.view?.stage === 'bonus') return;
    const index = FOREST_HEART_STAKES.indexOf(this.stake as typeof FOREST_HEART_STAKES[number]);
    this.stake = FOREST_HEART_STAKES[Math.max(0, Math.min(5, index + delta))]; this.controls();
  }
  private blocked() { return this.busy || this.paused || this.doc.hidden || this.client.busy || this.client.loading || !!this.client.pending || this.wallet.busy || !!this.wallet.pending || !this.owner; }
  private sync() {
    if (!this.alive) return;
    if (this.owner !== this.client.accountId) { this.cancel(); this.audio.pause(); this.owner = this.client.accountId; this.shown = undefined; this.status = ''; this.presentationCount = 0; if (!this.paused && !this.doc.hidden) this.audio.resume(); this.paint(); }
    if (!this.busy) {
      const session = this.snapshot();
      if (session && validForestHeartSession(session)) {
        if (session.id !== this.shown?.id || session.view.forestHeart!.revision !== this.view?.revision) {
          this.shown = structuredClone(session); this.status = session.state === 'active' ? this.c.saved : ''; this.paint();
        }
      } else if (session) { this.status = this.c.unavailable; this.shown = undefined; }
    }
    this.controls();
  }
  private paint(lit = true) {
    if (!this.alive) return;
    const scene = forestScene(this.view), stage = this.view?.stage ?? 'idle';
    this.root.dataset.stage = stage; this.root.dataset.reduced = String(this.reduced);
    this.root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => {
      const cell = Number(button.dataset.cell), d = rootPaths(scene.board[cell]);
      button.querySelectorAll('path').forEach(path => path.setAttribute('d', d));
      button.classList.toggle('fh-powered', lit && !!this.view && scene.flow.reachedCells.includes(cell));
      button.classList.toggle('fh-held', scene.lockedCells.includes(cell));
      const rotor = FOREST_HEART_ROTORS.indexOf(cell);
      button.classList.toggle('fh-selectable', stage === 'choice' && rotor >= 0);
      button.setAttribute('aria-label', `${stage === 'choice' && rotor >= 0 ? this.c.turn : this.c.root} ${cell + 1}${scene.lockedCells.includes(cell) ? ', ' + this.c.held : ''}`);
      button.style.setProperty('--order', String(cell % 5 + Math.floor(cell / 5)));
    });
    this.root.querySelectorAll<HTMLElement>('[data-flower]').forEach(flower => {
      const index = Number(flower.dataset.flower), paid = !!(scene.paidMask & (1 << index));
      flower.classList.toggle('fh-bloom', lit && paid); flower.dataset.paid = String(paid);
      flower.querySelector('span')!.textContent = paid && lit ? this.c.paid : '';
    });
    this.find('energy').textContent = '×' + scene.energy;
    this.find('total').textContent = this.number(scene.totalUnits);
    const bonus = this.root.querySelector<HTMLElement>('.fh-bonus')!;
    bonus.hidden = !this.view?.base.bonusAwarded;
    this.root.querySelectorAll<HTMLElement>('[data-bud]').forEach(bud => bud.classList.toggle('fh-bud-used', Number(bud.dataset.bud) < (this.view?.bonus.length ?? 0)));
    this.find('remaining').textContent = this.c.remaining + ': ' + (this.view?.remaining ?? 0);
    const net = this.shown ? Number(this.shown.returnedUnits) - Number(this.shown.spentUnits) : 0;
    this.find('net').textContent = this.shown?.state === 'settled' ? `${this.c.net}: ${net > 0 ? '+' : ''}${this.number(net)} USDT` : 'USDT';
    this.find('total-label').textContent = this.view && stage !== 'settled' ? this.c.pendingTotal : this.c.total;
    this.find('credit-note').textContent = !this.view ? '' : stage === 'settled' ? this.c.credited : this.c.collected;
    this.audio.bonus = stage === 'bonus'; this.controls();
  }
  private controls() {
    const blocked = this.blocked(), stage = this.view?.stage, active = stage === 'choice' || stage === 'bonus';
    if (active && this.shown) this.stake = Number(this.shown.stakeUnits);
    const balance = this.wallet.accountId === this.owner ? this.wallet.wallet?.balance ?? this.client.wallet?.balance : undefined;
    this.find('balance').textContent = balance === undefined ? '…' : balance.toLocaleString(this.services.i18n.locale, { maximumFractionDigits: 2 });
    this.find('stake').textContent = this.number(this.stake);
    this.find<HTMLButtonElement>('lower').disabled = blocked || active || this.stake === FOREST_HEART_STAKES[0];
    this.find<HTMLButtonElement>('higher').disabled = blocked || active || this.stake === FOREST_HEART_STAKES.at(-1);
    const spin = this.find<HTMLButtonElement>('spin'); spin.hidden = stage === 'choice' || !!this.client.pending;
    spin.disabled = blocked || !active && (balance === undefined || balance * 100 < this.stake);
    spin.innerHTML = (stage === 'bonus' ? this.c.free : this.c.spin) + '<span aria-hidden="true">↻</span>';
    const pass = this.find<HTMLButtonElement>('pass'); pass.hidden = stage !== 'choice' || !!this.client.pending; pass.disabled = blocked;
    const retry = this.find<HTMLButtonElement>('retry'); retry.hidden = this.client.pending?.gameId !== FOREST_HEART_GAME; retry.disabled = this.client.busy || this.busy || this.paused;
    this.find('refresh').hidden = !this.client.error || !!this.client.pending;
    this.find<HTMLButtonElement>('refresh').disabled = this.client.busy || this.client.loading || this.busy;
    this.find('skip').hidden = !this.busy || !this.root.classList.contains('fh-presenting');
    this.root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => { button.disabled = blocked || stage !== 'choice' || !FOREST_HEART_ROTORS.includes(Number(button.dataset.cell)); });
    const tier = this.shown?.state === 'settled' ? forestRoundTier(Number(this.shown.returnedUnits), Number(this.shown.spentUnits)) : undefined;
    this.root.dataset.outcome = tier ?? '';
    this.find('status').textContent = this.client.error || this.status || (!this.owner ? this.c.login : this.client.busy ? this.c.waiting : stage === 'choice' ? this.c.choice : stage === 'bonus' ? this.c.bonus : tier ? this.c[tier] : this.c.ready);
  }
  private async act(move?: string) {
    if (!this.alive || this.busy || this.paused) return;
    const retry = move === 'retry';
    if (retry ? this.client.pending?.gameId !== FOREST_HEART_GAME || this.client.busy : this.blocked()) return;
    const owner = this.owner, prior = this.shown ? structuredClone(this.shown) : undefined;
    this.busy = true; this.status = this.c.waiting; this.root.classList.add('fh-awaiting'); this.controls();
    void this.audio.unlock();
    try {
      if (retry) await this.client.retry();
      else {
        const op: NewExpansionAction = this.view && this.view.stage !== 'settled' && this.shown ?
          { gameId: FOREST_HEART_GAME, action: 'move', sessionId: this.shown.id, move: move ?? 'forest-spin', revision: this.view.revision } :
          { gameId: FOREST_HEART_GAME, action: 'start', stakeUnits: String(this.stake), settings: { forestHeart: { mode: 'normal' } } };
        await this.client.act(op);
      }
      if (!this.alive || owner !== this.client.accountId) return;
      const next = this.snapshot();
      if (!next || !validForestHeartSession(next)) throw Error(this.c.unavailable);
      this.shown = structuredClone(next); this.status = '';
      const fresh = prior?.id !== next.id || prior.view.forestHeart!.revision !== next.view.forestHeart!.revision;
      if (fresh && !retry && !this.doc.hidden && !this.paused) await this.present(prior?.view.forestHeart);
    } catch (error) { if (this.alive && owner === this.client.accountId) this.status = (error as Error).message; }
    finally {
      if (this.alive) { this.busy = false; this.root.classList.remove('fh-awaiting', 'fh-presenting', 'fh-revealing', 'fh-casting'); this.paint(); this.sync(); }
    }
  }
  private clock(duration: number, frame: (elapsed: number) => void) {
    const signal = this.motion.signal, win = this.doc.defaultView!;
    return new Promise<void>(resolve => {
      if (signal.aborted || !this.alive) { resolve(); return; }
      let raf = 0, start = performance.now();
      const done = () => { win.cancelAnimationFrame(raf); signal.removeEventListener('abort', done); resolve(); };
      const tick = () => {
        if (signal.aborted || !this.alive || this.paused || this.doc.hidden) { done(); return; }
        const elapsed = performance.now() - start; frame(Math.min(duration, elapsed));
        if (elapsed >= duration) done(); else raf = win.requestAnimationFrame(tick);
      };
      signal.addEventListener('abort', done, { once: true }); tick();
    });
  }
  private async accent(cue: ForestCue, apply: () => void, variant = 0) {
    if (this.motion.signal.aborted || this.paused || this.doc.hidden) return;
    const scheduled = this.audio.accent(cue, variant);
    await this.clock(Math.max(0, scheduled.audibleAt - performance.now()), () => {});
    if (this.motion.signal.aborted || this.paused || this.doc.hidden) return;
    apply(); this.timing.push({ cue, mode: scheduled.mode, latencyMs: scheduled.latencyMs, skewMs: performance.now() - scheduled.audibleAt });
    this.timing = this.timing.slice(-40);
  }
  private async present(previous?: ForestHeartView) {
    this.motion.abort(); this.motion = new AbortController(); const signal = this.motion.signal;
    this.presentationCount++; delete this.root.dataset.celebrate; this.root.classList.add('fh-presenting'); this.root.classList.remove('fh-awaiting');
    const scene = forestScene(this.view), turn = previous?.stage === 'choice';
    this.paint(false); this.root.classList.add(turn ? 'fh-casting' : 'fh-revealing'); this.controls();
    const previousFlowers = turn ? forestScene(previous).paidMask : 0;
    if (turn) for (let i = 0; i < 3; i++) if (previousFlowers & (1 << i)) this.root.querySelector(`[data-flower="${i}"]`)?.classList.add('fh-bloom');
    await this.clock(this.reduced ? 0 : this.fast ? 150 : 320, () => {});
    this.root.classList.remove('fh-revealing'); if (signal.aborted) return;
    await this.accent(turn ? 'turn' : 'land', () => { this.root.classList.add('fh-casting'); });
    if (signal.aborted) return;
    const duration = this.reduced ? 0 : this.fast ? 200 : 420;
    await this.accent('flow', () => { this.root.dataset.pulse = 'true'; });
    await this.clock(duration, elapsed => {
      const count = duration ? Math.ceil(scene.flow.reachedCells.length * elapsed / duration) : scene.flow.reachedCells.length;
      for (const cell of scene.flow.reachedCells.slice(0, count)) this.root.querySelector(`[data-cell="${cell}"]`)?.classList.add('fh-powered');
    });
    if (signal.aborted) return;
    for (let i = 0; i < 3; i++) if ((scene.paidMask & ~previousFlowers) & (1 << i)) {
      await this.accent('flower', () => {
        const flower = this.root.querySelector(`[data-flower="${i}"]`)!; flower.classList.add('fh-bloom');
        flower.querySelector('span')!.textContent = this.c.paid;
      }, i);
      if (signal.aborted) return;
    }
    const stage = this.view?.stage;
    if (stage === 'choice' || stage === 'bonus' && previous?.stage !== 'bonus') await this.accent(stage === 'choice' ? 'choice' : 'bonus', () => {});
    if (!signal.aborted && this.shown?.state === 'settled') {
      const tier = forestRoundTier(Number(this.shown.returnedUnits), Number(this.shown.spentUnits));
      if (tier === 'win' || tier === 'big') await this.accent(tier, () => { this.root.dataset.celebrate = tier; });
    }
    await this.clock(this.reduced ? 0 : 160, () => {}); delete this.root.dataset.pulse;
  }
  private cancel() { this.motion.abort(); this.audio.cancel(); this.root.classList.remove('fh-revealing', 'fh-casting'); delete this.root.dataset.pulse; delete this.root.dataset.celebrate; }
  pause() { this.paused = true; this.cancel(); this.audio.pause(); this.root.dataset.paused = 'true'; this.controls(); }
  resume() { if (!this.alive || this.doc.hidden || this.dialog.open) return; this.paused = false; this.root.dataset.paused = 'false'; this.audio.resume(); this.paint(); }
  getState() {
    return { gameId: FOREST_HEART_GAME, busy: this.busy, paused: this.paused, reduced: this.reduced,
      sessionId: this.shown?.id ?? null, view: this.view ? structuredClone(this.view) : null,
      scene: forestScene(this.view), audio: this.audio.state(), timing: [...this.timing], presentations: this.presentationCount };
  }
  destroy() {
    this.alive = false; this.cancel(); this.audio.destroy(); this.stopPreferences(); this.controller.abort();
    this.doc.removeEventListener('visibilitychange', this.visibility); this.media.removeEventListener('change', this.mediaChange);
    this.client.removeEventListener('change', this.change); this.wallet.removeEventListener('change', this.change); this.host.replaceChildren();
  }
}
