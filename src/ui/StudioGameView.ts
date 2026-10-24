import { t as translateText, tr, locale } from '../i18n/index';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import {
  STUDIO_INFO, STUDIO_DEFAULTS, STUDIO_RULES, studioKenoMultiplier, studioDiceMultiplier,
  studioPlinkoTable, studioWheelSegments, studioWheelMultiplier, studioRiskThreshold,
  studioRiskMax, studioRiskMultiplier, studioMinesMultiplier,
  studioSlotPaytable, studioSlotRtp,
  validStudioEnvelope, validStudioSettlement, studioSamePayload,
  type StudioGameId, type StudioInfo, type StudioSettings, type StudioView,
  type StudioSlotView, type StudioSlotFrame, type StudioWin,
} from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { demoWallet } from '../wallet/WalletClient';
import { STUDIO_ART, studioEscape as escape, studioSymbol, studioSymbolName } from './StudioArtwork';
import { StudioMotion } from './StudioMotion';
import './studio-games.css';

const number = (value: number, digits = 2) => value.toLocaleString(locale, { maximumFractionDigits: digits });
const amount = (units: string | number) => tr`${(Number(units) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const multiplier = (value: number) => `${number(value, 4)}×`;
const categories = {slot:translateText('СЛОТЫ'),crash:translateText('МАРШРУТ РИСКА'),flight:translateText('ПОЛЁТ'),keno:translateText('КЕНО'),plinko:translateText('ПЛИНКО'),dice:translateText('КОСТИ'),wheel:translateText('КОЛЕСО'),mines:translateText('ПОИСК СОКРОВИЩ')};
const featureNames = {expand:translateText('Расширение WILD'),tumble:translateText('Каскады'),'multiplier-wild':translateText('WILD с множителем'),collect:translateText('Сбор символов'),hold:translateText('Закреплённые USDT'),cluster:translateText('Группы соседей'),ways:translateText('Способы выигрыша'),sticky:translateText('Липкие WILD'),chosen:translateText('Символ раунда'),'cell-multipliers':translateText('Множители ячеек'),walking:translateText('Шагающий WILD'),synced:translateText('Связанные барабаны'),wheels:translateText('Бонусное колесо'),mystery:translateText('Загадочные символы'),beam:translateText('Луч WILD'),trail:translateText('След WILD'),wish:translateText('Бонус желания'),orbs:translateText('Сбор множителей')};
const wheelNames = [translateText('Золото'),translateText('Изумруд'),translateText('Рубин'),translateText('Звезда')];
const wheelColors = ['#d6a34f','#4c9781','#b55976','#7b65b4'];
type ActionLive = {token:string; account:string; operation:NewExpansionAction; operationId:string; before?:ExpansionSession; accepted:boolean; balance:number; motion:StudioMotion; watchdog:ReturnType<typeof setTimeout>};

/** Every revealed symbol and wallet amount is read from the saved server session. */
export class StudioGameView {
  private info: StudioInfo;
  private stake = '1000';
  private settings: StudioSettings;
  private preview = false;
  private error = '';
  private destroyed = false;
  private sessionId = '';
  private phase = -1;
  private historyIndex = -1;
  private focusKey?: string;
  private refreshKey = '';
  private owner = client.accountId;
  private liveAction?: ActionLive;
  private renderBasis?: {session?:ExpansionSession; balance:number};
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private change = () => this.syncAction();
  private lifecycle = () => { if (document.hidden || this.reduced.matches) this.cancelAction(); this.syncAction(); };

  constructor(private host: HTMLElement, private game: StudioGameId) {
    resetGameOutcomes(host);
    this.info = STUDIO_INFO[game];
    this.settings = structuredClone(STUDIO_DEFAULTS[game]);
    client.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    document.addEventListener('visibilitychange', this.lifecycle);
    this.reduced.addEventListener('change', this.lifecycle);
    this.render();
    void client.refresh();
  }

  private rememberFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.host.contains(active) && active.dataset.focus) this.focusKey = active.dataset.focus;
  }

  private restoreFocus() {
    if (!this.focusKey || this.destroyed || client.busy) return;
    const matching = Array.from(this.host.querySelectorAll<HTMLElement>('[data-focus]')).find(element => element.dataset.focus === this.focusKey && !(element instanceof HTMLButtonElement && element.disabled) && !(element instanceof HTMLSelectElement && element.disabled));
    const fallback = this.host.querySelector<HTMLElement>('[data-mine]:not(:disabled),[data-move]:not(:disabled),[data-start]:not(:disabled),[data-refresh]:not(:disabled)');
    (matching ?? fallback)?.focus({preventScroll:true});
  }

  private async run(operation: () => Promise<unknown>, action = false) {
    this.rememberFocus(); this.error = '';
    if (action) { this.preview = false; this.historyIndex = -1; }
    try { await operation(); } catch (error) { if (this.destroyed) return; this.error = (error as Error).message; }
    if (this.destroyed) return;
    this.render();
  }

  private async act(operation: NewExpansionAction) {
    if (!['crash','flight','keno','mines'].includes(this.info.kind)) return this.run(() => client.act(operation), true);
    const account = client.accountId, balance = demoWallet.wallet?.balance ?? client.wallet?.balance;
    if (this.destroyed || this.liveAction || !account || account !== demoWallet.accountId || balance === undefined || client.busy || client.pending || client.loading || demoWallet.busy || demoWallet.pending || demoWallet.hasExternalBusy('expansion') || document.hidden) return;
    const before = client.sessions.find(value => value.gameId === this.game);
    if (operation.action === 'move' && (!before || before.id !== operation.sessionId || before.state !== 'active')) return;
    this.rememberFocus(); this.error = ''; this.preview = false; this.historyIndex = -1;
    this.renderBasis = {session: operation.action === 'move' ? structuredClone(before) : undefined, balance};
    this.render(); this.renderBasis = undefined;
    const live = {token:crypto.randomUUID(), account, operation:structuredClone(operation), operationId:'', before:operation.action === 'move' ? structuredClone(before) : undefined, accepted:false, balance} as ActionLive;
    live.motion = new StudioMotion(() => this.liveAction === live && !this.destroyed && client.accountId === account && demoWallet.accountId === account && !document.hidden && !this.reduced.matches);
    live.watchdog = setTimeout(() => { if (this.liveAction === live) { this.cancelAction(); this.render(); } }, 18000);
    this.liveAction = live; observeExpansionOutcome(this.host, this.game, before, account, true, true); this.actionState('waiting'); this.actionControls();
    try { await client.act(operation); }
    catch (error) { if (!this.destroyed && client.accountId === account) this.error = (error as Error).message; }
    if (!this.destroyed) this.syncAction();
  }

  private actionState(value:string) {
    const root = this.host.querySelector<HTMLElement>('[data-studio-game]');
    if (root) { root.dataset.phase = value; root.dataset.animationToken = this.liveAction?.token ?? ''; root.setAttribute('aria-busy', String(!!this.liveAction)); }
  }

  private actionControls() {
    if (!this.liveAction) return;
    this.host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(node => { node.disabled = true; });
    const status = this.host.querySelector<HTMLElement>('.studio-status');
    if (status) status.textContent = this.liveAction.accepted ? translateText('Показываем подтверждённый ход…') : translateText('Подтверждаем ход. Новый результат пока скрыт.');
    const balance = this.host.querySelector<HTMLElement>('[data-studio-balance]');
    if (balance) balance.textContent = this.liveAction.balance.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  private cancelAction(quiet = true) {
    if (quiet) resetGameOutcomes(this.host);
    const live = this.liveAction; this.liveAction = undefined;
    if (live) { clearTimeout(live.watchdog); live.motion.cancel(); }
  }

  private syncAction() {
    if (this.destroyed) return;
    if (this.owner !== client.accountId || this.owner !== demoWallet.accountId) {
      this.cancelAction(); this.owner = client.accountId; this.preview = false; this.historyIndex = -1; this.sessionId = ''; this.phase = -1; this.settings = structuredClone(STUDIO_DEFAULTS[this.game]); this.error = '';
    }
    const live = this.liveAction;
    observeExpansionOutcome(this.host, this.game, client.sessions.find(value => value.gameId === this.game), client.accountId, true, !!live && client.pending?.gameId === this.game);
    if (!live) { this.render(); return; }
    if (client.pending?.gameId === this.game && !live.operationId) live.operationId = client.pending.id;
    if (!live.accepted && !client.busy) {
      if (client.pending) { this.cancelAction(); this.render(); return; }
      const session = client.sessions.find(value => value.gameId === this.game);
      if (!session || !this.sameConfirmedAction(session,live)) { this.cancelAction(); this.render(); return; }
      live.accepted = true; clearTimeout(live.watchdog);
      live.watchdog = setTimeout(() => { if (this.liveAction === live) { this.cancelAction(); this.render(); } }, 8000);
      void this.presentAction(session,live);
    }
    this.actionControls();
  }

  private sameConfirmedAction(session:ExpansionSession,live:ActionLive) {
    if (!live.operationId || session.id !== (live.operation.action === 'start' ? live.operationId : live.operation.sessionId) || !validStudioSettlement(this.game,session.state,session.stakeUnits,session.spentUnits,session.returnedUnits,session.view.studio) || !validStudioEnvelope(this.game,session.state,session.view)) return false;
    const after = session.view.studio, before = live.before?.view.studio;
    if (!after || after.kind !== this.info.kind) return false;
    if (live.operation.action === 'start') return session.stakeUnits === live.operation.stakeUnits && session.view.phase === 1;
    if (!before || session.stakeUnits !== live.before?.stakeUnits) return false;
    if (after.kind === 'crash' || after.kind === 'flight') {
      if (before.kind !== after.kind) return false;
      return live.operation.move === 'cashout'
        ? session.state === 'settled' && studioSamePayload(before.history,after.history)
        : after.history.length === before.history.length + 1 && studioSamePayload(before.history,after.history.slice(0,-1));
    }
    if (after.kind === 'mines' && before.kind === 'mines') return live.operation.move === 'cashout'
      ? session.state === 'settled' && studioSamePayload(before.opened,after.opened)
      : after.opened.length === before.opened.length + 1 && studioSamePayload(before.opened,after.opened.slice(0,-1)) && after.opened.at(-1) === live.operation.picks?.[0];
    return false;
  }

  private async presentAction(session:ExpansionSession,live:ActionLive) {
    const view = session.view.studio;
    let landed = false;
    try {
      if (!view || document.hidden) return;
      if (this.reduced.matches) { landed = true; return; }
      if (view.kind === 'keno') {
        this.actionState('revealing');
        const tray = this.host.querySelector<HTMLElement>('.studio-keno-result')!;
        for (const [index,value] of view.drawn.entries()) {
          if (!await live.motion.wait(180)) return;
          const button = this.host.querySelector<HTMLButtonElement>(`[data-number="${value}"]`)!;
          button.classList.add('drawn'); button.classList.toggle('hit',view.numbers.includes(value));
          button.setAttribute('aria-label',tr`Число ${value}${view.numbers.includes(value)?translateText(', совпадение'):translateText(', выпало')}`);
          const ball = document.createElement('span'); ball.textContent = String(value); ball.dataset.studioDrawnIndex = String(index); ball.classList.toggle('hit',view.numbers.includes(value)); tray.append(ball);
          if (!await live.motion.element(ball,[{transform:'translateY(-22px) scale(.5)',opacity:0},{transform:'translateY(0) scale(1)',opacity:1}],150)) return;
        }
      } else if (view.kind === 'flight' || view.kind === 'crash') {
        const before = live.before?.view.studio, from = before?.kind === view.kind ? before.history.length : 0;
        const to = view.history.length, marker = this.host.querySelector<SVGCircleElement>('[data-studio-flight-marker]')!;
        this.actionState(to > from ? 'travelling' : live.operation.action === 'start' ? 'boarding' : 'cashout');
        if (to > from) {
          if (!await live.motion.tween(780,progress => { const step = from + (to-from)*progress; marker.setAttribute('cx',String(20+step/view.maxSteps*365)); marker.setAttribute('cy',String(160-step/view.maxSteps*140)); })) return;
          if (view.history.at(-1)?.safe === false) { marker.setAttribute('fill','#ef9694'); if (!await live.motion.element(marker,[{transform:'translateY(0)',opacity:1},{transform:'translateY(16px)',opacity:.25}],280)) return; }
          else if (!await live.motion.element(marker,[{transform:'scale(1)'},{transform:'scale(1.55)'},{transform:'scale(1)'}],220)) return;
        } else if (!await live.motion.element(marker,[{opacity:.4},{opacity:1},{opacity:.65},{opacity:1}],360)) return;
      } else if (view.kind === 'mines') {
        this.actionState('opening');
        if (live.operation.action === 'move' && live.operation.move === 'reveal') {
          const position = live.operation.picks![0], cell = view.cells[position];
          const button = this.host.querySelector<HTMLButtonElement>(`[data-mine="${position}"]`)!;
          if (!await live.motion.element(button,[{transform:'rotateY(0deg)'},{transform:'rotateY(90deg)'}],180)) return;
          button.className = cell; button.innerHTML = `${cell==='safe'?studioSymbol(5,this.info.theme):'<span class="studio-mine-lost" aria-hidden="true">✹</span>'}<small aria-hidden="true">${position+1}</small>`;
          button.setAttribute('aria-label',tr`Ячейка ${position+1}: ${cell==='safe'?translateText('открыта безопасно'):translateText('ловушка')}`);
          if (!await live.motion.element(button,[{transform:'rotateY(-90deg)'},{transform:'rotateY(0deg)'}],240)) return;
        } else if (!await live.motion.wait(320)) return;
      }
      landed = true;
    } finally {
      if (this.liveAction === live) {
        this.cancelAction(!landed); this.render();
        if (landed && !this.destroyed && !document.hidden && client.accountId === live.account && demoWallet.accountId === live.account) observeExpansionOutcome(this.host, this.game, session, client.accountId, false, false);
      }
    }
  }

  private update(value: Record<string, unknown>) {
    this.settings = {studio:{...this.settings.studio,...value}} as StudioSettings;
    this.preview = true; this.render();
  }

  private syncSettings(view: StudioView) {
    if (view.kind === 'keno') this.settings = {studio:{numbers:[...view.numbers],target:view.target}};
    else if (view.kind === 'plinko') this.settings = {studio:{risk:view.risk}};
    else if (view.kind === 'dice') this.settings = {studio:{chance:view.chance,direction:view.direction}};
    else if (view.kind === 'wheel') this.settings = {studio:{target:view.target}};
  }

  private choices(name: string, values: readonly (string | number)[], current: string | number, labels: readonly string[], disabled: boolean, captions?: readonly string[]) {
    return `<div class="studio-options" role="group" aria-label="${escape(name)}">${values.map((value,index)=>`<button type="button" data-setting="${escape(name)}" data-value="${value}" data-focus="setting-${name}-${value}" aria-pressed="${current===value}" ${disabled?'disabled':''}>${escape(labels[index])}${captions ? `<small>${escape(captions[index])}</small>` : ''}</button>`).join('')}</div>`;
  }

  private metrics(first: string, value: string, second: string, next: string) {
    return `<div class="studio-metrics"><div><span>${first}</span><strong>${value}</strong></div><div><span>${second}</span><strong>${next}</strong></div></div>`;
  }

  private stage(content: string, badge: string, subtitle = '') {
    return `<div class="studio-stage"><img class="studio-world" src="${STUDIO_ART[this.info.theme]}" alt="" aria-hidden="true"><div class="studio-stage-title"><h4>${escape(this.info.name)}</h4><span>${badge}</span></div>${subtitle?`<p class="studio-stage-subtitle">${subtitle}</p>`:''}${content}</div>`;
  }

  private slot(view: StudioSlotView | undefined, busy: boolean, playing: boolean) {
    const frame: StudioSlotFrame | undefined = view && this.historyIndex >= 0 ? view.history[this.historyIndex] : undefined;
    const cols = view?.cols ?? this.info.cols;
    const grid = frame?.grid ?? view?.grid ?? Array.from({length:cols*this.info.rows},(_,index)=>(Math.floor(index/cols)+index%cols)%3);
    const rows = Math.max(1,Math.floor(grid.length/cols));
    const wins = frame?.wins ?? view?.wins ?? [];
    const held = frame?.held ?? view?.held ?? [];
    const winning = new Set(wins.flatMap(win=>win.positions));
    const lines = wins.filter(win=>win.kind==='line').map(win=>`<polyline points="${win.positions.map(index=>`${((index%cols)+.5)/cols*100},${(Math.floor(index/cols)+.5)/rows*100}`).join(' ')}"/>`).join('');
    const stage = frame?.stage ?? view?.stage ?? 'base';
    const stageName = {'base':translateText('ОСНОВНОЙ СПИН'),'free-spin':translateText('БЕСПЛАТНЫЙ СПИН'),'tumble':translateText('КАСКАД'),'hold':translateText('ЗАКРЕПЛЕНИЕ МОНЕТ')}[stage];
    const payout = frame?.payoutUnits ?? view?.history.at(-1)?.payoutUnits ?? '0';
    const total = view?.totalPayoutUnits ?? '0';
    const mode = this.info.paylines.length ? tr`${this.info.paylines.length} линий` : this.info.ways ? tr`${number(this.info.ways,0)} способов` : this.info.features.includes('cluster') ? translateText('Группы от 5 символов') : translateText('Совпадения от 8 символов');
    const cells = grid.map((symbol,index)=>tr`<div class="studio-cell ${winning.has(index)?'win':''} ${symbol>=3?'special':''} ${held.includes(index)?'held':''}" style="--cell-column:${index%cols}" data-slot-cell="${index}" role="img" aria-label="Ячейка ${index+1}: ${escape(studioSymbolName(symbol,this.info.theme))}${winning.has(index)?translateText(', участвует в выигрыше'):''}${held.includes(index)?translateText(', закреплена'):''}">${studioSymbol(symbol,this.info.theme)}${symbol===3?'<span class="studio-special-label">WILD</span>':symbol===4?'<span class="studio-special-label">SCATTER</span>':''}</div>`).join('');
    const history = view && view.history.length > 1 ? tr`<div class="studio-steps" role="group" aria-label="Этапы сохранённого раунда">${view.history.map((item,index)=>`<button type="button" data-frame="${index}" data-focus="frame-${index}" aria-pressed="${this.historyIndex===index||this.historyIndex<0&&index===view.history.length-1}" ${busy?'disabled':''}>${item.stage==='base'?translateText('Спин'):item.stage==='tumble'?translateText('Каскад'):item.stage==='hold'?translateText('Монеты'):translateText('Бонус')} ${index+1} · ${amount(item.payoutUnits)}</button>`).join('')}</div>` : '';
    const badges = this.info.features.slice(0,3).map(feature=>`<span>${featureNames[feature]}</span>`).join('');
    const matchLabel=this.info.features.includes('cluster')?translateText('Группы по сторонам ячеек'):this.info.features.includes('tumble')?translateText('Символы в любой части поля'):translateText('WILD заменяет обычный символ');
    const content = tr`<div class="studio-reels-shell ${busy?'spinning':view?'revealed':''}"><div class="studio-reels" style="--studio-cols:${cols}" role="group" aria-label="${cols} барабанов, ${rows} рядов">${cells}${lines?`<svg class="studio-win-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`:''}</div></div><div class="studio-stage-payout ${Number(total)===0?'empty':''}"><small>${frame?translateText('ВЫПЛАТА ВЫБРАННОГО ЭТАПА'):view?playing?translateText('НАКОПЛЕНО ЗА РАУНД'):translateText('ВЫПЛАЧЕНО ЗА РАУНД'):translateText('ВПЕРЕДИ НОВЫЙ РАУНД')}</small><strong>${view?amount(frame?payout:total):translateText('Поймай свою комбинацию')}</strong>${frame?tr`<span class="studio-multiplier">Всего за раунд: ${amount(total)}</span>`:''}</div><div class="studio-slot-status"><span>${escape(mode)}</span><span>${view?.remaining?tr`Бонусных ходов: <b>${view.remaining}</b>`:matchLabel}</span></div>${badges?`<div class="studio-stage-badges">${badges}</div>`:''}${history}`;
    const winList = wins.length ? tr`<ul class="studio-win-list" aria-label="Выплаты показанного этапа">${wins.map(win=>`<li><span>${studioSymbol(win.symbol,this.info.theme)}${escape(this.winLabel(win))}</span><strong>${amount(win.payoutUnits)}</strong></li>`).join('')}</ul>` : '';
    return this.stage(content,stageName)+winList;
  }

  private winLabel(win: StudioWin) {
    const label = win.kind==='line'?tr`Линия ${(win.line??0)+1}`:win.kind==='ways'?translateText('Способы'):win.kind==='cluster'?translateText('Группа соседей'):win.kind==='anywhere'?translateText('Совпадения в поле'):win.kind==='collect'?translateText('Сборщик'):win.kind==='coin'?translateText('Монеты'):translateText('Бонусное колесо');
    return tr`${label} · ${win.count} символов · ${multiplier(win.multiplier)}`;
  }

  private board(view: StudioView | undefined, playing: boolean, disabled: boolean, turnBlocked: boolean) {
    switch(this.info.kind) {
      case 'slot': return this.slot(view?.kind==='slot'?view:undefined,client.busy&&client.pending?.gameId===this.game,playing);
      case 'crash': case 'flight': {
        const result = view?.kind==='crash'||view?.kind==='flight'?view:undefined;
        const steps = result?.steps ?? 0, markerStep = result?.history.length ?? 0, max = result?.maxSteps ?? studioRiskMax(this.game), threshold = studioRiskThreshold(this.game), progress = steps/max*100;
        const lost = result?.history.at(-1)?.safe===false;
        const board = tr`<div class="studio-fly-board"><div class="studio-floating-token">${studioSymbol(3,this.info.theme)}</div><svg viewBox="0 0 430 180" aria-hidden="true"><path class="studio-flight-shadow" d="M20 160Q100 150 170 113T390 16"/><path class="studio-flight-track" d="M20 160Q100 150 170 113T390 16"/><circle data-studio-flight-marker cx="${20+markerStep/max*365}" cy="${160-markerStep/max*140}" r="8" fill="${lost?'#ef9694':'#ffe5a0'}"/></svg><div class="studio-flight-value">${multiplier(result?.multiplier??1)}<small>${lost?translateText('МАРШРУТ ПРЕРВАН'):playing?translateText('ПОЛЁТ СОХРАНЁН'):translateText('ВЫБЕРИ МОМЕНТ ДЛЯ СТАРТА')}</small></div><div class="studio-flight-progress" style="--flight-progress:${progress}%"><i></i></div><div class="studio-journey" role="group" aria-label="Этапы маршрута">${Array.from({length:max},(_,index)=>`<span class="${index<steps?'done':''}">${index<steps?'✓':index+1}</span>`).join('')}</div></div>`;
        return this.stage(board,tr`${max} ЭТАПОВ`)+this.metrics(translateText('Можно забрать'),amount(result?.cashoutUnits??'0'),translateText('Следующий успешный этап'),multiplier(studioRiskMultiplier(this.game,Math.min(max,steps+1))))+tr`<p class="studio-status">Каждый этап: безопасно при ${threshold}+ на шестигранной кости. Вероятность успеха ${7-threshold} из 6. После успеха можно забрать выплату.</p>`;
      }
      case 'keno': {
        const result = view?.kind==='keno'?view:undefined;
        const settings = this.settings.studio as {numbers:number[];target:2|3};
        const selected = result?.numbers ?? settings.numbers, target = result?.target ?? settings.target;
        const grid = tr`<div class="studio-keno-grid" role="group" aria-label="Выбери пять чисел от 1 до 20">${Array.from({length:20},(_,index)=>{const value=index+1,drawn=result?.drawn.includes(value),hit=drawn&&selected.includes(value);return tr`<button type="button" data-number="${value}" data-focus="number-${value}" aria-pressed="${selected.includes(value)}" aria-label="Число ${value}${hit?translateText(', совпадение'):drawn?translateText(', выпало'):''}" class="${drawn?'drawn':''} ${hit?'hit':''}" ${disabled?'disabled':''}>${value}</button>`;}).join('')}</div><div class="studio-keno-result" aria-label="Выпавшие числа">${result?result.drawn.map(value=>`<span class="${selected.includes(value)?'hit':''}">${value}</span>`).join(''):''}</div>`;
        return this.stage(grid,translateText('ПЯТЬ ИЗ ДВАДЦАТИ'))+this.choices('target',[2,3],target,[translateText('От двух совпадений'),translateText('От трёх совпадений')],disabled)+this.metrics(result?translateText('Совпадения'):translateText('Выбрано чисел'),result?tr`${result.hits} из 5`:tr`${selected.length} из 5`,translateText('Выплата за цель'),multiplier(result?.multiplier??studioKenoMultiplier(target)));
      }
      case 'plinko': {
        const result = view?.kind==='plinko'?view:undefined;
        const risk = result?.risk??(this.settings.studio as {risk:'low'|'medium'|'high'}).risk, table = result?.table??studioPlinkoTable(risk);
        const pegs=Array.from({length:12},(_,row)=>Array.from({length:row+1},(_,col)=>`<circle class="peg" cx="${195+(col*2-row)*13}" cy="${29+row*19}" r="2.7"/>`).join('')).join('');
        let x=195;const path=['195,10',...(result?.path??[]).map((direction,row)=>{x+=direction?13:-13;return `${x},${29+row*19}`;}),`${x},264`].join(' ');
        const buckets=table.map((value,index)=>`<rect class="bucket ${result?.bucket===index?'hit':''}" x="${195+(index-6)*26-11}" y="251" width="22" height="29" rx="4"/><text class="bucket-label ${result?.bucket===index?'hit':''}" x="${195+(index-6)*26}" y="270">${number(value,2)}×</text>`).join('');
        const board=tr`<svg class="studio-plinko" viewBox="15 0 360 295" role="img" aria-label="Плинко, двенадцать рядов${result?tr`, итоговая ячейка ${result.bucket}`:''}"><title>Множители ячеек: ${table.map(multiplier).join(', ')}</title>${pegs}${buckets}${result?`<polyline class="route" points="${path}"/><circle class="ball" cx="${x}" cy="244" r="6"/>`:'<circle class="ball" cx="195" cy="10" r="6"/>'}</svg>`;
        return this.stage(board,translateText('12 РЯДОВ'))+this.choices('risk',['low','medium','high'],risk,[translateText('Спокойный'),translateText('Средний'),translateText('Высокий риск')],disabled)+this.metrics(translateText('Результат шарика'),result?multiplier(result.multiplier):translateText('Ждёт запуска'),translateText('Максимальная выплата'),multiplier(Math.max(...table)));
      }
      case 'dice': {
        const result=view?.kind==='dice'?view:undefined,settings=this.settings.studio as {chance:25|50|75;direction:'under'|'over'};
        const chance=result?.chance??settings.chance,direction=result?.direction??settings.direction;
        const low=direction==='under'?0:100-chance,high=direction==='under'?chance-1:99;
        const board=tr`<div class="studio-fly-board"><div class="studio-flight-value">${result?String(result.roll).padStart(2,'0'):'00'}<small>${result?result.won?translateText('ПОПАДАНИЕ В ДИАПАЗОН'):translateText('ЗА ПРЕДЕЛАМИ ДИАПАЗОНА'):translateText('РЕЗУЛЬТАТ ОТ 00 ДО 99')}</small></div><svg viewBox="0 0 430 170" aria-hidden="true"><path class="studio-flight-shadow" d="M25 142H405"/><path class="studio-flight-track" d="M${25+low/100*380} 142H${25+(high+1)/100*380}"/>${result?`<circle cx="${25+result.roll/100*380}" cy="142" r="7" fill="#ffe9a0"/>`:''}</svg><p class="studio-dice-sum">Выигрышные числа: <strong>${low}-${high}</strong></p></div>`;
        return this.stage(board,translateText('100 ИСХОДОВ'))+this.choices('chance',[25,50,75],chance,['25%','50%','75%'],disabled,[translateText('Узкая цель'),translateText('Средняя цель'),translateText('Широкая цель')])+this.choices('direction',['under','over'],direction,[translateText('Ниже'),translateText('Выше')],disabled)+this.metrics(translateText('Вероятность попадания'),`${chance}%`,translateText('Выплата за попадание'),multiplier(result?.multiplier??studioDiceMultiplier(chance)));
      }
      case 'wheel': {
        const result=view?.kind==='wheel'?view:undefined,target=result?.target??(this.settings.studio as {target:0|1|2|3}).target,segments=result?.segments??studioWheelSegments(this.game);
        const gradient=segments.map((segment,index)=>`${wheelColors[segment]} ${index/segments.length*360}deg ${(index+1)/segments.length*360}deg`).join(',');
        const rotation=result?720-(result.sector+.5)/segments.length*360:0;
        const board=tr`<div class="studio-wheel-shell"><i class="studio-wheel-pointer" aria-hidden="true"></i><div class="studio-wheel" style="background:conic-gradient(${gradient});transform:rotate(${rotation}deg)" role="img" aria-label="Колесо из ${segments.length} секторов${result?tr`, выпал ${wheelNames[segments[result.sector]]}`:''}">${segments.map((segment,index)=>`<span class="studio-wheel-label" style="--wheel-label-angle:${(index+.5)/segments.length*360}deg">${multiplier(studioWheelMultiplier(this.game,segment))}</span>`).join('')}</div><div class="studio-wheel-center"><span>${result?wheelNames[segments[result.sector]]:translateText('Удача')}<small>${result?translateText('СЕКТОР РАУНДА'):translateText('ВРАЩЕНИЕ')}</small></span></div></div>`;
        return this.stage(board,tr`${segments.length} СЕКТОРОВ`)+this.choices('target',[0,1,2,3],target,wheelNames,disabled,[0,1,2,3].map(value=>multiplier(studioWheelMultiplier(this.game,value))))+this.metrics(translateText('Выбранная цель'),wheelNames[target],translateText('Выплата за цель'),multiplier(result?.multiplier??studioWheelMultiplier(this.game,target)));
      }
      case 'mines': {
        const result=view?.kind==='mines'?view:undefined,cells=result?.cells??Array.from({length:16},()=>'hidden' as const),steps=result?.steps??0;
        const board=tr`<div class="studio-mines-grid" role="group" aria-label="Поле из шестнадцати ячеек">${cells.map((cell,index)=>tr`<button type="button" class="${cell}" data-mine="${index}" data-focus="mine-${index}" aria-label="Ячейка ${index+1}: ${cell==='hidden'?translateText('закрыта'):cell==='mine'?translateText('ловушка'):result?.opened.includes(index)?translateText('открыта безопасно'):translateText('безопасная')}" ${!playing||turnBlocked||cell!=='hidden'?'disabled':''}>${cell==='safe'?studioSymbol(5,this.info.theme):cell==='mine'?'<span class="studio-mine-lost" aria-hidden="true">✹</span>':'<span class="studio-mine-hidden" aria-hidden="true">◇</span>'}<small aria-hidden="true">${index+1}</small></button>`).join('')}</div><div class="studio-meter" role="group" aria-label="Шесть безопасных находок">${Array.from({length:6},(_,index)=>`<span class="${index<steps?'done':''}">${index<steps?'✓':index+1}</span>`).join('')}</div>`;
        return this.stage(board,translateText('4 ЛОВУШКИ'))+this.metrics(translateText('Можно забрать'),amount(result?.cashoutUnits??'0'),translateText('Следующая безопасная ячейка'),multiplier(studioMinesMultiplier(Math.min(6,steps+1))));
      }
    }
  }

  private rules() {
    const symbolRows = this.info.kind==='slot'?tr`<p>Обычные символы: ${[0,1,2].map(symbol=>escape(studioSymbolName(symbol,this.info.theme))).join(', ')}. ${this.info.paylines.length||this.info.ways?translateText('WILD заменяет обычные символы. '):''}SCATTER и USDT имеют отдельные бонусные правила.</p>`:'';
    let paytable='';
    if(this.info.kind==='slot'){
      const lineGame=!!(this.info.paylines.length||this.info.ways),cluster=this.info.features.includes('cluster');
      const table=studioSlotPaytable(this.game),counts=table[0].pays.map(pay=>pay.count);
      paytable=tr`<p>${lineGame?this.info.ways?translateText('Базовая выплата за один способ, до бонусных усилений.'):translateText('Базовая выплата за одну линию, до бонусных усилений.'):cluster?translateText('Базовая выплата за одну группу, до усилений ячеек.'):translateText('Базовая выплата за совпадения в поле, до собранных множителей.')}</p><table class="studio-paytable"><thead><tr><th>Символ</th>${counts.map(count=>`<th>${count}</th>`).join('')}</tr></thead><tbody>${table.map(({symbol,pays})=>`<tr><td>${studioSymbol(symbol,this.info.theme,'','tiny')}<span>${escape(studioSymbolName(symbol,this.info.theme))}</span></td>${pays.map(pay=>`<td>${multiplier(pay.multiplier)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Выплаты всех линий, способов и групп суммируются. Точную выплату бонусов показывает список под полем.</p>`;
    }
    const lineMaps=this.info.paylines.length?tr`<div class="studio-rule-lines" aria-label="Схемы выигрышных линий">${this.info.paylines.map((line,index)=>tr`<div class="studio-rule-line"><small>Линия ${index+1}</small><svg viewBox="0 0 100 50" aria-hidden="true">${Array.from({length:this.info.cols*this.info.rows},(_,cell)=>`<circle cx="${10+cell%this.info.cols*80/Math.max(1,this.info.cols-1)}" cy="${8+Math.floor(cell/this.info.cols)*34/Math.max(1,this.info.rows-1)}" r="2"/>`).join('')}<polyline points="${line.map((row,col)=>`${10+col*80/Math.max(1,this.info.cols-1)},${8+row*34/Math.max(1,this.info.rows-1)}`).join(' ')}"/></svg></div>`).join('')}</div>`:'';
    return tr`<details><summary data-focus="rules">Правила, символы и линии</summary><div class="studio-rules-copy"><p>${escape(STUDIO_RULES[this.game])}</p>${symbolRows}${paytable}${this.info.kind==='slot'?tr`<p data-studio-rtp>Расчётный возврат при ставке ${amount(this.stake)} с учётом округления: ${number(studioSlotRtp(this.game,this.stake)??98,8)}%. Это средний показатель на длинной серии раундов.</p>`:''}<p>Ставка указана за весь раунд. Бонусные ходы продолжат ту же партию без нового списания. Множитель включает ставку; каждая выплата округляется вниз до 0,01 USDT.</p><p>Результат и баланс сохраняются на сервере. При потере ответа «Проверить ход» подтвердит ту же операцию.</p>${lineMaps}</div></details>`;
  }

  private render() {
    if(this.destroyed)return;
    if(this.liveAction){this.actionControls();return;}
    this.rememberFocus();
    const session=this.renderBasis?this.renderBasis.session:client.sessions.find(value=>value.gameId===this.game);
    observeExpansionOutcome(this.host, this.game, session, client.accountId, true, false);
    if(session?.id!==this.sessionId){this.sessionId=session?.id??'';this.preview=false;this.historyIndex=-1;if(session){this.stake=session.stakeUnits;if(session.view.studio)this.syncSettings(session.view.studio);}}
    if(session?.view.phase!==this.phase){this.phase=session?.view.phase??-1;this.historyIndex=-1;}
    const playing=session?.state==='active',blocked=client.busy||!!client.pending,balance=this.renderBasis?.balance??demoWallet.wallet?.balance??client.wallet?.balance,ready=!!client.accountId&&balance!==undefined;
    const disabled=playing||blocked||client.loading,shown=this.preview?undefined:session,view=shown?.view.studio;
    if(playing)this.stake=session.stakeUnits;
    const settings=this.settings.studio as {numbers?:number[]};
    const selectionReady=this.info.kind!=='keno'||settings.numbers?.length===5;
    const primaryLabel=this.info.kind==='slot'?translateText('Вращать'):this.info.kind==='plinko'?translateText('Запустить шарик'):this.info.kind==='wheel'?translateText('Крутить колесо'):this.info.kind==='keno'?translateText('Открыть числа'):this.info.kind==='dice'?translateText('Проверить диапазон'):this.info.kind==='mines'?translateText('Начать поиск'):translateText('Начать маршрут');
    const offered=playing?session.view.actions.filter(action=>action.move!=='reveal').map(action=>`<button type="button" class="${action.move==='cashout'?'studio-cashout':'studio-primary'}" data-move="${escape(action.move)}" data-focus="move-${escape(action.move)}" ${blocked||!ready||client.loading||action.cost>(balance??0)*100?'disabled':''}>${escape(action.label)}${action.move==='cashout'&&view&&(view.kind==='crash'||view.kind==='flight'||view.kind==='mines')?` · ${amount(view.cashoutUnits)}`:''}${action.move==='studio-spin'?translateText(' · без списания'):''}</button>`).join(''):`<button type="button" class="studio-primary" data-start data-focus="start" ${blocked||!ready||client.loading||!selectionReady||Number(this.stake)>(balance??0)*100?'disabled':''}><span aria-hidden="true">${this.info.kind==='slot'?'↻':'▷'}</span>${primaryLabel} · ${amount(this.stake)}</button>`;
    let status=translateText('Выбери ставку и начни новый раунд.');
    if(!client.accountId)status=translateText('Войди в аккаунт, чтобы играть на общий тестовый баланс.');
    else if(!ready)status=translateText('Загружаем тестовый баланс…');
    else if(client.pending)status=translateText('Операция ожидает подтверждения. Проверь ход после восстановления связи.');
    else if(!selectionReady)status=translateText('Выбери ровно пять разных чисел.');
    else if(playing)status=this.info.kind==='slot'?translateText('Бонус сохранён. Следующий ход не списывает новую ставку.'):this.info.kind==='mines'?translateText('Выбери закрытую ячейку или забери выплату после находки.'):translateText('Продолжи сохранённый маршрут или забери выплату после успеха.');
    else if(this.preview)status=translateText('Новые настройки выбраны для следующего раунда.');
    else if(shown)status=tr`${shown.view.message} Выплачено: ${amount(shown.returnedUnits)}.`;
    const feedback=shown&&this.info.kind!=='slot'?this.metrics(translateText('Ставка партии'),amount(shown.spentUnits),playing?translateText('Партия'):translateText('Выплачено'),playing?translateText('Сохранена'):amount(shown.returnedUnits)):'';
    const renderKey=`${session?.id??''}:${session?.view.phase??''}:${client.busy}:${this.preview}`;
    this.host.innerHTML=tr`<section class="studio-game theme-${this.info.theme}" data-studio-game="${this.game}" data-phase="${view?'result':'idle'}" aria-label="${escape(this.info.name)}"><div class="studio-heading"><div><span class="studio-eyebrow">ROYAL STUDIO / ${categories[this.info.kind]}</span><h3>${escape(this.info.name)}</h3><p>${escape(this.info.subtitle)}</p></div><div class="studio-wallet"><small>USDT · Демо</small><strong data-studio-balance>${balance===undefined?'…':balance.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div></div><div class="studio-controls"><label>Ставка<select data-stake data-focus="stake" ${disabled?'disabled':''}>${DEMO_BETS.map(value=>tr`<option value="${value*100}" ${String(value*100)===this.stake?'selected':''}>${value.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})} USDT</option>`).join('')}</select></label><span>Общий баланс USDT клуба</span></div>${this.board(view,playing,disabled,blocked||!ready||client.loading)}${feedback}<div class="studio-actions">${offered}${client.pending?tr`<button type="button" data-retry data-focus="retry" ${client.busy?'disabled':''}>Проверить ход</button>`:''}<button type="button" data-refresh data-focus="refresh" ${client.busy||client.loading?'disabled':''}>Обновить</button></div><p class="studio-status" role="status">${escape(status)}</p><p class="studio-error" role="alert">${escape(this.error||client.error)}</p>${this.rules()}</section>`;
    if(this.refreshKey===renderKey)this.host.querySelector('.studio-reels-shell')?.classList.remove('revealed');
    this.refreshKey=renderKey;
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange=event=>{this.stake=(event.target as HTMLSelectElement).value;this.preview=true;this.render();};
    this.host.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach(button=>button.onclick=()=>{if(button.disabled)return;const key=button.dataset.setting!,value=button.dataset.value!;this.update({[key]:['chance','target'].includes(key)?Number(value):value});});
    this.host.querySelectorAll<HTMLButtonElement>('[data-number]').forEach(button=>button.onclick=()=>{if(button.disabled)return;const value=Number(button.dataset.number),numbers=[...(this.settings.studio as {numbers:number[]}).numbers];if(numbers.includes(value))numbers.splice(numbers.indexOf(value),1);else if(numbers.length<5)numbers.push(value);else return;this.update({numbers:numbers.sort((a,b)=>a-b)});});
    this.host.querySelectorAll<HTMLButtonElement>('[data-frame]').forEach(button=>button.onclick=()=>{if(button.disabled)return;this.historyIndex=Number(button.dataset.frame);this.render();});
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'start',stakeUnits:this.stake,settings:this.settings}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button=>button.onclick=()=>void this.act({gameId:this.game,action:'move',sessionId:session!.id,move:button.dataset.move!}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-mine]').forEach(button=>button.onclick=()=>{if(button.disabled)return;void this.act({gameId:this.game,action:'move',sessionId:session!.id,move:'reveal',picks:[Number(button.dataset.mine)]});});
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click',()=>void this.run(()=>client.retry(),true));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>void this.run(()=>client.refresh());
    this.restoreFocus();
  }

  destroy(){this.destroyed=true;this.cancelAction();client.removeEventListener('change',this.change);demoWallet.removeEventListener('change',this.change);document.removeEventListener('visibilitychange',this.lifecycle);this.reduced.removeEventListener('change',this.lifecycle);this.host.replaceChildren();}
}
