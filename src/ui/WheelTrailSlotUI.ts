import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import { StudioMotion } from './StudioMotion';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { WheelTrailReels } from './WheelTrailReels';
import { wheelTrailSymbol, flowerWheel, WHEEL_TRAIL_SYMBOL_NAMES, type WheelTrailSlotGame } from './WheelTrailArtwork';
import './wheel-trail-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
const reelsLabel = (count: number) => `${count} ${count >= 2 && count <= 4 ? translateText('барабана') : translateText('барабанов')}`;
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class WheelTrailSlotUI {
  private secondaryMotion?:StudioMotion;
  private secondaryWatchdog?:ReturnType<typeof setTimeout>;
  private root: HTMLElement; private reels: WheelTrailReels; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private wheelAnimation?:Animation;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private metadataCache = new Map<string, StudioSlotPresentation>();
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: WheelTrailSlotGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-wheel-trail-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new WheelTrailReels(this.find('[data-wheel-trail-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-wheel-trail-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-wheel-trail-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-wheel-trail-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-wheel-trail-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-wheel-trail-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-wheel-trail-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-wheel-trail-line-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-trail-line]'); if (button && !this.live) { const line = Number(button.dataset.wheelTrailLine); this.highlight(this.shownFrame?.wins.findIndex(win => win.kind === 'line' && win.line === line), line); } };
    this.find('[data-wheel-trail-award-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-trail-award-button]'); if (button && !this.live) this.highlight(Number(button.dataset.wheelTrailAwardButton)); };
    this.find('[data-wheel-trail-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-wheel-trail-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.wheelTrailFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.phase}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'transforming' | 'wheel' | 'trail' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.wheelTrailState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup(){const info=STUDIO_INFO[this.game],petal=this.game==='studio-petal-parlor';return tr`<section class="wheel-trail-slot wheel-trail-${petal?'petal':'sunbird'}" data-wheel-trail-slot="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
<header class="wheel-trail-heading"><div><span>ROYAL WORLDS</span><h3>${info.name}</h3><p>${petal?translateText('Цветы, мягкий свет и два бонусных колеса'):translateText('Янтарные искры на тропе жар-птицы')}</p></div><div class="wheel-trail-balance"><small>USDT · Nile</small><strong data-wheel-trail-balance data-studio-balance>…</strong></div></header>
<div class="wheel-trail-cabinet"><div class="wheel-trail-scenery" aria-hidden="true"><i class="wheel-trail-backdrop"></i></div><div class="wheel-trail-marquee"><span>${petal?'PETAL PARLOR':'SUNBIRD TRAILS'}</span><small>10 ЛИНИЙ</small></div><div class="wheel-trail-facts-panel"><div data-wheel-trail-key-art aria-hidden="true"></div><strong data-wheel-trail-key>Три бонусных знака открывают два этапа</strong><small data-wheel-trail-key-detail>Бесплатные вращения не продлеваются</small></div>
<div class="wheel-trail-frame"><div class="wheel-trail-reels" data-wheel-trail-reels role="group" aria-label="Пять барабанов, три ряда"></div></div>
<div class="wheel-trail-special-result"><div class="wheel-trail-special" data-wheel-trail-special></div><div><div class="wheel-trail-result studio-stage-payout"><span data-wheel-trail-caption>Встречай свою комбинацию</span><strong data-wheel-trail-payout data-units="0" data-target-units="0"><span data-wheel-trail-amount>0,00</span><small> USDT</small></strong><span class="wheel-trail-bigwin" data-wheel-trail-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div><div class="wheel-trail-special-reward" data-wheel-trail-special-reward></div></div></div>
<div class="wheel-trail-feature" data-wheel-trail-feature role="status">${petal?translateText('Колесо появляется в каждом бесплатном этапе'):translateText('Множитель уже учитывается в наградах линий')}</div>
<div class="wheel-trail-console"><label>Ставка за раунд<select data-wheel-trail-stake data-stake>${DEMO_BETS.map(v=>`<option value="${v*100}">${amount(v*100)}</option>`).join('')}</select></label><button type="button" class="wheel-trail-spin" data-wheel-trail-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-wheel-trail-spin-label>ВРАЩАТЬ</span></button><div class="wheel-trail-round-info"><small data-wheel-trail-bonus>Все линии активны</small><strong data-wheel-trail-multiple>10 линий</strong></div></div></div>
<div class="wheel-trail-history" data-wheel-trail-history aria-label="Сохранённые этапы раунда"></div><div class="wheel-trail-award-list" data-wheel-trail-award-list aria-label="Награды показанного этапа"></div><div class="wheel-trail-award-detail" data-wheel-trail-award-detail hidden></div><details class="wheel-trail-line-catalog"><summary>Посмотреть все 10 линий</summary><div data-wheel-trail-line-list></div></details><p class="wheel-trail-status" data-wheel-trail-status role="status"></p><p class="wheel-trail-error studio-error" data-wheel-trail-error role="alert"></p>
<div class="wheel-trail-tools"><div class="wheel-trail-audio"><button type="button" data-wheel-trail-mute aria-pressed="false"><span data-wheel-trail-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-wheel-trail-volume aria-label="Громкость игры"></label></div><div><button type="button" data-wheel-trail-retry data-retry hidden>Проверить ход</button><button type="button" data-wheel-trail-refresh data-refresh>Обновить</button></div></div>
<details class="wheel-trail-rules"><summary>Правила, символы и выплаты</summary><p>На основном поле три или больше бонусных знака открывают ровно два бесплатных вращения. Новая ставка не нужна. Бонус не продлевается, символы не закрепляются.</p><p>Активны все 10 линий. От трёх обычных знаков подряд слева дают одну лучшую награду линии. WILD заменяет обычные знаки.</p><p>${petal?translateText('В каждом бесплатном этапе появляется одно отдельное цветочное колесо. Оно показывает сектор от 1 до 6 и свою награду, не меняя символ на поле. Два бесплатных этапа дают два колеса, без третьего этапа или дополнительного джекпота. Номер сектора не означает сумму в кошельке.'):translateText('Искры солнца усиливают награды линий текущего поля: множитель равен 1 плюс номер этапа (0,1 или2) плюс число искр. Достижимый максимум 7×. Множитель уже включён в каждую показанную награду линии. Искры не дают отдельную монетную выплату и не сохраняются на следующий этап. Ниже указаны базовые коэффициенты при 1×.')}</p><div class="wheel-trail-paytable" data-wheel-trail-paytable></div><p data-wheel-trail-rtp></p><p>Ставка указана за все линии и весь раунд. Коэффициент каждой награды округляется вниз до четырёх знаков, затем выплата до 0,01 USDT. На счёт поступает общая выплата за завершённый раунд. История и проверка прежнего хода не требуют новой ставки.</p></details><p class="wheel-trail-demo-note">Игра на тестовый USDT Nile</p></section>`;}

  private sync() {
    if (this.destroyed) return;
    if (this.live?.motion && this.reduced.matches) { this.cancel(); this.root.dataset.reducedMotion = 'true'; }
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.frameIndex; delete this.root.dataset.beforeGrid; this.metadataCache.clear(); this.find('[data-wheel-trail-line-list]').replaceChildren(); this.find('[data-wheel-trail-award-detail]').textContent = ''; this.find('[data-wheel-trail-feature]').textContent = this.game === 'studio-petal-parlor' ? translateText('Колесо появляется в каждом бесплатном этапе') : translateText('Множитель уже учитывается в наградах линий'); delete this.root.dataset.selectedLine; delete this.root.dataset.activeAward; this.root.dataset.showcaseLineCount = '0'; this.reels.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / STUDIO_INFO[this.game].cols)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-wheel-trail-caption]').textContent = translateText('Встречай свою комбинацию'); this.find('[data-wheel-trail-multiple]').textContent = tr`${STUDIO_INFO[this.game].paylines.length} линий`; this.find('[data-wheel-trail-history]').replaceChildren(); this.facts(); this.rules(); }
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

  private controls() {
    const session = this.session(), active = session?.state === 'active', balance = this.balance(), ready = !!client.accountId && balance !== undefined, blocked = this.blocked();
    const shownBalance = this.live && this.root.dataset.phase !== 'result' ? this.live.balance : balance;
    this.find('[data-wheel-trail-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-wheel-trail-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-wheel-trail-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-wheel-trail-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-wheel-trail-spin-label]').textContent = active ? translateText('БЕСПЛАТНО') : translateText('ВРАЩАТЬ'); spin.setAttribute('aria-label', active ? tr`Бесплатное вращение, осталось ${session.view.studio.remaining}` : translateText('Вращать барабаны'));
    this.find('[data-wheel-trail-bonus]').textContent = active ? tr`Бесплатных спинов: ${session.view.studio.remaining}` : translateText('Все линии активны');
    const retry = this.find<HTMLButtonElement>('[data-wheel-trail-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-wheel-trail-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
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
    this.find('[data-wheel-trail-status]').textContent = status; this.find('[data-wheel-trail-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.reels.show(session.view.studio.grid);
    
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance };
    this.live = live; observeExpansionOutcome(this.root, this.game, this.session(), client.accountId, true, true); this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; this.facts();
    this.phase(live.motion ? 'accelerating' : 'spinning'); this.reels.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion, click: live.motion && !active, ...(active?{bonusStep:(session.view.studio.step+1) as 1|2}:{}) }); this.controls();
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
    if(metadata&&live.motion){this.phase('spinning');this.reels.show(metadata.afterGrid);}else this.reels.show(session.view.studio.grid);
    if(this.live!==live)return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    const pendingWheel = !!metadata?.wheels?.awards.length && live.motion;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step);
    if (pendingWheel) { this.showPendingWheel(session, from); this.facts(undefined, this.shownFrame); }
    else { this.phase('result'); this.showResult(session, -1, !!metadata && live.motion, from); this.facts(metadata, this.shownFrame); this.history(session); }
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!metadata || !live.motion) { outcome(); this.finish(live, total); return; }
    if(live.kind==='move'){this.audio.effect(live.token,'free-stage',`${session.id}:${metadata.phase}:${metadata.step}:free`);if(!await this.delay(400,live))return;}
    if(metadata.wheels?.awards.length){
      const award=metadata.wheels.awards[0];this.phase('wheel');
      this.audio.wheel(live.token,award.winIndex,`${session.id}:${metadata.phase}:${metadata.step}:wheel:${award.winIndex}`,award.count);
      if(!await this.rotateWheel(award.count,live))return;
      this.showResult(session, -1, true, from); this.facts(metadata, this.shownFrame); this.history(session);
      this.root.dataset.currentWheelAward=JSON.stringify(award);this.highlight(award.winIndex);delete this.root.dataset.currentWheelAward;
    }
    if(metadata.trail?.awards.length){
      const award=metadata.trail.awards[0];this.phase('trail');this.root.dataset.currentTrail=JSON.stringify(metadata.trail);this.markPositions(metadata.trail.coinPositions);
      this.audio.trail(live.token,award.winIndex,`${session.id}:${metadata.phase}:${metadata.step}:trail`,metadata.trail.factor);
      const factor=this.find<HTMLElement>('[data-wheel-trail-factor]'), previous=this.shownSession?.view.studio.history.at(-2);
      const previousFactor=previous?this.factor(previous,session.view.studio.step-1):1;
      factor.querySelector('strong')!.textContent=`${previousFactor??1}×`;
      const sources=metadata.trail.coinPositions.map(position=>this.find(`[data-wheel-trail-cell="${position}"]`));
      if(!await motion.carry(this.root,sources,factor,'trail'))return;
      if(!await motion.factor(factor,metadata.trail.factor))return;
      factor.querySelector('strong')!.textContent=`${metadata.trail.factor}×`;delete this.root.dataset.currentTrail;
    }
    const lines=this.shownFrame!.wins.map((win,winIndex)=>({win,winIndex})).filter(v=>v.win.kind==='line');this.root.dataset.showcaseLineCount=String(Math.min(3,lines.length));
    for(const {win,winIndex} of lines.slice(0,3)){this.highlight(winIndex);this.audio.line(live.token,win.line!);if(!await this.delay(320,live))return;}
    this.reels.clearTransforms();this.phase('result');
    outcome();
    const began = performance.now();
    const count = (now: number) => { if (this.live !== live) return; const progress = Math.max(0, Math.min(1, (now - began) / 1000)); this.setPayout(from + Math.floor((total - from) * (1 - (1 - progress) ** 3)), total); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0; };
    this.payoutFrame = requestAnimationFrame(count); this.schedule(() => this.finish(live, total), 1000); this.controls();
  }

  private showPendingWheel(session: SlotSession, previousPayout: number) {
    this.clearWins(); this.shownFrame = session.view.studio.history.at(-1)!; this.shownSession = session; this.shownIndex = -1;
    this.root.dataset.frameIndex = String(session.view.studio.step); this.highlight();
    delete this.root.dataset.wheelCount; delete this.root.dataset.currentWheelAward; delete this.root.dataset.selectedWheelAward; delete this.root.dataset.showcaseLineCount;
    this.find('[data-wheel-trail-line-list]').replaceChildren(); this.find('[data-wheel-trail-history]').replaceChildren();
    this.setPayout(previousPayout, previousPayout); this.find('[data-wheel-trail-caption]').textContent = translateText('Накоплено до этого этапа');
    this.find('[data-wheel-trail-multiple]').textContent = translateText('Бонусное колесо'); this.find('[data-wheel-trail-feature]').textContent = translateText('Цветочное колесо вращается');
    this.find('[data-wheel-trail-special]').innerHTML = `<div class="wheel-trail-wheel" data-wheel-trail-wheel><i class="wheel-trail-pointer"></i>${flowerWheel()}</div>`;
    this.find('[data-wheel-trail-special-reward]').textContent = ''; this.phase('wheel'); this.controls();
  }
  private finish(live: LiveStage, total: number) { if (this.live !== live) return; clearTimeout(this.secondaryWatchdog); this.secondaryMotion?.cancel(); this.secondaryMotion=undefined; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); if (!this.destroyed && !document.hidden && client.accountId === live.account) observeExpansionOutcome(this.root, this.game, this.shownSession, client.accountId, false, false); }
  private static(session: SlotSession, index = -1) { this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.root.dataset.presentation = 'static'; this.phase('result'); if (!this.stakeChosen || session.state === 'active') this.stake = session.stakeUnits; this.showResult(session, index, false); this.facts(this.metadataCache.get(`${session.id}:${index < 0 ? session.view.studio.step : index}`), this.shownFrame); this.history(session); this.rules(); this.controls(); }
  private showResult(session: SlotSession, index: number, animate: boolean, initialPayout = 0) {
    this.clearWins(); const view = session.view.studio, frame = index < 0 ? view.history.at(-1)! : view.history[index]; this.shownFrame = frame; this.shownSession = session; this.shownIndex = index; this.reels.show(frame.grid); this.root.dataset.frameIndex = String(index < 0 ? view.step : index);
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits); this.setPayout(animate ? initialPayout : total, total);
    this.find('[data-wheel-trail-caption]').textContent = session.state === 'active' ? translateText('Накоплено за раунд') : translateText('Начислено за раунд'); this.find('[data-wheel-trail-multiple]').textContent = total ? tr`${number(total / stake)}× за раунд` : tr`${STUDIO_INFO[this.game].paylines.length} линий`;
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-wheel-trail-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    this.find('[data-wheel-trail-feature]').textContent = tr`Сохранённый этап ${(index < 0 ? view.step : index) + 1}: +${amount(frame.payoutUnits)} USDT`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-wheel-trail-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.wheelTrailCell))));
    this.find('[data-wheel-trail-award-list]').innerHTML=frame.wins.map((win,winIndex)=>`<button type="button" data-wheel-trail-award-button="${winIndex}" data-award-kind="${win.kind}"><span>${win.kind==='wheel'?tr`Колесо, сектор ${win.count}`:tr`Линия ${(win.line??0)+1}`}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join('');
    this.find('[data-wheel-trail-line-list]').innerHTML=STUDIO_INFO[this.game].paylines.map((rows,line)=>{const win=frame.wins.find(v=>v.kind==='line'&&v.line===line);return `<button type="button" data-wheel-trail-line="${line}" data-line-vector="${rows.join(',')}" aria-pressed="false">${line+1}<small>${win?`+${amount(win.payoutUnits)}`:translateText('Без награды')}</small></button>`;}).join('');this.showSpecial(frame);this.highlight();
  }
  private factor(frame:StudioSlotFrame,index:number){const factor=Math.min(8,1+index+frame.grid.filter(v=>v===5).length);return factor>=1&&factor<=8?factor:undefined;}
  private showSpecial(frame?:StudioSlotFrame){
    const well=this.find('[data-wheel-trail-special]'),reward=this.find('[data-wheel-trail-special-reward]');delete this.root.dataset.wheelCount;delete this.root.dataset.trailFactor;
    if(!frame){well.innerHTML=`<div class="wheel-trail-special-idle">${wheelTrailSymbol(this.game,this.game==='studio-petal-parlor'?0:5)}</div>`;reward.textContent='';return;}
    const index=this.shownIndex<0?this.shownSession!.view.studio.step:this.shownIndex;
    if(this.game==='studio-petal-parlor'){
      const win=frame.wins.find(v=>v.kind==='wheel');well.innerHTML=win?`<div class="wheel-trail-wheel" data-wheel-trail-wheel data-count="${win.count}"><i class="wheel-trail-pointer"></i>${flowerWheel(win.count)}</div>`:`<div class="wheel-trail-special-idle">${wheelTrailSymbol(this.game,0)}</div>`;
      if(win){this.root.dataset.wheelCount=String(win.count);this.find<SVGElement & HTMLElement>('.wheel-trail-wheel-disk').style.transform=`rotate(${-(win.count-1)*60}deg)`;reward.textContent=tr`Колесо: +${amount(win.payoutUnits)} USDT`;}else reward.textContent=translateText('Колесо появляется в бонусе');
    }else{const factor=this.factor(frame,index);well.innerHTML=factor===undefined?`<div class="wheel-trail-special-idle">${wheelTrailSymbol(this.game,5)}</div>`:tr`<div class="wheel-trail-factor" data-wheel-trail-factor="${factor}"><strong>${factor}×</strong><small>МНОЖИТЕЛЬ</small></div>`;if(factor!==undefined)this.root.dataset.trailFactor=String(factor);reward.textContent=frame.wins.some(v=>v.kind==='line')?translateText('Уже учтён в наградах линий'):translateText('В этом этапе нет награды линий');}
  }
  private async rotateWheel(count:number,live:LiveStage){const disk=this.root.querySelector<SVGElement>('.wheel-trail-wheel-disk');if(!disk)return false;const animation=disk.animate([{transform:'rotate(0deg)'},{transform:`rotate(${720-(count-1)*60}deg)`}],{duration:1050,easing:'cubic-bezier(.12,.62,.25,1)',fill:'none'});this.wheelAnimation=animation;try{await animation.finished;return this.live===live;}catch{return false;}finally{if(this.wheelAnimation===animation)this.wheelAnimation=undefined;}}
  private markPositions(positions:readonly number[]){this.root.querySelectorAll<HTMLElement>('[data-wheel-trail-cell]').forEach(cell=>cell.classList.toggle('feature',positions.includes(Number(cell.dataset.wheelTrailCell))));}
  private highlight(winIndex?:number,explicitLine?:number){
    const selected=winIndex===undefined||winIndex<0?undefined:this.shownFrame?.wins[winIndex],line=explicitLine??(selected?.kind==='line'?selected.line:undefined),rows=line===undefined?undefined:STUDIO_INFO[this.game].paylines[line],positions=new Set(selected?.positions??rows?.map((row,col)=>row*STUDIO_INFO[this.game].cols+col)??[]);
    this.root.dataset.activeAward=selected?String(winIndex):'';this.root.dataset.selectedLine=line===undefined?'':String(line);this.reels.lineView(rows);this.root.querySelectorAll<HTMLElement>('[data-wheel-trail-cell]').forEach(cell=>cell.classList.toggle('active-win',positions.has(Number(cell.dataset.wheelTrailCell))));this.root.querySelectorAll<HTMLButtonElement>('[data-wheel-trail-award-button]').forEach(button=>button.setAttribute('aria-pressed',String(selected&&Number(button.dataset.wheelTrailAwardButton)===winIndex)));this.root.querySelectorAll<HTMLButtonElement>('[data-wheel-trail-line]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.wheelTrailLine)===line)));
    const detail=this.find('[data-wheel-trail-award-detail]');detail.hidden=!selected&&line===undefined;delete this.root.dataset.selectedWheelAward;
    if(!selected){detail.textContent=line===undefined?'':tr`Линия ${line!+1}: в этом этапе без награды`;return;}
    if(selected.kind==='wheel'){this.root.dataset.selectedWheelAward=JSON.stringify({winIndex,position:selected.positions[0],count:selected.count,payoutUnits:selected.payoutUnits});detail.textContent=tr`Сектор ${selected.count}. Награда колеса: ${amount(selected.payoutUnits)} USDT, уже включена в сумму раунда.`;this.find('[data-wheel-trail-feature]').textContent=tr`Цветочное колесо: +${amount(selected.payoutUnits)} USDT`;}else{const factor=this.shownFrame&&this.shownSession?this.factor(this.shownFrame,this.shownIndex<0?this.shownSession.view.studio.step:this.shownIndex):undefined;detail.textContent=tr`Линия ${line!+1}: цепочка ${selected.count}, +${amount(selected.payoutUnits)} USDT${this.game==='studio-sunbird-trails'&&factor?tr`. Множитель ${factor}× уже учтён`:''}`;this.find('[data-wheel-trail-feature]').textContent=tr`${WHEEL_TRAIL_SYMBOL_NAMES[this.game][selected.symbol]}: линия ${line!+1}, +${amount(selected.payoutUnits)} USDT`;}
  }
  private facts(metadata?:StudioSlotPresentation,frame?:StudioSlotFrame){delete this.root.dataset.beforeGrid;delete this.root.dataset.wheels;delete this.root.dataset.trail;
    this.find('[data-wheel-trail-key-art]').innerHTML=wheelTrailSymbol(this.game,4);this.find('[data-wheel-trail-key]').textContent=frame?(this.game==='studio-petal-parlor'?frame.stage==='base'?translateText('Колесо в двух бесплатных этапах'):translateText('Цветочное колесо этого этапа'):translateText('Искры усиливают текущие линии')):translateText('Три бонусных знака открывают два этапа');this.find('[data-wheel-trail-key-detail]').textContent=frame?translateText('Символы остаются прежними после каждого этапа'):translateText('Бесплатные вращения не продлеваются');if(!frame)this.showSpecial();
    if(metadata){this.root.dataset.beforeGrid=JSON.stringify(metadata.beforeGrid);if(metadata.wheels)this.root.dataset.wheels=JSON.stringify(metadata.wheels);if(metadata.trail)this.root.dataset.trail=JSON.stringify(metadata.trail);}
  }

  private history(session: SlotSession) { this.find('[data-wheel-trail-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-wheel-trail-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? tr`Бесплатный ${index}` : translateText('Основной')} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-wheel-trail-bigwin]').hidden = true; delete this.root.dataset.selectedWheelAward; this.root.querySelectorAll<HTMLElement>('[data-wheel-trail-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-wheel-trail-award-list]').replaceChildren(); this.find('[data-wheel-trail-award-detail]').hidden = true; }

  private setPayout(units: number, target: number) { this.find('[data-wheel-trail-amount]').textContent = amount(units); const ways = this.find('[data-wheel-trail-payout]'); ways.dataset.units = String(units); ways.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-wheel-trail-paytable]').innerHTML = studioSlotPaytable(this.game).filter(row => row.symbol < 3).map(row => `<div>${wheelTrailSymbol(this.game, row.symbol)}<span>${WHEEL_TRAIL_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => tr`<small>${pay.count} подряд: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-wheel-trail-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} USDT: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }

  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-wheel-trail-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук')); this.find('[data-wheel-trail-audio-label]').textContent = prefs.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-wheel-trail-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { resetGameOutcomes(this.root); clearTimeout(this.secondaryWatchdog); this.secondaryMotion?.cancel(); this.secondaryMotion=undefined; this.wheelAnimation?.cancel();this.wheelAnimation=undefined;this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.reels.cancel(); this.reels.clearTransforms();  cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; delete this.root.dataset.currentWheelAward;delete this.root.dataset.currentTrail; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.reels.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
