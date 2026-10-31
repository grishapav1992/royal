import type {GameHostV1} from '../../src/modules/GameHostContract';
import type {ExpansionSession} from '../../src/shared/casinoExpansion';
import {TEMPLE_GAME} from '../../src/shared/floodedTemple';
import {CASCADE_DATA,type CascadeFrame} from '../../src/shared/floodedTempleCascadeMath';
import {cascadeUnits,type TempleCascadeView} from '../../src/shared/floodedTempleCascade';
import {art,escape} from './art';
import {TempleAudio} from './TempleAudio';
import {TempleCharacter} from './TempleCharacter';
import type {CharacterBeat} from './character';
import {CascadeTimeline} from './CascadeTimeline';
import {CascadeEffects} from './CascadeEffects';
import {cascadePlan,cascadeCharacter,type CascadeBeat} from './cascadePresentation';
import {templeMusic} from './audioCredits';
import {templeOutcome} from './presentation';
import {updateCascadeDOM} from './cascadeDOM';

const counts=[10,25,50,100];
const names=[['Идол','Idol'],['Солнце','Sun'],['Ягуар','Jaguar'],['Сокол','Falcon'],['Змея','Serpent'],['Луна','Moon'],['Рыба','Fish'],['Компас WILD','WILD compass'],['Реликвия BONUS','BONUS relic']];
const readyGrid=[0,3,6,1,4,5,2,7,6,3,5,1,4,2,0];

/** Displays accepted frames only. The host owns entropy, money and operation identity. */
export class CascadeUI{
  private root:HTMLElement;
  private dialog:HTMLDialogElement;
  private character:TempleCharacter;
  private audio:TempleAudio;
  private timeline:CascadeTimeline;
  private effects:CascadeEffects;
  private feedback?:CascadeBeat;
  private media:MediaQueryList;
  private unsubscribe:()=>void;
  private owner:string|null=null;
  private marker='';
  private stake='1000';
  private fast=false;
  private autoCount=10;
  private autoRunning=false;
  private autoRemaining=0;
  private autoNote='';
  private sending=false;
  private epoch=0;
  private disposed=false;
  private paused=false;
  private localError='';
  private visual?:CascadeFrame;
  private presenting=false;
  private completed=false;
  private timer=0;
  private pumpTimer=0;
  private lastRequestAt=0;
  private skippedRound:string|null=null;
  private beat?:CharacterBeat;
  private inspected=-1;
  private focusCell=0;
  private returnFocus='rules';
  private rendered='';
  private get doc(){return this.host.ownerDocument;}
  private get client(){return this.services.expansionClient;}
  private get wallet(){return this.services.demoWallet;}
  private get en(){return this.services.i18n.language==='en';}
  private text(ru:string,en:string){return this.en?en:ru;}
  private money(units:string){return (Number(units)/100).toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});}
  private get session():ExpansionSession|undefined{return this.owner&&this.owner===this.wallet.accountId&&this.owner===this.client.accountId?this.client.sessions.find(s=>s.gameId===TEMPLE_GAME&&s.rulesVersion===2):undefined;}
  private get view(){return this.session?.view.templeCascade;}
  private get roundStake(){return this.session?.stakeUnits??this.stake;}
  private get resultOutcome(){return this.view?templeOutcome(this.roundStake,this.view.totalPayoutUnits):undefined;}
  private get connected(){return !!this.owner&&this.wallet.accountId===this.owner&&!!this.wallet.wallet;}
  private get hidden(){return this.doc.hidden||document.hidden;}
  private get pending(){return this.client.pending?.gameId===TEMPLE_GAME;}
  private get locked(){return this.sending||this.client.busy||this.client.loading||this.wallet.busy||!!this.wallet.pending||this.wallet.hasExternalBusy('expansion');}
  private get suspended(){return this.paused||this.hidden||this.dialog.open;}
  private get affordable(){return !!this.wallet.wallet&&this.wallet.wallet.balance>=Number(this.stake)/100;}
  private get playing(){return this.presenting||this.session?.state==='active';}
  private changed=()=>this.sync();
  constructor(private host:HTMLElement,private services:GameHostV1){
    this.root=this.doc.createElement('section');this.root.className='ft ft-cascade';this.root.setAttribute('aria-label',this.text('Затопленный храм','Flooded Temple'));
    this.dialog=this.doc.createElement('dialog');this.dialog.className='ft-dialog ft-cascade-dialog';this.dialog.setAttribute('aria-labelledby','ft-dialog-title');
    host.replaceChildren(this.root,this.dialog);
    try{this.fast=this.doc.defaultView!.localStorage.getItem('royal:temple:fast')==='1';const n=Number(this.doc.defaultView!.localStorage.getItem('royal:temple:auto-count'));if(counts.includes(n))this.autoCount=n;}catch{}
    services.gameAudio.install();this.audio=new TempleAudio(services.gameAudio,this.doc,true);this.character=new TempleCharacter(this.doc,this.en,true);this.effects=new CascadeEffects(this.root,units=>this.money(units));
    this.timeline=new CascadeTimeline(this.audio,beat=>{
      if(this.disposed)return;
      if(!beat){this.endPresentation();return;}
      this.feedback=beat;if(beat.kind!=='break'&&beat.kind!=='base-return')this.visual=beat.frame;
      this.beat=cascadeCharacter(beat);this.render();
    },(beat,offset)=>{this.effects.tick(beat,offset,this.roundStake);this.character.tick(cascadeCharacter(beat),offset);});
    this.media=this.doc.defaultView!.matchMedia('(prefers-reduced-motion: reduce)');this.media.addEventListener('change',this.motion);
    this.unsubscribe=services.gameAudio.onPreferences(()=>this.render());
    this.root.addEventListener('click',this.click);this.root.addEventListener('change',this.select);this.root.addEventListener('keydown',this.key);
    this.dialog.addEventListener('click',this.click);this.dialog.addEventListener('close',this.closed);
    this.doc.addEventListener('visibilitychange',this.visibility);if(this.doc!==document)document.addEventListener('visibilitychange',this.visibility);
    this.client.addEventListener('change',this.changed);this.wallet.addEventListener('change',this.changed);
    this.sync();void this.client.refresh();this.render();
  }
  private sync(){
    if(this.disposed)return;
    if(this.owner!==this.client.accountId){this.skippedRound=null;this.epoch++;this.sending=false;this.stopAuto(this.owner?this.text('Автоспины остановлены: аккаунт изменён.','Autoplay stopped: account changed.'):'');this.cancelFeedback();this.owner=this.client.accountId;this.marker='';this.visual=undefined;this.localError='';this.inspected=-1;if(this.dialog.open)this.dialog.close();}
    const s=this.session,v=this.view,key=s?s.id+':'+v?.revision:'';
    if(key!==this.marker){this.marker=key;if(s)this.stake=s.stakeUnits;if(!this.sending){this.cancelFeedback();this.visual=v?.frames.at(-1);this.completed=!!v&&s?.state==='settled';}}
    const p=this.client.pending;if(p?.gameId===TEMPLE_GAME&&p.action==='start')this.stake=p.stakeUnits;
    this.audio.setAccountActive(this.connected);this.audio.setAllowed(!this.suspended);this.render();this.pump();
  }
  private cancelFeedback(){clearTimeout(this.timer);this.timer=0;this.timeline.cancel();this.effects.clear();this.feedback=undefined;this.presenting=false;this.beat=undefined;}
  private settleFeedback(){this.cancelFeedback();this.visual=this.view?.frames.at(-1);this.completed=this.session?.state==='settled';this.render();this.pump();}
  private save(){try{this.doc.defaultView!.localStorage.setItem('royal:temple:fast',this.fast?'1':'0');this.doc.defaultView!.localStorage.setItem('royal:temple:auto-count',String(this.autoCount));}catch{}}
  private select=(event:Event)=>{
    const target=event.target as HTMLSelectElement;
    if(target.dataset.ft==='stake'&&!this.locked&&!this.playing&&!this.client.pending&&!this.autoRunning&&CASCADE_DATA.stakes.some(s=>String(s)===target.value))this.stake=target.value;
    if(target.dataset.ft==='auto-count'&&!this.autoRunning&&counts.includes(Number(target.value)))this.autoCount=Number(target.value);
    this.save();this.render();
  };
  private key=(event:KeyboardEvent)=>{
    const target=event.target as HTMLElement;if(target.dataset.cell===undefined)return;
    const cell=Number(target.dataset.cell),c=Math.floor(cell/3),r=cell%3;
    const next=event.key==='ArrowLeft'?Math.max(0,c-1)*3+r:event.key==='ArrowRight'?Math.min(4,c+1)*3+r:event.key==='ArrowUp'?c*3+Math.max(0,r-1):event.key==='ArrowDown'?c*3+Math.min(2,r+1):event.key==='Home'?0:event.key==='End'?14:undefined;
    if(next!==undefined){event.preventDefault();this.focusCell=next;this.root.querySelectorAll<HTMLElement>('[data-cell]').forEach(el=>el.tabIndex=Number(el.dataset.cell)===next?0:-1);this.root.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();}
  };
  private click=(event:Event)=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('[data-ft],[data-cell]');if(!target||target.hasAttribute('disabled'))return;
    const action=target.dataset.ft;void this.audio.gesture();
    if(target.dataset.cell!==undefined){this.inspected=Number(target.dataset.cell);this.focusCell=this.inspected;this.render();return;}
    if(action==='close'){this.dialog.close();return;}
    if(action==='rules'||action==='journal'){this.returnFocus=action;this.stopAuto(this.text('Автоспины остановлены.','Autoplay stopped.'));this.settleFeedback();this.showDialog(action);return;}
    if(action==='mute'){const p=this.services.gameAudio.getPreferences();this.services.gameAudio.setMuted(!p.muted);return;}
    if(action==='fast'){this.fast=!this.fast;this.save();this.render();return;}
    if(action==='auto'){
      if(this.autoRunning){this.stopAuto(this.text('Автоспины остановлены. Принятый раунд будет завершён.','Autoplay stopped. The accepted round will finish.'));this.render();this.pump();return;}
      if(this.locked||this.playing||this.client.pending||!this.connected||this.suspended||!this.affordable)return;
      this.autoRunning=true;this.autoRemaining=this.autoCount;this.autoNote='';this.render();this.pump();return;
    }
    if(action==='primary'){
      if(this.presenting){this.skippedRound=this.session?.id??null;this.settleFeedback();return;}
      if(this.locked||this.suspended||!this.connected)return;
      if(this.pending){void this.operate('retry');return;}
      if(this.client.pending)return;
      if(this.session?.state==='active'){void this.operate('continue');return;}
      if(!this.autoRunning&&this.affordable)void this.operate('start');
    }
  };
  private stopAuto(note:string){this.autoRunning=false;this.autoRemaining=0;this.autoNote=note;clearTimeout(this.pumpTimer);this.pumpTimer=0;}
  private pump(){
    clearTimeout(this.pumpTimer);this.pumpTimer=0;
    if(this.disposed||this.suspended||!this.connected||this.locked||this.presenting||this.client.pending)return;
    // All automatic requests share the 120/minute account guard, including free continuations.
    const cadence=Math.max(0,550-(performance.now()-this.lastRequestAt));
    if(this.session?.state==='active'){this.pumpTimer=window.setTimeout(()=>{this.pumpTimer=0;void this.operate('continue');},Math.max(cadence,this.fast||this.media.matches?30:280));return;}
    if(!this.autoRunning)return;
    if(this.autoRemaining===0){this.stopAuto(this.text('Серия автоспинов завершена.','Autoplay completed.'));this.render();return;}
    if(!this.affordable){this.stopAuto(this.text('Автоспины остановлены: недостаточно средств.','Autoplay stopped: insufficient balance.'));this.render();return;}
    this.pumpTimer=window.setTimeout(()=>{this.pumpTimer=0;void this.operate('start');},Math.max(cadence,this.fast||this.media.matches?80:650));
  }
  private async operate(kind:'start'|'continue'|'retry'){
    if(this.disposed||this.suspended||this.locked||!this.connected||kind!=='retry'&&this.client.pending||kind==='start'&&(this.playing||!this.affordable)||kind==='continue'&&this.session?.state!=='active')return;
    const epoch=this.epoch,previous=this.view,oldId=this.session?.id,newRound=kind==='start'||kind==='retry'&&this.client.pending?.action==='start';
    if(newRound){this.beat=undefined;clearTimeout(this.timer);this.timer=0;}
    this.sending=true;this.completed=false;this.localError='';this.inspected=-1;this.render();
    this.lastRequestAt=performance.now();
    try{
      if(kind==='retry')await this.client.retry();
      else if(kind==='start')await this.client.act({gameId:TEMPLE_GAME,action:'start',stakeUnits:this.stake,settings:{temple:{mode:'cascades'}}});
      else await this.client.act({gameId:TEMPLE_GAME,action:'move',sessionId:this.session!.id,revision:this.view!.revision,move:'temple-cascade'});
      if(epoch!==this.epoch||this.disposed)return;
      if(kind==='start'&&this.autoRunning)this.autoRemaining=Math.max(0,this.autoRemaining-1);
      const v=this.view;if(v&&!this.suspended&&this.skippedRound!==this.session?.id&&!(kind==='retry'&&oldId===this.session?.id&&previous?.revision===v.revision))this.play(v,newRound?undefined:previous);else this.settleFeedback();
    }catch(error){if(epoch===this.epoch&&!this.disposed){this.localError=error instanceof Error?error.message:String(error);this.stopAuto(this.text('Автоспины остановлены после ошибки.','Autoplay stopped after an error.'));}}
    finally{if(epoch===this.epoch&&!this.disposed){this.sending=false;this.render();this.pump();}}
  }
  private play(view:TempleCascadeView,previous?:TempleCascadeView){
    this.cancelFeedback();this.completed=false;this.presenting=true;
    if(!this.timeline.start(cascadePlan(this.marker,view,previous,this.fast,this.media.matches)))this.settleFeedback();
  }
  private endPresentation(){
    this.visual=this.view?.frames.at(-1);this.feedback=undefined;this.effects.clear();this.presenting=false;this.completed=this.session?.state==='settled';
    if(!this.completed)this.beat=undefined;
    this.render();this.pump();
    clearTimeout(this.timer);this.timer=window.setTimeout(()=>{this.timer=0;if(!this.presenting){this.beat=undefined;this.render();}},850);
  }
  private status(){
    if(!this.connected)return this.text('Войди в аккаунт Royal, чтобы начать.','Sign in to Royal to begin.');
    if(this.pending)return this.client.busy?this.text('Подтверждаем ту же операцию…','Confirming the same operation…'):this.text('Ответ не подтверждён. «Проверить раунд» повторит ту же операцию без новой ставки.','Result unconfirmed. “Check round” retries the same operation without a new stake.');
    if(this.localError||this.client.error)return this.localError||this.client.error;
    if(this.sending)return this.text('Подтверждаем выпадение…','Confirming the fall…');
    const f=this.feedback?.frame??this.visual;
    if(this.presenting&&f&&!this.feedback?.outcome){
      if(this.feedback?.kind==='drop')return this.text(`Падение камней · каскад ×${f.multiplier}.`,`Stones falling · cascade ×${f.multiplier}.`);
      if(this.feedback?.kind==='break')return this.text('Выигравшие камни освобождают место.','Winning stones make room for the next fall.');
      if(this.feedback?.kind==='base-return')return this.text('Продолжаем сохранённую цепочку в храме.','Resuming the saved temple chain.');
      return f.addedFreeSpins?this.text(`Реликвии на линии: +${f.addedFreeSpins} бесплатных вращений.`,`Relics on a payline: +${f.addedFreeSpins} free spins.`):f.awardedPoints?this.text(`Линий с выплатой: ${f.wins.length}. Каскад ×${f.multiplier}: ${this.money(cascadeUnits(f.awardedPoints,this.roundStake))}.`,`Paying lines: ${f.wins.length}. Cascade ×${f.multiplier}: ${this.money(cascadeUnits(f.awardedPoints,this.roundStake))}.`):this.text('Проверяем подтверждённое выпадение.','Showing the confirmed fall.');
    }
    if(this.session?.state==='active')return this.suspended?this.text('Раунд сохранён. Продолжение без новой ставки.','Round saved. Continue without a new stake.'):this.text('Продолжаем каскады без новой ставки…','Continuing cascades without a new stake…');
    if((this.completed||this.feedback?.outcome)&&this.view){const payout=this.view.totalPayoutUnits,net=BigInt(payout)-BigInt(this.roundStake);return (f?.capped?this.text('Достигнут предел 500×. ','The 500× limit was reached. '):'')+this.text(`Выплата ${this.money(payout)}. Итог раунда ${net>0n?'+':''}${this.money(String(net))}.`,`Payout ${this.money(payout)}. Round net ${net>0n?'+':''}${this.money(String(net))}.`);}
    if(!this.affordable)return this.text('Недостаточно средств для выбранной ставки.','Insufficient balance for this stake.');
    return this.text('Собери от трёх одинаковых символов слева направо. Выигравшие камни освобождают место новым.','Match three or more symbols from the left. Winning stones make room for a new fall.');
  }
  private symbolName(symbol:number){return names[symbol][this.en?1:0];}
  private awardLabel(){
    const b=this.feedback,outcome=b?.outcome??(this.completed?this.resultOutcome:undefined);
    if(outcome){
      const labels={loss:['БЕЗ ВЫПЛАТЫ','NO PAYOUT'],partial:['ЧАСТИЧНЫЙ ВОЗВРАТ','PARTIAL RETURN'],return:['СТАВКА ВОЗВРАЩЕНА','STAKE RETURNED'],win:['ВЫИГРЫШ','ROUND WIN'],big:['КРУПНЫЙ ВЫИГРЫШ','BIG WIN']};
      const label=this.visual?.capped?this.text('ПРЕДЕЛ 500×','500× LIMIT'):this.text(labels[outcome][0],labels[outcome][1]);
      return label+' · '+this.money(this.view!.totalPayoutUnits);
    }
    if(!b)return this.text('МНОЖИТЕЛЬ РАСТЁТ С КАЖДЫМ КАСКАДОМ','THE MULTIPLIER GROWS WITH EACH CASCADE');
    if(b.kind==='bonus')return `+${b.frame.addedFreeSpins} `+this.text('БЕСПЛАТНЫХ ВРАЩЕНИЙ','FREE SPINS');
    if(b.kind==='base-return')return this.text('ВОЗВРАЩАЕМСЯ В ХРАМ','RETURNING TO THE TEMPLE');
    if(b.kind==='evaluate'&&b.frame.awardedPoints)return this.text('КАСКАД +','CASCADE +')+this.money(cascadeUnits(b.frame.awardedPoints,this.roundStake));
    return this.text('КАСКАД ×','CASCADE ×')+b.frame.multiplier;
  }
  private render(){
    if(this.disposed)return;
    const signature=JSON.stringify([this.owner,this.session,this.client.pending,this.client.loading,this.client.busy,this.client.error,this.wallet.wallet?.balance,this.wallet.busy,this.wallet.pending,this.wallet.hasExternalBusy('expansion'),this.sending,this.localError,this.stake,this.visual,this.feedback?.id,this.presenting,this.completed,this.fast,this.autoRunning,this.autoRemaining,this.autoCount,this.autoNote,this.paused,this.hidden,this.dialog.open,this.media.matches,this.inspected,this.beat,this.services.gameAudio.getPreferences()]);if(signature===this.rendered)return;this.rendered=signature;
    const focused=this.doc.activeElement as HTMLElement|null,key=focused&&this.root.contains(focused)?focused.dataset.ft?`[data-ft="${focused.dataset.ft}"]`:focused.dataset.cell!==undefined?`[data-cell="${focused.dataset.cell}"]`:null:null;
    const f=this.feedback?.frame??this.visual,grid=this.feedback?.grid??f?.grid??readyGrid,total=this.feedback?cascadeUnits(this.feedback.fromPoints,this.roundStake):f?cascadeUnits(f.totalPoints,this.roundStake):'0',levels=f?.mode==='free'?CASCADE_DATA.freeMultipliers:CASCADE_DATA.baseMultipliers;
    const highlight=['evaluate','break','bonus'].includes(this.feedback?.kind??''),removeMask=this.feedback?.removeMask??f?.removeMask??0;
    const net=this.view&&(this.completed||this.feedback?.outcome)?BigInt(this.view.totalPayoutUnits)-BigInt(this.roundStake):undefined;
    const disabled=this.locked||!this.connected||this.suspended,active=this.session?.state==='active',pending=!!this.client.pending;
    const label=this.presenting?this.text('Показать итог','Show result'):this.pending?this.text('Проверить раунд','Check round'):this.sending?this.text('Подтверждаем…','Confirming…'):active?this.text('Продолжить','Continue'):this.text('Вращать','Spin');
    const detail=this.inspected>=0?this.symbolName(grid[this.inspected]):this.text('20 линий · ставка поровну на все линии','20 paylines · stake divided equally among all lines');
    this.root.dataset.phase=f?.mode==='free'?'free':this.completed?'complete':'base';this.root.dataset.motion=this.media.matches?'reduced':'full';this.root.dataset.speed=this.fast?'quick':'normal';this.root.dataset.feedback=this.feedback?.kind??'idle';this.root.dataset.outcome=this.feedback?.outcome??(this.completed?this.resultOutcome??'':'');this.root.dataset.paused=String(this.suspended);this.root.setAttribute('aria-busy',String(this.sending||this.client.busy||this.client.loading));
    updateCascadeDOM(this.root,`<header class="ft-top"><div class="ft-title"><h1>${this.text('Затопленный храм','Flooded Temple')}</h1></div><div class="ft-tools"><button type="button" data-ft="journal" aria-label="${this.text('История раунда','Round history')}">≡</button><button type="button" data-ft="rules" aria-label="${this.text('Правила и выплаты','Rules and payouts')}">?</button><button type="button" data-ft="mute" aria-label="${this.text('Выключить звук','Mute audio')}" aria-pressed="${this.services.gameAudio.getPreferences().muted}">${this.services.gameAudio.getPreferences().muted?'♪̸':'♪'}</button></div></header>
    <div class="ft-play"><div class="ft-board-area"><div class="ft-cascade-heading"><span>${f?.mode==='free'?this.text('СВЯТИЛИЩЕ РЕЛИКВИЙ','RELIC SANCTUARY'):this.text('ЗАБЫТОЕ СВЯТИЛИЩЕ','FORGOTTEN SANCTUARY')}</span><span class="ft-free-count" data-free-count>${f?.mode==='free'?this.text(`БЕСПЛАТНЫХ: ${f.remainingFreeSpins}`,`FREE SPINS: ${f.remainingFreeSpins}`):this.text('КАСКАДЫ','CASCADES')}</span></div>
    <div class="ft-multiplier" role="group" aria-label="${this.text('Множитель каскада','Cascade multiplier')}">${levels.map(n=>`<span data-multiplier="${n}" aria-current="${n===(f?.multiplier??1)?'step':'false'}">×${n}</span>`).join('')}</div>
    <div class="ft-cabinet"><div class="ft-reels" data-enter="${this.presenting}" role="group" aria-label="${this.text('Поле 5 на 3','5 by 3 grid')}">${grid.map((symbol,cell)=>{const winning=highlight&&!!(removeMask&(1<<cell)),c=Math.floor(cell/3),r=cell%3;return `<button type="button" class="ft-symbol ${winning?'ft-winning':''}" data-cell="${cell}" data-symbol="${symbol}" style="grid-column:${c+1};grid-row:${r+1};--sx:${symbol%3*50}%;--sy:${Math.floor(symbol/3)*50}%;--delay:${c*25}ms" tabindex="${cell===this.focusCell?0:-1}" aria-label="${this.text('Столбец','Column')} ${c+1}, ${this.text('ряд','row')} ${r+1}: ${this.symbolName(symbol)}${winning?this.text(', выигравший символ',', winning symbol'):''}"><span class="ft-symbol-art" aria-hidden="true"></span>${symbol>=7?`<b>${symbol===7?'WILD':'BONUS'}</b>`:''}</button>`;}).join('')}<div class="ft-cascade-fx" aria-hidden="true"></div></div></div>
    <p class="ft-cascade-detail">${escape(detail)}</p><div class="ft-fall-award" role="status">${escape(this.awardLabel())}</div></div><div data-ft-character-slot></div></div>
    <section class="ft-console" aria-label="${this.text('Управление игрой','Game controls')}"><div class="ft-money"><div><span class="ft-label">${this.text('Общий баланс','Shared balance')}</span><strong data-ft-value="balance">${this.connected?this.wallet.wallet!.balance.toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'···'}</strong><small>${this.wallet.wallet?.asset==='USDT_NILE_TEST'?'USDT':this.text('демомонеты','demo coins')}</small></div></div><div class="ft-bet-block"><label class="ft-stake"><span class="ft-label">${this.text('Ставка','Stake')}</span><select data-ft="stake" ${disabled||this.playing||pending||this.autoRunning?'disabled':''}>${CASCADE_DATA.stakes.map(n=>`<option value="${n}" ${this.stake===String(n)?'selected':''}>${this.money(String(n))}</option>`).join('')}</select></label><div class="ft-collected-total"><span class="ft-label">${this.text('Выплата раунда','Round payout')}</span><strong data-ft-value="payout">${this.money(total)}</strong><small class="ft-net" data-empty="${net===undefined}" ${net===undefined?'aria-hidden="true"':'data-ft-value="net"'}>${net===undefined?'':this.text('Итог раунда','Round net')+' '+(net>0n?'+':'')+this.money(String(net))}</small></div></div><div class="ft-action"><button class="ft-primary" type="button" data-ft="primary" ${(this.presenting?this.suspended:disabled||pending&&!this.pending||!active&&!this.pending&&(!this.affordable||this.autoRunning))?'disabled':''}>${art.compass}<span>${label}</span></button></div>
    <div class="ft-playback"><button type="button" data-ft="fast" aria-pressed="${this.fast}" aria-label="${this.text('Быстрая игра','Quick play')}">⚡ ${this.text('Быстро','Quick')}</button><label>${this.text('Автоспины','Autoplay')} <select data-ft="auto-count" aria-label="${this.text('Количество автоспинов','Autoplay count')}" ${this.autoRunning?'disabled':''}>${counts.map(n=>`<option ${n===this.autoCount?'selected':''}>${n}</option>`).join('')}</select></label><button type="button" data-ft="auto" aria-pressed="${this.autoRunning}" ${!this.autoRunning&&(disabled||this.playing||pending||!this.affordable)?'disabled':''}>${this.autoRunning?this.text(`Стоп · осталось ${this.autoRemaining}`,`Stop · ${this.autoRemaining} left`):this.text('Запустить серию','Start autoplay')}</button><span class="ft-auto-note">${escape(this.autoNote)}</span></div>
    <div class="ft-status" data-error="${!!this.localError||!!this.client.error||this.pending}" data-settled="${this.completed}" role="status" aria-live="polite"><p>${escape(this.status())}</p></div></section><footer class="ft-bottom"><span>5 × 3 · 20 ${this.text('ЛИНИЙ','LINES')}</span><span>${this.text('БЕСПЛАТНЫЕ ВРАЩЕНИЯ','FREE SPINS')} ×3 / ×6 / ×9 / ×15</span><span>${this.text('ПРЕДЕЛ','LIMIT')} 500×</span></footer>`);
    this.root.querySelector('[data-ft-character-slot]')?.replaceWith(this.character.element);
    this.character.update({beat:this.beat,key:this.marker,offset:this.timeline.offset,waiting:this.sending,rope:false,selected:false,reduced:this.media.matches,paused:this.suspended,connected:this.connected});
    this.effects.attach(this.feedback,this.roundStake,this.timeline.offset,total);
    if(key&&!this.dialog.open)this.root.querySelector<HTMLElement>(key)?.focus({preventScroll:true});
  }
  private showDialog(kind:'rules'|'journal'){
    const v=this.view,s=this.session;
    const rules=`<p>${this.text('20 фиксированных линий. От трёх одинаковых символов подряд слева направо дают выплату. Ставка линии равна общей ставке / 20. Все выигравшие символы исчезают одновременно, остальные опускаются вниз.','20 fixed paylines. Three or more matching symbols from the left pay. Line stake is total stake / 20. All winning symbols disappear together and the others fall down.')}</p><p>${this.text('Обычные множители: ×1, ×2, ×3, ×5. В бесплатных вращениях: ×3, ×6, ×9, ×15. Последний множитель сохраняется до конца цепочки, каждое новое вращение начинает лестницу заново.','Base multipliers: ×1, ×2, ×3, ×5. Free spins: ×3, ×6, ×9, ×15. The final multiplier holds for the rest of the chain. Each new spin resets the ladder.')}</p><p>${this.text('Компас WILD заменяет обычные символы и реликвию, появляется только в столбцах 2–4. Три реликвии BONUS на одной линии в первых трёх столбцах дают 10 бесплатных вращений. Каждая такая линия даёт ещё 10, в том числе повторно в бонусе. Сама линия реликвий не платит монеты.','WILD substitutes ordinary symbols and the relic and appears in columns 2–4. Three BONUS relics on a payline in the first three columns award 10 free spins. Every qualifying line adds another 10, including retriggers in the bonus. The relic line itself pays no coins.')}</p><p>${this.text('Базовая цепочка ждёт окончания бонуса и продолжается с сохранённым множителем. Вся цепочка и бесплатные вращения входят в одну ставку. Предел общей выплаты 500× ставки, после него раунд заканчивается. Промежуточная сумма начисляется один раз в конце раунда.','The base chain waits for the bonus and resumes with its saved multiplier. Cascades and free spins belong to one paid round. Total payout is capped at 500× stake and reaching it ends the round. The accumulated payout is credited once at the end.')}</p><h3>${this.text('Выплаты в ставках линии, до множителя','Payouts in line stakes, before multiplier')}</h3><table><thead><tr><th>${this.text('Символ','Symbol')}</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>${CASCADE_DATA.paytable.map((row,i)=>`<tr><td>${this.symbolName(i)}</td>${row.map(n=>`<td>${n}×</td>`).join('')}</tr>`).join('')}</tbody></table><h3>${this.text('20 линий','20 paylines')}</h3><div class="ft-paylines">${CASCADE_DATA.paylines.map((rows,i)=>`<div aria-label="${this.text('Линия','Line')} ${i+1}: ${rows.map(r=>r+1).join(', ')}"><b>${i+1}</b><svg viewBox="0 0 100 55" aria-hidden="true"><path d="${rows.map((r,c)=>(c?'L':'M')+(c*22+6)+','+(r*20+7)).join(' ')}"/></svg></div>`).join('')}</div><p>${this.text('Быстрый режим вдвое ускоряет падения и каскады. Автоспины запускают выбранное число платных раундов. «Стоп» отменяет будущие ставки, принятый раунд завершается. Закрытие игры, смена аккаунта и скрытие окна останавливают серию.','Quick play runs falls and cascades at twice the normal speed. Autoplay starts the selected number of paid rounds. Stop cancels future stakes while the accepted round finishes. Closing, changing account or hiding the window stops autoplay.')}</p><p>${this.text('Целевой RTP: 96%. Статистическая оценка на 400 млн независимых раундов: 95,9988%. Это среднее на большой выборке, а не обещание результата отдельной сессии.','Target RTP: 96%. Statistical estimate over 400 million independent rounds: 95.9988%. This is a large-sample average, not a promise for an individual session.')}</p><p>Music: <a href="${templeMusic.source}" target="_blank" rel="noopener">${escape(templeMusic.title)}</a> · ${escape(templeMusic.author)} · CC BY 4.0</p>`;
    const journal=v?`<p>${this.text('Ставка','Stake')}: ${this.money(s!.stakeUnits)} · ${this.text('Подтверждено выпадений','Confirmed falls')}: ${v.state.falls} · ${this.text('Сыграно бесплатных вращений','Free spins played')}: ${v.state.playedFreeSpins}</p><p>${this.text('Накоплено','Accumulated')}: ${this.money(v.totalPayoutUnits)}. ${s?.state==='settled'?this.text('Раунд завершён, выплата начислена.','Round complete, payout credited.'):this.text('Раунд сохранён, выплата будет начислена в конце.','Round saved, payout will be credited at the end.')}</p><p>${this.text('Последняя подтверждённая часть','Latest confirmed batch')}:</p><ol>${v.frames.map(f=>`<li>${this.text('Выпадение','Fall')} ${f.fall} · ${f.mode==='free'?this.text('Бесплатное','Free'):this.text('Базовое','Base')} ×${f.multiplier} · +${this.money(cascadeUnits(f.awardedPoints,this.roundStake))}${f.addedFreeSpins?` · +${f.addedFreeSpins} FS`:''}</li>`).join('')}</ol>`:`<p>${this.text('Подтверждённых раундов пока нет.','There are no confirmed rounds yet.')}</p>`;
    this.dialog.innerHTML=`<button type="button" class="ft-dialog-close" data-ft="close" aria-label="${this.text('Закрыть','Close')}">×</button><h2 id="ft-dialog-title">${kind==='rules'?this.text('Правила и выплаты','Rules and payouts'):this.text('История раунда','Round history')}</h2>${kind==='rules'?rules:journal}`;
    this.dialog.showModal();this.audio.setAllowed(false);this.render();
  }
  private closed=()=>{
    if(this.disposed)return;
    // The native dialog may already have restored focus before this queued event.
    const focused=this.doc.activeElement;
    const restore=!focused||focused===this.doc.body||this.dialog.contains(focused);
    this.audio.setAllowed(!this.suspended);this.render();
    if(restore)this.root.querySelector<HTMLElement>(`[data-ft="${this.returnFocus}"]`)?.focus();
    this.pump();
  };
  private motion=()=>{if(this.media.matches)this.settleFeedback();this.render();};
  private visibility=()=>{if(this.hidden){this.stopAuto(this.text('Автоспины остановлены: окно скрыто.','Autoplay stopped: window hidden.'));clearTimeout(this.pumpTimer);this.pumpTimer=0;this.settleFeedback();}this.audio.setAllowed(!this.suspended);this.render();if(!this.hidden)this.pump();};
  pause(){this.paused=true;this.stopAuto(this.text('Автоспины остановлены.','Autoplay stopped.'));this.settleFeedback();this.audio.setAllowed(false);this.render();}
  resume(){if(this.disposed)return;this.paused=false;this.audio.setAllowed(!this.suspended);this.render();this.pump();}
  getState(){return {gameId:TEMPLE_GAME,version:2,owner:this.owner,sessionId:this.session?.id,revision:this.view?.revision,phase:this.view?.phase??'ready',busy:this.locked,presenting:this.presenting,visual:this.visual,framesRemaining:this.timeline.remainingFrames,completed:this.completed,selectedStakeUnits:this.stake,acceptedStakeUnits:this.session?.stakeUnits,decorationsSkipped:this.skippedRound===this.session?.id,fast:this.fast,autoplay:{running:this.autoRunning,remaining:this.autoRemaining,count:this.autoCount,note:this.autoNote},pending:this.pending,paused:this.paused,feedback:{...this.timeline.getState(),effects:this.effects.getState()},character:this.character.getState(),audio:this.audio.getState(),disposed:this.disposed};}
  destroy(){if(this.disposed)return;this.disposed=true;this.epoch++;this.stopAuto('');this.cancelFeedback();this.timeline.destroy();clearTimeout(this.timer);this.unsubscribe();this.media.removeEventListener('change',this.motion);this.doc.removeEventListener('visibilitychange',this.visibility);document.removeEventListener('visibilitychange',this.visibility);this.client.removeEventListener('change',this.changed);this.wallet.removeEventListener('change',this.changed);this.root.removeEventListener('click',this.click);this.root.removeEventListener('change',this.select);this.root.removeEventListener('keydown',this.key);this.dialog.removeEventListener('click',this.click);this.dialog.removeEventListener('close',this.closed);this.character.destroy();this.audio.destroy();this.dialog.remove();this.root.remove();}
}
