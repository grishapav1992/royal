import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import {
  STUDIO_INFO, STUDIO_DEFAULTS, STUDIO_RULES, studioKenoMultiplier, studioDiceMultiplier,
  studioPlinkoTable, studioWheelSegments, studioWheelMultiplier, studioRiskThreshold,
  studioRiskMax, studioRiskMultiplier, studioMinesMultiplier,
  studioSlotPaytable, studioSlotRtp,
  type StudioGameId, type StudioInfo, type StudioSettings, type StudioView,
  type StudioSlotView, type StudioSlotFrame, type StudioWin,
} from '../shared/studioGames';
import { DEMO_BETS } from '../shared/demoWallet';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { STUDIO_ART, studioEscape as escape, studioSymbol, studioSymbolName } from './StudioArtwork';
import { NeonSlotUI } from './NeonSlotUI';
import { StudioSlotUI } from './StudioSlotUI';
import { CascadeSlotUI } from './CascadeSlotUI';
import { ClusterSlotUI } from './ClusterSlotUI';
import { ElementSlotUI } from './ElementSlotUI';
import './studio-games.css';

const number = (value: number, digits = 2) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const amount = (units: string | number) => `${(Number(units) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} монет`;
const multiplier = (value: number) => `${number(value, 4)}×`;
const categories = {slot:'СЛОТЫ',crash:'МАРШРУТ РИСКА',flight:'ПОЛЁТ',keno:'КЕНО',plinko:'ПЛИНКО',dice:'КОСТИ',wheel:'КОЛЕСО',mines:'ПОИСК СОКРОВИЩ'};
const featureNames = {expand:'Расширение WILD',tumble:'Каскады','multiplier-wild':'WILD с множителем',collect:'Сбор символов',hold:'Закреплённые монеты',cluster:'Группы соседей',ways:'Способы выигрыша',sticky:'Липкие WILD',chosen:'Символ раунда','cell-multipliers':'Множители ячеек',walking:'Шагающий WILD',synced:'Связанные барабаны',wheels:'Бонусное колесо',mystery:'Загадочные символы',beam:'Луч WILD',trail:'След WILD',wish:'Бонус желания',orbs:'Сбор множителей'};
const wheelNames = ['Золото','Изумруд','Рубин','Звезда'];
const wheelColors = ['#d6a34f','#4c9781','#b55976','#7b65b4'];

/** Every revealed symbol and wallet amount is read from the saved server session. */
export class StudioGamesUI {
  private neon?: NeonSlotUI;
  private presentedSlot?: StudioSlotUI;
  private cascade?: CascadeSlotUI;
  private cluster?: ClusterSlotUI;
  private element?: ElementSlotUI;
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
  private change = () => this.render();

  constructor(private host: HTMLElement, private game: StudioGameId) {
    resetGameOutcomes(host);
    this.info = STUDIO_INFO[game];
    this.settings = structuredClone(STUDIO_DEFAULTS[game]);
    if (game === 'studio-neon-crown') { this.neon = new NeonSlotUI(host); return; }
    if (game === 'studio-cosmic-escape' || game === 'studio-velvet-reign') { this.presentedSlot = new StudioSlotUI(host, game); return; }
    if (game === 'studio-caramel-carnival' || game === 'studio-starfall-oracle') { this.cascade = new CascadeSlotUI(host, game); return; }
    if (game === 'studio-lumen-grove' || game === 'studio-prism-atelier') { this.cluster = new ClusterSlotUI(host, game); return; }
    if (game === 'studio-stormforge-duel' || game === 'studio-saffron-cipher' || game === 'studio-beacon-bay') { this.element = new ElementSlotUI(host, game); return; }
    client.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
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

  private act(operation: NewExpansionAction) { return this.run(() => client.act(operation), true); }

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
    const stageName = {'base':'ОСНОВНОЙ СПИН','free-spin':'БЕСПЛАТНЫЙ СПИН','tumble':'КАСКАД','hold':'ЗАКРЕПЛЕНИЕ МОНЕТ'}[stage];
    const payout = frame?.payoutUnits ?? view?.history.at(-1)?.payoutUnits ?? '0';
    const total = view?.totalPayoutUnits ?? '0';
    const mode = this.info.paylines.length ? `${this.info.paylines.length} линий` : this.info.ways ? `${number(this.info.ways,0)} способов` : this.info.features.includes('cluster') ? 'Группы от 5 символов' : 'Совпадения от 8 символов';
    const cells = grid.map((symbol,index)=>`<div class="studio-cell ${winning.has(index)?'win':''} ${symbol>=3?'special':''} ${held.includes(index)?'held':''}" style="--cell-column:${index%cols}" data-slot-cell="${index}" role="img" aria-label="Ячейка ${index+1}: ${escape(studioSymbolName(symbol,this.info.theme))}${winning.has(index)?', участвует в выигрыше':''}${held.includes(index)?', закреплена':''}">${studioSymbol(symbol,this.info.theme)}${symbol===3?'<span class="studio-special-label">WILD</span>':symbol===4?'<span class="studio-special-label">SCATTER</span>':''}</div>`).join('');
    const history = view && view.history.length > 1 ? `<div class="studio-steps" role="group" aria-label="Этапы сохранённого раунда">${view.history.map((item,index)=>`<button type="button" data-frame="${index}" data-focus="frame-${index}" aria-pressed="${this.historyIndex===index||this.historyIndex<0&&index===view.history.length-1}" ${busy?'disabled':''}>${item.stage==='base'?'Спин':item.stage==='tumble'?'Каскад':item.stage==='hold'?'Монеты':'Бонус'} ${index+1} · ${amount(item.payoutUnits)}</button>`).join('')}</div>` : '';
    const badges = this.info.features.slice(0,3).map(feature=>`<span>${featureNames[feature]}</span>`).join('');
    const matchLabel=this.info.features.includes('cluster')?'Группы по сторонам ячеек':this.info.features.includes('tumble')?'Символы в любой части поля':'WILD заменяет обычный символ';
    const content = `<div class="studio-reels-shell ${busy?'spinning':view?'revealed':''}"><div class="studio-reels" style="--studio-cols:${cols}" role="group" aria-label="${cols} барабанов, ${rows} рядов">${cells}${lines?`<svg class="studio-win-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`:''}</div></div><div class="studio-stage-payout ${Number(total)===0?'empty':''}"><small>${frame?'ВЫПЛАТА ВЫБРАННОГО ЭТАПА':view?playing?'НАКОПЛЕНО ЗА РАУНД':'ВЫПЛАЧЕНО ЗА РАУНД':'ВПЕРЕДИ НОВЫЙ РАУНД'}</small><strong>${view?amount(frame?payout:total):'Поймай свою комбинацию'}</strong>${frame?`<span class="studio-multiplier">Всего за раунд: ${amount(total)}</span>`:''}</div><div class="studio-slot-status"><span>${escape(mode)}</span><span>${view?.remaining?`Бонусных ходов: <b>${view.remaining}</b>`:matchLabel}</span></div>${badges?`<div class="studio-stage-badges">${badges}</div>`:''}${history}`;
    const winList = wins.length ? `<ul class="studio-win-list" aria-label="Выплаты показанного этапа">${wins.map(win=>`<li><span>${studioSymbol(win.symbol,this.info.theme)}${escape(this.winLabel(win))}</span><strong>${amount(win.payoutUnits)}</strong></li>`).join('')}</ul>` : '';
    return this.stage(content,stageName)+winList;
  }

  private winLabel(win: StudioWin) {
    const label = win.kind==='line'?`Линия ${(win.line??0)+1}`:win.kind==='ways'?'Способы':win.kind==='cluster'?'Группа соседей':win.kind==='anywhere'?'Совпадения в поле':win.kind==='collect'?'Сборщик':win.kind==='coin'?'Монеты':'Бонусное колесо';
    return `${label} · ${win.count} символов · ${multiplier(win.multiplier)}`;
  }

  private board(view: StudioView | undefined, playing: boolean, disabled: boolean, turnBlocked: boolean) {
    switch(this.info.kind) {
      case 'slot': return this.slot(view?.kind==='slot'?view:undefined,client.busy&&client.pending?.gameId===this.game,playing);
      case 'crash': case 'flight': {
        const result = view?.kind==='crash'||view?.kind==='flight'?view:undefined;
        const steps = result?.steps ?? 0, max = result?.maxSteps ?? studioRiskMax(this.game), threshold = studioRiskThreshold(this.game), progress = steps/max*100;
        const lost = result?.history.at(-1)?.safe===false;
        const board = `<div class="studio-fly-board"><div class="studio-floating-token">${studioSymbol(3,this.info.theme)}</div><svg viewBox="0 0 430 180" aria-hidden="true"><path class="studio-flight-shadow" d="M20 160Q100 150 170 113T390 16"/><path class="studio-flight-track" d="M20 160Q100 150 170 113T390 16"/><circle cx="${20+steps/max*365}" cy="${160-steps/max*140}" r="8" fill="${lost?'#ef9694':'#ffe5a0'}"/></svg><div class="studio-flight-value">${multiplier(result?.multiplier??1)}<small>${lost?'МАРШРУТ ПРЕРВАН':playing?'ПОЛЁТ СОХРАНЁН':'ВЫБЕРИ МОМЕНТ ДЛЯ СТАРТА'}</small></div><div class="studio-flight-progress" style="--flight-progress:${progress}%"><i></i></div><div class="studio-journey" role="group" aria-label="Этапы маршрута">${Array.from({length:max},(_,index)=>`<span class="${index<steps?'done':''}">${index<steps?'✓':index+1}</span>`).join('')}</div></div>`;
        return this.stage(board,`${max} ЭТАПОВ`)+this.metrics('Можно забрать',amount(result?.cashoutUnits??'0'),'Следующий успешный этап',multiplier(studioRiskMultiplier(this.game,Math.min(max,steps+1))))+`<p class="studio-status">Каждый этап: безопасно при ${threshold}+ на шестигранной кости. Вероятность успеха ${7-threshold} из 6. После успеха можно забрать выплату.</p>`;
      }
      case 'keno': {
        const result = view?.kind==='keno'?view:undefined;
        const settings = this.settings.studio as {numbers:number[];target:2|3};
        const selected = result?.numbers ?? settings.numbers, target = result?.target ?? settings.target;
        const grid = `<div class="studio-keno-grid" role="group" aria-label="Выбери пять чисел от 1 до 20">${Array.from({length:20},(_,index)=>{const value=index+1,drawn=result?.drawn.includes(value),hit=drawn&&selected.includes(value);return `<button type="button" data-number="${value}" data-focus="number-${value}" aria-pressed="${selected.includes(value)}" aria-label="Число ${value}${hit?', совпадение':drawn?', выпало':''}" class="${drawn?'drawn':''} ${hit?'hit':''}" ${disabled?'disabled':''}>${value}</button>`;}).join('')}</div>${result?`<div class="studio-keno-result" aria-label="Выпавшие числа">${result.drawn.map(value=>`<span class="${selected.includes(value)?'hit':''}">${value}</span>`).join('')}</div>`:''}`;
        return this.stage(grid,'ПЯТЬ ИЗ ДВАДЦАТИ')+this.choices('target',[2,3],target,['От двух совпадений','От трёх совпадений'],disabled)+this.metrics(result?'Совпадения':'Выбрано чисел',result?`${result.hits} из 5`:`${selected.length} из 5`,'Выплата за цель',multiplier(result?.multiplier??studioKenoMultiplier(target)));
      }
      case 'plinko': {
        const result = view?.kind==='plinko'?view:undefined;
        const risk = result?.risk??(this.settings.studio as {risk:'low'|'medium'|'high'}).risk, table = result?.table??studioPlinkoTable(risk);
        const pegs=Array.from({length:12},(_,row)=>Array.from({length:row+1},(_,col)=>`<circle class="peg" cx="${195+(col*2-row)*13}" cy="${29+row*19}" r="2.7"/>`).join('')).join('');
        let x=195;const path=['195,10',...(result?.path??[]).map((direction,row)=>{x+=direction?13:-13;return `${x},${29+row*19}`;}),`${x},264`].join(' ');
        const buckets=table.map((value,index)=>`<rect class="bucket ${result?.bucket===index?'hit':''}" x="${195+(index-6)*26-11}" y="251" width="22" height="29" rx="4"/><text class="bucket-label ${result?.bucket===index?'hit':''}" x="${195+(index-6)*26}" y="270">${number(value,2)}×</text>`).join('');
        const board=`<svg class="studio-plinko" viewBox="15 0 360 295" role="img" aria-label="Плинко, двенадцать рядов${result?`, итоговая ячейка ${result.bucket}`:''}"><title>Множители ячеек: ${table.map(multiplier).join(', ')}</title>${pegs}${buckets}${result?`<polyline class="route" points="${path}"/><circle class="ball" cx="${x}" cy="244" r="6"/>`:'<circle class="ball" cx="195" cy="10" r="6"/>'}</svg>`;
        return this.stage(board,'12 РЯДОВ')+this.choices('risk',['low','medium','high'],risk,['Спокойный','Средний','Высокий риск'],disabled)+this.metrics('Результат шарика',result?multiplier(result.multiplier):'Ждёт запуска','Максимальная выплата',multiplier(Math.max(...table)));
      }
      case 'dice': {
        const result=view?.kind==='dice'?view:undefined,settings=this.settings.studio as {chance:25|50|75;direction:'under'|'over'};
        const chance=result?.chance??settings.chance,direction=result?.direction??settings.direction;
        const low=direction==='under'?0:100-chance,high=direction==='under'?chance-1:99;
        const board=`<div class="studio-fly-board"><div class="studio-flight-value">${result?String(result.roll).padStart(2,'0'):'00'}<small>${result?result.won?'ПОПАДАНИЕ В ДИАПАЗОН':'ЗА ПРЕДЕЛАМИ ДИАПАЗОНА':'РЕЗУЛЬТАТ ОТ 00 ДО 99'}</small></div><svg viewBox="0 0 430 170" aria-hidden="true"><path class="studio-flight-shadow" d="M25 142H405"/><path class="studio-flight-track" d="M${25+low/100*380} 142H${25+(high+1)/100*380}"/>${result?`<circle cx="${25+result.roll/100*380}" cy="142" r="7" fill="#ffe9a0"/>`:''}</svg><p class="studio-dice-sum">Выигрышные числа: <strong>${low}-${high}</strong></p></div>`;
        return this.stage(board,'100 ИСХОДОВ')+this.choices('chance',[25,50,75],chance,['25%','50%','75%'],disabled,['Узкая цель','Средняя цель','Широкая цель'])+this.choices('direction',['under','over'],direction,['Ниже','Выше'],disabled)+this.metrics('Вероятность попадания',`${chance}%`,'Выплата за попадание',multiplier(result?.multiplier??studioDiceMultiplier(chance)));
      }
      case 'wheel': {
        const result=view?.kind==='wheel'?view:undefined,target=result?.target??(this.settings.studio as {target:0|1|2|3}).target,segments=result?.segments??studioWheelSegments(this.game);
        const gradient=segments.map((segment,index)=>`${wheelColors[segment]} ${index/segments.length*360}deg ${(index+1)/segments.length*360}deg`).join(',');
        const rotation=result?720-(result.sector+.5)/segments.length*360:0;
        const board=`<div class="studio-wheel-shell"><i class="studio-wheel-pointer" aria-hidden="true"></i><div class="studio-wheel" style="background:conic-gradient(${gradient});transform:rotate(${rotation}deg)" role="img" aria-label="Колесо из ${segments.length} секторов${result?`, выпал ${wheelNames[segments[result.sector]]}`:''}">${segments.map((segment,index)=>`<span class="studio-wheel-label" style="--wheel-label-angle:${(index+.5)/segments.length*360}deg">${multiplier(studioWheelMultiplier(this.game,segment))}</span>`).join('')}</div><div class="studio-wheel-center"><span>${result?wheelNames[segments[result.sector]]:'Удача'}<small>${result?'СЕКТОР РАУНДА':'ВРАЩЕНИЕ'}</small></span></div></div>`;
        return this.stage(board,`${segments.length} СЕКТОРОВ`)+this.choices('target',[0,1,2,3],target,wheelNames,disabled,[0,1,2,3].map(value=>multiplier(studioWheelMultiplier(this.game,value))))+this.metrics('Выбранная цель',wheelNames[target],'Выплата за цель',multiplier(result?.multiplier??studioWheelMultiplier(this.game,target)));
      }
      case 'mines': {
        const result=view?.kind==='mines'?view:undefined,cells=result?.cells??Array.from({length:16},()=>'hidden' as const),steps=result?.steps??0;
        const board=`<div class="studio-mines-grid" role="group" aria-label="Поле из шестнадцати ячеек">${cells.map((cell,index)=>`<button type="button" class="${cell}" data-mine="${index}" data-focus="mine-${index}" aria-label="Ячейка ${index+1}: ${cell==='hidden'?'закрыта':cell==='mine'?'ловушка':result?.opened.includes(index)?'открыта безопасно':'безопасная'}" ${!playing||turnBlocked||cell!=='hidden'?'disabled':''}>${cell==='safe'?studioSymbol(5,this.info.theme):cell==='mine'?'<span class="studio-mine-lost" aria-hidden="true">✹</span>':'<span class="studio-mine-hidden" aria-hidden="true">◇</span>'}<small aria-hidden="true">${index+1}</small></button>`).join('')}</div><div class="studio-meter" role="group" aria-label="Шесть безопасных находок">${Array.from({length:6},(_,index)=>`<span class="${index<steps?'done':''}">${index<steps?'✓':index+1}</span>`).join('')}</div>`;
        return this.stage(board,'4 ЛОВУШКИ')+this.metrics('Можно забрать',amount(result?.cashoutUnits??'0'),'Следующая безопасная ячейка',multiplier(studioMinesMultiplier(Math.min(6,steps+1))));
      }
    }
  }

  private rules() {
    const symbolRows = this.info.kind==='slot'?`<p>Обычные символы: ${[0,1,2].map(symbol=>escape(studioSymbolName(symbol,this.info.theme))).join(', ')}. ${this.info.paylines.length||this.info.ways?'WILD заменяет обычные символы. ':''}SCATTER и монеты имеют отдельные бонусные правила.</p>`:'';
    let paytable='';
    if(this.info.kind==='slot'){
      const lineGame=!!(this.info.paylines.length||this.info.ways),cluster=this.info.features.includes('cluster');
      const table=studioSlotPaytable(this.game),counts=table[0].pays.map(pay=>pay.count);
      paytable=`<p>${lineGame?this.info.ways?'Базовая выплата за один способ, до бонусных усилений.':'Базовая выплата за одну линию, до бонусных усилений.':cluster?'Базовая выплата за одну группу, до усилений ячеек.':'Базовая выплата за совпадения в поле, до собранных множителей.'}</p><table class="studio-paytable"><thead><tr><th>Символ</th>${counts.map(count=>`<th>${count}</th>`).join('')}</tr></thead><tbody>${table.map(({symbol,pays})=>`<tr><td>${studioSymbol(symbol,this.info.theme,'','tiny')}<span>${escape(studioSymbolName(symbol,this.info.theme))}</span></td>${pays.map(pay=>`<td>${multiplier(pay.multiplier)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Выплаты всех линий, способов и групп суммируются. Точную выплату бонусов показывает список под полем.</p>`;
    }
    const lineMaps=this.info.paylines.length?`<div class="studio-rule-lines" aria-label="Схемы выигрышных линий">${this.info.paylines.map((line,index)=>`<div class="studio-rule-line"><small>Линия ${index+1}</small><svg viewBox="0 0 100 50" aria-hidden="true">${Array.from({length:this.info.cols*this.info.rows},(_,cell)=>`<circle cx="${10+cell%this.info.cols*80/Math.max(1,this.info.cols-1)}" cy="${8+Math.floor(cell/this.info.cols)*34/Math.max(1,this.info.rows-1)}" r="2"/>`).join('')}<polyline points="${line.map((row,col)=>`${10+col*80/Math.max(1,this.info.cols-1)},${8+row*34/Math.max(1,this.info.rows-1)}`).join(' ')}"/></svg></div>`).join('')}</div>`:'';
    return `<details><summary data-focus="rules">Правила, символы и линии</summary><div class="studio-rules-copy"><p>${escape(STUDIO_RULES[this.game])}</p>${symbolRows}${paytable}${this.info.kind==='slot'?`<p data-studio-rtp>Расчётный возврат при ставке ${amount(this.stake)} с учётом округления: ${number(studioSlotRtp(this.game,this.stake)??98,8)}%. Это средний показатель на длинной серии раундов.</p>`:''}<p>Ставка указана за весь раунд. Бонусные ходы продолжат ту же партию без нового списания. Множитель включает ставку; каждая выплата округляется вниз до 0,01 монеты.</p><p>Результат и баланс сохраняются на сервере. При потере ответа «Проверить ход» подтвердит ту же операцию.</p>${lineMaps}</div></details>`;
  }

  private render() {
    if(this.destroyed)return;
    this.rememberFocus();
    const session=client.sessions.find(value=>value.gameId===this.game);
    observeExpansionOutcome(this.host, this.game, session, client.accountId, client.busy, client.pending?.gameId === this.game);
    if(session?.id!==this.sessionId){this.sessionId=session?.id??'';this.preview=false;this.historyIndex=-1;if(session){this.stake=session.stakeUnits;if(session.view.studio)this.syncSettings(session.view.studio);}}
    if(session?.view.phase!==this.phase){this.phase=session?.view.phase??-1;this.historyIndex=-1;}
    const playing=session?.state==='active',blocked=client.busy||!!client.pending,balance=demoWallet.wallet?.balance??client.wallet?.balance,ready=!!client.accountId&&balance!==undefined;
    const disabled=playing||blocked||client.loading,shown=this.preview?undefined:session,view=shown?.view.studio;
    if(playing)this.stake=session.stakeUnits;
    const settings=this.settings.studio as {numbers?:number[]};
    const selectionReady=this.info.kind!=='keno'||settings.numbers?.length===5;
    const primaryLabel=this.info.kind==='slot'?'Вращать':this.info.kind==='plinko'?'Запустить шарик':this.info.kind==='wheel'?'Крутить колесо':this.info.kind==='keno'?'Открыть числа':this.info.kind==='dice'?'Проверить диапазон':this.info.kind==='mines'?'Начать поиск':'Начать маршрут';
    const offered=playing?session.view.actions.filter(action=>action.move!=='reveal').map(action=>`<button type="button" class="${action.move==='cashout'?'studio-cashout':'studio-primary'}" data-move="${escape(action.move)}" data-focus="move-${escape(action.move)}" ${blocked||!ready||client.loading||action.cost>(balance??0)*100?'disabled':''}>${escape(action.label)}${action.move==='cashout'&&view&&(view.kind==='crash'||view.kind==='flight'||view.kind==='mines')?` · ${amount(view.cashoutUnits)}`:''}${action.move==='studio-spin'?' · без списания':''}</button>`).join(''):`<button type="button" class="studio-primary" data-start data-focus="start" ${blocked||!ready||client.loading||!selectionReady||Number(this.stake)>(balance??0)*100?'disabled':''}><span aria-hidden="true">${this.info.kind==='slot'?'↻':'▷'}</span>${primaryLabel} · ${amount(this.stake)}</button>`;
    let status='Выбери ставку и начни новый раунд.';
    if(!client.accountId)status='Войди в аккаунт, чтобы играть на общий тестовый баланс.';
    else if(!ready)status='Загружаем тестовый баланс…';
    else if(client.pending)status='Операция ожидает подтверждения. Проверь ход после восстановления связи.';
    else if(!selectionReady)status='Выбери ровно пять разных чисел.';
    else if(playing)status=this.info.kind==='slot'?'Бонус сохранён. Следующий ход не списывает новую ставку.':this.info.kind==='mines'?'Выбери закрытую ячейку или забери выплату после находки.':'Продолжи сохранённый маршрут или забери выплату после успеха.';
    else if(this.preview)status='Новые настройки выбраны для следующего раунда.';
    else if(shown)status=`${shown.view.message} Выплачено: ${amount(shown.returnedUnits)}.`;
    const feedback=shown&&this.info.kind!=='slot'?this.metrics('Ставка партии',amount(shown.spentUnits),playing?'Партия':'Выплачено',playing?'Сохранена':amount(shown.returnedUnits)):'';
    const renderKey=`${session?.id??''}:${session?.view.phase??''}:${client.busy}:${this.preview}`;
    this.host.innerHTML=`<section class="studio-game theme-${this.info.theme}" data-studio-game="${this.game}" aria-label="${escape(this.info.name)}"><div class="studio-heading"><div><span class="studio-eyebrow">ROYAL STUDIO / ${categories[this.info.kind]}</span><h3>${escape(this.info.name)}</h3><p>${escape(this.info.subtitle)}</p></div><div class="studio-wallet"><small>Тестовый баланс</small><strong data-studio-balance>${balance===undefined?'…':balance.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div></div><div class="studio-controls"><label>Ставка<select data-stake data-focus="stake" ${disabled?'disabled':''}>${DEMO_BETS.map(value=>`<option value="${value*100}" ${String(value*100)===this.stake?'selected':''}>${value.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} монет</option>`).join('')}</select></label><span>Общий тестовый кошелёк клуба</span></div>${this.board(view,playing,disabled,blocked||!ready||client.loading)}${feedback}<div class="studio-actions">${offered}${client.pending?`<button type="button" data-retry data-focus="retry" ${client.busy?'disabled':''}>Проверить ход</button>`:''}<button type="button" data-refresh data-focus="refresh" ${client.busy||client.loading?'disabled':''}>Обновить</button></div><p class="studio-status" role="status">${escape(status)}</p><p class="studio-error" role="alert">${escape(this.error||client.error)}</p>${this.rules()}</section>`;
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

  destroy(){if(this.neon){this.neon.destroy();return;}if(this.presentedSlot){this.presentedSlot.destroy();return;}if(this.cascade){this.cascade.destroy();return;}if(this.cluster){this.cluster.destroy();return;}if(this.element){this.element.destroy();return;}this.destroyed=true;client.removeEventListener('change',this.change);demoWallet.removeEventListener('change',this.change);this.host.replaceChildren();}
}
