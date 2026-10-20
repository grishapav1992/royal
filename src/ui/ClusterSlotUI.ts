import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import { STUDIO_INFO, STUDIO_DEFAULTS, studioSlotPaytable, studioSlotRtp, validStudioSlotPresentation, type StudioSlotView, type StudioSlotFrame, type StudioSlotPresentation } from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { gameAudio } from '../game/GameAudio';
import { ClusterBoard } from './ClusterBoard';
import { clusterSymbol, CLUSTER_SYMBOL_NAMES, type ClusterGame } from './ClusterArtwork';
import './cluster-slot.css';

const amount = (units: string | number) => (Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 4 });
type SlotSession = ExpansionSession & { view: ExpansionSession['view'] & { studio: StudioSlotView } };
type LiveStage = { token: string; account: string; operationId: string; kind: 'start' | 'move'; expectedSession: string; expectedStep: number; accepted: boolean; acceptedKey: string; motion: boolean; balance: number };

/** Persistent neighboring-group slot presentation. Saved sessions own all results and bonus progress. */
export class ClusterSlotUI {
  private root: HTMLElement; private board: ClusterBoard; private audio: ReturnType<typeof gameAudio.createSlotAudio>;
  private owner = client.accountId; private stake = '1000'; private stakeChosen = false; private presentedKey = ''; private live?: LiveStage;
  private destroyed = false; private localError = ''; private payoutFrame = 0; private fetchAbort?: AbortController;
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); private unsubscribe: () => void;
  private shownFrame?: StudioSlotFrame; private shownSession?: SlotSession; private shownIndex = -1;
  private change = () => this.sync();
  private visibility = () => { if (document.hidden) this.cancel(); this.sync(); };
  private motionChange = () => { this.cancel(); this.root.dataset.reducedMotion = String(this.reduced.matches); this.sync(); };

  constructor(private host: HTMLElement, private game: ClusterGame) {
    this.audio = gameAudio.createSlotAudio(game); host.innerHTML = this.markup(); this.root = host.querySelector('[data-studio-slot]')!;
    this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.board = new ClusterBoard(this.find('[data-cluster-reels]'), game, { phase: phase => { if (this.live) { this.phase(phase); this.controls(); } }, stop: index => { if (this.live) this.audio.stopReel(this.live.token, index); } });
    this.find<HTMLButtonElement>('[data-cluster-spin]').onclick = () => void this.spin();
    this.find<HTMLButtonElement>('[data-cluster-retry]').onclick = () => void this.retry();
    this.find<HTMLButtonElement>('[data-cluster-refresh]').onclick = () => void this.refresh();
    this.find<HTMLSelectElement>('[data-cluster-stake]').onchange = event => { if (this.blocked() || this.session()?.state === 'active') return; this.stake = (event.target as HTMLSelectElement).value; this.stakeChosen = true; this.controls(); this.rules(); };
    this.find<HTMLButtonElement>('[data-cluster-mute]').onclick = () => gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-cluster-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
    this.find('[data-cluster-group-list]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-cluster-group-button]'); if (button && !this.live) this.highlight(Number(button.dataset.clusterGroupButton)); };
    this.find('[data-cluster-history]').onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>('[data-cluster-frame]'); const session = this.session(); if (button && session && !this.live && !client.busy) this.static(session, Number(button.dataset.clusterFrame)); };
    this.unsubscribe = gameAudio.onPreferences(() => this.audioControls()); this.rules();
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.sync(); void this.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private key(session: SlotSession) { return `${session.id}:${session.view.studio.step}`; }
  private session(): SlotSession | undefined { const value = client.sessions.find(session => session.gameId === this.game); return value?.view.studio?.kind === 'slot' ? value as SlotSession : undefined; }
  private balance() { return demoWallet.accountId === client.accountId ? demoWallet.wallet?.balance ?? client.wallet?.balance : client.wallet?.balance; }
  private blocked() { return this.destroyed || !!this.live || client.busy || !!client.pending || client.loading || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden; }
  private phase(value: 'idle' | 'accelerating' | 'spinning' | 'stopping' | 'revealing' | 'collecting' | 'result' | 'uncertain') { this.root.dataset.phase = value; this.root.dataset.clusterState = value === 'result' ? this.live ? 'presenting' : 'idle' : value; }

  private markup() {
    const info = STUDIO_INFO[this.game], forest = this.game === 'studio-lumen-grove';
    return tr`<section class="cluster-game cluster-${forest?'forest':'prism'}" data-cluster-slot="${this.game}" data-studio-slot="${this.game}" data-studio-game="${this.game}" data-phase="idle" data-cluster-state="idle" data-session-id="" data-step="-1" aria-label="${info.name}">
      <header class="cluster-heading"><div><span>ROYAL STUDIO</span><h3>${info.name}</h3><p>${forest?translateText('Светящиеся семена и волшебные фонари'):translateText('Грани соединяются. Сила складывается.')}</p></div><div class="cluster-balance"><small>Монеты клуба</small><strong data-cluster-balance data-studio-balance>…</strong></div></header>
      <div class="cluster-cabinet"><div class="cluster-scenery" aria-hidden="true"></div><div class="cluster-marquee"><span>${forest?'LUMEN GROVE':'PRISM ATELIER'}</span><small>СОСЕДНИЕ ГРУППЫ</small></div>
        <div class="cluster-frame"><div class="cluster-reels" data-cluster-reels role="group" aria-label="Шесть барабанов, ${info.rows} рядов"></div></div>
        <div class="cluster-feature" data-cluster-feature role="status">${forest?translateText('Два фонаря собирают светящиеся семена'):translateText('Сила группы складывается из её ячеек')}</div>
        <div class="cluster-result studio-stage-payout"><span data-cluster-caption>Собери светлую комбинацию</span><strong data-cluster-payout data-units="0" data-target-units="0"><span data-cluster-amount>0,00</span><small> монет</small></strong><span class="cluster-bigwin" data-cluster-bigwin hidden>КРУПНЫЙ ВЫИГРЫШ</span></div>
        <div class="cluster-console"><label>Ставка за раунд<select data-cluster-stake data-stake>${DEMO_BETS.map(value=>`<option value="${value*100}">${amount(value*100)}</option>`).join('')}</select></label><button type="button" class="cluster-spin" data-cluster-spin data-start><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M47 20A21 21 0 1 0 53 37M47 9v14H33"/></svg><span data-cluster-spin-label>ВРАЩАТЬ</span></button><div class="cluster-round-info"><small data-cluster-bonus>Соседи по стороне</small><strong data-cluster-multiple>Группы от пяти знаков</strong></div></div>
      </div><div class="cluster-history" data-cluster-history aria-label="Сохранённые этапы раунда"></div><div class="cluster-group-list" data-cluster-group-list aria-label="Выплаты групп и сборщиков"></div>
      <p class="cluster-status" data-cluster-status role="status"></p><p class="cluster-error studio-error" data-cluster-error role="alert"></p>
      <div class="cluster-tools"><div class="cluster-audio"><button type="button" data-cluster-mute aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/></svg><span data-cluster-audio-label>Звук</span></button><label>Громкость<input type="range" min="0" max="100" data-cluster-volume aria-label="Громкость игры"></label></div><div><button type="button" data-cluster-retry data-retry hidden>Проверить ход</button><button type="button" data-cluster-refresh data-refresh>Обновить</button></div></div>
      <details class="cluster-rules"><summary>Правила, символы и группы</summary><p>Группа содержит минимум пять одинаковых символов, соседних по стороне. Диагонали не соединяются. Отдельные группы одного знака оплачиваются отдельно.</p><p>${forest?translateText('Каждый из первых двух фонарей по порядку ячеек собирает все текущие семена. Семена остаются на поле. Их сила 2..5 зависит от ячейки и не является денежной суммой.'):translateText('Сила каждой ячейки 1..3 зависит от её позиции и этапа. Сила группы равна сумме её ячеек и уже учтена в показанной выплате.')} Три бонусных знака на основном поле открывают два новых бесплатных вращения без продления. Символы не закрепляются и не исчезают; каждый этап получает новую сетку. Начисление приходит после всего раунда.</p><p>${forest?translateText('Таблица обычных групп. Награды фонарей показаны отдельно под полем.'):translateText('Таблица базовых групп при силе каждой ячейки 1. Реальная сумма сил усиливает награду; показанная под полем выплата уже учитывает это усиление.')}</p><div class="cluster-paytable" data-cluster-paytable></div><p data-cluster-rtp></p><p>Ставка за весь раунд. Каждая награда округляется вниз до 0,01 монеты, затем суммы складываются. «Проверить ход» подтверждает прежнюю операцию. Сохранённые этапы можно посмотреть без новой ставки.</p></details><p class="cluster-demo-note">Игра на тестовые монеты клуба</p>
    </section>`;
  }

  private sync() {
    if (this.destroyed) return;
    if (this.owner !== client.accountId) { this.cancel(); this.owner = client.accountId; this.stake = '1000'; this.stakeChosen = false; this.shownFrame = undefined; this.shownSession = undefined; this.shownIndex = -1; this.presentedKey = ''; this.localError = ''; this.root.dataset.sessionId = ''; this.root.dataset.step = '-1'; delete this.root.dataset.beforeGrid; delete this.root.dataset.transformEvents; this.board.show(Array.from({ length: STUDIO_INFO[this.game].cols * STUDIO_INFO[this.game].rows }, (_, i) => (i + Math.floor(i / 6)) % 3)); this.clearWins(); this.setPayout(0, 0); this.find('[data-cluster-caption]').textContent = translateText('Поймай свою комбинацию'); this.find('[data-cluster-multiple]').textContent = translateText('Группы от пяти знаков'); this.find('[data-cluster-history]').replaceChildren(); this.rules(); }
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
    this.find('[data-cluster-balance]').textContent = shownBalance === undefined ? '…' : shownBalance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (active) this.stake = session.stakeUnits;
    this.find<HTMLSelectElement>('[data-cluster-stake]').value = this.stake; this.find<HTMLSelectElement>('[data-cluster-stake]').disabled = blocked || active;
    const spin = this.find<HTMLButtonElement>('[data-cluster-spin]'); spin.disabled = blocked || !ready || !active && Number(this.stake) > (balance ?? 0) * 100;
    spin.toggleAttribute('data-start', !active); if (active) spin.dataset.move = 'studio-spin'; else delete spin.dataset.move;
    this.find('[data-cluster-spin-label]').textContent = active ? translateText('БЕСПЛАТНО') : translateText('ВРАЩАТЬ'); spin.setAttribute('aria-label', active ? tr`Бесплатное вращение, осталось ${session.view.studio.remaining}` : translateText('Вращать барабаны'));
    this.find('[data-cluster-bonus]').textContent = active ? tr`Бесплатных спинов: ${session.view.studio.remaining}` : translateText('Соседи по стороне');
    const retry = this.find<HTMLButtonElement>('[data-cluster-retry]'); retry.hidden = !client.pending; retry.disabled = !!this.live || client.busy || !ready || document.hidden;
    this.find<HTMLButtonElement>('[data-cluster-refresh]').disabled = !!this.live || client.busy || client.loading || !client.accountId;
    this.root.setAttribute('aria-busy', String(!!this.live || client.busy));
    let status = translateText('Выбери ставку и вращай барабаны.');
    if (!client.accountId) status = translateText('Войди в аккаунт, чтобы играть на монеты клуба.');
    else if (!ready) status = translateText('Загружаем баланс…');
    else if (client.pending && !client.busy) status = translateText('Ход ещё не подтверждён. Проверь ту же операцию без новой ставки.');
    else if (client.busy && !this.live) status = translateText('Проверяем сохранённый ход…');
    else if (this.live) status = ['revealing','collecting'].includes(this.root.dataset.phase ?? '') ? translateText('Показываем силу символов…') : this.live.accepted ? translateText('Показываем сохранённый результат…') : translateText('Барабаны вращаются. Ждём подтверждение…');
    else if (active) status = translateText('Бонус сохранён. Продолжи бесплатно, чтобы получить общую выплату.');
    else if (this.presentedKey) status = translateText('Раунд завершён. Выплата начислена.');
    if (demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion')) status = translateText('Дождись завершения операции в кошельке клуба.');
    this.find('[data-cluster-status]').textContent = status; this.find('[data-cluster-error]').textContent = this.localError || client.error;
  }

  private async spin() {
    const balance = this.balance(), session = this.session(); if (this.blocked() || !client.accountId || balance === undefined) return;
    const active = session?.state === 'active'; if (!active && Number(this.stake) > balance * 100 || active && !session.view.actions.some(action => action.move === 'studio-spin')) return;
    this.localError = ''; this.shownIndex = -1; this.clearWins(); if (session) this.board.show(session.view.studio.grid);
    
    const live: LiveStage = { token: crypto.randomUUID(), account: client.accountId, operationId: '', kind: active ? 'move' : 'start', expectedSession: active ? session.id : '', expectedStep: active ? session.view.studio.step + 1 : 0, accepted: false, acceptedKey: '', motion: !this.reduced.matches, balance };
    this.live = live; observeExpansionOutcome(this.root, this.game, this.session(), client.accountId, true, true); this.root.dataset.animationToken = live.token; this.root.dataset.presentation = 'waiting'; delete this.root.dataset.beforeGrid; delete this.root.dataset.transformEvents; this.phase(live.motion ? 'accelerating' : 'spinning'); this.board.begin(live.token, live.motion); this.audio.begin(live.token, { motion: live.motion, click: !active }); this.controls();
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
    this.root.dataset.presentation = metadata?.cluster ? 'available' : 'static';
    const complete = await this.board.settle(live.token, session.view.studio.grid);
    if (!complete || this.live !== live || this.destroyed || document.hidden) return;
    const trace = metadata?.cluster, total = Number(session.view.studio.totalPayoutUnits), stake = Number(session.stakeUnits);
    const from = live.kind === 'move' ? Number(session.view.studio.history.slice(0,-1).reduce((sum,frame)=>sum+BigInt(frame.payoutUnits),0n)) : 0;
    this.presentedKey = this.key(session); this.root.dataset.sessionId = session.id; this.root.dataset.step = String(session.view.studio.step);
    if (metadata && trace) this.root.dataset.clusterTrace = JSON.stringify(trace);
    this.phase('result'); this.showResult(session, -1, live.motion && !!trace, from); this.history(session);
    const outcome = () => this.audio.outcome(live.token, session.state === 'active' ? total > 0 ? 'return' : 'loss' : total >= stake*4 ? 'bigwin' : total > stake ? 'win' : total > 0 ? 'return' : 'loss');
    if (!live.motion) { outcome(); this.finish(live,total); return; }
    if (!trace) { this.audio.cancel(live.token); this.finish(live,total); return; }
    if (live.kind === 'move') { this.find('[data-cluster-feature]').textContent = tr`Бесплатный этап ${session.view.studio.step} из двух`; this.audio.effect(live.token,'free-stage',`${session.id}:${metadata!.step}:free`); if (!await this.delay(500,live)) return; }
    if (trace.cellValues.length) { this.phase('revealing'); this.board.values(trace.cellValues,true); this.find('[data-cluster-feature]').textContent = translateText('Сила ячеек 1, 2 и 3. В группе она складывается.'); this.audio.effect(live.token,'cell-values',`${session.id}:${metadata!.step}:cells`); if (!await this.delay(380,live)) return; }
    for (const group of trace.groups) {
      this.phase('result'); this.highlight(group.winIndex); this.audio.group(live.token,group.winIndex);
      const factor = trace.groupFactors.find(item=>item.winIndex===group.winIndex);
      this.find('[data-cluster-feature]').textContent = factor ? tr`Группа ${group.winIndex+1}: сила ${factor.factor}, выплата +${amount(session.view.studio.wins[group.winIndex].payoutUnits)}` : tr`Группа ${group.winIndex+1}: ${group.count} соседей, +${amount(session.view.studio.wins[group.winIndex].payoutUnits)}`;
      if (!await this.delay(330,live)) return;
    }
    for (const collect of trace.collects) {
      this.phase('collecting'); this.highlight(collect.winIndex); this.root.dataset.activeCollector=String(collect.collector); this.board.collect(collect.collector,collect.coins);
      this.find('[data-cluster-feature]').textContent = tr`Фонарь ${trace.collects.indexOf(collect)+1}: ${collect.coins.length} семян, +${amount(session.view.studio.wins[collect.winIndex].payoutUnits)}`;
      this.audio.effect(live.token,'collect',`${session.id}:${metadata!.step}:collect:${collect.winIndex}`);
      if (!await this.delay(480,live)) return; this.board.clearCollect(); delete this.root.dataset.activeCollector;
    }
    if (this.live !== live) return; this.phase('result'); outcome(); const began=performance.now();
    const count=(now:number)=>{if(this.live!==live)return;const progress=Math.max(0,Math.min(1,(now-began)/1000));this.setPayout(from+Math.floor((total-from)*(1-(1-progress)**3)),total);if(progress<1)this.payoutFrame=requestAnimationFrame(count);else this.payoutFrame=0;};
    this.payoutFrame=requestAnimationFrame(count);this.schedule(()=>this.finish(live,total),1050);this.controls();
  }

  private finish(live: LiveStage, total: number) { if (this.live !== live) return; cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.setPayout(total, total); this.highlight(); this.root.classList.remove('celebrating'); this.live = undefined; this.root.dataset.animationToken = ''; this.phase('result'); this.controls(); if (!this.destroyed && !document.hidden && client.accountId === live.account) observeExpansionOutcome(this.root, this.game, this.shownSession, client.accountId, false, false); }
  private static(session: SlotSession, index=-1) {
    this.presentedKey=this.key(session);this.root.dataset.sessionId=session.id;this.root.dataset.step=String(session.view.studio.step);this.root.dataset.presentation='static';this.phase('result');
    if(!this.stakeChosen||session.state==='active')this.stake=session.stakeUnits;
    this.board.show((index<0?session.view.studio:session.view.studio.history[index]).grid);this.showResult(session,index,false);this.history(session);this.rules();this.controls();
  }
  private confirmedValues(step:number) { return this.game==='studio-prism-atelier'?Array.from({length:STUDIO_INFO[this.game].cols*STUDIO_INFO[this.game].rows},(_,position)=>({position,value:1+(position+step)%3})):[]; }

  private showResult(session:SlotSession,index:number,animate:boolean,initialPayout=0) {
    this.clearWins();const view=session.view.studio,frame=index<0?view.history.at(-1)!:view.history[index];this.shownFrame=frame;this.shownSession=session;this.shownIndex=index;this.root.dataset.frameIndex=String(index<0?view.step:index);
    const total=Number(view.totalPayoutUnits),stake=Number(session.stakeUnits);this.setPayout(animate?initialPayout:total,total);if(!animate)this.board.values(this.confirmedValues(index<0?view.step:index));
    this.find('[data-cluster-caption]').textContent=session.state==='active'?translateText('Накоплено за раунд'):translateText('Начислено за раунд');this.find('[data-cluster-multiple]').textContent=total?tr`${number(total/stake)}× за раунд`:translateText('Группы от пяти знаков');
    const big=session.state==='settled'&&total>=stake*4;this.find('[data-cluster-bigwin]').hidden=!big;this.root.classList.toggle('celebrating',animate&&big);
    this.find('[data-cluster-feature]').textContent=index<0?this.game==='studio-lumen-grove'?translateText('Два фонаря собирают семена, сохраняя их на поле'):translateText('Сила группы складывается из её ячеек'):tr`Сохранённый этап ${index+1}: +${amount(frame.payoutUnits)} монет`;
    const winning=new Set(frame.wins.flatMap(win=>win.positions));this.root.querySelectorAll<HTMLElement>('[data-cluster-cell]').forEach(cell=>cell.classList.toggle('win',winning.has(Number(cell.dataset.clusterCell))));
    this.find('[data-cluster-group-list]').innerHTML=frame.wins.map((win,winIndex)=>`<button type="button" data-cluster-group-button="${winIndex}" data-win-kind="${win.kind}"><span>${win.kind==='collect'?tr`Фонарь ${frame.wins.filter((item,index)=>index<=winIndex&&item.kind==='collect').length}`:tr`Группа ${winIndex+1} · ${win.count}`}</span><strong>+${amount(win.payoutUnits)}</strong></button>`).join('');this.highlight();
  }

  private highlight(winIndex?:number) {
    const positions=new Set(winIndex===undefined?[]:this.shownFrame?.wins[winIndex]?.positions??[]);
    this.root.dataset.activeGroup=winIndex===undefined?'':String(winIndex);
    this.root.querySelectorAll<HTMLElement>('[data-cluster-cell]').forEach(cell=>cell.classList.toggle('active-win',positions.has(Number(cell.dataset.clusterCell))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-cluster-group-button]').forEach(button=>button.setAttribute('aria-pressed',String(winIndex!==undefined&&Number(button.dataset.clusterGroupButton)===winIndex)));
    if(!this.live&&winIndex!==undefined&&this.game==='studio-prism-atelier'){const win=this.shownFrame?.wins[winIndex],step=this.shownIndex<0?this.shownSession?.view.studio.step??0:this.shownIndex;if(win?.kind==='cluster')this.find('[data-cluster-feature]').textContent=tr`Группа ${winIndex+1}: сила ${win.positions.reduce((sum,position)=>sum+1+(position+step)%3,0)}, выплата +${amount(win.payoutUnits)}`;}
  }

  private history(session: SlotSession) { this.find('[data-cluster-history]').innerHTML = session.view.studio.history.length > 1 ? session.view.studio.history.map((frame, index) => `<button type="button" data-cluster-frame="${index}" data-frame="${index}" aria-pressed="${this.shownIndex === index || this.shownIndex < 0 && index === session.view.studio.step}">${index ? tr`Бесплатный ${index}` : translateText('Основной')} <span>+${amount(frame.payoutUnits)}</span></button>`).join('') : ''; }
  private clearWins() {
    this.root.classList.remove('celebrating');this.find('[data-cluster-bigwin]').hidden=true;delete this.root.dataset.activeCollector;this.root.dataset.activeGroup='';this.board.clearCollect();
    this.root.querySelectorAll<HTMLElement>('[data-cluster-cell]').forEach(cell=>cell.classList.remove('win','active-win'));this.find('[data-cluster-group-list]').replaceChildren();
  }

  private setPayout(units: number, target: number) { this.find('[data-cluster-amount]').textContent = amount(units); const element = this.find('[data-cluster-payout]'); element.dataset.units = String(units); element.dataset.targetUnits = String(target); }
  private rules() { this.find('[data-cluster-paytable]').innerHTML = studioSlotPaytable(this.game).filter(row=>row.symbol<3).map(row => `<div>${clusterSymbol(this.game, row.symbol)}<span>${CLUSTER_SYMBOL_NAMES[this.game][row.symbol]}</span>${row.pays.map(pay => tr`<small>${pay.count} знака: <b>${number(pay.multiplier)}×</b></small>`).join('')}</div>`).join(''); this.find('[data-cluster-rtp]').textContent = tr`Расчётный возврат при ставке ${amount(this.stake)} монет: ${number(studioSlotRtp(this.game, this.stake) ?? 98)}% с учётом округления. Средний показатель на длинной серии раундов.`; }
  private audioControls() { const prefs = gameAudio.getPreferences(), button = this.find<HTMLButtonElement>('[data-cluster-mute]'); button.setAttribute('aria-pressed', String(prefs.muted)); button.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук')); this.find('[data-cluster-audio-label]').textContent = prefs.muted ? translateText('Без звука') : translateText('Звук'); this.find<HTMLInputElement>('[data-cluster-volume]').value = String(Math.round(prefs.volume * 100)); }
  private schedule(action: () => void, ms: number) { const timer = setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) action(); }, ms); this.timers.set(timer, () => {}); }
  private delay(ms: number, live: LiveStage) { return new Promise<boolean>(resolve => { const timer = setTimeout(() => { this.timers.delete(timer); resolve(this.live === live); }, ms); this.timers.set(timer, () => resolve(false)); }); }
  private cancel() { resetGameOutcomes(this.root); this.audio.cancel(this.live?.token); this.live = undefined; this.fetchAbort?.abort(); this.fetchAbort = undefined; this.board.cancel(); this.board.clearCollect(); cancelAnimationFrame(this.payoutFrame); this.payoutFrame = 0; this.timers.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); this.timers.clear(); this.root.classList.remove('celebrating'); this.root.dataset.animationToken = ''; this.presentedKey = ''; this.phase('idle'); delete this.root.dataset.activeCollector; delete this.root.dataset.clusterTrace; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.cancel(); this.board.destroy(); this.audio.dispose(); this.unsubscribe(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.host.replaceChildren(); }
}
