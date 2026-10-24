import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioStrip, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation, type StudioWaysPresentationAward } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { WaysReels } from './WaysReels';
import { waysSymbol, WAYS_SYMBOL_NAMES, type WaysSlotGame } from './WaysArtwork';
import './ways-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
const reelsLabel = (count: number) => `${count} ${count >= 2 && count <= 4 ? translateText('барабана') : translateText('барабанов')}`;
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class WaysSlotUI {
  private root: HTMLElement; private reels: WaysReels; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private metadataCache = new Map<string, StudioSlotPresentation>();
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: WaysSlotGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-ways-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new WaysReels(this.find('[data-ways-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-ways-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-ways-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-ways-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-ways-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-ways-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-ways-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-ways-award-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-ways-award-button]'); if (button && !this.live) this.highlight(Number(button.dataset.waysAwardButton)); };
    this.find('[data-ways-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-ways-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.waysFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.phase}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'transforming' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.waysState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info = STUDIO_INFO[this.game], sky = this.game === 'studio-sky-lanterns', rivet = this.game === 'studio-rivet-rally';
    const theme = sky ? 'sky' : rivet ? 'rivet' : 'frost';
    const title = sky ? 'SKY LANTERNS' : rivet ? 'RIVET RALLY' : 'FROSTLINE COURIER';
    const subtitle = sky ? translateText('Ночной праздник. Встречай свои комбинации.') : rivet ? translateText('Медная трасса. Связанные барабаны.') : translateText('Зимняя почта. Раскрой тайные посылки.');
    const description = sky ? translateText('Шесть барабанов, четыре ряда. Три небесных врата на основном поле открывают ровно два бесплатных новых поля, без новой ставки и продления бонуса.') : rivet ? translateText('От двух до пяти первых барабанов связаны с первым и показывают одинаковые знаки. Остальные независимы. В этой игре один платный этап, без бесплатного бонуса, даже при нескольких сигнальных лампах.') : translateText('Тайные коробки раскрываются в один обычный знак по исходному верхнему левому символу этого этапа. Раскрываются только тайные коробки. Три знака доставки на основном поле открывают ровно два бесплатных новых поля. Доставка не собирает монеты.');
    return tr`<section class="ways-slot ways-${theme}" data-ways-slot="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-ways-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="ways-heading"><div><span>ROYAL STUDIO</span><h3>${info.name}</h3><p>${subtitle}</p></div><div class="ways-balance"><small>USDT · Демо</small><strong data-ways-balance data-studio-balance>…</strong></div></header>
      <div class="ways-cabinet"><div class="ways-scenery" aria-hidden="true"><i class="ways-backdrop"></i><i class="ways-horizon"></i></div><div class="ways-marquee"><span>${title}</span><small>${info.ways} ВОЗМОЖНЫХ ПУТЕЙ</small></div>
        <div class="ways-facts-panel" data-ways-facts-panel><span>${sky ? translateText('НЕБЕСНЫЕ КОМБИНАЦИИ') : rivet ? translateText('СВЯЗЬ БАРАБАНОВ') : translateText('ТАЙНЫЕ ПОСЫЛКИ')}</span><div data-ways-key-art aria-hidden="true"></div><strong data-ways-key>${sky ? translateText('Соседние барабаны слева') : translateText('Раскроется после остановки')}</strong><small data-ways-key-detail>${sky ? translateText('Обычные знаки и WILD имеют свои награды') : rivet ? translateText('Связаны только первые барабаны') : translateText('Посылки раскрываются после остановки')}</small></div>
        <div class="ways-frame"><div class="ways-reels" data-ways-reels role="group" aria-label="${info.cols === 6 ? translateText('Шесть барабанов, четыре ряда') : translateText('Пять барабанов, три ряда')}"></div></div>
        <div class="ways-feature" data-ways-feature role="status">Способы выигрыша от трёх соседних барабанов слева</div>
        <div class="ways-result studio-stage-payout"><span data-ways-caption>Встречай свою комбинацию</span><strong data-ways-payout data-units="0" data-target-units="0"><span data-ways-amount>0,00</span><small> USDT</small></strong><span class="ways-bigwin" data-ways-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="ways-console"><label>Ставка за раунд<select data-ways-stake data-stake>${DEMO_BETS.map(value => `<option value="${value * 100}">${amount(value * 100)}</option>`).join('')}</select></label><button type="button" class="ways-spin" data-ways-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-ways-spin-label>ВРАЩАТЬ</span></button><div class="ways-round-info"><small data-ways-bonus>Все способы активны</small><strong data-ways-multiple>От трёх барабанов</strong></div></div>
      </div><div class="ways-history" data-ways-history aria-label="Сохранённые этапы раунда"></div><div class="ways-award-list" data-ways-award-list aria-label="Подтверждённые награды за способы"></div><div class="ways-award-detail" data-ways-award-detail hidden></div>
      <p class="ways-status" data-ways-status role="status"></p><p class="ways-error studio-error" data-ways-error role="alert"></p>
      <div class="ways-tools"><div class="ways-audio"><button type="button" data-ways-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-ways-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-ways-volume aria-label="Громкость игры"></label></div><div><button type="button" data-ways-retry data-retry hidden>Проверить ход</button><button type="button" data-ways-refresh data-refresh>Обновить</button></div></div>
      <details class="ways-rules"><summary>Правила, символы и способы выигрыша</summary><p>${description}</p><p>От трёх соседних барабанов слева оплачиваются способы для каждого обычного знака. WILD заменяет обычные знаки. Число путей равно произведению количества подходящих ячеек на этих барабанах. Полностью WILD-пути исключаются из обычной награды и оплачиваются отдельно, со своей длиной. Это не фиксированные линии и не обещание ${info.ways} выигрышей.</p><p>Базовые награды за один оплачиваемый путь:</p><div class="ways-paytable" data-ways-paytable></div><p data-ways-rtp></p><p>Ставка указана за все способы и весь раунд. Множитель включает ставку. Коэффициент каждой награды округляется вниз до четырёх знаков, затем её выплата до 0,01 USDT; выплаты суммируются. На счёт поступает общая выплата за раунд. Историю можно посмотреть без новой ставки.</p></details><p class="ways-demo-note">Игра на тестовый виртуальные USDT</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.live?.motion && this.reduced.matches) { this.cancel(); this.root.dataset.reducedMotion = 'true'; }
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.frameIndex; delete this.root.dataset.beforeGrid; this.metadataCache.clear(); this.reels.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / STUDIO_INFO[this.game].cols)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-ways-caption]').textContent = translateText('Встречай свою комбинацию'); this.find('[data-ways-multiple]').textContent = translateText('От трёх барабанов'); this.find('[data-ways-history]').replaceChildren(); this.resetOwnerPresentation(); this.facts(); this.rules(); }
    const session = this.session();
    observeExpansionOutcome(this.root, this.game, session, client.accountId, true, !!this.live && client.pending?.gameId === this.game);
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

  private resetOwnerPresentation() {
    this.find('[data-ways-feature]').textContent = translateText('Способы выигрыша от трёх соседних барабанов слева');
    for (const key of ["presentation","activeAward","selectedWays","synced","mystery"]) delete this.root.dataset[key];
    const detail = this.find('[data-ways-award-detail]'); detail.replaceChildren(); detail.hidden = true;
  }

  private controls() {
    const session = this.session(), active = session?.state === 'active', balance = this.balance(), ready = !!client.accountId && balance !== undefined, blocked = this.blocked();
    const shownBalance = this.live && this.root.dataset.phase !== 'result' ? this.live.balance : balance;
    this.find('[data-ways-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-ways-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-ways-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-ways-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-ways-spin-label]').textContent = active ? translateText('БЕСПЛАТНО') : translateText('ВРАЩАТЬ'); spin.setAttribute('aria-label', active ? tr`Бесплатное вращение, осталось ${session.view.studio.remaining}` : translateText('Вращать барабаны'));
    this.find('[data-ways-bonus]').textContent = active ? tr`Бесплатных спинов: ${session.view.studio.remaining}` : translateText('Все способы активны');
    const retry = this.find<HTMLButtonElement>('[data-ways-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-ways-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = translateText('Выбери ставку и вращай барабаны.');
    if (!client.accountId) status = translateText('Войди в аккаунт, чтобы играть на виртуальные USDT.');
    else if (!ready) status = translateText('Загружаем баланс…');
    else if (client.pending && !client.busy) status = translateText('Ход ещё не подтверждён. Проверь ту же операцию без новой ставки.');
    else if (client.busy && !this.live) status = translateText('Проверяем сохранённый ход…');
    else if (this.live) status = this.root.dataset.phase === 'transforming' ? translateText('Показываем событие этого вращения…') : this.live.accepted ? translateText('Показываем сохранённый результат…') : translateText('Барабаны вращаются. Ждём подтверждение…');
    else if (active) status = translateText('Бонус сохранён. Продолжи бесплатно, чтобы получить общую выплату.');
    else if (this.presentedKey) status = translateText('Раунд завершён. Выплата начислена.');
    if (demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion')) status = translateText('Дождись завершения операции в кошельке клуба.');
    this.find('[data-ways-status]').textContent = status; this.find('[data-ways-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.reels.show(session.view.studio.grid);
    
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance };
    this.live = live; observeExpansionOutcome(this.root, this.game, this.session(), client.accountId, true, true); this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; this.facts();
    this.phase(live.motion ? 'accelerating' : 'spinning'); this.reels.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion, click: live.motion && !active }); this.controls();
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
      if (this.live !== live || client.accountId !== live.account || this.session()?.id !== session.id || this.session()?.view.studio.step !== session.view.studio.step || this.session()?.view.phase !== session.view.phase) return;
      return validStudioSlotPresentation(metadata, this.game, session.id, session.view.phase, session.view.studio) ? metadata : undefined;
    } catch { return; } finally { if (this.fetchAbort === controller) this.fetchAbort = undefined; }
  }

  private async present(session: SlotSession, live: LiveStage) {
    const metadata = live.motion ? await this.presentation(session, live) : undefined;
    if (this.live !== live || this.destroyed || document.hidden) return;
    this.root.dataset.presentation = metadata ? 'available' : 'static';
    if (metadata) { this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid); this.metadataCache.set(`${session.id}:${session.view.studio.step}`, metadata); }
    const complete = await this.reels.settle(live.token, metadata?.beforeGrid ?? session.view.studio.grid);
    if (!complete || this.live !== live || this.destroyed || document.hidden) return;
    if (metadata && live.motion) {
      this.phase('transforming'); this.controls(); this.facts(metadata);
      if (live.kind === 'move') { this.audio.effect(live.token, 'free-stage', `${session.id}:${metadata.phase}:${metadata.step}:free-stage`); if (!await this.delay(600, live)) return; }
      if (metadata.synced) {
        this.reels.markSynced(metadata.synced.columns);
        this.find('[data-ways-feature]').textContent = tr`Первые ${reelsLabel(metadata.synced.columns.length)} связаны. Их знаки уже согласованы.`;
        this.audio.effect(live.token, 'synced', `${session.id}:${metadata.phase}:${metadata.step}:synced`);
        if (!await this.delay(600, live)) return;
      }
      if (metadata.mystery?.positions.length) {
        this.find('[data-ways-feature]').textContent = tr`Тайных посылок: ${metadata.mystery.positions.length}. Раскрывается ${WAYS_SYMBOL_NAMES[this.game][metadata.mystery.symbol].toLowerCase()}.`;
        this.reels.markMystery(metadata.mystery.positions);
        this.audio.effect(live.token, 'mystery', `${session.id}:${metadata.phase}:${metadata.step}:mystery`);
        if (!await this.delay(220, live)) return;
        this.reels.show(metadata.afterGrid);
        if (!await this.delay(380, live)) return;
      }
      this.reels.clearTransforms(); this.reels.show(metadata.afterGrid);
    } else this.reels.show(session.view.studio.grid);
    if (this.live !== live) return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.phase('result'); this.showResult(session, -1, !!metadata && live.motion, from); this.facts(metadata, this.shownFrame); this.history(session);
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!metadata || !live.motion) { outcome(); this.finish(live, total); return; }
    for (const award of metadata.ways!.awards) {
      this.highlight(award.winIndex);
      this.audio.ways(live.token, award.winIndex);
      if (!await this.delay(300, live)) return;
    }
    outcome();
    const began = performance.now();
    const count = (now: number) => { if (this.live !== live) return; const progress = Math.max(0, Math.min(1, (now - began) / 1000)); this.setPayout(from + Math.floor((total - from) * (1 - (1 - progress) ** 3)), total); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0; };
    this.payoutFrame = requestAnimationFrame(count); this.schedule(() => this.finish(live, total), 1000); this.controls();
  }

  private finish(live: LiveStage, total: number) { if (this.live !== live) return; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); if (!this.destroyed && !document.hidden && client.accountId === live.account) observeExpansionOutcome(this.root, this.game, this.shownSession, client.accountId, false, false); }
  private static(session: SlotSession, index = -1) { this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.root.dataset.presentation = 'static'; this.phase('result'); if (!this.stakeChosen || session.state === 'active') this.stake = session.stakeUnits; this.showResult(session, index, false); this.facts(this.metadataCache.get(`${session.id}:${index < 0 ? session.view.studio.step : index}`), this.shownFrame); this.history(session); this.rules(); this.controls(); }
  private showResult(session: SlotSession, index: number, animate: boolean, initialPayout = 0) {
    this.clearWins(); const view = session.view.studio, frame = index < 0 ? view.history.at(-1)! : view.history[index]; this.shownFrame = frame; this.shownSession = session; this.shownIndex = index; this.reels.show(frame.grid); this.root.dataset.frameIndex = String(index < 0 ? view.step : index);
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits); this.setPayout(animate ? initialPayout : total, total);
    this.find('[data-ways-caption]').textContent = session.state === 'active' ? translateText('Накоплено за раунд') : translateText('Начислено за раунд'); this.find('[data-ways-multiple]').textContent = total ? tr`${number(total / stake)}× за раунд` : translateText('От трёх барабанов');
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-ways-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    this.find('[data-ways-feature]').textContent = tr`Сохранённый этап ${(index < 0 ? view.step : index) + 1}: +${amount(frame.payoutUnits)} USDT`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-ways-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.waysCell))));
    this.find('[data-ways-award-list]').innerHTML = frame.wins.map((win, winIndex) => `<button type="button" data-ways-award-button="${winIndex}"><span>${WAYS_SYMBOL_NAMES[this.game][win.symbol]} · ${reelsLabel(win.count)}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join(''); this.highlight();
  }
  private awards(): StudioWaysPresentationAward[] {
    const frame = this.shownFrame, session = this.shownSession; if (!frame || !session) return [];
    const index = this.shownIndex < 0 ? session.view.studio.step : this.shownIndex;
    const cached = this.metadataCache.get(`${session.id}:${index}`)?.ways?.awards;
    if (cached) return cached;
    // Counts follow only the already confirmed visible matching cells. Money stays server-owned.
    const cols = session.view.studio.cols;
    return frame.wins.map((win, winIndex) => { const columns = Array.from({ length: win.count }, (_, column) => win.positions.filter(position => position % cols === column)); const paths = columns.reduce((product, cells) => product * cells.length, 1); const excludedFullyWildPaths = win.symbol === 3 ? 0 : columns.reduce((product, cells) => product * cells.filter(position => frame.grid[position] === 3).length, 1); return { winIndex, symbol: win.symbol as 0 | 1 | 2 | 3, count: win.count, columns, paths, excludedFullyWildPaths, paidWays: paths - excludedFullyWildPaths }; });
  }
  private highlight(winIndex?: number) {
    const selected = winIndex === undefined ? undefined : this.shownFrame?.wins[winIndex];
    const positions = new Set(selected?.positions ?? []); this.root.dataset.activeAward = winIndex === undefined ? '' : String(winIndex);
    this.root.querySelectorAll<HTMLElement>('[data-ways-cell]').forEach(cell => cell.classList.toggle('active-win', positions.has(Number(cell.dataset.waysCell))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-ways-award-button]').forEach(button => button.setAttribute('aria-pressed', String(winIndex !== undefined && Number(button.dataset.waysAwardButton) === winIndex)));
    const detail = this.find('[data-ways-award-detail]'); detail.hidden = !selected;
    if (!selected) { detail.replaceChildren(); delete this.root.dataset.selectedWays; return; }
    const award = this.awards().find(item => item.winIndex === winIndex)!; this.root.dataset.selectedWays = JSON.stringify(award);
    detail.textContent = tr`${reelsLabel(award.count)} подряд: ${award.columns.map(column => column.length).join(' × ')} = ${award.paths} путей${award.excludedFullyWildPaths ? tr`, исключено полностью WILD: ${award.excludedFullyWildPaths}` : ''}. Оплачено: ${award.paidWays}.`;
    this.find('[data-ways-feature]').textContent = tr`${WAYS_SYMBOL_NAMES[this.game][selected.symbol]}: ${award.paidWays} способов, +${amount(selected.payoutUnits)} USDT`;
  }
  private facts(metadata?: StudioSlotPresentation, frame?: StudioSlotFrame) {
    delete this.root.dataset.synced; delete this.root.dataset.mystery; delete this.root.dataset.beforeGrid;
    if (metadata) this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid);
    this.find('[data-ways-key-art]').replaceChildren();
    if (this.game === 'studio-sky-lanterns') {
      this.find('[data-ways-key-art]').innerHTML = waysSymbol(this.game, 0);
      this.find('[data-ways-key]').textContent = translateText('Соседние барабаны слева');
      this.find('[data-ways-key-detail]').textContent = translateText('Каждый оплачиваемый путь входит в сохранённую награду');
    } else if (this.game === 'studio-rivet-rally') {
      const first = frame?.grid[0], count = metadata?.synced?.columns.length ?? (first === undefined ? undefined : Math.min(5, 2 + studioStrip(this.game, 0).indexOf(first) % 4));
      if (metadata?.synced) this.root.dataset.synced = JSON.stringify(metadata.synced);
      if (count !== undefined) this.reels.markSynced(Array.from({ length: count }, (_, column) => column));
      this.find('[data-ways-key-art]').innerHTML = waysSymbol(this.game, 0);
      this.find('[data-ways-key]').textContent = count === undefined ? translateText('Связь после остановки') : tr`Связаны первые ${reelsLabel(count)}`;
      this.find('[data-ways-key-detail]').textContent = translateText('Один платный этап, без бесплатного бонуса');
    } else {
      if (metadata?.mystery) this.root.dataset.mystery = JSON.stringify(metadata.mystery);
      const mystery = metadata?.mystery;
      this.find('[data-ways-key-art]').innerHTML = waysSymbol(this.game, mystery?.symbol ?? (frame ? 5 : 4));
      this.find('[data-ways-key]').textContent = mystery ? WAYS_SYMBOL_NAMES[this.game][mystery.symbol] : frame ? translateText('Сохранённое раскрытие') : translateText('Тайна после остановки');
      this.find('[data-ways-key-detail]').textContent = mystery ? tr`Тайных коробок: ${mystery.positions.length}. Заменяются только они.` : frame ? translateText('Показан подтверждённый итог этого этапа.') : translateText('Текущая цель подтверждается после вращения');
    }
  }

  private history(session: SlotSession) { this.find('[data-ways-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-ways-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? tr`Бесплатный ${index}` : translateText('Основной')} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-ways-bigwin]').hidden = true; delete this.root.dataset.selectedWays; this.root.querySelectorAll<HTMLElement>('[data-ways-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-ways-award-list]').replaceChildren(); this.find('[data-ways-award-detail]').hidden = true; }

  private setPayout(units: number, target: number) { this.find('[data-ways-amount]').textContent = amount(units); const ways = this.find('[data-ways-payout]'); ways.dataset.units = String(units); ways.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-ways-paytable]').innerHTML = studioSlotPaytable(this.game).map(row => `<div>${waysSymbol(this.game, row.symbol)}<span>${WAYS_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => `<small>${reelsLabel(pay.count)}: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-ways-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} USDT: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }

  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-ways-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук')); this.find('[data-ways-audio-label]').textContent = prefs.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-ways-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { resetGameOutcomes(this.root); this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.reels.cancel(); this.reels.clearTransforms();  cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.reels.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
