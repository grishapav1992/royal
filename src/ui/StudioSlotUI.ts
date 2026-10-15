import { observeExpansionOutcome } from './gameReactions';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { StudioReels } from './StudioReels';
import { slotSymbol, SLOT_SYMBOL_NAMES, type PresentedSlotGame } from './StudioSlotArtwork';
import './studio-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class StudioSlotUI {
  private root: HTMLElement; private reels: StudioReels; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: PresentedSlotGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-studio-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new StudioReels(this.find('[data-slot-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-slot-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-slot-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-slot-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-slot-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-slot-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-slot-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-slot-line-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-slot-line-button]'); if (button && !this.live) this.highlight(Number(button.dataset.slotLineButton)); };
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
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'transforming' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.slotState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info = STUDIO_INFO[this.game], cosmic = this.game === 'studio-cosmic-escape';
    return `<section class="studio-slot slot-${cosmic ? 'cosmic' : 'velvet'}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-slot-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="slot-heading"><div><span>ROYAL STUDIO</span><h3>${info.name}</h3><p>${cosmic ? 'Портал WILD открывает новые горизонты' : 'Закрепляй короны. Усиливай свои линии.'}</p></div><div class="slot-balance"><small>Монеты клуба</small><strong data-slot-balance data-studio-balance>…</strong></div></header>
      <div class="slot-cabinet"><div class="slot-scenery" aria-hidden="true">${cosmic ? '<div class="slot-planet"></div><div class="slot-orbit"></div>' : '<div class="slot-curtain left"></div><div class="slot-curtain right"></div><div class="slot-spotlight"></div>'}</div><div class="slot-marquee"><span>${cosmic ? 'COSMIC ESCAPE' : 'VELVET REIGN'}</span><small>${info.paylines.length} ЛИНИЙ</small></div>
        <div class="slot-frame"><div class="slot-reels" data-slot-reels role="group" aria-label="Пять барабанов, ${info.rows} ряда"><svg class="slot-lines" data-slot-lines viewBox="0 0 ${info.cols * 100} ${info.rows * 100}" preserveAspectRatio="none" aria-hidden="true"></svg></div></div>
        <div class="slot-feature" data-slot-feature role="status">${cosmic ? 'WILD раскрывается на весь барабан' : 'Короны WILD усиливают выигрышные линии'}</div>
        <div class="slot-result studio-stage-payout"><span data-slot-caption>Поймай свою комбинацию</span><strong data-slot-payout data-units="0" data-target-units="0"><span data-slot-amount>0,00</span><small> монет</small></strong><span class="slot-bigwin" data-slot-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="slot-console"><label>Ставка за раунд<select data-slot-stake data-stake>${DEMO_BETS.map(value => `<option value="${value * 100}">${amount(value * 100)}</option>`).join('')}</select></label><button type="button" class="slot-spin" data-slot-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-slot-spin-label>ВРАЩАТЬ</span></button><div class="slot-round-info"><small data-slot-bonus>Все линии активны</small><strong data-slot-multiple>WILD заменяет знаки</strong></div></div>
      </div><div class="slot-history" data-slot-history aria-label="Сохранённые этапы раунда"></div><div class="slot-line-list" data-slot-line-list aria-label="Выплаты линий"></div>
      <p class="slot-status" data-slot-status role="status"></p><p class="slot-error studio-error" data-slot-error role="alert"></p>
      <div class="slot-tools"><div class="slot-audio"><button type="button" data-slot-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-slot-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-slot-volume aria-label="Громкость игры"></label></div><div><button type="button" data-slot-retry data-retry hidden>Проверить ход</button><button type="button" data-slot-refresh data-refresh>Обновить</button></div></div>
      <details class="slot-rules"><summary>Правила, символы и линии</summary><p>${cosmic ? 'WILD заменяет обычные символы и раскрывается на весь свой барабан после остановки.' : 'Короны WILD заменяют обычные символы. На оплаченной цепочке они дают множитель 2×, 3× или 4× по числу WILD, максимум 4×. В бесплатных этапах короны остаются на своих местах.'} Три бонусных знака открывают два бесплатных этапа без новой ставки. Накопленное начисляется после завершения всего раунда.</p><div class="slot-paytable" data-slot-paytable></div><div class="slot-rule-lines">${info.paylines.map((line, index) => `<div><small>${index + 1}</small><svg viewBox="0 0 100 ${info.rows * 20}" aria-hidden="true"><polyline points="${line.map((row, col) => `${10 + col * 20},${10 + row * 20}`).join(' ')}"/></svg></div>`).join('')}</div><p data-slot-rtp></p><p>Ставка указана за все линии и весь раунд. Множитель включает ставку. Каждая выплата округляется вниз до 0,01 монеты, затем выплаты суммируются. «Проверить ход» подтверждает прежнюю операцию. Сохранённые этапы можно посмотреть без новой ставки.</p></details><p class="slot-demo-note">Игра на тестовые монеты клуба</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.beforeGrid; delete this.root.dataset.transformEvents; this.reels.pins([]); this.reels.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / 5)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-slot-caption]').textContent = 'Поймай свою комбинацию'; this.find('[data-slot-multiple]').textContent = 'WILD заменяет знаки'; this.find('[data-slot-history]').replaceChildren(); this.rules(); }
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
    this.find('[data-slot-spin-label]').textContent = active ? 'БЕСПЛАТНО' : 'ВРАЩАТЬ'; spin.setAttribute('aria-label', active ? `Бесплатное вращение, осталось ${session.view.studio.remaining}` : 'Вращать барабаны');
    this.find('[data-slot-bonus]').textContent = active ? `Бесплатных спинов: ${session.view.studio.remaining}` : 'Все линии активны';
    const retry = this.find<HTMLButtonElement>('[data-slot-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-slot-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = 'Выбери ставку и вращай барабаны.';
    if (!client.accountId) status = 'Войди в аккаунт, чтобы играть на монеты клуба.';
    else if (!ready) status = 'Загружаем баланс…';
    else if (client.pending && !client.busy) status = 'Ход ещё не подтверждён. Проверь ту же операцию без новой ставки.';
    else if (client.busy && !this.live) status = 'Проверяем сохранённый ход…';
    else if (this.live) status = this.root.dataset.phase === 'transforming' ? 'WILD раскрывает свою силу…' : this.live.accepted ? 'Показываем сохранённый результат…' : 'Барабаны вращаются. Ждём подтверждение…';
    else if (active) status = 'Бонус сохранён. Продолжи бесплатно, чтобы получить общую выплату.';
    else if (this.presentedKey) status = 'Раунд завершён. Выплата начислена.';
    if (demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion')) status = 'Дождись завершения операции в кошельке клуба.';
    this.find('[data-slot-status]').textContent = status; this.find('[data-slot-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.reels.show(session.view.studio.grid);
    this.reels.pins(active && this.game === 'studio-velvet-reign' ? session.view.studio.held : []);
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance };
    this.live = live; this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; delete this.root.dataset.beforeGrid; delete this.root.dataset.transformEvents; this.phase(live.motion ? 'accelerating' : 'spinning'); this.reels.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion }); this.controls();
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
    if (metadata) { this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid); this.reels.pins(metadata.heldBefore); }
    const complete = await this.reels.settle(live.token, metadata?.beforeGrid ?? session.view.studio.grid);
    if (!complete || this.live !== live || this.destroyed || document.hidden) return;
    if (live.kind === 'move') this.audio.effect(live.token, 'free-stage', `${session.id}:${session.view.studio.step}:free-stage`);
    if (metadata && live.motion) {
      this.phase('transforming'); this.controls();
      metadata.events.forEach((event, index) => { if (event.kind === 'expand-wild') { this.reels.expand(event.column, event.sourcePositions); this.audio.effect(live.token, 'expand', `${session.id}:${metadata.step}:expand:${index}`); } });
      const newLocks = metadata.heldAfter.filter(position => !metadata.heldBefore.includes(position));
      if (metadata.events.some(event => event.kind === 'sticky-wild') || newLocks.length) this.audio.effect(live.token, 'sticky', `${session.id}:${metadata.step}:sticky`);
      this.root.dataset.transformEvents = JSON.stringify(metadata.events);
      if ((metadata.events.length || newLocks.length) && !await this.delay(650, live)) return;
      this.reels.clearTransforms(); this.reels.show(metadata.afterGrid); this.reels.pins(metadata.heldAfter);
      newLocks.forEach(position => this.root.querySelector<HTMLElement>(`[data-slot-pin="${position}"]`)?.classList.add('new-lock'));
    } else { this.reels.show(session.view.studio.grid); this.reels.pins(session.view.studio.held); }
    if (this.live !== live) return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.phase('result'); this.showResult(session, -1, live.motion, from); this.history(session);
    const wins = this.shownFrame!.wins;
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!live.motion) { outcome(); this.finish(live, total); return; }
    wins.forEach((win, index) => this.schedule(() => {
      if (this.live !== live) return; this.highlight(win.line ?? 0); this.audio.line(live.token, win.line ?? 0);
      const multiplier = metadata?.multipliers.find(item => item.winIndex === index);
      if (multiplier) { this.find('[data-slot-feature]').textContent = `Линия ${multiplier.line + 1}: WILD ×${multiplier.factor}`; this.root.dataset.multiplierFactor = String(multiplier.factor); this.audio.effect(live.token, 'multiplier', `${session.id}:${metadata!.step}:multiplier:${index}`); }
    }, index * 180));
    this.schedule(() => { if (this.live === live) outcome(); }, wins.length * 180);
    const began = performance.now();
    const count = (now: number) => { if (this.live !== live) return; const progress = Math.max(0, Math.min(1, (now - began) / 1000)); this.setPayout(from + Math.floor((total - from) * (1 - (1 - progress) ** 3)), total); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0; };
    this.payoutFrame = requestAnimationFrame(count); this.schedule(() => this.finish(live, total), Math.max(1000, wins.length * 180 + 200)); this.controls();
  }

  private finish(live: LiveStage, total: number) { if (this.live !== live) return; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); }
  private static(session: SlotSession, index = -1) { this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.root.dataset.presentation = 'static'; this.phase('result'); if (!this.stakeChosen || session.state === 'active') this.stake = session.stakeUnits; this.reels.show((index < 0 ? session.view.studio : session.view.studio.history[index]).grid); this.reels.pins((index < 0 ? session.view.studio : session.view.studio.history[index]).held); this.showResult(session, index, false); this.history(session); this.rules(); this.controls(); }
  private showResult(session: SlotSession, index: number, animate: boolean, initialPayout = 0) {
    this.clearWins(); const view = session.view.studio, frame = index < 0 ? view.history.at(-1)! : view.history[index]; this.shownFrame = frame; this.shownSession = session; this.shownIndex = index; this.root.dataset.frameIndex = String(index < 0 ? view.step : index);
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits); this.setPayout(animate ? initialPayout : total, total);
    this.find('[data-slot-caption]').textContent = session.state === 'active' ? 'Накоплено за раунд' : 'Начислено за раунд'; this.find('[data-slot-multiple]').textContent = total ? `${number(total / stake)}× за раунд` : 'WILD заменяет знаки';
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-slot-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    this.find('[data-slot-feature]').textContent = index < 0 ? this.game === 'studio-cosmic-escape' ? 'WILD раскрывается на весь барабан' : `Закреплено корон: ${frame.held.length}` : `Сохранённый этап ${index + 1}: +${amount(frame.payoutUnits)} монет`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-slot-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.slotCell))));
    this.find('[data-slot-lines]').innerHTML = frame.wins.map(win => `<polyline data-line="${win.line ?? 0}" points="${win.positions.map(position => `${(position % view.cols + .5) * 100},${(Math.floor(position / view.cols) + .5) * 100}`).join(' ')}"/>`).join('');
    this.find('[data-slot-line-list]').innerHTML = frame.wins.map(win => `<button type="button" data-slot-line-button="${win.line ?? 0}"><span>Линия ${(win.line ?? 0) + 1}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join(''); this.highlight();
  }
  private highlight(line?: number) { const positions = new Set((this.shownFrame?.wins ?? []).filter(win => line !== undefined && win.line === line).flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-slot-cell]').forEach(cell => cell.classList.toggle('active-win', positions.has(Number(cell.dataset.slotCell)))); this.root.querySelectorAll<SVGElement>('[data-slot-lines] polyline').forEach(path => path.classList.toggle('active', line === undefined || Number(path.dataset.line) === line)); this.root.querySelectorAll<HTMLButtonElement>('[data-slot-line-button]').forEach(button => button.setAttribute('aria-pressed', String(line !== undefined && Number(button.dataset.slotLineButton) === line))); }
  private history(session: SlotSession) { this.find('[data-slot-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-slot-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? `Бесплатный ${index}` : 'Основной'} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-slot-bigwin]').hidden = true; delete this.root.dataset.multiplierFactor; this.root.querySelectorAll<HTMLElement>('[data-slot-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-slot-lines]').replaceChildren(); this.find('[data-slot-line-list]').replaceChildren(); }
  private setPayout(units: number, target: number) { this.find('[data-slot-amount]').textContent = amount(units); const element = this.find('[data-slot-payout]'); element.dataset.units = String(units); element.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-slot-paytable]').innerHTML = studioSlotPaytable(this.game).map(row => `<div>${slotSymbol(this.game, row.symbol)}<span>${SLOT_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => `<small>${pay.count} знака: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-slot-rtp]').textContent = `Расчётный возврат при ставке ${amount(this.stake)} монет: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }
  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-slot-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? 'Включить звук' : 'Выключить звук'); this.find('[data-slot-audio-label]').textContent = prefs.muted ? 'Без звука' : 'Звук'; this.find<HTMLInputElement>('[data-slot-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.reels.cancel(); this.reels.clearTransforms(); cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.reels.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
