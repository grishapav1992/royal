import { t as translateText, tr, locale } from '../i18n/index';
import {SlotSettings} from './slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from './slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls, slotStakeStep, updateSlotTransport} from './slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable, renderSlotPaylines} from './slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from './slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from './slotKit/SlotSessions';
import {bindSlotLifecycle} from './slotKit/SlotLifecycle';
import {caramelSlot} from './slotKit/nativeSlots';
import {CARAMEL_GAME,CARAMEL_BETS,CARAMEL_PAYTABLE,CARAMEL_NAMES,type CaramelView,type CaramelSpin} from '../shared/caramelCarnival';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {CaramelCarnivalAssets,CARAMEL_ASSETS,type CaramelAssetState} from './CaramelCarnivalAssets';
import {CaramelCarnivalAudio} from './CaramelCarnivalAudio';
import {CaramelBoard} from './CaramelBoard';
import {caramelSymbol} from './CaramelArtwork';
import './caramel-carnival.css';

type Session=NativeSlotSession<'caramel'>;
type Dialog=''|'intro'|'info'|'history'|'buy'|'bonus'|'complete';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session};
const preview=Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%7);

/** Presentation consumes confirmed frames. Reopening and retries remain static. */
export class CaramelCarnivalUI {
 private settings?:SlotSettings;
 private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private board:CaramelBoard;private audio=new CaramelCarnivalAudio();private assets:CaramelCarnivalAssets;
 private owner=client.accountId;private destroyed=false;private entered=false;private stake='100';private fast=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)');private manualReduced=false;
 private dialog:Dialog='intro';private shown='';private lastWin='0';private error='';private live?:Live;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(caramelSlot);private autoRemaining=0;private bonusRunning=false;private unsubscribe=()=>{};
 private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChanged=()=>{this.cancel();this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog))return;
    if(event.code==='Space'&&this.entered&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();void this.play();}
  };
 constructor(private host:HTMLElement){
  try{this.manualReduced=localStorage.getItem('royal-caramel-reduced')==='1';}catch{}
  host.innerHTML=this.markup();this.root=host.querySelector('[data-caramel-game]')!;
  this.assets=new CaramelCarnivalAssets(state=>this.assetState(state));
  this.board=new CaramelBoard(this.find('[data-cc-board]'),{phase:value=>{if(this.live)this.root.dataset.phase=value;},stop:col=>{if(this.live)this.audio.stopReel(col);}});
  this.bind();this.settings=new SlotSettings(this.root,this.find('.cc-footer'),this.find('.cc-tools'),()=>{this.stopAuto();this.controls();});this.unsubscribe=bindSlotLifecycle({changed:this.change,visibility:this.visibility,keyboard:this.keyboard,motion:this.reduced,motionChanged:this.motionChanged,audioChanged:()=>this.controls()});
  this.sync();this.openDialog('intro');void this.assets.load();
 }
 private find<T extends HTMLElement=HTMLElement>(selector:string):T{return this.root.querySelector<T>(selector)!;}
 private session(){return this.sessions.session(client.sessions);}
 private key(session:Session){return this.sessions.key(session);}
 private balance(){return this.sessions.balance(client,demoWallet);}
 private motion(){return !(this.reduced.matches||this.manualReduced);}
 private blocked(){return this.destroyed||!this.assets.ready||!!this.live||client.busy||client.loading||!!client.pending||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion')||document.hidden||!client.accountId;}
 private valid(live:Live){return !this.destroyed&&this.playback.current(live,this.live);}
 private delay(ms:number,live:Live){return this.playback.delay(ms,()=>this.valid(live));}
 private stopAuto(){this.autoRemaining=0;this.bonusRunning=false;this.playback.cancelScheduled();}
 private cancel(){this.playback.cancel();this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.shown='';this.root.dataset.phase='idle';this.root.dataset.charging='false';resetGameOutcomes(this.root);}
 private assetState(state:CaramelAssetState){
  if(this.destroyed)return;
  this.root.dataset.assetState=state.status;
  if(state.status==='ready'){this.root.style.setProperty('--cc-symbols',`url("${CARAMEL_ASSETS.symbols}")`);this.root.style.setProperty('--cc-background',`url("${CARAMEL_ASSETS.background}")`);}
  this.find<HTMLProgressElement>('[data-cc-load-progress]').value=state.loaded;
  this.find('[data-cc-load-title]').textContent=state.status==='error'?translateText('НЕ УДАЛОСЬ ЗАГРУЗИТЬ ЯРМАРКУ'):translateText('ГОТОВИМ СЛАДКИЙ ПРАЗДНИК');
  this.find('[data-cc-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и повтори загрузку. Монеты не списываются.'):tr`Изображения: ${state.loaded} из ${state.total}`;
  this.find<HTMLButtonElement>('[data-cc-load-retry]').hidden=state.status!=='error';this.controls();
 }
 private markup(){return tr`<section class="cc-game" data-caramel-game data-studio-game="${CARAMEL_GAME}" data-asset-state="loading" data-phase="idle" aria-label="Caramel Carnival">
  <div class="cc-loader" role="status"><span class="cc-loader-spark">✦</span><strong data-cc-load-title>ГОТОВИМ СЛАДКИЙ ПРАЗДНИК</strong><p data-cc-load-note>Изображения: 0 из 2</p><progress data-cc-load-progress max="2" value="0" aria-label="Загрузка оформления"></progress><button type="button" data-cc-load-retry hidden>Повторить загрузку</button></div>
  <header class="cc-heading"><div><small>ROYAL · НОВАЯ ЯРМАРКА</small><h2>CARAMEL <em>CARNIVAL</em></h2><span>СЛАДКИЙ ПРАЗДНИК</span></div><p>КАСКАДЫ · ЭНЕРГИЯ · ФЕСТИВАЛЬ</p></header>
  <div class="cc-scene"><aside class="cc-tickets"><h3>БИЛЕТЫ ФЕСТИВАЛЯ</h3><div class="cc-ticket-slots" data-cc-tickets>${Array.from({length:4},()=>`<span>${caramelSymbol(7)}</span>`).join('')}</div><strong data-cc-ticket-count>0 / 4</strong><p data-cc-ticket-help>4 билета = 10 бесплатных вращений</p><div class="cc-series"><strong data-cc-free>Фестиваль ждёт</strong><div><button type="button" data-cc-pause disabled>На паузе</button></div></div></aside>
  <div class="cc-stage"><div class="cc-stage-heading"><span data-cc-phase-title>ОСНОВНАЯ ИГРА</span><b>8+ В ЛЮБОМ МЕСТЕ</b></div><div class="cc-awning"></div><div class="cc-board-frame"><div class="cc-board" data-cc-board role="group" aria-label="Шесть барабанов, пять рядов"></div></div><div class="cc-board-foot"></div></div>
  <aside class="cc-energy"><div class="cc-top" aria-hidden="true">${caramelSymbol(8)}<strong data-cc-top-factor>×1</strong></div><div class="cc-factor-card"><h3>ЭНЕРГИЯ ВОЛЧКА</h3><strong data-cc-factor>×1</strong><div class="cc-energy-meter"><i data-cc-energy-fill></i></div><small data-cc-factor-note>С новой ставки начинается с ×1</small></div><button type="button" class="cc-buy" data-cc-buy><span>${caramelSymbol(7)}</span><strong>ФЕСТИВАЛЬ<small>10 бесплатных вращений</small></strong><b>35×</b></button></aside></div>
  <div class="cc-results"><p data-cc-message>Нажми вращение, чтобы открыть ярмарку</p><div><span>ВЫИГРЫШ РАУНДА <strong data-cc-total data-units="0">0,00</strong></span><div class="cc-groups" data-cc-groups></div></div></div>
  <div class="cc-controls"><div class="cc-balance"><small>БАЛАНС</small><strong data-cc-balance>0,00</strong><span>Тестовый кошелёк клуба</span></div><div class="cc-last"><small>ПОСЛЕДНИЙ ВЫИГРЫШ</small><strong data-cc-last>0,00</strong></div><div class="cc-stake"><label for="cc-stake">СТАВКА</label><div><button type="button" data-cc-stake-step="-1" aria-label="Уменьшить ставку">−</button><select id="cc-stake" data-cc-stake aria-label="Ставка">${CARAMEL_BETS.map(n=>`<option value="${n}">${coins(n)}</option>`).join('')}</select><button type="button" data-cc-stake-step="1" aria-label="Увеличить ставку">+</button></div><small data-cc-cost>За ход: 1,00</small></div><button type="button" class="cc-spin" data-cc-spin aria-label="Вращать конфеты"><b>⟳</b><span data-cc-spin-label>ВРАЩАТЬ</span></button><div class="cc-auto-controls"><button type="button" data-cc-speed aria-pressed="false">ОБЫЧНО ×1</button><div><select data-cc-auto-count aria-label="Число платных автовращений"><option>10</option><option>25</option><option>50</option></select><button type="button" data-cc-auto aria-pressed="false">Авто</button></div></div><div class="cc-tools"><button type="button" data-cc-info aria-label="Правила игры">ⓘ</button><button type="button" data-cc-music aria-label="Выключить музыку">♫</button><button type="button" data-cc-sound aria-label="Выключить звук">♪</button><button type="button" data-cc-history aria-label="История игры">☷</button></div></div>
  <div class="cc-wallet-help" data-cc-wallet-help><span data-cc-wallet-note></span><a href="/" data-cc-login>Войти в клуб для тестовой игры</a><button type="button" data-cc-wallet>Открыть тестовый кошелёк</button></div><div class="cc-feedback" data-cc-feedback><p data-cc-status role="status"></p><p data-cc-error role="alert"></p><button type="button" data-cc-retry hidden>Проверить прежний ход</button></div>
  <footer class="cc-footer"><label>Громкость <input type="range" min="0" max="100" data-cc-volume aria-label="Громкость игры"></label><span>Собственная версия Royal · тестовый виртуальные USDT</span><button type="button" data-cc-refresh>Проверить состояние</button></footer><div class="cc-dialog-backdrop" data-cc-backdrop><div class="cc-dialog" data-cc-dialog role="dialog" aria-modal="true" aria-labelledby="cc-dialog-title"></div></div></section>`;}
 private bind(){
    this.dialogShell=new SlotDialog(this.find('[data-cc-dialog]'),this.find('[data-cc-backdrop]'),'data-cc-action',action=>void this.dialogAction(action),()=>this.closeDialog());
    this.stakeControls=new SlotStakeControls({
      values:CARAMEL_BETS,select:this.find<HTMLSelectElement>('[data-cc-stake]'),
      steps:Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cc-stake-step]')),
      direction:button=>Number(button.getAttribute('data-cc-stake-step')),current:()=>this.stake,
      locked:()=>this.blocked()||this.session()?.state==='active'||this.autoRemaining>0||!!this.dialog,
      changed:stake=>{this.stake=stake;this.controls();},
    });
    this.soundControls=new SlotAudioControls({
      sound:this.find<HTMLButtonElement>('[data-cc-sound]'),music:this.find<HTMLButtonElement>('[data-cc-music]'),
      volume:this.find<HTMLInputElement>('[data-cc-volume]'),audio:this.audio,entered:()=>this.entered,dynamicGlyph:false,
    });

  this.find<HTMLButtonElement>('[data-cc-load-retry]').onclick=()=>void this.assets.load();this.find<HTMLButtonElement>('[data-cc-spin]').onclick=()=>void this.play();
  this.find<HTMLButtonElement>('[data-cc-buy]').onclick=()=>{this.stopAuto();this.openDialog('buy');};this.find<HTMLButtonElement>('[data-cc-pause]').onclick=()=>{this.bonusRunning=false;this.playback.cancelScheduled();this.controls();};
  this.find<HTMLButtonElement>('[data-cc-speed]').onclick=()=>{this.fast=!this.fast;this.controls();};this.find<HTMLButtonElement>('[data-cc-auto]').onclick=()=>{if(this.autoRemaining){this.stopAuto();this.controls();}else if(!this.blocked()&&!this.dialog&&this.entered&&this.session()?.state!=='active'){this.autoRemaining=Number(this.find<HTMLSelectElement>('[data-cc-auto-count]').value);void this.request('normal');}};
  this.find<HTMLButtonElement>('[data-cc-info]').onclick=()=>{this.stopAuto();this.openDialog('info');};this.find<HTMLButtonElement>('[data-cc-history]').onclick=()=>{this.stopAuto();this.openDialog('history');};
  this.find<HTMLButtonElement>('[data-cc-retry]').onclick=()=>void this.retry();this.find<HTMLButtonElement>('[data-cc-refresh]').onclick=()=>void this.refresh();this.find<HTMLButtonElement>('[data-cc-wallet]').onclick=()=>{this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));};
  this.find('[data-cc-dialog]').onchange=e=>{if((e.target as HTMLElement).matches('[data-cc-reduce]')){this.manualReduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('royal-caramel-reduced',this.manualReduced?'1':'0');}catch{}this.cancel();this.sync();}};
 }
 private controls(){
  if(this.destroyed)return;const s=this.session(),active=s?.state==='active',blocked=this.blocked();if(active)this.stake=s.stakeUnits;
  this.root.dataset.reducedMotion=String(!this.motion());this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(s?.view.caramel.bonus?.remaining??0);this.root.setAttribute('aria-busy',String(!this.assets.ready||!!this.live||client.busy));
  this.find('[data-cc-balance]').textContent=coins((this.live?.balance??this.balance())*100);this.find('[data-cc-last]').textContent=coins(this.lastWin);
  this.find<HTMLButtonElement>('[data-cc-spin]').disabled=blocked||!this.entered||!!this.dialog;this.find('[data-cc-spin-label]').textContent=this.live?translateText('ВРАЩАЕТСЯ'):active?translateText('ПРОДОЛЖИТЬ'):translateText('ВРАЩАТЬ');
     this.stakeControls.update();
this.find('[data-cc-cost]').textContent=active?translateText('Продолжение бесплатно'):tr`За ход: ${coins(this.stake)}`;this.find<HTMLButtonElement>('[data-cc-buy]').disabled=blocked||active||!!this.dialog||this.autoRemaining>0||!this.entered;
     updateSlotTransport(this.root,'cc',{blocked,active,live:!!this.live,dialog:!!this.dialog,entered:this.entered,fast:this.fast,autoRemaining:this.autoRemaining,bonusRunning:this.bonusRunning,paidBonus:false,pending:!!client.pending,busy:client.busy,hidden:document.hidden,ready:this.assets.ready});
   this.find('[data-cc-error]').textContent=this.error||client.error;this.find('[data-cc-feedback]').dataset.error=String(!!(this.error||client.error));
this.find('[data-cc-status]').textContent=client.loading?translateText('Проверяем сохранённый фестиваль…'):this.live?'':client.pending?translateText('Ход сохранён. Подтверди прежнюю операцию.'):this.autoRemaining?tr`Платных вращений осталось: ${this.autoRemaining}`:active?this.bonusRunning?translateText('Фестиваль продолжается бесплатно.'):translateText('Фестиваль на паузе. Нажми «Продолжить».'):'';
  this.find('[data-cc-wallet-help]').hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);this.find('[data-cc-wallet-note]').textContent=client.accountId?translateText('Недостаточно USDT (Nile) для ставки.'):translateText('Для игры нужен общий баланс USDT.');this.find('[data-cc-login]').hidden=!!client.accountId;this.find('[data-cc-wallet]').hidden=!client.accountId;
   this.soundControls?.update();
  const enter=this.root.querySelector<HTMLButtonElement>('[data-cc-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ ФЕСТИВАЛЬ'):translateText('ОТКРЫТЬ ЯРМАРКУ');}
  const buy=this.root.querySelector<HTMLButtonElement>('[data-cc-action="buy"]');if(buy)buy.disabled=blocked||active||this.balance()<Number(this.stake)*35/100;
 }
 private sync(){
  if(this.destroyed)return;
  if(this.owner!==client.accountId){this.cancel();this.audio.pause();this.owner=client.accountId;this.entered=false;this.lastWin='0';this.stake='100';this.openDialog('intro');}
  const s=this.session();if(!this.live&&(!s||this.shown!==this.key(s))){
   this.board.clearOverlay();this.board.highlight([]);this.board.show(s?.view.caramel.spin?.finalGrid??preview);this.root.dataset.phase='idle';this.root.dataset.charging='false';
   if(s){this.shown=this.key(s);this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(s.view.caramel.revision);if(s.state==='settled')this.lastWin=s.returnedUnits;this.setTotal(s.view.caramel.totalPayoutUnits);this.features(s.view.caramel);this.find('[data-cc-message]').textContent=s.state==='active'?translateText('Фестиваль сохранён. Продолжение без ставки.'):translateText('Раунд завершён. Выплата уже в кошельке.');}
   else{this.shown='';this.setTotal('0');this.features();this.find('[data-cc-message]').textContent=translateText('Нажми вращение, чтобы открыть ярмарку');}
  }
  this.controls();observeExpansionOutcome(this.root,CARAMEL_GAME,s,client.accountId,!!this.live||client.busy,!!client.pending);
 }
 private setTotal(value:string|number){this.find('[data-cc-total]').textContent=coins(value);this.find('[data-cc-total]').dataset.units=String(value);}
 private factor(value:number){this.root.dataset.multiplier=String(value);this.find('[data-cc-factor]').textContent=this.find('[data-cc-top-factor]').textContent=`×${value}`;this.find('[data-cc-energy-fill]').style.width=`${value/50*100}%`;}
 private tickets(count:number,free:boolean){this.find('[data-cc-ticket-count]').textContent=`${count} / ${free?3:4}`;this.find('[data-cc-ticket-help]').textContent=free?translateText('3 билета = ещё 3 вращения'):translateText('4 билета = 10 бесплатных вращений');this.find('[data-cc-tickets]').querySelectorAll('span:not(.cc-symbol)').forEach((cell,i)=>cell.classList.toggle('cc-collected',i<count));}
 private features(view?:CaramelView){const bonus=view?.bonus,active=!!bonus?.remaining;this.factor(active?bonus.multiplier:view?.spin?.multiplierAfter??1);this.tickets(view?.spin?.tickets??0,view?.spin?.kind==='free'||view?.mode==='festival'&&!view.spin);this.find('[data-cc-phase-title]').textContent=active?tr`ФЕСТИВАЛЬ · ${bonus!.played} / ${bonus!.awarded}`:translateText('ОСНОВНАЯ ИГРА');this.find('[data-cc-free]').textContent=active?tr`${bonus!.remaining} бесплатных вращений`:translateText('Фестиваль ждёт');this.find('[data-cc-factor-note]').textContent=active?translateText('Сохраняется между бесплатными вращениями'):translateText('С новой ставки начинается с ×1');}
 private async play(){if(this.blocked()||!this.entered||this.dialog)return;this.bonusRunning=this.session()?.state==='active';await this.request('normal');}
 private async request(mode:'normal'|'festival'){
  if(this.blocked()||!this.entered||this.dialog)return;const previous=this.session(),active=previous?.state==='active',cost=active?0:Number(this.stake)*(mode==='festival'?35:1)/100;
  if(this.balance()<cost){this.error=translateText('Недостаточно USDT (Nile) для выбранной ставки.');this.stopAuto();this.controls();return;}
  void this.audio.enter();const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:this.motion(),fast:this.fast,before:previous};this.live=live;this.error='';this.root.dataset.animationToken=live.token;this.find('[data-cc-groups]').replaceChildren();this.board.highlight([]);observeExpansionOutcome(this.root,CARAMEL_GAME,previous,client.accountId,true,true);
  if(!active&&this.autoRemaining)this.autoRemaining--;
  if(active||mode==='normal'){this.root.dataset.phase='spinning';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);}else this.root.dataset.phase='preparing';this.controls();
  try{
   const action=this.sessions.operation(this.stake,mode,previous);
   const promise=client.act(action);live.operationId=client.pending?.id??'';await promise;if(!this.valid(live))return;
   const s=this.session();if(!this.sessions.confirmed(s,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
   await this.present(s,live);if(!this.valid(live))return;
   this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';this.shown=this.key(s);if(s.state==='settled')this.lastWin=s.returnedUnits;this.features(s.view.caramel);this.setTotal(s.view.caramel.totalPayoutUnits);this.controls();observeExpansionOutcome(this.root,CARAMEL_GAME,s,client.accountId,false,false);
   const v=s.view.caramel;if(s.state==='active'&&(!v.spin||v.spin.kind==='base')){this.stopAuto();this.openDialog('bonus');return;}
   if(s.state==='settled'&&v.history.some(spin=>spin.kind==='free')){this.bonusRunning=false;this.openDialog('complete');return;}
   if(s.state==='active'&&this.bonusRunning||s.state==='settled'&&this.autoRemaining>0)this.schedule();
  }catch(e){if(this.valid(live)){this.error=(e as Error).message;this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.shown='';this.sync();}}
  finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.audio.stopSpin();}}
 }
 private async present(s:Session,live:Live){
  const v=s.view.caramel,spin=v.spin;this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(v.revision);
  if(!spin){this.audio.stopSpin();this.features(v);return;}
  let total=Number(v.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);this.factor(spin.multiplierBefore);
  if(!await this.board.settle(live.token,spin.initialGrid)||!this.valid(live))return;this.audio.stopSpin();this.tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.valid(live))return;this.board.clearOverlay();this.board.show(frame.before);this.board.highlight(frame.wins.flatMap(w=>w.positions));
   if(!frame.wins.length)break;
   if(frame.energy){this.root.dataset.phase='energy';this.root.dataset.charging='true';this.find('[data-cc-message]').textContent=tr`Волчки добавляют +${frame.energy} к энергии`;this.audio.energy();if(live.motion&&!await this.delay(live.fast?220:550,live))return;this.factor(frame.multiplierAfter);this.root.dataset.charging='false';}
   this.root.dataset.phase='winning';this.find('[data-cc-message]').textContent=tr`КАСКАД ${frame.index+1} · МНОЖИТЕЛЬ ×${frame.multiplierAfter}`;this.find('[data-cc-groups]').innerHTML=frame.wins.map(w=>`<span>${caramelSymbol(w.symbol)}<b>${coins(w.payoutUnits)}</b></span>`).join('');total+=Number(frame.payoutUnits);this.setTotal(total);this.audio.cascade(frame.index);
   if(live.motion&&!await this.delay(live.fast?120:380,live))return;
   if(frame.removed.length){this.root.dataset.phase='bursting';this.board.remove(frame.removed);if(live.motion&&!await this.delay(live.fast?100:230,live))return;this.root.dataset.phase='falling';this.audio.drop();if(live.motion){this.board.gravity(frame,live.fast);if(!await this.delay(live.fast?260:560,live))return;}this.board.clearOverlay();this.board.show(frame.after);this.board.highlight([]);this.tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');}
  }
  if(!this.valid(live))return;this.board.clearOverlay();this.board.show(spin.finalGrid);this.board.highlight([]);this.features(v);this.setTotal(v.totalPayoutUnits);
  if(spin.freeAward){this.root.dataset.phase='tickets';this.find('[data-cc-message]').textContent=spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:translateText('ЧЕТЫРЕ БИЛЕТА · ФЕСТИВАЛЬ ОТКРЫТ');this.audio.tickets();if(live.motion&&!await this.delay(live.fast?250:850,live))return;}
  else this.find('[data-cc-message]').textContent=v.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('20 КАСКАДОВ · ВЫИГРЫШ СОХРАНЁН'):Number(spin.payoutUnits)>0?translateText('ВЫИГРЫШ ПРИНЯТ'):s.state==='active'?translateText('ФЕСТИВАЛЬ ПРОДОЛЖАЕТСЯ'):translateText('НОВЫЕ СЛАДОСТИ В СЛЕДУЮЩЕМ ВРАЩЕНИИ');
  this.audio.outcome(Number(spin.payoutUnits)>0);if(live.motion)await this.delay(live.fast?100:300,live);
 }
 private schedule(){this.playback.schedule(this.fast?140:500,()=>{if(!this.dialog&&!this.blocked()&&(this.bonusRunning||this.autoRemaining))void this.request('normal');});}
 private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();}catch(e){this.error=(e as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
 private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();if(!this.destroyed){this.shown='';this.sync();}}
 private ledger(session:Session){return renderSlotLedger('cc',session.spentUnits,session.state==='active'?session.view.caramel.totalPayoutUnits:session.returnedUnits,session.state==='active');}
 private openDialog(kind:Dialog){this.settings?.close();
  this.dialog=kind;this.dialogShell.begin(kind);if(!kind)return;
  const box=this.find('[data-cc-dialog]'),s=this.session(),v=s?.view.caramel;
  if(kind==='intro')box.innerHTML=tr`<small>КАЖДЫЙ КАСКАД ГОТОВИТ СЮРПРИЗ</small><h2 id="cc-dialog-title">CARAMEL <em>CARNIVAL</em></h2><div class="cc-intro-cards"><article><div>${caramelSymbol(0)}${caramelSymbol(1)}${caramelSymbol(2)}</div><h3>8+ В ЛЮБОМ МЕСТЕ</h3><p>Выигрышные конфеты исчезают. Новые падают сверху. До 20 каскадов.</p></article><article><div>${caramelSymbol(8)}<strong>×50</strong></div><h3>ЭНЕРГИЯ ВОЛЧКА</h3><p>Волчки на выигрышном каскаде повышают множитель до выплаты.</p></article><article><div>${caramelSymbol(7)}${caramelSymbol(7)}</div><h3>ЧЕТЫРЕ БИЛЕТА</h3><p>10 бесплатных вращений. В фестивале энергия сохраняется.</p></article></div><button type="button" class="cc-primary" data-cc-action="enter">ОТКРЫТЬ ЯРМАРКУ</button><p class="cc-dialog-note">Виртуальные USDT · вход без ставки</p>`;
  if(kind==='buy')box.innerHTML=tr`<small>СЛАДКИЙ ФЕСТИВАЛЬ</small><h2 id="cc-dialog-title">10 БЕСПЛАТНЫХ ВРАЩЕНИЙ</h2><div class="cc-bonus-art">${caramelSymbol(7)}<strong>10<small>ВРАЩЕНИЙ</small></strong>${caramelSymbol(8)}</div><p>Энергия начинается с ×1 и сохраняется между вращениями до ×50. Три билета на конечном поле добавляют ещё три вращения, всего до 30.</p><div class="cc-confirm"><span>Ставка: ${coins(this.stake)} · стоимость 35×</span><strong>${coins(Number(this.stake)*35)}</strong><small>Одна покупка с тестового кошелька. Выплата может быть ниже стоимости или равна нулю.</small></div><button type="button" class="cc-primary" data-cc-action="buy">НАЧАТЬ ЗА ${coins(Number(this.stake)*35)}</button><button type="button" class="cc-back" data-cc-action="close">Вернуться в игру</button>`;
  if(kind==='bonus')box.innerHTML=tr`<small>ФЕСТИВАЛЬ ОТКРЫТ</small><h2 id="cc-dialog-title">СЛАДКИЙ ФЕСТИВАЛЬ</h2><div class="cc-bonus-art">${caramelSymbol(7)}<strong>${v?.bonus?.remaining??10}<small>БЕСПЛАТНЫХ ВРАЩЕНИЙ</small></strong>${caramelSymbol(8)}</div><p>Множитель сохраняется между вращениями. Три билета добавляют ещё три вращения, до 30 в сумме.</p><button type="button" class="cc-primary" data-cc-action="bonus">НАЧАТЬ ФЕСТИВАЛЬ</button><p class="cc-dialog-note">Ставка принята. Продолжение бесплатно.</p>`;
    if(kind==='complete'&&s)box.innerHTML=renderSlotResult({style:'cc',eyebrow:translateText('ПРАЗДНИК ЗАВЕРШЁН'),title:translateText('ИТОГ ФЕСТИВАЛЯ'),returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата уже зачислена в кошелёк один раз.'),label:translateText('ПРОДОЛЖИТЬ')});
    if(kind==='history')box.innerHTML=renderSlotHistory({style:'cc',eyebrow:translateText('ЖУРНАЛ ЯРМАРКИ'),title:translateText('ИСТОРИЯ РАУНДА'),ledger:s?this.ledger(s):undefined,status:s?.state==='active'?translateText('Фестиваль сохранён. Выплата поступит после завершения.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появится подтверждённая история твоего раунда.'),rows:v?.history.map(spin=>({title:tr`${spin.kind==='base'?translateText('Основное'):translateText('Бесплатное')} вращение ${slotSpinNumber(spin,v!.history)}`,detail:tr`${spin.frames.filter(f=>f.wins.length).length} каскадов · ×${spin.multiplierAfter} · ${spin.tickets} билетов${spin.freeAward?tr` · +${spin.freeAward} вращений`:''}`,payoutUnits:spin.payoutUnits}))??[]});
    if(kind==='info')box.innerHTML=renderSlotInfo({style:'cc',eyebrow:translateText('ПРАВИЛА ЯРМАРКИ'),title:translateText('КАК ИГРАЕТ CARAMEL'),reduced:this.manualReduced,bodyHtml:tr`<h3>Совпадения в любом месте</h3><p>Поле 6×5. Восемь и более одинаковых конфет выигрывают независимо от расположения. Они исчезают, остальные падают вниз, свободные ячейки заполняются. До 20 выигрышных каскадов за вращение. Билет и волчок сами не оплачиваются.</p><h3>Энергия до ×50</h3><p>Волчки +2, +3, +5 и +10 на выигрышном поле добавляют энергию до выплаты этого каскада, затем исчезают вместе с выигрышными конфетами. Например, ×1 и +2 дают ×3. Без выигрышной группы волчки не срабатывают. Обычное вращение начинает с ×1, фестиваль сохраняет множитель между бесплатными вращениями.</p><h3>Билеты и фестиваль</h3><p>Считаются билеты на конечном поле, после каскадов. Четыре и более дают 10 бесплатных вращений. Фестиваль начинается с ×1. Внутри три и более билета добавляют три вращения, максимум 30 за весь фестиваль. Билеты не накапливаются между отдельными обычными ставками.</p><h3>Выплаты от общей ставки, до множителя</h3>${renderSlotPaytable('cc',CARAMEL_PAYTABLE.map((pay,i)=>({symbolHtml:caramelSymbol(i),name:CARAMEL_NAMES[i],values:pay.map(n=>`${(n/100).toLocaleString(locale)}×`)})),[translateText('Конфета'),'8-9','10-11','12+'])}<p>Покупка фестиваля стоит 35 ставок, списывается один раз. Максимальная выплата всего раунда вместе с бесплатными вращениями: 5 000 базовых ставок. При достижении предела оставшиеся каскады и вращения заканчиваются. Выплаты округляются вниз до 0,01 USDT.</p><p>Одна ставка и одна итоговая выплата. При обрыве связи подтверждается прежний UUID, новая ставка не нужна. Закрытие, скрытие окна и ошибка останавливают авто. Фестиваль можно продолжить из сохранённого состояния. Авто выполняет выбранные 10, 25 или 50 платных вращений и останавливается при входе в фестиваль.</p><p class="cc-dialog-note">Собственная версия Royal: свои иллюстрации, звуки и вероятности событий. Демонстрационная игра на тестовый виртуальные USDT.</p>`});
  this.controls();this.dialogShell.focus();
 }
 private closeDialog(){this.dialog='';this.controls();this.dialogShell.hide();}
 private async dialogAction(action:string){if(this.destroyed||!this.assets.ready)return;if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request('normal');}}else if(action==='buy'){if(this.blocked())return;this.closeDialog();await this.request('festival');}else if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request('normal');}else{this.closeDialog();if(action==='complete'&&this.autoRemaining)this.schedule();}}
 getAudioState(){return this.audio.state();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel();this.assets.destroy();this.board.destroy();this.audio.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
