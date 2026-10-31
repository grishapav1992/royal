import {GAME_STAKE_UNITS as NITRO_BETS} from '../shared/gameStakes';
import { t as translateText, tr, locale } from '../i18n/index';
import {SlotSettings} from './slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from './slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls, slotStakeStep, updateSlotTransport} from './slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable} from './slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from './slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from './slotKit/SlotSessions';
import {bindSlotLifecycle} from './slotKit/SlotLifecycle';
import {memeSlot} from './slotKit/nativeSlots';
import {MEME_GAME,MEME_BETS,MEME_PAYTABLE,MEME_NAMES,MEME_RULES,MEME_LINES} from '../shared/memeOverload';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {MemeAssets,MEME_ASSETS,type MemeAssetState} from './MemeAssets';
import {MemeAudio} from './MemeAudio';
import {gameAudio} from '../game/GameAudio';
import {MEME_CLIPS,MEME_CLIP_LABELS,type MemeClip} from './MemeReactions';
import {MemeBoard} from './MemeBoard';
import {memeSymbol} from './MemeArtwork';
import './caramel-carnival.css';
import './meme-overload.css';

import type {NitroView} from '../shared/nitroRun';

type Session=NativeSlotSession<'nitro'>;
type Dialog=''|'intro'|'info'|'history'|'bonus'|'complete'|'bigwin';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session};
const preview=Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%6);

/** Presentation consumes confirmed frames. Reopening and retries remain static. */
export class MemeOverloadUI {
 private settings?:SlotSettings;private unwatchReactions=()=>{};
 private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private board:MemeBoard;private audio=new MemeAudio();private assets:MemeAssets;
 private owner=client.accountId;private destroyed=false;private entered=false;private stake = '10';private fast=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)');private manualReduced=false;
 private dialog:Dialog='intro';private shown='';private lastWin='0';private error='';private live?:Live;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(memeSlot);private autoRemaining=0;private bonusRunning=false;private unsubscribe=()=>{};
 private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChanged=()=>{this.cancel();this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog==='bigwin'?'complete':this.dialog))return;
    if(event.code==='Space'&&this.entered&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();void this.play();}
  };
 constructor(private host:HTMLElement){
  try{this.manualReduced=localStorage.getItem('royal-meme-reduced')==='1';}catch{}
  host.innerHTML=this.markup();this.root=host.querySelector('[data-meme-game]')!;
  this.assets=new MemeAssets(state=>this.assetState(state));
  this.board=new MemeBoard(this.find('[data-cc-board]'),{phase:value=>{if(this.live)this.root.dataset.phase=value;},stop:col=>{if(this.live)this.audio.stopReel(col);}});
  this.bind();this.settings=new SlotSettings(this.root,this.find('.cc-footer'),this.find('.cc-tools'),()=>{this.stopAuto();this.controls();});this.unsubscribe=bindSlotLifecycle({changed:this.change,visibility:this.visibility,keyboard:this.keyboard,motion:this.reduced,motionChanged:this.motionChanged,audioChanged:()=>this.controls()});
  this.installReactionSettings();this.unwatchReactions=this.watchReactions();
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
 private cancel(){this.playback.cancel();this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.audio.cancelReactions();this.shown='';this.root.dataset.phase='idle';this.root.dataset.charging='false';resetGameOutcomes(this.root);}
 private assetState(state:MemeAssetState){
  if(this.destroyed)return;
  this.root.dataset.assetState=state.status;
  if(state.status==='ready'){this.root.style.setProperty('--cc-background',`url("${MEME_ASSETS.background}")`);}
  this.find<HTMLProgressElement>('[data-cc-load-progress]').value=state.loaded;
  this.find('[data-cc-load-title]').textContent=state.status==='error'?translateText('НЕ УДАЛОСЬ ЗАГРУЗИТЬ МЕМЫ'):translateText('ЗАГРУЖАЕМ ИНТЕРНЕТ');
  this.find('[data-cc-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и повтори загрузку. Монеты не списываются.'):tr`Изображения: ${state.loaded} из ${state.total}`;
  this.find<HTMLButtonElement>('[data-cc-load-retry]').hidden=state.status!=='error';this.controls();
 }
 private markup(){return tr`<section class="cc-game mo-game" data-meme-game data-studio-game="${MEME_GAME}" data-asset-state="loading" data-phase="idle" aria-label="MEME OVERLOAD">
  <div class="cc-loader" role="status"><span class="cc-loader-spark">✦</span><strong data-cc-load-title>ЗАГРУЖАЕМ ИНТЕРНЕТ</strong><p data-cc-load-note>Изображения: 0 из 7</p><progress data-cc-load-progress max="7" value="0" aria-label="Загрузка оформления"></progress><button type="button" data-cc-load-retry hidden>Повторить загрузку</button></div>
  <div class="mo-titlebar"><strong>meme_overload.exe</strong><span aria-hidden="true">_ □ ×</span></div><nav class="mo-menubar" aria-label="Меню игры"><button type="button" data-mo-menu="info">Правила</button><button type="button" data-mo-menu="history">Журнал</button><span>INTERNET DESKTOP</span></nav><header class="cc-heading"><div><small>ROYAL · INTERNET DESKTOP</small><h2>MEME <em>OVERLOAD.exe</em></h2><span>ВАШ ИНТЕРНЕТ ЗАРАЖЁН МЕМАМИ</span></div><p>КАСКАДЫ · РАЗГОН · ПЕРЕПОДКЛЮЧЕНИЕ</p></header>
  <div class="cc-scene"><aside class="cc-tickets"><h3>ПАПКА «НЕ ОТКРЫВАТЬ»</h3><div class="cc-ticket-slots" data-cc-tickets>${Array.from({length:3},()=>`<span>${memeSymbol(7)}</span>`).join('')}</div><strong data-cc-ticket-count>0 / 3</strong><p data-cc-ticket-help>3 / 4 / 5+ = 8 / 10 / 12 вращений</p><div class="cc-series"><strong data-cc-free>Вирусный режим</strong><div><button type="button" data-cc-pause disabled>На паузе</button></div></div></aside>
  <div class="cc-stage"><div class="cc-stage-heading"><span data-cc-phase-title>ОСНОВНАЯ ИГРА</span><b>20 ЛИНИЙ</b></div><div class="cc-awning"></div><div class="cc-board-frame"><div class="cc-board" data-cc-board role="group" aria-label="Шесть барабанов, пять рядов"></div></div><div class="cc-board-foot"></div></div>
  <aside class="cc-energy"><div class="cc-top nr-tach" aria-hidden="true"><span>CPU</span><strong data-cc-top-factor>×1</strong><small>OVERCLOCK</small></div><div class="cc-factor-card"><h3>РАЗГОН</h3><strong data-cc-factor>×1</strong><div class="cc-energy-meter"><i data-cc-energy-fill></i></div><small data-cc-factor-note>Каскады разгоняют систему до ×5</small></div><div class="nr-nitro-card"><span>${memeSymbol(8)}</span><strong data-nr-charge>СЕТЬ 0 / 2</strong><p data-nr-nitro-help>Значки сети собираются при выигрыше</p></div><button type="button" class="cc-buy" data-cc-buy><strong>ВИРУСНЫЙ РЕЖИМ<small>Как открыть бесплатные вращения</small></strong><b>ⓘ</b></button></aside></div>
  <div class="cc-results"><p data-cc-message>Система готова. Нажми «Крутить», чтобы загрузить мемы.</p><div><span>ВЫИГРЫШ РАУНДА <strong data-cc-total data-units="0">0,00</strong></span><div class="cc-groups" data-cc-groups></div></div></div>
  <div class="cc-controls"><div class="cc-balance"><small>БАЛАНС</small><strong data-cc-balance>0,00</strong><span>Тестовый кошелёк клуба</span></div><div class="cc-last"><small>ПОСЛЕДНИЙ ВЫИГРЫШ</small><strong data-cc-last>0,00</strong></div><div class="cc-stake"><label for="mo-stake">СТАВКА</label><div><button type="button" data-cc-stake-step="-1" aria-label="Уменьшить ставку">−</button><select id="mo-stake" data-cc-stake aria-label="Ставка">${MEME_BETS.map(n=>`<option value="${n}">${coins(n)}</option>`).join('')}</select><button type="button" data-cc-stake-step="1" aria-label="Увеличить ставку">+</button></div><small data-cc-cost>За ход: 1,00</small></div><button type="button" class="cc-spin" data-cc-spin aria-label="Крутить мемы"><b>⟳</b><span data-cc-spin-label>КРУТИТЬ</span></button><div class="cc-auto-controls"><button type="button" data-cc-speed aria-pressed="false">ОБЫЧНО ×1</button><div><select data-cc-auto-count aria-label="Число платных автовращений"><option>10</option><option>25</option><option>50</option></select><button type="button" data-cc-auto aria-pressed="false">Авто</button></div></div><div class="cc-tools"><button type="button" data-cc-info aria-label="Правила игры">ⓘ</button><button type="button" data-cc-music aria-label="Выключить музыку">♫</button><button type="button" data-cc-sound aria-label="Выключить звук">♪</button><button type="button" data-cc-history aria-label="История игры">☷</button></div></div>
  <div class="cc-wallet-help" data-cc-wallet-help><span data-cc-wallet-note></span><a href="/" data-cc-login>Войти в клуб для тестовой игры</a><button type="button" data-cc-wallet>Открыть тестовый кошелёк</button></div><div class="cc-feedback" data-cc-feedback><p data-cc-status role="status"></p><p data-cc-error role="alert"></p><button type="button" data-cc-retry hidden>Проверить прежний ход</button></div>
  <footer class="cc-footer"><label>Громкость <input type="range" min="0" max="100" data-cc-volume aria-label="Громкость игры"></label><label><input type="checkbox" data-nr-reduce> Показ без анимаций</label><span>Собственная игра Royal · тестовый виртуальные USDT</span><button type="button" data-cc-refresh>Проверить состояние</button></footer><div class="cc-dialog-backdrop" data-cc-backdrop><div class="cc-dialog" data-cc-dialog role="dialog" aria-modal="true" aria-labelledby="cc-dialog-title"></div></div></section>`;}
 private bind(){
  this.root.querySelectorAll<HTMLButtonElement>('[data-mo-menu]').forEach(button=>button.onclick=()=>{if(button.disabled||this.live||this.dialog)return;this.stopAuto();this.openDialog(button.dataset.moMenu as Dialog);});
    this.dialogShell=new SlotDialog(this.find('[data-cc-dialog]'),this.find('[data-cc-backdrop]'),'data-cc-action',action=>void this.dialogAction(action),()=>this.closeDialog());
    this.stakeControls=new SlotStakeControls({
      values:MEME_BETS,select:this.find<HTMLSelectElement>('[data-cc-stake]'),
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
  this.find<HTMLButtonElement>('[data-cc-buy]').onclick=()=>{this.stopAuto();this.openDialog('info');};this.find<HTMLButtonElement>('[data-cc-pause]').onclick=()=>{this.bonusRunning=false;this.playback.cancelScheduled();this.controls();};
  this.find<HTMLButtonElement>('[data-cc-speed]').onclick=()=>{this.fast=!this.fast;this.controls();};this.find<HTMLButtonElement>('[data-cc-auto]').onclick=()=>{if(this.autoRemaining){this.stopAuto();this.controls();}else if(!this.blocked()&&!this.dialog&&this.entered&&this.session()?.state!=='active'){this.autoRemaining=Number(this.find<HTMLSelectElement>('[data-cc-auto-count]').value);void this.request('normal');}};
  this.find<HTMLButtonElement>('[data-cc-info]').onclick=()=>{this.stopAuto();this.openDialog('info');};this.find<HTMLButtonElement>('[data-cc-history]').onclick=()=>{this.stopAuto();this.openDialog('history');};
  this.find<HTMLButtonElement>('[data-cc-retry]').onclick=()=>void this.retry();this.find<HTMLButtonElement>('[data-cc-refresh]').onclick=()=>void this.refresh();this.find<HTMLButtonElement>('[data-cc-wallet]').onclick=()=>{this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));};
  this.find<HTMLInputElement>('[data-nr-reduce]').onchange=e=>{this.manualReduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('royal-meme-reduced',this.manualReduced?'1':'0');}catch{}this.cancel();this.sync();};
 }
 private controls(){
  if(this.destroyed)return;const s=this.session(),active=s?.state==='active',blocked=this.blocked();if(active)this.stake=s.stakeUnits;
  this.root.querySelectorAll<HTMLButtonElement>('[data-mo-menu]').forEach(button=>button.disabled=blocked||!!this.dialog||!this.entered);
  this.find<HTMLInputElement>('[data-nr-reduce]').checked=this.manualReduced;this.find<HTMLInputElement>('[data-nr-reduce]').disabled=!!this.live||client.busy||!!client.pending;this.root.dataset.reducedMotion=String(!this.motion());this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(s?.view.nitro.bonus?.remaining??0);this.root.dataset.virus=String(s?.state==='active');this.root.setAttribute('aria-busy',String(!this.assets.ready||!!this.live||client.busy));
  this.find('[data-cc-balance]').textContent=coins((this.live?.balance??this.balance())*100);this.find('[data-cc-last]').textContent=coins(this.lastWin);
  this.find<HTMLButtonElement>('[data-cc-spin]').disabled=blocked||!this.entered||!!this.dialog;this.find('[data-cc-spin-label]').textContent=this.live?translateText('ЗАГРУЗКА'):active?translateText('ПРОДОЛЖИТЬ'):translateText('КРУТИТЬ');
     this.stakeControls.update();
this.find('[data-cc-cost]').textContent=active?translateText('Продолжение бесплатно'):tr`За ход: ${coins(this.stake)}`;this.find<HTMLButtonElement>('[data-cc-buy]').disabled=blocked||active||!!this.dialog||this.autoRemaining>0||!this.entered;
     updateSlotTransport(this.root,'cc',{blocked,active,live:!!this.live,dialog:!!this.dialog,entered:this.entered,fast:this.fast,autoRemaining:this.autoRemaining,bonusRunning:this.bonusRunning,paidBonus:false,pending:!!client.pending,busy:client.busy,hidden:document.hidden,ready:this.assets.ready});
   this.find('[data-cc-error]').textContent=this.error||client.error;this.find('[data-cc-feedback]').dataset.error=String(!!(this.error||client.error));
this.find('[data-cc-status]').textContent=client.loading?translateText('Проверяем сохранённую игру…'):this.live?'':client.pending?translateText('Ход сохранён. Подтверди прежнюю операцию.'):this.autoRemaining?tr`Платных вращений осталось: ${this.autoRemaining}`:active?this.bonusRunning?translateText('Вирусный режим продолжается бесплатно.'):translateText('Вирусный режим на паузе. Нажми «Продолжить».'):'';
  this.find('[data-cc-wallet-help]').hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);this.find('[data-cc-wallet-note]').textContent=client.accountId?translateText('Недостаточно USDT (Nile) для ставки.'):translateText('Для игры нужен общий баланс USDT.');this.find('[data-cc-login]').hidden=!!client.accountId;this.find('[data-cc-wallet]').hidden=!client.accountId;
   this.soundControls?.update();this.reactionSettings();
  const enter=this.root.querySelector<HTMLButtonElement>('[data-cc-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ РЕЖИМ'):translateText('ЗАПУСТИТЬ МЕМЫ');}
 }
 private sync(){
  if(this.destroyed)return;
  if(this.owner!==client.accountId){this.cancel();this.audio.pause();this.owner=client.accountId;this.entered=false;this.lastWin='0';this.stake = '10';this.openDialog('intro');}
  const s=this.session();if(!this.live&&(!s||this.shown!==this.key(s))){
   this.board.clearOverlay();this.board.highlight([]);this.board.show(s?.view.nitro.spin?.finalGrid??preview);this.root.dataset.phase='idle';this.root.dataset.charging='false';
   if(s){this.shown=this.key(s);this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(s.view.nitro.revision);if(s.state==='settled')this.lastWin=s.returnedUnits;this.setTotal(s.view.nitro.totalPayoutUnits);this.features(s.view.nitro);this.find('[data-cc-message]').textContent=s.state==='active'?translateText('Игра сохранена. Продолжение без ставки.'):translateText('Раунд завершён. Выплата уже в кошельке.');}
   else{this.shown='';this.setTotal('0');this.features();this.find('[data-cc-message]').textContent=translateText('Система готова. Нажми «Крутить», чтобы загрузить мемы.');}
  }
  this.controls();observeExpansionOutcome(this.root,MEME_GAME,s,client.accountId,!!this.live||client.busy,!!client.pending);
 }
 private setTotal(value:string|number){this.find('[data-cc-total]').textContent=coins(value);this.find('[data-cc-total]').dataset.units=String(value);}
 private factor(value:number){this.root.dataset.multiplier=String(value);this.root.style.setProperty('--nr-gear',String(value));this.find('[data-cc-factor]').textContent=this.find('[data-cc-top-factor]').textContent=`×${value}`;this.find('[data-cc-energy-fill]').style.width=`${value/5*100}%`;}
 private tickets(count:number,free:boolean){this.find('[data-cc-ticket-count]').textContent=`${count} / 3`;this.find('[data-cc-ticket-help]').textContent=free?translateText('3 папки = ещё 2 вращения'):translateText('3 / 4 / 5+ = 8 / 10 / 12 вращений');this.find('[data-cc-tickets]').querySelectorAll(':scope > span').forEach((cell,i)=>cell.classList.toggle('cc-collected',i<count));}
 private charge(value:number,used:boolean){this.root.dataset.nitroCharge=String(value);this.find('[data-nr-charge]').textContent=used?translateText('СЕТЬ ВОССТАНОВЛЕНА'):tr`СЕТЬ ${value} / 2`;this.find('[data-nr-nitro-help]').textContent=used?translateText('Одно переподключение за вращение'):value===2?translateText('Переподключение при остановке серии'):translateText('Значки сети собираются при выигрыше');}
 private features(view?:NitroView){const bonus=view?.bonus,active=!!bonus?.remaining,spin=view?.spin,frame=spin?.frames.at(-1);this.factor(spin?.multiplierAfter??1);this.charge(frame?.nitroAfter??0,frame?.nitroUsedAfter??false);this.tickets(spin?.flags??0,spin?.kind==='free');this.find('[data-cc-phase-title]').textContent=active?tr`ВИРУСНЫЙ РЕЖИМ · ${bonus!.played} / ${bonus!.awarded}`:translateText('ОСНОВНАЯ ИГРА');this.find('[data-cc-free]').textContent=active?tr`${bonus!.remaining} бесплатных вращений`:translateText('Вирусный режим');this.find('[data-cc-factor-note]').textContent=active?translateText('Каждое бесплатное вращение начинает с ×2'):translateText('Новое вращение начинает с ×1');}

 private async play(){if(this.blocked()||!this.entered||this.dialog)return;this.bonusRunning=this.session()?.state==='active';await this.request('normal');}
 private async request(mode:'normal'){
  if(this.blocked()||!this.entered||this.dialog)return;const previous=this.session(),active=previous?.state==='active',cost=active?0:Number(this.stake)/100;
  if(this.balance()<cost){this.error=translateText('Недостаточно USDT (Nile) для выбранной ставки.');this.stopAuto();this.controls();return;}
  void this.audio.enter();const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:this.motion(),fast:this.fast,before:previous};this.live=live;this.error='';this.root.dataset.animationToken=live.token;this.audio.newRound(live.token);this.find('[data-cc-groups]').replaceChildren();this.board.highlight([]);observeExpansionOutcome(this.root,MEME_GAME,previous,client.accountId,true,true);
  if(!active&&this.autoRemaining)this.autoRemaining--;
  {this.root.dataset.phase='spinning';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);}this.controls();
  try{
   const action=this.sessions.operation(this.stake,mode,previous);
   const promise=client.act(action);live.operationId=client.pending?.id??'';await promise;if(!this.valid(live))return;
   const s=this.session();if(!this.sessions.confirmed(s,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
   await this.present(s,live);if(!this.valid(live))return;
   this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';this.shown=this.key(s);if(s.state==='settled')this.lastWin=s.returnedUnits;this.features(s.view.nitro);this.setTotal(s.view.nitro.totalPayoutUnits);this.controls();observeExpansionOutcome(this.root,MEME_GAME,s,client.accountId,false,false);if(s.state==='settled')this.audio.confirmedResult(s);
   const v=s.view.nitro;if(s.state==='active'&&(!v.spin||v.spin.kind==='base')){this.stopAuto();this.openDialog('bonus');return;}
   if(s.state==='settled'&&v.history.some(spin=>spin.kind==='free')){this.bonusRunning=false;this.openDialog(BigInt(s.returnedUnits)>=BigInt(s.stakeUnits)*20n?'bigwin':'complete');return;}
   if(s.state==='settled'&&BigInt(s.returnedUnits)>=BigInt(s.stakeUnits)*20n){this.stopAuto();this.openDialog('bigwin');return;}
   if(s.state==='active'&&this.bonusRunning||s.state==='settled'&&this.autoRemaining>0)this.schedule();
  }catch(e){if(this.valid(live)){this.error=(e as Error).message;this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.audio.cancelReactions();this.shown='';this.sync();}}
  finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.audio.stopSpin();}}
 }
 private async present(s:Session,live:Live){
  const v=s.view.nitro,spin=v.spin;this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(v.revision);
  let total=Number(v.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);this.factor(spin.multiplierBefore);this.charge(0,false);
  if(!await this.board.settle(live.token,spin.initialGrid)||!this.valid(live))return;this.audio.stopSpin();this.tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.valid(live))return;this.board.clearOverlay();this.board.show(frame.before);this.factor(frame.multiplierBefore);this.charge(frame.nitroBefore,frame.nitroUsedBefore);this.board.highlight(frame.wins.flatMap(w=>w.positions));
   if(frame.wins.length){
    this.root.dataset.phase='winning';this.find('[data-cc-message]').textContent=tr`КАСКАД ${frame.index+1} · РАЗГОН ×${frame.multiplierBefore}${frame.energy?tr` · СЕТЬ +${frame.energy}`:''}`;
    this.find('[data-cc-groups]').innerHTML=frame.wins.map(w=>tr`<span>${memeSymbol(w.symbol)}<b>Л${w.line+1}: ${coins(w.payoutUnits)}</b></span>`).join('');total+=Number(frame.payoutUnits);this.setTotal(total);this.audio.cascade(frame.index);
    if(live.motion&&!await this.delay(live.fast?160:500,live))return;
    this.factor(frame.multiplierAfter);this.charge(frame.nitroAfter,frame.nitroUsedAfter);if(frame.multiplierAfter>frame.multiplierBefore)this.audio.gear(frame.multiplierAfter);
   }
   if(frame.stop==='nitro'){
    this.root.dataset.phase='nitro';this.root.dataset.charging='true';this.find('[data-cc-message]').textContent=translateText('СОЕДИНЕНИЕ ПОТЕРЯНО · ПЕРЕПОДКЛЮЧЕНИЕ БЕЗ СТАВКИ');this.audio.boost();this.charge(0,true);
    if(live.motion&&!await this.delay(live.fast?220:650,live))return;
   }
   if(frame.removed.length){
    if(frame.stop!=='nitro')this.root.dataset.phase='bursting';this.board.remove(frame.removed);if(live.motion&&!await this.delay(live.fast?100:220,live))return;
    this.root.dataset.phase='falling';this.audio.drop();if(live.motion){this.board.gravity(frame,live.fast);if(!await this.delay(live.fast?280:600,live))return;}
    this.board.clearOverlay();this.board.show(frame.after);this.board.highlight([]);this.root.dataset.charging='false';this.tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');
   }
  }
  if(!this.valid(live))return;this.board.clearOverlay();this.board.show(spin.finalGrid);this.board.highlight([]);this.features(v);this.setTotal(v.totalPayoutUnits);
  if(spin.freeAward){this.root.dataset.phase='tickets';this.find('[data-cc-message]').textContent=spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:tr`${spin.flags} ПАПКИ · ВИРУСНЫЙ РЕЖИМ ОТКРЫТ`;this.audio.tickets(spin.kind==='free');if(live.motion&&!await this.delay(live.fast?250:850,live))return;}
  else this.find('[data-cc-message]').textContent=v.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('12 ПОКАЗОВ ПОЛЯ · ЗАГРУЗКА ЗАВЕРШЕНА'):Number(spin.payoutUnits)>0?translateText('ВЫИГРЫШ ПОДТВЕРЖДЁН'):s.state==='active'?translateText('ВИРУСНЫЙ РЕЖИМ ПРОДОЛЖАЕТСЯ'):translateText('СИСТЕМА ГОТОВА К СЛЕДУЮЩЕМУ ВРАЩЕНИЮ');
  this.audio.outcome(Number(spin.payoutUnits)>0);if(live.motion)await this.delay(live.fast?100:300,live);
 }

 private schedule(){this.playback.schedule(this.fast?140:500,()=>{if(!this.dialog&&!this.blocked()&&(this.bonusRunning||this.autoRemaining))void this.request('normal');});}
 private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();}catch(e){this.error=(e as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
 private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();if(!this.destroyed){this.shown='';this.sync();}}
 private ledger(session:Session){return renderSlotLedger('cc',session.spentUnits,session.state==='active'?session.view.nitro.totalPayoutUnits:session.returnedUnits,session.state==='active');}
 private openDialog(kind:Dialog){this.settings?.close();
  this.dialog=kind;this.root.dataset.systemError=String(kind==='bigwin');this.dialogShell.begin(kind==='bigwin'?'complete':kind);if(!kind)return;const box=this.find('[data-cc-dialog]'),s=this.session(),v=s?.view.nitro;
  if(kind==='intro')box.innerHTML=tr`<small>СИСТЕМА ГОТОВА. МЕМЫ ЗАГРУЖЕНЫ.</small><h2 id="cc-dialog-title">MEME <em>OVERLOAD.exe</em></h2><div class="cc-intro-cards"><article><div>${memeSymbol(4)}${memeSymbol(5)}</div><h3>20 ЛИНИЙ И КАСКАДЫ</h3><p>Три символа слева дают выигрыш. WILD помогает. Выигрышные символы падают каскадом.</p></article><article><div>${memeSymbol(8)}<strong>×5</strong></div><h3>CPU И ПЕРЕПОДКЛЮЧЕНИЕ</h3><p>Каждый выигрыш разгоняет следующий каскад. Два значка сети на выигрышных полях дают одно бесплатное переподключение.</p></article><article><div>${memeSymbol(7)}</div><h3>ВИРУСНЫЙ РЕЖИМ</h3><p>3 / 4 / 5+ папок в конце дают 8 / 10 / 12 вращений. Каждое начинает с ×2.</p></article></div><button type="button" class="cc-primary" data-cc-action="enter">ЗАПУСТИТЬ МЕМЫ</button><p class="cc-dialog-note">Виртуальные USDT · вход без ставки</p>`;
  if(kind==='bonus')box.innerHTML=tr`<small>ПАПКИ BONUS СОБРАНЫ</small><h2 id="cc-dialog-title">ВИРУСНЫЙ РЕЖИМ</h2><div class="cc-bonus-art">${memeSymbol(7)}<strong>${v?.bonus?.remaining??8}<small>БЕСПЛАТНЫХ ВРАЩЕНИЙ</small></strong>${memeSymbol(8)}</div><p>Каждое вращение начинает с ×2. Три папки на конечном поле добавляют ещё два вращения, максимум 20 за весь раунд. Сеть заряжается заново в каждом вращении.</p><button type="button" class="cc-primary" data-cc-action="bonus">ЗАПУСТИТЬ ВИРУС</button><p class="cc-dialog-note">Продолжение бесплатно. Ставка уже принята.</p>`;
  if(kind==='complete'&&s)box.innerHTML=renderSlotResult({style:'cc',eyebrow:translateText('СИСТЕМА ВОССТАНОВЛЕНА'),title:translateText('ИТОГ ВИРУСНОГО РЕЖИМА'),returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата уже зачислена в кошелёк один раз.'),label:translateText('ПРОДОЛЖИТЬ')});
  if(kind==='bigwin'&&s){const factor=Number(s.returnedUnits)/Number(s.stakeUnits);box.innerHTML=renderSlotResult({style:'cc',eyebrow:factor>=100?'ERROR 777: TOO MUCH WOW':factor>=50?translateText('НЕДОСТАТОЧНО ПАМЯТИ'):translateText('ФАЙЛ СЛИШКОМ БОЛЬШОЙ'),title:factor>=100?'SYSTEM OVERLOAD':'MUCH WIN',returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата уже в кошельке. Система работает нормально.'),label:translateText('ВОССТАНОВИТЬ СИСТЕМУ')});}
  if(kind==='history')box.innerHTML=renderSlotHistory({style:'cc',eyebrow:'SYSTEM.LOG',title:translateText('ЖУРНАЛ МЕМОВ'),ledger:s?this.ledger(s):undefined,status:s?.state==='active'?translateText('Игра сохранена. Выплата поступит после завершения раунда.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появится подтверждённая история раунда.'),rows:v?.history.map(spin=>({title:tr`${spin.kind==='base'?translateText('Основное'):translateText('Бесплатное')} вращение ${slotSpinNumber(spin,v!.history)}`,detail:tr`${spin.frames.filter(f=>f.wins.length).length} каскадов · разгон ×${spin.multiplierAfter} · ${spin.frames.some(f=>f.stop==='nitro')?translateText('переподключение · '):''}${spin.flags} папок${spin.freeAward?tr` · +${spin.freeAward} вращений`:''}`,payoutUnits:spin.payoutUnits}))??[]});
  if(kind==='info')box.innerHTML=renderSlotInfo({style:'cc',eyebrow:'README.TXT',title:translateText('КАК ИГРАЕТ MEME OVERLOAD'),reduced:this.manualReduced,motionSetting:false,bodyHtml:tr`<h3>20 линий, одна общая ставка</h3><p>${escape(MEME_RULES)}</p><h3>Разгон со следующего каскада</h3><p>Обычное вращение начинает с ×1, бесплатное с ×2. Выигрыш оплачивается на текущем множителе, затем он повышается на один до ×5. Между вращениями разгон сбрасывается.</p><h3>Переподключение</h3><p>Значки сети собираются только при выигрыше на поле и удаляются вместе с выигрышными мемами. Нужно два за одно вращение. При первом поле без выигрыша заряд расходуется и полностью обновляет поле с сохранением множителя. Только одно переподключение за вращение. Папки учитываются только на конечном поле. На 12-м показе или при лимите выплаты поле больше не обновляется.</p><h3>Таблица выплат от общей ставки, до множителя</h3>${renderSlotPaytable('cc',MEME_PAYTABLE.map((pay,i)=>({symbolHtml:memeSymbol(i),name:i===6?'WILD':'',values:pay.map(n=>`${(n/100).toLocaleString(locale)}×`)})),[translateText('Символ'),'3','4','5','6'])}<p>WILD заменяет обычные символы, на линии платится только лучшая комбинация. Пересекающиеся линии оплачиваются отдельно. Значок сети и папка сами не оплачиваются. Максимум всего раунда: 3 000 ставок. При достижении лимита остаток бонуса завершается. При ограничении последняя линия может оплачиваться частично.</p><h3>Все 20 линий</h3><div class="mo-paylines">${MEME_LINES.map((line,i)=>`<span><small>${i+1}</small><svg viewBox="0 0 120 100"><polyline points="${line.map((row,col)=>`${col*20+10},${row*20+10}`).join(' ')}"/></svg></span>`).join('')}</div><p>Одна ставка и одна итоговая выплата на раунд. При обрыве связи подтверждается прежний ход. Закрытие или скрытие окна останавливает авто. Вирусный режим сохраняется. Авто делает выбранные 10, 25 или 50 платных вращений и останавливается при входе в бонус. Покупки бонуса нет.</p><p>Оценка долгосрочного возврата: около 96,2% от суммы ставок, включая бонусы. Это среднее на длинной серии, а не обещание результата отдельного вращения.</p><p class="cc-dialog-note">Все исходы определяет сервер. Только тестовый виртуальные USDT клуба. Закрытие окна не отменяет принятую ставку.</p>`});
  this.controls();this.dialogShell.focus();
  box.scrollTop=0;if(this.root.closest('#mini-dialog[data-game-viewport="flow"]'))this.root.closest('.mini-stage')?.scrollTo({top:0,behavior:'instant'});
 }

 private installReactionSettings(){
  const footer=this.find('.cc-footer');
  footer.insertAdjacentHTML('beforeend',tr`<fieldset class="mo-reaction-settings"><legend>Мемные реакции</legend><label><input type="checkbox" data-mo-reactions> Настоящие мемные звуки</label><label>Громкость мемов <input type="range" min="0" max="100" data-mo-reaction-volume aria-label="Громкость мемов"></label><div><select data-mo-clip aria-label="Мем для прослушивания">${MEME_CLIPS.map(id=>`<option value="${id}">${MEME_CLIP_LABELS[id]}</option>`).join('')}</select><button type="button" data-mo-preview>Прослушать мем</button></div><small data-mo-audio-status role="status"></small></fieldset>`);
  this.find<HTMLInputElement>('[data-mo-reactions]').onchange=e=>{this.audio.reactions.setEnabled((e.target as HTMLInputElement).checked);};
  this.find<HTMLInputElement>('[data-mo-reaction-volume]').oninput=e=>this.audio.reactions.setLevel(Number((e.target as HTMLInputElement).value)/100);
  this.find<HTMLButtonElement>('[data-mo-preview]').onclick=async()=>{if(this.live||client.busy||client.pending)return;this.stopAuto();this.controls();await this.audio.preview(this.find<HTMLSelectElement>('[data-mo-clip]').value as MemeClip);this.reactionSettings();};
  this.reactionSettings();
 }
 private watchReactions(){const change=()=>this.reactionSettings();this.audio.reactions.addEventListener('change',change);return()=>this.audio.reactions.removeEventListener('change',change);}
 private reactionSettings(){
  if(this.destroyed)return;const state=this.audio.reactions.state(),preferences=gameAudio.getPreferences(),enabled=this.root.querySelector<HTMLInputElement>('[data-mo-reactions]');if(!enabled)return;
  enabled.checked=state.enabled;this.find<HTMLInputElement>('[data-mo-reaction-volume]').value=String(Math.round(state.level*100));
  this.find<HTMLButtonElement>('[data-mo-preview]').disabled=!!this.live||client.busy||!!client.pending||!state.enabled||state.level===0||preferences.muted||preferences.volume===0;
  this.find('[data-mo-audio-status]').textContent=preferences.muted?translateText('Общий звук выключен. Включи ♪ в игре.'):preferences.volume===0?translateText('Увеличь общую громкость игры.'):!state.enabled?translateText('Мемные реакции выключены.'):state.level===0?translateText('Увеличь громкость мемов для прослушивания.'):state.loading?translateText('Загружаем звуки…'):state.activeSources?translateText('Звучит мемная реакция'):state.ready===state.total?translateText('Редкие реакции с паузами, без наложений.'):state.ready?tr`Доступно звуков: ${state.ready} из ${state.total}`:state.failures?translateText('Не удалось загрузить звуки. Нажми «Прослушать мем», чтобы повторить.'):translateText('Звуки загрузятся после входа в игру.');
 }
 private closeDialog(){this.root.dataset.systemError='false';this.dialog='';this.controls();this.dialogShell.hide();}
 private async dialogAction(action:string){if(this.destroyed||!this.assets.ready)return;if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request('normal');}}else if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request('normal');}else{this.closeDialog();if(action==='complete'&&this.autoRemaining)this.schedule();}}
 getAudioState(){return {...this.audio.state(),reactions:this.audio.reactions.state()};}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.unwatchReactions();this.cancel();this.assets.destroy();this.board.destroy();this.audio.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
