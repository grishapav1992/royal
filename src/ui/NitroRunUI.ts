import { t as translateText, tr, locale } from '../i18n/index';
import {SlotSettings} from './slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from './slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls, slotStakeStep, updateSlotTransport} from './slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable} from './slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from './slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from './slotKit/SlotSessions';
import {bindSlotLifecycle} from './slotKit/SlotLifecycle';
import {nitroSlot} from './slotKit/nativeSlots';
import {NITRO_GAME,NITRO_BETS,NITRO_PAYTABLE,NITRO_NAMES,NITRO_RULES,NITRO_LINES,type NitroView} from '../shared/nitroRun';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {NitroRunAssets,NITRO_ASSETS,type NitroAssetState} from './NitroRunAssets';
import {NitroRunAudio} from './NitroRunAudio';
import {NitroBoard} from './NitroBoard';
import {nitroSymbol} from './NitroArtwork';
import './caramel-carnival.css';
import './nitro-run.css';

type Session=NativeSlotSession<'nitro'>;
type Dialog=''|'intro'|'info'|'history'|'bonus'|'complete';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session};
const preview=Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%6);

/** Presentation consumes confirmed frames. Reopening and retries remain static. */
export class NitroRunUI {
 private settings?:SlotSettings;
 private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private board:NitroBoard;private audio=new NitroRunAudio();private assets:NitroRunAssets;
 private owner=client.accountId;private destroyed=false;private entered=false;private stake='100';private fast=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)');private manualReduced=false;
 private dialog:Dialog='intro';private shown='';private lastWin='0';private error='';private live?:Live;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(nitroSlot);private autoRemaining=0;private bonusRunning=false;private unsubscribe=()=>{};
 private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChanged=()=>{this.cancel();this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog))return;
    if(event.code==='Space'&&this.entered&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();void this.play();}
  };
 constructor(private host:HTMLElement){
  try{this.manualReduced=localStorage.getItem('royal-nitro-reduced')==='1';}catch{}
  host.innerHTML=this.markup();this.root=host.querySelector('[data-nitro-game]')!;
  this.assets=new NitroRunAssets(state=>this.assetState(state));
  this.board=new NitroBoard(this.find('[data-cc-board]'),{phase:value=>{if(this.live)this.root.dataset.phase=value;},stop:col=>{if(this.live)this.audio.stopReel(col);}});
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
 private assetState(state:NitroAssetState){
  if(this.destroyed)return;
  this.root.dataset.assetState=state.status;
  if(state.status==='ready'){this.root.style.setProperty('--cc-symbols',`url("${NITRO_ASSETS.symbols}")`);this.root.style.setProperty('--cc-background',`url("${NITRO_ASSETS.background}")`);}
  this.find<HTMLProgressElement>('[data-cc-load-progress]').value=state.loaded;
  this.find('[data-cc-load-title]').textContent=state.status==='error'?translateText('НЕ УДАЛОСЬ ЗАГРУЗИТЬ ТРАССУ'):translateText('ГОТОВИМ НОЧНОЙ ЗАЕЗД');
  this.find('[data-cc-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и повтори загрузку. Монеты не списываются.'):tr`Изображения: ${state.loaded} из ${state.total}`;
  this.find<HTMLButtonElement>('[data-cc-load-retry]').hidden=state.status!=='error';this.controls();
 }
 private markup(){return tr`<section class="cc-game nr-game" data-nitro-game data-studio-game="${NITRO_GAME}" data-asset-state="loading" data-phase="idle" aria-label="Нитро-заезд">
  <div class="cc-loader" role="status"><span class="cc-loader-spark">✦</span><strong data-cc-load-title>ГОТОВИМ НОЧНОЙ ЗАЕЗД</strong><p data-cc-load-note>Изображения: 0 из 2</p><progress data-cc-load-progress max="2" value="0" aria-label="Загрузка оформления"></progress><button type="button" data-cc-load-retry hidden>Повторить загрузку</button></div>
  <header class="cc-heading"><div><small>ROYAL · ПОЛНОЧНЫЙ ГОРОД</small><h2>NITRO <em>RUN</em></h2><span>НИТРО-ЗАЕЗД</span></div><p>ЛИНИИ · ПЕРЕДАЧИ · НИТРО</p></header>
  <div class="cc-scene"><aside class="cc-tickets"><h3>ФИНИШНЫЕ ФЛАГИ</h3><div class="cc-ticket-slots" data-cc-tickets>${Array.from({length:3},()=>`<span>${nitroSymbol(7)}</span>`).join('')}</div><strong data-cc-ticket-count>0 / 3</strong><p data-cc-ticket-help>3 / 4 / 5+ = 8 / 10 / 12 вращений</p><div class="cc-series"><strong data-cc-free>Бесплатная гонка</strong><div><button type="button" data-cc-pause disabled>На паузе</button></div></div></aside>
  <div class="cc-stage"><div class="cc-stage-heading"><span data-cc-phase-title>ОСНОВНАЯ ИГРА</span><b>20 ЛИНИЙ</b></div><div class="cc-awning"></div><div class="cc-board-frame"><div class="cc-board" data-cc-board role="group" aria-label="Шесть барабанов, пять рядов"></div></div><div class="cc-board-foot"></div></div>
  <aside class="cc-energy"><div class="cc-top nr-tach" aria-hidden="true"><span>GEAR</span><strong data-cc-top-factor>×1</strong><i class="nr-needle"></i></div><div class="cc-factor-card"><h3>ПЕРЕДАЧА</h3><strong data-cc-factor>×1</strong><div class="cc-energy-meter"><i data-cc-energy-fill></i></div><small data-cc-factor-note>Следующий каскад разгоняет до ×5</small></div><div class="nr-nitro-card"><span>${nitroSymbol(8)}</span><strong data-nr-charge>НИТРО 0 / 2</strong><p data-nr-nitro-help>Баллоны собираются при выигрыше</p></div><button type="button" class="cc-buy" data-cc-buy><strong>БОНУСНАЯ ГОНКА<small>Как открыть бесплатные вращения</small></strong><b>ⓘ</b></button></aside></div>
  <div class="cc-results"><p data-cc-message>Нажми «Старт», чтобы выйти на ночную трассу</p><div><span>ВЫИГРЫШ РАУНДА <strong data-cc-total data-units="0">0,00</strong></span><div class="cc-groups" data-cc-groups></div></div></div>
  <div class="cc-controls"><div class="cc-balance"><small>БАЛАНС</small><strong data-cc-balance>0,00</strong><span>Тестовый кошелёк клуба</span></div><div class="cc-last"><small>ПОСЛЕДНИЙ ВЫИГРЫШ</small><strong data-cc-last>0,00</strong></div><div class="cc-stake"><label for="nr-stake">СТАВКА</label><div><button type="button" data-cc-stake-step="-1" aria-label="Уменьшить ставку">−</button><select id="nr-stake" data-cc-stake aria-label="Ставка">${NITRO_BETS.map(n=>`<option value="${n}">${coins(n)}</option>`).join('')}</select><button type="button" data-cc-stake-step="1" aria-label="Увеличить ставку">+</button></div><small data-cc-cost>За ход: 1,00</small></div><button type="button" class="cc-spin" data-cc-spin aria-label="Начать заезд"><b>⟳</b><span data-cc-spin-label>СТАРТ</span></button><div class="cc-auto-controls"><button type="button" data-cc-speed aria-pressed="false">ОБЫЧНО ×1</button><div><select data-cc-auto-count aria-label="Число платных автовращений"><option>10</option><option>25</option><option>50</option></select><button type="button" data-cc-auto aria-pressed="false">Авто</button></div></div><div class="cc-tools"><button type="button" data-cc-info aria-label="Правила игры">ⓘ</button><button type="button" data-cc-music aria-label="Выключить музыку">♫</button><button type="button" data-cc-sound aria-label="Выключить звук">♪</button><button type="button" data-cc-history aria-label="История игры">☷</button></div></div>
  <div class="cc-wallet-help" data-cc-wallet-help><span data-cc-wallet-note></span><a href="/" data-cc-login>Войти в клуб для тестовой игры</a><button type="button" data-cc-wallet>Открыть тестовый кошелёк</button></div><div class="cc-feedback" data-cc-feedback><p data-cc-status role="status"></p><p data-cc-error role="alert"></p><button type="button" data-cc-retry hidden>Проверить прежний ход</button></div>
  <footer class="cc-footer"><label>Громкость <input type="range" min="0" max="100" data-cc-volume aria-label="Громкость игры"></label><label><input type="checkbox" data-nr-reduce> Показ без анимаций</label><span>Собственная игра Royal · тестовый виртуальные USDT</span><button type="button" data-cc-refresh>Проверить состояние</button></footer><div class="cc-dialog-backdrop" data-cc-backdrop><div class="cc-dialog" data-cc-dialog role="dialog" aria-modal="true" aria-labelledby="cc-dialog-title"></div></div></section>`;}
 private bind(){
    this.dialogShell=new SlotDialog(this.find('[data-cc-dialog]'),this.find('[data-cc-backdrop]'),'data-cc-action',action=>void this.dialogAction(action),()=>this.closeDialog());
    this.stakeControls=new SlotStakeControls({
      values:NITRO_BETS,select:this.find<HTMLSelectElement>('[data-cc-stake]'),
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
  this.find<HTMLInputElement>('[data-nr-reduce]').onchange=e=>{this.manualReduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('royal-nitro-reduced',this.manualReduced?'1':'0');}catch{}this.cancel();this.sync();};
 }
 private controls(){
  if(this.destroyed)return;const s=this.session(),active=s?.state==='active',blocked=this.blocked();if(active)this.stake=s.stakeUnits;
  this.find<HTMLInputElement>('[data-nr-reduce]').checked=this.manualReduced;this.find<HTMLInputElement>('[data-nr-reduce]').disabled=!!this.live||client.busy||!!client.pending;this.root.dataset.reducedMotion=String(!this.motion());this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(s?.view.nitro.bonus?.remaining??0);this.root.setAttribute('aria-busy',String(!this.assets.ready||!!this.live||client.busy));
  this.find('[data-cc-balance]').textContent=coins((this.live?.balance??this.balance())*100);this.find('[data-cc-last]').textContent=coins(this.lastWin);
  this.find<HTMLButtonElement>('[data-cc-spin]').disabled=blocked||!this.entered||!!this.dialog;this.find('[data-cc-spin-label]').textContent=this.live?translateText('ЗАЕЗД'):active?translateText('ПРОДОЛЖИТЬ'):translateText('СТАРТ');
     this.stakeControls.update();
this.find('[data-cc-cost]').textContent=active?translateText('Продолжение бесплатно'):tr`За ход: ${coins(this.stake)}`;this.find<HTMLButtonElement>('[data-cc-buy]').disabled=blocked||active||!!this.dialog||this.autoRemaining>0||!this.entered;
     updateSlotTransport(this.root,'cc',{blocked,active,live:!!this.live,dialog:!!this.dialog,entered:this.entered,fast:this.fast,autoRemaining:this.autoRemaining,bonusRunning:this.bonusRunning,paidBonus:false,pending:!!client.pending,busy:client.busy,hidden:document.hidden,ready:this.assets.ready});
   this.find('[data-cc-error]').textContent=this.error||client.error;this.find('[data-cc-feedback]').dataset.error=String(!!(this.error||client.error));
this.find('[data-cc-status]').textContent=client.loading?translateText('Проверяем сохранённую гонку…'):this.live?'':client.pending?translateText('Ход сохранён. Подтверди прежнюю операцию.'):this.autoRemaining?tr`Платных вращений осталось: ${this.autoRemaining}`:active?this.bonusRunning?translateText('Гонка продолжается бесплатно.'):translateText('Гонка на паузе. Нажми «Продолжить».'):'';
  this.find('[data-cc-wallet-help]').hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);this.find('[data-cc-wallet-note]').textContent=client.accountId?translateText('Недостаточно USDT · Демо для ставки.'):translateText('Для игры нужен общий баланс USDT.');this.find('[data-cc-login]').hidden=!!client.accountId;this.find('[data-cc-wallet]').hidden=!client.accountId;
   this.soundControls?.update();
  const enter=this.root.querySelector<HTMLButtonElement>('[data-cc-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ ГОНКУ'):translateText('ВЫЙТИ НА СТАРТ');}
 }
 private sync(){
  if(this.destroyed)return;
  if(this.owner!==client.accountId){this.cancel();this.audio.pause();this.owner=client.accountId;this.entered=false;this.lastWin='0';this.stake='100';this.openDialog('intro');}
  const s=this.session();if(!this.live&&(!s||this.shown!==this.key(s))){
   this.board.clearOverlay();this.board.highlight([]);this.board.show(s?.view.nitro.spin?.finalGrid??preview);this.root.dataset.phase='idle';this.root.dataset.charging='false';
   if(s){this.shown=this.key(s);this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(s.view.nitro.revision);if(s.state==='settled')this.lastWin=s.returnedUnits;this.setTotal(s.view.nitro.totalPayoutUnits);this.features(s.view.nitro);this.find('[data-cc-message]').textContent=s.state==='active'?translateText('Гонка сохранена. Продолжение без ставки.'):translateText('Раунд завершён. Выплата уже в кошельке.');}
   else{this.shown='';this.setTotal('0');this.features();this.find('[data-cc-message]').textContent=translateText('Нажми «Старт», чтобы выйти на ночную трассу');}
  }
  this.controls();observeExpansionOutcome(this.root,NITRO_GAME,s,client.accountId,!!this.live||client.busy,!!client.pending);
 }
 private setTotal(value:string|number){this.find('[data-cc-total]').textContent=coins(value);this.find('[data-cc-total]').dataset.units=String(value);}
 private factor(value:number){this.root.dataset.multiplier=String(value);this.root.style.setProperty('--nr-gear',String(value));this.find('[data-cc-factor]').textContent=this.find('[data-cc-top-factor]').textContent=`×${value}`;this.find('[data-cc-energy-fill]').style.width=`${value/5*100}%`;}
 private tickets(count:number,free:boolean){this.find('[data-cc-ticket-count]').textContent=`${count} / 3`;this.find('[data-cc-ticket-help]').textContent=free?translateText('3 флага = ещё 2 вращения'):translateText('3 / 4 / 5+ = 8 / 10 / 12 вращений');this.find('[data-cc-tickets]').querySelectorAll(':scope > span').forEach((cell,i)=>cell.classList.toggle('cc-collected',i<count));}
 private charge(value:number,used:boolean){this.root.dataset.nitroCharge=String(value);this.find('[data-nr-charge]').textContent=used?translateText('НИТРО ИСПОЛЬЗОВАНО'):tr`НИТРО ${value} / 2`;this.find('[data-nr-nitro-help]').textContent=used?translateText('Один рывок за вращение'):value===2?translateText('Рывок сработает при остановке серии'):translateText('Баллоны собираются при выигрыше');}
 private features(view?:NitroView){const bonus=view?.bonus,active=!!bonus?.remaining,spin=view?.spin,frame=spin?.frames.at(-1);this.factor(spin?.multiplierAfter??1);this.charge(frame?.nitroAfter??0,frame?.nitroUsedAfter??false);this.tickets(spin?.flags??0,spin?.kind==='free');this.find('[data-cc-phase-title]').textContent=active?tr`БОНУСНАЯ ГОНКА · ${bonus!.played} / ${bonus!.awarded}`:translateText('ОСНОВНАЯ ИГРА');this.find('[data-cc-free]').textContent=active?tr`${bonus!.remaining} бесплатных вращений`:translateText('Бесплатная гонка');this.find('[data-cc-factor-note]').textContent=active?translateText('Каждое бесплатное вращение начинает с ×2'):translateText('Новое вращение начинает с ×1');}

 private async play(){if(this.blocked()||!this.entered||this.dialog)return;this.bonusRunning=this.session()?.state==='active';await this.request('normal');}
 private async request(mode:'normal'){
  if(this.blocked()||!this.entered||this.dialog)return;const previous=this.session(),active=previous?.state==='active',cost=active?0:Number(this.stake)/100;
  if(this.balance()<cost){this.error=translateText('Недостаточно USDT · Демо для выбранной ставки.');this.stopAuto();this.controls();return;}
  void this.audio.enter();const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:this.motion(),fast:this.fast,before:previous};this.live=live;this.error='';this.root.dataset.animationToken=live.token;this.find('[data-cc-groups]').replaceChildren();this.board.highlight([]);observeExpansionOutcome(this.root,NITRO_GAME,previous,client.accountId,true,true);
  if(!active&&this.autoRemaining)this.autoRemaining--;
  {this.root.dataset.phase='spinning';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);}this.controls();
  try{
   const action=this.sessions.operation(this.stake,mode,previous);
   const promise=client.act(action);live.operationId=client.pending?.id??'';await promise;if(!this.valid(live))return;
   const s=this.session();if(!this.sessions.confirmed(s,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
   await this.present(s,live);if(!this.valid(live))return;
   this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';this.shown=this.key(s);if(s.state==='settled')this.lastWin=s.returnedUnits;this.features(s.view.nitro);this.setTotal(s.view.nitro.totalPayoutUnits);this.controls();observeExpansionOutcome(this.root,NITRO_GAME,s,client.accountId,false,false);
   const v=s.view.nitro;if(s.state==='active'&&(!v.spin||v.spin.kind==='base')){this.stopAuto();this.openDialog('bonus');return;}
   if(s.state==='settled'&&v.history.some(spin=>spin.kind==='free')){this.bonusRunning=false;this.openDialog('complete');return;}
   if(s.state==='active'&&this.bonusRunning||s.state==='settled'&&this.autoRemaining>0)this.schedule();
  }catch(e){if(this.valid(live)){this.error=(e as Error).message;this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.shown='';this.sync();}}
  finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.audio.stopSpin();}}
 }
 private async present(s:Session,live:Live){
  const v=s.view.nitro,spin=v.spin;this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(v.revision);
  let total=Number(v.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);this.factor(spin.multiplierBefore);this.charge(0,false);
  if(!await this.board.settle(live.token,spin.initialGrid)||!this.valid(live))return;this.audio.stopSpin();this.tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.valid(live))return;this.board.clearOverlay();this.board.show(frame.before);this.factor(frame.multiplierBefore);this.charge(frame.nitroBefore,frame.nitroUsedBefore);this.board.highlight(frame.wins.flatMap(w=>w.positions));
   if(frame.wins.length){
    this.root.dataset.phase='winning';this.find('[data-cc-message]').textContent=tr`КАСКАД ${frame.index+1} · ПЕРЕДАЧА ×${frame.multiplierBefore}${frame.energy?tr` · НИТРО +${frame.energy}`:''}`;
    this.find('[data-cc-groups]').innerHTML=frame.wins.map(w=>tr`<span>${nitroSymbol(w.symbol)}<b>Л${w.line+1}: ${coins(w.payoutUnits)}</b></span>`).join('');total+=Number(frame.payoutUnits);this.setTotal(total);this.audio.cascade(frame.index);
    if(live.motion&&!await this.delay(live.fast?160:500,live))return;
    this.factor(frame.multiplierAfter);this.charge(frame.nitroAfter,frame.nitroUsedAfter);if(frame.multiplierAfter>frame.multiplierBefore)this.audio.gear(frame.multiplierAfter);
   }
   if(frame.stop==='nitro'){
    this.root.dataset.phase='nitro';this.root.dataset.charging='true';this.find('[data-cc-message]').textContent=translateText('НИТРО-РЫВОК · ПЕРЕЗАПУСК БЕЗ СТАВКИ');this.audio.boost();this.charge(0,true);
    if(live.motion&&!await this.delay(live.fast?220:650,live))return;
   }
   if(frame.removed.length){
    if(frame.stop!=='nitro')this.root.dataset.phase='bursting';this.board.remove(frame.removed);if(live.motion&&!await this.delay(live.fast?100:220,live))return;
    this.root.dataset.phase='falling';this.audio.drop();if(live.motion){this.board.gravity(frame,live.fast);if(!await this.delay(live.fast?280:600,live))return;}
    this.board.clearOverlay();this.board.show(frame.after);this.board.highlight([]);this.root.dataset.charging='false';this.tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');
   }
  }
  if(!this.valid(live))return;this.board.clearOverlay();this.board.show(spin.finalGrid);this.board.highlight([]);this.features(v);this.setTotal(v.totalPayoutUnits);
  if(spin.freeAward){this.root.dataset.phase='tickets';this.find('[data-cc-message]').textContent=spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:tr`${spin.flags} ФЛАГА · БОНУСНАЯ ГОНКА ОТКРЫТА`;this.audio.tickets();if(live.motion&&!await this.delay(live.fast?250:850,live))return;}
  else this.find('[data-cc-message]').textContent=v.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('12 ПОКАЗОВ ПОЛЯ · ЗАЕЗД ЗАВЕРШЁН'):Number(spin.payoutUnits)>0?translateText('ВЫИГРЫШ ЗАЕЗДА ПОДТВЕРЖДЁН'):s.state==='active'?translateText('БОНУСНАЯ ГОНКА ПРОДОЛЖАЕТСЯ'):translateText('СЛЕДУЮЩИЙ ЗАЕЗД ЖДЁТ НА СТАРТЕ');
  this.audio.outcome(Number(spin.payoutUnits)>0);if(live.motion)await this.delay(live.fast?100:300,live);
 }

 private schedule(){this.playback.schedule(this.fast?140:500,()=>{if(!this.dialog&&!this.blocked()&&(this.bonusRunning||this.autoRemaining))void this.request('normal');});}
 private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();}catch(e){this.error=(e as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
 private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();if(!this.destroyed){this.shown='';this.sync();}}
 private ledger(session:Session){return renderSlotLedger('cc',session.spentUnits,session.state==='active'?session.view.nitro.totalPayoutUnits:session.returnedUnits,session.state==='active');}
 private openDialog(kind:Dialog){this.settings?.close();
  this.dialog=kind;this.dialogShell.begin(kind);if(!kind)return;const box=this.find('[data-cc-dialog]'),s=this.session(),v=s?.view.nitro;
  if(kind==='intro')box.innerHTML=tr`<small>ПОЛНОЧЬ. МОКРЫЙ АСФАЛЬТ. ПОЛНЫЙ БАК.</small><h2 id="cc-dialog-title">NITRO <em>RUN</em></h2><div class="cc-intro-cards"><article><div>${nitroSymbol(4)}${nitroSymbol(5)}</div><h3>20 ЛИНИЙ И КАСКАДЫ</h3><p>Три символа слева дают выигрыш. WILD помогает. Выигрышные символы падают каскадом.</p></article><article><div>${nitroSymbol(8)}<strong>×5</strong></div><h3>РАЗГОН И НИТРО</h3><p>Каждый выигрыш повышает следующую передачу. Два баллона на выигрышных полях дают один бесплатный рывок.</p></article><article><div>${nitroSymbol(7)}</div><h3>БОНУСНАЯ ГОНКА</h3><p>3 / 4 / 5+ флагов в конце дают 8 / 10 / 12 вращений. Каждое начинает со второй передачи.</p></article></div><button type="button" class="cc-primary" data-cc-action="enter">ВЫЙТИ НА СТАРТ</button><p class="cc-dialog-note">Виртуальные USDT · вход без ставки</p>`;
  if(kind==='bonus')box.innerHTML=tr`<small>ФИНИШНЫЕ ФЛАГИ СОБРАНЫ</small><h2 id="cc-dialog-title">БОНУСНАЯ ГОНКА</h2><div class="cc-bonus-art">${nitroSymbol(7)}<strong>${v?.bonus?.remaining??8}<small>БЕСПЛАТНЫХ ВРАЩЕНИЙ</small></strong>${nitroSymbol(8)}</div><p>Каждое вращение начинает со второй передачи ×2. Три флага на конечном поле добавляют ещё два вращения, максимум 20 за весь раунд. Нитро заряжается заново в каждом вращении.</p><button type="button" class="cc-primary" data-cc-action="bonus">НАЧАТЬ ГОНКУ</button><p class="cc-dialog-note">Продолжение бесплатно. Ставка уже принята.</p>`;
  if(kind==='complete'&&s)box.innerHTML=renderSlotResult({style:'cc',eyebrow:translateText('ФИНИШНАЯ ЧЕРТА'),title:translateText('ИТОГ БОНУСНОЙ ГОНКИ'),returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата уже зачислена в кошелёк один раз.'),label:translateText('ПРОДОЛЖИТЬ')});
  if(kind==='history')box.innerHTML=renderSlotHistory({style:'cc',eyebrow:translateText('БОРТОВОЙ ЖУРНАЛ'),title:translateText('ИСТОРИЯ ЗАЕЗДА'),ledger:s?this.ledger(s):undefined,status:s?.state==='active'?translateText('Гонка сохранена. Выплата поступит после финиша.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появится подтверждённая история раунда.'),rows:v?.history.map(spin=>({title:tr`${spin.kind==='base'?translateText('Основное'):translateText('Бесплатное')} вращение ${slotSpinNumber(spin,v!.history)}`,detail:tr`${spin.frames.filter(f=>f.wins.length).length} каскадов · передача ×${spin.multiplierAfter} · ${spin.frames.some(f=>f.stop==='nitro')?translateText('нитро-рывок · '):''}${spin.flags} флагов${spin.freeAward?tr` · +${spin.freeAward} вращений`:''}`,payoutUnits:spin.payoutUnits}))??[]});
  if(kind==='info')box.innerHTML=renderSlotInfo({style:'cc',eyebrow:translateText('БРИФИНГ ПЕРЕД СТАРТОМ'),title:translateText('КАК ИГРАЕТ НИТРО-ЗАЕЗД'),reduced:this.manualReduced,motionSetting:false,bodyHtml:tr`<h3>20 линий, одна общая ставка</h3><p>${escape(NITRO_RULES)}</p><h3>Разгон со следующего каскада</h3><p>Обычное вращение начинает с ×1, бесплатное с ×2. Выигрыш оплачивается на текущей передаче, затем следующая повышается на один до ×5. Между вращениями передача не сохраняется.</p><h3>Нитро-рывок</h3><p>Баллоны собираются только при выигрыше на поле и исчезают вместе с выигрышными символами. Нужно два за одно вращение. При первом поле без выигрыша нитро сжигается и целиком перезапускает поле на текущей передаче. Только один рывок за вращение. Флаги учитываются только на конечном поле. На 12-м показе или при лимите выплаты поле больше не перезапускается.</p><h3>Таблица выплат от общей ставки, до передачи</h3>${renderSlotPaytable('cc',NITRO_PAYTABLE.map((pay,i)=>({symbolHtml:nitroSymbol(i),name:NITRO_NAMES[i],values:pay.map(n=>`${(n/100).toLocaleString(locale)}×`)})),[translateText('Символ'),'3','4','5','6'])}<p>WILD заменяет обычные символы, на линии платится только лучшая комбинация. Пересекающиеся линии оплачиваются отдельно. Баллон и флаг сами не оплачиваются. Максимум всего раунда: 3 000 ставок. При достижении лимита остаток бонуса завершается. При ограничении последняя линия может оплачиваться частично.</p><h3>Все 20 линий</h3><div class="nr-paylines">${NITRO_LINES.map((line,i)=>`<span><small>${i+1}</small><svg viewBox="0 0 120 100"><polyline points="${line.map((row,col)=>`${col*20+10},${row*20+10}`).join(' ')}"/></svg></span>`).join('')}</div><p>Одна ставка и одна итоговая выплата на раунд. При обрыве связи подтверждается прежний ход. Закрытие или скрытие окна останавливает авто. Бонусная гонка сохраняется. Авто делает выбранные 10, 25 или 50 платных вращений и останавливается при входе в бонус. Покупки бонуса нет.</p><p>Оценка долгосрочного возврата: около 96,2% от суммы ставок, включая бонусы. Это среднее на длинной серии, а не обещание результата отдельного заезда.</p><p class="cc-dialog-note">Собственная игра Royal: оригинальное оформление, звуки и серверная математика. Только тестовый виртуальные USDT клуба.</p>`});
  this.controls();this.dialogShell.focus();
 }

 private closeDialog(){this.dialog='';this.controls();this.dialogShell.hide();}
 private async dialogAction(action:string){if(this.destroyed||!this.assets.ready)return;if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request('normal');}}else if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request('normal');}else{this.closeDialog();if(action==='complete'&&this.autoRemaining)this.schedule();}}
 getAudioState(){return this.audio.state();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel();this.assets.destroy();this.board.destroy();this.audio.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
