import type {GameHostV1} from '../../src/modules/GameHostContract';
import type {ExpansionSession} from '../../src/shared/casinoExpansion';
import {TEMPLE_GAME,type TempleView} from '../../src/shared/floodedTemple';
import {TEMPLE_DATA,templeLegalActions} from '../../src/shared/floodedTempleMath';
import {art,prop,escape,roomName} from './art';
import {boardMarkup,roomDescription} from './board';
import {TempleAudio} from './TempleAudio';
import {TempleTimeline} from './TempleTimeline';
import {TempleEffects} from './TempleEffects';
import {templePlan,templeOutcome,type TempleBeat} from './presentation';
import {templeMusic} from './audioCredits';
import {TempleCharacter} from './TempleCharacter';
import {templeRouteChoices,templeSelectedRoom,templeDirection} from './navigation';
const AUTO_COUNTS=[10,25,50,100] as const;
type AutoNote=''|'complete'|'stopped'|'funds'|'error'|'paused'|'account';

/** Presentation reads confirmed views and uses the host's serialized operation client. */
export class TempleUI {
  private readonly root:HTMLElement;
  private readonly dialog:HTMLDialogElement;
  private readonly en:boolean;
  private owner:string|null=null;
  private marker='';
  private selected:number|null=null;
  private inspected:number|null=null;
  private rope=false;
  private tab:'base'|'bonus'='base';
  private stake='1000';
  private fast=false;
  private autoCount=10;
  private autoRunning=false;
  private autoRemaining=0;
  private autoInFlight=false;
  private autoTimer=0;
  private autoEpoch=0;
  private autoNote:AutoNote='';
  private sending=false;
  private operationEpoch=0;
  private disposed=false;
  private localError='';
  private rendered='';
  private audio:TempleAudio;
  private timeline:TempleTimeline;
  private effects:TempleEffects;
  private character:TempleCharacter;
  private beat?:TempleBeat;
  private frozenView?:TempleView;
  private media:MediaQueryList;
  private unsubscribePreferences:()=>void;
  private feedbackMarker='';
  private returnFocus:HTMLElement|null=null;
  private readonly changed=()=>this.sync();
  private readonly click=(event:Event)=>this.onClick(event);
  private readonly key=(event:KeyboardEvent)=>{
    const target=event.target as HTMLElement;
    if(!target.matches('[data-room]'))return;
    const room=Number(target.dataset.room),key=event.key;
    const next=key==='ArrowLeft'&&room%5>0?room-1:key==='ArrowRight'&&room%5<4?room+1:key==='ArrowUp'&&room>=5?room-5:key==='ArrowDown'&&room<15?room+5:undefined;
    if(next!==undefined){event.preventDefault();this.root.querySelector<HTMLButtonElement>(`[data-room="${next}"]`)?.focus();}
  };
  constructor(private host:HTMLElement,private services:GameHostV1){
    this.en=services.i18n.language==='en';
    const doc=host.ownerDocument;this.root=doc.createElement('section');this.root.className='ft';
    try{this.fast=doc.defaultView!.localStorage.getItem('royal:temple:fast')==='1';const count=Number(doc.defaultView!.localStorage.getItem('royal:temple:auto-count'));if(AUTO_COUNTS.some(n=>n===count))this.autoCount=count;}catch{/* Playback preferences are optional. */}
    this.root.setAttribute('aria-label',this.text('Затопленный храм','Flooded Temple'));
    this.dialog=doc.createElement('dialog');this.dialog.className='ft-dialog';this.dialog.setAttribute('aria-labelledby','ft-dialog-title');
    host.replaceChildren(this.root,this.dialog);
    services.gameAudio.install();this.media=doc.defaultView!.matchMedia('(prefers-reduced-motion: reduce)');
    this.audio=new TempleAudio(services.gameAudio,doc);this.effects=new TempleEffects(this.root,units=>this.money(units));this.character=new TempleCharacter(doc,this.en);
    this.timeline=new TempleTimeline(this.audio,beat=>{this.beat=beat;if(!beat)this.effects.clear();this.rendered='';if(!this.disposed){this.render();this.pumpAuto();}},(beat,offset)=>{this.effects.tick(beat,offset);this.character.tick(beat,offset);});
    this.unsubscribePreferences=services.gameAudio.onPreferences(()=>{this.rendered='';if(!this.disposed)this.render();});
    doc.addEventListener('visibilitychange',this.visibility);if(doc!==document)document.addEventListener('visibilitychange',this.visibility);
    this.media.addEventListener('change',this.motionChanged);this.visibility();
    this.root.addEventListener('click',this.click);this.root.addEventListener('keydown',this.key);
    this.root.addEventListener('change',this.changedStake);
    this.dialog.addEventListener('click',this.click);
    this.dialog.addEventListener('close',()=>{
      if(this.disposed)return;const key=this.returnFocus?.dataset.ft;
      this.timeline.resume('dialog');this.rendered='';this.render();
      const target=this.returnFocus?.isConnected?this.returnFocus:key?this.root.querySelector<HTMLElement>(`[data-ft="${key}"]`):null;target?.focus();
      this.pumpAuto();
    });
    services.expansionClient.addEventListener('change',this.changed);services.demoWallet.addEventListener('change',this.changed);
    this.sync();void services.expansionClient.refresh();this.render();
  }
  private text(ru:string,en:string){return this.en?en:ru;}
  private get client(){return this.services.expansionClient;}
  private get wallet(){return this.services.demoWallet;}
  private get session():ExpansionSession|undefined{
    if(!this.owner||this.client.accountId!==this.owner||this.wallet.accountId!==this.owner)return;
    return this.client.sessions.find(s=>s.gameId===TEMPLE_GAME);
  }
  private get view():TempleView|undefined{return this.session?.view.temple;}
  private get blocked(){return this.timeline.active||this.timeline.paused||this.sending||this.client.busy||this.client.loading||this.wallet.busy||!!this.wallet.pending||this.wallet.hasExternalBusy('expansion')||!!this.client.pending&&this.client.pending.gameId!==TEMPLE_GAME;}
  private get connected(){return !!this.owner&&this.wallet.accountId===this.owner&&!!this.wallet.wallet;}
  private money(units:string){return (Number(units)/100).toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});}
  private get asset(){return this.wallet.wallet?.asset==='USDT_NILE_TEST'?'USDT':this.text('демомонеты','demo coins');}
  private sync(){
    if(this.disposed)return;
    if(this.owner!==this.client.accountId){this.stopAuto('account',false);this.operationEpoch++;this.sending=false;this.timeline.cancel();this.beat=undefined;this.frozenView=undefined;this.owner=this.client.accountId;this.marker='';this.selected=null;this.inspected=null;this.rope=false;this.tab='base';this.localError='';this.dialog.close();}
    const session=this.session,marker=session?session.id+':'+session.view.temple?.revision:'';
    if(marker!==this.marker){if(this.timeline.active&&marker!==this.feedbackMarker){this.timeline.cancel();this.beat=undefined;}this.marker=marker;this.selected=null;this.inspected=null;this.rope=false;
      const v=session?.view.temple;if(v){this.stake=session!.stakeUnits;this.tab=v.bonusMap?'bonus':'base';}
    }
    const pending=this.client.pending;if(pending?.gameId===TEMPLE_GAME&&pending.action==='start')this.stake=pending.stakeUnits;
    this.audio.setAccountActive(this.connected);
    this.pumpAuto();this.render();
  }
  private changedStake=(event:Event)=>{
    const select=event.target as HTMLSelectElement;
    if(select.matches('[data-ft=auto-count]')&&!this.autoRunning&&!this.blocked&&!this.client.pending&&AUTO_COUNTS.some(n=>String(n)===select.value)){this.autoCount=Number(select.value);this.savePlayback();this.render();return;}
    if(select.matches('[data-ft=stake]')&&!this.autoRunning&&!this.blocked&&!this.client.pending&&this.session?.state!=='active'&&TEMPLE_DATA.stakes.some(n=>String(n)===select.value)){this.stake=select.value;this.render();}
  };
  private render(){
    if(this.disposed)return;
    if(!this.beat&&!this.sending&&!this.client.pending&&this.session?.state==='active'&&this.tab==='bonus')this.selected=templeSelectedRoom(this.view,this.selected);
    const signature=JSON.stringify([this.owner,this.session,this.client.pending,this.client.busy,this.client.loading,this.client.error,this.wallet.accountId,this.wallet.wallet?.balance,this.wallet.wallet?.asset,this.wallet.busy,this.wallet.pending,this.wallet.hasExternalBusy('expansion'),this.selected,this.inspected,this.rope,this.tab,this.stake,this.sending,this.localError,this.beat?.id,this.timeline.active,this.services.gameAudio.getPreferences(),this.media.matches,this.fast,this.autoRunning,this.autoRemaining,this.autoCount,this.autoNote]);
    if(signature===this.rendered)return;this.rendered=signature;
    const doc=this.host.ownerDocument,focused=doc.activeElement as HTMLElement|null;
    const focusKey=focused&&this.root.contains(focused)?focused.dataset.ft==='route'?`[data-ft="route"][data-to="${focused.dataset.to}"]`:focused.dataset.ft?`[data-ft="${focused.dataset.ft}"]`:focused.dataset.room?`[data-room="${focused.dataset.room}"]`:null:null;
    const session=this.session,v=this.sending?this.frozenView:this.view,active=session?.state==='active',bonus=this.beat?this.beat.frame.mode==='bonus':this.tab==='bonus'&&!!v?.bonusMap;
    const pending=this.client.pending?.gameId===TEMPLE_GAME,disabled=this.blocked||!this.connected;
    const legal=active&&v?.bonusMap&&v.bonusState?templeLegalActions(v.bonusMap,v.bonusState):[];
    const action=legal.find(a=>'to'in a&&a.to===this.selected);
    const canMove=!!action;
    const status=this.status(),affordable=!this.connected||this.wallet.wallet!.balance>=Number(this.stake)/100;
    const total=this.beat?.frame.totalUnits??v?.totalPayoutUnits??'0',balance=this.connected?this.wallet.wallet!.balance.toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'···';
    const label=pending?this.text('Проверить ход','Check move'):this.sending||this.client.busy?this.text('Подтверждаем…','Confirming…'):active&&!bonus?this.text('Вернуться в экспедицию','Return to expedition'):active?action?.kind==='rope'&&!this.rope?this.text('Подготовить верёвку для ','Prepare rope for ')+roomName(action.to):canMove?(action?.kind==='rope'?this.text('По верёвке в ','Rope to '):this.text('Перейти в ','Move to '))+roomName(this.selected!)+this.text(' · 1 ход',' · 1 move'):this.text('Выбери проход по номеру','Choose a numbered passage'):this.text('Исследовать','Explore')+' · '+this.money(this.stake);
    const map=bonus?v?.bonusMap:v?.baseMap;
    const examined=this.inspected??this.selected,examinedAction=legal.find(a=>'to'in a&&a.to===examined);
    const detail=map&&examined!==null?roomName(examined)+' · '+roomDescription(map,examined,this.en)+(active&&bonus&&examined===v?.bonusState?.at?this.text(' · Ты здесь',' · You are here'):active&&bonus&&!examinedAction?this.selected!==null?this.text(' · Прямого прохода отсюда нет. Выбранный ход сохранён.',' · No direct passage from your room. Your move selection is unchanged.'):this.text(' · Прямого прохода отсюда нет. Доступные проходы пронумерованы.',' · No direct passage from your room. Available passages are numbered.'):examinedAction?this.text(' · 1 ход',' · 1 move'):''):active&&bonus?this.text('Проходы отмечены стрелками и номерами. Выбери вариант ниже.','Passages have arrows and numbers. Choose an option below.'):v?this.text('Золотой след показывает пройденный путь. Нажми комнату, чтобы осмотреть.','The gold trail shows the confirmed path. Select a room to inspect it.'):this.text('Одна ставка открывает карту и собирает всё доступное от входа.','One stake opens a map and collects everything reachable from the entrance.');
    this.root.dataset.phase=active?'bonus':v?'complete':'ready';this.root.dataset.map=bonus?'bonus':'base';
    this.root.setAttribute('aria-busy',String(this.sending||this.client.busy||this.client.loading));
    this.root.dataset.routeActive=String(active&&bonus&&!this.beat&&!this.sending&&!pending);
    this.root.innerHTML=`
      <header class="ft-top"><div class="ft-brand">${art.compass}<span>ROYAL ORIGINALS</span></div><div class="ft-title"><span>${this.text('ЗА ПРЕДЕЛАМИ ИЗВЕСТНОГО','BEYOND THE KNOWN')}</span><h1>${this.text('Затопленный храм','Flooded Temple')}</h1></div><div class="ft-tools"><button type="button" data-ft="rules" aria-label="${this.text('Правила игры','Game rules')}">?</button><button type="button" data-ft="refresh" aria-label="${this.text('Обновить состояние','Refresh state')}" ${this.blocked?'disabled':''}>↻</button></div></header>
      <div class="ft-play"><div class="ft-board-area"><div class="ft-board-head"><strong class="ft-map-label">${active?this.text('Реликвия найдена','Relic discovered'):v?this.text('Карта исследована','Map explored'):this.text('Забытое святилище','The forgotten sanctuary')}</strong>${v?.bonusMap?`<div class="ft-tabs" role="group" aria-label="${this.text('Карта','Map')}"><button type="button" data-ft="base" aria-pressed="${!bonus}">${this.text('Храм','Temple')}</button><button type="button" data-ft="bonus" aria-pressed="${bonus}">${this.text('Экспедиция','Expedition')}</button></div>`:''}</div>
      ${v?.bonusState&&bonus?`<div class="ft-bonus-tools"><div class="ft-step-count"><strong>${v.bonusState.left}</strong><span>${this.text('ХОДОВ','MOVES')}</span><span class="ft-step-dots" aria-hidden="true">${Array.from({length:6},(_,i)=>`<i class="${i>=v.bonusState!.left?'spent':''}"></i>`).join('')}</span></div><button type="button" data-ft="rope" class="ft-rope" aria-pressed="${this.rope}" ${disabled||pending||!active||!v.bonusState.ropeAvailable?'disabled':''}>${prop('rope')}${v.bonusState.ropeAvailable?this.rope?this.text('Верёвка выбрана','Rope selected'):this.text('Использовать верёвку','Use rope'):this.text('Верёвка использована','Rope used')}</button></div>`:''}
      <div class="ft-cabinet">${boardMarkup(v,bonus,bonus?this.selected:this.inspected,this.rope,disabled||pending,this.en,this.beat)}</div><div class="ft-legend"><span>${art.gate}${this.text('Ворота','Gate')}</span><span>${art.lever}${this.text('Рычаг','Lever')}</span><span>${art.gap}${this.text('Провал','Gap')}</span><span>${art.check}${this.text('Собрано','Collected')}</span></div><p class="ft-room-detail">${escape(detail)}</p></div>
      <div data-ft-character-slot></div></div>
      <section class="ft-console" aria-label="${this.text('Управление экспедицией','Expedition controls')}"><div class="ft-money"><div><span class="ft-label">${this.text('Общий баланс','Shared balance')}</span><strong data-ft-value="balance">${balance}</strong><small>${escape(this.asset)}</small></div><div><span class="ft-label">${this.text('Ставка раунда','Round stake')}</span><strong>${this.money(session?.stakeUnits??this.stake)}</strong><small>${escape(this.asset)}</small></div></div><div class="ft-bet-block"><label class="ft-stake"><span class="ft-label">${this.text('Ставка','Stake')}</span><select data-ft="stake" ${disabled||active||!!this.client.pending?'disabled':''}>${TEMPLE_DATA.stakes.map(n=>`<option value="${n}" ${this.stake===String(n)?'selected':''}>${this.money(String(n))}</option>`).join('')}</select></label><div class="ft-collected-total"><span class="ft-label">${active?this.text('Собрано','Collected'):this.text('Выплата','Payout')}</span><strong data-ft-value="payout">${this.money(total)}</strong><small>${escape(this.asset)}</small></div></div><div class="ft-action"><button type="button" class="ft-primary" data-ft="primary" ${disabled||!active&&!pending&&!affordable||active&&bonus&&!canMove&&!pending?'disabled':''}>${pending?art.step:active?art.step:art.compass}<span>${label}</span></button>${active?`<button type="button" class="ft-finish" data-ft="finish" ${disabled||pending?'disabled':''}>${this.text('Закончить и забрать собранное','Finish and collect')}</button>`:''}</div><div class="ft-status" data-error="${status.error}" data-settled="${!!v&&!active}" role="status" aria-live="polite"><p>${escape(status.message)}</p></div></section><footer class="ft-bottom"><span>${this.text('5 × 4 КОМНАТЫ','5 × 4 ROOMS')}</span><span>${this.text('6 ХОДОВ · 1 ВЕРЁВКА','6 MOVES · 1 ROPE')}</span><span>${this.text('МАКСИМАЛЬНАЯ ВЫПЛАТА 230×','MAXIMUM PAYOUT 230×')}</span></footer>`;
    this.root.querySelector('[data-ft-character-slot]')!.replaceWith(this.character.element);
    this.root.querySelector('.ft-status')!.insertAdjacentHTML('beforebegin',this.playbackMarkup());
    if(bonus&&(active||this.beat))this.root.querySelector('.ft-money')!.insertAdjacentHTML('beforebegin',this.routeMarkup(v,disabled||pending));
    if(this.autoRunning){this.root.querySelector<HTMLSelectElement>('[data-ft=stake]')!.disabled=true;if(!this.beat&&!active)this.root.querySelector<HTMLButtonElement>('[data-ft=primary]')!.disabled=true;}
    this.feedbackUI();this.effects.decorate(this.beat,this.media.matches,this.timeline.offset);this.syncCharacter();
    if(focusKey&&!this.dialog.open)this.root.querySelector<HTMLElement>(focusKey)?.focus({preventScroll:true});
  }
  private status(){
    if(this.beat)return {error:false,message:this.eventText(this.beat)};
    if(!this.owner)return {error:false,message:this.text('Войди в общий аккаунт Royal, чтобы начать.','Sign in to your Royal account to begin.')};
    if(this.client.pending?.gameId===TEMPLE_GAME)return {error:true,message:this.client.busy?this.text('Ожидаем подтверждение той же операции.','Waiting for confirmation of the same operation.'):this.text('Ответ не подтверждён. «Проверить ход» повторит ту же операцию без новой ставки.','Result unconfirmed. “Check move” retries the same operation without a new stake.')};
    if(this.blocked)return {error:false,message:this.text('Синхронизация общего кошелька…','Synchronizing the shared wallet…')};
    if(this.localError||this.client.error)return {error:true,message:this.localError||this.client.error};
    if(this.connected&&this.session?.state!=='active'&&this.wallet.wallet!.balance<Number(this.stake)/100)return {error:true,message:this.text('Недостаточно средств для выбранной ставки. Выбери меньшую ставку или пополни общий кошелёк.','Insufficient balance for this stake. Choose a smaller stake or add funds to the shared wallet.')};
    const v=this.view,s=this.session;
    if(v&&s?.state==='settled'){
      const net=BigInt(v.totalPayoutUnits)-BigInt(s.spentUnits);
      const kind=templeOutcome(s.stakeUnits,v.totalPayoutUnits),label=kind==='partial'?this.text('Частичный возврат · ','Partial return · '):kind==='return'?this.text('Ставка возвращена · ','Stake returned · '):'';
      return {error:false,message:label+this.text('Начислено ','Credited ')+this.money(v.totalPayoutUnits)+' '+this.asset+this.text(' · Чистый итог ',' · Net result ')+(net>0n?'+':'')+this.money(net.toString())};
    }
    if(v)return {error:false,message:this.text('Храм: ','Temple: ')+this.money(v.baseResult.payoutUnits)+this.text(' · Экспедиция: ',' · Expedition: ')+this.money(v.bonusState?.payoutUnits??'0')+this.text(' · Продолжение без новой ставки.',' · Continue without a new stake.')};
    return {error:false,message:this.text('Исследование стоит ','Exploration costs ')+this.money(this.stake)+' '+this.asset+this.text('. Реликвия открывает бесплатную экспедицию.','. The relic unlocks a free expedition.')};
  }
  private onClick(event:Event){
    const target=(event.target as Element).closest<HTMLElement>('[data-ft],[data-room]');if(!target||target.matches(':disabled'))return;
    if(target.dataset.room!==undefined){this.inspectRoom(Number(target.dataset.room));return;}
    switch(target.dataset.ft){
      case 'rules':this.showRules();break;
      case 'sound':void this.audio.gesture();this.services.gameAudio.setMuted(!this.services.gameAudio.getPreferences().muted);break;
      case 'log':this.showLog();break;
      case 'close':this.dialog.close();break;
      case 'refresh':this.stopAuto('stopped');this.localError='';void this.client.refresh();break;
      case 'fast':this.fast=!this.fast;this.savePlayback();if(this.fast)this.timeline.complete();this.render();break;
      case 'auto':if(this.autoRunning)this.stopAuto('stopped');else this.startAuto();break;
      case 'base':this.tab='base';this.inspected=null;this.render();break;
      case 'bonus':this.tab='bonus';this.inspected=null;this.render();break;
      case 'route':this.inspectRoom(Number(target.dataset.to));break;
      case 'rope':if(!this.blocked&&!this.client.pending&&this.session?.state==='active'&&this.view?.bonusState?.ropeAvailable){this.rope=!this.rope;this.render();}break;
      case 'primary':void this.primary();break;
      case 'finish':this.showFinish();break;
      case 'confirm-finish':this.timeline.resume('dialog');this.dialog.close();void this.move('temple-finish');break;
    }
  }
  private inspectRoom(room:number){
    if(!Number.isInteger(room)||room<0||room>19)return;
    this.inspected=room;
    if(this.tab==='bonus'&&this.session?.state==='active'&&templeRouteChoices(this.view).some(a=>a.to===room)){
      if(this.selected!==room)this.rope=false;
      this.selected=room;
    }
    this.render();
  }
  private routeMarkup(view:TempleView|undefined,disabled:boolean){
    const state=view?.bonusState;if(!view?.bonusMap||!state)return '';
    const choices=templeRouteChoices(view),from=roomName(state.at);
    const caption=this.beat?this.text('Показываем подтверждённый путь…','Showing the confirmed path…'):choices.length===1?this.text('Ты в ','You are in ')+from+this.text('. Единственный проход в ','. The only passage leads to ')+roomName(choices[0].to)+this.text(' уже выбран.',' and is already selected.'):this.text('Ты в ','You are in ')+from+this.text('. Доступно проходов: ','. Available passages: ')+choices.length+this.text('. Выбери номер на карте или ниже.','. Choose a number on the map or below.');
    const options=this.beat?'':choices.map((choice,i)=>{
      const description=state.visited.includes(choice.to)?this.text('Возврат, без новой награды','Revisit, no new reward'):roomDescription(view.bonusMap!,choice.to,this.en);
      return `<button type="button" class="ft-route-option" data-ft="route" data-to="${choice.to}" data-kind="${choice.kind}" aria-pressed="${this.selected===choice.to}" ${disabled?'disabled':''}><b aria-hidden="true">${i+1}</b><span>${templeDirection(state.at,choice.to)} ${roomName(choice.to)}<small>${escape(description)} · ${choice.kind==='rope'?this.text('верёвка · ','rope · '):''}${this.text('1 ход','1 move')}</small></span></button>`;
    }).join('');
    return `<div class="ft-route-panel"><p class="ft-route-caption">${caption}</p><div class="ft-route-options" role="group" aria-label="${this.text('Доступные проходы из ','Available passages from ')+from}">${options}</div></div>`;
  }
  private async primary(){
    if(this.timeline.active){this.timeline.complete();return;}
    if(this.blocked||!this.connected)return;
    if(this.client.pending?.gameId===TEMPLE_GAME){await this.send(()=>this.client.retry(),true);return;}
    if(this.session?.state==='active'){
      if(this.tab!=='bonus'){this.tab='bonus';this.render();return;}
      const v=this.view!,action=templeLegalActions(v.bonusMap!,v.bonusState!).find(a=>'to'in a&&a.to===this.selected);
      if(!action)return;
      if(action.kind==='rope'&&!this.rope){this.rope=true;this.render();return;}
      await this.move(action.kind==='rope'?'temple-rope':'temple-step',this.selected!);return;
    }
    if(this.autoRunning)return;
    this.autoNote='';await this.startRound();
  }
  private startRound(){return this.send(()=>this.client.act({action:'start',gameId:TEMPLE_GAME,stakeUnits:this.stake,settings:{temple:{mode:'normal'}}}));}
  private savePlayback(){try{const storage=this.host.ownerDocument.defaultView!.localStorage;storage.setItem('royal:temple:fast',this.fast?'1':'0');storage.setItem('royal:temple:auto-count',String(this.autoCount));}catch{/* The controls also work without local storage. */}}
  private playbackMarkup(){
    const locked=this.blocked||!this.connected||!!this.client.pending||!!this.client.error||!!this.localError||this.session?.state==='active';
    const note=this.autoRunning?(this.session?.state==='active'&&!this.timeline.active?this.text('Выбери маршрут · осталось ','Choose your route · remaining '):this.text('Осталось спинов: ','Spins remaining: '))+this.autoRemaining:this.autoNote==='complete'?this.text('Автосерия завершена','Autoplay complete'):this.autoNote==='stopped'?this.text('Автосерия остановлена','Autoplay stopped'):this.autoNote==='funds'?this.text('Авто остановлено: недостаточно средств','Autoplay stopped: insufficient balance'):this.autoNote==='error'?this.text('Авто остановлено: проверь ход','Autoplay stopped: check the move'):this.autoNote==='paused'?this.text('Авто остановлено при паузе','Autoplay stopped on pause'):this.autoNote==='account'?this.text('Авто остановлено при смене аккаунта','Autoplay stopped on account change'):this.text('Авто ждёт твой маршрут в экспедиции','Autoplay waits for your expedition route');
    return `<div class="ft-playback" aria-label="${this.text('Скорость и автоспины','Speed and autoplay')}"><button type="button" data-ft="fast" aria-pressed="${this.fast}">${this.text('⚡ Быстро','⚡ Quick')}</button><label class="ft-auto-count"><span>${this.text('Спинов','Spins')}</span><select data-ft="auto-count" aria-label="${this.text('Количество автоспинов','Autoplay spin count')}" ${this.autoRunning||this.blocked||!!this.client.pending?'disabled':''}>${AUTO_COUNTS.map(n=>`<option value="${n}" ${this.autoCount===n?'selected':''}>${n}</option>`).join('')}</select></label><button type="button" data-ft="auto" aria-pressed="${this.autoRunning}" ${!this.autoRunning&&locked?'disabled':''}>${this.autoRunning?this.text('Стоп · ','Stop · ')+this.autoRemaining:this.text('Авто','Auto')}</button><small class="ft-auto-note" data-ft="auto-note">${note}</small></div>`;
  }
  private clearAutoTimer(){this.host.ownerDocument.defaultView!.clearTimeout(this.autoTimer);this.autoTimer=0;}
  private stopAuto(note:AutoNote,notify=true){
    const wasRunning=this.autoRunning;this.clearAutoTimer();this.autoEpoch++;this.autoRunning=false;this.autoRemaining=0;this.autoInFlight=false;
    if(wasRunning){this.autoNote=note;if(notify&&!this.disposed)this.render();}
  }
  private startAuto(){
    if(this.disposed||this.blocked||!this.connected||this.client.pending||this.client.error||this.localError||this.session?.state==='active'||this.autoRunning)return;
    this.autoRunning=true;this.autoRemaining=this.autoCount;this.autoNote='';this.autoEpoch++;void this.audio.gesture();this.render();this.pumpAuto();
  }
  private pumpAuto(){
    if(!this.autoRunning||this.disposed)return;
    if(!this.connected){this.stopAuto('account');return;}
    if(this.host.ownerDocument.hidden||document.hidden){this.stopAuto('paused');return;}
    if(this.autoInFlight||this.sending)return;
    if(this.client.pending||this.client.error||this.localError||this.wallet.pending){this.stopAuto('error');return;}
    if(this.timeline.active||this.timeline.paused||this.dialog.open||this.client.busy||this.client.loading||this.wallet.busy||this.wallet.hasExternalBusy('expansion'))return;
    if(this.session?.state==='active')return;
    if(this.autoRemaining<=0){this.stopAuto('complete');return;}
    if(this.wallet.wallet!.balance<Number(this.stake)/100){this.stopAuto('funds');return;}
    if(this.autoTimer)return;
    const epoch=this.autoEpoch;
    this.autoTimer=this.host.ownerDocument.defaultView!.setTimeout(()=>{this.autoTimer=0;void this.nextAuto(epoch);},this.fast?220:600);
  }
  private async nextAuto(epoch:number){
    if(epoch!==this.autoEpoch||!this.autoRunning||this.disposed)return;
    if(this.blocked||this.dialog.open||!this.connected||this.client.pending||this.client.error||this.localError||this.session?.state==='active'||this.host.ownerDocument.hidden||document.hidden){this.pumpAuto();return;}
    if(this.wallet.wallet!.balance<Number(this.stake)/100){this.stopAuto('funds');return;}
    this.autoInFlight=true;
    const before=this.session?.id,accepted=await this.startRound();
    if(epoch!==this.autoEpoch||!this.autoRunning||this.disposed)return;
    this.autoInFlight=false;
    if(!accepted||this.session?.id===before){this.stopAuto('error');return;}
    this.autoRemaining--;this.render();this.pumpAuto();
  }
  private async move(move:'temple-step'|'temple-rope'|'temple-finish',to?:number){
    const session=this.session;if(this.blocked||this.client.pending||session?.state!=='active'||!session.view.temple)return;
    await this.send(()=>this.client.act({action:'move',gameId:TEMPLE_GAME,sessionId:session.id,revision:session.view.temple!.revision,move,...(to===undefined?{}:{picks:[to]})}));
  }
  private async send(operation:()=>Promise<unknown>,recovery=false){
    const epoch=++this.operationEpoch,owner=this.owner,before=this.view?structuredClone(this.view):undefined,beforeId=this.session?.id,beforeMarker=this.marker;
    this.frozenView=before;this.sending=true;this.localError='';this.render();
    this.audio.cancelEffects();this.audio.ambience();
    void this.audio.gesture().then(()=>{if(this.sending&&!this.disposed&&epoch===this.operationEpoch&&owner===this.owner)this.audio.oneShot('scrape');});
    let accepted=false;
    try{await operation();accepted=!this.client.pending&&!this.client.error;}catch(error){if(!this.disposed&&epoch===this.operationEpoch)this.localError=error instanceof Error?error.message:this.text('Не удалось подтвердить ход.','The move could not be confirmed.');}
    finally{
      if(epoch===this.operationEpoch){this.sending=false;this.frozenView=undefined;
        if(!this.disposed){const v=this.view,s=this.session;if(accepted&&!recovery&&owner===this.owner&&s&&v&&this.marker!==beforeMarker&&!this.host.ownerDocument.hidden&&!document.hidden){this.feedbackMarker=this.marker;this.timeline.start(templePlan(this.owner+':'+this.marker,v,s.id===beforeId?before:undefined,this.media.matches,this.fast));}this.sync();}
      }
    }
    return accepted&&!this.disposed&&epoch===this.operationEpoch&&owner===this.owner&&this.marker!==beforeMarker;
  }
  private show(title:string,body:string){
    this.clearAutoTimer();this.timeline.pause('dialog');this.root.dataset.paused='true';
    this.syncCharacter();
    this.returnFocus=this.host.ownerDocument.activeElement as HTMLElement;
    this.dialog.innerHTML=`<button type="button" class="ft-dialog-close" data-ft="close" aria-label="${this.text('Закрыть','Close')}">×</button><h2 id="ft-dialog-title">${title}</h2>${body}`;
    this.dialog.showModal();
  }
  private showFinish(){
    if(this.blocked||this.client.pending||this.session?.state!=='active')return;
    this.show(this.text('Закончить экспедицию?','Finish the expedition?'),`<p>${this.text('В общий кошелёк поступит всё собранное:','Everything collected will be credited to the shared wallet:')} <strong>${this.money(this.view!.totalPayoutUnits)} ${escape(this.asset)}</strong>.</p><p>${this.text('Оставшиеся ходы этой экспедиции завершатся. Закрытие окна сохраняет их для продолжения.','The remaining moves in this expedition will end. Closing the game window saves them for later.')}</p><button type="button" class="ft-primary" data-ft="confirm-finish">${this.text('Забрать и закончить','Collect and finish')}</button>`);
  }
  private showRules(){
    this.show(this.text('Правила игры','Game rules'),this.en?`
      <h3>Explore the temple</h3><p>One stake opens a 5 × 4 map. The explorer follows open passages automatically, collects reachable chests once and activates reachable levers. Walls stop the route. Levers open their linked gates. The relic starts one free expedition after the temple is explored.</p>
      <h3>Choose your expedition route</h3><p>The new map shows all treasures. You have 6 moves and one rope. Numbered arrows show the open passages from your room. A single passage is already selected. At a fork, choose its number on the map or in the passage list, then confirm the move. Each passage costs one move. For a gap, select “Use rope” or “Prepare rope”, then confirm the crossing. The bridge remains usable in both directions, with one move per crossing. Levers activate on entry.</p><p>Revisiting a room still uses a move and pays nothing again. The sixth move collects its treasure before the expedition ends. “Finish and collect” ends early and keeps everything already collected. Closing or reopening preserves the same round and requires no new stake.</p>
      <h3>Stake, payout and return</h3><p>All multipliers apply to the original stake. The shared wallet is debited once and credited once when the whole round ends. “Collected” includes the base map and expedition; it is not yet a wallet credit. Net result equals payout minus stake.</p><table><tbody><tr><td>Return with optimal route choices</td><td>96%</td></tr><tr><td>Return across allowed strategies</td><td>90% to 96%</td></tr><tr><td>Highest possible whole-round payout</td><td>230×</td></tr><tr><td>Bonus retriggers / extra paid moves</td><td>None</td></tr></tbody></table><p>RTP is an exact long-run expectation under rules 1, not a promise for an individual session. Choices in the expedition change the expected return. The stake remains locked until the round and any uncertain request are resolved.</p>`:`
      <h3>Исследуй храм</h3><p>Одна ставка открывает карту 5 × 4. Исследовательница автоматически проходит по открытым коридорам, один раз собирает доступные сундуки и включает доступные рычаги. Стены останавливают путь. Каждый рычаг открывает связанные ворота. Найденная реликвия запускает одну бесплатную экспедицию после исследования храма.</p>
      <h3>Выбирай маршрут экспедиции</h3><p>На новой карте видны все сокровища. У тебя 6 ходов и одна верёвка. Стрелки и номера показывают доступные проходы из твоей комнаты. Единственный проход уже выбран. На развилке выбери номер на карте или в списке проходов, затем подтверди переход. Каждый переход стоит один ход. Для провала выбери «Использовать верёвку» или «Подготовить верёвку», затем подтверди пересечение. Мост остаётся доступным в обе стороны, каждый переход по нему стоит один ход. Рычаг включается при входе в комнату.</p><p>Возвращение в комнату расходует ход и не оплачивает сундук повторно. Шестой ход сначала собирает награду, затем завершает экспедицию. «Закончить и забрать собранное» сохраняет все полученные награды. Закрытие и повторное открытие сохраняют тот же раунд без новой ставки.</p>
      <h3>Ставка, выплата и возврат</h3><p>Все множители применяются к исходной ставке. Общий кошелёк списывает её один раз и начисляет выплату один раз после окончания всего раунда. «Собрано» включает храм и экспедицию, но ещё не означает начисление в кошелёк. Чистый итог равен выплате за вычетом ставки.</p><table><tbody><tr><td>Возврат при оптимальном маршруте</td><td>96%</td></tr><tr><td>Возврат при допустимых стратегиях</td><td>90-96%</td></tr><tr><td>Наибольшая выплата за весь раунд</td><td>230×</td></tr><tr><td>Повтор бонуса / платные дополнительные ходы</td><td>Нет</td></tr></tbody></table><p>RTP рассчитан точно для правил 1 на длинной дистанции и не обещает результат отдельной сессии. Выбор маршрута влияет на ожидаемый возврат. Ставка заблокирована до завершения раунда и подтверждения неопределённой операции.</p>`);
    this.dialog.insertAdjacentHTML('beforeend',`<h3>${this.text('Музыка и звук','Music and sound')}</h3><p><a href="${templeMusic.source}" target="_blank" rel="noopener noreferrer">${templeMusic.title}</a> by Scott Buckley - released under <a href="${templeMusic.license}" target="_blank" rel="noopener noreferrer">CC-BY 4.0</a>. <a href="${templeMusic.website}" target="_blank" rel="noopener noreferrer">www.scottbuckley.com.au</a></p><p>${this.text('Звуковые эффекты:','Sound effects:')} Kenney, Joseph SARDIN, DenisChardonnet, JaggedStone, bonebrah (CC0). ${this.text('Монтаж и сведение для игры.','Edited and mixed for this game.')}</p>`);
    this.dialog.insertAdjacentHTML('beforeend',`<h3>${this.text('Быстрая игра и автоспины','Quick play and autoplay')}</h3><p>${this.text('«Быстро» сокращает анимации и сразу показывает подтверждённую карту. Авто запускает выбранные 10, 25, 50 или 100 платных раундов по текущей ставке, по одному после завершения предыдущего. Ставка на время серии заблокирована. Бесплатная экспедиция не уменьшает счётчик: выбери маршрут сам, после её завершения серия продолжится. «Стоп» отменяет следующие запуски, принятый ход сохраняется. Неизвестный ответ, нехватка средств, скрытая вкладка, пауза, смена аккаунта и закрытие останавливают серию. После возвращения авто само не включается.','Quick shortens the animation and immediately shows the confirmed map. Auto starts the chosen 10, 25, 50 or 100 paid rounds at the current stake, one after the previous round ends. The stake stays locked during the series. The free expedition does not use the counter: choose its route yourself, then the series continues. Stop cancels future starts and preserves the accepted move. An unknown reply, insufficient funds, hidden tab, pause, account change or closing stops the series. Returning never restarts autoplay automatically.')}</p>`);
  }
  private visibility=()=>{if(this.host.ownerDocument.hidden||document.hidden){this.stopAuto('paused',false);this.timeline.pause('visibility');}else this.timeline.resume('visibility');this.rendered='';this.render();};
  private motionChanged=()=>{this.timeline.complete();this.rendered='';this.render();};
  pause(){this.stopAuto('paused',false);this.timeline.pause('host');this.rendered='';this.render();}
  resume(){this.timeline.resume('host');this.rendered='';this.render();}
  private eventText(beat:TempleBeat){
    const room=beat.room===undefined?'':roomName(beat.room);
    switch(beat.kind){
      case 'card':return this.text('Карта храма подтверждена. Открываем комнаты.','Temple map confirmed. Revealing the rooms.');
      case 'travel':return this.text('Следуем по проходу в ','Following the passage to ')+room+'.';
      case 'arrive':return this.text('Комната ','Room ')+room+'.';
      case 'collect':return this.text('Сундук собран: +','Treasure collected: +')+this.money(beat.awardUnits!)+this.text(' к итогу раунда.',' towards the round total.');
      case 'lever':return this.text('Включаем рычаг в ','Activating the lever in ')+room+'.';
      case 'gate':return this.text('Открыты ворота ','Gate opened: ')+beat.edge!.split(':').map(Number).map(roomName).join(' ↔ ')+'.';
      case 'rope':return this.text('Верёвка закреплена. Мост останется доступным в обе стороны.','Rope attached. The bridge stays open in both directions.');
      case 'relic':return this.text('Реликвия найдена. После исследования откроется бесплатная экспедиция.','Relic discovered. A free expedition follows this exploration.');
      case 'expedition':return this.text('Новая карта. Шесть ходов и одна верёвка, без новой ставки.','New map. Six moves and one rope, without a new stake.');
      case 'outcome':case 'summary':{
        if(this.session?.state!=='settled')return this.text('Путь сохранён. Собрано за раунд: ','Path saved. Round collection: ')+this.money(beat.frame.totalUnits);
        const net=BigInt(this.view!.totalPayoutUnits)-BigInt(this.session.stakeUnits);
        const label=beat.outcome==='partial'?this.text('Частичный возврат','Partial return'):beat.outcome==='return'?this.text('Ставка возвращена','Stake returned'):beat.outcome==='big'?this.text('Крупный положительный итог','Large positive result'):beat.outcome==='win'?this.text('Положительный итог','Positive result'):this.text('Исследование завершено','Exploration complete');
        return label+this.text(' · Выплата ',' · Payout ')+this.money(beat.frame.totalUnits)+this.text(' · Чистый итог ',' · Net result ')+(net>0n?'+':'')+this.money(net.toString());
      }
    }
  }
  private feedbackUI(){
    const beat=this.beat,state=this.timeline.getState(),prefs=this.services.gameAudio.getPreferences(),waiting=this.sending||this.client.pending?.gameId===TEMPLE_GAME;
    this.root.dataset.event=beat?.kind??'idle';this.root.dataset.motion=this.media.matches?'reduced':'full';this.root.dataset.paused=String(state.paused);this.root.dataset.waiting=String(waiting);this.root.dataset.outcome=beat?.outcome??(this.session?.state==='settled'?templeOutcome(this.session.stakeUnits,this.view!.totalPayoutUnits):'');
    this.root.querySelector('.ft-status')!.setAttribute('aria-live',beat&&['card','travel','arrive'].includes(beat.kind)?'off':'polite');
    const tools=this.root.querySelector('.ft-tools')!,sound=this.host.ownerDocument.createElement('button');sound.type='button';sound.dataset.ft='sound';sound.className='ft-sound';sound.setAttribute('aria-pressed',String(!prefs.muted&&prefs.volume>0));sound.setAttribute('aria-label',prefs.muted?this.text('Включить звук','Enable sound'):this.text('Выключить звук','Mute sound'));sound.textContent=prefs.muted||prefs.volume===0?'♪̸':'♪';tools.prepend(sound);
    const log=this.host.ownerDocument.createElement('button');log.type='button';log.className='ft-log';log.dataset.ft='log';log.textContent=this.text('Журнал','Journal');log.disabled=!this.view;this.root.querySelector('.ft-legend')!.append(log);
    if(waiting){const mask=this.host.ownerDocument.createElement('div');mask.className='ft-waiting';mask.textContent=this.client.busy||this.sending?this.text('Ожидаем подтверждённую карту…','Waiting for the confirmed map…'):this.text('Проверь сохранённый ход','Check the saved move');this.root.querySelector('.ft-map')?.append(mask);}
    if(beat){
      const primary=this.root.querySelector<HTMLButtonElement>('[data-ft=primary]')!;primary.disabled=false;primary.querySelector('span')!.textContent=this.text('Показать итог','Show result');
      this.root.querySelectorAll<HTMLButtonElement>('[data-ft=base],[data-ft=bonus]').forEach(button=>button.disabled=true);
      const output=this.root.querySelector('[data-ft-value=payout]');if(output)output.textContent=this.money(beat.frame.totalUnits);
      const count=this.root.querySelector('.ft-step-count strong');if(count&&beat.frame.left!==null)count.textContent=String(beat.frame.left);
      this.root.querySelectorAll('.ft-step-dots i').forEach((dot,i)=>dot.classList.toggle('spent',i>=(beat.frame.left??0)));
      this.root.querySelector('.ft-map-label')!.textContent=this.text('Подтверждённый путь','Confirmed path');
    }
  }
  private showLog(){
    const v=this.view;if(!v)return;
    const items=v.baseResult.events.map(e=>`<li><strong>${roomName(e.room)}</strong> · ${escape(roomDescription(v.baseMap,e.room,this.en))}${BigInt(e.awardUnits)>0n?' · +'+this.money(e.awardUnits):''}</li>`);
    const visited=new Set([5]);for(const [i,action]of v.history.entries()){
      if(action.kind==='finish'){items.push(`<li>${this.text('Экспедиция завершена досрочно.','Expedition finished early.')}</li>`);continue;}
      const repeat=visited.has(action.to);visited.add(action.to);
      items.push(`<li>${i+1}. <strong>${roomName(action.to)}</strong> · ${action.kind==='rope'?this.text('Верёвка · ','Rope · '):''}${repeat?this.text('Повторное посещение, без повторной награды','Revisit, no repeat reward'):escape(roomDescription(v.bonusMap!,action.to,this.en))}</li>`);
    }
    this.show(this.text('Журнал экспедиции','Expedition journal'),`<p>${this.text('Подтверждённая сумма за весь раунд: ','Confirmed whole-round total: ')}<strong>${this.money(v.totalPayoutUnits)}</strong></p><ul class="ft-log-list">${items.join('')}</ul>`);
  }
  private syncCharacter(){this.character.update({beat:this.beat,key:this.owner+':'+this.marker,offset:this.timeline.offset,waiting:this.sending||this.client.pending?.gameId===TEMPLE_GAME,rope:this.rope,selected:this.selected!==null,reduced:this.media.matches,paused:this.timeline.paused,connected:this.connected});}
  getState(){const s=this.session,v=this.view;return {gameId:TEMPLE_GAME,stage:'feedback',playable:true,phase:v?.phase??'ready',sessionId:s?.id??null,revision:v?.revision??null,tab:this.tab,selected:this.selected,inspected:this.inspected,choices:templeRouteChoices(v),ropeSelected:this.rope,moves:v?.bonusState?.left??null,totalPayoutUnits:v?.totalPayoutUnits??'0',busy:this.blocked,pending:this.client.pending?.gameId===TEMPLE_GAME,disposed:this.disposed,fast:this.fast,autoplay:{running:this.autoRunning,remaining:this.autoRemaining,count:this.autoCount,waitingForRoute:this.autoRunning&&s?.state==='active'&&!this.timeline.active,timerPending:!!this.autoTimer,note:this.autoNote},feedback:{...this.timeline.getState(),shownUnits:this.beat?.frame.totalUnits??v?.totalPayoutUnits??'0',effects:this.effects.getState(),character:this.character.getState(),reducedMotion:this.media.matches}};}
  destroy(){if(this.disposed)return;this.disposed=true;this.stopAuto('stopped',false);this.timeline.destroy();this.effects.clear();this.character.destroy();this.unsubscribePreferences();this.media.removeEventListener('change',this.motionChanged);this.host.ownerDocument.removeEventListener('visibilitychange',this.visibility);if(this.host.ownerDocument!==document)document.removeEventListener('visibilitychange',this.visibility);this.services.expansionClient.removeEventListener('change',this.changed);this.services.demoWallet.removeEventListener('change',this.changed);this.root.removeEventListener('click',this.click);this.root.removeEventListener('keydown',this.key);this.root.removeEventListener('change',this.changedStake);this.dialog.removeEventListener('click',this.click);this.dialog.close();this.host.replaceChildren();}
}
