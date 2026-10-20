import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import { StudioMotion } from './StudioMotion';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation, type StudioCollectionPresentationAward, type StudioHoldPresentationAward } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { HoldReels, type HoldPin } from './HoldReels';
import { holdSymbol, HOLD_SYMBOL_NAMES, type HoldSlotGame } from './HoldArtwork';
import './hold-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
const reelsLabel = (count: number) => `${count} ${count >= 2 && count <= 4 ? translateText('барабана') : translateText('барабанов')}`;
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number; pinsBefore:HoldPin[] };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class HoldSlotUI {
  private secondaryMotion?:StudioMotion;
  private secondaryWatchdog?:ReturnType<typeof setTimeout>;
  private root: HTMLElement; private reels: HoldReels; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private metadataCache = new Map<string, StudioSlotPresentation>();
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: HoldSlotGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-hold-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new HoldReels(this.find('[data-hold-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-hold-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-hold-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-hold-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-hold-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-hold-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-hold-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-hold-line-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-hold-line]'); if (button && !this.live) { const line = Number(button.dataset.holdLine); this.highlight(this.shownFrame?.wins.findIndex(win => win.kind === 'line' && win.line === line), line); } };
    this.find('[data-hold-award-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-hold-award-button]'); if (button && !this.live) this.highlight(Number(button.dataset.holdAwardButton)); };
    this.find('[data-hold-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-hold-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.holdFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.phase}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'transforming' | 'collecting' | 'locking' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.holdState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info=STUDIO_INFO[this.game],vault=this.game==='studio-ember-vault',market=this.game==='studio-midnight-market';
    return tr`<section class="hold-slot hold-${vault?'vault':market?'market':'mint'}" data-hold-slot="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-hold-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="hold-heading"><div><span>ROYAL WORLDS</span><h3>${info.name}</h3><p>${vault?translateText('Тёплый свет металла и золотые замки'):market?translateText('Сокровища под фонарями ночного базара'):translateText('Серебряные медальоны в лунном свете')}</p></div><div class="hold-balance"><small>Монеты клуба</small><strong data-hold-balance data-studio-balance>…</strong></div></header>
      <div class="hold-cabinet"><div class="hold-scenery" aria-hidden="true"><i class="hold-backdrop"></i></div><div class="hold-marquee"><span>${vault?'EMBER VAULT':market?'MIDNIGHT MARKET':'MOONLIT MINT'}</span><small>${info.paylines.length} ЛИНИЙ</small></div>
        <div class="hold-facts-panel"><div data-hold-key-art aria-hidden="true"></div><strong data-hold-key>Три монеты открывают бонус</strong><small data-hold-key-detail>Ровно два бесплатных этапа, без продления</small></div>
        <div class="hold-frame"><div class="hold-reels" data-hold-reels role="group" aria-label="${info.cols} барабана, ${info.rows} ряда"></div></div>
        <div class="hold-feature" data-hold-feature role="status">Монеты остаются на месте во время бонуса</div>
        <div class="hold-result studio-stage-payout"><span data-hold-caption>Встречай свою комбинацию</span><strong data-hold-payout data-units="0" data-target-units="0"><span data-hold-amount>0,00</span><small> монет</small></strong><span class="hold-bigwin" data-hold-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="hold-console"><label>Ставка за раунд<select data-hold-stake data-stake>${DEMO_BETS.map(value=>`<option value="${value*100}">${amount(value*100)}</option>`).join('')}</select></label><button type="button" class="hold-spin" data-hold-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-hold-spin-label>ВРАЩАТЬ</span></button><div class="hold-round-info"><small data-hold-bonus>Все линии активны</small><strong data-hold-multiple>${info.paylines.length} линий</strong></div></div>
      </div><div class="hold-history" data-hold-history aria-label="Сохранённые этапы раунда"></div><div class="hold-award-list" data-hold-award-list aria-label="Оплаченные монеты и сборщики"></div><div class="hold-award-detail" data-hold-award-detail hidden></div>
      <details class="hold-line-catalog"><summary>Посмотреть все ${info.paylines.length} линий</summary><div data-hold-line-list></div></details>
      <p class="hold-status" data-hold-status role="status"></p><p class="hold-error studio-error" data-hold-error role="alert"></p>
      <div class="hold-tools"><div class="hold-audio"><button type="button" data-hold-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-hold-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-hold-volume aria-label="Громкость игры"></label></div><div><button type="button" data-hold-retry data-retry hidden>Проверить ход</button><button type="button" data-hold-refresh data-refresh>Обновить</button></div></div>
      <details class="hold-rules"><summary>Правила, символы и выплаты</summary><p>Три или больше монет на основном поле открывают ровно два бесплатных этапа. Оплаченные монеты закрепляются на своих местах. Каждый новый этап оплачивает только новые монеты. Пустой этап не продлевает бонус. Одной или двух монет недостаточно для бонуса, отдельная монетная выплата за них не начисляется.</p><p>На основном поле активны ${info.paylines.length} линий: от трёх обычных знаков слева, WILD их заменяет. ${market?translateText('Первые два торговца-сборщика по порядку чтения поля получают каждый все монеты основного поля. Это отдельная награда; она возможна и без монетного бонуса.'):translateText('Шестерня или печать не открывает бонус и не даёт отдельной награды.')} В бесплатных этапах линии и сборщики не оплачиваются.</p><p>Метка «ВЕС» у неоплаченной монеты означает вес символа, а не сумму в кошельке. Число на закреплённой монете показывает её уже учтённую награду в монетах клуба. Старые монеты не оплачиваются повторно. Полное поле не даёт дополнительного джекпота.</p><div class="hold-paytable" data-hold-paytable></div><p data-hold-rtp></p><p>Ставка указана за все линии и весь раунд. Коэффициент каждой награды округляется вниз до четырёх знаков, затем выплата до 0,01 монеты. На счёт поступает общая выплата за завершённый раунд. История, просмотр линий и проверка прежнего хода не требуют новой ставки.</p></details><p class="hold-demo-note">Игра на тестовые монеты клуба</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.live?.motion && this.reduced.matches) { this.cancel(); this.root.dataset.reducedMotion = 'true'; }
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.frameIndex; delete this.root.dataset.beforeGrid; this.metadataCache.clear(); this.reels.setPins([]); this.reels.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / STUDIO_INFO[this.game].cols)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-hold-caption]').textContent = translateText('Встречай свою комбинацию'); this.find('[data-hold-multiple]').textContent = tr`${STUDIO_INFO[this.game].paylines.length} линий`; this.find('[data-hold-history]').replaceChildren(); this.resetOwnerPresentation(); this.facts(); this.rules(); }
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
    this.find('[data-hold-feature]').textContent = translateText('Монеты остаются на месте во время бонуса');
    for (const key of ["presentation","showcaseLineCount","currentCollection","currentCoinAward","activeAward","selectedLine","selectedCollection","selectedCoinAward","collection","hold","paidPins","currentEvent"]) delete this.root.dataset[key];
    const detail = this.find('[data-hold-award-detail]'); detail.replaceChildren(); detail.hidden = true;
    this.find('[data-hold-line-list]').replaceChildren(); this.reels.lineView();
    const catalog = this.find<HTMLDetailsElement>('.hold-line-catalog'); catalog.open = false; catalog.hidden = false;
  }

  private controls() {
    const session = this.session(), active = session?.state === 'active', balance = this.balance(), ready = !!client.accountId && balance !== undefined, blocked = this.blocked();
    const shownBalance = this.live && this.root.dataset.phase !== 'result' ? this.live.balance : balance;
    this.find('[data-hold-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-hold-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-hold-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-hold-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-hold-spin-label]').textContent = active ? translateText('БЕСПЛАТНО') : translateText('ВРАЩАТЬ'); spin.setAttribute('aria-label', active ? tr`Бесплатное вращение, осталось ${session.view.studio.remaining}` : translateText('Вращать барабаны'));
    this.find('[data-hold-bonus]').textContent = active ? tr`Бесплатных спинов: ${session.view.studio.remaining}` : translateText('Все линии активны');
    const retry = this.find<HTMLButtonElement>('[data-hold-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-hold-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = translateText('Выбери ставку и вращай барабаны.');
    if (!client.accountId) status = translateText('Войди в аккаунт, чтобы играть на монеты клуба.');
    else if (!ready) status = translateText('Загружаем баланс…');
    else if (client.pending && !client.busy) status = translateText('Ход ещё не подтверждён. Проверь ту же операцию без новой ставки.');
    else if (client.busy && !this.live) status = translateText('Проверяем сохранённый ход…');
    else if (this.live) status = this.root.dataset.phase === 'transforming' ? translateText('Показываем событие этого вращения…') : this.live.accepted ? translateText('Показываем сохранённый результат…') : translateText('Барабаны вращаются. Ждём подтверждение…');
    else if (active) status = translateText('Бонус сохранён. Продолжи бесплатно, чтобы получить общую выплату.');
    else if (this.presentedKey) status = translateText('Раунд завершён. Выплата начислена.');
    if (demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion')) status = translateText('Дождись завершения операции в кошельке клуба.');
    this.find('[data-hold-status]').textContent = status; this.find('[data-hold-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.reels.show(session.view.studio.grid);
    
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance, pinsBefore:active?this.cashPins(session):[] };
    this.live = live; observeExpansionOutcome(this.root, this.game, this.session(), client.accountId, true, true); this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; this.facts();
    this.phase(live.motion ? 'accelerating' : 'spinning'); this.reels.begin(live.token, live.motion, live.pinsBefore); this.audio.begin(live.token, { motion: live.motion, click: live.motion && !active, stage:active?'hold':'base' }); this.controls();
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
    const motion = new StudioMotion(() => this.live === live && !this.destroyed && client.accountId === live.account && !document.hidden && !this.reduced.matches);
    this.secondaryMotion = motion; clearTimeout(this.secondaryWatchdog);
    this.secondaryWatchdog = setTimeout(() => { if (this.live === live) { this.cancel(); this.sync(); } }, 35000);
    const metadata = live.motion ? await this.presentation(session, live) : undefined;
    if (this.live !== live || this.destroyed || document.hidden) return;
    this.root.dataset.presentation = metadata ? 'available' : 'static';
    if (metadata) { this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid); this.metadataCache.set(`${session.id}:${session.view.studio.step}`, metadata); }
    const complete = await this.reels.settle(live.token, metadata?.beforeGrid ?? session.view.studio.grid);
    if (!complete || this.live !== live || this.destroyed || document.hidden) return;
    if (metadata && live.motion) {
      this.phase('transforming'); this.controls(); this.facts(metadata);
      if(live.kind==='move'){this.audio.effect(live.token,'free-stage',`${session.id}:${metadata.phase}:${metadata.step}:free-stage`);if(!await this.delay(480,live))return;}
      this.reels.show(metadata.afterGrid);
    } else this.reels.show(session.view.studio.grid);
    if(this.live!==live)return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.phase('result'); this.showResult(session, -1, !!metadata && live.motion, from); this.facts(metadata, this.shownFrame); this.history(session);
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!metadata || !live.motion) { outcome(); this.finish(live, total); return; }
    const pendingPositions = new Set(metadata.hold!.awards.map(award=>award.position));
    const visiblePins = this.cashPins(session).filter(pin=>!pendingPositions.has(pin.position));
    this.reels.setPins(visiblePins);
    for (const award of metadata.hold!.awards) this.root.querySelector<HTMLElement>(`[data-hold-award-button="${award.winIndex}"]`)?.setAttribute('hidden','');
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
    delete this.root.dataset.currentCollection;
    for(const [index,award] of metadata.hold!.awards.entries()){
      this.phase('locking');this.root.dataset.currentCoinAward=JSON.stringify(award);this.highlight(award.winIndex);
      const pin=this.cashPins(session).find(value=>value.position===award.position);if(pin)visiblePins.push(pin);this.reels.setPins(visiblePins);
      this.root.querySelector<HTMLElement>(`[data-hold-award-button="${award.winIndex}"]`)?.removeAttribute('hidden');
      this.reels.revealCoin(award.position);
      if(index<3)this.audio.coin(live.token,award.winIndex,`${session.id}:${metadata.phase}:${metadata.step}:coin:${award.winIndex}`);
      if(!await this.delay(index<3?320:200,live))return;
    }
    delete this.root.dataset.currentCoinAward;this.reels.setPins(this.cashPins(session));this.reels.clearTransforms();this.phase('result');
    outcome();
    const began = performance.now();
    const count = (now: number) => { if (this.live !== live) return; const progress = Math.max(0, Math.min(1, (now - began) / 1000)); this.setPayout(from + Math.floor((total - from) * (1 - (1 - progress) ** 3)), total); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0; };
    this.payoutFrame = requestAnimationFrame(count); this.schedule(() => this.finish(live, total), 1000); this.controls();
  }

  private finish(live: LiveStage, total: number) { if (this.live !== live) return; clearTimeout(this.secondaryWatchdog); this.secondaryMotion?.cancel(); this.secondaryMotion=undefined; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); if (!this.destroyed && !document.hidden && client.accountId === live.account) observeExpansionOutcome(this.root, this.game, this.shownSession, client.accountId, false, false); }
  private static(session: SlotSession, index = -1) { this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.root.dataset.presentation = 'static'; this.phase('result'); if (!this.stakeChosen || session.state === 'active') this.stake = session.stakeUnits; this.showResult(session, index, false); this.facts(this.metadataCache.get(`${session.id}:${index < 0 ? session.view.studio.step : index}`), this.shownFrame); this.history(session); this.rules(); this.controls(); }
  private showResult(session: SlotSession, index: number, animate: boolean, initialPayout = 0) {
    this.clearWins(); const view = session.view.studio, frame = index < 0 ? view.history.at(-1)! : view.history[index]; this.shownFrame = frame; this.shownSession = session; this.shownIndex = index; this.reels.setPins(this.cashPins(session,index)); this.reels.show(frame.grid); this.root.dataset.frameIndex = String(index < 0 ? view.step : index);
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits); this.setPayout(animate ? initialPayout : total, total);
    this.find('[data-hold-caption]').textContent = session.state === 'active' ? translateText('Накоплено за раунд') : translateText('Начислено за раунд'); this.find('[data-hold-multiple]').textContent = total ? tr`${number(total / stake)}× за раунд` : tr`${STUDIO_INFO[this.game].paylines.length} линий`;
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-hold-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    this.find('[data-hold-feature]').textContent = tr`Сохранённый этап ${(index < 0 ? view.step : index) + 1}: +${amount(frame.payoutUnits)} монет`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-hold-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.holdCell))));
    this.find('[data-hold-award-list]').innerHTML = frame.wins.flatMap((win, winIndex) => win.kind === 'collect' || win.kind === 'coin' ? [`<button type="button" data-hold-award-button="${winIndex}" data-award-kind="${win.kind}"><span>${win.kind==='coin'?tr`Монета ${win.positions[0]+1}`:tr`Сборщик ${frame.wins.slice(0,winIndex+1).filter(item=>item.kind==='collect').length}`}</span><strong>+${amount(win.payoutUnits)}</strong></button>`] : []).join('');
    this.find('.hold-line-catalog').hidden=frame.stage==='hold'; this.find('[data-hold-line-list]').innerHTML = STUDIO_INFO[this.game].paylines.map((rows, line) => { const win = frame.wins.find(item => item.kind === 'line' && item.line === line); return `<button type="button" data-hold-line="${line}" data-line-vector="${rows.join(',')}" aria-pressed="false">${line + 1}<small>${win ? `+${amount(win.payoutUnits)}` : translateText('Без награды')}</small></button>`; }).join(''); this.highlight();
  }
  private cashPins(session:SlotSession,index=-1):HoldPin[]{
    const view=session.view.studio,current=index<0?view.step:index,first=new Map<number,string>();
    for(const frame of view.history.slice(0,current+1))for(const win of frame.wins)if(win.kind==='coin'&&!first.has(win.positions[0]))first.set(win.positions[0],win.payoutUnits);
    return [...first].filter(([position])=>view.history[current].grid[position]===5).map(([position,payoutUnits])=>({position,payoutUnits}));
  }
  private awards():StudioCollectionPresentationAward[]{const frame=this.shownFrame;return frame?.stage==='base'?frame.wins.flatMap((win,winIndex)=>win.kind==='collect'?[{winIndex,collector:win.positions[0],coins:win.positions.slice(1).map(position=>({position,rawValue:2+position%4}))}]:[]):[];}
  private coinAwards():StudioHoldPresentationAward[]{return this.shownFrame?.wins.flatMap((win,winIndex)=>win.kind==='coin'?[{winIndex,position:win.positions[0],rawValue:2+win.positions[0]%4}]:[])??[];}
  private highlight(winIndex?: number, explicitLine?: number) {
    const selected = winIndex === undefined || winIndex < 0 ? undefined : this.shownFrame?.wins[winIndex];
    const line = explicitLine ?? (selected?.kind === 'line' ? selected.line : undefined);
    const rows = line === undefined ? undefined : STUDIO_INFO[this.game].paylines[line];
    const positions = new Set(selected?.positions ?? rows?.map((row, column) => row * STUDIO_INFO[this.game].cols + column) ?? []);
    this.root.dataset.activeAward = selected ? String(winIndex) : ''; this.root.dataset.selectedLine = line === undefined ? '' : String(line); this.reels.lineView(rows);
    this.root.querySelectorAll<HTMLElement>('[data-hold-cell]').forEach(cell => cell.classList.toggle('active-win', positions.has(Number(cell.dataset.holdCell))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-hold-award-button]').forEach(button => button.setAttribute('aria-pressed', String((selected?.kind === 'collect' || selected?.kind === 'coin') && Number(button.dataset.holdAwardButton) === winIndex)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-hold-line]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.holdLine) === line)));
    const detail = this.find('[data-hold-award-detail]'); detail.hidden = !selected && line === undefined; delete this.root.dataset.selectedCollection;delete this.root.dataset.selectedCoinAward;
    if (!selected) { detail.textContent = line === undefined ? '' : tr`Линия ${line + 1}: в этом этапе без награды`; return; }
    if(selected.kind==='coin'){const position=selected.positions[0];this.root.dataset.selectedCoinAward=JSON.stringify({winIndex,position,rawValue:2+position%4,payoutUnits:selected.payoutUnits});detail.textContent=tr`Монета ${position+1}: вес ${2+position%4}. Награда: ${amount(selected.payoutUnits)} монет, уже учтена в общей сумме.`;this.find('[data-hold-feature]').textContent=tr`Монета закреплена: +${amount(selected.payoutUnits)} монет`;} else if (selected.kind === 'collect') {
      const award = this.awards().find(item => item.winIndex === winIndex)!; this.root.dataset.selectedCollection = JSON.stringify(award);
      detail.textContent = tr`Сокровищ: ${award.coins.length}. Вес: ${award.coins.map(coin => coin.rawValue).join(' + ')}. Выплата награды: ${amount(selected.payoutUnits)} монет.`;
      this.find('[data-hold-feature]').textContent = tr`Сборщик получает все сокровища (${award.coins.length}): +${amount(selected.payoutUnits)} монет`;
    } else {
      detail.textContent = tr`Линия ${line! + 1}: цепочка ${selected.count}, +${amount(selected.payoutUnits)} монет`;
      this.find('[data-hold-feature]').textContent = tr`${HOLD_SYMBOL_NAMES[this.game][selected.symbol]}: линия ${line! + 1}, +${amount(selected.payoutUnits)} монет`;
    }
  }
  private facts(metadata?:StudioSlotPresentation,frame?:StudioSlotFrame){
    delete this.root.dataset.collection;delete this.root.dataset.hold;delete this.root.dataset.beforeGrid;
    const coins=frame?.grid.filter(symbol=>symbol===5).length??0,pins=frame&&this.shownSession?this.cashPins(this.shownSession,this.shownIndex):this.live?.pinsBefore??[];
    this.root.dataset.paidPins=JSON.stringify(pins);this.find('[data-hold-key-art]').innerHTML=holdSymbol(this.game,5);
    this.find('[data-hold-key]').textContent=pins.length?tr`Закреплено монет: ${pins.length}`:frame?tr`Монеты на поле: ${coins}`:translateText('Три монеты открывают бонус');
    const index=frame?this.shownIndex<0?this.shownSession!.view.studio.step:this.shownIndex:-1;
    this.find('[data-hold-key-detail]').textContent=index<0?translateText('Ровно два бесплатных этапа, без продления'):frame!.stage==='hold'?tr`Бесплатный этап ${index} из 2. Новых наград: ${this.coinAwards().length}`:this.shownSession!.state==='active'?translateText('Открыты два бесплатных этапа, без новой ставки'):translateText('Основной этап завершён. Выплата уже учтена.');
    if(frame){this.root.dataset.collection=JSON.stringify({awards:this.awards()});this.root.dataset.hold=JSON.stringify({coinValues:frame.held.map(position=>({position,rawValue:2+position%4})),awards:this.coinAwards()});}
    if(metadata)this.root.dataset.beforeGrid=JSON.stringify(metadata.beforeGrid);
  }

  private history(session: SlotSession) { this.find('[data-hold-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-hold-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? tr`Бесплатный ${index}` : translateText('Основной')} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-hold-bigwin]').hidden = true; delete this.root.dataset.selectedCollection;delete this.root.dataset.selectedCoinAward; this.root.querySelectorAll<HTMLElement>('[data-hold-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-hold-award-list]').replaceChildren(); this.find('[data-hold-award-detail]').hidden = true; }

  private setPayout(units: number, target: number) { this.find('[data-hold-amount]').textContent = amount(units); const ways = this.find('[data-hold-payout]'); ways.dataset.units = String(units); ways.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-hold-paytable]').innerHTML = studioSlotPaytable(this.game).filter(row => row.symbol < 3).map(row => `<div>${holdSymbol(this.game, row.symbol)}<span>${HOLD_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => tr`<small>${pay.count} подряд: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-hold-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} монет: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }

  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-hold-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук')); this.find('[data-hold-audio-label]').textContent = prefs.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-hold-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { resetGameOutcomes(this.root); clearTimeout(this.secondaryWatchdog); this.secondaryMotion?.cancel(); this.secondaryMotion=undefined; this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.reels.cancel(); this.reels.clearTransforms();  cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; delete this.root.dataset.currentCollection; delete this.root.dataset.currentEvent;delete this.root.dataset.currentCoinAward; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.reels.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
