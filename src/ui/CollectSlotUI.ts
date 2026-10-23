import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation, type StudioCollectionPresentationAward } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { CollectReels } from './CollectReels';
import { collectSymbol, COLLECT_SYMBOL_NAMES, type CollectSlotGame } from './CollectArtwork';
import './collect-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
const reelsLabel = (count: number) => `${count} ${count >= 2 && count <= 4 ? translateText('барабана') : translateText('барабанов')}`;
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class CollectSlotUI {
  private root: HTMLElement; private reels: CollectReels; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private metadataCache = new Map<string, StudioSlotPresentation>();
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: CollectSlotGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-collect-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new CollectReels(this.find('[data-collect-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-collect-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-collect-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-collect-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-collect-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-collect-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-collect-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-collect-line-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-collect-line]'); if (button && !this.live) { const line = Number(button.dataset.collectLine); this.highlight(this.shownFrame?.wins.findIndex(win => win.kind === 'line' && win.line === line), line); } };
    this.find('[data-collect-award-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-collect-award-button]'); if (button && !this.live) this.highlight(Number(button.dataset.collectAwardButton)); };
    this.find('[data-collect-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-collect-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.collectFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.phase}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'transforming' | 'collecting' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.collectState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info = STUDIO_INFO[this.game], deep = this.game === 'studio-deep-current';
    return tr`<section class="collect-slot collect-${deep ? 'deep' : 'orchard'}" data-collect-slot="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-collect-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="collect-heading"><div><span>ROYAL WORLDS</span><h3>${info.name}</h3><p>${deep ? translateText('Жемчужный свет и сокровища моря') : translateText('Тёплое солнце, плоды и золотые семена')}</p></div><div class="collect-balance"><small>USDT · Nile</small><strong data-collect-balance data-studio-balance>…</strong></div></header>
      <div class="collect-cabinet"><div class="collect-scenery" aria-hidden="true"><i class="collect-backdrop"></i><i class="collect-horizon"></i></div><div class="collect-marquee"><span>${deep ? 'DEEP CURRENT' : 'BLAZING ORCHARD'}</span><small>${info.paylines.length} ЛИНИЙ</small></div>
        <div class="collect-facts-panel"><div data-collect-key-art aria-hidden="true"></div><strong data-collect-key>Сбор после остановки</strong><small data-collect-key-detail>Первые два сборщика получают все сокровища поля</small></div>
        <div class="collect-frame"><div class="collect-reels" data-collect-reels role="group" aria-label="Пять барабанов, ${deep ? translateText('три') : translateText('четыре')} ряда"></div></div>
        <div class="collect-feature" data-collect-feature role="status">${deep ? translateText('Хранители находят сундуки сокровищ') : translateText('Солнце расширяется на трёх внутренних барабанах')}</div>
        <div class="collect-result studio-stage-payout"><span data-collect-caption>Встречай свою комбинацию</span><strong data-collect-payout data-units="0" data-target-units="0"><span data-collect-amount>0,00</span><small> USDT</small></strong><span class="collect-bigwin" data-collect-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="collect-console"><label>Ставка за раунд<select data-collect-stake data-stake>${DEMO_BETS.map(value => `<option value="${value * 100}">${amount(value * 100)}</option>`).join('')}</select></label><button type="button" class="collect-spin" data-collect-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-collect-spin-label>ВРАЩАТЬ</span></button><div class="collect-round-info"><small data-collect-bonus>Все линии активны</small><strong data-collect-multiple>${info.paylines.length} линий</strong></div></div>
      </div><div class="collect-history" data-collect-history aria-label="Сохранённые этапы раунда"></div><div class="collect-award-list" data-collect-award-list aria-label="Награды сборщиков"></div><div class="collect-award-detail" data-collect-award-detail hidden></div>
      <details class="collect-line-catalog"><summary>Посмотреть все ${info.paylines.length} линий</summary><div data-collect-line-list></div></details>
      <p class="collect-status" data-collect-status role="status"></p><p class="collect-error studio-error" data-collect-error role="alert"></p>
      <div class="collect-tools"><div class="collect-audio"><button type="button" data-collect-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-collect-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-collect-volume aria-label="Громкость игры"></label></div><div><button type="button" data-collect-retry data-retry hidden>Проверить ход</button><button type="button" data-collect-refresh data-refresh>Обновить</button></div></div>
      <details class="collect-rules"><summary>Правила, символы и выплаты</summary><p>${deep ? translateText('Три хранителя на основном поле открывают ровно два новых бесплатных вращения. Новая ставка не нужна. Символы не закрепляются, бонус не продлевается.') : translateText('Солнце WILD расширяется на весь барабан только в трёх внутренних колонках. Два крайних барабана остаются прежними. Преобразование происходит до сбора. В этой игре один платный этап, без бесплатного бонуса.')}</p><p>На каждой из ${info.paylines.length} линий оплачивается одна лучшая цепочка от трёх обычных знаков слева. WILD заменяет обычные знаки. Затем первые два сборщика по порядку чтения поля получают каждый все оставшиеся сокровища. Третий и следующие сборщики не дают отдельной награды.</p><p>Метка «ВЕС» у сокровища показывает вес символа, а не сумму в кошельке. Вес определяется его позицией и равен 2, 3, 4 или 5. Сбор не удаляет знаки с поля. Выплата каждой награды уже учитывает все её символы и прибавляется к общей сумме один раз.</p><div class="collect-paytable" data-collect-paytable></div><p data-collect-rtp></p><p>Ставка указана за все линии и весь раунд. Коэффициент каждой награды округляется вниз до четырёх знаков, затем выплата до 0,01 USDT. На счёт поступает общая выплата за завершённый раунд. История, просмотр линий и проверка прежнего хода не требуют новой ставки.</p></details><p class="collect-demo-note">Игра на тестовый USDT Nile</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.live?.motion && this.reduced.matches) { this.cancel(); this.root.dataset.reducedMotion = 'true'; }
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.frameIndex; delete this.root.dataset.beforeGrid; this.metadataCache.clear(); this.reels.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / STUDIO_INFO[this.game].cols)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-collect-caption]').textContent = translateText('Встречай свою комбинацию'); this.find('[data-collect-multiple]').textContent = tr`${STUDIO_INFO[this.game].paylines.length} линий`; this.find('[data-collect-history]').replaceChildren(); this.resetOwnerPresentation(); this.facts(); this.rules(); }
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
    this.find('[data-collect-feature]').textContent = this.game === 'studio-deep-current' ? translateText('Хранители находят сундуки сокровищ') : translateText('Солнце расширяется на трёх внутренних барабанах');
    for (const key of ["presentation","showcaseLineCount","currentEvent","currentCollection","activeAward","selectedLine","selectedCollection","collection"]) delete this.root.dataset[key];
    const detail = this.find('[data-collect-award-detail]'); detail.replaceChildren(); detail.hidden = true;
    this.find('[data-collect-line-list]').replaceChildren(); this.reels.lineView();
    const catalog = this.find<HTMLDetailsElement>('.collect-line-catalog'); catalog.open = false; catalog.hidden = false;
  }

  private controls() {
    const session = this.session(), active = session?.state === 'active', balance = this.balance(), ready = !!client.accountId && balance !== undefined, blocked = this.blocked();
    const shownBalance = this.live && this.root.dataset.phase !== 'result' ? this.live.balance : balance;
    this.find('[data-collect-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-collect-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-collect-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-collect-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-collect-spin-label]').textContent = active ? translateText('БЕСПЛАТНО') : translateText('ВРАЩАТЬ'); spin.setAttribute('aria-label', active ? tr`Бесплатное вращение, осталось ${session.view.studio.remaining}` : translateText('Вращать барабаны'));
    this.find('[data-collect-bonus]').textContent = active ? tr`Бесплатных спинов: ${session.view.studio.remaining}` : translateText('Все линии активны');
    const retry = this.find<HTMLButtonElement>('[data-collect-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-collect-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = translateText('Выбери ставку и вращай барабаны.');
    if (!client.accountId) status = translateText('Войди в аккаунт, чтобы играть на USDT Nile.');
    else if (!ready) status = translateText('Загружаем баланс…');
    else if (client.pending && !client.busy) status = translateText('Ход ещё не подтверждён. Проверь ту же операцию без новой ставки.');
    else if (client.busy && !this.live) status = translateText('Проверяем сохранённый ход…');
    else if (this.live) status = this.root.dataset.phase === 'transforming' ? translateText('Показываем событие этого вращения…') : this.live.accepted ? translateText('Показываем сохранённый результат…') : translateText('Барабаны вращаются. Ждём подтверждение…');
    else if (active) status = translateText('Бонус сохранён. Продолжи бесплатно, чтобы получить общую выплату.');
    else if (this.presentedKey) status = translateText('Раунд завершён. Выплата начислена.');
    if (demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion')) status = translateText('Дождись завершения операции в кошельке клуба.');
    this.find('[data-collect-status]').textContent = status; this.find('[data-collect-error]').textContent = this.localError || client.error;
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
      const transformed = [...metadata.beforeGrid];
      for (const event of metadata.events) {
        if (event.kind !== 'expand-wild') continue;
        this.root.dataset.currentEvent = JSON.stringify(event); this.reels.markExpansion(event.positions);
        this.find('[data-collect-feature]').textContent = tr`Солнце WILD раскрывает внутренний барабан ${event.column + 1}`;
        this.audio.effect(live.token, 'expand', `${session.id}:${metadata.phase}:${metadata.step}:expand:${event.column}`, event.column);
        if (!await this.delay(200, live)) return;
        event.positions.forEach(position => { transformed[position] = metadata.afterGrid[position]; }); this.reels.show(transformed);
        if (!await this.delay(400, live)) return;
      }
      delete this.root.dataset.currentEvent;
      this.reels.clearTransforms(); this.reels.show(metadata.afterGrid);
    } else this.reels.show(session.view.studio.grid);
    if (this.live !== live) return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.phase('result'); this.showResult(session, -1, !!metadata && live.motion, from); this.facts(metadata, this.shownFrame); this.history(session);
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!metadata || !live.motion) { outcome(); this.finish(live, total); return; }
    // A brief sample stays calm even when all40 real lines win. Every line remains selectable.
    const lines = this.shownFrame!.wins.map((win, winIndex) => ({win, winIndex})).filter(row => row.win.kind === 'line');
    this.root.dataset.showcaseLineCount = String(Math.min(3, lines.length));
    for (const {win, winIndex} of lines.slice(0, 3)) {
      this.highlight(winIndex); this.audio.line(live.token, win.line!);
      if (!await this.delay(320, live)) return;
    }
    for (const award of metadata.collection!.awards) {
      this.phase('collecting'); this.root.dataset.currentCollection = JSON.stringify(award); this.highlight(award.winIndex);
      this.audio.collect(live.token, award.winIndex, `${session.id}:${metadata.phase}:${metadata.step}:collect:${award.winIndex}`);
      const flight = this.reels.collect(live.token, award.winIndex, award.collector, award.coins);
      if (!await this.delay(600, live) || !await flight) return;
    }
    delete this.root.dataset.currentCollection; this.phase('result');
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
    this.find('[data-collect-caption]').textContent = session.state === 'active' ? translateText('Накоплено за раунд') : translateText('Начислено за раунд'); this.find('[data-collect-multiple]').textContent = total ? tr`${number(total / stake)}× за раунд` : tr`${STUDIO_INFO[this.game].paylines.length} линий`;
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-collect-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    this.find('[data-collect-feature]').textContent = tr`Сохранённый этап ${(index < 0 ? view.step : index) + 1}: +${amount(frame.payoutUnits)} USDT`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-collect-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.collectCell))));
    this.find('[data-collect-award-list]').innerHTML = frame.wins.flatMap((win, winIndex) => win.kind === 'collect' ? [tr`<button type="button" data-collect-award-button="${winIndex}"><span>Сборщик ${frame.wins.slice(0, winIndex + 1).filter(item => item.kind === 'collect').length}</span><strong>+${amount(win.payoutUnits)}</strong></button>`] : []).join('');
    this.find('[data-collect-line-list]').innerHTML = STUDIO_INFO[this.game].paylines.map((rows, line) => { const win = frame.wins.find(item => item.kind === 'line' && item.line === line); return `<button type="button" data-collect-line="${line}" data-line-vector="${rows.join(',')}" aria-pressed="false">${line + 1}<small>${win ? `+${amount(win.payoutUnits)}` : translateText('Без награды')}</small></button>`; }).join(''); this.highlight();
  }
  private awards(): StudioCollectionPresentationAward[] {
    const frame = this.shownFrame, session = this.shownSession; if (!frame || !session) return [];
    const index = this.shownIndex < 0 ? session.view.studio.step : this.shownIndex;
    const cached = this.metadataCache.get(`${session.id}:${index}`)?.collection?.awards;
    if (cached) return cached;
    // Cold restore follows only saved canonical collect positions. No raw transform is invented.
    return frame.wins.flatMap((win, winIndex) => win.kind === 'collect' ? [{winIndex, collector: win.positions[0], coins: win.positions.slice(1).map(position => ({position, rawValue: 2 + position % 4}))}] : []);
  }
  private highlight(winIndex?: number, explicitLine?: number) {
    const selected = winIndex === undefined || winIndex < 0 ? undefined : this.shownFrame?.wins[winIndex];
    const line = explicitLine ?? (selected?.kind === 'line' ? selected.line : undefined);
    const rows = line === undefined ? undefined : STUDIO_INFO[this.game].paylines[line];
    const positions = new Set(selected?.positions ?? rows?.map((row, column) => row * 5 + column) ?? []);
    this.root.dataset.activeAward = selected ? String(winIndex) : ''; this.root.dataset.selectedLine = line === undefined ? '' : String(line); this.reels.lineView(rows);
    this.root.querySelectorAll<HTMLElement>('[data-collect-cell]').forEach(cell => cell.classList.toggle('active-win', positions.has(Number(cell.dataset.collectCell))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-collect-award-button]').forEach(button => button.setAttribute('aria-pressed', String(selected?.kind === 'collect' && Number(button.dataset.collectAwardButton) === winIndex)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-collect-line]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.collectLine) === line)));
    const detail = this.find('[data-collect-award-detail]'); detail.hidden = !selected && line === undefined; delete this.root.dataset.selectedCollection;
    if (!selected) { detail.textContent = line === undefined ? '' : tr`Линия ${line + 1}: в этом этапе без награды`; return; }
    if (selected.kind === 'collect') {
      const award = this.awards().find(item => item.winIndex === winIndex)!; this.root.dataset.selectedCollection = JSON.stringify(award);
      detail.textContent = tr`Сокровищ: ${award.coins.length}. Вес: ${award.coins.map(coin => coin.rawValue).join(' + ')}. Выплата награды: ${amount(selected.payoutUnits)} USDT.`;
      this.find('[data-collect-feature]').textContent = tr`Сборщик получает все сокровища (${award.coins.length}): +${amount(selected.payoutUnits)} USDT`;
    } else {
      detail.textContent = tr`Линия ${line! + 1}: цепочка ${selected.count}, +${amount(selected.payoutUnits)} USDT`;
      this.find('[data-collect-feature]').textContent = tr`${COLLECT_SYMBOL_NAMES[this.game][selected.symbol]}: линия ${line! + 1}, +${amount(selected.payoutUnits)} USDT`;
    }
  }
  private facts(metadata?: StudioSlotPresentation, frame?: StudioSlotFrame) {
    delete this.root.dataset.collection; delete this.root.dataset.beforeGrid;
    if (metadata) this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid);
    const awards = frame ? this.awards() : []; if (frame) this.root.dataset.collection = JSON.stringify({awards});
    this.find('[data-collect-key-art]').innerHTML = collectSymbol(this.game, 4);
    this.find('[data-collect-key]').textContent = frame ? tr`Сборщиков с наградой: ${awards.length}` : translateText('Сбор после остановки');
    this.find('[data-collect-key-detail]').textContent = frame ? tr`Сокровищ на поле: ${frame.grid.filter(symbol => symbol === 5).length}. Знаки сохраняются после сбора.` : translateText('Первые два сборщика получают все сокровища поля');
  }

  private history(session: SlotSession) { this.find('[data-collect-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-collect-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? tr`Бесплатный ${index}` : translateText('Основной')} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-collect-bigwin]').hidden = true; delete this.root.dataset.selectedCollection; this.root.querySelectorAll<HTMLElement>('[data-collect-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-collect-award-list]').replaceChildren(); this.find('[data-collect-award-detail]').hidden = true; }

  private setPayout(units: number, target: number) { this.find('[data-collect-amount]').textContent = amount(units); const ways = this.find('[data-collect-payout]'); ways.dataset.units = String(units); ways.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-collect-paytable]').innerHTML = studioSlotPaytable(this.game).filter(row => row.symbol < 3).map(row => `<div>${collectSymbol(this.game, row.symbol)}<span>${COLLECT_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => tr`<small>${pay.count} подряд: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-collect-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} USDT: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }

  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-collect-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук')); this.find('[data-collect-audio-label]').textContent = prefs.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-collect-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { resetGameOutcomes(this.root); this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.reels.cancel(); this.reels.clearTransforms();  cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; delete this.root.dataset.currentCollection; delete this.root.dataset.currentEvent; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.reels.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
