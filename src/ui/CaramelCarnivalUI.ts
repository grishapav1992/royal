import {canRecoverOperation} from './operationFeedback';
import {confirmedPayout} from '../shared/roundPrecision';
import {ROYAL_GAME_STAKE_UNITS, gameStakeMaximum} from '../shared/gameStakes';
import { t as translateText, tr, locale, language } from '../i18n/index';
import {SlotSettings} from './slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from './slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls} from './slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable} from './slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from './slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from './slotKit/SlotSessions';
import {bindSlotLifecycle} from './slotKit/SlotLifecycle';
import {caramelSlot} from './slotKit/nativeSlots';
import {gameContentLayout} from './GameLayoutPolicy';
import {gameAudio} from '../game/GameAudio';
import {CARAMEL_GAME,CARAMEL_PAYTABLE,CARAMEL_NAMES,type CaramelView,type CaramelFrame} from '../shared/caramelCarnival';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {CaramelCarnivalAssets,CARAMEL_ASSETS,type CaramelAssetState} from './CaramelCarnivalAssets';
import {CaramelCarnivalAudio} from './CaramelCarnivalAudio';
import {CaramelBoard} from './CaramelBoard';
import {caramelSymbol,caramelSymbolName} from './CaramelArtwork';
import './caramel-carnival.css';
import './caramel-candy.css';

type Session=NativeSlotSession<'caramel'>;
type Dialog=''|'intro'|'info'|'history'|'buy'|'bonus'|'complete';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session};
type Speed='normal'|'fast';
const preview=Array.from({length:30},(_,i)=>(i+2*Math.floor(i/6))%7);
const SPEEDS:readonly Speed[]=['normal','fast'];
const AUTO_COUNTS=[10,25,50,100] as const;
const FESTIVAL_PRICE=35;
const maximumStakeCents=gameStakeMaximum(CARAMEL_GAME);
const CARAMEL_BETS=ROYAL_GAME_STAKE_UNITS;
const svg=(body:string,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON={
  info:svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  sound:svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>').replace('<svg','<svg data-ccf-sound-on'),
  muted:svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>').replace('<svg','<svg data-ccf-sound-off'),
  settings:svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  minus:svg('<path d="M5 12h14"/>',18).replace('stroke-width="2"','stroke-width="2.4"'),
  plus:svg('<path d="M5 12h14M12 5v14"/>',18).replace('stroke-width="2"','stroke-width="2.4"'),
  spin:svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',34).replace('stroke-width="2"','stroke-width="2.8"').replace('<svg','<svg class="ccf-spin-icon"'),
  hurry:svg('<path d="M5 6l7 6-7 6M13 6l7 6-7 6"/>',34).replace('stroke-width="2"','stroke-width="2.8"').replace('<svg','<svg class="ccf-hurry-icon"'),
  close:svg('<path d="M6 6l12 12M18 6L6 18"/>',18),
};
const units=(value:string|number)=>Number(value)||0;

/** Presentation consumes confirmed frames. Reopening and retries remain static. */
export class CaramelCarnivalUI {
 private settings?:SlotSettings;
 private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private board:CaramelBoard;private audio=new CaramelCarnivalAudio();private assets:CaramelCarnivalAssets;
 private owner=client.accountId;private destroyed=false;private entered=false;private stake = '10';private speed:Speed='normal';private reduced=matchMedia('(prefers-reduced-motion: reduce)');private manualReduced=false;
 private dialog:Dialog='intro';private shown='';private lastWin='0';private error='';private live?:Live;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(caramelSlot);private autoRemaining=0;private bonusRunning=false;private unsubscribe=()=>{};
 private headbar?:HTMLElement;private toolsHome?:Comment;private autoCount=25;private autoOpen=false;private layout:ResizeObserver;
 private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChanged=()=>{this.cancel();this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(this.autoOpen&&event.key==='Escape'){event.preventDefault();this.closeAuto(true);return;}
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog))return;
    if(event.code==='Space'&&this.entered&&!this.autoOpen&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();this.primary();}
  };
 private outside=(event:PointerEvent)=>{if(!this.autoOpen)return;const target=event.target as Node;if(this.find('[data-cc-auto-panel]').contains(target)||this.find('[data-cc-auto]').contains(target))return;this.closeAuto(false);};
 constructor(private host:HTMLElement){
  try{this.manualReduced=localStorage.getItem('royal-caramel-reduced')==='1';}catch{}
  host.innerHTML=this.markup();this.root=host.querySelector('[data-caramel-game]')!;
  this.assets=new CaramelCarnivalAssets(state=>this.assetState(state));
  this.board=new CaramelBoard(this.find('[data-cc-board]'),{phase:value=>{if(this.live)this.root.dataset.phase=value;},stop:col=>{if(this.live)this.audio.stopReel(col);}});
  this.bind();
  // The shared settings dialog is mounted in its own empty host, so the shared priority layout never
  // moves the lid of the box (tickets, energy, festival) away from the field.
  this.settings=new SlotSettings(this.find('[data-cc-settings-host]'),this.find('[data-cc-settings]'),this.find('.ccf-tools'),()=>{this.stopAuto();this.closeAuto(false);this.controls();});
  const gear=this.root.querySelector<HTMLButtonElement>('.slot-settings-button');if(gear){gear.innerHTML=ICON.settings;gear.setAttribute('aria-label',translateText('Настройки: громкость, музыка, меньше анимации'));}
  this.dock();
  this.layout=new ResizeObserver(()=>this.profile());this.layout.observe(this.root);this.profile();
  this.unsubscribe=bindSlotLifecycle({changed:this.change,visibility:this.visibility,keyboard:this.keyboard,motion:this.reduced,motionChanged:this.motionChanged,audioChanged:()=>this.controls()});
  document.addEventListener('pointerdown',this.outside,true);
  this.sync();this.openDialog('intro');void this.assets.load();
 }
 /** The host keeps native slots at the full stage height once a layout profile is present. */
 private profile(){const {width,height}=this.root.getBoundingClientRect();if(!width||!height)return;const profile=gameContentLayout(width,height);if(this.root.dataset.slotPriority!==profile)this.root.dataset.slotPriority=profile;}
 private find<T extends HTMLElement=HTMLElement>(selector:string):T{return (this.root.querySelector<T>(selector)??this.headbar?.querySelector<T>(selector))!;}
 private set phaseText(text:string){this.find('[data-cc-phase-title]').textContent=text;}
 /** The approved canvas puts rules, sound and settings in the tin header row. */
 private dock(){
  const top=this.root.closest('dialog')?.querySelector<HTMLElement>('.mini-top'),tools=this.root.querySelector<HTMLElement>('.ccf-tools');
  if(!top||!tools)return;
  const bar=document.createElement('div');bar.className='ccf-headbar';bar.dataset.caramelHeader='';
  this.toolsHome=document.createComment('caramel tools');tools.before(this.toolsHome);bar.append(tools);
  top.insertBefore(bar,top.querySelector('#studio-game-list, .settings-shortcut, .game-chat-toggle, [data-close]'));
  this.headbar=bar;this.root.dataset.headerTools='true';
 }
 private undock(){if(!this.headbar)return;const tools=this.headbar.querySelector('.ccf-tools');if(tools&&this.toolsHome?.isConnected)this.toolsHome.replaceWith(tools);this.headbar.remove();this.headbar=undefined;delete this.root.dataset.headerTools;}
 private session(){return this.sessions.session(client.sessions);}
 private key(session:Session){return this.sessions.key(session);}
 private balance(){return this.sessions.balance(client,demoWallet);}
 private motion(){return !(this.reduced.matches||this.manualReduced);}
 private blocked(){return this.destroyed||!this.assets.ready||!!this.live||client.busy||client.loading||!!client.pending||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion')||document.hidden||!client.accountId;}
 private valid(live:Live){return !this.destroyed&&this.playback.current(live,this.live);}
 private delay(ms:number,live:Live){return this.playback.delay(ms,()=>this.valid(live));}
 private stopAuto(){this.autoRemaining=0;this.bonusRunning=false;this.playback.cancelScheduled();}
 private cancel(){this.playback.cancel();this.stopAuto();this.live=undefined;this.board.cancel();this.board.focus([]);this.audio.stopSpin();this.shown='';this.root.dataset.phase='idle';this.root.dataset.charging='false';this.energyChip(0);delete this.root.dataset.cascade;resetGameOutcomes(this.root);}
 private speedLabel(speed:Speed){return speed==='fast'?translateText('Быстро'):translateText('Обычно');}
 private assetState(state:CaramelAssetState){
  if(this.destroyed)return;
  this.root.dataset.assetState=state.status;
  if(state.status==='ready'){this.root.style.setProperty('--cc-symbols',`url("${CARAMEL_ASSETS.symbols}")`);this.root.style.setProperty('--cc-background',`url("${CARAMEL_ASSETS.background}")`);}
  this.find<HTMLProgressElement>('[data-cc-load-progress]').value=state.loaded;
  this.find('[data-cc-load-title]').textContent=state.status==='error'?translateText('НЕ УДАЛОСЬ ЗАГРУЗИТЬ ЯРМАРКУ'):translateText('ГОТОВИМ СЛАДКИЙ ПРАЗДНИК');
  this.find('[data-cc-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и повтори загрузку. Монеты не списываются.'):tr`Изображения: ${state.loaded} из ${state.total}`;
  this.find<HTMLButtonElement>('[data-cc-load-retry]').hidden=state.status!=='error';this.controls();
 }
 private markup(){
  const slots=Array.from({length:4},()=>`<span>${caramelSymbol(7)}</span>`).join('');
  const speeds=SPEEDS.map(speed=>`<button type="button" role="radio" data-cc-speed-option="${speed}" aria-checked="${speed==='normal'}" tabindex="${speed==='normal'?0:-1}">${this.speedLabel(speed)}</button>`).join('');
  const counts=AUTO_COUNTS.map(count=>`<button type="button" role="radio" data-cc-auto-count="${count}" aria-checked="${count===this.autoCount}" tabindex="${count===this.autoCount?0:-1}">${count}</button>`).join('');
  const stakes=CARAMEL_BETS.map(n=>`<option value="${n}">${coins(n)}</option>`).join('');
  return tr`<section class="cc-game ccf" data-caramel-game data-studio-game="${CARAMEL_GAME}" data-asset-state="loading" data-phase="idle" data-spin-state="idle" data-speed="normal" data-festival="false" data-has-win="false" aria-label="Caramel Carnival">
<div class="cc-loader" role="status"><span class="ccf-loader-ring" aria-hidden="true"></span><strong data-cc-load-title>ГОТОВИМ СЛАДКИЙ ПРАЗДНИК</strong><p data-cc-load-note>Изображения: 0 из 2</p><progress data-cc-load-progress max="2" value="0" aria-label="Загрузка оформления"></progress><button type="button" data-cc-load-retry hidden>Повторить загрузку</button></div>
<div class="ccf-scene">
<div class="ccf-tools" role="toolbar" aria-label="Правила, звук и настройки"><button type="button" class="ccf-icon" data-cc-rules aria-label="Правила и выплаты">${ICON.info}</button><button type="button" class="ccf-icon" data-cc-sound-quick aria-label="Выключить звук" aria-pressed="true">${ICON.sound}${ICON.muted}</button></div>
<div class="ccf-frame"><div class="cc-board" data-cc-board role="group" aria-label="Поле: шесть барабанов, пять рядов"></div></div>
<div class="ccf-hinge" aria-hidden="true"><i></i><i></i></div>
<aside class="ccf-lid" aria-label="Билеты, энергия и фестиваль">
<header class="ccf-brand"><h2 class="ccf-wordmark">Caramel<br>Carnival</h2><p class="ccf-mode" data-cc-phase-title>8+ одинаковых в любом месте</p></header>
<section class="ccf-tickets" aria-labelledby="ccf-tickets-title"><header><h3 id="ccf-tickets-title"><span class="ccf-long">Билеты фестиваля</span><span class="ccf-short" aria-hidden="true">Билеты</span></h3><strong data-cc-ticket-count></strong></header><div class="ccf-slots" data-cc-tickets>${slots}</div><p data-cc-ticket-help>4 билета после каскадов: 10 бесплатных вращений</p></section>
<section class="ccf-energy" aria-labelledby="ccf-energy-title"><header><h3 id="ccf-energy-title"><span class="ccf-long">Энергия волчка</span><span class="ccf-short" aria-hidden="true">Энергия</span></h3><span class="ccf-energy-chip" data-cc-energy-chip hidden></span></header><div class="ccf-energy-main"><svg class="ccf-dial" viewBox="0 0 220 128" aria-hidden="true" focusable="false"><path class="ccf-dial-track" d="M28 108 A82 82 0 0 1 192 108"/><path class="ccf-dial-fill" data-cc-energy-fill d="M28 108 A82 82 0 0 1 192 108" pathLength="50" stroke-dasharray="1 60"/><path class="ccf-dial-needle" data-cc-energy-needle d="M110 108 L44 104 L38 108 L44 112 Z"/><circle cx="110" cy="108" r="10"/><g><text x="20" y="127">×1</text><text x="22" y="48">×10</text><text x="110" y="13">×25</text><text x="196" y="127">×50</text></g></svg><strong data-cc-factor>×1</strong></div><p data-cc-factor-note>С каждой новой ставки начинается с ×1</p></section>
<section class="ccf-fest">
<div class="ccf-fest-offer"><header><h3>Фестиваль, 10 вращений</h3><span>35 ставок</span></header><button type="button" class="ccf-buy" data-cc-buy><span class="ccf-long">Купить</span><span class="ccf-short">Купить фестиваль</span><strong><b data-cc-buy-price>3,50</b> USDT</strong></button></div>
<div class="ccf-fest-live"><header><h3>Фестиваль идёт</h3><strong data-cc-fest-count>0 / 10</strong></header><div class="ccf-dots" data-cc-fest-dots aria-hidden="true"></div><div class="ccf-fest-sum"><span>Выигрыш <strong data-cc-fest-win>0,00</strong></span><button type="button" class="ccf-pause" data-cc-pause disabled>На паузе</button></div></div>
</section>
</aside>
<div class="ccf-outcome">
<div class="ccf-status"><span data-cc-message role="status">Нажми «Вращать», чтобы открыть коробку</span></div>
<div class="ccf-win" data-cc-win role="status"><span class="ccf-cascade" data-cc-cascade></span><span class="ccf-sr">Выигрыш</span><strong data-cc-total data-units="0">0,00</strong><span class="ccf-groups" data-cc-groups></span></div>
<div class="ccf-feedback" data-cc-feedback><p data-cc-status role="status"></p><p data-cc-error role="alert"></p><button type="button" data-cc-retry hidden>Проверить прежний ход</button></div>
</div>
</div>
<div class="ccf-wallet-help" data-cc-wallet-help><span data-cc-wallet-note></span><a href="/" data-cc-login>Войти в клуб для тестовой игры</a><button type="button" data-cc-wallet>Открыть тестовый кошелёк</button></div>
<footer class="ccf-bar">
<div class="ccf-money"><span>Баланс</span><strong><output data-cc-balance>0,00</output> <small>USDT</small></strong></div>
<div class="ccf-lastwin"><span data-cc-last-label>Выигрыш</span><strong data-cc-last>0,00</strong></div>
<div class="cc-stake ccf-stake" data-ccf-stake><label for="cc-stake" data-cc-cost><span class="ccf-long">Ставка за вращение</span><span class="ccf-short" aria-hidden="true">Ставка</span></label><div class="ccf-stepper"><button type="button" data-cc-stake-step="-1" aria-label="Уменьшить ставку">${ICON.minus}</button><select id="cc-stake" data-cc-stake>${stakes}</select><button type="button" data-cc-stake-step="1" aria-label="Увеличить ставку">${ICON.plus}</button></div></div>
<div class="ccf-spacer"></div>
<div class="ccf-speed" role="radiogroup" aria-label="Скорость">${speeds}</div>
<button type="button" class="ccf-speed-cycle" data-cc-speed-cycle><b data-cc-speed-label>Обычно</b></button>
<button type="button" class="ccf-auto" data-cc-auto aria-haspopup="dialog" aria-expanded="false" aria-controls="ccf-auto-panel" aria-pressed="false"><span data-cc-auto-label>Авто</span></button>
<button type="button" class="cc-spin" data-cc-spin aria-label="Вращать"><span class="ccf-spin-face">${ICON.spin}${ICON.hurry}<strong data-cc-spin-count></strong><span data-cc-spin-label>Вращать</span></span></button>
</footer>
<div class="ccf-auto-panel" id="ccf-auto-panel" data-cc-auto-panel role="dialog" aria-labelledby="ccf-auto-title" hidden>
<header><h2 id="ccf-auto-title">Автоигра</h2><button type="button" class="ccf-close" data-cc-auto-close aria-label="Закрыть автоигру">${ICON.close}</button></header>
<div class="ccf-field"><span id="ccf-auto-count">Платных вращений</span><div class="ccf-chips" role="radiogroup" aria-labelledby="ccf-auto-count">${counts}</div></div>
<button type="button" class="ccf-primary" data-cc-auto-start></button>
<p class="ccf-auto-note">Бесплатные вращения фестиваля не входят в счёт. Серию можно остановить в любой момент.</p>
</div>
<div class="ccf-settings-host" data-cc-settings-host></div>
<div class="ccf-settings" data-cc-settings><div class="ccf-settings-row"><button type="button" data-cc-info>Правила и выплаты</button><button type="button" data-cc-history>История раунда</button></div><div class="ccf-settings-row"><button type="button" data-cc-sound aria-pressed="true">Звук</button><button type="button" data-cc-music aria-pressed="true">Музыка</button></div><label class="ccf-volume">Громкость <input type="range" min="0" max="100" data-cc-volume aria-label="Громкость игры"></label><label class="ccf-check"><input type="checkbox" data-cc-reduce>Меньше анимации</label><button type="button" data-cc-refresh>Проверить состояние</button><small>Собственная версия Royal · тестовые виртуальные USDT</small></div>
<div class="cc-dialog-backdrop" data-cc-backdrop><div class="cc-dialog" data-cc-dialog role="dialog" aria-modal="true" aria-labelledby="cc-dialog-title"></div></div>
</section>`;}
 private bind(){
    this.dialogShell=new SlotDialog(this.find('[data-cc-dialog]'),this.find('[data-cc-backdrop]'),'data-cc-action',action=>void this.dialogAction(action),()=>{if(this.dialog==='complete')this.stopAuto();this.closeDialog();});
    this.stakeControls=new SlotStakeControls({
      values:CARAMEL_BETS,maximumCents:maximumStakeCents,select:this.find<HTMLSelectElement>('[data-cc-stake]'),
      steps:Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cc-stake-step]')),
      direction:button=>Number(button.getAttribute('data-cc-stake-step')),current:()=>this.stake,
      locked:()=>this.blocked()||this.session()?.state==='active'||this.autoRemaining>0||!!this.dialog,
      changed:stake=>{this.stake=stake;this.controls();},
    });
    this.soundControls=new SlotAudioControls({
      sound:this.find<HTMLButtonElement>('[data-cc-sound]'),music:this.find<HTMLButtonElement>('[data-cc-music]'),
      volume:this.find<HTMLInputElement>('[data-cc-volume]'),audio:this.audio,entered:()=>this.entered,dynamicGlyph:false,
    });
  this.find<HTMLButtonElement>('[data-cc-load-retry]').onclick=()=>void this.assets.load();
  this.find<HTMLButtonElement>('[data-cc-spin]').onclick=()=>this.primary();
  this.find<HTMLButtonElement>('[data-cc-buy]').onclick=()=>{this.stopAuto();this.closeAuto(false);this.openDialog('buy');};
  this.find<HTMLButtonElement>('[data-cc-pause]').onclick=()=>{this.bonusRunning=false;this.playback.cancelScheduled();this.controls();};
  this.find<HTMLButtonElement>('[data-cc-info]').onclick=()=>{this.stopAuto();this.openDialog('info');};
  this.find<HTMLButtonElement>('[data-cc-history]').onclick=()=>{this.stopAuto();this.openDialog('history');};
  this.find<HTMLButtonElement>('[data-cc-rules]').onclick=()=>{this.stopAuto();this.closeAuto(false);this.openDialog('info');};
  this.find<HTMLButtonElement>('[data-cc-sound-quick]').onclick=()=>this.find<HTMLButtonElement>('[data-cc-sound]').click();
  const speeds=this.find('.ccf-speed');
  speeds.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-cc-speed-option]');if(button&&!button.disabled){this.speed=button.dataset.ccSpeedOption as Speed;this.controls();}};
  speeds.onkeydown=event=>{
    const step=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;if(!step||this.live)return;
    event.preventDefault();this.speed=SPEEDS[(SPEEDS.indexOf(this.speed)+step+SPEEDS.length)%SPEEDS.length];this.controls();
    this.root.querySelector<HTMLButtonElement>(`[data-cc-speed-option="${this.speed}"]`)?.focus();
  };
  this.find<HTMLButtonElement>('[data-cc-speed-cycle]').onclick=()=>{if(this.live)return;this.speed=SPEEDS[(SPEEDS.indexOf(this.speed)+1)%SPEEDS.length];this.controls();};
  this.find<HTMLButtonElement>('[data-cc-auto]').onclick=()=>{if(this.autoRemaining){this.stopAuto();this.controls();return;}if(this.autoOpen)this.closeAuto(true);else this.openAuto();};
  const panel=this.find('[data-cc-auto-panel]');
  panel.onclick=event=>{
    const target=event.target as HTMLElement;
    const count=target.closest<HTMLButtonElement>('[data-cc-auto-count]');
    if(count){this.autoCount=Number(count.dataset.ccAutoCount);this.controls();return;}
    if(target.closest('[data-cc-auto-close]')){this.closeAuto(true);return;}
    if(target.closest('[data-cc-auto-start]'))this.startAuto();
  };
  panel.onkeydown=event=>{
    const chip=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-cc-auto-count]');
    const step=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;
    if(chip&&step){event.preventDefault();const at=AUTO_COUNTS.indexOf(this.autoCount as typeof AUTO_COUNTS[number]);this.autoCount=AUTO_COUNTS[(at+step+AUTO_COUNTS.length)%AUTO_COUNTS.length];this.controls();this.root.querySelector<HTMLButtonElement>(`[data-cc-auto-count="${this.autoCount}"]`)?.focus();return;}
    if(event.key!=='Tab')return;
    const items=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')).filter(item=>item.tabIndex>=0),first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  this.find<HTMLButtonElement>('[data-cc-retry]').onclick=()=>void this.retry();this.find<HTMLButtonElement>('[data-cc-refresh]').onclick=()=>void this.refresh();this.find<HTMLButtonElement>('[data-cc-wallet]').onclick=()=>{this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));};
  this.find<HTMLInputElement>('[data-cc-reduce]').onchange=event=>{this.manualReduced=(event.target as HTMLInputElement).checked;try{localStorage.setItem('royal-caramel-reduced',this.manualReduced?'1':'0');}catch{}this.cancel();this.sync();};
 }
 private controls(){
  if(this.destroyed)return;const s=this.session(),active=s?.state==='active',blocked=this.blocked(),bonus=active?s.view.caramel.bonus:null,festival=!!bonus?.remaining;if(active)this.stake=s.stakeUnits;
  this.root.dataset.reducedMotion=String(!this.motion());this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(s?.view.caramel.bonus?.remaining??0);this.root.setAttribute('aria-busy',String(!this.assets.ready||!!this.live||client.busy));
  this.find('[data-cc-balance]').textContent=coins((this.live?.balance??this.balance())*100);
  const last=festival?this.festivalWin(s!.view.caramel):this.live?units(this.find('[data-cc-total]').dataset.units??0):this.lastWin;
  this.find('[data-cc-last-label]').textContent=festival?translateText('Фестиваль'):translateText('Выигрыш');
  const lastValue=this.find('[data-cc-last]');lastValue.textContent=coins(last);lastValue.dataset.positive=String(units(last)>0);
  this.spinButton(blocked,active,bonus);
  this.stakeControls.update();
  this.find('[data-ccf-stake]').dataset.locked=String(active||this.autoRemaining>0);
  const price=coins(Number(this.stake)*FESTIVAL_PRICE);this.find('[data-cc-buy-price]').textContent=price;
  const buy=this.find<HTMLButtonElement>('[data-cc-buy]');buy.disabled=blocked||active||!!this.dialog||this.autoRemaining>0||!this.entered;buy.setAttribute('aria-label',tr`Купить фестиваль за ${price} USDT`);
  this.transport(blocked,active);
  this.find('[data-cc-error]').textContent=this.error||client.error;this.find('[data-cc-feedback]').dataset.error=String(!!(this.error||client.error));
  this.find('[data-cc-status]').textContent=client.loading?translateText('Проверяем сохранённый фестиваль…'):this.live?'':canRecoverOperation(client)?translateText('Ход сохранён. Подтверди прежнюю операцию.'):this.autoRemaining&&!active?tr`Платных вращений осталось: ${this.autoRemaining}`:'';
  this.find('[data-cc-wallet-help]').hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);this.find('[data-cc-wallet-note]').textContent=client.accountId?translateText('Недостаточно USDT (Nile) для ставки.'):translateText('Для игры нужен общий баланс USDT.');this.find('[data-cc-login]').hidden=!!client.accountId;this.find('[data-cc-wallet]').hidden=!client.accountId;
  this.audioControls();
  this.find<HTMLInputElement>('[data-cc-reduce]').checked=this.manualReduced;
  if(!this.live&&!this.root.dataset.cascade)this.idleMessage(s);
  const enter=this.root.querySelector<HTMLButtonElement>('[data-cc-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ ФЕСТИВАЛЬ'):translateText('ОТКРЫТЬ КОРОБКУ');}
  const confirm=this.root.querySelector<HTMLButtonElement>('[data-cc-action="buy"]');if(confirm)confirm.disabled=blocked||active||this.balance()<Number(this.stake)*FESTIVAL_PRICE/100;
 }
 /** Primary action: spin, hurry the running cascade, stop autoplay, or continue a saved festival. */
 private spinButton(blocked:boolean,active:boolean,bonus:CaramelView['bonus']){
  const spin=this.find<HTMLButtonElement>('[data-cc-spin]'),count=this.find('[data-cc-spin-count]'),label=this.find('[data-cc-spin-label]');
  const festival=active&&!!bonus?.remaining,state=festival?'bonus':this.autoRemaining?'auto':this.live?'spinning':'idle';
  this.root.dataset.spinState=state;
  if(state==='bonus'&&bonus){
   const next=Math.min(bonus.played+1,bonus.awarded);
   spin.disabled=blocked||!this.entered||!!this.dialog||this.bonusRunning;count.textContent=`${next} / ${bonus.awarded}`;label.textContent=this.bonusRunning?translateText('Бесплатно'):translateText('Продолжить');
   spin.setAttribute('aria-label',this.bonusRunning?tr`Фестиваль, вращение ${next} из ${bonus.awarded}`:tr`Продолжить фестиваль, вращение ${next} из ${bonus.awarded}`);
  }else if(state==='auto'){spin.disabled=false;count.textContent=String(this.autoRemaining);label.textContent=translateText('Стоп');spin.setAttribute('aria-label',tr`Остановить автоигру, осталось ${this.autoRemaining}`);}
  else if(state==='spinning'){spin.disabled=!!this.live?.fast||!this.live?.motion;count.textContent='';label.textContent=translateText('Ускорить');spin.setAttribute('aria-label',translateText('Показать каскады быстрее'));}
  else{spin.disabled=blocked||!this.entered||!!this.dialog;count.textContent='';label.textContent=active?translateText('Продолжить'):translateText('Вращать');spin.setAttribute('aria-label',active?translateText('Продолжить раунд'):translateText('Вращать'));}
 }
 private transport(blocked:boolean,active:boolean){
  const live=!!this.live;this.root.dataset.speed=this.speed;
  for(const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cc-speed-option]'))){const checked=button.dataset.ccSpeedOption===this.speed;button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;button.disabled=live;}
  const cycle=this.find<HTMLButtonElement>('[data-cc-speed-cycle]');cycle.disabled=live;this.find('[data-cc-speed-label]').textContent=this.speedLabel(this.speed);cycle.setAttribute('aria-label',tr`Скорость: ${this.speedLabel(this.speed)}. Нажми, чтобы сменить`);
  const auto=this.find<HTMLButtonElement>('[data-cc-auto]');
  this.find('[data-cc-auto-label]').textContent=this.autoRemaining?tr`Стоп · ${this.autoRemaining}`:translateText('Авто');
  auto.disabled=!this.autoRemaining&&(blocked||active||!!this.dialog||!this.entered);
  auto.setAttribute('aria-pressed',String(this.autoRemaining>0));auto.setAttribute('aria-expanded',String(this.autoOpen));
  if(this.autoOpen&&auto.disabled&&!this.autoRemaining)this.closeAuto(false);
  for(const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cc-auto-count]'))){const checked=Number(button.dataset.ccAutoCount)===this.autoCount;button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;}
  this.find('[data-cc-auto-start]').textContent=tr`Запустить ${this.autoCount} вращений`;
  const pause=this.find<HTMLButtonElement>('[data-cc-pause]');pause.disabled=!this.bonusRunning;pause.textContent=this.bonusRunning?translateText('Пауза'):translateText('На паузе');
  for(const selector of ['[data-cc-info]','[data-cc-history]','[data-cc-refresh]','[data-cc-rules]'])this.find<HTMLButtonElement>(selector).disabled=live||client.busy;
  const retry=this.find<HTMLButtonElement>('[data-cc-retry]');retry.hidden=!canRecoverOperation(client);retry.disabled=!this.assets.ready||live||client.busy||document.hidden;
 }
 private audioControls(){
  this.soundControls?.update();if(!this.root)return;
  const on=!gameAudio.getPreferences().muted,mirror=this.find<HTMLButtonElement>('[data-cc-sound-quick]');
  mirror.setAttribute('aria-pressed',String(on));mirror.setAttribute('aria-label',on?translateText('Выключить звук'):translateText('Включить звук'));
 }
 private sync(){
  if(this.destroyed)return;
  if(this.owner!==client.accountId){this.cancel();this.closeAuto(false);this.audio.pause();this.owner=client.accountId;this.entered=false;this.lastWin='0';this.stake = '10';this.error='';this.openDialog('intro');}
  const s=this.session();if(!this.live&&(!s||this.shown!==this.key(s))){
   this.board.clearOverlay();this.board.focus([]);this.board.show(s?.view.caramel.spin?.finalGrid??preview);this.root.dataset.phase='idle';this.root.dataset.charging='false';this.energyChip(0);delete this.root.dataset.cascade;delete this.root.dataset.outcome;this.root.dataset.notice='false';this.groups([]);this.cascadeBadge('');
   if(s){this.shown=this.key(s);this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(s.view.caramel.revision);if(s.state==='settled')this.lastWin=s.returnedUnits;this.setTotal(confirmedPayout(s,s.view.caramel.totalPayoutUnits));this.features(s.view.caramel);}
   else{this.shown='';this.setTotal('0');this.features();}
  }
  this.controls();observeExpansionOutcome(this.root,CARAMEL_GAME,s,client.accountId,!!this.live||client.busy,!!client.pending);
 }
 /** The status line under the board when no cascade is being shown. */
 private idleMessage(s?:Session){
  const v=s?.view.caramel,bonus=s?.state==='active'?v?.bonus:null;
  let text='';
  if(bonus?.remaining)text=this.bonusRunning?tr`Фестиваль идёт сам, энергия ×${bonus.multiplier} сохраняется между вращениями`:translateText('Фестиваль на паузе. Нажми «Продолжить».');
  else if(s?.state==='active')text=translateText('Фестиваль сохранён. Продолжение без ставки.');
  else if(this.root.dataset.outcome)text=this.root.dataset.outcome;
  else text=translateText('Нажми «Вращать», чтобы открыть коробку');
  this.message(text);
 }
 private message(text:string){this.find('[data-cc-message]').textContent=text;}
 private setTotal(value:string|number){const element=this.find('[data-cc-total]');element.textContent=coins(value);element.dataset.units=String(value);this.root.dataset.hasWin=String(units(value)>0);if(this.live&&this.root.dataset.festival!=='true'){const last=this.find('[data-cc-last]');last.textContent=coins(value);last.dataset.positive=String(units(value)>0);}}
 private groups(wins:CaramelFrame['wins']){this.find('[data-cc-groups]').innerHTML=wins.map(w=>`<span class="ccf-group">${caramelSymbol(w.symbol)}<span class="ccf-sr">${escape(caramelSymbolName(w.symbol))}:</span><b>${tr`${w.positions.length} шт. → ${coins(w.payoutUnits)}`}</b></span>`).join('');}
 private cascadeBadge(text:string){const badge=this.find('[data-cc-cascade]');badge.textContent=text;badge.hidden=!text;}
 private energyChip(energy:number){const chip=this.find('[data-cc-energy-chip]');chip.hidden=!energy;chip.textContent=energy?tr`волчок +${energy}`:'';this.root.dataset.energy=String(energy>0);}
 private factor(value:number){this.root.dataset.multiplier=String(value);this.find('[data-cc-factor]').textContent=`×${value}`;this.root.querySelector('[data-cc-energy-fill]')!.setAttribute('stroke-dasharray',`${Math.min(50,value)} 60`);this.root.querySelector<SVGElement>('[data-cc-energy-needle]')!.style.transform=`rotate(${Math.min(50,value)/50*180}deg)`;}
 private tickets(count:number,free:boolean){
  const need=free?3:4,slots=Array.from(this.find('[data-cc-tickets]').children) as HTMLElement[];
  this.find('[data-cc-ticket-count]').textContent=tr`${Math.min(count,need)} из ${need}`;
  this.find('[data-cc-ticket-help]').textContent=free?translateText('3 билета на поле: ещё 3 вращения, всего до 30'):translateText('4 билета после каскадов: 10 бесплатных вращений');
  slots.forEach((slot,i)=>{slot.hidden=i>=need;slot.classList.toggle('cc-collected',i<count);});
 }
 private festivalWin(v:CaramelView){return v.history.filter(spin=>spin.kind==='free').reduce((sum,spin)=>sum+units(spin.payoutUnits),0);}
 private festival(v?:CaramelView){
  const bonus=v?.bonus,active=!!bonus?.remaining;this.root.dataset.festival=String(active);
  if(!active||!bonus||!v)return;
  this.find('[data-cc-fest-count]').textContent=`${bonus.played} / ${bonus.awarded}`;
  this.find('[data-cc-fest-dots]').innerHTML=Array.from({length:bonus.awarded},(_,i)=>`<i${i<bonus.played?' class="ccf-done"':''}></i>`).join('');
  this.find('[data-cc-fest-win]').textContent=coins(this.festivalWin(v));
 }
 private features(view?:CaramelView){
  const bonus=view?.bonus,active=!!bonus?.remaining;
  this.factor(active?bonus.multiplier:view?.spin?.multiplierAfter??1);
  this.tickets(view?.spin?.tickets??0,view?.spin?.kind==='free'||view?.mode==='festival'&&!view.spin);
  this.festival(view);
  this.phaseText=active?tr`Фестиваль, вращение ${Math.min(bonus!.played+1,bonus!.awarded)} из ${bonus!.awarded}`:translateText('8+ одинаковых в любом месте');
  this.find('[data-cc-factor-note]').textContent=active?translateText('Сохраняется до конца фестиваля'):translateText('С каждой новой ставки начинается с ×1');
 }
 private primary(){
  if(this.live&&!this.autoRemaining&&!this.bonusRunning){if(!this.live.fast&&this.live.motion){this.live.fast=true;this.controls();}return;}
  if(this.autoRemaining){this.stopAuto();this.controls();return;}
  void this.play();
 }
 private openAuto(){
  const auto=this.find<HTMLButtonElement>('[data-cc-auto]');if(auto.disabled||this.blocked()||!this.entered||this.dialog)return;
  this.autoOpen=true;this.find('[data-cc-auto-panel]').hidden=false;
  this.controls();this.root.querySelector<HTMLButtonElement>(`[data-cc-auto-count="${this.autoCount}"]`)?.focus();
 }
 private closeAuto(focus:boolean){
  if(!this.autoOpen)return;this.autoOpen=false;this.find('[data-cc-auto-panel]').hidden=true;
  this.find('[data-cc-auto]').setAttribute('aria-expanded','false');if(focus)this.find<HTMLButtonElement>('[data-cc-auto]').focus();
 }
 private startAuto(){
  if(!this.autoOpen||this.blocked()||!this.entered||this.dialog||this.session()?.state==='active')return;
  this.autoRemaining=this.autoCount;
  this.closeAuto(false);this.find<HTMLButtonElement>('[data-cc-spin]').focus();void this.request('normal');this.controls();
 }
 private outcome(text:string,notice=false){this.root.dataset.outcome=text;this.root.dataset.notice=String(notice);this.message(text);}
 private async play(){if(this.blocked()||!this.entered||this.dialog)return;this.bonusRunning=this.session()?.state==='active';await this.request('normal');}
 private async request(mode:'normal'|'festival'){
  if(this.blocked()||!this.entered||this.dialog)return;const previous=this.session(),active=previous?.state==='active',cost=active?0:Number(this.stake)*(mode==='festival'?FESTIVAL_PRICE:1)/100;
  if(this.balance()<cost){this.error=translateText('Недостаточно USDT (Nile) для выбранной ставки.');this.stopAuto();this.controls();return;}
  void this.audio.enter();const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:this.motion(),fast:this.speed==='fast',before:previous};this.live=live;this.error='';this.root.dataset.animationToken=live.token;
  delete this.root.dataset.outcome;this.root.dataset.notice='false';this.groups([]);this.cascadeBadge('');this.board.focus([]);this.energyChip(0);this.message('');if(!active)this.setTotal('0');observeExpansionOutcome(this.root,CARAMEL_GAME,previous,client.accountId,true,true);
  if(!active&&this.autoRemaining)this.autoRemaining--;
  if(active||mode==='normal'){this.root.dataset.phase='spinning';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);}else this.root.dataset.phase='preparing';this.controls();
  try{
   const action=this.sessions.operation(this.stake,mode,previous);
   const promise=client.act(action);live.operationId=client.pending?.id??'';await promise;if(!this.valid(live))return;
   const s=this.session();if(!this.sessions.confirmed(s,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
   await this.present(s,live);if(!this.valid(live))return;
   this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';delete this.root.dataset.cascade;this.shown=this.key(s);if(s.state==='settled')this.lastWin=s.returnedUnits;this.features(s.view.caramel);this.setTotal(confirmedPayout(s,s.view.caramel.totalPayoutUnits));this.controls();observeExpansionOutcome(this.root,CARAMEL_GAME,s,client.accountId,false,false);
   const v=s.view.caramel;
   if(s.state==='active'&&(!v.spin||v.spin.kind==='base')){
    this.bonusRunning=false;this.openDialog('bonus');return;
   }
   if(s.state==='settled'&&v.history.some(spin=>spin.kind==='free')){this.bonusRunning=false;this.openDialog('complete');return;}
   if(s.state==='active'&&this.bonusRunning||s.state==='settled'&&this.autoRemaining>0)this.schedule();
   this.controls();
  }catch(e){if(this.valid(live)){this.error=(e as Error).message;this.stopAuto();this.live=undefined;this.board.cancel();this.audio.stopSpin();this.shown='';delete this.root.dataset.cascade;this.sync();}}
  finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.audio.stopSpin();}}
 }
 private async present(s:Session,live:Live){
  const v=s.view.caramel,spin=v.spin;this.root.dataset.sessionId=s.id;this.root.dataset.revision=String(v.revision);
  if(!spin){this.audio.stopSpin();this.features(v);return;}
  let total=Number(v.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);this.factor(spin.multiplierBefore);
  if(!await this.board.settle(live.token,spin.initialGrid)||!this.valid(live))return;this.audio.stopSpin();this.tickets(spin.initialGrid.filter(n=>n===7).length,spin.kind==='free');
  for(const frame of spin.frames){
   if(!this.valid(live))return;this.board.clearOverlay();this.board.show(frame.before);
   const winning=frame.wins.flatMap(w=>w.positions),tops=frame.wins.length&&frame.energy?frame.before.flatMap((symbol,i)=>symbol>=8?[i]:[]):[];
   this.board.focus(winning,tops);this.energyChip(0);
   if(!frame.wins.length)break;
   this.root.dataset.cascade=String(frame.index+1);
   this.phaseText=tr`Каскад ${frame.index+1} из 20, множитель ×${frame.multiplierAfter}`;
   if(frame.energy){this.root.dataset.phase='energy';this.root.dataset.charging='true';this.energyChip(frame.energy);this.message(tr`Волчки добавляют +${frame.energy} к энергии`);this.find('[data-cc-factor-note]').textContent=frame.multiplierBefore+frame.energy===frame.multiplierAfter?tr`×${frame.multiplierBefore} + ${frame.energy} = ×${frame.multiplierAfter}, до выплаты каскада`:tr`Предел энергии ×${frame.multiplierAfter}, до выплаты каскада`;this.audio.energy();if(live.motion&&!await this.delay(live.fast?220:550,live))return;this.factor(frame.multiplierAfter);this.root.dataset.charging='false';}
   this.root.dataset.phase='winning';this.cascadeBadge(tr`Каскад ${frame.index+1} · ×${frame.multiplierAfter}`);this.groups(frame.wins);total+=Number(frame.payoutUnits);this.setTotal(total);this.audio.cascade(frame.index);
   if(live.motion&&!await this.delay(live.fast?120:380,live))return;
   if(frame.removed.length){this.root.dataset.phase='bursting';this.board.remove(frame.removed);if(live.motion&&!await this.delay(live.fast?100:230,live))return;this.root.dataset.phase='falling';this.audio.drop();if(live.motion){this.board.gravity(frame,live.fast);if(!await this.delay(live.fast?260:560,live))return;}this.board.clearOverlay();this.board.show(frame.after);this.board.focus([]);this.tickets(frame.after.filter(n=>n===7).length,spin.kind==='free');}
  }
  if(!this.valid(live))return;this.board.clearOverlay();this.board.show(spin.finalGrid);this.board.focus([]);this.features(v);this.setTotal(confirmedPayout(s,v.totalPayoutUnits));this.energyChip(0);
  if(spin.freeAward){this.root.dataset.phase='tickets';this.outcome(spin.kind==='free'?tr`ЕЩЁ ${spin.freeAward} БЕСПЛАТНЫХ ВРАЩЕНИЯ`:translateText('ЧЕТЫРЕ БИЛЕТА · ФЕСТИВАЛЬ ОТКРЫТ'));this.audio.tickets();if(live.motion&&!await this.delay(live.fast?250:850,live))return;}
  else this.outcome(v.capped?translateText('ДОСТИГНУТ ПРЕДЕЛ ВЫИГРЫША'):spin.frames.at(-1)?.stop==='cascade-limit'?translateText('20 КАСКАДОВ · ВЫИГРЫШ СОХРАНЁН'):Number(spin.payoutUnits)>0?translateText('Выигрыш зачислен'):s.state==='active'?translateText('Фестиваль продолжается'):translateText('Новые сладости в следующем вращении'),v.capped||spin.frames.at(-1)?.stop==='cascade-limit');
  this.audio.outcome(Number(spin.payoutUnits)>0);if(live.motion)await this.delay(live.fast?100:300,live);
 }
 private schedule(){this.playback.schedule(this.speed==='fast'?140:500,()=>{if(!this.dialog&&!this.blocked()&&(this.bonusRunning||this.autoRemaining))void this.request('normal');});}
 private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();}catch(e){this.error=(e as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
 private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();if(!this.destroyed){this.shown='';this.sync();}}
 private ledger(session:Session){return renderSlotLedger('cc',session.spentUnits,session.state==='active'?session.view.caramel.totalPayoutUnits:session.returnedUnits,session.state==='active');}
 private openDialog(kind:Dialog){this.settings?.close();if(kind)this.closeAuto(false);
  this.dialog=kind;this.dialogShell.begin(kind);if(!kind)return;
  const box=this.find('[data-cc-dialog]'),s=this.session(),v=s?.view.caramel;
  if(kind==='intro')box.innerHTML=tr`<small>КАЖДЫЙ КАСКАД ГОТОВИТ СЮРПРИЗ</small><h2 id="cc-dialog-title" class="ccf-dialog-wordmark">Caramel <em>Carnival</em></h2><div class="cc-intro-cards"><article><div>${caramelSymbol(0)}${caramelSymbol(1)}${caramelSymbol(2)}</div><h3>8+ В ЛЮБОМ МЕСТЕ</h3><p>Выигрышные конфеты исчезают. Новые падают сверху. До 20 каскадов.</p></article><article><div>${caramelSymbol(8)}<strong>×50</strong></div><h3>ЭНЕРГИЯ ВОЛЧКА</h3><p>Волчки на выигрышном каскаде повышают множитель до выплаты.</p></article><article><div>${caramelSymbol(7)}${caramelSymbol(7)}</div><h3>ЧЕТЫРЕ БИЛЕТА</h3><p>10 бесплатных вращений. В фестивале энергия сохраняется.</p></article></div><button type="button" class="cc-primary" data-cc-action="enter">ОТКРЫТЬ КОРОБКУ</button><p class="cc-dialog-note">Виртуальные USDT · вход без ставки</p>`;
  if(kind==='buy')box.innerHTML=tr`<small>СЛАДКИЙ ФЕСТИВАЛЬ</small><h2 id="cc-dialog-title">10 БЕСПЛАТНЫХ ВРАЩЕНИЙ</h2><div class="cc-bonus-art">${caramelSymbol(7)}<strong>10<small>ВРАЩЕНИЙ</small></strong>${caramelSymbol(8)}</div><p>Энергия начинается с ×1 и сохраняется между вращениями до ×50. Три билета на конечном поле добавляют ещё три вращения, всего до 30.</p><div class="cc-confirm"><span>Ставка: ${coins(this.stake)} · стоимость 35×</span><strong>${coins(Number(this.stake)*FESTIVAL_PRICE)} USDT</strong><small>Одна покупка с тестового кошелька. Выплата может быть ниже стоимости или равна нулю.</small></div><button type="button" class="cc-primary" data-cc-action="buy">НАЧАТЬ ЗА ${coins(Number(this.stake)*FESTIVAL_PRICE)} USDT</button><button type="button" class="cc-back" data-cc-action="close">Вернуться в игру</button>`;
  if(kind==='bonus')box.innerHTML=tr`<small>ФЕСТИВАЛЬ ОТКРЫТ</small><h2 id="cc-dialog-title">СЛАДКИЙ ФЕСТИВАЛЬ</h2><div class="cc-bonus-art">${caramelSymbol(7)}<strong>${v?.bonus?.remaining??10}<small>БЕСПЛАТНЫХ ВРАЩЕНИЙ</small></strong>${caramelSymbol(8)}</div><p>Множитель сохраняется между вращениями. Три билета добавляют ещё три вращения, до 30 в сумме.</p><button type="button" class="cc-primary" data-cc-action="bonus">НАЧАТЬ ФЕСТИВАЛЬ</button><p class="cc-dialog-note">Ставка принята. Продолжение бесплатно.</p>`;
    if(kind==='complete'&&s)box.innerHTML=renderSlotResult({style:'cc',eyebrow:translateText('ПРАЗДНИК ЗАВЕРШЁН'),title:translateText('ИТОГ ФЕСТИВАЛЯ'),returned:s.returnedUnits,ledger:this.ledger(s),note:translateText('Выплата уже зачислена в кошелёк один раз.'),label:translateText('ПРОДОЛЖИТЬ')});
    if(kind==='history')box.innerHTML=renderSlotHistory({style:'cc',eyebrow:translateText('ЖУРНАЛ ЯРМАРКИ'),title:translateText('ИСТОРИЯ РАУНДА'),ledger:s?this.ledger(s):undefined,status:s?.state==='active'?translateText('Фестиваль сохранён. Выплата поступит после завершения.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появится подтверждённая история твоего раунда.'),rows:v?.history.map(spin=>({title:tr`${spin.kind==='base'?translateText('Основное'):translateText('Бесплатное')} вращение ${slotSpinNumber(spin,v!.history)}`,detail:tr`${spin.frames.filter(f=>f.wins.length).length} каскадов · ×${spin.multiplierAfter} · ${spin.tickets} билетов${spin.freeAward?tr` · +${spin.freeAward} вращений`:''}`,payoutUnits:spin.payoutUnits}))??[]});
    if(kind==='info')box.innerHTML=renderSlotInfo({style:'cc',eyebrow:translateText('ПРАВИЛА ЯРМАРКИ'),title:translateText('КАК ИГРАЕТ CARAMEL'),reduced:this.manualReduced,motionSetting:false,bodyHtml:tr`<h3>Совпадения в любом месте</h3><p>Поле 6×5. Восемь и более одинаковых конфет выигрывают независимо от расположения. Они исчезают, остальные падают вниз, свободные ячейки заполняются. До 20 выигрышных каскадов за вращение. Билет и волчок сами не оплачиваются.</p><h3>Энергия до ×50</h3><p>Волчки +2, +3, +5 и +10 на выигрышном поле добавляют энергию до выплаты этого каскада, затем исчезают вместе с выигрышными конфетами. Например, ×1 и +2 дают ×3. Без выигрышной группы волчки не срабатывают. Обычное вращение начинает с ×1, фестиваль сохраняет множитель между бесплатными вращениями.</p><h3>Билеты и фестиваль</h3><p>Считаются билеты на конечном поле, после каскадов. Четыре и более дают 10 бесплатных вращений. Фестиваль начинается с ×1. Внутри три и более билета добавляют три вращения, максимум 30 за весь фестиваль. Билеты не накапливаются между отдельными обычными ставками.</p><h3>Выплаты от общей ставки, до множителя</h3>${renderSlotPaytable('cc',CARAMEL_PAYTABLE.map((pay,i)=>({symbolHtml:caramelSymbol(i),name:CARAMEL_NAMES[i],values:pay.map(n=>`${(n/100).toLocaleString(locale)}×`)})),[translateText('Конфета'),'8-9','10-11','12+'])}<p>Покупка фестиваля стоит 35 ставок, списывается один раз. Максимальная выплата всего раунда вместе с бесплатными вращениями: 5 000 базовых ставок. При достижении предела оставшиеся каскады и вращения заканчиваются. Выплаты округляются вниз до 0,01 USDT.</p><p>Одна ставка и одна итоговая выплата. При обрыве связи подтверждается прежний UUID, новая ставка не нужна. Закрытие, скрытие окна и ошибка останавливают авто. Фестиваль можно продолжить из сохранённого состояния.</p><p>${language==='en'?'Choose 10, 25, 50 or 100 paid spins. After the festival, confirm the result to resume the series. Quick play shortens the animation. Speed does not affect the result or payout.':'Выбери 10, 25, 50 или 100 платных вращений. После фестиваля подтверди результат, чтобы продолжить серию. Скорость «Быстро» сокращает анимацию. Результат и выплата от скорости не зависят.'}</p><p class="cc-dialog-note">Собственная версия Royal: свои иллюстрации, звуки и вероятности событий. Демонстрационная игра на тестовые виртуальные USDT.</p>`});
  this.controls();this.dialogShell.focus(kind==='info');
 }
 private closeDialog(){this.dialog='';this.controls();this.dialogShell.hide();}
 private async dialogAction(action:string){if(this.destroyed||!this.assets.ready)return;if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request('normal');}}else if(action==='buy'){if(this.blocked())return;this.closeDialog();await this.request('festival');}else if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request('normal');}else{this.closeDialog();if(action==='complete'&&this.autoRemaining>0)this.schedule();}}
 getAudioState(){return this.audio.state();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.cancel();this.undock();document.removeEventListener('pointerdown',this.outside,true);this.layout.disconnect();this.assets.destroy();this.board.destroy();this.audio.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
