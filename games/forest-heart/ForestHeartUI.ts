import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {stakeRulesHtml} from '../../src/ui/stakeRules';
import {syncStakeSelect, validStakeDraft} from '../../src/ui/stakeSelection';
import {ROYAL_GAME_STAKE_CENTS as FOREST_HEART_STAKES, validGameStake} from '../../src/shared/gameStakes';
import { readGameHost } from '../../src/modules/GameHostContract';
import { FOREST_HEART_GAME, validForestHeartSession, type ForestHeartView } from '../../src/shared/forestHeart';
import { FOREST_HEART_ROTORS, forestHeartFlowerPayout } from '../../src/shared/forestHeartMath';
import type { ExpansionSession } from '../../src/shared/casinoExpansion';
import type { NewExpansionAction } from '../../src/wallet/ExpansionClient';
import { ForestAudio, type ForestCue } from './ForestAudio';
import { FOREST_AUTO_COUNTS, ForestAutoplay } from './autoplay';
import { forestCopy } from './copy';
import { forestScene, forestRoundTier } from './presentation';
import { rootArtwork, easeRoot } from './RootArtwork';
import { ForestLayout } from './ForestLayout';
import { ForestCharacter } from './ForestCharacter';
import { ForestScene } from './ForestScene';

const crystal = '/assets/forest-heart/v2/crystal.webp', fan = [-58, -38, -19, 0, 19, 38, 58];
const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const icons = {
  sound: icon('<path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'), muted: icon('<path d="M4 9v6h4l5 4V5L8 9zM17 9.5l5 5M22 9.5l-5 5"/>'),
  rules: icon('<path d="M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 2.2M12 17.6v.1"/>'), auto: icon('<path d="M20 12a8 8 0 1 1-2.6-5.9M20 3v4.5h-4.5"/>'), fast: icon('<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>'),
  settings: icon('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'), close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
};
const fill = (text: string, ...values: (string | number)[]) => text.replace(/\{(\d)\}/g, (_, i) => String(values[Number(i)]));

export class ForestHeartUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private wallet = this.services.demoWallet;
  private c = forestCopy(this.services.i18n.language === 'en');
  private doc: Document;
  private root: HTMLElement;
  private dialog: HTMLDialogElement;
  private autoDialog: HTMLDialogElement;
  private resultDialog: HTMLDialogElement;
  private audio: ForestAudio;
  private layout: ForestLayout;
  private character: ForestCharacter;
  private scene: ForestScene;
  private controller = new AbortController();
  private motion = new AbortController();
  private owner = this.client.accountId;
  private shown?: ExpansionSession;
  private alive = true;
  private busy = false;
  private presenting = false;
  private paused = false;
  private forceReduced = false;
  private fast = false;
  private stake: number = 10;
  private status = '';
  private hint = '';
  /** Kept while the light travels, so the wallet line never reveals a result early. */
  private heldBalance?: number;
  private mode: 'base' | 'bonus' = 'base';
  private remaining = 0;
  private energy = 1;
  private valueStake = 10;
  private shownTotal = 0;
  private autoplay: ForestAutoplay;
  private autoCount: number = FOREST_AUTO_COUNTS[0];
  private autoAccepted = 0;
  private waiters: { test: () => boolean; done: () => void }[] = [];
  private closeResult?: (confirmed: boolean) => void;
  private flying = new Set<HTMLElement>();
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
    const c = this.c, en = this.services.i18n.language === 'en';
    host.innerHTML = `<main class="fh" tabindex="0" data-stage="idle" data-mode="base" data-lang="${en ? 'en' : 'ru'}">
      <div class="fh-forest" aria-hidden="true"></div><div class="fh-shade" aria-hidden="true"></div><div class="fh-dawn" aria-hidden="true"></div><div class="fh-mist" aria-hidden="true"></div>
      <canvas data-layer="backdrop" aria-hidden="true"></canvas><div class="fh-glow" aria-hidden="true"></div>
      <aside class="fh-character" aria-hidden="true"><div class="fh-character-energy"><i></i><i></i><i></i><i></i></div></aside>
      <canvas data-layer="frame" aria-hidden="true"></canvas><canvas data-layer="field" aria-hidden="true"></canvas><canvas data-layer="bloom" aria-hidden="true"></canvas>
      <div class="fh-board" role="group" aria-label="${c.field}">${Array.from({ length: 25 }, (_, i) => `<button type="button" class="fh-cell" data-cell="${i}" disabled></button>`).join('')}</div>
      <aside class="fh-source" aria-hidden="true"><div class="fh-halo"></div><img src="${crystal}" alt="" draggable="false"><img class="fh-gem" src="${crystal}" alt="" draggable="false"></aside>
      <button type="button" class="fh-energy" data-fh="energy" popovertarget="fh-energy-note" aria-label="${c.energy}"><b>×1</b><small>${c.energy}</small></button>
      <div class="fh-flowers">${[0, 1, 2].map(i => `<div class="fh-flower" role="img" data-flower="${i}"><div class="fh-fan" aria-hidden="true">${fan.map(angle => `<i data-angle="${angle}"></i>`).join('')}</div><img class="fh-open" src="/assets/forest-heart/v1/flower.webp" alt="" draggable="false"><img class="fh-bud" src="/assets/forest-heart/v5/bud.webp" alt="" draggable="false"><strong class="fh-flower-value"></strong></div>`).join('')}</div>
      <div class="fh-title"><h1 id="fh-title" class="${en ? '' : 'fh-sr'}">${c.title}</h1>${en ? '' : '<img class="fh-title-logo" src="/assets/forest-heart/v2/title.webp" alt="" draggable="false">'}</div>
      <div class="fh-bonus" role="img">${[0, 1, 2, 3].map(i => `<i data-bud="${i}"></i>`).join('')}</div>
      <section class="fh-plate" aria-label="${c.total}"><div class="fh-story"><p data-fh="status" role="status" aria-live="polite">${c.ready}</p><p data-fh="next">${c.nextIdle}</p></div>
        <div class="fh-total"><span data-fh="total-label">${c.total}</span><strong data-fh="total"></strong></div>
        <div class="fh-net"><span data-fh="net-label">${c.net}</span><strong data-fh="net"></strong></div><div class="fh-left" hidden><span>${c.freeLeft}</span><strong data-fh="remaining"></strong></div></section>
      <footer class="fh-controls"><div class="fh-bet"><span data-fh="stake-label">${c.stake}</span><div class="fh-bet-row"><button type="button" data-fh="lower" aria-label="${c.lower}">−</button><select data-fh="stake-select" aria-label="${c.stake}">${FOREST_HEART_STAKES.map(value => `<option value="${value}">${this.number(value)}</option>`).join('')}</select><button type="button" data-fh="higher" aria-label="${c.higher}">+</button></div></div>
        <div class="fh-money"><span>${c.balance}</span><strong data-fh="balance">…</strong><small>USDT</small></div>
        <button type="button" class="fh-round fh-auto" data-fh="auto" aria-haspopup="dialog">${icons.auto}<span data-fh="auto-label">${c.auto}</span></button>
        <div class="fh-primary"><button type="button" class="fh-spin" data-fh="spin"></button><button type="button" class="fh-pass" data-fh="pass" hidden><span class="fh-button-label">${c.pass}</span><small>${c.passNote}</small></button><button type="button" class="fh-skip" data-fh="skip" hidden><span class="fh-button-label">${c.confirm}</span><small>${c.skipNote}</small></button><button type="button" class="fh-retry" data-fh="retry" hidden><span class="fh-button-label">${c.retry}</span></button><button type="button" class="fh-refresh" data-fh="refresh" hidden><span class="fh-button-label">${c.refresh}</span></button>
          <img class="fh-jewel" src="/assets/forest-heart/v5/gem-top.webp" alt="" draggable="false"><img class="fh-jewel fh-jewel-low" src="/assets/forest-heart/v5/gem-bottom.webp" alt="" draggable="false"></div>
        <label class="fh-round fh-fast"><input data-fh="fast" type="checkbox">${icons.fast}<span>${c.fast}</span></label></footer>
      <nav class="fh-tools"><button type="button" data-fh="sound" aria-label="${c.sound}" aria-pressed="false">${icons.sound}</button><button type="button" data-fh="rules" aria-label="${c.rules}">${icons.rules}</button><button type="button" data-fh="settings" aria-label="${c.settings}">${icons.settings}</button></nav>
      <div class="fh-banner" aria-hidden="true"></div><canvas data-layer="front" aria-hidden="true"></canvas>
      <div id="fh-energy-note" class="fh-energy-note" popover><h2>${c.energy}</h2><p>${c.energyHelp}</p><p data-fh="flower-value-note"></p><button type="button" popovertarget="fh-energy-note" popovertargetaction="hide">${c.close}</button></div>
      <dialog class="fh-dialog" data-fh="dialog" aria-labelledby="fh-dialog-title"><header><h2 id="fh-dialog-title" data-fh="dialog-title">${c.how}</h2><button type="button" class="fh-dialog-close" data-fh="close" aria-label="${c.close}">${icons.close}</button></header>
      <section data-panel="rules"><ul class="fh-steps">${c.steps.map(([name, text]) => `<li><b>${name}</b><span>${text}</span></li>`).join('')}</ul>
      <details class="fh-full-rules"><summary>${c.fullRules}</summary><p>${c.rulesText}</p><p>${c.energyText}</p><p>${c.rtp}</p><p>${c.recovery}</p>${stakeRulesHtml(en)}</details></section>
      <section data-panel="settings" hidden><label><span>${c.music}</span><input data-fh="music" type="checkbox" checked></label><label><span>${c.motion}</span><input data-fh="motion" type="checkbox"></label></section></dialog>
      <dialog class="fh-window" data-fh="auto-dialog" aria-labelledby="fh-auto-title"><header><h2 id="fh-auto-title">${c.autoTitle}</h2><button type="button" class="fh-dialog-close" data-fh="close-autoplay" aria-label="${c.close}">${icons.close}</button></header><p data-fh="auto-text"></p>
        <div class="fh-counts" role="radiogroup" aria-label="${c.autoCount}">${FOREST_AUTO_COUNTS.map(count => `<button type="button" role="radio" data-auto-count="${count}" aria-checked="${count === this.autoCount}" tabindex="${count === this.autoCount ? 0 : -1}">${count}</button>`).join('')}</div><button type="button" class="fh-confirm" data-fh="auto-start"></button></dialog>
      <dialog class="fh-window fh-result" data-fh="result-dialog" aria-labelledby="fh-result-title"><header><h2 id="fh-result-title">${c.resultTitle}</h2><button type="button" class="fh-dialog-close" data-fh="close-result" aria-label="${c.close}">${icons.close}</button></header><p>${c.resultNote}</p><strong data-fh="result-sum"></strong><p data-fh="result-note"></p><button type="button" class="fh-confirm" data-fh="result-confirm"></button></dialog>
    </main>`;
    this.root = host.querySelector('.fh')!; this.dialog = this.find<HTMLDialogElement>('dialog'); this.autoDialog = this.find<HTMLDialogElement>('auto-dialog'); this.resultDialog = this.find<HTMLDialogElement>('result-dialog');
    this.audio = new ForestAudio(this.services.gameAudio, this.doc);
    this.character = new ForestCharacter(this.root.querySelector('.fh-character')!);
    this.scene = new ForestScene(this.root);
    this.layout = new ForestLayout(this.root, geometry => this.scene.resize(geometry));
    this.autoplay = new ForestAutoplay(() => this.autoRound(), () => this.controls());
    for (const event of ['pointerdown','keydown']) this.root.addEventListener(event,()=>void this.audio.unlock(),{signal:this.controller.signal});
    const bind = (name: string, callback: () => void) => this.find(name).addEventListener('click', callback, { signal: this.controller.signal });
    bind('spin', () => void this.act()); bind('pass', () => void this.act('forest-pass'));
    bind('retry', () => void this.act('retry')); bind('refresh', () => void this.client.refresh());
    this.find('stake-select').addEventListener('change',()=>{
      const value=this.find<HTMLSelectElement>('stake-select').value;
      if(!this.blocked()&&!this.autoplay.state.active&&this.snapshot()?.state!=='active'&&validGameStake(value)){this.stake=Number(value);this.controls();}
    },{signal:this.controller.signal});
    bind('skip', () => this.cancel()); bind('lower', () => this.changeStake(-1)); bind('higher', () => this.changeStake(1));
    bind('sound', () => { this.services.gameAudio.setMuted(!this.services.gameAudio.getPreferences().muted); void this.audio.unlock(); });
    bind('rules', () => this.openPanel('rules')); bind('settings', () => this.openPanel('settings')); bind('close', () => this.dialog.close());
    bind('auto', () => { if (this.autoplay.state.active) this.autoplay.stop(); else this.openAutoplay(); });
    bind('auto-start', () => this.startAutoplay()); bind('close-autoplay', () => this.autoDialog.close());
    bind('result-confirm', () => this.resultDialog.close('confirm')); bind('close-result', () => this.resultDialog.close(''));
    this.resultDialog.addEventListener('close', () => { const confirmed = this.resultDialog.returnValue === 'confirm'; this.resultDialog.returnValue = ''; this.character.release(); this.scene.effects.rays = 0; const done = this.closeResult; this.closeResult = undefined; if (!confirmed) this.autoplay.stop(); done?.(confirmed); if (this.alive) { this.controls(); this.find('spin').focus({ preventScroll: true }); } }, { signal: this.controller.signal });
    this.autoDialog.addEventListener('close', () => { if (this.alive) this.find('auto').focus({ preventScroll: true }); }, { signal: this.controller.signal });
    const counts = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-auto-count]'));
    const choose = (button: HTMLButtonElement) => { this.autoCount = Number(button.dataset.autoCount); for (const item of counts) { item.setAttribute('aria-checked', String(item === button)); item.tabIndex = item === button ? 0 : -1; } this.autoTexts(); };
    counts.forEach((button, index) => {
      button.addEventListener('click', () => choose(button), { signal: this.controller.signal });
      button.addEventListener('keydown', event => { const step = ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 0; if (!step) return; event.preventDefault(); const next = counts[(index + step + counts.length) % counts.length]; choose(next); next.focus(); }, { signal: this.controller.signal });
    });
    this.dialog.addEventListener('close', () => {this.resume();this.find(this.panel).focus({preventScroll:true});}, { signal: this.controller.signal });
    this.find<HTMLInputElement>('motion').checked = this.reduced;
    this.find('motion').addEventListener('change', () => {
      this.forceReduced = this.find<HTMLInputElement>('motion').checked;
      try { localStorage.setItem('forest-heart-reduced', this.forceReduced ? '1' : '0'); } catch {}
      this.cancel(); this.paint();
    }, { signal: this.controller.signal });
    this.find('music').addEventListener('change', () => this.audio.setMusic(this.find<HTMLInputElement>('music').checked), { signal: this.controller.signal });
    this.find('fast').addEventListener('change', () => { this.fast = this.find<HTMLInputElement>('fast').checked; }, { signal: this.controller.signal });
    this.root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => {
      const cell = Number(button.dataset.cell), hover = (value: boolean) => {
        const on = value && !button.disabled && this.view?.stage === 'choice'; this.scene.field.hover(cell, on);
        if (on) { this.character.react('pulse', 520); this.scene.effects.stream('point', () => this.anchor('hand'), () => this.cellPoint(cell), '#ffe39a', 60, 16); } else this.scene.effects.stopStream('point');
        this.scene.wake();
      };
      for (const [event, value] of [['pointerenter', true], ['focus', true], ['pointerleave', false], ['blur', false]] as const) button.addEventListener(event, () => hover(value), { signal: this.controller.signal });
      button.addEventListener('click', () => { const rotor = FOREST_HEART_ROTORS.indexOf(cell); if (rotor >= 0) void this.act('forest-turn-' + rotor); }, { signal: this.controller.signal });
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
      const on = !p.muted && p.volume > 0, button = this.find('sound');
      button.setAttribute('aria-pressed', String(on)); button.innerHTML = on ? icons.sound : icons.muted; button.dataset.muted = String(!on);
    });
    this.paint(); this.sync(); void this.client.refresh();
  }
  private panel: 'rules' | 'settings' = 'rules';
  private openPanel(panel: 'rules' | 'settings') {
    this.pause(); this.panel = panel;
    this.root.querySelectorAll<HTMLElement>('[data-panel]').forEach(section => { section.hidden = section.dataset.panel !== panel; });
    this.find('dialog-title').textContent = panel === 'rules' ? this.c.how : this.c.settings;
    if (!this.dialog.open) this.dialog.showModal();
  }
  private get reduced() { return this.forceReduced || this.media.matches; }
  private get view() { return this.shown?.view.forestHeart; }
  private find<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-fh="${name}"]`)!; }
  private number(units: number) { return (units / 100).toLocaleString(this.services.i18n.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  private snapshot() { return this.client.sessions.find(s => s.gameId === FOREST_HEART_GAME); }
  private get balance() { return this.wallet.accountId === this.owner ? this.wallet.wallet?.balance ?? this.client.wallet?.balance : undefined; }
  private changeStake(delta: number) {
    if (this.blocked() || this.autoplay.state.active || this.view?.stage === 'choice' || this.view?.stage === 'bonus') return;
    const next=delta>0?FOREST_HEART_STAKES.find(value=>value>this.stake):[...FOREST_HEART_STAKES].reverse().find(value=>value<this.stake);
    if(next!==undefined)this.stake=next;this.controls();
  }
  private blocked() { return this.busy || this.paused || this.doc.hidden || this.client.busy || this.client.loading || !!this.client.pending || this.wallet.busy || !!this.wallet.pending || !this.owner; }
  private sync() {
    if (!this.alive) return;
    if (this.owner !== this.client.accountId) {
      this.autoplay.stop(); this.heldBalance = undefined; for (const dialog of [this.autoDialog, this.resultDialog]) if (dialog.open) dialog.close();
      this.cancel(); this.audio.pause(); this.owner = this.client.accountId; this.shown = undefined; this.status = this.hint = ''; this.presentationCount = 0; if (!this.paused && !this.doc.hidden) this.audio.resume(); this.paint();
    }
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
  /** Shows the confirmed view at rest. Reopening and recovery use only this path. */
  private paint() {
    if (!this.alive) return;
    const scene = forestScene(this.view), stage = this.view?.stage ?? 'idle', field = this.scene.field, effects = this.scene.effects;
    this.character.mode(this.paused || this.doc.hidden, this.reduced);
    this.character.rest(stage === 'choice' || stage === 'bonus' ? stage : 'idle');
    this.scene.mode(this.paused || this.doc.hidden, this.reduced);
    this.root.dataset.stage = stage; this.root.dataset.reduced = String(this.reduced);
    this.setMode(stage === 'bonus' ? 'bonus' : 'base', this.view?.remaining ?? 0);
    this.valueStake = this.shown ? Number(this.shown.stakeUnits) : this.stake;
    field.show(scene.board); field.setHeld(scene.lockedCells); field.setChoice(stage === 'choice'); this.setEnergy(scene.energy); effects.clearBeams();
    if (this.view) { field.startLight(0, true); effects.beam(-1, this.scene.color).progress = 1; for (let i = 0; i < 3; i++) if (scene.flow.receiverMask & (1 << i)) effects.beam(i, this.scene.color).progress = 1; }
    else { field.clearLight(); field.unlight(); }
    this.root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => {
      const cell = Number(button.dataset.cell), rotor = FOREST_HEART_ROTORS.indexOf(cell);
      button.dataset.mask = String(scene.board[cell]); button.dataset.art = String(rootArtwork(scene.board[cell]).column);
      button.classList.toggle('fh-held', scene.lockedCells.includes(cell)); button.classList.toggle('fh-selectable', stage === 'choice' && rotor >= 0);
      button.setAttribute('aria-label', `${stage === 'choice' && rotor >= 0 ? this.c.turn : this.c.root} ${cell + 1}${scene.lockedCells.includes(cell) ? ', ' + this.c.held : ''}`);
    });
    for (let i = 0; i < 3; i++) this.bloom(i, !!(scene.paidMask & (1 << i)), false);
    this.setTotal(this.shown?.state === 'settled' ? Number(this.shown.returnedUnits) : scene.totalUnits);
    this.audio.bonus = stage === 'bonus'; this.controls(); this.scene.wake();
  }
  private setMode(mode: 'base' | 'bonus', remaining: number) {
    this.mode = mode; this.remaining = remaining; this.root.dataset.mode = mode; this.root.dataset.bonus = String(mode === 'bonus'); this.scene.effects.setBloom(mode === 'bonus');
    const bonus = this.root.querySelector<HTMLElement>('.fh-bonus')!; bonus.setAttribute('aria-label', mode === 'bonus' ? `${this.c.remaining}: ${remaining}` : this.c.bonus);
    this.root.querySelectorAll<HTMLElement>('[data-bud]').forEach(bud => bud.classList.toggle('fh-bud-used', mode === 'bonus' && Number(bud.dataset.bud) >= remaining));
    this.find('remaining').textContent = fill(this.c.of, remaining); this.root.querySelector<HTMLElement>('.fh-left')!.hidden = mode !== 'bonus'; this.root.querySelector<HTMLElement>('.fh-net')!.hidden = mode === 'bonus';
  }
  private setEnergy(energy: number) {
    this.energy = energy; this.scene.setEnergy(energy); this.character.color(this.scene.color, energy > 1); const button = this.find('energy'); button.querySelector('b')!.textContent = '×' + energy; button.setAttribute('aria-label', this.c.energy + ': ×' + energy); this.values();
  }
  private setTotal(units: number) { this.shownTotal = units; this.find('total').textContent = this.number(units); }
  private say(status: string, hint = '') { this.status = status; this.hint = hint; this.controls(); }
  private flowerUnits() { return Number(forestHeartFlowerPayout(this.valueStake, this.energy)); }
  private values() {
    const amount = this.number(this.flowerUnits());
    this.root.querySelectorAll<HTMLElement>('[data-flower]').forEach(flower => {
      const paid = flower.dataset.paid === 'true'; flower.querySelector('.fh-flower-value')!.textContent = amount;
      flower.setAttribute('aria-label', `${this.c.flower} ${Number(flower.dataset.flower) + 1}: ${amount} USDT${paid ? ', ' + this.c.paid : ''}`);
    });
    this.find('flower-value-note').textContent = this.view ? `${this.c.currentPulse}. ${this.c.flowerValue}: ${amount} USDT` : `${this.c.flowerValue}: ${amount} USDT`;
  }
  /** A closed bud never looks like a prize. It unfolds only when confirmed light arrives. */
  private bloom(index: number, open: boolean, animate: boolean) {
    const flower = this.root.querySelector<HTMLElement>(`[data-flower="${index}"]`)!, changed = flower.classList.contains('fh-bloom') !== open;
    flower.classList.toggle('fh-bloom', open); flower.dataset.paid = String(open); this.values();
    const bud = flower.querySelector<HTMLElement>('.fh-bud')!, art = flower.querySelector<HTMLElement>('.fh-open')!, leaves = Array.from(flower.querySelectorAll<HTMLElement>('.fh-fan i'));
    if (!animate || !changed) { if (changed || !animate) for (const part of [bud, art, ...leaves]) part.getAnimations().forEach(animation => animation.cancel()); return; }
    if (this.reduced) return;
    if (!open) { art.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4)' }], { duration: 320, easing: 'ease-in' }); bud.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 380 }); return; }
    bud.animate([{ opacity: 1, transform: 'scale(1)', filter: 'brightness(1)' }, { opacity: 1, transform: 'scale(1.16,1.08)', filter: 'brightness(2)', offset: .55 }, { opacity: 0, transform: 'scale(1.3,.8)', filter: 'brightness(2.4)' }], { duration: 360, easing: 'ease-in' });
    leaves.forEach((leaf, n) => { const angle = Number(leaf.dataset.angle); leaf.animate([{ opacity: 0, transform: 'rotate(0) scale(.5,.8)' }, { opacity: .95, transform: `rotate(${angle * .35}deg) scale(.8,1)`, offset: .35 }, { opacity: .9, transform: `rotate(${angle * .95}deg) scale(1.05)`, offset: .75 }, { opacity: 0, transform: `rotate(${angle * 1.05}deg) scale(1.1)` }], { duration: 780, delay: 170 + Math.abs(n - 3) * 22, easing: 'cubic-bezier(.2,.8,.3,1)' }); });
    art.animate([{ opacity: 0, transform: 'scale(.3,.5)' }, { opacity: 1, transform: 'scale(1.18)', offset: .6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 620, delay: 330, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'backwards' });
    const at = this.layout.current.flowers[index]; this.scene.effects.spark(at.x, at.y, '#ffd875', 26, 120); for (let n = 0; n < 7; n++) this.scene.effects.petal(at.x, at.y, -70 + Math.random() * 120, -90 + Math.random() * 80, .8);
  }
  private pulse(element: HTMLElement, name: string) { element.classList.remove(name); void element.offsetWidth; element.classList.add(name); }
  private controls() {
    this.root.setAttribute('aria-busy', String(this.busy || this.client.busy || this.client.loading));
    const c = this.c, blocked = this.blocked(), stage = this.view?.stage, active = stage === 'choice' || stage === 'bonus', auto = this.autoplay?.state ?? { active: false, stopping: false, total: 0, completed: 0 }, recover = canRecoverOperation(this.client), waiting = this.busy && !this.presenting;
    if (active && this.shown) this.stake = Number(this.shown.stakeUnits);
    else if (!validGameStake(String(this.stake))) this.stake = FOREST_HEART_STAKES[0];
    if (!this.view && !this.busy && this.valueStake !== this.stake) { this.valueStake = this.stake; this.values(); }
    const balance = this.balance, shownBalance = this.busy && this.heldBalance !== undefined ? this.heldBalance : balance, locked = blocked || active || auto.active;
    this.find('balance').textContent = shownBalance === undefined ? '…' : this.number(shownBalance * 100);
    syncStakeSelect(this.find<HTMLSelectElement>('stake-select'),String(this.stake),FOREST_HEART_STAKES,locked);
    this.find<HTMLButtonElement>('lower').disabled = locked || this.stake === FOREST_HEART_STAKES[0];
    this.find<HTMLButtonElement>('higher').disabled = locked || this.stake === FOREST_HEART_STAKES.at(-1);
    const spin = this.find<HTMLButtonElement>('spin'), pass = this.find<HTMLButtonElement>('pass'), choosing = stage === 'choice' && !this.presenting;
    spin.hidden = this.presenting || choosing || recover; spin.disabled = blocked || auto.active || !active && (balance === undefined || balance * 100 < this.stake);
    const label = waiting ? c.spinning : stage === 'bonus' ? this.services.i18n.language === 'en' ? 'CONTINUE' : 'ПРОДОЛЖИТЬ' : c.spin, note = waiting ? c.waiting : stage === 'bonus' ? fill(c.free, this.view!.remaining) : fill(c.perField, this.number(this.stake)), content = `<span class="fh-button-label">${label}</span><small>${note}</small>`;
    if (spin.innerHTML !== content) spin.innerHTML = content;
    this.root.classList.toggle('fh-charging', waiting);
    pass.hidden = !choosing || recover; pass.disabled = blocked;
    const retry = this.find<HTMLButtonElement>('retry'); retry.hidden = this.client.pending?.gameId !== FOREST_HEART_GAME || !recover; retry.disabled = this.client.busy || this.busy || this.paused;
    this.find('refresh').hidden = !this.client.error || !!this.client.pending || this.presenting; this.root.dataset.refresh = String(!this.find('refresh').hidden);
    this.find<HTMLButtonElement>('refresh').disabled = this.client.busy || this.client.loading || this.busy;
    this.find('skip').hidden = !this.presenting;
    const autoButton = this.find<HTMLButtonElement>('auto'), left = Math.max(0, auto.total - this.autoAccepted);
    autoButton.disabled = auto.active ? auto.stopping : locked || balance === undefined || balance * 100 < this.stake; autoButton.setAttribute('aria-pressed', String(auto.active));
    this.find('auto-label').textContent = auto.active ? fill(c.stop, left) : c.auto; autoButton.setAttribute('aria-label', auto.active ? fill(c.autoStop, left) : c.autoOpen);
    this.root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(button => { button.disabled = blocked || stage !== 'choice' || !FOREST_HEART_ROTORS.includes(Number(button.dataset.cell)); });
    const settled = this.shown?.state === 'settled' && !this.busy, tier = settled ? forestRoundTier(Number(this.shown!.returnedUnits), Number(this.shown!.spentUnits)) : undefined;
    this.root.dataset.outcome = tier ?? '';
    const net = settled ? Number(this.shown!.returnedUnits) - Number(this.shown!.spentUnits) : 0;
    this.find('net').textContent = settled ? `${net > 0 ? '+' : ''}${this.number(net)}` : ''; this.find('net-label').textContent = settled ? c.net : '';
    this.find('net').setAttribute('aria-label', settled ? `${c.net}: ${this.find('net').textContent} USDT` : c.atEnd);
    this.find('total-label').textContent = (this.busy || active ? c.pendingTotal : c.total) + (this.layout?.current.kind === 'landscape' ? '' : ', USDT');
    this.find('total').title = !this.view && !this.busy ? '' : settled ? c.credited : c.collected;
    this.find('status').textContent = this.client.error || this.status || (!this.owner ? c.login : waiting ? c.searching : stage === 'choice' ? c.choice : stage === 'bonus' ? this.view!.remaining < 4 ? c.forestWaits : c.bonus : tier ? c[tier] : c.ready);
    this.find('next').textContent = recover ? c.retry : this.hint || (waiting ? c.waiting : stage === 'choice' ? auto.active ? c.autoChoice : c.nextChoice : stage === 'bonus' ? this.view!.remaining < 4 ? fill(c.freeRemain, this.view!.remaining) : c.bonusNote : tier && this.shown ? this.outcomeNote(tier) : (this.layout?.current.plate.w ?? 999) < 380 ? c.nextIdleShort : c.nextIdle);
    this.waiters = this.waiters.filter(waiter => { if (!waiter.test()) return true; waiter.done(); return false; });
  }
  private outcomeNote(tier: ReturnType<typeof forestRoundTier>) {
    const c = this.c, round = this.shown!;
    if (tier === 'loss') return c.lossNext;
    if (tier === 'big') return fill(c.bigNote, (Number(round.returnedUnits) / Number(round.spentUnits)).toLocaleString(this.services.i18n.locale, { maximumFractionDigits: 1 }));
    return tier === 'even' ? '' : fill(tier === 'partial' ? c.partialNote : c.fieldStake, this.number(Number(round.stakeUnits)));
  }
  private waitFor(test: () => boolean) { return new Promise<void>(done => { if (test()) done(); else this.waiters.push({ test, done }); }); }
  private async act(move?: string, automatic = false): Promise<boolean> {
    if (!this.alive || this.busy || this.paused || this.resultDialog.open || this.autoDialog.open) return false;
    if (this.autoplay.state.active && !automatic && this.view?.stage !== 'choice') return false;
    const retry = move === 'retry';
    if (retry ? this.client.pending?.gameId !== FOREST_HEART_GAME || this.client.busy : this.blocked()) return false;
    const owner = this.owner, prior = this.shown ? structuredClone(this.shown) : undefined, before = this.balance, paid = !retry && !(this.view && this.view.stage !== 'settled'), choice = this.view?.stage === 'choice';
    let accepted = false, finished = false;
    this.character.reset(!retry && (choice || this.view?.stage === 'bonus') ? this.view!.stage as 'choice' | 'bonus' : 'idle'); this.scene.effects.stopStream();
    this.busy = true; this.status = this.hint = ''; this.heldBalance = before; this.root.classList.add('fh-awaiting');
    if (!retry && !choice) this.prepare(paid); this.controls();
    void this.audio.unlock();
    try {
      if (retry) await this.client.retry();
      else {
        const op: NewExpansionAction = this.view && this.view.stage !== 'settled' && this.shown ?
          { gameId: FOREST_HEART_GAME, action: 'move', sessionId: this.shown.id, move: move ?? 'forest-spin', revision: this.view.revision } :
          { gameId: FOREST_HEART_GAME, action: 'start', stakeUnits: String(this.stake), settings: { forestHeart: { mode: 'normal' } } };
        await this.client.act(op);
      }
      if (!this.alive || owner !== this.client.accountId) return false;
      const next = this.snapshot();
      if (!next || !validForestHeartSession(next)) throw Error(this.c.unavailable);
      this.shown = structuredClone(next);
      const fresh = prior?.id !== next.id || prior.view.forestHeart!.revision !== next.view.forestHeart!.revision;
      accepted = fresh;
      if (fresh && automatic && paid) this.autoAccepted++;
      if (before !== undefined && paid) this.heldBalance = before - Number(next.stakeUnits) / 100;
      if (fresh && !retry && !this.doc.hidden && !this.paused) { await this.present(prior?.view.forestHeart); finished = prior?.view.forestHeart?.stage === 'bonus' && this.view?.stage === 'settled' && !this.paused && !this.doc.hidden; }
      this.status = this.hint = '';
    } catch (error) { this.autoplay.stop(); if (this.alive && owner === this.client.accountId) { this.status = (error as Error).message; this.hint = ''; } }
    finally {
      if (this.alive) { this.character.release(); this.character.linger(4200); this.scene.effects.stopStream(); this.busy = this.presenting = false; this.heldBalance = undefined; this.root.classList.remove('fh-awaiting', 'fh-presenting'); delete this.root.dataset.motion; this.paint(); this.sync(); }
    }
    if (finished && this.alive && owner === this.client.accountId && this.shown?.state === 'settled') this.openResult();
    return accepted;
  }
  /** Immediate neutral response. Nothing here depends on the coming result. */
  private prepare(paid: boolean) {
    if (!this.reduced) { this.setEnergy(1); this.character.react('awaken', Infinity); }
    this.motion.abort(); this.motion = new AbortController(); delete this.root.dataset.celebrate;
    if (this.reduced) return;
    const bonus = this.view?.stage === 'bonus', held = bonus ? forestScene(this.view).lockedCells : [];
    this.scene.field.clearLight(); this.scene.field.unlight(); this.scene.effects.clearBeams(); this.scene.effects.rays = 0;
    for (let i = 0; i < 3; i++) this.bloom(i, false, true);
    if (paid) { this.valueStake = this.stake; this.setMode('base', 0); this.scene.field.setHeld([]); this.setTotal(0); }
    else if (bonus) { this.setMode('bonus', Math.max(0, this.remaining - 1)); const bud = this.root.querySelector<HTMLElement>(`[data-bud="${this.remaining}"]`); if (bud) this.pulse(bud, 'fh-bud-spent'); }
    this.root.dataset.motion = 'spin'; this.scene.field.spin(new Set(held));
    const turning = FOREST_HEART_ROTORS.filter(cell => !held.includes(cell)); for (const cell of turning) { const at = this.cellPoint(cell); this.scene.effects.leaf(at.x, at.y, 2); }
    this.scene.effects.stream('spin', () => this.anchor('hand'), () => this.cellPoint(turning[Math.floor(Math.random() * turning.length)]), this.scene.color, 46, 14);
    this.scene.wake();
  }
  /** Her hand or crystal in scene pixels, only while that part is visible. */
  private anchor(part: 'hand' | 'crystal') { const { elf } = this.layout.current, [u, v] = this.character.anchor(part), x = elf.x + u * elf.w, y = elf.y + v * elf.h; return elf.visible && x < this.layout.current.width && v * 100 < elf.cut ? { x, y } : undefined; }
  private cellPoint = (cell: number) => this.scene.field.centre(cell);
  private clock(duration: number, frame: (elapsed: number) => void = () => {}) {
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
  private async accent(cue: ForestCue, apply: () => void, variant = 0, duration = 0, frame?: (progress: number) => void) {
    if (this.motion.signal.aborted || this.paused || this.doc.hidden) return;
    const scheduled = this.audio.accent(cue, variant, duration);
    const wait = Math.max(duration, scheduled.audibleAt - performance.now());
    await this.clock(wait, elapsed => frame?.(this.reduced || !wait ? 1 : Math.min(1, elapsed / wait)));
    if (this.motion.signal.aborted || this.paused || this.doc.hidden) return;
    apply(); this.timing.push({ cue, mode: scheduled.mode, latencyMs: scheduled.latencyMs, skewMs: performance.now() - scheduled.audibleAt });
    this.timing = this.timing.slice(-40);
  }
  /** Decorative waits vanish with reduced motion and shorten in the fast mode. */
  private time(normal: number, fast: number) { return this.reduced ? 0 : this.fast ? fast : normal; }
  private async present(previous?: ForestHeartView) {
    if (this.motion.signal.aborted || previous?.stage === 'choice') { this.motion.abort(); this.motion = new AbortController(); }
    const signal = this.motion.signal, { field, effects } = this.scene;
    this.presentationCount++; delete this.root.dataset.celebrate; this.presenting = true; this.root.classList.add('fh-presenting'); this.root.classList.remove('fh-awaiting');
    const scene = forestScene(this.view), turn = previous?.stage === 'choice', bonusSpin = previous?.stage === 'bonus';
    const before = turn ? forestScene(previous) : undefined;
    const changed = before ? scene.board.findIndex((mask, cell) => mask !== before.board[cell]) : -1;
    const prior = bonusSpin ? forestScene(previous) : undefined, carried = new Set(prior?.lockedCells ?? []);
    const previousFlowers = before?.paidMask ?? 0, counterFrom = previous && this.view!.revision > 1 ? forestScene(previous).totalUnits : 0;
    if (!turn) {
      if (this.reduced) { this.setMode(bonusSpin ? 'bonus' : 'base', bonusSpin ? this.view!.remaining : 0); for (let i = 0; i < 3; i++) this.bloom(i, false, false); if (!bonusSpin) this.valueStake = Number(this.shown!.stakeUnits); field.clearLight(); field.unlight(); effects.clearBeams(); this.setEnergy(1); }
      this.setTotal(counterFrom); this.say(bonusSpin ? fill(this.c.freeSpin, 4 - this.view!.remaining) : this.c.searching, bonusSpin ? this.c.heldStay : this.c.accepted);
      this.root.dataset.motion = 'reveal';
      await this.accent('land', () => { effects.stopStream('spin'); this.character.react('land', 620); field.show(scene.board); field.setHeld([...carried]); this.scene.wake(); }, 0, this.time(1000, 480), progress => { if (!this.reduced) field.land(scene.board, carried, progress); });
      if (signal.aborted) return;
      this.setEnergy(scene.energy);
      if (scene.energy > 1) { this.pulse(this.find('energy'), 'fh-energy-pop'); effects.spark(this.layout.current.gem.x, this.layout.current.gem.y, this.scene.color, Math.min(60, 10 + scene.energy), 150); this.say(fill(this.c.energyNow, scene.energy)); const strong = scene.energy >= 5; this.character.react(strong ? 'energy' : 'pulse', strong ? Infinity : 700); const crystal = this.anchor('crystal'); if (crystal) effects.burst(this.layout.current.gem, crystal, this.scene.color, strong ? 40 : 16, 16); await this.clock(this.time(bonusSpin ? 420 : 520, bonusSpin ? 210 : 260)); if (signal.aborted) return; }
    } else {
      field.setChoice(false); this.root.dataset.motion = changed >= 0 ? 'turn' : 'pass'; this.say(changed >= 0 ? this.c.turning : this.c.turnKeeps, changed >= 0 ? this.c.turnKeeps : '');
      if (changed >= 0) {
        this.character.react('turn', Infinity); effects.stream('turn', () => this.anchor('hand'), () => this.cellPoint(changed), '#ffe39a', 60, 12);
        const from = rootArtwork(before!.board[changed]).angle, to = from === 90 ? 180 : 90, at = field.centre(changed); effects.leaf(at.x, at.y, 5); effects.clearBeams();
        await this.accent('turn', () => { effects.stopStream('turn'); field.clearLight(); field.unlight(); field.show(scene.board); effects.spark(at.x, at.y, '#ffe39a', 22, 110); this.scene.wake(); }, 0, this.time(560, 220), progress => { if (this.reduced) return; field.fadeLight(1 - progress * 2.4); field.turn(changed, from, to, Math.max(0, (progress - .2) / .8)); });
        if (signal.aborted) return;
      }
    }
    if (!turn || changed >= 0) await this.flow(scene, previousFlowers, counterFrom, signal);
    if (signal.aborted) return;
    this.setTotal(scene.totalUnits);
    if (bonusSpin && this.view!.stage === 'bonus') {
      const fresh = scene.lockedCells.filter(cell => !carried.has(cell));
      if (fresh.length) { this.character.react('hold', 900); for (const cell of fresh) { const crystal = this.anchor('crystal'); if (crystal) effects.burst(crystal, this.cellPoint(cell), '#ffd875', 14, 14); } field.setHeld(scene.lockedCells, fresh); await this.clock(this.time(650, 260), elapsed => field.grow(fresh, this.reduced ? 1 : Math.min(1, elapsed / Math.max(1, this.time(650, 260))))); field.grow(fresh, 1); for (const cell of fresh) { const at = field.centre(cell); effects.spark(at.x, at.y, '#ffd875', 12, 80); } if (signal.aborted) return; }
    }
    const stage = this.view?.stage;
    if (stage === 'choice') { await this.clock(this.time(220, 90)); if (signal.aborted) return; await this.accent('choice', () => { this.character.react('choice', Infinity); }); }
    else if (stage === 'bonus' && !bonusSpin) {
      await this.clock(this.time(320, 120)); if (signal.aborted) return;
      await this.accent('bonus', () => { this.setMode('bonus', this.view!.remaining); this.character.react('bonus', Infinity); this.say(this.c.bonus, this.c.bonusNote); this.root.querySelectorAll<HTMLElement>('[data-bud]').forEach(bud => this.pulse(bud, 'fh-bud-spent')); effects.scatter(34); });
      if (signal.aborted) return;
      const shown = this.banner(this.c.bonus, this.c.bonusBanner, this.time(1900, 900)), ring = this.time(1100, 600); await this.clock(ring, elapsed => { if (ring) effects.ring = elapsed / ring; }); effects.ring = -1; await shown;
    }
    if (signal.aborted) return;
    const tier = this.shown?.state === 'settled' ? forestRoundTier(Number(this.shown.returnedUnits), Number(this.shown.spentUnits)) : undefined, sum = Number(this.shown?.returnedUnits ?? 0);
    if (tier === 'win' || tier === 'big') {
      this.root.dataset.motion = 'count'; this.say(this.c[tier], this.outcomeNote(tier));
      const big = tier === 'big', length = big ? this.time(1500, 600) : 0;
      if (big) { // she celebrates while the sum grows, the light runs along the frame and petals fall
        this.character.react('big', 3200 + length); const ring = this.time(1250, 600);
        void this.clock(ring, elapsed => { if (ring) effects.ring = elapsed / ring; }).then(() => { effects.ring = -1; });
        if (!this.reduced) { effects.shower(3.6); effects.stream('big', () => this.anchor('hand'), () => { const g = this.layout.current; return { x: g.x + g.board * (.1 + Math.random() * .8), y: g.y - g.frame }; }, '#ffd875', 26, 20); }
      }
      await this.accent(tier, () => { this.setTotal(sum); this.root.dataset.celebrate = tier; if (!big) this.character.react('win', 2600); this.pulse(this.find('total'), 'fh-bump'); if (!big) for (let i = 0; i < 16; i++) { const g = this.layout.current; effects.petal(g.x + g.board + Math.random() * g.flower, g.y + Math.random() * g.board * .6, -40 + Math.random() * 60, -20 + Math.random() * 60, .8); } }, 0, length, progress => { if (big && !this.reduced) { effects.rays = progress; this.setTotal(Math.floor(sum * easeRoot(progress))); } });
      if (signal.aborted) return;
      if (big) await this.clock(this.time(500, 250));
    } else if (tier) { this.say(this.c[tier], this.outcomeNote(tier)); this.character.react(tier === 'loss' ? 'loss' : 'partial', tier === 'loss' ? 1500 : 1000); }
    await this.clock(this.time(240, 120)); delete this.root.dataset.pulse;
  }
  /** Light fills connected roots, then every newly reached flower opens and sends its sum to the plate. */
  private async flow(scene: ReturnType<typeof forestScene>, previousFlowers: number, counterFrom: number, signal: AbortSignal) {
    const { field, effects } = this.scene, step = this.time(150, 76), color = this.scene.color; let total = counterFrom;
    this.root.dataset.motion = 'flow'; this.say(this.c.lighting, fill(this.c.eachFlower, this.number(this.flowerUnits())));
    const source = effects.beam(-1, color), start = this.time(260, 110), plan = field.startLight(step);
    await this.accent('flow', () => { this.root.dataset.pulse = 'true'; this.character.react('channel', Infinity); effects.stream('flow', () => this.anchor('hand'), () => this.layout.current.gem, color, 30, 10); effects.spark(this.layout.current.gem.x, this.layout.current.gem.y, color, 16, 90); });
    if (signal.aborted) return;
    await this.clock(start, elapsed => { source.progress = start ? elapsed / start : 1; }); source.progress = 1; if (signal.aborted) return;
    let earliest = 0, opened = 0;
    const jobs = [...plan.arrivals].sort((a, b) => a[1] - b[1]).map(async ([index, arrival]) => {
      const paid = !!((scene.paidMask & ~previousFlowers) & (1 << index)), at = paid ? Math.max(arrival, earliest) : arrival; if (paid) earliest = at + (this.reduced ? 0 : 130);
      await this.clock(this.reduced ? 0 : at); if (signal.aborted) return;
      const beam = effects.beam(index, color, paid ? 1 : .6), length = this.time(140, 70); await this.clock(length, elapsed => { beam.progress = length ? elapsed / length : 1; }); beam.progress = 1;
      if (signal.aborted || !paid) return;
      await this.accent('flower', () => { effects.stopStream('flow'); const first = opened++ === 0; this.bloom(index, true, true); this.character.react(first ? 'flower' : 'pulse', first ? Infinity : 1100); const crystal = this.anchor('crystal'); if (crystal) effects.burst(this.layout.current.flowers[index], crystal, '#ffd875', 12, 12); }, index); if (signal.aborted) return;
      await this.clock(this.time(420, 140)); if (signal.aborted) return;
      await this.fly(index); if (signal.aborted) return; total += this.flowerUnits(); this.setTotal(total); if (!this.reduced) { this.pulse(this.find('total'), 'fh-bump'); effects.spark(this.layout.current.sum.x, this.layout.current.sum.y, '#ffe39a', 8, 60); }
    });
    await this.clock(this.reduced ? 0 : plan.duration + 60, elapsed => field.setLight(elapsed)); if (signal.aborted) return;
    effects.stopStream('flow'); field.setLight(Infinity); this.scene.wake(); await Promise.all(jobs);
  }
  private async fly(index: number) {
    const length = this.time(820, 360); if (!length) return;
    const g = this.layout.current, from = g.flowers[index], element = this.doc.createElement('div'); element.className = 'fh-fly'; element.textContent = '+' + this.number(this.flowerUnits()); element.setAttribute('aria-hidden', 'true'); this.root.append(element); this.flying.add(element);
    const x = Math.min(from.x - element.offsetWidth / 2, g.width - element.offsetWidth - 4); element.style.left = x + 'px'; element.style.top = from.y - 8 + 'px';
    const dx = g.sum.x - x - element.offsetWidth / 2, dy = g.sum.y - from.y;
    element.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'translateY(-26px) scale(1.15)', opacity: 1, offset: .3 }, { transform: `translate(${dx * .5}px,${dy * .55 - 40}px) scale(1)`, opacity: 1, offset: .65 }, { transform: `translate(${dx}px,${dy}px) scale(.8)`, opacity: .2 }], { duration: length, easing: 'ease-in-out', fill: 'forwards' });
    await this.clock(length); element.remove(); this.flying.delete(element);
  }
  private async banner(title: string, note: string, length: number) {
    if (!length) return; const element = this.root.querySelector<HTMLElement>('.fh-banner')!; element.replaceChildren(title); const small = this.doc.createElement('small'); small.textContent = note; element.append(small);
    element.animate([{ opacity: 0, transform: 'translate(-50%,-30%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .22 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.02)', offset: .75 }, { opacity: 0, transform: 'translate(-50%,-64%) scale(1.04)' }], { duration: length, easing: 'ease-out' });
    await this.clock(length);
  }
  private openResult() {
    if (this.resultDialog.open || this.dialog.open) return;
    const sum = Number(this.shown!.returnedUnits), auto = this.autoplay.state, left = Math.max(0, auto.total - this.autoAccepted);
    this.find('result-sum').textContent = this.number(sum) + ' USDT';
    this.find('result-note').textContent = fill(this.c.resultMoney, (sum / Number(this.shown!.spentUnits)).toLocaleString(this.services.i18n.locale, { maximumFractionDigits: 2 }));
    this.find('result-confirm').textContent = auto.active && !auto.stopping && left > 0 ? fill(this.c.resultAuto, left) : this.c.resultBack;
    this.resultDialog.returnValue = ''; this.character.linger(Infinity); this.resultDialog.showModal(); this.find('result-confirm').focus({ preventScroll: true });
  }
  private autoTexts() { this.find('auto-text').textContent = fill(this.c.autoText, this.number(this.stake)); this.find('auto-start').textContent = fill(this.c.autoStart, this.autoCount, this.number(this.stake)); }
  private openAutoplay() {
    if (this.find<HTMLButtonElement>('auto').disabled || this.busy || this.autoDialog.open || this.dialog.open || !validStakeDraft(this.root, true)) return;
    this.autoTexts(); this.autoDialog.showModal(); this.root.querySelector<HTMLElement>(`[data-auto-count="${this.autoCount}"]`)?.focus({ preventScroll: true });
  }
  private startAutoplay() {
    if (!this.autoDialog.open || this.blocked() || this.autoplay.state.active || this.view && this.view.stage !== 'settled') return;
    this.autoDialog.close(); this.autoAccepted = 0; void this.autoplay.start(this.autoCount);
  }
  private rest(ms: number) { return new Promise<void>(resolve => this.doc.defaultView!.setTimeout(resolve, ms)); }
  /** One paid field with all of its free continuations. The rune always waits for the player. */
  private async autoRound(): Promise<boolean> {
    const stopped = () => !this.alive || this.paused || this.doc.hidden || this.autoplay.state.stopping;
    if (this.autoplay.state.completed > 0) await this.rest(this.fast ? 250 : 700);
    if (stopped() || this.blocked() || this.view && this.view.stage !== 'settled' || this.balance === undefined || this.balance * 100 < this.stake || !validStakeDraft(this.root)) return false;
    if (!await this.act(undefined, true)) return false;
    while (!stopped() && this.view && this.view.stage !== 'settled') {
      if (this.view.stage === 'choice') { await this.waitFor(() => stopped() || !this.busy && this.view?.stage !== 'choice'); continue; }
      await this.rest(this.fast ? 250 : 650); if (stopped()) break;
      if (!await this.act(undefined, true)) return false;
    }
    if (this.alive && this.resultDialog.open) await new Promise<void>(resolve => { this.closeResult = () => resolve(); });
    return this.alive;
  }
  private cancel() {
    this.motion.abort(); this.audio.cancel(); this.scene.effects.quiet(); for (const element of this.flying) element.remove(); this.flying.clear();
    this.root.querySelector<HTMLElement>('.fh-banner')!.getAnimations().forEach(animation => animation.cancel());
    const stage = this.view?.stage; this.character.rest(stage === 'choice' || stage === 'bonus' ? stage : 'idle', true);
    delete this.root.dataset.pulse; delete this.root.dataset.celebrate; delete this.root.dataset.motion; if (this.alive) this.paint();
  }
  pause() { this.paused = true; this.autoplay.stop(); this.cancel(); this.audio.pause(); this.root.dataset.paused = 'true'; this.controls(); }
  resume() { if (!this.alive || this.doc.hidden || this.dialog.open) return; this.paused = false; this.root.dataset.paused = 'false'; this.audio.resume(); this.paint(); }
  getState() {
    return { gameId: FOREST_HEART_GAME, busy: this.busy, presenting: this.presenting, paused: this.paused, reduced: this.reduced,
      sessionId: this.shown?.id ?? null, view: this.view ? structuredClone(this.view) : null, autoplay: this.autoplay.state, accepted: this.autoAccepted,
      scene: forestScene(this.view), visual: this.scene.state(), character:this.character.state(), audio: this.audio.state(), timing: [...this.timing], presentations: this.presentationCount };
  }
  destroy() {
    this.alive = false; this.autoplay.stop(); this.motion.abort(); this.closeResult?.(false); this.controls(); for (const dialog of [this.dialog, this.autoDialog, this.resultDialog]) if (dialog.open) dialog.close();
    this.cancel(); this.audio.destroy(); this.character.destroy(); this.scene.destroy(); this.stopPreferences(); this.controller.abort();
    this.doc.removeEventListener('visibilitychange', this.visibility); this.media.removeEventListener('change', this.mediaChange);
    this.layout.destroy();this.client.removeEventListener('change', this.change); this.wallet.removeEventListener('change', this.change); this.host.replaceChildren();
  }
}
