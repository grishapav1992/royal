import {GAME_STAKE_UNITS as CONVOY_BETS} from '../shared/gameStakes';
import { t as translateText, tr, locale } from '../i18n/index';
import {SlotSettings} from './slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from './slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls, slotStakeStep, updateSlotTransport} from './slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable, renderSlotPaylines} from './slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from './slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from './slotKit/SlotSessions';
import {bindSlotLifecycle} from './slotKit/SlotLifecycle';
import {convoySlot} from './slotKit/nativeSlots';
import {CONVOY_GAME,CONVOY_PAYTABLE,CONVOY_NAMES,type ConvoyView,type ConvoySpin} from '../shared/lastConvoy';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {LastConvoyAssets,CONVOY_ASSETS,type ConvoyAssetState} from './LastConvoyAssets';
import {LastConvoyAudio} from './LastConvoyAudio';
import {ConvoyBoard} from './ConvoyBoard';
import {convoySymbol} from './ConvoyArtwork';
import './last-convoy.css';
import {ConvoyHeroine} from './ConvoyHeroine';
import {ConvoyProgressClient} from '../wallet/ConvoyProgressClient';

type Session=NativeSlotSession<'convoy'>;
type Dialog=''|'intro'|'info'|'history'|'bonus'|'bonus-help'|'looks'|'complete';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session};
const preview=Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%7);

/** Presentation consumes confirmed frames. Reopening and retries remain static. */
export class LastConvoyUI {
 private settings?:SlotSettings;
 private heroine:ConvoyHeroine;
 private progress=new ConvoyProgressClient();private progressSession='';private progressChanged=()=>{if(!this.destroyed){this.heroine.setBusy(!!this.live);this.heroine.setProgress(client.accountId,this.progress.profile,this.progress.error);}};
 private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private board:ConvoyBoard;private audio=new LastConvoyAudio();private assets:LastConvoyAssets;
 private owner=client.accountId;private destroyed=false;private entered=false;private stake = '10';private fast=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)');private manualReduced=false;
 private dialog:Dialog='intro';private shown='';private lastWin='0';private error='';private live?:Live;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(convoySlot);private autoRemaining=0;private bonusRunning=false;private unsubscribe=()=>{};
 private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChanged=()=>{this.cancel();this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog==='bonus-help'||this.dialog==='looks'?'info':this.dialog))return;
    if(event.code==='Space'&&this.entered&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();void this.play();}
  };
 constructor(private host:HTMLElement){
  try{this.manualReduced=localStorage.getItem('royal-convoy-reduced')==='1';}catch{}
  host.innerHTML=this.markup();this.root=host.querySelector('[data-convoy-game]')!;
  this.heroine=new ConvoyHeroine(this.root,()=>{if(this.dialog==='looks')this.renderLooks();});
  this.assets=new LastConvoyAssets(state=>this.assetState(state));
  this.board=new ConvoyBoard(this.find('[data-cc-board]'),{phase:value=>{if(this.live)this.root.dataset.phase=value;},stop:col=>{if(this.live)this.audio.stopReel(col);}});
  this.bind();this.settings=new SlotSettings(this.root,this.find('.cc-footer'),this.find('.cc-tools'),()=>{this.stopAuto();this.controls();});this.unsubscribe=bindSlotLifecycle({changed:this.change,visibility:this.visibility,keyboard:this.keyboard,motion:this.reduced,motionChanged:this.motionChanged,audioChanged:()=>this.controls()});
  this.progressSession=this.session()?.state==='settled'?this.session()!.id:'';this.progress.addEventListener('change',this.progressChanged);this.progress.setAccount(client.accountId);
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
 private assetState(state:ConvoyAssetState){
  if(this.destroyed)return;
  this.root.dataset.assetState=state.status;
  if(state.status==='ready'){this.root.style.setProperty('--cc-symbols',`url("${CONVOY_ASSETS.symbols}")`);this.root.style.setProperty('--cc-background',`url("${CONVOY_ASSETS.background}")`);this.heroine.ready();}
  this.find<HTMLProgressElement>('[data-cc-load-progress]').value=state.loaded;
  this.find('[data-cc-load-title]').textContent=state.status==='error'?translateText('НЕ УДАЛОСЬ ПОДГОТОВИТЬ КОНВОЙ'):translateText('ГОТОВИМ ЭВАКУАЦИЮ');
  this.find('[data-cc-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и повтори загрузку. Монеты не списываются.'):tr`Изображения: ${state.loaded} из ${state.total}`;
  this.find<HTMLButtonElement>('[data-cc-load-retry]').hidden=state.status!=='error';this.controls();
 }
 private markup(){return tr`<section class="cc-game cv-game" data-convoy-game data-studio-game="${CONVOY_GAME}" data-asset-state="loading" data-phase="idle" aria-label="Последний конвой">
  <div class="cc-loader" role="status"><span class="cc-loader-spark">✦</span><strong data-cc-load-title>ГОТОВИМ ЭВАКУАЦИЮ</strong><p data-cc-load-note>Изображения: 0 из 3</p><progress data-cc-load-progress max="3" value="0" aria-label="Загрузка оформления"></progress><button type="button" data-cc-load-retry hidden>Повторить загрузку</button></div>
  <header class="cc-heading"><div><small>ROYAL ORIGINAL · ТЕСТОВЫЕ МОНЕТЫ</small><h2>LAST <em>CONVOY</em></h2><span>ПОСЛЕДНИЙ КОНВОЙ</span></div><p>КАСКАДЫ · БАРРИКАДЫ · ЭВАКУАЦИЯ</p></header>
  <div class="cc-scene"><aside class="cc-tickets cv-survivor"><div class="cv-portrait"><div class="cv-hero-body"><img data-cv-heroine alt="Майя, выживальщица с рацией" width="1024" height="1536"><canvas data-cv-frames width="512" height="768" aria-hidden="true"></canvas></div></div><div class="cc-ticket-slots" data-cc-tickets>${Array.from({length:3},()=>`<span>${convoySymbol(7)}</span>`).join('')}</div><strong data-cc-ticket-count>0 / 3</strong><p data-cc-ticket-help>3 / 4 / 5+ маяков: 10 / 12 / 15 вращений</p><div class="cc-series"><strong data-cc-free>Ждём сигнал</strong><div><button type="button" data-cc-pause disabled>На паузе</button></div></div></aside>
  <div class="cc-stage"><div class="cc-stage-heading"><span data-cc-phase-title>ОСНОВНАЯ ИГРА</span><b>8+ В ЛЮБОМ МЕСТЕ</b></div><div class="cc-awning"></div><div class="cc-board-frame"><div class="cc-board" data-cc-board role="group" aria-label="Шесть барабанов, пять рядов припасов"></div></div><div class="cc-board-foot"></div></div>
  <aside class="cc-energy"><div class="cc-top" aria-hidden="true">${convoySymbol(8)}<strong data-cc-top-factor>×1</strong></div><div class="cc-factor-card"><h3>ЗАЩИТА КОНВОЯ</h3><strong data-cc-factor>×1</strong><div class="cc-energy-meter"><i data-cc-energy-fill></i></div><small data-cc-factor-note>Каждая баррикада: +1, максимум ×7</small></div><button type="button" class="cc-buy" data-cc-buy aria-label="Как открыть бонус эвакуации"><span>${convoySymbol(7)}</span><strong>БОНУС ЗА МАЯКИ<small>Как открыть эвакуацию?</small></strong></button></aside></div>
  <div class="cc-results"><p data-cc-message>Нажми вращение, чтобы собрать припасы</p><div><span>ВЫИГРЫШ РАУНДА <strong data-cc-total data-units="0">0,00</strong></span><div class="cc-groups" data-cc-groups></div></div></div>
  <div class="cc-controls"><div class="cc-balance"><small>БАЛАНС</small><strong data-cc-balance>0,00</strong><span>Тестовый кошелёк клуба</span></div><div class="cc-last"><small>ПОСЛЕДНИЙ ВЫИГРЫШ</small><strong data-cc-last>0,00</strong></div><div class="cc-stake"><label for="cc-stake">СТАВКА</label><div><button type="button" data-cc-stake-step="-1" aria-label="Уменьшить ставку">−</button><select id="cc-stake" data-cc-stake aria-label="Ставка">${CONVOY_BETS.map(n=>`<option value="${n}">${coins(n)}</option>`).join('')}</select><button type="button" data-cc-stake-step="1" aria-label="Увеличить ставку">+</button></div><small data-cc-cost>За ход: 1,00</small></div><button type="button" class="cc-spin" data-cc-spin aria-label="Вращать припасы"><b>⟳</b><span data-cc-spin-label>ВРАЩАТЬ</span></button><div class="cc-auto-controls"><button type="button" data-cc-speed aria-pressed="false">ОБЫЧНО ×1</button><div><select data-cc-auto-count aria-label="Число платных автовращений"><option>10</option><option>25</option><option>50</option></select><button type="button" data-cc-auto aria-pressed="false">Авто</button></div></div><div class="cc-tools"><button type="button" data-cc-info aria-label="Правила игры">ⓘ</button><button type="button" data-cc-music aria-label="Выключить музыку">♫</button><button type="button" data-cc-sound aria-label="Выключить звук">♪</button><button type="button" data-cc-history aria-label="История игры">☷</button></div></div>
  <div class="cc-wallet-help" data-cc-wallet-help><span data-cc-wallet-note></span><a href="/" data-cc-login>Войти в клуб для тестовой игры</a><button type="button" data-cc-wallet>Открыть тестовый кошелёк</button></div><div class="cc-feedback" data-cc-feedback><p data-cc-status role="status"></p><p data-cc-error role="alert"></p><button type="button" data-cc-retry hidden>Проверить прежний ход</button></div>
  <footer class="cc-footer"><button type="button" data-cv-looks aria-label="Выбрать образ Майи">Образы Майи</button><label>Громкость <input type="range" min="0" max="100" data-cc-volume aria-label="Громкость игры"></label><details class="cv-display-settings"><summary>Настройки анимации</summary><label class="cv-motion-setting"><input type="checkbox" data-cv-reduce aria-describedby="cv-motion-description"> Упростить анимации</label><p id="cv-motion-description">Отключает вращение и мерцание. Результат показывается сразу.</p></details><span>Собственная версия Royal · тестовый виртуальные USDT</span><button type="button" data-cc-refresh>Проверить состояние</button></footer><div class="cc-dialog-backdrop" data-cc-backdrop><div class="cc-dialog" data-cc-dialog role="dialog" aria-modal="true" aria-labelledby="cc-dialog-title"></div></div></section>`;}
 private bind(){
    this.dialogShell=new SlotDialog(this.find('[data-cc-dialog]'),this.find('[data-cc-backdrop]'),'data-cc-action',action=>void this.dialogAction(action),()=>this.closeDialog());
    this.stakeControls=new SlotStakeControls({
      values:CONVOY_BETS,select:this.find<HTMLSelectElement>('[data-cc-stake]'),
      steps:Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cc-stake-step]')),
      direction:button=>Number(button.getAttribute('data-cc-stake-step')),current:()=>this.stake,
      locked:()=>this.blocked()||this.session()?.state==='active'||this.autoRemaining>0||!!this.dialog,
      changed:stake=>{this.stake=stake;this.controls();},
    });
    this.soundControls=new SlotAudioControls({
      sound:this.find<HTMLButtonElement>('[data-cc-sound]'),music:this.find<HTMLButtonElement>('[data-cc-music]'),
      volume:this.find<HTMLInputElement>('[data-cc-volume]'),audio:this.audio,entered:()=>this.entered,dynamicGlyph:false,
    });

  this.find<HTMLButtonElement>('[data-cv-looks]').onclick=()=>{this.stopAuto();this.bonusRunning=false;this.openDialog('looks');};
  this.find<HTMLButtonElement>('[data-cc-load-retry]').onclick=()=>void this.assets.load();this.find<HTMLButtonElement>('[data-cc-spin]').onclick=()=>void this.play();
  this.find<HTMLButtonElement>('[data-cc-buy]').onclick=()=>{this.stopAuto();this.openDialog('bonus-help');};this.find<HTMLButtonElement>('[data-cc-pause]').onclick=()=>{this.bonusRunning=false;this.playback.cancelScheduled();this.controls();};
  this.find<HTMLButtonElement>('[data-cc-speed]').onclick=()=>{this.fast=!this.fast;this.controls();};this.find<HTMLButtonElement>('[data-cc-auto]').onclick=()=>{if(this.autoRemaining){this.stopAuto();this.controls();}else if(!this.blocked()&&!this.dialog&&this.entered&&this.session()?.state!=='active'){this.autoRemaining=Number(this.find<HTMLSelectElement>('[data-cc-auto-count]').value);void this.request('normal');}};
  this.find<HTMLButtonElement>('[data-cc-info]').onclick=()=>{this.stopAuto();this.openDialog('info');};this.find<HTMLButtonElement>('[data-cc-history]').onclick=()=>{this.stopAuto();this.openDialog('history');};
  this.find<HTMLButtonElement>('[data-cc-retry]').onclick=()=>void this.retry();this.find<HTMLButtonElement>('[data-cc-refresh]').onclick=()=>void this.refresh();this.find<HTMLButtonElement>('[data-cc-wallet]').onclick=()=>{this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));};
  this.find<HTMLInputElement>('[data-cv-reduce]').onchange=e=>{this.manualReduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('royal-convoy-reduced',this.manualReduced?'1':'0');}catch{}this.cancel();this.sync();};
 }
 private controls(){
  if(this.destroyed)return;this.heroine.setBusy(!!this.live);this.heroine.setProgress(client.accountId,this.progress.profile,this.progress.error);this.heroine.pause(!!this.dialog);this.find<HTMLButtonElement>('[data-cv-looks]').disabled=!!this.live||client.busy||!!this.dialog||!this.assets.ready;const s=this.session(),active=s?.state==='active',blocked=this.blocked();if(active)this.stake=s.stakeUnits;
  this.find<HTMLInputElement>('[data-cv-reduce]').checked=this.manualReduced;this.find<HTMLInputElement>('[data-cv-reduce]').disabled=!!this.live||client.busy||!!client.pending;this.root.dataset.reducedMotion=String(!this.motion());this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(s?.view.convoy.bonus?.remaining??0);this.root.setAttribute('aria-busy',String(!this.assets.ready||!!this.live||client.busy));
  this.find('[data-cc-balance]').textContent=coins((this.live?.balance??this.balance())*100);this.find('[data-cc-last]').textContent=coins(this.lastWin);
  this.find<HTMLButtonElement>('[data-cc-spin]').disabled=blocked||!this.entered||!!this.dialog;this.find('[data-cc-spin-label]').textContent=this.live?translateText('ВРАЩАЕТСЯ'):active?translateText('ПРОДОЛЖИТЬ'):translateText('ВРАЩАТЬ');
     this.stakeControls.update();
this.find('[data-cc-cost]').textContent=active?translateText('Продолжение бесплатно'):tr`За ход: ${coins(this.stake)}`;this.find<HTMLButtonElement>('[data-cc-buy]').disabled=!!this.live||client.busy||client.loading||!!this.dialog||!this.assets.ready;
     updateSlotTransport(this.root,'cc',{blocked,active,live:!!this.live,dialog:!!this.dialog,entered:this.entered,fast:this.fast,autoRemaining:this.autoRemaining,bonusRunning:this.bonusRunning,paidBonus:false,pending:!!client.pending,busy:client.busy,hidden:document.hidden,ready:this.assets.ready});
   this.find('[data-cc-error]').textContent=this.error||client.error;this.find('[data-cc-feedback]').dataset.error=String(!!(this.error||client.error));
this.find('[data-cc-status]').textContent=client.loading?translateText('Проверяем сохранённую эвакуацию…'):this.live?'':client.pending?translateText('Ход сохранён. Подтверди прежнюю операцию.'):this.autoRemaining?tr`Платных вращений осталось: ${this.autoRemaining}`:active?this.bonusRunning?translateText('Эвакуация продолжается бесплатно.'):translateText('Эвакуация на паузе. Нажми «Продолжить».'):'';
  this.find('[data-cc-wallet-help]').hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);this.find('[data-cc-wallet-note]').textContent=client.accountId?translateText('Недостаточно USDT · Демо для ставки.'):translateText('Для игры нужен общий баланс USDT.');this.find('[data-cc-login]').hidden=!!client.accountId;this.find('[data-cc-wallet]').hidden=!client.accountId;
   this.soundControls?.update();
  const enter=this.root.querySelector<HTMLButtonElement>('[data-cc-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ ЭВАКУАЦИЮ'):translateText('НАЧАТЬ ВЫЛАЗКУ');}
 }
 private sync(){
  if(this.destroyed)return;
  if(this.owner!==client.accountId){this.cancel();this.audio.pause();this.owner=client.accountId;this.progressSession=this.session()?.state==='settled'?this.session()!.id:'';this.progress.setAccount(client.accountId);this.entered=false;this.lastWin='0';this.stake = '10';this.openDialog('intro');}
  const s=this.session();if(!this.live&&(!s||this.shown!==this.key(s))){
   this.board.clearOverlay();this.board.highlight([]);this.board.show(s?.view.convoy.spin?.finalGrid??preview);this.root.dataset.phase='idle';this.root.dataset.charging='false';
   if(s){this.shown=this.key(s);this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(s.view.convoy.revision);if(s.state==='settled')this.lastWin=s.returnedUnits;this.setTotal(s.view.convoy.totalPayoutUnits);this.features(s.view.convoy);this.find('[data-cc-message]').textContent=s.state==='active'?translateText('Эвакуация сохранена. Продолжение без ставки.'):translateText('Раунд завершён. Выплата уже в кошельке.');}
   else{this.shown='';this.setTotal('0');this.features();this.find('[data-cc-message]').textContent=translateText('Нажми вращение, чтобы собрать припасы');}
  }
  if(s?.state==='settled'&&s.id!==this.progressSession){this.progressSession=s.id;if(!this.progress.profile||this.progress.profile.completedRounds<200)void this.progress.refresh();}
  this.controls();observeExpansionOutcome(this.root,CONVOY_GAME,s,client.accountId,!!this.live||client.busy,!!client.pending);
 }
 private setTotal(value:string|number){this.find('[data-cc-total]').textContent=coins(value);this.find('[data-cc-total]').dataset.units=String(value);}
 private factor(value:number){this.root.dataset.multiplier=String(value);this.find('[data-cc-factor]').textContent=this.find('[data-cc-top-factor]').textContent=`×${value}`;this.find('[data-cc-energy-fill]').style.width=`${value/7*100}%`;}
 private tickets(count:number,free:boolean){this.find('[data-cc-ticket-count]').textContent=`${count} / 3`;this.find('[data-cc-ticket-help]').textContent=free?translateText('3 маяка: +2 вращения, до 20 всего'):translateText('3 / 4 / 5+ маяков: 10 / 12 / 15 вращений');this.find('[data-cc-tickets]').querySelectorAll('span:not(.cc-symbol)').forEach((cell,i)=>cell.classList.toggle('cc-collected',i<count));}
 private features(view?:ConvoyView){const bonus=view?.bonus,active=!!bonus?.remaining;this.factor(active?bonus.multiplier:view?.spin?.multiplierAfter??1);this.tickets(view?.spin?.beacons??0,view?.spin?.kind==='free');this.find('[data-cc-phase-title]').textContent=active?tr`ЭВАКУАЦИЯ · ${bonus!.played} / ${bonus!.awarded}`:translateText('ОСНОВНАЯ ИГРА');this.find('[data-cc-free]').textContent=active?tr`${bonus!.remaining} бесплатных вращений`:translateText('Ждём сигнал');this.find('[data-cc-factor-note]').textContent=active?translateText('Баррикады сохраняются между вращениями'):translateText('Каждая баррикада: +1, максимум ×7');this.root.dataset.bonus=String(active);}
 private async play(){if(this.blocked()||!this.entered||this.dialog)return;this.bonusRunning=this.session()?.state==='active';await this.request('normal');}
 private async request(mode:'normal'){
  if(this.blocked()||!this.entered||this.dialog)return;const previous=this.session(),active=previous?.state==='active',cost=active?0:Number(this.stake)/100;
  if(this.balance()<cost){this.error=translateText('Недостаточно USDT · Демо для выбранной ставки.');this.stopAuto();this.controls();return;}
  void this.audio.enter();const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:this.motion(),fast:this.fast,before:previous};this.live=live;this.error='';this.root.dataset.animationToken=live.token;this.find('[data-cc-groups]').replaceChildren();this.board.highlight([]);observeExpansionOutcome(this.root,CONVOY_GAME,previous,client.accountId,true,true);
  if(!active&&this.autoRemaining)this.autoRemaining--;
  {this.root.dataset.phase='spinning';this.board.setPins(active?previous!.view.convoy.bonus?.pins??[]:[]);this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);}this.controls();
  try{
   const action=this.sessions.operation(this.stake,mode,previous);
   const promise=client.act(action);live.operationId=client.pending?.id??'';await promise;if(!this.valid(live))return;
   const s=this.session();if(!this.sessions.confirmed(s,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
   await this.present(s,live);if(!this.valid(live))return;
   this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';this.shown=this.key(s);if(s.state==='settled')this.lastWin=s.returnedUnits;this.features(s.view.convoy);this.setTotal(s.view.convoy.totalPayoutUnits);this.controls();observeExpansionOutcome(this.root,CONVOY_GAME,s,client.accountId,false,false);
   const v=s.view.convoy;if(s.state==='active'&&(!v.spin||v.spin.kind==='base')){this.stopAuto();this.openDialog('bonus');return;}
   if(s.state==='settled'&&v.history.some(spin=>spin.kind==='free')){this.bonusRunning=false;this.openDialog('complete');return;}
   if(s.state==='active'&&this.bonusRunning||s.state==='settled'&&this.autoRemaining>0)this.schedule();
  }catch(e){if(this.valid(live)){this.error=(e as Error).message;this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.shown='';this.sync();}}
  finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.audio.stopSpin();}}
 }
 private async present(s:Session,live:Live){
  const v=s.view.convoy,spin=v.spin;this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(v.revision);
  if(!spin){this.audio.stopSpin();this.features(v);return;}
  let total=Number(v.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);this.factor(spin.multiplierBefore);
  if(!await this.board.settle(live.token,spin.initialGrid)||!this.valid(live))return;this.audio.stopSpin();this.tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.valid(live))return;this.board.clearOverlay();this.board.show(frame.before);this.board.highlight(frame.wins.flatMap(w=>w.positions));
   if(frame.addedPins.length){this.root.dataset.phase='energy';this.root.dataset.charging='true';this.find('[data-cc-message]').textContent=tr`Баррикады добавляют +${frame.addedPins.length} к защите`;this.audio.feature('barricade');if(live.motion&&!await this.delay(live.fast?220:550,live))return;this.factor(frame.multiplierAfter);this.root.dataset.charging='false';}
   if(!frame.wins.length)break;
   this.root.dataset.phase='winning';this.find('[data-cc-message]').textContent=tr`КАСКАД ${frame.index+1} · МНОЖИТЕЛЬ ×${frame.multiplierAfter}`;this.find('[data-cc-groups]').innerHTML=frame.wins.map(w=>`<span>${convoySymbol(w.symbol)}<b>${coins(w.payoutUnits)}</b></span>`).join('');total+=Number(frame.payoutUnits);this.setTotal(total);this.audio.cascade(frame.index);
   if(live.motion&&!await this.delay(live.fast?120:380,live))return;
   if(frame.removed.length){this.root.dataset.phase='bursting';this.board.remove(frame.removed);if(live.motion&&!await this.delay(live.fast?100:230,live))return;this.root.dataset.phase='falling';this.audio.drop();if(live.motion){this.board.gravity(frame,live.fast);if(!await this.delay(live.fast?260:560,live))return;}this.board.clearOverlay();this.board.show(frame.after);this.board.highlight([]);this.tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');}
  }
  if(!this.valid(live))return;this.board.clearOverlay();this.board.show(spin.finalGrid);this.board.highlight([]);this.features(v);this.setTotal(v.totalPayoutUnits);
  if(spin.freeAward){this.root.dataset.phase='tickets';this.find('[data-cc-message]').textContent=spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:translateText('СИГНАЛ ПРИНЯТ · КОНВОЙ В ПУТИ');this.audio.tickets();if(live.motion&&!await this.delay(live.fast?250:850,live))return;}
  else this.find('[data-cc-message]').textContent=v.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('20 КАСКАДОВ · ВЫИГРЫШ СОХРАНЁН'):Number(spin.payoutUnits)>0?translateText('ВЫИГРЫШ ПРИНЯТ'):s.state==='active'?translateText('ЭВАКУАЦИЯ ПРОДОЛЖАЕТСЯ'):translateText('ПРОДОЛЖАЕМ ПОИСК ПРИПАСОВ');
  this.audio.outcome(Number(spin.payoutUnits)>0);if(live.motion)await this.delay(live.fast?100:300,live);
 }
 private schedule(){this.playback.schedule(this.fast?140:500,()=>{if(!this.dialog&&!this.blocked()&&(this.bonusRunning||this.autoRemaining))void this.request('normal');});}
 private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();void this.progress.refresh();}catch(e){this.error=(e as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
 private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();void this.progress.refresh();if(!this.destroyed){this.shown='';this.sync();}}
 private ledger(session:Session){return renderSlotLedger('cc',session.spentUnits,session.state==='active'?session.view.convoy.totalPayoutUnits:session.returnedUnits,session.state==='active');}
 private openDialog(kind:Dialog){this.settings?.close();
  this.dialog=kind;this.dialogShell.begin(kind==='bonus-help'||kind==='looks'?'info':kind);if(!kind)return;
  const box=this.find('[data-cc-dialog]'),s=this.session(),v=s?.view.convoy;
  if(kind==='looks')this.renderLooks();
  if(kind==='intro')box.innerHTML=tr`<small>ДОЖИТЬ ДО РАССВЕТА</small><h2 id="cc-dialog-title">ПОСЛЕДНИЙ <em>КОНВОЙ</em></h2><div class="cv-intro-hero"><img src="${CONVOY_ASSETS.heroine}" alt="Майя, позывной Искра"><p>«Собирай припасы. Я вызову конвой».<br><small>Майя · выживальщица, связист</small></p></div><div class="cc-intro-cards"><article><div>${convoySymbol(0)}${convoySymbol(4)}</div><h3>8+ ПРИПАСОВ</h3><p>Совпадения в любом месте. После выигрыша припасы падают каскадом.</p></article><article><div>${convoySymbol(8)}<strong>×7</strong></div><h3>БАРРИКАДЫ</h3><p>Закрепляются и усиливают выплаты. В эвакуации остаются между вращениями.</p></article><article><div>${convoySymbol(7)}</div><h3>МАЯКИ СПАСЕНИЯ</h3><p>3 / 4 / 5+ маяков открывают 10 / 12 / 15 бесплатных вращений.</p></article></div><button type="button" class="cc-primary" data-cc-action="enter">ПРИСОЕДИНИТЬСЯ К МАЙЕ</button><p class="cc-dialog-note">Тестовый кошелёк клуба · вход без ставки</p>`;
  if(kind==='bonus-help')box.innerHTML=tr`<small>БЕСПЛАТНЫЙ БОНУС</small><h2 id="cc-dialog-title">КАК ОТКРЫТЬ ЭВАКУАЦИЮ</h2><div class="cv-bonus-help"><p>Собери маяки на конечном поле одного вращения, после всех каскадов. Бонус включится автоматически.</p><div class="cv-bonus-awards">${[[3,10],[4,12],[5,15]].map(([beacons,spins])=>tr`<div>${convoySymbol(7)}<strong>${beacons===5?translateText('5+ маяков'):tr`${beacons} маяка`}</strong><span>${spins} бесплатных вращений</span></div>`).join('')}</div><p>Во время эвакуации баррикады сохраняются и усиливают выплаты до ×7. Выпадение 3 и более маяков добавляет 2 вращения, до 20 за раунд.</p><p>Маяки между разными вращениями не накапливаются. Дополнительная ставка для запуска бонуса не нужна.</p></div><button type="button" class="cc-primary" data-cc-action="close">ПОНЯТНО</button>`;
  if(kind==='bonus')box.innerHTML=tr`<small>СИГНАЛ ПРИНЯТ</small><h2 id="cc-dialog-title">КОНВОЙ В ПУТИ</h2><div class="cc-bonus-art">${convoySymbol(7)}<strong>${v?.bonus?.remaining??10}<small>БЕСПЛАТНЫХ ВРАЩЕНИЙ</small></strong>${convoySymbol(8)}</div><p>Баррикады эвакуации начинают с нуля, затем сохраняют свои клетки между бесплатными вращениями. До шести баррикад, множитель до ×7. Три маяка добавляют ещё два вращения, до 20 всего.</p><button type="button" class="cc-primary" data-cc-action="bonus">НАЧАТЬ ЭВАКУАЦИЮ</button><p class="cc-dialog-note">Ставка уже принята. Продолжение бесплатно.</p>`;
  if(kind==='complete'&&s)box.innerHTML=renderSlotResult({style:'cc',eyebrow:translateText('МЫ ДОБРАЛИСЬ'),title:translateText('КОНВОЙ ПРИБЫЛ'),returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата зачислена в тестовый кошелёк один раз.'),label:translateText('ПРОДОЛЖИТЬ')});
  if(kind==='history')box.innerHTML=renderSlotHistory({style:'cc',eyebrow:translateText('РАДИОЖУРНАЛ'),title:translateText('ИСТОРИЯ КОНВОЯ'),ledger:s?this.ledger(s):undefined,status:s?.state==='active'?translateText('Эвакуация сохранена. Выплата поступит после завершения.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появятся подтверждённые результаты.'),rows:v?.history.map(spin=>({title:tr`${spin.kind==='base'?translateText('Основное'):translateText('Бесплатное')} вращение ${slotSpinNumber(spin,v!.history)}`,detail:tr`${spin.frames.filter(f=>f.wins.length).length} каскадов · ×${spin.multiplierAfter} · ${spin.beacons} маяков · ${spin.pinsAfter.length} баррикад${spin.freeAward?tr` · +${spin.freeAward} вращений`:''}`,payoutUnits:spin.payoutUnits}))??[]});
  if(kind==='info')box.innerHTML=renderSlotInfo({style:'cc',eyebrow:translateText('ПЛАН ВЫЖИВАНИЯ'),title:translateText('КАК ИГРАЕТ КОНВОЙ'),reduced:this.manualReduced,motionSetting:false,bodyHtml:tr`<h3>Припасы и каскады</h3><p>Поле 6×5. Восемь и более одинаковых обычных символов в любом месте дают выплату. Выигравшие символы исчезают, остальные падают в свободные клетки. До 20 выигрышных каскадов за вращение. На последнем каскаде поле остаётся на месте.</p><h3>Закреплённые баррикады</h3><p>Баррикада не заменяет символы и сама не оплачивается. Она закрепляется в своей клетке, увеличивая общий множитель на 1 до выплаты текущего каскада. До шести баррикад, общий множитель от ×1 до ×7. В обычном вращении новые баррикады собираются заново. В эвакуации они остаются на всех последующих вращениях. При входе в эвакуацию баррикады обычного вращения сбрасываются.</p><h3>Эвакуация</h3><p>На конечном поле после каскадов 3 / 4 / 5 и более маяков дают 10 / 12 / 15 бесплатных вращений. Внутри эвакуации 3 и более маяков добавляют ещё 2 вращения, максимум 20 за раунд. Маяки между разными вращениями не накапливаются. Покупки бонуса нет.</p><h3>Выплаты от общей ставки, до множителя</h3>${renderSlotPaytable('cc',CONVOY_PAYTABLE.map((pay,i)=>({symbolHtml:convoySymbol(i),name:CONVOY_NAMES[i],values:pay.map(n=>`${(n/100).toLocaleString(locale)}×`)})),[translateText('Припасы'),'8-9','10-11','12+'])}<p>Общий выигрыш ограничен 5000 базовых ставок. При достижении предела раунд заканчивается. Все ставки кратны 1 USDT, выплаты точны до 0,01 USDT.</p><p>Одна ставка и одна итоговая выплата. При потере ответа проверяется прежняя операция. Закрытие игры и скрытие окна останавливают авто. Сохранённую эвакуацию можно продолжить бесплатно. Платное авто останавливается при входе в бонус.</p><p>Оценка долгосрочного возврата: около 95,7% от всех ставок. Это среднее на длинной серии, а не обещание результата отдельного раунда.</p><p class="cc-dialog-note">Оригинальная игра Royal: свои иллюстрации, звуки и вероятности. Только тестовый виртуальные USDT.</p>`});
  this.controls();this.dialogShell.focus();
 }
 private renderLooks(){const box=this.find('[data-cc-dialog]');const focused=box.contains(document.activeElement)?(document.activeElement as HTMLElement).getAttribute('data-cc-action'):null;box.innerHTML=this.heroine.gallery();if(focused)box.querySelectorAll<HTMLButtonElement>('[data-cc-action]').forEach(button=>{if(button.getAttribute('data-cc-action')===focused&&!button.disabled)button.focus();});}
 private closeDialog(){this.dialog='';this.controls();this.dialogShell.hide();}
 private async dialogAction(action:string){if(this.destroyed||!this.assets.ready)return;if(action.startsWith('look:')){await this.heroine.select(action.slice(5));if(!this.destroyed&&this.dialog==='looks')this.find('[data-cc-dialog]').querySelectorAll<HTMLButtonElement>('[data-cc-action]').forEach(button=>{if(button.getAttribute('data-cc-action')===action&&!button.disabled)button.focus();});return;}if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request('normal');}}else if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request('normal');}else{this.closeDialog();if(action==='complete'&&this.autoRemaining)this.schedule();}}
 getAudioState(){return this.audio.state();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel();this.progress.removeEventListener('change',this.progressChanged);this.progress.destroy();this.heroine.destroy();this.assets.destroy();this.board.destroy();this.audio.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
