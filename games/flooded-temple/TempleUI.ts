import type {GameHostV1} from '../../src/modules/GameHostContract';
import type {ExpansionSession} from '../../src/shared/casinoExpansion';
import {TEMPLE_GAME,type TempleView} from '../../src/shared/floodedTemple';
import {TEMPLE_DATA,templeLegalActions} from '../../src/shared/floodedTempleMath';
import {art,escape,roomName} from './art';
import {boardMarkup,roomDescription} from './board';

/** Presentation reads confirmed views and uses the host's serialized operation client. */
export class TempleUI {
  private readonly root:HTMLElement;
  private readonly dialog:HTMLDialogElement;
  private readonly en:boolean;
  private owner:string|null=null;
  private marker='';
  private selected:number|null=null;
  private rope=false;
  private tab:'base'|'bonus'='base';
  private stake='1000';
  private sending=false;
  private disposed=false;
  private localError='';
  private rendered='';
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
    this.root.setAttribute('aria-label',this.text('Затопленный храм','Flooded Temple'));
    this.dialog=doc.createElement('dialog');this.dialog.className='ft-dialog';this.dialog.setAttribute('aria-labelledby','ft-dialog-title');
    host.replaceChildren(this.root,this.dialog);
    this.root.addEventListener('click',this.click);this.root.addEventListener('keydown',this.key);
    this.root.addEventListener('change',this.changedStake);
    this.dialog.addEventListener('click',this.click);
    this.dialog.addEventListener('close',()=>this.returnFocus?.isConnected&&this.returnFocus.focus());
    services.expansionClient.addEventListener('change',this.changed);services.demoWallet.addEventListener('change',this.changed);
    this.sync();void services.expansionClient.refresh();
  }
  private text(ru:string,en:string){return this.en?en:ru;}
  private get client(){return this.services.expansionClient;}
  private get wallet(){return this.services.demoWallet;}
  private get session():ExpansionSession|undefined{
    if(!this.owner||this.client.accountId!==this.owner||this.wallet.accountId!==this.owner)return;
    return this.client.sessions.find(s=>s.gameId===TEMPLE_GAME);
  }
  private get view():TempleView|undefined{return this.session?.view.temple;}
  private get blocked(){return this.sending||this.client.busy||this.client.loading||this.wallet.busy||!!this.wallet.pending||this.wallet.hasExternalBusy('expansion')||!!this.client.pending&&this.client.pending.gameId!==TEMPLE_GAME;}
  private get connected(){return !!this.owner&&this.wallet.accountId===this.owner&&!!this.wallet.wallet;}
  private money(units:string){return (Number(units)/100).toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});}
  private get asset(){return this.wallet.wallet?.asset==='USDT_NILE_TEST'?'USDT':this.text('демомонеты','demo coins');}
  private sync(){
    if(this.disposed)return;
    if(this.owner!==this.client.accountId){this.owner=this.client.accountId;this.marker='';this.selected=null;this.rope=false;this.tab='base';this.localError='';this.dialog.close();}
    const session=this.session,marker=session?session.id+':'+session.view.temple?.revision:'';
    if(marker!==this.marker){this.marker=marker;this.selected=null;this.rope=false;
      const v=session?.view.temple;if(v){this.stake=session!.stakeUnits;this.tab=v.bonusMap?'bonus':'base';}
    }
    const pending=this.client.pending;if(pending?.gameId===TEMPLE_GAME&&pending.action==='start')this.stake=pending.stakeUnits;
    this.render();
  }
  private changedStake=(event:Event)=>{
    const select=event.target as HTMLSelectElement;
    if(select.matches('[data-ft=stake]')&&!this.blocked&&!this.client.pending&&this.session?.state!=='active'&&TEMPLE_DATA.stakes.some(n=>String(n)===select.value)){this.stake=select.value;this.render();}
  };
  private render(){
    if(this.disposed)return;
    const signature=JSON.stringify([this.owner,this.session,this.client.pending,this.client.busy,this.client.loading,this.client.error,this.wallet.accountId,this.wallet.wallet?.balance,this.wallet.wallet?.asset,this.wallet.busy,this.wallet.pending,this.wallet.hasExternalBusy('expansion'),this.selected,this.rope,this.tab,this.stake,this.sending,this.localError]);
    if(signature===this.rendered)return;this.rendered=signature;
    const doc=this.host.ownerDocument,focused=doc.activeElement as HTMLElement|null;
    const focusKey=focused&&this.root.contains(focused)?focused.dataset.ft?`[data-ft="${focused.dataset.ft}"]`:focused.dataset.room?`[data-room="${focused.dataset.room}"]`:null:null;
    const session=this.session,v=this.view,active=session?.state==='active',bonus=this.tab==='bonus'&&!!v?.bonusMap;
    const pending=this.client.pending?.gameId===TEMPLE_GAME,disabled=this.blocked||!this.connected;
    const legal=active&&v?.bonusMap&&v.bonusState?templeLegalActions(v.bonusMap,v.bonusState):[];
    const action=legal.find(a=>'to'in a&&a.to===this.selected);
    const canMove=!!action&&(action.kind!=='rope'||this.rope);
    const status=this.status(),affordable=!this.connected||this.wallet.wallet!.balance>=Number(this.stake)/100;
    const total=v?.totalPayoutUnits??'0',balance=this.connected?this.wallet.wallet!.balance.toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'···';
    const label=pending?this.text('Проверить ход','Check move'):this.sending||this.client.busy?this.text('Подтверждаем…','Confirming…'):active&&!bonus?this.text('Вернуться в экспедицию','Return to expedition'):active?canMove?this.text('Перейти в ','Move to ')+roomName(this.selected!):action?.kind==='rope'?this.text('Сначала выбери верёвку','Select the rope first'):this.text('Выбери соседнюю комнату','Choose an adjacent room'):this.text('Исследовать','Explore')+' · '+this.money(this.stake);
    const map=bonus?v?.bonusMap:v?.baseMap;
    const detail=map&&this.selected!==null?roomName(this.selected)+' · '+roomDescription(map,this.selected,this.en)+(active&&bonus&&this.selected===v?.bonusState?.at?this.text(' · Ты здесь',' · You are here'):active&&bonus&&!action?this.text(' · Переход отсюда недоступен',' · No passage from your room'):action?this.text(' · 1 ход',' · 1 move'):''):active&&bonus?this.text('Выбери соседнюю подсвеченную комнату. Провал требует верёвку.','Choose a highlighted adjacent room. A gap needs your rope.'):v?this.text('Золотой след показывает пройденный путь. Нажми комнату, чтобы осмотреть.','The gold trail shows the confirmed path. Select a room to inspect it.'):this.text('Одна ставка открывает карту и собирает всё доступное от входа.','One stake opens a map and collects everything reachable from the entrance.');
    this.root.dataset.phase=active?'bonus':v?'complete':'ready';this.root.dataset.map=bonus?'bonus':'base';
    this.root.setAttribute('aria-busy',String(this.sending||this.client.busy));
    this.root.innerHTML=`
      <header class="ft-top"><div class="ft-brand">${art.compass}<span>ROYAL ORIGINALS</span></div><div class="ft-title"><span>${this.text('ЗА ПРЕДЕЛАМИ ИЗВЕСТНОГО','BEYOND THE KNOWN')}</span><h1>${this.text('Затопленный храм','Flooded Temple')}</h1></div><div class="ft-tools"><button type="button" data-ft="rules" aria-label="${this.text('Правила игры','Game rules')}">?</button><button type="button" data-ft="refresh" aria-label="${this.text('Обновить состояние','Refresh state')}" ${this.blocked?'disabled':''}>↻</button></div></header>
      <div class="ft-play"><div class="ft-board-area"><div class="ft-board-head"><strong class="ft-map-label">${active?this.text('Реликвия найдена','Relic discovered'):v?this.text('Карта исследована','Map explored'):this.text('Забытое святилище','The forgotten sanctuary')}</strong>${v?.bonusMap?`<div class="ft-tabs" role="group" aria-label="${this.text('Карта','Map')}"><button type="button" data-ft="base" aria-pressed="${!bonus}">${this.text('Храм','Temple')}</button><button type="button" data-ft="bonus" aria-pressed="${bonus}">${this.text('Экспедиция','Expedition')}</button></div>`:''}</div>
      ${v?.bonusState&&bonus?`<div class="ft-bonus-tools"><div class="ft-step-count"><strong>${v.bonusState.left}</strong><span>${this.text('ХОДОВ','MOVES')}</span><span class="ft-step-dots" aria-hidden="true">${Array.from({length:6},(_,i)=>`<i class="${i>=v.bonusState!.left?'spent':''}"></i>`).join('')}</span></div><button type="button" data-ft="rope" class="ft-rope" aria-pressed="${this.rope}" ${disabled||pending||!active||!v.bonusState.ropeAvailable?'disabled':''}>${art.rope}${v.bonusState.ropeAvailable?this.rope?this.text('Верёвка выбрана','Rope selected'):this.text('Использовать верёвку','Use rope'):this.text('Верёвка использована','Rope used')}</button></div>`:''}
      <div class="ft-cabinet">${boardMarkup(v,bonus,this.selected,this.rope,disabled||pending,this.en)}</div><div class="ft-legend"><span>${art.gate}${this.text('Ворота','Gate')}</span><span>${art.lever}${this.text('Рычаг','Lever')}</span><span>${art.gap}${this.text('Провал','Gap')}</span><span>${art.check}${this.text('Собрано','Collected')}</span></div><p class="ft-room-detail">${escape(detail)}</p></div>
      <aside class="ft-character" aria-label="${this.text('Исследовательница храма','Temple explorer')}"><img src="/assets/flooded-temple/explorer.webp" alt="${this.text('Исследовательница с фонарём, лицом к игроку','Explorer with a lantern, facing the player')}" draggable="false"><div class="ft-character-caption">${this.text('У каждого сокровища есть путь','Every treasure has a path')}<small>${this.text('НАЙДИ СВОЙ','FIND YOURS')}</small></div></aside></div>
      <section class="ft-console" aria-label="${this.text('Управление экспедицией','Expedition controls')}"><div class="ft-money"><div><span class="ft-label">${this.text('Общий баланс','Shared balance')}</span><strong data-ft-value="balance">${balance}</strong><small>${escape(this.asset)}</small></div><div><span class="ft-label">${this.text('Ставка раунда','Round stake')}</span><strong>${this.money(session?.stakeUnits??this.stake)}</strong><small>${escape(this.asset)}</small></div></div><div class="ft-bet-block"><label class="ft-stake"><span class="ft-label">${this.text('Ставка','Stake')}</span><select data-ft="stake" ${disabled||active||!!this.client.pending?'disabled':''}>${TEMPLE_DATA.stakes.map(n=>`<option value="${n}" ${this.stake===String(n)?'selected':''}>${this.money(String(n))}</option>`).join('')}</select></label><div class="ft-collected-total"><span class="ft-label">${active?this.text('Собрано','Collected'):this.text('Выплата','Payout')}</span><strong data-ft-value="payout">${this.money(total)}</strong><small>${escape(this.asset)}</small></div></div><div class="ft-action"><button type="button" class="ft-primary" data-ft="primary" ${disabled||!active&&!pending&&!affordable||active&&bonus&&!canMove&&!pending?'disabled':''}>${pending?art.step:active?art.step:art.compass}<span>${label}</span></button>${active?`<button type="button" class="ft-finish" data-ft="finish" ${disabled||pending?'disabled':''}>${this.text('Закончить и забрать собранное','Finish and collect')}</button>`:''}</div><div class="ft-status" data-error="${status.error}" data-settled="${!!v&&!active}" role="status" aria-live="polite"><p>${escape(status.message)}</p></div></section><footer class="ft-bottom"><span>${this.text('5 × 4 КОМНАТЫ','5 × 4 ROOMS')}</span><span>${this.text('6 ХОДОВ · 1 ВЕРЁВКА','6 MOVES · 1 ROPE')}</span><span>${this.text('МАКСИМАЛЬНАЯ ВЫПЛАТА 230×','MAXIMUM PAYOUT 230×')}</span></footer>`;
    if(focusKey&&!this.dialog.open)this.root.querySelector<HTMLElement>(focusKey)?.focus({preventScroll:true});
  }
  private status(){
    if(!this.owner)return {error:false,message:this.text('Войди в общий аккаунт Royal, чтобы начать.','Sign in to your Royal account to begin.')};
    if(this.client.pending?.gameId===TEMPLE_GAME)return {error:true,message:this.client.busy?this.text('Ожидаем подтверждение той же операции.','Waiting for confirmation of the same operation.'):this.text('Ответ не подтверждён. «Проверить ход» повторит ту же операцию без новой ставки.','Result unconfirmed. “Check move” retries the same operation without a new stake.')};
    if(this.blocked)return {error:false,message:this.text('Синхронизация общего кошелька…','Synchronizing the shared wallet…')};
    if(this.localError||this.client.error)return {error:true,message:this.localError||this.client.error};
    if(this.connected&&this.session?.state!=='active'&&this.wallet.wallet!.balance<Number(this.stake)/100)return {error:true,message:this.text('Недостаточно средств для выбранной ставки. Выбери меньшую ставку или пополни общий кошелёк.','Insufficient balance for this stake. Choose a smaller stake or add funds to the shared wallet.')};
    const v=this.view,s=this.session;
    if(v&&s?.state==='settled'){
      const net=BigInt(v.totalPayoutUnits)-BigInt(s.spentUnits);
      return {error:false,message:this.text('Начислено ','Credited ')+this.money(v.totalPayoutUnits)+' '+this.asset+this.text(' · Чистый итог ',' · Net result ')+(net>0n?'+':'')+this.money(net.toString())};
    }
    if(v)return {error:false,message:this.text('Храм: ','Temple: ')+this.money(v.baseResult.payoutUnits)+this.text(' · Экспедиция: ',' · Expedition: ')+this.money(v.bonusState?.payoutUnits??'0')+this.text(' · Продолжение без новой ставки.',' · Continue without a new stake.')};
    return {error:false,message:this.text('Исследование стоит ','Exploration costs ')+this.money(this.stake)+' '+this.asset+this.text('. Реликвия открывает бесплатную экспедицию.','. The relic unlocks a free expedition.')};
  }
  private onClick(event:Event){
    const target=(event.target as Element).closest<HTMLElement>('[data-ft],[data-room]');if(!target||target.matches(':disabled'))return;
    if(target.dataset.room!==undefined){this.selected=Number(target.dataset.room);this.render();return;}
    switch(target.dataset.ft){
      case 'rules':this.showRules();break;
      case 'close':this.dialog.close();break;
      case 'refresh':this.localError='';void this.client.refresh();break;
      case 'base':this.tab='base';this.selected=null;this.render();break;
      case 'bonus':this.tab='bonus';this.selected=null;this.render();break;
      case 'rope':if(!this.blocked&&!this.client.pending&&this.session?.state==='active'&&this.view?.bonusState?.ropeAvailable){this.rope=!this.rope;this.render();}break;
      case 'primary':void this.primary();break;
      case 'finish':this.showFinish();break;
      case 'confirm-finish':this.dialog.close();void this.move('temple-finish');break;
    }
  }
  private async primary(){
    if(this.blocked||!this.connected)return;
    if(this.client.pending?.gameId===TEMPLE_GAME){await this.send(()=>this.client.retry());return;}
    if(this.session?.state==='active'){
      if(this.tab!=='bonus'){this.tab='bonus';this.render();return;}
      const v=this.view!,action=templeLegalActions(v.bonusMap!,v.bonusState!).find(a=>'to'in a&&a.to===this.selected);
      if(!action||action.kind==='rope'&&!this.rope)return;
      await this.move(action.kind==='rope'?'temple-rope':'temple-step',this.selected!);return;
    }
    await this.send(()=>this.client.act({action:'start',gameId:TEMPLE_GAME,stakeUnits:this.stake,settings:{temple:{mode:'normal'}}}));
  }
  private async move(move:'temple-step'|'temple-rope'|'temple-finish',to?:number){
    const session=this.session;if(this.blocked||this.client.pending||session?.state!=='active'||!session.view.temple)return;
    await this.send(()=>this.client.act({action:'move',gameId:TEMPLE_GAME,sessionId:session.id,revision:session.view.temple!.revision,move,...(to===undefined?{}:{picks:[to]})}));
  }
  private async send(operation:()=>Promise<unknown>){
    this.sending=true;this.localError='';this.render();
    try{await operation();}catch(error){if(!this.disposed)this.localError=error instanceof Error?error.message:this.text('Не удалось подтвердить ход.','The move could not be confirmed.');}
    finally{this.sending=false;if(!this.disposed)this.sync();}
  }
  private show(title:string,body:string){
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
      <h3>Choose your expedition route</h3><p>The new map shows all treasures. You have 6 moves and one rope. Select a highlighted adjacent room, then confirm the move. Each passage costs one move. Select “Use rope” before crossing a gap. The bridge remains usable in both directions, with one move per crossing. Levers activate on entry.</p><p>Revisiting a room still uses a move and pays nothing again. The sixth move collects its treasure before the expedition ends. “Finish and collect” ends early and keeps everything already collected. Closing or reopening preserves the same round and requires no new stake.</p>
      <h3>Stake, payout and return</h3><p>All multipliers apply to the original stake. The shared wallet is debited once and credited once when the whole round ends. “Collected” includes the base map and expedition; it is not yet a wallet credit. Net result equals payout minus stake.</p><table><tbody><tr><td>Return with optimal route choices</td><td>96%</td></tr><tr><td>Return across allowed strategies</td><td>90% to 96%</td></tr><tr><td>Highest possible whole-round payout</td><td>230×</td></tr><tr><td>Bonus retriggers / extra paid moves</td><td>None</td></tr></tbody></table><p>RTP is an exact long-run expectation under rules 1, not a promise for an individual session. Choices in the expedition change the expected return. The stake remains locked until the round and any uncertain request are resolved.</p>`:`
      <h3>Исследуй храм</h3><p>Одна ставка открывает карту 5 × 4. Исследовательница автоматически проходит по открытым коридорам, один раз собирает доступные сундуки и включает доступные рычаги. Стены останавливают путь. Каждый рычаг открывает связанные ворота. Найденная реликвия запускает одну бесплатную экспедицию после исследования храма.</p>
      <h3>Выбирай маршрут экспедиции</h3><p>На новой карте видны все сокровища. У тебя 6 ходов и одна верёвка. Выбери соседнюю подсвеченную комнату, затем подтверди переход. Каждый переход стоит один ход. Перед пересечением провала выбери «Использовать верёвку». Мост остаётся доступным в обе стороны, каждый переход по нему стоит один ход. Рычаг включается при входе в комнату.</p><p>Возвращение в комнату расходует ход и не оплачивает сундук повторно. Шестой ход сначала собирает награду, затем завершает экспедицию. «Закончить и забрать собранное» сохраняет все полученные награды. Закрытие и повторное открытие сохраняют тот же раунд без новой ставки.</p>
      <h3>Ставка, выплата и возврат</h3><p>Все множители применяются к исходной ставке. Общий кошелёк списывает её один раз и начисляет выплату один раз после окончания всего раунда. «Собрано» включает храм и экспедицию, но ещё не означает начисление в кошелёк. Чистый итог равен выплате за вычетом ставки.</p><table><tbody><tr><td>Возврат при оптимальном маршруте</td><td>96%</td></tr><tr><td>Возврат при допустимых стратегиях</td><td>90-96%</td></tr><tr><td>Наибольшая выплата за весь раунд</td><td>230×</td></tr><tr><td>Повтор бонуса / платные дополнительные ходы</td><td>Нет</td></tr></tbody></table><p>RTP рассчитан точно для правил 1 на длинной дистанции и не обещает результат отдельной сессии. Выбор маршрута влияет на ожидаемый возврат. Ставка заблокирована до завершения раунда и подтверждения неопределённой операции.</p>`);
  }
  getState(){const s=this.session,v=this.view;return {gameId:TEMPLE_GAME,stage:'interface',playable:true,phase:v?.phase??'ready',sessionId:s?.id??null,revision:v?.revision??null,tab:this.tab,selected:this.selected,ropeSelected:this.rope,moves:v?.bonusState?.left??null,totalPayoutUnits:v?.totalPayoutUnits??'0',busy:this.blocked,pending:this.client.pending?.gameId===TEMPLE_GAME,disposed:this.disposed};}
  destroy(){if(this.disposed)return;this.disposed=true;this.services.expansionClient.removeEventListener('change',this.changed);this.services.demoWallet.removeEventListener('change',this.changed);this.root.removeEventListener('click',this.click);this.root.removeEventListener('keydown',this.key);this.root.removeEventListener('change',this.changedStake);this.dialog.removeEventListener('click',this.click);this.dialog.close();this.host.replaceChildren();}
}
