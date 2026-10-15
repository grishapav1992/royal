import { observeExpansionOutcome } from './gameReactions';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { CascadeBoard } from './CascadeBoard';
import { cascadeSymbol, CASCADE_NAMES, type CascadeGame } from './CascadeArtwork';
import './cascade-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number; before: number[] };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class CascadeSlotUI {
  private root: HTMLElement; private board: CascadeBoard; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: CascadeGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-studio-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.board = new CascadeBoard(this.find('[data-slot-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-slot-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-slot-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-slot-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-slot-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-slot-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-slot-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-cascade-group-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-cascade-group-button]'); if (button && !this.live) this.highlight(Number(button.dataset.cascadeGroupButton)); };
    this.find('[data-slot-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-slot-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.slotFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'waiting' | 'removing' | 'dropping' | 'refilling' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.slotState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info = STUDIO_INFO[this.game], candy = this.game === 'studio-caramel-carnival';
    return `<section class="cascade-game ${candy ? 'cascade-candy' : 'cascade-oracle'}" data-cascade-game="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-slot-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="cascade-heading"><div><span>ROYAL STUDIO</span><h3>${info.name}</h3><p>${candy ? 'Сладкие совпадения. Новые каскады.' : 'Созвездия совпадений и светящиеся сферы'}</p></div><div class="cascade-balance"><small>Монеты клуба</small><strong data-slot-balance data-studio-balance>…</strong></div></header>
      <div class="cascade-cabinet"><div class="cascade-scenery" aria-hidden="true"><i></i><i></i><i></i></div><div class="cascade-marquee"><span>${candy ? 'CARAMEL CARNIVAL' : 'STARFALL ORACLE'}</span><small>8+ СОВПАДЕНИЙ</small></div>
        <div class="cascade-frame"><div class="cascade-grid" data-slot-reels data-cascade-grid role="group" aria-label="Шесть барабанов, пять рядов"></div></div>
        <div class="cascade-feature" data-slot-feature role="status"><span data-cascade-feature-text>От восьми одинаковых знаков в любом месте</span><span class="cascade-orbs" data-cascade-orbs ${candy ? 'hidden' : ''}>Сферы <b data-cascade-factor>×1</b></span></div>
        <div class="cascade-result studio-stage-payout"><span data-slot-caption>Поймай свою комбинацию</span><strong data-slot-payout data-units="0" data-target-units="0"><span data-slot-amount>0,00</span><small> монет</small></strong><span class="cascade-bigwin" data-slot-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="cascade-console"><label>Ставка за раунд<select data-slot-stake data-stake>${DEMO_BETS.map(value => `<option value="${value * 100}">${amount(value * 100)}</option>`).join('')}</select></label><button type="button" class="cascade-spin" data-slot-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-slot-spin-label>ВРАЩАТЬ</span></button><div class="cascade-round-info"><small data-slot-bonus>Совпадения от восьми</small><strong data-slot-multiple>Одна ставка за раунд</strong></div></div>
      </div><div class="cascade-history" data-slot-history aria-label="Сохранённые этапы раунда"></div><div class="cascade-group-list" data-cascade-group-list aria-label="Выплаты групп"></div>
      <p class="cascade-status" data-slot-status role="status"></p><p class="cascade-error studio-error" data-slot-error role="alert"></p>
      <div class="cascade-tools"><div class="cascade-audio"><button type="button" data-slot-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-slot-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-slot-volume aria-label="Громкость игры"></label></div><div><button type="button" data-slot-retry data-retry hidden>Проверить ход</button><button type="button" data-slot-refresh data-refresh>Обновить</button></div></div>
      <details class="cascade-rules"><summary>Правила, символы и каскады</summary><p>От восьми одинаковых обычных знаков в любой части поля дают выплату. Знаки могут стоять отдельно друг от друга. После совпадения они исчезают, оставшиеся падают вниз, сверху приходят новые. Раунд содержит основной спин и максимум два бесплатных каскада. Каскад без совпадений завершает раунд раньше. Накопленное начисляется после окончания всего раунда.</p>${candy ? '<p>Карамельные монеты остаются на поле и не имеют отдельной выплаты.</p>' : '<p>Сферы остаются на поле, падают вместе с другими знаками и усиливают каждую совпавшую группу текущего этапа. Множитель равен одному плюс число сфер во всём текущем поле. Он уже включён в показанные выплаты и не умножает ставку отдельно.</p>'}<div class="cascade-paytable" data-slot-paytable></div><p data-slot-rtp></p><p>Базовые множители в таблице показаны ${candy ? 'за группу' : 'без усиления сферами'}. Ставка указана за весь раунд. Множитель включает ставку. Каждая выплата округляется вниз до 0,01 монеты, затем выплаты суммируются. «Проверить ход» подтверждает прежнюю операцию.</p></details><p class="cascade-demo-note">Игра на тестовые монеты клуба</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.beforeGrid; delete this.root.dataset.cascadeTrace; this.root.dataset.orbFactor = '1'; this.find('[data-cascade-factor]').textContent = '×1'; this.find('[data-cascade-feature-text]').textContent = 'От восьми одинаковых знаков в любом месте'; this.board.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / 6)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-slot-caption]').textContent = 'Поймай свою комбинацию'; this.find('[data-slot-multiple]').textContent = 'Совпадения от восьми'; this.find('[data-slot-history]').replaceChildren(); this.rules(); }
    const session = this.session();
    observeExpansionOutcome(this.root, this.game, session, client.accountId, client.busy, client.pending?.gameId === this.game);
    if (this.live?.accepted && (!session || this.key(session) !== this.live.acceptedKey)) this.cancel();
    if (this.live) {
      if (!this.live.operationId && client.pending?.gameId === this.game && client.pending.action === this.live.kind) this.live.operationId = client.pending.id;
      if (!client.busy && !client.pending && !this.live.accepted) {
        const expectedId = this.live.kind === 'start' ? this.live.operationId : this.live.expectedSession;
        if (session?.id === expectedId && session.view.studio.step === this.live.expectedStep) { this.live.accepted = true; this.live.acceptedKey = this.key(session); void this.present(session, this.live); }
        else this.cancel();
      } else if (!client.busy && client.pending && !this.live.accepted) this.cancel();
    }
    if (!this.live && session && this.key(session) !== this.presentedKey) this.static(session);
    if (!this.live && client.pending) this.phase('uncertain');
    if (client.pending?.gameId === this.game && client.pending.action === 'start' && this.stake !== client.pending.stakeUnits) { this.stake = client.pending.stakeUnits; this.stakeChosen = true; this.rules(); }
    this.controls();
  }

  private controls() {
    const session = this.session(), active = session?.state === 'active', balance = this.balance(), ready = !!client.accountId && balance !== undefined, blocked = this.blocked();
    const shownBalance = this.live && this.root.dataset.phase !== 'result' ? this.live.balance : balance;
    this.find('[data-slot-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-slot-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-slot-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-slot-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-slot-spin-label]').textContent = active ? 'КАСКАД' : 'ВРАЩАТЬ'; spin.setAttribute('aria-label', active ? `Продолжить каскад, осталось ${session.view.studio.remaining}` : 'Вращать барабаны');
    this.find('[data-slot-bonus]').textContent = active ? `Каскадов осталось: ${session.view.studio.remaining}` : 'Совпадения от восьми';
    const retry = this.find<HTMLButtonElement>('[data-slot-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-slot-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = 'Выбери ставку и вращай барабаны.';
    if (!client.accountId) status = 'Войди в аккаунт, чтобы играть на монеты клуба.';
    else if (!ready) status = 'Загружаем баланс…';
    else if (client.pending && !client.busy) status = 'Ход ещё не подтверждён. Проверь ту же операцию без новой ставки.';
    else if (client.busy && !this.live) status = 'Проверяем сохранённый ход…';
    else if (this.live) status = ['removing','dropping','refilling'].includes(this.root.dataset.phase ?? '') ? 'Каскад открывает новые совпадения…' : this.live.accepted ? 'Показываем сохранённый результат…' : this.live.kind === 'move' ? 'Подтверждаем бесплатный каскад…' : 'Барабаны вращаются. Ждём подтверждение…';
    else if (active) status = 'Бонус сохранён. Продолжи бесплатно, чтобы получить общую выплату.';
    else if (this.presentedKey) status = 'Раунд завершён. Выплата начислена.';
    if (demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion')) status = 'Дождись завершения операции в кошельке клуба.';
    this.find('[data-slot-status]').textContent = status; this.find('[data-slot-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.board.show(session.view.studio.grid);
    
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance, before: session ? [...session.view.studio.grid] : [] };
    this.live = live; this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; delete this.root.dataset.beforeGrid; delete this.root.dataset.cascadeTrace; this.phase(active ? 'waiting' : live.motion ? 'accelerating' : 'spinning'); if (active) this.audio.beginCascade(live.token, { motion: live.motion }); else { this.board.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion }); } this.controls();
    try { await client.act(active ? { gameId: this.game, action: 'move', sessionId: session.id, move: 'studio-spin' } : { gameId: this.game, action: 'start', stakeUnits: this.stake, settings: structuredClone(STUDIO_DEFAULTS[this.game]) }); }
    catch (error) { if (!this.destroyed && client.accountId === live.account) this.localError = (error as Error).message; }
    if (!this.destroyed) this.sync();
  }
  private async retry() { if (this.destroyed || this.live || client.busy || !client.pending || document.hidden) return; this.localError = ''; try { await client.retry(); } catch (error) { if (!this.destroyed) this.localError = (error as Error).message; } if (!this.destroyed) this.sync(); }
  private async refresh() { if (this.destroyed || this.live || client.busy || client.loading) return; this.localError = ''; const request = client.refresh(); this.controls(); await request; if (!this.destroyed) this.sync(); }

  private async presentation(session: SlotSession, live: LiveStage): Promise<StudioSlotPresentation | undefined> {
    const controller = new AbortController(); this.fetchAbort = controller;
    try {
      const query = new URLSearchParams({ sessionId: session.id, phase: String(session.view.phase), step: String(session.view.studio.step) });
      const response = await fetch(`/api/demo-wallet/expansion/presentation?${query}`, { credentials: 'same-origin', cache: 'no-store', headers: { [WALLET_ACCOUNT_HEADER]: live.account }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
      if (!response.ok) return; const metadata: unknown = await response.json();
      if (this.live !== live || client.accountId !== live.account || this.session()?.id !== session.id || this.session()?.view.studio.step !== session.view.studio.step) return;
      return validStudioSlotPresentation(metadata, this.game, session.id, session.view.phase, session.view.studio) ? metadata : undefined;
    } catch { return; } finally { if (this.fetchAbort === controller) this.fetchAbort = undefined; }
  }

  private async present(session: SlotSession, live: LiveStage) {
    const metadata = live.motion ? await this.presentation(session, live) : undefined;
    if (this.live !== live || this.destroyed || document.hidden) return;
    this.root.dataset.presentation = metadata ? 'available' : 'static';
    if (metadata) { this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid); this.root.dataset.cascadeTrace = JSON.stringify(metadata.cascade); }
    if (live.kind === 'start') {
      const complete = await this.board.settle(live.token, session.view.studio.grid);
      if (!complete || this.live !== live || this.destroyed || document.hidden) return;
    } else {
      const cascade = metadata?.cascade;
      const uninterrupted = cascade && cascade.fromStep === session.view.studio.step - 1 && metadata.beforeGrid.length === live.before.length && metadata.beforeGrid.every((symbol, index) => symbol === live.before[index]);
      if (live.motion && uninterrupted) {
        this.audio.confirmCascade(live.token);
        this.phase('removing'); this.board.remove(cascade.removedPositions); this.audio.effect(live.token, 'collapse', `${session.id}:${metadata.step}:collapse`); this.controls();
        if (!await this.delay(280, live)) return;
        this.phase('dropping'); this.board.drops(cascade.drops); this.board.animateDrops(); this.audio.effect(live.token, 'drop', `${session.id}:${metadata.step}:drop`); this.controls();
        if (!await this.delay(430, live)) return;
        this.phase('refilling'); this.board.refills(cascade.refills); this.board.animateRefills(); this.audio.effect(live.token, 'refill', `${session.id}:${metadata.step}:refill`); this.controls();
        if (!await this.delay(650, live)) return;
      }
      this.board.show(session.view.studio.grid); this.board.clearOverlay(); this.audio.settleCascade(live.token);
    }
    if (this.live !== live) return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.phase('result'); this.showResult(session, -1, live.motion, from); this.history(session);
    const wins = this.shownFrame!.wins;
    if (this.game === 'studio-starfall-oracle' && (metadata?.cascade?.orbFactor ?? 1) > 1) this.audio.effect(live.token, 'orb', `${session.id}:${session.view.studio.step}:orb`);
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!live.motion) { outcome(); this.finish(live, total); return; }
    wins.forEach((win, index) => this.schedule(() => {
      if (this.live !== live) return; this.highlight(index); this.audio.group(live.token, index);
      this.find('[data-cascade-feature-text]').textContent = `${CASCADE_NAMES[this.game][win.symbol]}: ${win.count} совпадений`;
    }, index * 330));
    this.schedule(() => { if (this.live === live) outcome(); }, wins.length * 330);
    const began = performance.now();
    const count = (now: number) => { if (this.live !== live) return; const progress = Math.max(0, Math.min(1, (now - began) / 1000)); this.setPayout(from + Math.floor((total - from) * (1 - (1 - progress) ** 3)), total); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0; };
    this.payoutFrame = requestAnimationFrame(count); this.schedule(() => this.finish(live, total), Math.max(1000, wins.length * 330 + 200)); this.controls();
  }

  private finish(live: LiveStage, total: number) { if (this.live !== live) return; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); }
  private static(session: SlotSession, index = -1) { this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.root.dataset.presentation = 'static'; this.phase('result'); if (!this.stakeChosen || session.state === 'active') this.stake = session.stakeUnits; this.board.show((index < 0 ? session.view.studio : session.view.studio.history[index]).grid);  this.showResult(session, index, false); this.history(session); this.rules(); this.controls(); }
  private showResult(session: SlotSession, index: number, animate: boolean, initialPayout = 0) {
    this.clearWins(); const view = session.view.studio, frame = index < 0 ? view.history.at(-1)! : view.history[index]; this.shownFrame = frame; this.shownSession = session; this.shownIndex = index; this.root.dataset.frameIndex = String(index < 0 ? view.step : index);
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits); this.setPayout(animate ? initialPayout : total, total);
    this.find('[data-slot-caption]').textContent = session.state === 'active' ? 'Накоплено за раунд' : 'Начислено за раунд'; this.find('[data-slot-multiple]').textContent = total ? `${number(total / stake)}× за раунд` : 'Совпадения от восьми';
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-slot-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    const orbFactor = this.game === 'studio-starfall-oracle' ? 1 + frame.grid.filter(symbol => symbol === 5).length : 1;
    this.root.dataset.orbFactor = String(orbFactor); this.find('[data-cascade-factor]').textContent = `×${orbFactor}`;
    this.find('[data-cascade-feature-text]').textContent = index < 0 ? 'От восьми одинаковых знаков в любом месте' : `Этап ${index + 1}: +${amount(frame.payoutUnits)} монет`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-slot-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.slotCell))));
    this.find('[data-cascade-group-list]').innerHTML = frame.wins.map((win, winIndex) => `<button type="button" data-cascade-group-button="${winIndex}"><span>${CASCADE_NAMES[this.game][win.symbol]} · ${win.count}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join(''); this.highlight();
  }
  private highlight(winIndex?: number) { const positions = new Set(winIndex === undefined ? [] : this.shownFrame?.wins[winIndex]?.positions ?? []); this.root.querySelectorAll<HTMLElement>('[data-slot-cell]').forEach(cell => cell.classList.toggle('active-win', positions.has(Number(cell.dataset.slotCell)))); this.root.querySelectorAll<HTMLButtonElement>('[data-cascade-group-button]').forEach(button => button.setAttribute('aria-pressed', String(winIndex !== undefined && Number(button.dataset.cascadeGroupButton) === winIndex))); }
  private history(session: SlotSession) { this.find('[data-slot-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-slot-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? `Каскад ${index}` : 'Основной'} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-slot-bigwin]').hidden = true; this.root.querySelectorAll<HTMLElement>('[data-slot-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-cascade-group-list]').replaceChildren(); }
  private setPayout(units: number, target: number) { this.find('[data-slot-amount]').textContent = amount(units); const element = this.find('[data-slot-payout]'); element.dataset.units = String(units); element.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-slot-paytable]').innerHTML = studioSlotPaytable(this.game).map(row => `<div>${cascadeSymbol(this.game, row.symbol)}<span>${CASCADE_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => `<small>${pay.count} знака: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-slot-rtp]').textContent = `Расчётный возврат при ставке ${amount(this.stake)} монет: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }
  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-slot-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? 'Включить звук' : 'Выключить звук'); this.find('[data-slot-audio-label]').textContent = prefs.muted ? 'Без звука' : 'Звук'; this.find<HTMLInputElement>('[data-slot-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.board.cancel(); cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.board.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
