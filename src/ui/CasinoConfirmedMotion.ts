import { emitImportedOutcome } from './importedMotion/Outcome';
import { t as translateText, tr } from '../i18n/index';
import { emitGameOutcome, observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { VARIANT_GEMS, VARIANT_GEM_NAMES } from '../shared/casinoVariants';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import './casino-confirmed-motion.css';

const supported = new Set(['variant-keno', 'github-sic-bo', 'variant-sic-bo', 'github-diamonds', 'variant-diamonds', 'variant-gem-collection', 'variant-dice-streak', 'variant-mines', 'variant-double-mines', 'variant-keys']);
const colors = ['#edcf69', '#5acf9b', '#65b7f0', '#b096ee', '#f3a574', '#c7f4fc'];

/** Presents only an owned, newly confirmed response. Wallet and gameplay state remain in the clients. */
export class CasinoConfirmedMotion {
  static forGame(host: HTMLElement, game: string, render: () => void) {
    return supported.has(game) ? new CasinoConfirmedMotion(host, game, render) : undefined;
  }
  active = false;
  private alive = true;
  private epoch = 0;
  private account: string | null = demoWallet.accountId;
  private prior?: ExpansionSession;
  private shown?: ExpansionSession;
  private priorBalance?: number;
  private op?: NewExpansionAction;
  private stage?: HTMLElement;
  private animations = new Set<Animation>();
  private waits = new Set<() => void>();
  private watchdog?: number;
  private reactedSessions = new Set<string>();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private visibility = () => { if (document.hidden) this.cancel(); };
  private preferences = () => { if (this.reduced.matches) this.cancel(); };
  private accountChange = () => { if (this.account !== demoWallet.accountId) { this.account = demoWallet.accountId; this.cancel(); } };

  private constructor(private host: HTMLElement, private game: string, private render: () => void) {
    document.addEventListener('visibilitychange', this.visibility);
    this.reduced.addEventListener('change', this.preferences);
    demoWallet.addEventListener('change', this.accountChange);
  }
  private owns(token = this.epoch) {
    return this.alive && this.active && token === this.epoch && this.account === demoWallet.accountId && !document.hidden && !this.reduced.matches;
  }
  guardRender() {
    if (!this.active) return false;
    if (!this.owns()) { this.cancel(false); return false; }
    return !!this.stage?.isConnected;
  }
  session(current?: ExpansionSession) { return this.active && this.owns() ? this.shown : current; }
  balance(current?: number) { return this.active && this.owns() ? this.priorBalance : current; }

  /** Static snapshots only establish a baseline. Owned actions emit after final presentation. */
  observeOutcome(current?: ExpansionSession) {
    resetGameOutcomes(this.host);
    observeExpansionOutcome(this.host, this.game, current, client.accountId, false, false);
  }
  private confirmed(operation: NewExpansionAction, saved: ExpansionSession | undefined, prior?: ExpansionSession) {
    if (!saved) return false;
    if (operation.action === 'start') return saved.id !== prior?.id;
    return saved.id === operation.sessionId && (saved.view.phase !== prior?.view.phase || saved.state !== prior?.state);
  }
  private emitConfirmedOutcome(saved: ExpansionSession | undefined, token: number, ownerAccount: string | null) {
    if (!saved || saved.state !== 'settled' || !this.alive || token !== this.epoch || document.hidden || ownerAccount !== demoWallet.accountId || ownerAccount !== client.accountId) return;
    const key = `${ownerAccount}:${saved.id}`;
    if (this.reactedSessions.has(key)) return;
    this.reactedSessions.add(key);
    if (this.reactedSessions.size > 128) this.reactedSessions.delete(this.reactedSessions.values().next().value!);
    emitGameOutcome(this.host, saved.spentUnits, saved.returnedUnits);
    emitImportedOutcome(this.host,{gameId:this.game,spentUnits:saved.spentUnits,returnedUnits:saved.returnedUnits});
  }

  async run(operation: NewExpansionAction, send: () => Promise<unknown>) {
    if (this.active) throw new Error(translateText('Дождись завершения показа результата.'));
    if (!this.alive || document.hidden) return send();
    this.account = demoWallet.accountId;
    const token = ++this.epoch, ownerAccount = this.account;
    this.prior = structuredClone(client.sessions.find(s => s.gameId === this.game));
    const prior = this.prior;
    if (this.reduced.matches) {
      const reply = await send();
      const saved = client.sessions.find(s => s.gameId === this.game);
      if (this.confirmed(operation, saved, prior) && this.alive && token === this.epoch && ownerAccount === demoWallet.accountId && !document.hidden) {
        this.render();
        this.emitConfirmedOutcome(saved, token, ownerAccount);
      }
      return reply;
    }
    this.shown = operation.action === 'start' ? undefined : this.prior;
    this.priorBalance = demoWallet.wallet?.balance ?? client.wallet?.balance;
    this.op = structuredClone(operation);
    this.active = true;
    this.stage = undefined;
    this.render();
    // Network requests already have a client timeout. This additionally bounds the visual owner.
    this.watchdog = window.setTimeout(() => { if (this.owns(token)) this.cancel(); }, 18000);
    let completedOutcome: ExpansionSession | undefined;
    try {
      const reply = await send();
      if (!this.owns(token)) return reply;
      const saved = client.sessions.find(s => s.gameId === this.game);
      if (!this.confirmed(operation, saved, prior)) return reply;
      this.stage!.dataset.motionPhase = 'confirmed';
      this.host.dataset.motionPhase = 'confirmed';
      if (await this.present(saved!, token) && this.owns(token)) completedOutcome = saved;
      return reply;
    } finally {
      if (token === this.epoch) {
        this.stop(); this.active = false; this.stage = undefined;
        delete this.host.dataset.motionPhase;
        if (this.alive && ownerAccount === demoWallet.accountId) {
          this.render();
          this.emitConfirmedOutcome(completedOutcome, token, ownerAccount);
        }
      }
    }
  }

  paint() {
    if (!this.owns() || this.stage?.isConnected) return;
    const board = this.host.querySelector<HTMLElement>('.variant-stage,.next-stage,.batch-stage,.expansion-board');
    if (!board) { this.cancel(false); return; }
    const root = this.host.firstElementChild as HTMLElement;
    root.dataset.confirmedMotion = String(this.epoch);
    this.host.dataset.motionPhase = 'pending';
    const stage = document.createElement('section');
    stage.className = 'royal-confirmed-motion';
    stage.dataset.motionPhase = 'pending';
    stage.dataset.motionGame = this.game;
    stage.setAttribute('aria-label', translateText('Показ подтверждённого результата'));
    const v = this.shown?.view.variant as any;
    if (this.game === 'variant-keno') {
      const numbers = (this.op?.action === 'start' ? (this.op.settings as any).variant?.numbers : v?.numbers) ?? [];
      stage.innerHTML = tr`<div class="confirmed-caption">ЧИСЛА УДАЧИ</div><div class="confirmed-keno">${Array.from({length:20}, (_, i) => `<span data-confirmed-number="${i+1}" class="${numbers.includes(i+1) ? 'picked' : ''}">${i+1}</span>`).join('')}</div><p data-confirmed-count>Выпало 0 из 5</p>`;
    } else if (this.game.includes('sic-bo') || this.game === 'variant-dice-streak') {
      const count = this.game === 'variant-dice-streak' ? 1 : 3;
      stage.innerHTML = tr`<div class="confirmed-caption">${count === 1 ? translateText('СЛЕДУЮЩИЙ БРОСОК') : translateText('ТРИ КОСТИ')}</div><div class="confirmed-dice">${Array.from({length:count}, (_, i) => tr`<div class="confirmed-die rolling" data-confirmed-die="${i}" aria-label="Кость ещё не раскрыта">?</div>`).join('')}</div><p data-confirmed-count>Ждём подтверждённый бросок</p>`;
    } else if (this.game.includes('diamonds') || this.game === 'variant-gem-collection') {
      stage.innerHTML = tr`<div class="confirmed-caption">ПЯТЬ НАХОДОК</div><div class="confirmed-gems">${Array.from({length:5}, (_, i) => tr`<div class="confirmed-gem searching" data-confirmed-gem="${i}" aria-label="Самоцвет ещё не раскрыт">◇</div>`).join('')}</div><p data-confirmed-count>Открываем находки по порядку</p>`;
    } else {
      const keys = this.game === 'variant-keys', cells: string[] = keys ? v?.rows?.flat() ?? Array(24).fill('hidden') : v?.cells ?? Array(16).fill('hidden');
      const picks = this.op?.action === 'move' ? this.op.picks ?? [] : [];
      const selected = keys ? picks.map(col => (v?.steps ?? 0) * 4 + col) : picks;
      stage.innerHTML = tr`<div class="confirmed-caption">${keys ? translateText('ОТКРЫВАЕМ ЗАМКИ') : translateText('ОТКРЫВАЕМ ЯЧЕЙКИ')}</div><div class="confirmed-cells ${keys ? 'keys' : ''}">${cells.map((cell, i) => tr`<div data-confirmed-cell="${i}" class="${cell} ${selected.includes(i) ? 'opening' : ''}" aria-label="Ячейка ${i+1}: ${cell === 'safe' ? translateText('открыта безопасно') : translateText('закрыта')}">${cell === 'safe' ? '◆' : '○'}<small>${i+1}</small></div>`).join('')}</div><p data-confirmed-count>Подтверждаем ход</p>`;
    }
    board.replaceWith(stage);
    this.stage = stage;
    this.host.querySelectorAll('.variant-result,.next-result,.batch-result').forEach(node => node.remove());
    this.host.querySelectorAll<HTMLElement>('[role="status"],.expansion-message').forEach(node => { node.textContent = translateText('Показываем результат. Дождись завершения.'); });
    this.host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button').forEach(node => { node.disabled = true; });
  }

  private async present(saved: ExpansionSession, token: number): Promise<boolean> {
    const v = saved.view.variant as any;
    if (this.op?.action === 'move' && this.op.move === 'cashout') { await this.wait(180, token); return this.owns(token); }
    if (this.game === 'variant-keno') {
      if (!Array.isArray(v?.drawn) || v.drawn.length !== 5) return false;
      for (const [i, number] of v.drawn.entries()) {
        if (!this.owns(token)) return false;
        const node = this.stage!.querySelector<HTMLElement>(`[data-confirmed-number="${number}"]`);
        if (!node) return false;
        await this.animate(node, [{transform:'scale(1)'},{transform:'scale(.5) rotateY(90deg)'},{transform:'scale(1) rotateY(0deg)'}], 160, token);
        if (!this.owns(token)) return false;
        node.classList.add('drawn'); node.dataset.revealed = 'true';
        node.setAttribute('aria-label', tr`Число ${number}, выпало`);
        this.stage!.querySelector('[data-confirmed-count]')!.textContent = tr`Выпало ${i+1} из 5`;
        await this.wait(90, token);
      }
    } else if (this.game.includes('sic-bo') || this.game === 'variant-dice-streak') {
      const values = this.game === 'github-sic-bo' ? saved.dice : this.game === 'variant-sic-bo' ? v?.dice : v?.history?.length > (this.prior?.view.variant as any)?.history?.length ? [v.history.at(-1).die] : [];
      if (!Array.isArray(values) || !values.every(n => Number.isInteger(n) && n >= 1 && n <= 6)) return false;
      if (!values.length) { await this.wait(180, token); return this.owns(token); }
      for (const [i, value] of values.entries()) {
        if (!this.owns(token)) return false;
        const node = this.stage!.querySelector<HTMLElement>(`[data-confirmed-die="${i}"]`)!;
        node.classList.remove('rolling');
        await this.animate(node, [{transform:'translateY(-8px) rotate(-35deg)'},{transform:'translateY(-22px) rotate(170deg)'},{transform:'translateY(0) rotate(360deg)'}], 430, token);
        if (!this.owns(token)) return false;
        node.innerHTML = this.die(value); node.dataset.revealed = 'true'; node.setAttribute('aria-label', tr`Кость: ${value}`);
      }
      this.stage!.querySelector('[data-confirmed-count]')!.textContent = translateText('Бросок подтверждён');
      await this.wait(200, token);
    } else if (this.game.includes('diamonds') || this.game === 'variant-gem-collection') {
      const values = this.game === 'github-diamonds' ? saved.gems : v?.hand;
      if (!Array.isArray(values) || values.length !== 5) return false;
      for (const [i, value] of values.entries()) {
        if (!this.owns(token)) return false;
        const index = typeof value === 'number' ? value : VARIANT_GEMS.indexOf(value);
        if (!Number.isInteger(index) || index < 0 || index > 5) return false;
        const node = this.stage!.querySelector<HTMLElement>(`[data-confirmed-gem="${i}"]`)!;
        node.classList.remove('searching');
        await this.animate(node, [{transform:'rotateY(0) translateY(-4px)'},{transform:'rotateY(90deg) translateY(-15px)'},{transform:'rotateY(180deg) translateY(0)'}], 220, token);
        if (!this.owns(token)) return false;
        node.style.setProperty('--gem-color', colors[index]); node.innerHTML = '<span class="confirmed-cut-gem" aria-hidden="true">◆</span>';
        node.dataset.revealed = 'true'; node.dataset.gem = String(index); node.setAttribute('aria-label', VARIANT_GEM_NAMES[index]);
        await this.wait(100, token);
      }
      await this.wait(180, token);
    } else {
      if (this.op?.action !== 'move' || !this.op.picks?.length) { await this.wait(250, token); return false; }
      const keys = this.game === 'variant-keys', cells = keys ? v?.rows?.flat() : v?.cells;
      const indices = keys ? this.op.picks.map(col => ((this.prior?.view.variant as any)?.steps ?? 0) * 4 + col) : this.op.picks;
      const nodes = indices.map(index => this.stage!.querySelector<HTMLElement>(`[data-confirmed-cell="${index}"]`));
      await Promise.all(nodes.map(node => node ? this.animate(node, [{transform:'rotateY(0) scale(1)'},{transform:'rotateY(90deg) scale(.85)'},{transform:'rotateY(180deg) scale(1)'}], 420, token) : Promise.resolve()));
      if (!this.owns(token) || !Array.isArray(cells)) return false;
      for (const [i, index] of indices.entries()) {
        const node = nodes[i]; if (!node) continue;
        const cell = cells[index], lost = cell === 'mine' || cell === 'trap';
        node.innerHTML = `${lost ? '✹' : '◆'}<small>${index+1}</small>`;
        node.classList.remove('opening'); node.classList.add(lost ? 'trap' : 'safe'); node.dataset.revealed = 'true';
        node.setAttribute('aria-label', tr`Ячейка ${index+1}: ${lost ? translateText('ловушка') : translateText('безопасная')}`);
      }
      await this.wait(180, token);
    }
    return this.owns(token);
  }
  private die(value: number) {
    const positions: Record<number, number[]> = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
    return `<span class="confirmed-pips" aria-hidden="true">${Array.from({length:9}, (_, i) => `<i class="${positions[value].includes(i) ? 'pip' : ''}"></i>`).join('')}</span>`;
  }
  private wait(duration: number, token: number) {
    if (!this.owns(token)) return Promise.resolve();
    return new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.waits.delete(finish); resolve(); };
      const timer = window.setTimeout(finish, duration); this.waits.add(finish);
    });
  }
  private animate(node: HTMLElement, frames: Keyframe[], duration: number, token: number) {
    if (!this.owns(token)) return Promise.resolve();
    return new Promise<void>(resolve => {
      let animation: Animation | undefined;
      const finish = () => { clearTimeout(timer); if (animation) { this.animations.delete(animation); animation.cancel(); } this.waits.delete(finish); resolve(); };
      const timer = window.setTimeout(finish, duration + 180); this.waits.add(finish);
      try { animation = node.animate(frames, {duration,easing:'ease-out'}); this.animations.add(animation); animation.finished.then(finish, finish); }
      catch { finish(); }
    });
  }
  private stop() {
    clearTimeout(this.watchdog); this.watchdog = undefined;
    for (const finish of [...this.waits]) finish();
    for (const animation of this.animations) animation.cancel();
    this.animations.clear(); this.stage?.querySelectorAll('.rolling,.searching,.opening').forEach(node => node.classList.remove('rolling','searching','opening'));
  }
  private cancel(render = true) {
    if (!this.active) return;
    this.epoch++; this.stop(); this.active = false; this.stage = undefined; delete this.host.dataset.motionPhase;
    if (render && this.alive) this.render();
  }
  destroy() {
    this.alive = false; this.cancel(false); resetGameOutcomes(this.host);
    document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.preferences); demoWallet.removeEventListener('change', this.accountChange);
  }
}
