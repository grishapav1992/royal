import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, type StudioSlotView } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { NeonReels, neonSymbol, NEON_SYMBOL_NAMES } from './NeonReels';
import './neon-slot.css';

const GAME = 'studio-neon-crown' as const;
const INITIAL_GRID = [0, 1, 2, 1, 2, 0, 2, 0, 1];
const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
type LiveSpin = { token: string; account: string; operationId: string; accepted: boolean; motion: boolean; balance: number };
type NeonSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };

/** Persistent presentation of an existing server-settled slot. No client outcome generation. */
export class NeonSlotUI {
  private root: HTMLElement;
  private reels: NeonReels;
  private audio = gameAudio.createSlotAudio(GAME);
  private owner = client.accountId;
  private stake = '1000';
  private stakeChosen = false;
  private presentedId = '';
  private live?: LiveSpin;
  private destroyed = false;
  private localError = '';
  private payoutFrame = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private removePreferences: () => void;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancelPresentation(); this.sync(); };
  private motionChange = () => { if (this.live) this.cancelPresentation(); else this.audio.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement) {
    this.host.innerHTML = this.markup(); this.root = this.host.querySelector('[data-neon-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new NeonReels(this.find('[data-neon-reels]'), {
      phase: phase => { if (this.live) { this.setPhase(phase); this.updateControls(); } },
      stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); },
    });
    this.find<HTMLButtonElement>('[data-neon-spin]').addEventListener('click', () => void this.spin());
    this.find<HTMLButtonElement>('[data-neon-retry]').addEventListener('click', () => void this.retry());
    this.find<HTMLButtonElement>('[data-neon-refresh]').addEventListener('click', () => void this.refresh());
    this.find<HTMLSelectElement>('[data-neon-stake]').addEventListener('change', event => {
      if (this.blocked()) return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.updateControls(); this.updateRules();
    });
    this.find<HTMLButtonElement>('[data-neon-mute]').addEventListener('click', () => gameAudio.setMuted(!gameAudio.getPreferences().muted));
    this.find<HTMLInputElement>('[data-neon-volume]').addEventListener('input', event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100));
    this.find('[data-neon-line-list]').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-neon-line-button]');
      if (button && !this.live) this.highlightLine(Number(button.dataset.neonLineButton));
    });
    this.removePreferences = gameAudio.onPreferences(() => this.updateAudio()); this.updateAudio(); this.updateRules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change);
    document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void client.refresh();
  }

  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }

  private markup() {
    const lines = STUDIO_INFO[GAME].paylines;
    return tr`<section class="neon-slot" data-neon-slot="${GAME}" data-studio-game="${GAME}" data-phase="idle" data-neon-state="idle" data-session-id="" aria-label="Неоновый трон">
      <header class="neon-header"><div class="neon-title"><span>ROYAL STUDIO</span><h3>Неоновый трон</h3><p>Три барабана. Пять линий. Твой момент.</p></div><div class="neon-balance"><small>Монеты клуба</small><strong data-neon-balance data-studio-balance>…</strong></div></header>
      <div class="neon-cabinet"><div class="neon-lounge" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="neon-crown-logo" aria-hidden="true">${neonSymbol(3)}</div><div class="neon-machine-top"><span class="neon-machine-brand">NEON CROWN</span><span class="neon-five">5 ЛИНИЙ</span></div>
        <div class="neon-frame"><div class="neon-line-markers" aria-hidden="true"><i>2</i><i>1</i><i>3</i></div><div class="neon-reels" data-neon-reels role="group" aria-label="Три барабана, три ряда"><svg class="neon-lines" data-neon-lines viewBox="0 0 300 300" preserveAspectRatio="none" aria-hidden="true"></svg></div><div class="neon-line-markers right" aria-hidden="true"><i>2</i><i>1</i><i>3</i></div></div>
        <div class="neon-result studio-stage-payout"><span class="neon-result-caption" data-neon-result-caption>Поймай светящуюся линию</span><strong data-neon-payout data-units="0" data-target-units="0"><span data-neon-amount>0,00</span><small> монет</small></strong><span class="neon-bigwin" data-neon-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="neon-console"><label class="neon-stake">Ставка за спин<select data-neon-stake data-stake>${DEMO_BETS.map(value => `<option value="${value * 100}">${amount(value * 100)}</option>`).join('')}</select></label><button type="button" class="neon-spin" data-neon-spin data-start aria-label="Вращать барабаны"><span class="neon-spin-ring" aria-hidden="true"></span><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span class="neon-spin-label">ВРАЩАТЬ</span></button><div class="neon-last"><small>Пять активных линий</small><strong data-neon-win-multiple>WILD заменяет знаки</strong></div></div>
      </div>
      <div class="neon-line-list" data-neon-line-list aria-label="Выигрышные линии"></div>
      <p class="neon-status" data-neon-status role="status">Выбери ставку и вращай барабаны.</p><p class="neon-error studio-error" data-neon-error role="alert"></p>
      <div class="neon-tools"><div class="neon-audio"><button type="button" data-neon-mute aria-label="Выключить звук" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-neon-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-neon-volume aria-label="Громкость игры"></label></div><div class="neon-network"><button type="button" data-neon-retry data-retry hidden>Проверить ход</button><button type="button" data-neon-refresh data-refresh>Обновить</button></div></div>
      <details class="neon-rules"><summary>Правила, символы и линии</summary><p>Ставка оплачивает все пять линий. Три одинаковых обычных знака слева направо дают выплату. WILD заменяет обычный знак; на каждой линии оплачивается лучшая комбинация. Звезда и монета в этом слоте не дают отдельной выплаты. Бонусных ходов нет.</p><div class="neon-paytable" data-neon-paytable></div><div class="neon-rule-lines">${lines.map((line, index) => tr`<div><span>Линия ${index + 1}</span><svg viewBox="0 0 100 60" aria-hidden="true">${Array.from({ length: 9 }, (_, cell) => `<circle cx="${15 + cell % 3 * 35}" cy="${10 + Math.floor(cell / 3) * 20}" r="3"/>`).join('')}<polyline points="${line.map((row, col) => `${15 + col * 35},${10 + row * 20}`).join(' ')}"/></svg></div>`).join('')}</div><p data-neon-rtp></p><p>Множитель включает ставку. Каждая выплата округляется вниз до 0,01 монеты, затем выплаты линий суммируются. Результат и баланс сохраняются на сервере. «Проверить ход» подтверждает прежнюю операцию без новой ставки.</p></details><p class="neon-demo-note">Игра на тестовые монеты клуба</p>
    </section>`;
  }

  private currentSession(): NeonSession | undefined {
    const session = client.sessions.find(value => value.gameId === GAME);
    return session?.view.studio?.kind === 'slot' ? session as NeonSession : undefined;
  }

  private blocked() {
    return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden;
  }

  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }

  private sync() {
    if (this.destroyed) return;
    if (this.owner !== client.accountId) {
      this.cancelPresentation(); this.owner = client.accountId; this.presentedId = ''; this.localError = ''; this.stake = '1000'; this.stakeChosen = false;
      this.root.dataset.sessionId = ''; this.reels.show(INITIAL_GRID); this.clearWins(); this.setPayout(0, 0); this.setPhase('idle');
      this.find('[data-neon-result-caption]').textContent = translateText('Поймай светящуюся линию'); this.find('[data-neon-win-multiple]').textContent = translateText('WILD заменяет знаки'); this.updateRules();
    }
    const session = this.currentSession();
    observeExpansionOutcome(this.root, GAME, session, client.accountId, true, !!this.live && client.pending?.gameId === GAME);
    if (this.live) {
      if (this.live.accepted && session?.id !== this.live.operationId) this.cancelPresentation();
    }
    if (this.live) {
      if (!this.live.operationId && client.pending?.gameId === GAME && client.pending.action === 'start') this.live.operationId = client.pending.id;
      if (!client.busy && !client.pending && !this.live.accepted) {
        if (session?.id === this.live.operationId) { this.live.accepted = true; void this.present(session, this.live); }
        else this.cancelPresentation();
      } else if (!client.busy && client.pending && !this.live.accepted) this.cancelPresentation();
    }
    if (!this.live && session && this.presentedId !== session.id) this.presentStatic(session);
    if (!this.live && client.pending) this.setPhase('uncertain');
    if (client.pending?.gameId === GAME && client.pending.action === 'start' && this.stake !== client.pending.stakeUnits) {
      this.stake = client.pending.stakeUnits; this.stakeChosen = true; this.updateRules();
    }
    this.updateControls();
  }

  private setPhase(phase: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'result' | 'uncertain') {
    this.root.dataset.phase = phase;
    this.root.dataset.neonState = phase === 'accelerating' ? 'requesting' : phase === 'stopping' ? 'settling' : phase === 'result' ? this.live ? 'presenting' : 'idle' : phase === 'uncertain' ? 'error' : phase;
  }

  private updateControls() {
    const balance = this.balance(), ready = !!client.accountId && balance !== undefined, blocked = this.blocked();
    const shownBalance = this.live && this.root.dataset.phase !== 'result' ? this.live.balance : balance;
    this.find('[data-neon-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    this.find<HTMLSelectElement>('[data-neon-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-neon-stake]').disabled = blocked;
    this.find<HTMLButtonElement>('[data-neon-spin]').disabled = blocked || !ready || Number(this.stake) > (balance ?? 0) * 100;
    const retry = this.find<HTMLButtonElement>('[data-neon-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-neon-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = translateText('Выбери ставку и вращай барабаны.');
    if (!client.accountId) status = translateText('Войди в аккаунт, чтобы играть на монеты клуба.');
    else if (!ready) status = translateText('Загружаем баланс…');
    else if (client.pending && !client.busy) status = translateText('Ответ ещё не подтверждён. «Проверить ход» продолжит ту же операцию.');
    else if (client.busy && !this.live) status = translateText('Проверяем сохранённый ход…');
    else if (this.live && !this.live.accepted) status = translateText('Барабаны вращаются. Ждём подтверждение спина…');
    else if (this.live && this.root.dataset.phase !== 'result') status = translateText('Барабаны останавливаются…');
    else if (this.presentedId) status = this.find('[data-neon-result-caption]').textContent || status;
    if (demoWallet.pending || demoWallet.busy || demoWallet.hasExternalBusy('expansion')) status = translateText('Дождись завершения операции в кошельке клуба.');
    this.find('[data-neon-status]').textContent = status;
    this.find('[data-neon-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(); if (this.blocked() || !client.accountId || balance === undefined || Number(this.stake) > balance * 100) return;
    this.localError = ''; this.clearWins(); this.setPayout(0, 0); this.find('[data-neon-result-caption]').textContent = translateText('Твой момент…');
    const live: LiveSpin = { token: crypto.randomUUID(), account: client.accountId, operationId: '', accepted: false, motion: !this.reduced.matches, balance };
    this.live = live; observeExpansionOutcome(this.root, GAME, this.currentSession(), client.accountId, true, true); this.root.dataset.animationToken = live.token; this.setPhase(live.motion ? 'accelerating' : 'spinning');
    this.reels.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion }); this.updateControls();
    try { await client.act({ gameId: GAME, action: 'start', stakeUnits: this.stake, settings: structuredClone(STUDIO_DEFAULTS[GAME]) }); }
    catch (error) { if (!this.destroyed && client.accountId === live.account) this.localError = (error as Error).message; }
    if (!this.destroyed) this.sync();
  }

  private async retry() {
    if (this.destroyed || this.live || client.busy || !client.pending || !client.accountId || document.hidden) return;
    this.localError = '';
    try { await client.retry(); } catch (error) { if (!this.destroyed) this.localError = (error as Error).message; }
    if (!this.destroyed) this.sync();
  }

  private async refresh() {
    if (this.destroyed || this.live || client.busy || client.loading) return; this.localError = '';
    const request = client.refresh(); this.updateControls(); await request; if (!this.destroyed) this.sync();
  }

  private async present(session: NeonSession, live: LiveSpin) {
    const completed = await this.reels.settle(live.token, session.view.studio.grid);
    if (!completed || this.live !== live || this.destroyed || client.accountId !== live.account || document.hidden) return;
    this.presentedId = session.id; this.root.dataset.sessionId = session.id; this.setPhase('result');
    this.showResult(session, live.motion);
    const payout = Number(session.returnedUnits), stake = Number(session.stakeUnits);
    const outcome = () => this.audio.outcome(live.token, payout >= stake * 4 ? 'bigwin' : payout > stake ? 'win' : payout > 0 ? 'return' : 'loss');
    if (!live.motion) { outcome(); this.live = undefined; this.root.dataset.animationToken = ''; this.setPhase('result'); this.updateControls(); observeExpansionOutcome(this.root, GAME, session, client.accountId, false, false); return; }
    const wins = session.view.studio.wins;
    wins.forEach((win, index) => this.later(() => {
      if (this.live !== live) return; this.highlightLine(win.line ?? 0); this.audio.line(live.token, win.line ?? 0);
    }, index * 330));
    this.later(() => { if (this.live === live) outcome(); }, wins.length * 330);
    const began = performance.now(), duration = payout > 0 ? 1000 : 250;
    const count = (now: number) => {
      if (this.live !== live) return;
      const progress = Math.max(0, Math.min(1, (now - began) / duration)), shown = Math.floor(payout * (1 - (1 - progress) ** 3));
      this.setPayout(shown, payout); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0;
    };
    this.payoutFrame = requestAnimationFrame(count);
    this.later(() => {
      if (this.live !== live) return; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(payout, payout); this.highlightLine(); this.root.classList.remove('neon-celebrating');
      this.live = undefined; this.root.dataset.animationToken = ''; this.setPhase('result'); this.updateControls();
      if (!this.destroyed && !document.hidden && client.accountId === live.account) observeExpansionOutcome(this.root, GAME, session, client.accountId, false, false);
    }, Math.max(duration, wins.length * 330 + 200));
    this.updateControls();
  }

  private presentStatic(session: NeonSession) {
    this.presentedId = session.id; this.root.dataset.sessionId = session.id; this.setPhase('result');
    if (!this.stakeChosen) this.stake = session.stakeUnits;
    this.reels.show(session.view.studio.grid); this.showResult(session, false); this.updateRules();
  }

  private showResult(session: NeonSession, animate: boolean) {
    this.clearWins(); const payout = Number(session.returnedUnits), stake = Number(session.stakeUnits), wins = session.view.studio.wins;
    this.setPayout(animate ? 0 : payout, payout);
    const label = payout >= stake * 4 ? translateText('Крупный выигрыш!') : payout > stake ? translateText('Твоя светящаяся комбинация!') : payout > 0 ? translateText('Выплата за спин') : translateText('Новый спин, новый шанс');
    this.find('[data-neon-result-caption]').textContent = label;
    this.find('[data-neon-win-multiple]').textContent = payout > 0 ? tr`${number(payout / stake)}× за спин` : translateText('Пять линий ждут тебя');
    this.find('[data-neon-bigwin]').hidden = payout < stake * 4; this.root.classList.toggle('neon-celebrating', animate && payout >= stake * 4);
    const winning = new Set(wins.flatMap(win => win.positions));
    this.root.querySelectorAll<HTMLElement>('[data-neon-cell]').forEach(cell => {
      const index = Number(cell.dataset.neonCell); cell.classList.toggle('win', winning.has(index));
      if (winning.has(index)) cell.setAttribute('aria-label', tr`${cell.getAttribute('aria-label')}, участвует в выигрыше`);
    });
    this.find('[data-neon-lines]').innerHTML = wins.map(win => `<polyline data-line="${win.line ?? 0}" points="${win.positions.map(index => `${(index % 3 + .5) * 100},${(Math.floor(index / 3) + .5) * 100}`).join(' ')}"/>`).join('');
    this.find('[data-neon-line-list]').innerHTML = wins.map(win => tr`<button type="button" data-neon-line-button="${win.line ?? 0}"><span>Линия ${(win.line ?? 0) + 1}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join('');
    this.highlightLine();
  }

  private highlightLine(line?: number) {
    const wins = this.currentSession()?.id === this.presentedId ? this.currentSession()!.view.studio.wins : [];
    const positions = new Set(wins.filter(win => line === undefined || win.line === line).flatMap(win => win.positions));
    this.root.querySelectorAll<HTMLElement>('[data-neon-cell]').forEach(cell => cell.classList.toggle('active-win', line !== undefined && positions.has(Number(cell.dataset.neonCell))));
    this.root.querySelectorAll<SVGElement>('[data-neon-lines] polyline').forEach(path => path.classList.toggle('active', line === undefined || Number(path.dataset.line) === line));
    this.root.querySelectorAll<HTMLButtonElement>('[data-neon-line-button]').forEach(button => button.setAttribute('aria-pressed', String(line !== undefined && Number(button.dataset.neonLineButton) === line)));
  }

  private clearWins() {
    this.root.classList.remove('neon-celebrating'); this.find('[data-neon-bigwin]').hidden = true;
    this.root.querySelectorAll<HTMLElement>('[data-neon-cell]').forEach(cell => { cell.classList.remove('win', 'active-win'); cell.setAttribute('aria-label', tr`Ячейка ${Number(cell.dataset.neonCell) + 1}: ${NEON_SYMBOL_NAMES[Number(cell.dataset.symbol)]}`); });
    this.find('[data-neon-lines]').replaceChildren(); this.find('[data-neon-line-list]').replaceChildren();
  }

  private setPayout(units: number, target: number) {
    const payout = this.find('[data-neon-payout]'); this.find('[data-neon-amount]').textContent = amount(units); payout.dataset.units = String(units); payout.dataset.targetUnits = String(target);
  }

  private updateRules() {
    this.find('[data-neon-paytable]').innerHTML = studioSlotPaytable(GAME).map(row => `<div>${neonSymbol(row.symbol)}<span>${NEON_SYMBOL_NAMES[row.symbol]}</span><strong>${number(row.pays[0].multiplier)}×</strong></div>`).join('');
    this.find('[data-neon-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} монет: ${number(studioSlotRtp(GAME, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии спинов.`;
  }

  private updateAudio() {
    const preferences = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-neon-mute]');
    button.setAttribute('aria-pressed', String(preferences.muted)); button.setAttribute('aria-label', preferences.muted ? translateText('Включить звук') : translateText('Выключить звук'));
    this.find('[data-neon-audio-label]').textContent = preferences.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-neon-volume]').value = String(Math.round(preferences.volume * 100));
  }

  private later(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.add(timer); }

  private cancelPresentation() {
    resetGameOutcomes(this.root);
    this.audio.cancel(this.live?.token); this.live = undefined; this.root.dataset.animationToken = ''; this.reels.cancel();
    this.setPhase('idle');
    cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach(timer => clearTimeout(timer)); this.timers.clear();
    this.root.classList.remove('neon-celebrating'); this.presentedId = '';
  }

  destroy() {
    if (this.destroyed) return; this.destroyed = true; this.cancelPresentation(); this.reels.destroy(); this.audio.dispose(); this.removePreferences();
    client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change);
    document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren();
  }
}
