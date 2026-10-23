import { t as translateText, tr, locale } from '../i18n/index';
import {AfterglowWardrobeClient} from '../wallet/AfterglowWardrobeClient';
import {AFTER_LOOK_TARGET_UNITS,AFTER_ALBUM_MAX_UNITS,afterAlbumUnlocked,AFTER_GALLERY_ORDER,AFTER_LOOK_RARITIES} from '../shared/afterglowWardrobe';
import {SlotSettings} from './slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from './slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls, slotStakeStep, updateSlotTransport} from './slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable} from './slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from './slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from './slotKit/SlotSessions';
import {bindSlotLifecycle} from './slotKit/SlotLifecycle';
import {afterglowSlot} from './slotKit/nativeSlots';
import {AFTER_GAME,AFTER_BETS,AFTER_PAYTABLE,AFTER_NAMES,AFTER_RULES,AFTER_LINES,AFTER_GIRLS,afterCells,type AfterView} from '../shared/afterglow';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {AfterglowAssets,AFTER_ASSETS,afterCharacterAsset,type AfterAssetName,type AfterAssetState} from './AfterglowAssets';
import {AfterglowAudio} from './AfterglowAudio';
import {AfterglowWinSeries} from './AfterglowVoices';
import {AfterglowBoard} from './AfterglowBoard';
import {AfterglowFeedback} from './AfterglowFeedback';
import {afterSymbol,afterGirl,afterPhoto} from './AfterglowArtwork';
import {SlotPhotoViewer} from './slotKit/SlotPhotoViewer';
import './caramel-carnival.css';
import './afterglow.css';

type Session=NativeSlotSession<'afterglow'>;
type Dialog=''|'intro'|'info'|'history'|'bonus'|'complete'|'album'|'unlock'|'style-unlock';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session};
const preview=Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%6);

/** Presentation consumes confirmed frames. Reopening and retries remain static. */
export class AfterglowUI {
 private artworkKey='';private dialogArtworkVersion=0;
 private wardrobe=new AfterglowWardrobeClient();private winSeries=new AfterglowWinSeries();private lookGirl=0;private lookFollowup:Dialog='';private wardrobeChanged=()=>{if(this.destroyed)return;this.selected=this.wardrobe.profile?.selectedGirl??0;this.loadArtwork();if(!this.live)this.features(this.session()?.view.afterglow);this.controls();};
 private photoViewer:SlotPhotoViewer;private settings?:SlotSettings;private stageSize?:ResizeObserver;private selected=0;private newlyUnlocked:number[]=[];private afterUnlock:Dialog='';
 private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private board:AfterglowBoard;private feedback:AfterglowFeedback;private audio=new AfterglowAudio();private assets:AfterglowAssets;
 private owner=client.accountId;private destroyed=false;private entered=false;private stake='100';private fast=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)');private manualReduced=false;
 private dialog:Dialog='intro';private shown='';private lastWin='0';private error='';private live?:Live;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(afterglowSlot);private autoRemaining=0;private bonusRunning=false;private unsubscribe=()=>{};private unsubscribeVoices=()=>{};
 private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChanged=()=>{this.cancel();this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog==='album'||this.dialog==='unlock'||this.dialog==='style-unlock'?'info':this.dialog))return;
    if(event.code==='Space'&&this.entered&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();void this.play();}
  };
 constructor(private host:HTMLElement){
  try{this.manualReduced=localStorage.getItem('royal-afterglow-reduced')==='1';}catch{}
  host.innerHTML=this.markup();this.root=host.querySelector('[data-afterglow-game]')!;this.photoViewer=new SlotPhotoViewer(this.root,()=>this.controls());
  const stage=host.closest<HTMLElement>('.mini-stage');
  if(stage){const fit=()=>{const r=stage.getBoundingClientRect();for(const[name,value]of Object.entries({top:r.top,left:r.left,width:r.width,height:r.height}))this.root.style.setProperty(`--ag-dialog-${name}`,`${value}px`);};this.stageSize=new ResizeObserver(fit);this.stageSize.observe(stage);fit();}
  this.assets=new AfterglowAssets(state=>this.assetState(state));
  this.board=new AfterglowBoard(this.find('[data-cc-board]'),{phase:value=>{if(this.live)this.root.dataset.phase=value;},stop:col=>{if(this.live)this.audio.stopReel(col);}});
  this.feedback=new AfterglowFeedback(this.root,this.audio,units=>this.setTotal(units));
  this.bind();this.settings=new SlotSettings(this.root,this.find('.cc-footer'),this.find('.cc-tools'),()=>{this.stopAuto();this.controls();});this.unsubscribe=bindSlotLifecycle({changed:this.change,visibility:this.visibility,keyboard:this.keyboard,motion:this.reduced,motionChanged:this.motionChanged,audioChanged:()=>this.controls()});
  this.unsubscribeVoices=this.audio.onVoiceChange(()=>this.voiceControls());this.wardrobe.addEventListener('change',this.wardrobeChanged);this.wardrobe.setAccount(client.accountId);this.sync();this.openDialog('intro');this.loadArtwork();
 }
 private loadArtwork(force=false){
  const profile=this.wardrobe.profile,girl=profile?.selectedGirl??0,look=profile?.selectedLook??0,key=`${girl}:${look}`;
  if(!force&&key===this.artworkKey)return;this.artworkKey=key;void this.assets.loadCurrent(girl,look);
 }
 private find<T extends HTMLElement=HTMLElement>(selector:string):T{return this.root.querySelector<T>(selector)!;}
 private session(){return this.sessions.session(client.sessions);}
 private key(session:Session){return this.sessions.key(session);}
 private balance(){return this.sessions.balance(client,demoWallet);}
 private motion(){return !(this.reduced.matches||this.manualReduced);}
 private blocked(){return this.destroyed||this.photoViewer.isOpen||!!client.accountId&&(!this.wardrobe.profile||this.wardrobe.loading||this.wardrobe.busy||!!this.wardrobe.error)||!this.assets.ready||!!this.live||client.busy||client.loading||!!client.pending||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion')||document.hidden||!client.accountId;}
 private valid(live:Live){return !this.destroyed&&this.playback.current(live,this.live);}
 private delay(ms:number,live:Live){return this.playback.delay(ms,()=>this.valid(live));}
 private stopAuto(){this.autoRemaining=0;this.bonusRunning=false;this.playback.cancelScheduled();}
 private cancel(){this.playback.cancel();this.stopAuto();this.live=undefined;this.feedback.cancel();this.board.cancel();this.audio.pause();this.shown='';this.root.dataset.phase='idle';this.root.dataset.charging='false';resetGameOutcomes(this.root);}
 private assetState(state:AfterAssetState){
  if(this.destroyed)return;
  this.root.dataset.assetState=state.status;
  if(state.status==='ready'){this.root.style.setProperty('--cc-symbols',`url("${AFTER_ASSETS.symbols}")`);this.root.style.setProperty('--cc-background',`url("${AFTER_ASSETS.background}")`);this.features(this.session()?.view.afterglow);}
  this.find<HTMLProgressElement>('[data-cc-load-progress]').max=state.total;this.find<HTMLProgressElement>('[data-cc-load-progress]').value=state.loaded;
  this.find('[data-cc-load-title]').textContent=state.status==='error'?translateText('НЕ УДАЛОСЬ ЗАГРУЗИТЬ СТУДИЮ'):translateText('ГОТОВИМ СТУДИЮ');
  this.find('[data-cc-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и повтори загрузку. Монеты не списываются.'):tr`Изображения: ${state.loaded} из ${state.total}`;
  this.find<HTMLButtonElement>('[data-cc-load-retry]').hidden=state.status!=='error';this.controls();
 }
 private markup(){return tr`<section class="cc-game ag-game" data-afterglow-game data-studio-game="${AFTER_GAME}" data-asset-state="loading" data-phase="idle" aria-label="GIRLHUB">
  <div class="cc-loader" role="status"><span class="cc-loader-spark">✦</span><strong data-cc-load-title>ГОТОВИМ СТУДИЮ</strong><p data-cc-load-note>Изображения: 0 из 3</p><progress data-cc-load-progress max="3" value="0" aria-label="Загрузка оформления"></progress><button type="button" data-cc-load-retry hidden>Повторить загрузку</button></div>
  <header class="cc-heading"><div><small>ROYAL · ТЕСТОВЫЕ МОНЕТЫ</small><h2>GIRL<span>HUB</span></h2></div><p>КАСКАДЫ · ВСПЫШКИ · ФОТОСЕССИЯ</p></header>
  <aside class="cc-tickets ag-model"><button type="button" class="ag-portrait" data-ag-photo aria-label="Посмотреть фото: Алиса"><span data-ag-portrait>${afterGirl(0,0,false)}</span></button><div class="ag-model-caption"><h3 data-ag-girl-name>АЛИСА</h3><div class="ag-album-progress"><strong data-ag-album-count>Основной образ</strong><span data-ag-next>Открывай второй образ</span><progress data-ag-progress max="400000" value="0" aria-label="Прогресс второго образа"></progress></div></div><div class="cc-series"><strong data-cc-free>Фотосессия ждёт</strong><div><button type="button" data-cc-pause disabled>На паузе</button></div></div></aside>
  <div class="cc-scene"><div class="cc-stage"><div class="cc-stage-heading"><span data-cc-phase-title>ОСНОВНАЯ ИГРА</span><b>14 ЛИНИЙ</b></div><div class="cc-awning"></div><div class="cc-board-frame"><div class="cc-board" data-cc-board role="group" aria-label="Шесть барабанов, пять рядов"></div></div><div class="cc-board-foot"></div></div>
  <aside class="cc-energy"><div class="cc-factor-card"><h3>ЯЧЕЙКИ ПОД СВЕТОМ</h3><strong data-cc-factor>×1</strong><small data-cc-factor-note>Вспышки заряжают ячейки до ×4</small></div><div class="ag-camera-card"><span>${afterSymbol(7)}</span><strong data-cc-ticket-count>0 / 3</strong><p data-cc-ticket-help>3 / 4 / 5+ камер = 8 / 10 / 12 вращений</p></div><div class="ag-pin-card"><span>${afterSymbol(6)}</span><strong data-ag-pins>0 / 3 WILD</strong><p>Закрепляются в фотосессии</p></div><div class="ag-side-actions"><button type="button" class="cc-buy" data-cc-buy aria-label="Правила бонусной фотосессии"><strong>О бонусе</strong><b aria-hidden="true">ⓘ</b></button><button type="button" data-ag-album aria-label="Открыть альбом">Альбом</button></div></aside></div>
  <div class="cc-results"><p data-cc-message>Нажми «Вращать», чтобы начать фотосессию</p><div><span><small>ВЫИГРЫШ РАУНДА</small> <strong data-cc-total data-units="0">0,00</strong></span><div class="cc-groups" data-cc-groups></div></div></div>
  <div class="cc-controls"><div class="cc-balance"><small>БАЛАНС</small><strong data-cc-balance>0,00</strong><span>Тестовый кошелёк клуба</span></div><div class="cc-last"><small>ПОСЛЕДНИЙ ВЫИГРЫШ</small><strong data-cc-last>0,00</strong></div><div class="cc-stake"><label for="ag-stake">СТАВКА</label><div><button type="button" data-cc-stake-step="-1" aria-label="Уменьшить ставку">−</button><select id="ag-stake" data-cc-stake aria-label="Ставка">${AFTER_BETS.map(n=>`<option value="${n}">${coins(n)}</option>`).join('')}</select><button type="button" data-cc-stake-step="1" aria-label="Увеличить ставку">+</button></div><small data-cc-cost>За ход: 1,00</small></div><button type="button" class="cc-spin" data-cc-spin aria-label="Вращать барабаны"><b>⟳</b><span data-cc-spin-label>ВРАЩАТЬ</span></button><div class="cc-auto-controls"><button type="button" data-cc-speed aria-pressed="false">ОБЫЧНО ×1</button><div><select data-cc-auto-count aria-label="Число платных автовращений"><option>10</option><option>25</option><option>50</option></select><button type="button" data-cc-auto aria-pressed="false">Авто</button></div></div><div class="cc-tools"><button type="button" data-cc-info aria-label="Правила игры">ⓘ</button><button type="button" data-cc-music aria-label="Выключить музыку">♫</button><button type="button" data-cc-sound aria-label="Выключить звук">♪</button><button type="button" data-cc-history aria-label="История игры">☷</button></div></div>
  <div class="cc-wallet-help" data-cc-wallet-help><span data-cc-wallet-note></span><a href="/" data-cc-login>Войти в клуб для тестовой игры</a><button type="button" data-cc-wallet>Открыть тестовый кошелёк</button></div><div class="cc-feedback" data-cc-feedback><p data-cc-status role="status"></p><p data-cc-error role="alert"></p><button type="button" data-cc-retry hidden>Проверить прежний ход</button></div>
  <footer class="cc-footer"><label>Громкость <input type="range" min="0" max="100" data-cc-volume aria-label="Громкость игры"></label><section class="ag-voice-settings" aria-label="Голосовые реакции"><label><input type="checkbox" data-ag-voices> Голосовые реакции</label><label>Громкость голосов <input type="range" min="0" max="100" data-ag-voice-volume aria-label="Громкость голосов"></label><button type="button" data-ag-voice-preview>Прослушать реакцию</button><small data-ag-voice-status role="status"></small></section><label><input type="checkbox" data-ag-reduce> Показ без анимаций</label><span>Собственная игра Royal · тестовые монеты</span><button type="button" data-cc-refresh>Проверить состояние</button></footer><div class="cc-dialog-backdrop" data-cc-backdrop><div class="cc-dialog" data-cc-dialog role="dialog" aria-modal="true" aria-labelledby="cc-dialog-title"></div></div></section>`;}
 private bind(){
    this.dialogShell=new SlotDialog(this.find('[data-cc-dialog]'),this.find('[data-cc-backdrop]'),'data-cc-action',action=>void this.dialogAction(action),()=>this.closeDialog());
    this.stakeControls=new SlotStakeControls({
      values:AFTER_BETS,select:this.find<HTMLSelectElement>('[data-cc-stake]'),
      steps:Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cc-stake-step]')),
      direction:button=>Number(button.getAttribute('data-cc-stake-step')),current:()=>this.stake,
      locked:()=>this.blocked()||this.session()?.state==='active'||this.autoRemaining>0||!!this.dialog,
      changed:stake=>{this.stake=stake;this.controls();},
    });
    this.soundControls=new SlotAudioControls({
      sound:this.find<HTMLButtonElement>('[data-cc-sound]'),music:this.find<HTMLButtonElement>('[data-cc-music]'),
      volume:this.find<HTMLInputElement>('[data-cc-volume]'),audio:this.audio,entered:()=>this.entered,dynamicGlyph:false,
    });

  this.find<HTMLInputElement>('[data-ag-voices]').onchange=e=>this.audio.setVoiceEnabled((e.target as HTMLInputElement).checked);
  this.find<HTMLInputElement>('[data-ag-voice-volume]').oninput=e=>this.audio.setVoiceLevel(Number((e.target as HTMLInputElement).value)/100);
  this.find<HTMLButtonElement>('[data-ag-voice-preview]').onclick=()=>void this.audio.previewVoice();
  this.find<HTMLButtonElement>('[data-cc-load-retry]').onclick=()=>this.loadArtwork(true);this.find<HTMLButtonElement>('[data-cc-spin]').onclick=()=>void this.play();
  this.find<HTMLButtonElement>('[data-ag-photo]').onclick=()=>this.openPhoto(this.selected,this.wardrobe.profile?.selectedLook??0);
  this.find<HTMLButtonElement>('[data-ag-album]').onclick=()=>{this.stopAuto();this.openDialog('album');};
  this.find<HTMLButtonElement>('[data-cc-buy]').onclick=()=>{this.stopAuto();this.openDialog('info');};this.find<HTMLButtonElement>('[data-cc-pause]').onclick=()=>{this.bonusRunning=false;this.playback.cancelScheduled();this.controls();};
  this.find<HTMLButtonElement>('[data-cc-speed]').onclick=()=>{this.fast=!this.fast;this.controls();};this.find<HTMLButtonElement>('[data-cc-auto]').onclick=()=>{if(this.autoRemaining){this.stopAuto();this.controls();}else if(!this.blocked()&&!this.dialog&&this.entered&&this.session()?.state!=='active'){this.autoRemaining=Number(this.find<HTMLSelectElement>('[data-cc-auto-count]').value);void this.request('normal');}};
  this.find<HTMLButtonElement>('[data-cc-info]').onclick=()=>{this.stopAuto();this.openDialog('info');};this.find<HTMLButtonElement>('[data-cc-history]').onclick=()=>{this.stopAuto();this.openDialog('history');};
  this.find<HTMLButtonElement>('[data-cc-retry]').onclick=()=>void this.retry();this.find<HTMLButtonElement>('[data-cc-refresh]').onclick=()=>void this.refresh();this.find<HTMLButtonElement>('[data-cc-wallet]').onclick=()=>{this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));};
  this.find<HTMLInputElement>('[data-ag-reduce]').onchange=e=>{this.manualReduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('royal-afterglow-reduced',this.manualReduced?'1':'0');}catch{}this.cancel();this.sync();};
 }
 private controls(){
  if(this.destroyed)return;const s=this.session(),active=s?.state==='active',blocked=this.blocked();if(active)this.stake=s.stakeUnits;
  this.find<HTMLInputElement>('[data-ag-reduce]').checked=this.manualReduced;this.find<HTMLInputElement>('[data-ag-reduce]').disabled=!!this.live||client.busy||!!client.pending;this.root.dataset.reducedMotion=String(!this.motion());this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(s?.view.afterglow.bonus?.remaining??0);this.root.setAttribute('aria-busy',String(!this.assets.ready||!!this.live||client.busy));
  this.find('[data-cc-balance]').textContent=coins((this.live?.balance??this.balance())*100);this.find('[data-cc-last]').textContent=coins(this.lastWin);
  this.find<HTMLButtonElement>('[data-cc-spin]').disabled=blocked||!this.entered||!!this.dialog;this.find('[data-cc-spin-label]').textContent=this.live?translateText('ВРАЩЕНИЕ'):active?translateText('ПРОДОЛЖИТЬ'):translateText('ВРАЩАТЬ');
     this.stakeControls.update();
this.find('[data-cc-cost]').textContent=active?translateText('Продолжение бесплатно'):tr`За ход: ${coins(this.stake)}`;this.find<HTMLButtonElement>('[data-ag-photo]').disabled=!this.assets.ready||!!this.live||client.busy||!!client.pending;this.find<HTMLButtonElement>('[data-ag-album]').disabled=blocked||!!this.dialog;this.find<HTMLButtonElement>('[data-cc-buy]').disabled=blocked||!!this.dialog||this.autoRemaining>0||!this.entered;
     updateSlotTransport(this.root,'cc',{blocked,active,live:!!this.live,dialog:!!this.dialog,entered:this.entered,fast:this.fast,autoRemaining:this.autoRemaining,bonusRunning:this.bonusRunning,paidBonus:false,pending:!!client.pending,busy:client.busy,hidden:document.hidden,ready:this.assets.ready});
   this.find('[data-cc-error]').textContent=this.error||client.error||this.wardrobe.error;this.find('[data-cc-feedback]').dataset.error=String(!!(this.error||client.error||this.wardrobe.error));
this.find('[data-cc-status]').textContent=client.loading?translateText('Проверяем сохранённую фотосессию…'):this.live?'':client.pending?translateText('Ход сохранён. Подтверди прежнюю операцию.'):this.autoRemaining?tr`Платных вращений осталось: ${this.autoRemaining}`:active?this.bonusRunning?translateText('Фотосессия продолжается бесплатно.'):translateText('Фотосессия на паузе. Нажми «Продолжить».'):'';
  this.find('[data-cc-wallet-help]').hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);this.find('[data-cc-wallet-note]').textContent=client.accountId?translateText('Недостаточно тестовых монет для ставки.'):translateText('Для игры нужен общий тестовый кошелёк клуба.');this.find('[data-cc-login]').hidden=!!client.accountId;this.find('[data-cc-wallet]').hidden=!client.accountId;
   this.soundControls?.update();this.voiceControls();
  const enter=this.root.querySelector<HTMLButtonElement>('[data-cc-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ ФОТОСЕССИЮ'):translateText('ВОЙТИ В СТУДИЮ');}
 }
 private voiceControls(){
  if(this.destroyed)return;const v=this.audio.state().vocal;
  this.find<HTMLInputElement>('[data-ag-voices]').checked=v.enabled;
  const volume=this.find<HTMLInputElement>('[data-ag-voice-volume]');volume.value=String(Math.round(v.level*100));volume.disabled=!v.enabled;
  this.find<HTMLButtonElement>('[data-ag-voice-preview]').disabled=v.muted||!v.enabled||v.level===0||v.loading||!!v.activeSources;
  this.find('[data-ag-voice-status]').textContent=v.muted?translateText('Включи звук игры, чтобы услышать голоса'):!v.enabled?translateText('Голосовые реакции выключены'):v.level===0?translateText('Громкость голосов установлена на ноль'):v.loading?translateText('Загружаем голоса…'):v.activeSources?translateText('Звучит реакция'):v.failures&&v.ready===0?translateText('Голоса временно недоступны. Нажми прослушивание для повтора.'):v.ready?translateText('Победные серии, крупные выигрыши и бонусы'):translateText('Нажми прослушивание, чтобы проверить звук');
 }
 private sync(){
  if(this.destroyed)return;
  if(this.owner!==client.accountId){this.photoViewer.close();this.cancel();this.audio.pause();this.owner=client.accountId;this.winSeries.reset();this.selected=0;this.wardrobe.setAccount(client.accountId);this.entered=false;this.lastWin='0';this.stake='100';this.openDialog('intro');}
  const s=this.session();if(!this.live&&(!s||this.shown!==this.key(s))){
   this.board.clearOverlay();this.board.highlight([]);this.board.show(s?.view.afterglow.spin?.finalGrid??preview);this.root.dataset.phase='idle';this.root.dataset.charging='false';
   if(s){this.shown=this.key(s);this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(s.view.afterglow.revision);if(s.state==='settled')this.lastWin=s.returnedUnits;this.setTotal(s.view.afterglow.totalPayoutUnits);this.features(s.view.afterglow);this.find('[data-cc-message]').textContent=s.state==='active'?translateText('Фотосессия сохранена. Продолжение без ставки.'):translateText('Раунд завершён. Выплата уже в кошельке.');}
   else{this.shown='';this.setTotal('0');this.features();this.find('[data-cc-message]').textContent=translateText('Нажми «Вращать», чтобы начать фотосессию');}
  }
  this.controls();observeExpansionOutcome(this.root,AFTER_GAME,s,client.accountId,!!this.live||client.busy,!!client.pending);
 }
 private setTotal(value:string|number){this.find('[data-cc-total]').textContent=coins(value);this.find('[data-cc-total]').dataset.units=String(value);}
 private factor(value:number){this.root.dataset.multiplier=String(value);this.find('[data-cc-factor]').textContent=`×${value}`;}
 private tickets(count:number,free:boolean){this.find('[data-cc-ticket-count]').textContent=`${count} / 3`;this.find('[data-cc-ticket-help]').textContent=free?translateText('3 камеры = ещё 2 вращения'):translateText('3 / 4 / 5+ камер = 8 / 10 / 12 вращений');}
 private features(view?:AfterView){
  const spin=view?.spin,bonus=view?.bonus,active=!!bonus?.remaining,cells=spin?.cellsAfter??afterCells(),pins=spin?.pinsAfter??[];this.factor(Math.max(...cells));this.board.features(cells,pins);this.tickets(spin?.cameras??0,spin?.kind==='free');
  this.find('[data-cc-phase-title]').textContent=active?tr`ФОТОСЕССИЯ · ${bonus!.played} / ${bonus!.awarded}`:translateText('ОСНОВНАЯ ИГРА');this.find('[data-cc-free]').textContent=active?tr`${bonus!.remaining} бесплатных вращений`:translateText('Фотосессия ждёт');this.find('[data-cc-factor-note]').textContent=active?translateText('Заряд ячеек сохраняется до конца фотосессии'):translateText('Вспышки заряжают ячейки до ×4');this.find('[data-ag-pins]').textContent=`${pins.length} / 3 WILD`;
  const profile=this.wardrobe.profile,selected=profile?.selectedGirl??0,look=profile?.selectedLook??0,points=profile?.pointsUnits[selected]??0;
  this.selected=selected;const portrait=this.find('[data-ag-portrait]'),portraitKey=`${selected}:${look}`;if(portrait.dataset.look!==portraitKey){portrait.innerHTML=afterGirl(selected,look,true);portrait.dataset.look=portraitKey;}this.find('[data-ag-photo]').setAttribute('aria-label',tr`Посмотреть фото: ${AFTER_GIRLS[selected].name}, ${look===1?translateText('второй'):translateText('основной')} образ`);this.find('[data-ag-girl-name]').textContent=AFTER_GIRLS[selected].name;
  this.find('[data-ag-album-count]').textContent=look===1?translateText('Второй образ'):translateText('Основной образ');this.find('[data-ag-next]').textContent=profile?.unlocked[selected]?tr`Второй образ открыт · ${AFTER_LOOK_RARITIES[selected]}`:translateText('Открывай второй образ');const progress=this.find<HTMLProgressElement>('[data-ag-progress]');progress.max=AFTER_LOOK_TARGET_UNITS[selected];progress.value=points;progress.setAttribute('aria-label',translateText('Прогресс второго образа'));progress.setAttribute('aria-valuetext',profile?.unlocked[selected]?translateText('Образ открыт'):translateText('Образ открывается'));

 }

 private async play(){if(this.blocked()||!this.entered||this.dialog)return;this.bonusRunning=this.session()?.state==='active';await this.request('normal');}
 private async request(mode:'normal'){
  if(this.blocked()||!this.entered||this.dialog)return;const previous=this.session(),active=previous?.state==='active',cost=active?0:Number(this.stake)/100;
  if(this.balance()<cost){this.error=translateText('Недостаточно тестовых монет для выбранной ставки.');this.stopAuto();this.controls();return;}
  const playedGirl=this.wardrobe.profile?.selectedGirl??0,wasOpen=this.wardrobe.profile?.unlocked[playedGirl]??false,wasAvailable=afterAlbumUnlocked(this.wardrobe.profile?.albumUnits??0);
  this.feedback.cancel();this.feedback.focusBoard();void this.audio.enter();const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:this.motion(),fast:this.fast,before:previous};this.live=live;this.error='';this.root.dataset.animationToken=live.token;this.find('[data-cc-groups]').replaceChildren();this.board.highlight([]);observeExpansionOutcome(this.root,AFTER_GAME,previous,client.accountId,true,true);
  if(!active&&this.autoRemaining)this.autoRemaining--;
  {this.board.features(active?previous!.view.afterglow.bonus!.cells:afterCells(),active?previous!.view.afterglow.bonus!.pins:[]);this.root.dataset.phase='spinning';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);}this.controls();
  try{
   const original=this.sessions.operation(this.stake,mode,previous),profile=this.wardrobe.profile;
   const action=original.action==='start'&&profile?{...original,appearance:{girl:profile.selectedGirl,look:profile.selectedLook,revision:profile.revision}}:original;
   const promise=client.act(action);live.operationId=client.pending?.id??'';await promise;if(!this.valid(live))return;
   const s=this.session();if(!this.sessions.confirmed(s,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
   await this.present(s,live);if(!this.valid(live))return;
   await this.wardrobe.refresh();if(!this.valid(live))return;
   this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';this.shown=this.key(s);if(s.state==='settled')this.lastWin=s.returnedUnits;this.features(s.view.afterglow);this.setTotal(s.view.afterglow.totalPayoutUnits);this.controls();observeExpansionOutcome(this.root,AFTER_GAME,s,client.accountId,false,false);
   const v=s.view.afterglow;let next:Dialog=s.state==='active'&&v.spin.kind==='base'?'bonus':s.state==='settled'&&v.history.some(spin=>spin.kind==='free')?'complete':'';
   if(!wasOpen&&this.wardrobe.profile?.unlocked[playedGirl]){this.lookGirl=playedGirl;this.lookFollowup=next;next='style-unlock';}
   this.newlyUnlocked=afterAlbumUnlocked(this.wardrobe.profile?.albumUnits??0).flatMap((open,index)=>open&&!wasAvailable[index]?[index]:[]);
   if(this.newlyUnlocked.length){this.stopAuto();this.afterUnlock=next;this.features(v);this.openDialog('unlock');return;}
   if(next){this.stopAuto();this.openDialog(next);return;}

   if(s.state==='active'&&this.bonusRunning||s.state==='settled'&&this.autoRemaining>0)this.schedule();
  }catch(e){if(this.valid(live)){this.error=(e as Error).message;this.stopAuto();this.live=undefined;this.feedback.cancel();this.board.cancel();this.audio.pause();this.shown='';this.sync();}}
  finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.audio.stopSpin();}}
 }
 private async present(s:Session,live:Live){
  const v=s.view.afterglow,spin=v.spin;this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(v.revision);let total=Number(v.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);this.board.features(spin.cellsBefore,spin.pinsBefore);
  if(!await this.board.settle(live.token,spin.initialGrid)||!this.valid(live))return;this.audio.stopSpin();this.tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.valid(live))return;this.board.clearOverlay();this.board.show(frame.before);this.board.features(frame.cellsBefore,frame.pinsAfter);this.factor(Math.max(...frame.cellsBefore));this.board.highlight(frame.wins.flatMap(w=>w.positions));
   if(frame.pinsAfter.length>frame.pinsBefore.length){if(!await this.feedback.feature('pin',frame.pinsAfter.filter(p=>!frame.pinsBefore.includes(p)),live.motion,live.fast,()=>this.valid(live),()=>{this.find('[data-ag-pins]').textContent=`${frame.pinsAfter.length} / 3 WILD`;}))return;}
   if(!frame.wins.length)break;
   this.root.dataset.phase='winning';this.find('[data-cc-message]').textContent=tr`КАСКАД ${frame.index+1} · ${frame.wins.length} ЛИНИЙ${frame.flashes.length?tr` · ${frame.flashes.length} ВСПЫШКИ`:''}`;this.find('[data-cc-groups]').innerHTML=frame.wins.map(w=>tr`<span>${afterSymbol(w.symbol)}<b>Л${w.line+1} ×${w.factor}: ${coins(w.payoutUnits)}</b></span>`).join('');const from=total;total+=Number(frame.payoutUnits);
   if(!await this.feedback.combination(frame,from,total,live.motion,live.fast,()=>this.valid(live)))return;
   if(frame.flashes.length){this.root.dataset.phase='flash';if(!await this.feedback.feature('charge',frame.flashes,live.motion,live.fast,()=>this.valid(live),()=>{this.board.features(frame.cellsAfter,frame.pinsAfter);this.factor(Math.max(...frame.cellsAfter));for(const p of frame.flashes)this.find(`[data-ag-cell="${p}"]`).classList.add('ag-feature-cell');}))return;}
   if(frame.removed.length){this.root.dataset.phase='bursting';this.board.remove(frame.removed);if(live.motion&&!await this.delay(live.fast?100:220,live))return;this.root.dataset.phase='falling';this.audio.drop();if(live.motion){this.board.gravity(frame,live.fast);if(!await this.delay(live.fast?280:600,live))return;}this.board.clearOverlay();this.board.show(frame.after);this.tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');}
  }
  if(!this.valid(live))return;this.board.clearOverlay();this.board.show(spin.finalGrid);this.board.highlight([]);this.features(v);this.setTotal(v.totalPayoutUnits);
  if(spin.freeAward){this.root.dataset.phase='tickets';this.find('[data-cc-message]').textContent=spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:tr`${spin.cameras} КАМЕРЫ · ФОТОСЕССИЯ ОТКРЫТА`;if(!await this.feedback.feature('bonus',spin.finalGrid.flatMap((symbol,p)=>symbol===7?[p]:[]),live.motion,live.fast,()=>this.valid(live),()=>this.audio.bonusVoice()))return;}
  else this.find('[data-cc-message]').textContent=v.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('10 ПОКАЗОВ ПОЛЯ · ВЫИГРЫШ СОХРАНЁН'):spin.frames.at(-1)?.stop==='held-line'?translateText('ЗАКРЕПЛЁННАЯ ЛИНИЯ ОПЛАЧЕНА'):Number(spin.payoutUnits)>0?translateText('ВЫИГРЫШ ПОДТВЕРЖДЁН'):s.state==='active'?translateText('ФОТОСЕССИЯ ПРОДОЛЖАЕТСЯ'):translateText('РАУНД ЗАВЕРШЁН');
  if(s.state==='settled'){
   this.root.dataset.phase='result';const voice=this.winSeries.accept(s);
   await this.feedback.finish(s.spentUnits,s.returnedUnits,live.motion,live.fast,()=>this.valid(live),()=>{if(voice)this.audio.reaction();});
  }else if(!spin.freeAward)this.find('[data-cc-message]').textContent=translateText('Фотосессия продолжается. Выплата после завершения раунда.');
 }

 private schedule(){this.playback.schedule(this.fast?140:500,()=>{if(!this.dialog&&!this.blocked()&&(this.bonusRunning||this.autoRemaining))void this.request('normal');});}
 private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();await this.wardrobe.refresh();}catch(e){this.error=(e as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
 private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();await this.wardrobe.refresh();if(!this.destroyed){this.shown='';this.sync();}}
 private ledger(session:Session){return renderSlotLedger('cc',session.spentUnits,session.state==='active'?session.view.afterglow.totalPayoutUnits:session.returnedUnits,session.state==='active');}
 private openDialog(kind:Dialog){
  const version=++this.dialogArtworkVersion;
  const available=afterAlbumUnlocked(this.wardrobe.profile?.albumUnits??0);
  const needed:AfterAssetName[]=kind==='album'?AFTER_GALLERY_ORDER.filter(index=>available[index]).map(index=>afterCharacterAsset(index,this.wardrobe.profile?.selectedGirl===index?this.wardrobe.profile.selectedLook:0)):kind==='style-unlock'?[afterCharacterAsset(this.lookGirl,1)]:kind==='unlock'?this.newlyUnlocked.map(index=>afterCharacterAsset(index)):[];
  if(needed.some(name=>!this.assets.has(name))){
   this.settings?.close();this.dialog=kind;this.dialogShell.begin('info');
   const box=this.find('[data-cc-dialog]');box.innerHTML=tr`<h2 id="cc-dialog-title">Загружаем фото</h2><p role="status">Подготавливаем изображения альбома…</p><button type="button" data-cc-action="close">Вернуться в игру</button>`;this.controls();this.dialogShell.focus();
   void this.assets.ensure(needed).then(ready=>{
    if(this.destroyed||version!==this.dialogArtworkVersion||this.dialog!==kind)return;
    if(ready)this.openDialog(kind);
    else{box.innerHTML=tr`<h2 id="cc-dialog-title">Не удалось загрузить фото</h2><p role="alert">Проверь соединение и повтори попытку.</p><button type="button" data-cc-action="artwork-retry">Повторить загрузку</button><button type="button" data-cc-action="close">Вернуться в игру</button>`;this.dialogShell.focus();}
   });return;
  }
  this.settings?.close();this.dialog=kind;this.dialogShell.begin(kind==='album'||kind==='unlock'||kind==='style-unlock'?'info':kind);if(!kind)return;const box=this.find('[data-cc-dialog]'),s=this.session(),v=s?.view.afterglow;
  if(kind==='intro')box.innerHTML=tr`<small>СВЕТ. КАМЕРА. ТВОЯ КОЛЛЕКЦИЯ.</small><h2 id="cc-dialog-title">GIRL<span>HUB</span></h2><div class="cc-intro-cards"><article><div>${afterSymbol(6)}${afterSymbol(8)}</div><h3>14 ЛИНИЙ И ВСПЫШКИ</h3><p>Выигрышные символы падают каскадом. Вспышки заряжают ячейки до ×4 для следующих комбинаций.</p></article><article><div>${afterSymbol(7)}</div><h3>БОНУСНАЯ ФОТОСЕССИЯ</h3><p>Камеры дают бесплатные вращения. До трёх WILD закрепляются, заряд ячеек сохраняется.</p></article><article><div class="ag-intro-girl">${afterGirl(available[this.selected]?this.selected:0)}</div><h3>ОТКРЫВАЙ ГЕРОИНЬ</h3><p>Героини открываются по общему прогрессу. Второй образ каждой героини открывается за игру с ней. Прогресс пропорционален сумме принятых ставок и не зависит от выигрыша или проигрыша.</p></article></div><button type="button" class="cc-primary" data-cc-action="enter">ВОЙТИ В СТУДИЮ</button><p class="cc-dialog-note">Тестовые монеты клуба · вход без ставки</p>`;
  if(kind==='bonus')box.innerHTML=tr`<small>КАМЕРЫ ГОТОВЫ</small><h2 id="cc-dialog-title">ФОТОСЕССИЯ</h2><div class="cc-bonus-art">${afterSymbol(7)}<strong>${v?.bonus?.remaining??8}<small>БЕСПЛАТНЫХ ВРАЩЕНИЙ</small></strong>${afterSymbol(6)}</div><p>До трёх WILD остаются на местах, заряд ячеек сохраняется. Три камеры добавляют два вращения, максимум 20 всего. Линия из закреплённых WILD оплачивается один раз за спин.</p><button type="button" class="cc-primary" data-cc-action="bonus">НАЧАТЬ ФОТОСЕССИЮ</button><p class="cc-dialog-note">Продолжение бесплатно. Ставка уже принята.</p>`;
  if(kind==='complete'&&s)box.innerHTML=renderSlotResult({style:'cc',eyebrow:translateText('СЪЁМКА ЗАВЕРШЕНА'),title:translateText('ИТОГ ФОТОСЕССИИ'),returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата зачислена один раз. Прогресс сохранён в альбоме.'),label:translateText('ПРОДОЛЖИТЬ')});
  if(kind==='album'){const profile=this.wardrobe.profile;box.innerHTML=tr`<small>ТВОЯ КОЛЛЕКЦИЯ</small><h2 id="cc-dialog-title">АЛЬБОМ ГЕРОИНЬ</h2>${this.error?`<p role="alert">${escape(this.error)}</p>`:''}<p>Прогресс зависит от суммы принятых ставок. Для второго образа играй с выбранной героиней. Выигрыш и проигрыш не влияют на открытие.</p><div class="ag-album-progress"><strong>${available.every(Boolean)?translateText('Все героини открыты'):translateText('Открытие новых героинь')}</strong><progress value="${profile?.albumUnits??0}" max="${AFTER_ALBUM_MAX_UNITS}" aria-label="Прогресс альбома" aria-valuetext="${available.every(Boolean)?translateText('Альбом открыт'):translateText('Альбом открывается')}"></progress></div><div class="ag-gallery">${AFTER_GALLERY_ORDER.map(index=>{const girl=AFTER_GIRLS[index],open=available[index],points=profile?.pointsUnits[index]??0,second=profile?.unlocked[index]??false,target=AFTER_LOOK_TARGET_UNITS[index],locked=!!profile?.active||!profile||this.wardrobe.busy;return tr`<article class="ag-gallery-card" data-girl="${index}" data-rarity="${[4,1,3,2][index]}"><span class="ag-rarity">${AFTER_LOOK_RARITIES[index]}</span>${open?tr`<button type="button" class="ag-gallery-portrait" data-cc-action="photo-${index}-${profile?.selectedGirl===index?profile.selectedLook:0}" aria-label="Посмотреть фото: ${girl.name}">${afterGirl(index,profile?.selectedGirl===index?profile.selectedLook:0)}</button>`:'<span class="ag-gallery-portrait"><b>🔒</b></span>'}<strong>${girl.name}</strong><small>${open?second?translateText('Второй образ открыт'):translateText('Открывай второй образ'):translateText('Героиня ещё не открыта')}</small><span class="ag-look-target">${second?translateText('Образ сохранён в коллекции'):translateText('Прогресс за игру с героиней')}</span><progress value="${points}" max="${target}" aria-label="${girl.name}: прогресс второго образа" aria-valuetext="${second?translateText('Образ открыт'):translateText('Образ открывается')}"></progress><div class="ag-gallery-preview"><button type="button" data-cc-action="photo-${index}-0" aria-label="Посмотреть основной образ: ${girl.name}" ${!open?'disabled':''}>Основное фото</button><button type="button" data-cc-action="photo-${index}-1" aria-label="Посмотреть второй образ: ${girl.name}" ${!open||!second?'disabled':''}>${second?translateText('Второе фото'):translateText('🔒 Второе фото')}</button></div><button type="button" aria-label="${girl.name}: основной образ" data-cc-action="girl-${index}" ${!open||locked?'disabled':''}>${profile?.selectedGirl===index&&profile.selectedLook===0?translateText('Основной выбран'):translateText('Основной образ')}</button><button type="button" aria-label="${girl.name}: второй образ" data-cc-action="look-${index}" ${!open||!second||locked?'disabled':''}>${second?(profile?.selectedGirl===index&&profile.selectedLook===1?translateText('Второй выбран'):translateText('Второй образ')):translateText('🔒 Второй образ')}</button></article>`;}).join('')}</div><p>${profile?.active?translateText('Заверши фотосессию для смены образа. Прогресс обновится после завершения раунда.'):translateText('Открытые фото и прежний прогресс сохранены. Ставка учитывается один раз после завершения раунда, включая все бесплатные продолжения.')}</p><button class="cc-primary" type="button" data-cc-action="close">ВЕРНУТЬСЯ В ИГРУ</button>`;}
  if(kind==='style-unlock'){this.audio.album();box.innerHTML=tr`<small>ВТОРОЙ ОБРАЗ ОТКРЫТ</small><h2 id="cc-dialog-title">${AFTER_GIRLS[this.lookGirl].name}</h2><div class="ag-unlocked">${afterGirl(this.lookGirl,1,true)}</div><p>${AFTER_LOOK_RARITIES[this.lookGirl]} образ открыт. Фото сохранено в аккаунте и доступно в альбоме.</p><button class="cc-primary" type="button" data-cc-action="style-use">ВЫБРАТЬ НОВЫЙ ОБРАЗ</button><button type="button" data-cc-action="style-later">ПОЗЖЕ</button>`;}

  if(kind==='unlock'){this.audio.album();box.innerHTML=tr`<small>НОВАЯ ГЕРОИНЯ В КОЛЛЕКЦИИ</small><h2 id="cc-dialog-title">${this.newlyUnlocked.map(i=>AFTER_GIRLS[i].name).join(' · ')}</h2><div class="ag-unlocked">${this.newlyUnlocked.map(i=>`<div>${afterGirl(i)}</div>`).join('')}</div><p>Героиня сохранена в коллекции. Её можно выбрать в альбоме.</p><button type="button" class="cc-primary" data-cc-action="unlock">ПРОДОЛЖИТЬ</button>`;}
  if(kind==='history')box.innerHTML=renderSlotHistory({style:'cc',eyebrow:translateText('ЖУРНАЛ СТУДИИ'),title:translateText('ИСТОРИЯ РАУНДА'),ledger:s?this.ledger(s):undefined,status:s?.state==='active'?translateText('Фотосессия сохранена. Выплата после завершения.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появится подтверждённая история.'),rows:v?.history.map(spin=>({title:tr`${spin.kind==='base'?translateText('Основное'):translateText('Бесплатное')} вращение ${slotSpinNumber(spin,v!.history)}`,detail:tr`${spin.frames.filter(f=>f.wins.length).length} каскадов · ${spin.pinsAfter.length} WILD · заряд до ×${Math.max(...spin.cellsAfter)}${spin.freeAward?tr` · +${spin.freeAward} вращений`:''}`,payoutUnits:spin.payoutUnits}))??[]});
  if(kind==='info')box.innerHTML=renderSlotInfo({style:'cc',eyebrow:translateText('ПРАВИЛА СТУДИИ'),title:translateText('КАК ИГРАЕТ GIRLHUB'),reduced:this.manualReduced,motionSetting:false,bodyHtml:tr`<p>${escape(AFTER_RULES)}</p><h3>Множители ячеек</h3><p>Каждая ячейка начинает с ×1. Вспышки на выигрышном поле исчезают и повышают заряд своей ячейки на один, до ×4. Заряд действует со следующего каскада. На линии берётся наибольший множитель среди её выигрышных ячеек, множители не перемножаются. В обычном спине заряд сбрасывается, в фотосессии сохраняется. При входе в бонус заряд обычного спина сбрасывается.</p><h3>Закреплённые WILD</h3><p>В фотосессии первые три появившиеся WILD закрепляются на своих местах. Остальные WILD заменяют символы как обычно. Если свободных мест меньше, первыми закрепляются WILD в порядке чтения поля. Символы падают в пределах участков между закреплёнными ячейками. Линия целиком из закреплённых WILD оплачивается один раз и закрывается до следующего спина. Другие комбинации на этой линии в том же спине больше не оплачиваются. Остальные выигрышные линии продолжают каскады.</p><h3>Выплаты от общей ставки, до множителя ячеек</h3>${renderSlotPaytable('cc',AFTER_PAYTABLE.map((pay,i)=>({symbolHtml:afterSymbol(i),name:AFTER_NAMES[i],values:pay.map(n=>`${(n/100).toLocaleString(locale)}×`)})),[translateText('Символ'),'3','4','5','6'])}<p>От трёх символов слева. Оплачивается лучшая комбинация на каждой линии с учётом множителей её ячеек. При равной выплате выбирается символ выше в таблице. Пересекающиеся линии оплачиваются отдельно. Максимум всего раунда: 5000 ставок. Последняя линия при достижении предела может оплачиваться частично. Не более 10 показов поля за спин, без лишнего падения после остановки.</p><h3>14 линий</h3><div class="ag-paylines">${AFTER_LINES.map((line,i)=>`<span><small>${i+1}</small><svg viewBox="0 0 120 100"><polyline points="${line.map((row,col)=>`${col*20+10},${row*20+10}`).join(' ')}"/></svg></span>`).join('')}</div><h3>Открытие героинь и образов</h3><p>Общий прогресс альбома открывает новых героинь. У каждой героини есть отдельная полоса второго образа. Прогресс пропорционален сумме принятых ставок: одна тестовая монета ставки даёт одно очко. Выигрыш и проигрыш на него не влияют. Весь раунд, включая бесплатную фотосессию, учитывается один раз после завершения. Прогресс получает героиня, выбранная в начале раунда. Повтор запроса и смена образа не добавляют очки. Открытые ранее фото и накопленный прогресс сохраняются. Редкость влияет на требуемый прогресс: обычный образ, редкий, эпический, легендарный. Оформление и прогресс не меняют вероятности выигрыша.</p><p>Одна ставка за все линии, одна итоговая выплата за раунд. Продолжения фотосессии бесплатны. После потери ответа подтверждается прежняя операция. Закрытие, скрытие окна, ошибка и открытие альбома останавливают авто. Авто останавливается перед бонусом.</p><p class="cc-dialog-note">Собственная игра Royal. Тестовые монеты клуба.</p>`});this.controls();this.dialogShell.focus();
 }

 private openPhoto(index:number,look:0|1){
  if(this.destroyed||!this.assets.ready||this.live||client.busy||client.pending||!Number.isInteger(index)||index<0||index>3)return;
  const profile=this.wardrobe.profile;
  if(!afterAlbumUnlocked(profile?.albumUnits??0)[index]||look===1&&!profile?.unlocked[index])return;
  this.stopAuto();this.photoViewer.open(afterPhoto(index,look),`${AFTER_GIRLS[index].name} · ${look===1?translateText('Второй образ'):translateText('Основной образ')}`);this.controls();
 }

 private closeDialog(){this.dialogArtworkVersion++;this.assets.trim();this.dialog='';this.controls();this.dialogShell.hide();}
 private async dialogAction(action:string){
  if(this.destroyed||!this.assets.ready)return;
  if(action==='artwork-retry'){this.openDialog(this.dialog);return;}
  if(action.startsWith('photo-')){const match=/^photo-([0-3])-([01])$/.exec(action);if(match)this.openPhoto(Number(match[1]),Number(match[2]) as 0|1);return;}
  if(action.startsWith('girl-')||action.startsWith('look-')){const second=action.startsWith('look-'),index=Number(action.slice(5));if(!Number.isInteger(index)||index<0||index>3)return;try{const version=this.dialogArtworkVersion;if(!await this.assets.ensure([afterCharacterAsset(index,second?1:0)]))throw Error(translateText('Не удалось загрузить фото. Повтори попытку.'));if(this.destroyed||version!==this.dialogArtworkVersion)return;if(await this.wardrobe.choose(index,second?1:0)){this.features(this.session()?.view.afterglow);this.closeDialog();}}catch(e){this.error=(e as Error).message;await this.wardrobe.refresh();this.openDialog('album');}return;}
  if(action==='style-use'||action==='style-later'){try{if(action==='style-use'&&!await this.wardrobe.choose(this.lookGirl,1))return;this.closeDialog();const next=this.lookFollowup;this.lookFollowup='';if(next)this.openDialog(next);}catch(e){this.error=(e as Error).message;this.controls();}return;}

  if(action==='unlock'){this.closeDialog();const next=this.afterUnlock;this.afterUnlock='';if(next)this.openDialog(next);return;}
  if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request('normal');}}
  else if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request('normal');}else this.closeDialog();
 }

 getAudioState(){return{...this.audio.state(),feedback:this.feedback.state()};}
 getState(){return this.getAudioState();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.dialogArtworkVersion++;this.photoViewer.destroy();this.unsubscribeVoices();this.stageSize?.disconnect();this.wardrobe.removeEventListener('change',this.wardrobeChanged);this.wardrobe.destroy();this.cancel();this.feedback.destroy();this.assets.destroy();this.board.destroy();this.audio.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
