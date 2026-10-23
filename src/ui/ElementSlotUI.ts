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
import { ElementReels } from './ElementReels';
import { elementSymbol, ELEMENT_SYMBOL_NAMES, type ElementSlotGame } from './ElementArtwork';
import './element-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number };

/** Persistent native slot presentation. Saved sessions own all results and bonus progress. */
export class ElementSlotUI {
  private secondaryMotion?:StudioMotion;
  private secondaryWatchdog?:ReturnType<typeof setTimeout>;
  private root: HTMLElement; private reels: ElementReels; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private metadataCache = new Map<string, StudioSlotPresentation>();
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: ElementSlotGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-element-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.reels = new ElementReels(this.find('[data-element-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-element-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-element-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-element-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-element-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-element-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-element-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-element-line-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-element-line-button]'); if (button && !this.live) this.highlight(Number(button.dataset.elementLineButton)); };
    this.find('[data-element-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-element-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.elementFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'transforming' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.elementState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info = STUDIO_INFO[this.game], forge = this.game === 'studio-stormforge-duel', cipher = this.game === 'studio-saffron-cipher';
    const theme = forge ? 'forge' : cipher ? 'cipher' : 'beacon';
    const title = forge ? 'STORMFORGE DUEL' : cipher ? 'SAFFRON CIPHER' : 'BEACON BAY';
    const subtitle = forge ? translateText('Огонь и молния. Сила каждой линии.') : cipher ? translateText('Один ключ. Три колонны открывают шифр.') : translateText('Луч маяка ведёт вверх и вниз.');
    const description = forge ? translateText('Любой WILD раскрывается на всю свою колонну. В оплаченной цепочке WILD усиливают именно эту линию: 2×, 3× или 4×. WILD не закрепляется на следующем вращении.') : cipher ? translateText('Ключом становится исходная верхняя левая Лазурная печать, Шафрановое перо или Алый свиток. При другом знаке ключом становится Лазурная печать. Если ключ встречается в трёх разных колоннах, каждая такая колонна целиком превращается в WILD. Ключ определяется заново на каждом этапе, выбора игрока нет.') : translateText('Луч создаёт только WILD в средней строке. Он раскрывается вверх и вниз на всю свою колонну. WILD сверху или снизу заменяет знак, но луч не запускает.');
    return tr`<section class="element-slot element-${theme}" data-element-slot="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-element-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="element-heading"><div><span>ROYAL STUDIO</span><h3>${info.name}</h3><p>${subtitle}</p></div><div class="element-balance"><small>USDT · Демо</small><strong data-element-balance data-studio-balance>…</strong></div></header>
      <div class="element-cabinet"><div class="element-scenery" aria-hidden="true">${forge ? '<i class="element-fire"></i><i class="element-storm"></i>' : cipher ? '<i class="element-script"></i><i class="element-seal"></i>' : '<i class="element-horizon"></i><i class="element-coast"></i>'}</div><div class="element-marquee"><span>${title}</span><small>${info.paylines.length} ЛИНИЙ</small></div>
        <div class="element-key-panel" data-element-key-panel ${cipher ? '' : 'hidden'}><span>КЛЮЧ ЭТАПА</span><div data-element-key-art aria-hidden="true"></div><strong data-element-key>Раскроется после остановки</strong><small data-element-key-detail>Новый ключ на каждом вращении</small></div>
        <div class="element-frame"><div class="element-reels" data-element-reels role="group" aria-label="Пять барабанов, три ряда"><svg class="element-lines" data-element-lines viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden="true"></svg></div></div>
        <div class="element-feature" data-element-feature role="status">${forge ? translateText('Огонь и молния раскрывают WILD') : cipher ? translateText('Ключ должен встретиться в трёх колоннах') : translateText('Луч начинается только в средней строке')}</div>
        <div class="element-result studio-stage-payout"><span data-element-caption>Поймай свою комбинацию</span><strong data-element-payout data-units="0" data-target-units="0"><span data-element-amount>0,00</span><small> USDT</small></strong><span class="element-bigwin" data-element-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="element-console"><label>Ставка за раунд<select data-element-stake data-stake>${DEMO_BETS.map(value => `<option value="${value * 100}">${amount(value * 100)}</option>`).join('')}</select></label><button type="button" class="element-spin" data-element-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-element-spin-label>ВРАЩАТЬ</span></button><div class="element-round-info"><small data-element-bonus>Все линии активны</small><strong data-element-multiple>WILD заменяет знаки</strong></div></div>
      </div><div class="element-history" data-element-history aria-label="Сохранённые этапы раунда"></div><div class="element-line-list" data-element-line-list aria-label="Выплаты линий"></div>
      <p class="element-status" data-element-status role="status"></p><p class="element-error studio-error" data-element-error role="alert"></p>
      <div class="element-tools"><div class="element-audio"><button type="button" data-element-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-element-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-element-volume aria-label="Громкость игры"></label></div><div><button type="button" data-element-retry data-retry hidden>Проверить ход</button><button type="button" data-element-refresh data-refresh>Обновить</button></div></div>
      <details class="element-rules"><summary>Правила, символы и линии</summary><p>${description} Три SCATTER на итоговом поле после преобразования открывают ровно два бесплатных новых вращения без новой ставки. В них нет каскадов, закреплений или продления. Накопленное начисляется после завершения всего раунда.</p><p>Базовые награды за одну линию, до усиления WILD. Выбирается одна лучшая цепочка слева от трёх символов. Отдельной оплаты WILD или декоративного знака нет.</p><div class="element-paytable" data-element-paytable></div><div class="element-rule-lines">${info.paylines.map((line, index) => `<div><small>${index + 1}</small><svg viewBox="0 0 100 60" aria-hidden="true"><polyline points="${line.map((row, col) => `${10 + col * 20},${10 + row * 20}`).join(' ')}"/></svg></div>`).join('')}</div><p data-element-rtp></p><p>Ставка указана за все линии и весь раунд. Множитель включает ставку. Каждая выплата округляется вниз до 0,01 USDT, затем выплаты суммируются. «Проверить ход» подтверждает прежнюю операцию. Сохранённые этапы можно посмотреть без новой ставки.</p></details><p class="element-demo-note">Игра на тестовый виртуальные USDT</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.beforeGrid; delete this.root.dataset.transformEvents; this.metadataCache.clear(); this.reels.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / 5)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-element-caption]').textContent = translateText('Поймай свою комбинацию'); this.find('[data-element-multiple]').textContent = translateText('WILD заменяет знаки'); this.find('[data-element-history]').replaceChildren(); this.facts(); this.rules(); }
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
    this.find('[data-element-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-element-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-element-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-element-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-element-spin-label]').textContent = active ? translateText('БЕСПЛАТНО') : translateText('ВРАЩАТЬ'); spin.setAttribute('aria-label', active ? tr`Бесплатное вращение, осталось ${session.view.studio.remaining}` : translateText('Вращать барабаны'));
    this.find('[data-element-bonus]').textContent = active ? tr`Бесплатных спинов: ${session.view.studio.remaining}` : translateText('Все линии активны');
    const retry = this.find<HTMLButtonElement>('[data-element-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-element-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
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
    this.find('[data-element-status]').textContent = status; this.find('[data-element-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.reels.show(session.view.studio.grid);
    
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance };
    this.live = live; observeExpansionOutcome(this.root, this.game, this.session(), client.accountId, true, true); this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; this.facts(); this.phase(live.motion ? 'accelerating' : 'spinning'); this.reels.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion, click: live.motion && !active }); this.controls();
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
    if (metadata) { this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid); this.metadataCache.set(this.key(session), metadata); }
    const complete = await this.reels.settle(live.token, metadata?.beforeGrid ?? session.view.studio.grid);
    if (!complete || this.live !== live || this.destroyed || document.hidden) return;
    if (metadata && live.motion) {
      this.phase('transforming'); this.controls();
      if (live.kind === 'move') { this.audio.effect(live.token, 'free-stage', `${session.id}:${metadata.step}:free-stage`); if (!await this.delay(550, live)) return; }
      this.facts(metadata);
      if (metadata.chosen) { this.audio.effect(live.token, 'chosen', `${session.id}:${metadata.step}:chosen:0`); this.find('[data-element-key-panel]').classList.add('revealing-key'); if (!await this.delay(500, live)) return; this.find('[data-element-key-panel]').classList.remove('revealing-key'); }
      this.root.dataset.transformEvents = JSON.stringify(metadata.events);
      for (const event of metadata.events) {
        if (event.kind === 'sticky-wild') continue;
        this.root.dataset.activeColumn = String(event.column); this.reels.expand(event.column, event.sourcePositions, event.kind);
        if (event.kind === 'expand-wild') this.audio.effect(live.token, 'expand', `${session.id}:${metadata.step}:expand:${event.column}`);
        else if (event.kind === 'beam-wild') this.audio.effect(live.token, 'beam', `${session.id}:${metadata.step}:beam:${event.column}`);
        if (!await this.delay(550, live)) return;
        const revealed = [...metadata.beforeGrid];
        for (const shown of metadata.events) { if (shown.kind === 'sticky-wild') continue; if (shown.column === event.column || this.root.querySelector(`[data-element-reel="${shown.column}"].expanding`)) shown.positions.forEach(position => { revealed[position] = metadata.afterGrid[position]; }); }
        this.reels.show(revealed);
      }
      delete this.root.dataset.activeColumn; this.reels.clearTransforms(); this.reels.show(metadata.afterGrid);
    } else this.reels.show(session.view.studio.grid);
    if (this.live !== live) return;
    const total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0, -1).reduce((sum, frame) => sum + BigInt(frame.payoutUnits), 0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.phase('result'); this.showResult(session, -1, !!metadata && live.motion, from); this.facts(metadata); this.history(session);
    const wins = this.shownFrame!.wins;
    const revealedFactors = new Set<number>();
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake * 4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!metadata || !live.motion) { outcome(); this.finish(live, total); return; }
    for (let index = 0; index < wins.length; index++) {
      const win = wins[index]; this.highlight(win.line ?? 0);
      this.find('[data-element-feature]').textContent = tr`Линия ${(win.line ?? 0) + 1}: +${amount(win.payoutUnits)} USDT`;
      const multiplier = metadata.multipliers.find(item => item.winIndex === index);
      if (multiplier) { this.find('[data-element-feature]').textContent = tr`Линия ${multiplier.line + 1}: WILD ×${multiplier.factor}, +${amount(win.payoutUnits)} USDT`; this.root.dataset.multiplierFactor = String(multiplier.factor); this.root.dataset.multiplierWinIndex = String(index); this.audio.effect(live.token, 'multiplier', `${session.id}:${metadata.step}:multiplier:${index}`); if (!revealedFactors.has(multiplier.factor)) { revealedFactors.add(multiplier.factor); if (!await motion.factor(this.find('[data-element-feature]'),multiplier.factor)) return; } else if (!await this.delay(140,live)) return; this.audio.line(live.token, win.line ?? 0); if (!await this.delay(280, live)) return; }
      else { delete this.root.dataset.multiplierFactor; delete this.root.dataset.multiplierWinIndex; this.audio.line(live.token, win.line ?? 0); if (!await this.delay(300, live)) return; }
    }
    outcome();
    const began = performance.now();
    const count = (now: number) => { if (this.live !== live) return; const progress = Math.max(0, Math.min(1, (now - began) / 1000)); this.setPayout(from + Math.floor((total - from) * (1 - (1 - progress) ** 3)), total); if (progress < 1) this.payoutFrame = requestAnimationFrame(count); else this.payoutFrame = 0; };
    this.payoutFrame = requestAnimationFrame(count); this.schedule(() => this.finish(live, total), 1000); this.controls();
  }

  private finish(live: LiveStage, total: number) { if (this.live !== live) return; clearTimeout(this.secondaryWatchdog); this.secondaryMotion?.cancel(); this.secondaryMotion=undefined; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); if (!this.destroyed && !document.hidden && client.accountId === live.account) observeExpansionOutcome(this.root, this.game, this.shownSession, client.accountId, false, false); }
  private static(session: SlotSession, index = -1) { this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step); this.root.dataset.presentation = 'static'; this.phase('result'); if (!this.stakeChosen || session.state === 'active') this.stake = session.stakeUnits; this.reels.show((index < 0 ? session.view.studio : session.view.studio.history[index]).grid); this.showResult(session, index, false); this.facts(this.metadataCache.get(`${session.id}:${index < 0 ? session.view.studio.step : index}`)); this.history(session); this.rules(); this.controls(); }
  private showResult(session: SlotSession, index: number, animate: boolean, initialPayout = 0) {
    this.clearWins(); const view = session.view.studio, frame = index < 0 ? view.history.at(-1)! : view.history[index]; this.shownFrame = frame; this.shownSession = session; this.shownIndex = index; this.root.dataset.frameIndex = String(index < 0 ? view.step : index);
    const total = Number(view.totalPayoutUnits), stake = Number(session.stakeUnits); this.setPayout(animate ? initialPayout : total, total);
    this.find('[data-element-caption]').textContent = session.state === 'active' ? translateText('Накоплено за раунд') : translateText('Начислено за раунд'); this.find('[data-element-multiple]').textContent = total ? tr`${number(total / stake)}× за раунд` : translateText('WILD заменяет знаки');
    const big = session.state === 'settled' && total >= stake * 4; this.find('[data-element-bigwin]').hidden = !big; this.root.classList.toggle('celebrating', animate && big);
    this.find('[data-element-feature]').textContent = tr`Сохранённый этап ${(index < 0 ? view.step : index) + 1}: +${amount(frame.payoutUnits)} USDT`;
    const winning = new Set(frame.wins.flatMap(win => win.positions)); this.root.querySelectorAll<HTMLElement>('[data-element-cell]').forEach(cell => cell.classList.toggle('win', winning.has(Number(cell.dataset.elementCell))));
    this.find('[data-element-lines]').innerHTML = frame.wins.map(win => `<polyline data-line="${win.line ?? 0}" points="${win.positions.map(position => `${(position % view.cols + .5) * 100},${(Math.floor(position / view.cols) + .5) * 100}`).join(' ')}"/>`).join('');
    this.find('[data-element-line-list]').innerHTML = frame.wins.map(win => tr`<button type="button" data-element-line-button="${win.line ?? 0}"><span>Линия ${(win.line ?? 0) + 1}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join(''); this.highlight();
  }
  private highlight(line?: number) { const selected = (this.shownFrame?.wins ?? []).find(win => line !== undefined && win.line === line); const positions = new Set(selected?.positions ?? []); this.root.dataset.activeLine = line === undefined ? '' : String(line); this.root.querySelectorAll<HTMLElement>('[data-element-cell]').forEach(cell => cell.classList.toggle('active-win', positions.has(Number(cell.dataset.elementCell)))); this.root.querySelectorAll<SVGElement>('[data-element-lines] polyline').forEach(path => path.classList.toggle('active', line !== undefined && Number(path.dataset.line) === line)); this.root.querySelectorAll<HTMLButtonElement>('[data-element-line-button]').forEach(button => button.setAttribute('aria-pressed', String(line !== undefined && Number(button.dataset.elementLineButton) === line))); if (selected && !this.live) { const count = selected.positions.filter(position => this.shownFrame?.grid[position] === 3).length; const factor = this.game === 'studio-stormforge-duel' && count ? `, WILD ×${1 + Math.min(3, count)}` : ''; this.find('[data-element-feature]').textContent = tr`Линия ${line! + 1}${factor}: +${amount(selected.payoutUnits)} USDT`; } }
  private facts(metadata?: StudioSlotPresentation) {
    delete this.root.dataset.chosen; delete this.root.dataset.beforeGrid; delete this.root.dataset.transformEvents;
    const panel = this.find('[data-element-key-panel]'); panel.classList.remove('revealing-key');
    if (metadata) { this.root.dataset.beforeGrid = JSON.stringify(metadata.beforeGrid); this.root.dataset.transformEvents = JSON.stringify(metadata.events); }
    if (metadata?.chosen) { const chosen = metadata.chosen; this.root.dataset.chosen = JSON.stringify(chosen); this.find('[data-element-key-art]').innerHTML = elementSymbol(this.game, chosen.symbol); this.find('[data-element-key]').textContent = ELEMENT_SYMBOL_NAMES[this.game][chosen.symbol]; this.find('[data-element-key-detail]').textContent = tr`${chosen.matchingColumns.length} колонн${chosen.active ? translateText(': WILD раскрыт') : translateText(': нужно минимум три')}${chosen.sourceSymbol > 2 ? translateText(' · ключ: Лазурная печать') : ''}`; }
    else { this.find('[data-element-key-art]').replaceChildren(); this.find('[data-element-key]').textContent = this.root.dataset.presentation === 'waiting' || !this.presentedKey ? translateText('Раскроется после остановки') : translateText('Сохранённый результат'); this.find('[data-element-key-detail]').textContent = translateText('Новый ключ на каждом вращении'); }
  }
  private history(session: SlotSession) { this.find('[data-element-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-element-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? tr`Бесплатный ${index}` : translateText('Основной')} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() { this.root.classList.remove('celebrating'); this.find('[data-element-bigwin]').hidden = true; delete this.root.dataset.multiplierFactor; delete this.root.dataset.multiplierWinIndex; this.root.querySelectorAll<HTMLElement>('[data-element-cell]').forEach(cell => cell.classList.remove('win', 'active-win')); this.find('[data-element-lines]').replaceChildren(); this.find('[data-element-line-list]').replaceChildren(); }
  private setPayout(units: number, target: number) { this.find('[data-element-amount]').textContent = amount(units); const element = this.find('[data-element-payout]'); element.dataset.units = String(units); element.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-element-paytable]').innerHTML = studioSlotPaytable(this.game).filter(row => row.symbol < 3).map(row => `<div>${elementSymbol(this.game, row.symbol)}<span>${ELEMENT_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => tr`<small>${pay.count} знака: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-element-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} USDT: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }
  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-element-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук')); this.find('[data-element-audio-label]').textContent = prefs.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-element-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { resetGameOutcomes(this.root); clearTimeout(this.secondaryWatchdog); this.secondaryMotion?.cancel(); this.secondaryMotion=undefined; this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.reels.cancel(); this.reels.clearTransforms(); delete this.root.dataset.activeColumn; this.find('[data-element-key-panel]').classList.remove('revealing-key'); cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; this.presentedKey = ''; this.phase('idle'); }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.reels.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
