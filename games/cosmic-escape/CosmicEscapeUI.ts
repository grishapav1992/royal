import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {confirmedPayout} from '../../src/shared/roundPrecision';
import {ROYAL_GAME_STAKE_UNITS, gameStakeMaximum} from '../../src/shared/gameStakes';
import { locale, language } from '../../src/i18n/index';
import {cosmicText as translateText, cosmicMarkup as tr} from './cosmicText';
import {CosmicReactor, reactorMarkup} from './CosmicReactor';
import {SlotSettings} from '../../src/ui/slotKit/SlotSettings';
import {SlotDialog, slotOwnsKeyboard} from '../../src/ui/slotKit/SlotDialog';
import {SlotStakeControls, SlotAudioControls, slotStakeStep} from '../../src/ui/slotKit/SlotControls';
import {slotCoins as coins, slotEscape as escape, slotSpinNumber, renderSlotLedger, renderSlotHistory, renderSlotInfo, renderSlotResult, renderSlotPaytable, renderSlotPaylines} from '../../src/ui/slotKit/SlotScreens';
import {SlotPlayback, type SlotOperation} from '../../src/ui/slotKit/SlotPlayback';
import {SlotSessions, type NativeSlotSession} from '../../src/ui/slotKit/SlotSessions';
import {bindSlotLifecycle} from '../../src/ui/slotKit/SlotLifecycle';
import {cosmicSlot} from '../../src/ui/slotKit/nativeSlots';
import {gameContentLayout} from '../../src/ui/GameLayoutPolicy';
import {gameAudio} from '../../src/game/GameAudio';
import {LUELON_SLOT_INFO,type LuelonSlotGameId,type LuelonSlotView,type LuelonSlotInfo,type LuelonSlotFeatures,type LuelonSlotSpin} from '../../src/shared/luelonSlots';
import {COSMIC_ESCAPE_DEFAULT_STAKE} from '../../src/shared/cosmicEscapeBets';
import {expansionClient as client} from '../../src/wallet/ExpansionClient';
import {demoWallet} from '../../src/wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from '../../src/ui/gameReactions';
import {CosmicEscapeAudio} from './CosmicEscapeAudio';
import {CosmicEscapeAssets,COSMIC_ESCAPE_ASSETS,type CosmicAssetState} from './CosmicEscapeAssets';
import {CosmicEscapeBoard,cosmicSymbol,cosmicSymbolName} from './CosmicEscapeBoard';
import {CosmicEscapeRacer, cosmicRacerOutcome} from './CosmicEscapeRacer';
import {luelonTheme,type LuelonTheme} from '../../src/ui/LuelonArtwork';
import '../../src/ui/luelon-games.css';
import '../../src/ui/cosmic-escape.css';
import './cosmic-cockpit.css';
type Session=NativeSlotSession<'luelon'>;
type Speed='normal'|'fast';
type Live=SlotOperation&{operationId:string;balance:number;motion:boolean;fast:boolean;before?:Session;};
type Dialog='intro'|'info'|'history'|'buy'|'bonus'|'complete'|'';
const SPEEDS:readonly Speed[]=['normal','fast'];
const AUTO_COUNTS=[10,25,50,100] as const;
const maximumStakeCents=gameStakeMaximum('studio-cosmic-escape');
const COSMIC_ESCAPE_BET_UNITS=ROYAL_GAME_STAKE_UNITS;
/** Display steps of the energy column. The exact multiplier is always written above it. */
const ENERGY_STEPS=[50,40,30,20,15,10,6,4,2,1] as const;
const PORTAL_LADDER=[[3,10],[4,12],[5,15]] as const;
const svg=(body:string,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON={
  info:svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  sound:svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>').replace('<svg','<svg data-cx-sound-on'),
  muted:svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>').replace('<svg','<svg data-cx-sound-off'),
  minus:svg('<path d="M5 12h14"/>',18),plus:svg('<path d="M5 12h14M12 5v14"/>',18),
  auto:svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',18),
  spin:svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',36).replace('<svg','<svg class="cx-spin-icon"'),
  stop:'<svg class="cx-stop-icon" width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  chevron:svg('<path d="M9 6l6 6-6 6"/>',18),gear:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),close:svg('<path d="M6 6l12 12M18 6L6 18"/>',16),
  menu:svg('<path d="M4 7h16M4 12h16M4 17h16"/>').replace('<svg','<svg class="cx-menu-icon"'),
  star:svg('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>').replace('<svg','<svg class="cx-star-icon"'),
};
const units=(value:string|number)=>Number(value)||0;
/** A dedicated cosmic cabinet. Every stage displays a confirmed server result. */
export class CosmicEscapeUI {
  private settings?:SlotSettings;
  private readonly racer: CosmicEscapeRacer;
  private assets:CosmicEscapeAssets;private root:HTMLElement;private dialogShell!:SlotDialog;private stakeControls!:SlotStakeControls;private soundControls!:SlotAudioControls;private info:LuelonSlotInfo;private theme:LuelonTheme;private audio:CosmicEscapeAudio;private board:CosmicEscapeBoard;private owner=client.accountId;private stake=COSMIC_ESCAPE_DEFAULT_STAKE;private mode='normal';private entered=false;private speed:Speed='normal';private manualReduced=false;private destroyed=false;private playback=new SlotPlayback({account:()=>client.accountId,hidden:()=>document.hidden});private sessions=new SlotSessions(cosmicSlot);private live?:Live;private shown='';private portals=0;private error='';private dialog:Dialog='intro';private autoRemaining=0;private bonusRunning=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)');private unsubscribe:()=>void;private layout:ResizeObserver;
  private tools!:HTMLElement;private toolsHome?:Comment;
  private autoCount=25;private autoOpen=false;private reactor!:CosmicReactor;
  private change=()=>this.sync();private visibility=()=>{if(document.hidden){this.cancel();this.audio.pause();}this.sync();};private motionChange=()=>{this.cancel();this.root.dataset.reducedMotion=String(this.motionReduced());this.sync();};
  private keyboard=(event:KeyboardEvent)=>{
    if(this.autoOpen&&event.key==='Escape'){event.preventDefault();this.closeAuto(true);return;}
    if(!slotOwnsKeyboard(this.root,event)||this.dialogShell.keyboard(event,this.dialog))return;
    if(event.code==='Space'&&this.entered&&!this.autoOpen&&!['INPUT','SELECT','BUTTON','TEXTAREA'].includes((event.target as HTMLElement)?.tagName)){event.preventDefault();void this.play();}
  };
  private outside=(event:PointerEvent)=>{if(!this.autoOpen)return;const target=event.target as Node;if(this.find('[data-cx-auto-panel]').contains(target)||this.find('[data-lg-auto]').contains(target))return;this.closeAuto(false);};
  constructor(private host:HTMLElement,private game:LuelonSlotGameId='studio-cosmic-escape'){
    if(game!=='studio-cosmic-escape')throw Error(translateText('Неверная игра космического зала.'));
    const info=LUELON_SLOT_INFO[game];if(!info)throw Error(translateText('Правила игры ещё не загружены.'));
    this.info=info;this.theme=luelonTheme(game);this.audio=new CosmicEscapeAudio();this.assets=new CosmicEscapeAssets(state=>this.assetState(state));
    try{this.manualReduced=localStorage.getItem('royal-luelon-reduced')==='1';}catch{}
    host.innerHTML=this.markup();this.root=host.querySelector('[data-luelon-game]')!;
    this.racer = new CosmicEscapeRacer(this.find('[data-cosmic-alien]'));
    for(const[key,value]of Object.entries({accent:this.theme.accent,secondary:this.theme.secondary,background:this.theme.background,ink:this.theme.ink}))this.root.style.setProperty('--lg-'+key,value);
    this.root.dataset.motif=this.theme.motif;this.root.dataset.reducedMotion=String(this.motionReduced());
    this.board=new CosmicEscapeBoard(this.find('[data-lg-board]'),info,this.theme,col=>{if(this.live)this.audio.stopReel(col);},false);
    this.reactor=new CosmicReactor(this.find('.cx-core'));
    this.tools=this.find('.cx-tools');this.bind();this.idleResult();this.setTotal(0);
    // The shared settings dialog is mounted in its own empty host. The cabinet keeps one layout of its own,
    // so the shared priority profiles never move portals, energy or missions away from the field.
    this.settings=new SlotSettings(this.find('[data-cx-settings-host]'),this.find('[data-cx-settings]'),this.tools,()=>{this.stopAuto();this.closeAuto(false);this.controls();this.racer.context(false,false);});
    this.root.addEventListener('close',()=>this.updateRacer(),true);
    const gear=this.root.querySelector<HTMLButtonElement>('.slot-settings-button');if(gear){gear.innerHTML=ICON.gear.replace('<svg','<svg class="cx-gear-icon"')+ICON.menu;gear.setAttribute('aria-label',translateText('Настройки: правила, история, звук и громкость'));}
    this.mountHeaderTools();
    this.layout=new ResizeObserver(()=>this.profile());this.layout.observe(this.root);this.profile();
    this.unsubscribe=bindSlotLifecycle({changed:this.change,visibility:this.visibility,keyboard:this.keyboard,motion:this.reduced,motionChanged:this.motionChange,audioChanged:()=>this.audioControls()});
    document.addEventListener('pointerdown',this.outside,true);
    this.sync();this.openDialog('intro');void this.assets.load();
  }
  /** The prototype keeps rules, sound and settings in the window's top bar. They return to the cabinet on close. */
  private mountHeaderTools(){
    const bar=this.host.closest('#mini-dialog')?.querySelector<HTMLElement>('.mini-top');if(!bar)return;
    this.toolsHome=document.createComment('cosmic tools');this.tools.before(this.toolsHome);this.tools.classList.add('cx-header-tools');
    bar.insertBefore(this.tools,bar.querySelector('#studio-game-list'));this.root.dataset.headerTools='true';
  }
  private unmountHeaderTools(){if(!this.toolsHome)return;this.tools.classList.remove('cx-header-tools');this.toolsHome.replaceWith(this.tools);this.toolsHome=undefined;delete this.root.dataset.headerTools;}
  private tool<T extends HTMLElement=HTMLButtonElement>(selector:string){return this.tools.querySelector<T>(selector)!;}
  /** The host keeps native slots at the full stage height once a layout profile is present. */
  private profile(){const {width,height}=this.root.getBoundingClientRect();if(!width||!height)return;const profile=gameContentLayout(width,height);if(this.root.dataset.slotPriority!==profile){this.root.dataset.slotPriority=profile;this.updateRacer();}}
  private assetState(state:CosmicAssetState){
    if(this.destroyed)return;
    if(state.status==='ready'){
      this.board.enableArtwork();
      this.root.style.setProperty('--cx-scene-art', `url("${COSMIC_ESCAPE_ASSETS.background}")`);
      this.root.querySelectorAll<SVGImageElement>('[data-cosmic-symbol-image]').forEach(image=>image.setAttribute('href',COSMIC_ESCAPE_ASSETS.symbols));
      this.racer.showArtwork();
    }
    this.root.dataset.assetState=state.status;
    this.find<HTMLProgressElement>('[data-cosmic-load-progress]').value=state.loaded;
    this.find('[data-cosmic-load-title]').textContent=state.status==='error'?translateText('ОФОРМЛЕНИЕ НЕ ЗАГРУЗИЛОСЬ'):translateText('ГОТОВИМ КОСМИЧЕСКИЙ ПОБЕГ');
    this.find('[data-cosmic-load-note]').textContent=state.status==='error'?translateText('Проверь соединение и попробуй ещё раз. Загрузка не списывает монеты.'):tr`Изображения: ${state.loaded} из ${state.total}`;
    this.find<HTMLButtonElement>('[data-cosmic-load-retry]').hidden=state.status!=='error';
    this.controls();
    if(state.status==='ready'&&this.dialog==='intro'&&this.root.isConnected&&(!document.activeElement||document.activeElement===document.body||this.root.contains(document.activeElement)))this.root.querySelector<HTMLButtonElement>('[data-lg-dialog-action="enter"]')?.focus();
    if(state.status==='error'&&this.root.isConnected)this.find<HTMLButtonElement>('[data-cosmic-load-retry]').focus();
  }
  private find<T extends HTMLElement=HTMLElement>(selector:string):T{return this.root.querySelector<T>(selector)!;}
  private session(){return this.sessions.session(client.sessions);}
  private key(session:Session){return this.sessions.key(session);}
  private balance(){return this.sessions.balance(client,demoWallet);}
  private blocked(){return this.destroyed||!this.assets.ready||!!this.live||client.busy||!!client.pending||client.loading||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion')||document.hidden||!client.accountId;}
  private motionReduced(){return this.reduced.matches||this.manualReduced;}
  private updateRacer() {
    const visible = !this.destroyed && this.assets.ready && this.entered && !document.hidden &&
      this.root.dataset.slotPriority !== 'landscape' && !this.autoOpen &&
      !this.root.querySelector('.slot-settings-dialog[open]') &&
      (!this.dialog || this.dialog === 'bonus' || this.dialog === 'complete');
    this.racer.context(visible, visible && !this.motionReduced(), !!this.live);
  }
  private selectedMode(){return this.info.modes.find(mode=>mode.id===this.mode)??this.info.modes[0];}
  private symbol(id:number){return cosmicSymbol(id,this.assets.ready);}
  private speedLabel(speed:Speed){return speed==='fast'?translateText('Быстро'):translateText('Обычно');}
  private bind(){
    this.dialogShell=new SlotDialog(this.find('[data-lg-dialog]'),this.find('[data-lg-dialog-backdrop]'),'data-lg-dialog-action',action=>void this.dialogAction(action),()=>{if(this.dialog==='complete')this.stopAuto();this.closeDialog();});
    this.stakeControls=new SlotStakeControls({
      values:COSMIC_ESCAPE_BET_UNITS,maximumCents:maximumStakeCents,select:this.find<HTMLSelectElement>('[data-lg-stake]'),
      steps:Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cosmic-stake]')),
      direction:button=>Number(button.getAttribute('data-cosmic-stake')),current:()=>this.stake,
      locked:()=>this.blocked()||this.session()?.state==='active'||this.autoRemaining>0||!!this.dialog,
      changed:stake=>{this.stake=stake;this.controls();},
    });
    this.soundControls=new SlotAudioControls({
      sound:this.find<HTMLButtonElement>('[data-lg-sound]'),music:this.find<HTMLButtonElement>('[data-lg-music]'),
      volume:this.find<HTMLInputElement>('[data-lg-volume]'),audio:this.audio,entered:()=>this.entered,
    });
    this.find<HTMLButtonElement>('[data-cosmic-load-retry]').onclick=()=>void this.assets.load();
    this.find<HTMLButtonElement>('[data-cosmic-wallet]').onclick=()=>{this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));};
    this.find<HTMLButtonElement>('[data-cosmic-missions]').onclick=()=>{if(!this.blocked()){this.stopAuto();this.closeAuto(false);this.openDialog('buy');}};
    this.find<HTMLButtonElement>('[data-lg-spin]').onclick=()=>this.primary();
    this.find<HTMLButtonElement>('[data-lg-info]').onclick=()=>{this.stopAuto();this.openDialog('info');};
    this.tool('[data-cx-rules]').onclick=()=>{this.stopAuto();this.closeAuto(false);this.openDialog('info');};
    this.tool('[data-cx-sound]').onclick=()=>this.find<HTMLButtonElement>('[data-lg-sound]').click();
    this.find<HTMLButtonElement>('[data-lg-history]').onclick=()=>{this.stopAuto();this.openDialog('history');};
    const speeds=this.find('.cx-speed');
    speeds.onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-cx-speed]');if(button&&!button.disabled){this.speed=button.dataset.cxSpeed as Speed;this.controls();}};
    speeds.onkeydown=event=>{
      const step=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;if(!step||this.live)return;
      event.preventDefault();this.speed=SPEEDS[(SPEEDS.indexOf(this.speed)+step+SPEEDS.length)%SPEEDS.length];this.controls();
      this.root.querySelector<HTMLButtonElement>(`[data-cx-speed="${this.speed}"]`)?.focus();
    };
    this.find<HTMLButtonElement>('[data-cx-speed-cycle]').onclick=()=>{if(this.live)return;this.speed=SPEEDS[(SPEEDS.indexOf(this.speed)+1)%SPEEDS.length];this.controls();};
    this.find<HTMLButtonElement>('[data-lg-pause]').onclick=()=>{this.stopAuto();this.controls();};
    this.find<HTMLSelectElement>('[data-lg-mode]').onchange=event=>{if(this.blocked()||this.session()?.state==='active')return;this.mode=(event.target as HTMLSelectElement).value;this.stopAuto();this.controls();};
    this.find<HTMLButtonElement>('[data-lg-auto]').onclick=()=>{if(this.autoRemaining){this.stopAuto();this.controls();return;}if(this.autoOpen)this.closeAuto(true);else this.openAuto();};
    const panel=this.find('[data-cx-auto-panel]');
    panel.onclick=event=>{
      const target=event.target as HTMLElement;
      const count=target.closest<HTMLButtonElement>('[data-cx-auto-count]');
      if(count){this.autoCount=Number(count.dataset.cxAutoCount);this.controls();return;}
      if(target.closest('[data-cx-auto-close]')){this.closeAuto(true);return;}
      if(target.closest('[data-cx-auto-start]'))this.startAuto();
    };
    panel.onkeydown=event=>{if(event.key!=='Tab')return;const items=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    this.find<HTMLButtonElement>('[data-lg-retry]').onclick=()=>void this.retry();
    this.find<HTMLButtonElement>('[data-lg-refresh]').onclick=()=>void this.refresh();
    this.find('[data-lg-dialog]').onchange=event=>{const target=event.target as HTMLInputElement;if(!target.matches('[data-lg-reduce]'))return;this.manualReduced=target.checked;try{localStorage.setItem('royal-luelon-reduced',this.manualReduced?'1':'0');}catch{}this.motionChange();};
    this.find('[data-lg-choice]').onclick=event=>{const target=(event.target as HTMLElement).closest<HTMLElement>('[data-lg-pick]');if(target&&!this.blocked())void this.request(Number(target.dataset.lgPick));};
  }
  private markup(){
    const orbs=Array.from({length:5},(_,i)=>`<i data-cosmic-orb="${i}">${this.symbol(8)}</i>`).join('');
    const ladder=PORTAL_LADDER.map(([need,spins])=>`<li data-cx-ladder="${need}" ><span>${need===5?translateText('5 порталов'):tr`${need} портала`}</span><span>${spins}</span></li>`).join('');
    const gauge=ENERGY_STEPS.map(step=>`<i data-cx-energy-step="${step}" data-on="${step===1}">×${step}</i>`).join('');
    const speeds=SPEEDS.map(speed=>`<button type="button" role="radio" data-cx-speed="${speed}" aria-checked="${speed==='normal'}" tabindex="${speed==='normal'?0:-1}">${this.speedLabel(speed)}</button>`).join('');
    const counts=AUTO_COUNTS.map(count=>`<button type="button" data-cx-auto-count="${count}" aria-pressed="${count===this.autoCount}">${count}</button>`).join('');
    const stakes=COSMIC_ESCAPE_BET_UNITS.map(value=>`<option value="${value}">${coins(value)}</option>`).join('');
    const modes=this.info.modes.map(mode=>`<option value="${escape(mode.id)}">${escape(mode.name)}</option>`).join('');
    return tr`<section class="lg-game ce-game cx-game" data-luelon-game="${this.game}" data-studio-game="${this.game}" data-cosmic-escape data-phase="idle" data-asset-state="loading" data-spin-state="idle" data-speed="normal" aria-label="Cosmic Escape">
<div class="ce-asset-loading" data-cosmic-loading><div class="ce-loading-orbit" aria-hidden="true"><i></i></div><strong data-cosmic-load-title>ГОТОВИМ КОСМИЧЕСКИЙ ПОБЕГ</strong><progress data-cosmic-load-progress max="3" value="0" aria-label="Загрузка оформления"></progress><p data-cosmic-load-note role="status" aria-live="polite">Изображения: 0 из 3</p><button type="button" data-cosmic-load-retry hidden>Повторить загрузку</button></div>
<div class="cx-scene"><div class="cx-deck">
<div class="cx-alien" aria-hidden="true"><img data-cosmic-alien alt=""></div>
<div class="cx-tools" role="toolbar" aria-label="Правила, звук и настройки"><button type="button" class="cx-icon" data-cx-rules aria-label="Правила и выплаты">${ICON.info}</button><button type="button" class="cx-icon" data-cx-sound aria-label="Выключить звук" aria-pressed="true">${ICON.sound}${ICON.muted}</button></div>
<div class="cx-frame"><i class="cx-lamp" aria-hidden="true"></i><div data-lg-board role="group" aria-label="Пять барабанов, три ряда"></div><i class="cx-lamp" aria-hidden="true"></i></div>
<section class="cx-energy" data-cosmic-energy aria-labelledby="cx-energy-title"><h3 id="cx-energy-title">Энергия</h3><strong data-lg-factor>×1</strong><div class="cx-gauge" aria-hidden="true">${gauge}</div><small class="cx-sr" data-lg-factor-note>Множитель всех линий</small></section>
<section class="cx-portals" data-cosmic-portals aria-labelledby="cx-portals-title"><header><h3 id="cx-portals-title">Порталы</h3><strong data-cosmic-portal-count>0<small> / 5</small></strong></header><div class="cx-orbs" aria-hidden="true">${orbs}</div><ol class="cx-ladder" aria-label="Бесплатные вращения за порталы">${ladder}</ol><p class="cx-ladder-note" aria-hidden="true">Бесплатные вращения за порталы</p></section>
<button type="button" class="cx-missions" data-cosmic-missions><b>Миссии</b><small>Купить 10, 12 или 15 вращений</small></button>
<section class="cx-result" data-cx-result data-kind="idle" aria-label="Результат вращения"><strong class="cx-amount" data-cx-result-amount></strong><p class="cx-result-text" role="status" aria-live="polite"><b data-cx-result-title></b><span data-cx-result-note></span></p><span class="cx-mode" data-cx-mode>Основная игра · 20 линий</span></section>
<div class="cx-feedback" data-cosmic-feedback><p class="lg-status" data-lg-status role="status"></p><p class="lg-error" data-lg-error role="alert"></p><div class="lg-recovery"><button type="button" data-lg-retry hidden>Проверить прежний ход</button></div></div>
</div></div>
<div class="cx-wallet-help" data-cosmic-wallet-help hidden><span data-cosmic-wallet-note></span><a href="/" data-cosmic-login>Войти в клуб для тестовой игры</a><button type="button" data-cosmic-wallet>Открыть тестовый кошелёк</button></div>
<footer class="cx-bar"><svg class="cx-dome" viewBox="0 0 320 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="cx-dome-fill" d="M0 56C48 56 58 2 110 2h100c52 0 62 54 110 54v6H0z"/><path class="cx-dome-line" d="M0 56C48 56 58 2 110 2h100c52 0 62 54 110 54"/></svg>
<div class="cx-bar-left">
<div class="cx-money"><span>Баланс</span><strong><output data-lg-balance>0,00</output> <small>USDT</small></strong></div>
<div class="cx-lastwin"><span>Выигрыш</span><strong><output data-cosmic-lastwin>0,00</output></strong></div>
<div class="cx-stake" data-cx-stake><label for="cx-stake-value"><span class="cx-long">Ставка на все 20 линий</span><span class="cx-short" aria-hidden="true">Ставка</span></label><div class="cx-stepper"><button type="button" data-cosmic-stake="-1" aria-label="Уменьшить ставку">${ICON.minus}</button><select id="cx-stake-value" data-lg-stake>${stakes}</select><button type="button" data-cosmic-stake="1" aria-label="Увеличить ставку">${ICON.plus}</button></div><small data-lg-cost></small></div>
</div>
<button type="button" class="cx-spin" data-lg-spin aria-label="Вращать барабаны">${reactorMarkup()}${ICON.stop}<strong data-cx-spin-count></strong><span data-lg-spin-label>Вращать</span></button>
<div class="cx-bar-right">
<button type="button" class="cx-auto-button" data-lg-auto aria-haspopup="dialog" aria-expanded="false" aria-controls="cx-auto-panel" aria-pressed="false">${ICON.auto}<span data-cx-auto-label>Авто</span></button>
<button type="button" class="cx-auto-button" data-lg-pause hidden>Пауза серии</button>
<div class="cx-speed" role="radiogroup" aria-label="Скорость вращения">${speeds}</div>
<button type="button" class="cx-speed-cycle" data-cx-speed-cycle><span>Скорость</span><b data-cx-speed-label>Обычно</b></button>
</div>
</footer>
<div class="cx-auto-panel" id="cx-auto-panel" data-cx-auto-panel role="dialog" aria-labelledby="cx-auto-title" hidden>
<header><h2 id="cx-auto-title">Автоигра</h2><button type="button" class="cx-icon" data-cx-auto-close aria-label="Закрыть автоигру">${ICON.close}</button></header>
<fieldset><legend>Количество вращений</legend><div class="cx-chips">${counts}</div></fieldset>
<button type="button" class="cx-primary" data-cx-auto-start></button>
</div>
<div class="cx-settings-host" data-cx-settings-host></div>
<div class="ce-footer cx-settings" data-cx-settings><div class="cx-settings-row"><button type="button" data-lg-info>Правила и выплаты</button><button type="button" data-lg-history>История раунда</button></div><div class="cx-settings-row"><button type="button" data-lg-sound aria-pressed="true">Звук</button><button type="button" data-lg-music aria-pressed="true">Музыка</button></div><label>Громкость <input data-lg-volume type="range" min="0" max="100" aria-label="Громкость игры"></label><button type="button" data-lg-refresh>Проверить состояние</button><small>Собственная версия Royal · тестовые виртуальные USDT</small></div>
<select data-lg-mode hidden aria-label="Режим игры">${modes}</select><div data-lg-choice hidden></div>
<div class="lg-dialog-backdrop ce-dialog-backdrop" data-lg-dialog-backdrop><div class="lg-dialog ce-dialog" data-lg-dialog role="dialog" aria-modal="true" aria-labelledby="lg-dialog-title"></div></div>
</section>`;
  }
  private sync(){
    if(this.destroyed)return;
    if(this.owner!==client.accountId){
      this.cancel();this.audio.pause();this.owner=client.accountId;delete this.root.dataset.sessionId;delete this.root.dataset.revision;this.shown='';this.stake=COSMIC_ESCAPE_DEFAULT_STAKE;this.mode='normal';this.entered=false;this.error='';this.setTotal(0);
      this.paintEnergy(1);this.find('[data-cosmic-lastwin]').textContent='0,00';this.idleResult();
      this.root.dataset.bonus='false';this.root.dataset.multiplier='1';this.paintPortals([]);this.setTotal(0);
      const ordinary=this.info.symbols.filter(symbol=>symbol.role==='ordinary');this.board.show(Array.from({length:this.info.cols*this.info.rows},(_,i)=>ordinary[i%ordinary.length].id),this.info.rows);
      this.openDialog('intro');
    }
    const session=this.session();observeExpansionOutcome(this.root,this.game,session,client.accountId,true,!!this.live&&client.pending?.gameId===this.game);
    if(!this.live&&session&&this.key(session)!==this.shown)this.static(session);
    this.controls();
  }
  private static(session:Session){
    const view=session.view.luelon;this.shown=this.key(session);this.root.dataset.sessionId=session.id;this.root.dataset.revision=String(view.revision);
    if(view.spin)this.board.show(view.spin.finalGrid,view.spin.rows,view.spin.featuresAfter);
    this.setTotal(session.state==='settled'?session.returnedUnits:view.totalPayoutUnits);
    this.features(view,view.spin?.featuresAfter??view.bonus?.features);this.choice(view);this.root.dataset.phase='idle';
    if(view.spin)this.describe(view,view.spin,session.stakeUnits,session.state==='settled',session.state==='settled'?session.returnedUnits:view.totalPayoutUnits);else this.idleResult();
  }
  private features(view:LuelonSlotView,features?:LuelonSlotFeatures){
    const bonus=view.bonus,factor=features?.multiplier??1,free=!!bonus&&view.phase!=='complete';
    this.paintEnergy(factor);
    this.find('[data-lg-factor-note]').textContent=view.phase==='complete'&&bonus?translateText('Итог миссии'):translateText('Множитель всех линий');
    this.find('[data-cx-mode]').textContent=free?translateText('БОНУС'):translateText('Основная игра · 20 линий');
    this.root.dataset.bonus=String(free);this.root.dataset.multiplier=String(factor);
    this.root.dataset.bonusPlayed=String(bonus?.played??0);this.root.dataset.bonusAwarded=String(bonus?.awarded??0);
    this.paintPortals(view.spin?.finalGrid??[]);
    if(free)this.paintReward(bonus.awarded);
  }
  /** During a mission the portal card shows the trigger that opened it: 10, 12 or 15 spins come from 3, 4 or 5 portals. */
  private paintReward(awarded:number){
    const reached=PORTAL_LADDER.find(([,spins])=>spins===awarded)?.[0];if(!reached)return;
    const count=this.find('[data-cosmic-portal-count]');count.innerHTML=`${reached}<small> / 5</small>`;count.setAttribute('aria-label',tr`Миссию открыли порталы: ${reached} из 5`);
    this.root.querySelectorAll<HTMLElement>('[data-cosmic-orb]').forEach((orb,index)=>orb.classList.toggle('ce-orb-active',index<reached));
    this.root.querySelectorAll<HTMLElement>('[data-cx-ladder]').forEach(row=>{row.dataset.state=Number(row.dataset.cxLadder)===reached?'reached':'';});
  }
  private choice(_view:LuelonSlotView){this.find('[data-lg-choice]').hidden=true;}
  private controls(){
    this.updateRacer();
    if(this.destroyed)return;
    const session=this.session(),active=session?.state==='active',blocked=this.blocked();
    if(active){this.stake=session.stakeUnits;this.mode=session.view.luelon.mode;}
    const mode=this.selectedMode(),bonus=active?session.view.luelon.bonus:null,free=!!bonus&&session?.view.luelon.phase==='bonus';
    const help=this.find('[data-cosmic-wallet-help]');help.hidden=!!client.accountId&&(active||this.balance()>=Number(this.stake)/100);
    this.find('[data-cosmic-login]').hidden=!!client.accountId;this.find('[data-cosmic-wallet]').hidden=!client.accountId;
    this.find('[data-cosmic-wallet-note]').textContent=client.accountId?translateText('На счёте не хватает USDT (Nile) для ставки.'):translateText('Для игры нужен общий баланс USDT.');
    if(this.dialog==='intro'){const enter=this.root.querySelector<HTMLButtonElement>('[data-lg-dialog-action="enter"]');if(enter){enter.disabled=!this.assets.ready;enter.textContent=active?translateText('ПРОДОЛЖИТЬ МИССИЮ'):translateText('НАЧАТЬ ПУТЕШЕСТВИЕ');}}
    this.money(this.find('[data-lg-balance]'),coins((this.live?.balance??this.balance())*100));
    // Primary action: spin, quick stop while reels move, stop autoplay, or continue a saved free-spin series.
    const spin=this.find<HTMLButtonElement>('[data-lg-spin]'),state=this.live?'spinning':free?'bonus':this.autoRemaining?'auto':'idle';
    this.root.dataset.spinState=state;
    const count=this.find('[data-cx-spin-count]'),label=this.find('[data-lg-spin-label]');
    if(state==='spinning'){
      const previous=this.live?.before,series=previous?.state==='active'?previous.view.luelon.bonus:null;
      const current=series?Math.min(series.played+1,series.awarded):0;
      spin.disabled=!this.board.canHurry();label.textContent=translateText('Стоп');
      count.textContent=series?tr`${current} из ${series.awarded}`:'';
      this.reactor.paint(series?.awarded??10,series?current:3,!series&&!this.motionReduced());
      spin.setAttribute('aria-label',series?`${tr`Бесплатное вращение ${current} из ${series.awarded}`}. ${translateText('Остановить барабаны быстрее')}`:translateText('Остановить барабаны быстрее'));
    }
    else if(state==='auto'){spin.disabled=false;this.reactor.paint(10,Math.max(1,Math.ceil(this.autoRemaining/this.autoCount*10)));count.textContent=String(this.autoRemaining);label.textContent=translateText('АВТО');spin.setAttribute('aria-label',tr`Остановить автоигру, осталось ${this.autoRemaining}`);}
    else if(state==='bonus'&&bonus){
      const next=Math.min(bonus.played+1,bonus.awarded);
      spin.disabled=blocked||!this.entered||!!this.dialog||this.bonusRunning;this.reactor.paint(bonus.awarded,next);count.textContent=tr`${next} из ${bonus.awarded}`;label.textContent=translateText('БОНУС');
      spin.setAttribute('aria-label',this.bonusRunning?tr`Бесплатное вращение ${next} из ${bonus.awarded}`:tr`Продолжить бонус, вращение ${next} из ${bonus.awarded}`);
    }
    else{spin.disabled=blocked||!this.entered||!!this.dialog;this.reactor.paint(10,10);count.textContent='';label.textContent=active?translateText('ПРОДОЛЖИТЬ'):translateText('Вращать');spin.setAttribute('aria-label',active?translateText('Продолжить раунд'):translateText('Вращать барабаны'));}
    this.stakeControls.update();
    const typed=this.root.querySelector<HTMLInputElement>('[data-cx-stake] [data-manual-stake]');if(typed&&document.activeElement!==typed&&typed.checkValidity())typed.value=coins(this.stake);
    this.find('[data-cx-stake]').dataset.locked=String(active||this.autoRemaining>0);
    this.find<HTMLSelectElement>('[data-lg-mode]').value=this.mode;this.find<HTMLSelectElement>('[data-lg-mode]').disabled=blocked||active||this.autoRemaining>0||!!this.dialog;
    this.find('[data-lg-cost]').textContent=active?translateText('Продолжение бесплатно'):tr`За ход: ${coins(this.stake)}`;
    this.find<HTMLButtonElement>('[data-cosmic-missions]').disabled=blocked||active||this.autoRemaining>0||!!this.dialog||!this.entered;
    this.transport(blocked,active,!!mode.bonus,free);
    this.find('[data-lg-error]').textContent=this.error||client.error;this.find('[data-cosmic-feedback]').dataset.error=String(!!(this.error||client.error));
    this.find('[data-lg-status]').textContent=client.loading?translateText('Проверяем сохранённый раунд…'):this.live?'':canRecoverOperation(client)?translateText('Ход сохранён. Проверь прежнюю операцию.'):'';
    this.root.dataset.autoRemaining=String(this.autoRemaining);this.root.dataset.remaining=String(session?.view.luelon.bonus?.remaining??0);
    this.root.setAttribute('aria-busy',String(this.assets.state.status==='loading'||!!this.live||client.busy));
    let short=false;
    for(const buy of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cx-price]'))){const missing=this.balance()<Number(buy.dataset.cxPrice)/100;short||=missing;buy.disabled=blocked||active||missing;}
    const funds=this.root.querySelector<HTMLElement>('[data-cosmic-buy-funds]');if(funds)funds.hidden=!short;
    this.audioControls();
  }
  private transport(blocked:boolean,active:boolean,paidBonus:boolean,free:boolean){
    const live=!!this.live;
    this.root.dataset.speed=this.speed;
    for(const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cx-speed]'))){const checked=button.dataset.cxSpeed===this.speed;button.setAttribute('aria-checked',String(checked));button.tabIndex=checked?0:-1;button.disabled=live;}
    const cycle=this.find<HTMLButtonElement>('[data-cx-speed-cycle]');cycle.disabled=live;this.find('[data-cx-speed-label]').textContent=this.speedLabel(this.speed);cycle.setAttribute('aria-label',tr`Скорость: ${this.speedLabel(this.speed)}. Нажми, чтобы сменить`);
    const auto=this.find<HTMLButtonElement>('[data-lg-auto]');
    this.find('[data-cx-auto-label]').textContent=this.autoRemaining?tr`Стоп · ${this.autoRemaining}`:translateText('Авто');
    auto.hidden=free;
    auto.disabled=!this.autoRemaining&&(blocked||active||!!this.dialog||!this.entered||paidBonus);
    auto.setAttribute('aria-pressed',String(this.autoRemaining>0));auto.setAttribute('aria-expanded',String(this.autoOpen));
    if(this.autoOpen&&auto.disabled&&!this.autoRemaining)this.closeAuto(false);
    for(const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cx-auto-count]')))button.setAttribute('aria-pressed',String(Number(button.dataset.cxAutoCount)===this.autoCount));
    this.find('[data-cx-auto-start]').textContent=tr`Запустить ${this.autoCount} вращений`;
    const pause=this.find<HTMLButtonElement>('[data-lg-pause]');pause.hidden=!free;pause.disabled=!this.bonusRunning;pause.textContent=this.bonusRunning?translateText('Пауза серии'):translateText('На паузе');
    for(const selector of ['[data-lg-info]','[data-lg-history]','[data-lg-refresh]'])this.find<HTMLButtonElement>(selector).disabled=live||client.busy;
    this.tool('[data-cx-rules]').disabled=live||client.busy;
    const retry=this.find<HTMLButtonElement>('[data-lg-retry]');retry.hidden=!canRecoverOperation(client);retry.disabled=!this.assets.ready||live||client.busy||document.hidden;
  }
  private audioControls(){
    this.soundControls?.update();if(!this.root)return;
    const on=!gameAudio.getPreferences().muted,mirror=this.tool('[data-cx-sound]');
    mirror.setAttribute('aria-pressed',String(on));mirror.setAttribute('aria-label',on?translateText('Выключить звук'):translateText('Включить звук'));
  }
  private paintEnergy(factor:number){
    this.find('[data-lg-factor]').textContent=`×${factor}`;
    this.root.querySelectorAll<HTMLElement>('[data-cx-energy-step]').forEach(step=>{step.dataset.on=String(Number(step.dataset.cxEnergyStep)<=factor);});
  }
  /** The result strip has a fixed box. Text is cut inside it and never changes the field geometry. */
  private result(kind:'idle'|'spin'|'none'|'win'|'return'|'portal',title:string,note='',amount=''){
    const strip=this.find('[data-cx-result]');strip.dataset.kind=kind;
    for(const [part,text] of [['title',title],['note',note],['amount',amount]] as const){const element=this.find(`[data-cx-result-${part}]`);if(element.textContent!==text)element.textContent=text;}
    this.find('[data-cx-result-amount]').dataset.long=String(amount.length>9);
  }
  private idleResult(){this.result('idle',translateText('Нажми «Вращать», чтобы начать путешествие'));}
  private missionNote(view:LuelonSlotView,total:string|number,settled:boolean){
    return settled?tr`Миссия ${coins(total)} · зачислено на баланс`:tr`Миссия ${coins(total)} · зачислим в конце`;
  }
  /** Only a confirmed spin reaches the strip. The amount belongs to this spin, the note names the whole round. */
  private describe(view:LuelonSlotView,spin:LuelonSlotSpin,stake:string,settled:boolean,total:string|number){
    const paid=Number(spin.payoutUnits),free=spin.kind!=='base',bonus=view.bonus;
    const played=view.history.filter(item=>item.kind!=='base'&&item.index<=spin.index).length;
    if(!paid){
      if(spin.triggerAwards)this.result('portal',translateText('Порталы открыты'),tr`${spin.triggerAwards} бесплатных вращений`);
      else this.result('none',translateText('Нет выигрышной линии'),free&&bonus?tr`Вращение ${played} из ${bonus.awarded} · миссия ${coins(total)}`:'');
      return;
    }
    const wins=spin.frames.flatMap(frame=>frame.wins.map(win=>({win,grid:frame.gridAfter})));
    const best=wins.reduce((top,item)=>Number(item.win.payoutUnits)>Number(top.win.payoutUnits)?item:top);
    const wild=best.win.symbol!==7&&best.win.positions.some(position=>best.grid[position]===7)?translateText(' с WILD'):'';
    const energy=best.win.factor>1?tr`, энергия ×${best.win.factor}`:'';
    const name=cosmicSymbolName(best.win.symbol);
    const line=wins.length===1&&best.win.line!==null?tr`Линия ${best.win.line+1} · ${best.win.count} × ${name}`:tr`Линий: ${wins.length} · ${best.win.count} × ${name}`;
    const share=(paid/Number(stake)).toLocaleString(locale,{maximumFractionDigits:2});
    const partial=!free&&settled&&paid<Number(stake);
    const note=free?this.missionNote(view,total,settled):settled?tr`×${share} от ставки · зачислено на баланс`:tr`×${share} от ставки`;
    this.result(partial?'return':'win',(partial?translateText('Возврат части ставки')+' · ':'')+line+wild+energy,note,coins(paid));
  }
  /** Long amounts shrink inside their fixed cell. */
  private money(element:HTMLElement,text:string){if(element.textContent!==text)element.textContent=text;element.dataset.long=String(text.length>9);}
  private setTotal(value:string|number){
    const amount=this.find('[data-cosmic-lastwin]'),text=coins(value);
    this.money(amount,text);
    amount.dataset.positive=String(units(value)>0);
  }
  private valid(live:Live){return !this.destroyed&&this.playback.current(live,this.live);}
  private delay(ms:number,live:Live){return this.playback.delay(ms,()=>this.valid(live));}
  private stopAuto(){this.autoRemaining=0;this.bonusRunning=false;this.playback.cancelScheduled();}
  private cancel(){this.playback.cancel();this.stopAuto();this.live=undefined;this.racer.show('idle');this.board.cancel();this.audio.stopSpin();this.shown='';resetGameOutcomes(this.root);this.root.dataset.phase='idle';this.root.dataset.shipActive='false';this.root.dataset.echo='false';}
  private primary(){
    if(this.live){if(this.board.hurry()){this.live.fast=true;this.controls();}return;}
    if(this.autoRemaining){this.stopAuto();this.controls();return;}
    void this.play();
  }
  private openAuto(){
    const auto=this.find<HTMLButtonElement>('[data-lg-auto]');if(auto.disabled||this.blocked()||!this.entered||this.dialog)return;
    this.autoOpen=true;this.find('[data-cx-auto-panel]').hidden=false;
    this.controls();this.root.querySelector<HTMLButtonElement>(`[data-cx-auto-count="${this.autoCount}"]`)?.focus();
  }
  private closeAuto(focus:boolean){
    if(!this.autoOpen)return;this.autoOpen=false;this.find('[data-cx-auto-panel]').hidden=true;
    this.updateRacer();
    this.find('[data-lg-auto]').setAttribute('aria-expanded','false');if(focus)this.find<HTMLButtonElement>('[data-lg-auto]').focus();
  }
  private startAuto(){
    if(!this.autoOpen||this.blocked()||!this.entered||this.dialog||this.session()?.state==='active')return;
    this.autoRemaining=this.autoCount;
    this.closeAuto(false);this.find<HTMLButtonElement>('[data-lg-spin]').focus();void this.request();this.controls();
  }
  private async play(){if(this.blocked()||!this.entered||this.dialog)return;const active=this.session()?.state==='active';if(!active)this.mode='normal';if(!active&&this.selectedMode().bonus){this.stopAuto();this.openDialog('buy');return;}this.bonusRunning=!!active;await this.request();}
  private async request(pick?:number){
    if(this.blocked()||!this.entered||this.dialog)return;
    const previous=this.session(),active=previous?.state==='active',mode=this.selectedMode(),cost=active?0:Number(this.stake)*mode.cost/100;
    if(this.balance()<cost){this.error=translateText('Недостаточно USDT (Nile) для выбранной ставки.');this.stopAuto();this.controls();return;}
    void this.audio.enter();
    const live:Live={...this.playback.capture(client.accountId!),operationId:'',balance:this.balance(),motion:!this.motionReduced(),fast:this.speed==='fast',before:previous};
    this.live=live;this.error='';this.root.dataset.phase=active?'preparing':'spinning';this.root.dataset.animationToken=live.token;
    observeExpansionOutcome(this.root,this.game,previous,client.accountId,true,true);
    if(!active&&this.autoRemaining)this.autoRemaining--;
    if(pick===undefined&&!active&&!mode.bonus){this.board.begin(live.token,live.motion,live.fast,undefined,undefined);void this.audio.begin(live.token);}
    const series=active?previous?.view.luelon.bonus:null;
    this.result('spin',series?tr`Бесплатное вращение ${Math.min(series.played+1,series.awarded)} из ${series.awarded}`:translateText('Барабаны вращаются'),series&&previous?this.missionNote(previous.view.luelon,previous.view.luelon.totalPayoutUnits,false):'');
    this.controls();
    if(active)this.racer.prepareFeatures();
    try{
      const operation=this.sessions.operation(this.stake,this.mode,previous,pick);const promise=client.act(operation);live.operationId=client.pending?.id??'';await promise;
      if(!this.valid(live))return;
      const session=this.session();if(!this.sessions.confirmed(session,previous,live.operationId))throw Error(translateText('Ход не подтверждён. Проверь прежнюю операцию.'));
      const view=session.view.luelon;
      const startsMission = view.phase==='bonus' && (!view.spin || view.spin.kind==='base' && !!view.spin.triggerAwards);
      const reaction = startsMission ? 'bonus' : session.state==='settled' ? cosmicRacerOutcome(session.spentUnits, session.returnedUnits) : 'idle';
      this.racer.prepare(reaction);
      await this.present(session,live);if(!this.valid(live))return;
      this.live=undefined;this.root.dataset.phase='idle';this.root.dataset.animationToken='';this.shown=this.key(session);if(session.state==='settled')this.mode='normal';
      this.features(session.view.luelon,session.view.luelon.spin?.featuresAfter??session.view.luelon.bonus?.features);this.choice(session.view.luelon);
      this.setTotal(session.state==='settled'?session.returnedUnits:session.view.luelon.totalPayoutUnits);this.controls();
      observeExpansionOutcome(this.root,this.game,session,client.accountId,false,false);
      this.racer.show(reaction);
      if(view.phase==='choice'){this.bonusRunning=false;return;}
      if(startsMission){this.racer.prepareFeatures();this.bonusRunning=false;this.openDialog('bonus');return;}
      if(view.phase==='complete'&&view.history.some(spin=>spin.kind!=='base')){this.bonusRunning=false;this.openDialog('complete');return;}
      if(session.state==='active'&&this.bonusRunning||session.state==='settled'&&this.autoRemaining>0)this.scheduleNext();
      else this.controls();
    }catch(error){if(this.valid(live)){this.error=(error as Error).message;this.stopAuto();this.live=undefined;this.racer.show('idle');this.board.cancel();this.idleResult();this.audio.stopSpin();this.shown='';this.sync();}}
    finally{if(this.live===live&&!this.valid(live)){this.live=undefined;this.racer.show('idle');this.audio.stopSpin();}}
  }
  private async present(session:Session,live:Live){
    const view=session.view.luelon,spin=view.spin;
    this.root.dataset.sessionId=session.id;this.root.dataset.revision=String(view.revision);
    if(!spin||live.before?.id===session.id&&live.before.view.luelon.spin?.index===spin.index){this.audio.stopSpin();this.setTotal(confirmedPayout(session,view.totalPayoutUnits));this.features(view,view.bonus?.features);return;}
    let total=Number(view.totalPayoutUnits)-Number(spin.payoutUnits);this.setTotal(total);
    if(spin.kind==='free-spin'){
      this.features(view,spin.featuresBefore);
      const energy=spin.frames[0]?.events.find(event=>event.kind==='energy');
      if(energy){this.root.dataset.phase='feature';this.root.dataset.shipActive='true';if(!await this.energy(energy.before,energy.after,live))return;this.root.dataset.shipActive='false';}
      this.root.dataset.phase='spinning';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);this.controls();
    }
    if(!await this.board.settle(live.token,spin.initialGrid,spin.rows)||!this.valid(live))return;
    this.audio.stopSpin();this.paintPortals(spin.initialGrid);
    if(spin.kind!=='free-spin')this.features({...view,bonus:live.before?.state==='active'?live.before.view.luelon.bonus:null},spin.featuresBefore);
    for(const frame of spin.frames){
      if(!this.valid(live))return;
      if(frame.index>0){this.root.dataset.phase='spinning';this.root.dataset.echo='true';this.board.begin(live.token,live.motion,live.fast);void this.audio.begin(live.token);if(!await this.board.settle(live.token,frame.gridBefore,spin.rows)||!this.valid(live))return;this.audio.stopSpin();}
      this.board.show(frame.gridBefore,spin.rows,spin.featuresBefore);
      for(const event of frame.events){
        if(frame.index===0&&spin.kind==='free-spin'&&event.kind==='energy')continue;
        this.root.dataset.phase='feature';this.audio.feature(event.kind);
        this.root.dataset.shipActive=String(event.kind==='expand'||event.kind==='energy');
        if(event.kind==='echo'){
          this.racer.show('echo');
          this.paintEnergy(event.after);
          this.find('[data-lg-factor-note]').textContent=translateText('Эхо: тот же множитель');
        }
        if(event.kind==='expand')this.racer.show('wild');
        if(event.kind==='energy'){if(!await this.energy(event.before,event.after,live))return;}
        else if(!await this.board.effect(event,frame.gridAfter,live.fast,live.motion,()=>this.valid(live)))return;
        if(event.kind==='expand')this.board.transform(frame.gridAfter,event.positions);
        this.root.dataset.shipActive='false';
      }
      this.board.show(frame.gridAfter,spin.rows,spin.featuresBefore);this.paintPortals(frame.gridAfter);
      const lineWin=frame.wins.find(win=>win.line!==null);
      this.board.highlight(frame.wins.flatMap(win=>win.positions),lineWin?.line!==null&&lineWin?.line!==undefined?this.info.paylines[lineWin.line]:undefined);
      this.root.dataset.phase='winning';
      if(frame.wins.length)this.describe(view,{...spin,frames:spin.frames.slice(0,frame.index+1),payoutUnits:String(spin.frames.slice(0,frame.index+1).reduce((sum,item)=>sum+Number(item.payoutUnits),0))},session.stakeUnits,false,total+Number(frame.payoutUnits));
      total+=Number(frame.payoutUnits);this.setTotal(total);if(frame.wins.length)this.audio.cascade(frame.index);
      if(live.motion&&frame.wins.length&&!await this.delay(live.fast?220:750,live))return;
    }
    for(const event of spin.events){this.root.dataset.phase='feature';this.audio.feature(event.kind);if(!await this.board.effect(event,spin.finalGrid,live.fast,live.motion,()=>this.valid(live)))return;}
    if(!this.valid(live))return;
    this.root.dataset.echo='false';this.root.dataset.shipActive='false';this.board.show(spin.finalGrid,spin.rows,spin.featuresAfter);
    // Keep the winning line visible on the final field until the next spin begins.
    const finalFrame=spin.frames.at(-1),finalLine=finalFrame?.wins.find(win=>win.line!==null)?.line;
    if(finalFrame?.wins.length)this.board.highlight(finalFrame.wins.flatMap(win=>win.positions),finalLine!=null?this.info.paylines[finalLine]:undefined);
    this.paintPortals(spin.finalGrid);this.features(view,spin.featuresAfter);this.setTotal(confirmedPayout(session,view.totalPayoutUnits));
    this.describe(view,spin,session.stakeUnits,session.state==='settled',confirmedPayout(session,view.totalPayoutUnits));
    this.audio.outcome(Number(spin.payoutUnits)>0);if(live.motion)await this.delay(live.fast?150:400,live);
  }
  private async energy(before:number,after:number,live:Live){
    if(after>before)this.racer.show('energy');
    this.root.dataset.multiplier=String(after);
    if(!live.motion){this.paintEnergy(after);return this.valid(live);}
    this.audio.energy();const steps=Math.min(after-before,12),duration=live.fast?450:1000;
    for(let i=1;i<=steps;i++){if(!this.valid(live))return false;this.paintEnergy(before+Math.round((after-before)*i/steps));if(!await this.delay(duration/steps,live))return false;}
    return this.valid(live);
  }
  private paintPortals(grid:readonly number[]){
    this.portals=grid.filter(id=>id===8).length;
    const count=this.find('[data-cosmic-portal-count]');count.innerHTML=`${this.portals}<small> / 5</small>`;count.setAttribute('aria-label',tr`Порталов на поле: ${this.portals} из 5`);
    this.root.querySelectorAll<HTMLElement>('[data-cosmic-orb]').forEach((orb,index)=>orb.classList.toggle('ce-orb-active',index<this.portals));
    // Highlight the reward already reached, otherwise the next reachable one.
    const reached=this.portals>=3?Math.min(5,this.portals):0,next=reached?0:3;
    this.root.querySelectorAll<HTMLElement>('[data-cx-ladder]').forEach(row=>{const need=Number(row.dataset.cxLadder);row.dataset.state=need===reached?'reached':need===next?'next':'';});
    this.root.dataset.portals=String(this.portals);
  }
  private scheduleNext(){this.playback.schedule(this.speed==='normal'?550:160,()=>{if(!this.dialog&&!this.blocked())void this.request();});}
  private async retry(){if(this.destroyed||!this.assets.ready||this.live||client.busy||!client.pending||document.hidden)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);try{await client.retry();}catch(error){this.error=(error as Error).message;}if(!this.destroyed){this.shown='';this.sync();}}
  private async refresh(){if(this.destroyed||!this.assets.ready||this.live||client.busy||client.loading)return;this.stopAuto();this.error='';resetGameOutcomes(this.root);await client.refresh();if(!this.destroyed){this.shown='';this.sync();}}
  private openDialog(kind:Dialog){this.settings?.close();if(kind)this.closeAuto(false);
    this.dialog=kind;
    const element=this.find('[data-lg-dialog]'),session=this.session(),view=session?.view.luelon,mode=this.selectedMode();
    this.dialogShell.begin(kind);
    if(!kind)return;
    element.dataset.dialog=kind;
    if(kind==='intro')element.innerHTML=tr`<div class="ce-intro-title"><small>ПУТЕШЕСТВИЕ НАЧИНАЕТСЯ</small><h2 id="lg-dialog-title">COSMIC <em>ESCAPE</em></h2><p>Поймай сигнал. Открой порталы. Запусти миссию.</p></div><div class="ce-intro-cards"><article><div>${this.symbol(0)}${this.symbol(7)}${this.symbol(2)}</div><h3>20 ЛИНИЙ</h3><p>Три и более совпадения слева. WILD заменяет обычные символы.</p></article><article><div>${this.symbol(8)}${this.symbol(8)}${this.symbol(8)}</div><h3>3 ПОРТАЛА</h3><p>10 бесплатных вращений. Четыре портала дают 12, пять дают 15.</p></article><article><div class="ce-intro-boost">${this.symbol(7)}<strong>×50</strong></div><h3>ЭНЕРГИЯ МИССИИ</h3><p>Луч создаёт целый WILD-барабан. Множитель усиливает все линии.</p></article></div><button type="button" class="lg-primary ce-primary" data-lg-dialog-action="enter">${view?.phase==='bonus'?translateText('ВЕРНУТЬСЯ В МИССИЮ'):translateText('НАЧАТЬ ПУТЕШЕСТВИЕ')}</button><small class="ce-dialog-note">Виртуальные USDT · Вход без ставки</small>`;
    if(kind==='buy')element.innerHTML=this.missionsMarkup();
    if(kind==='bonus')element.innerHTML=tr`<span class="lg-eyebrow">ПОРТАЛ ОТКРЫТ</span><h2 id="lg-dialog-title">${escape(this.info.modes.find(item=>item.id===view?.bonus?.id)?.name??translateText('Звёздная миссия'))}</h2><div class="ce-bonus-orbit">${this.symbol(8)}<strong>${view?.bonus?.remaining??0}</strong></div><p>Бесплатных вращений</p><p>Энергия начинается с ×${view?.bonus?.features.multiplier??1} и может увеличиться перед вращением до ×50.</p><button type="button" class="lg-primary ce-primary" data-lg-dialog-action="bonus">ВПЕРЁД В МИССИЮ</button><small class="ce-dialog-note">Ставка уже принята. Продолжение бесплатно.</small>`;
    if(kind==='complete'&&session&&view)element.innerHTML=renderSlotResult({style:'lg',eyebrow:translateText('ВОЗВРАЩЕНИЕ ДОМОЙ'),title:translateText('МИССИЯ ЗАВЕРШЕНА'),returned:session.returnedUnits,ledger:this.ledger(session),note:translateText('Выигрыш уже зачислен в кошелёк.'),label:translateText('ПРОДОЛЖИТЬ')});
    if(kind==='history')element.innerHTML=renderSlotHistory({style:'lg',eyebrow:translateText('БОРТОВОЙ ЖУРНАЛ'),title:translateText('ИСТОРИЯ МИССИИ'),ledger:session&&view?this.ledger(session):undefined,status:session?.state==='active'?translateText('Серия сохранена. Выплата поступит после завершения.'):translateText('Раунд завершён. Выплата зачислена один раз.'),empty:translateText('Здесь появится история твоего раунда.'),rows:view?.history.map(spin=>({title:`${spin.kind==='base'?translateText('Основное вращение'):translateText('Бесплатное вращение')} ${slotSpinNumber(spin,view!.history)}`,detail:`${spin.kind==='base'?tr`Стоимость ${coins(session!.spentUnits)}`:translateText('Стоимость 0,00')} · ${spin.frames.length>1?translateText('ЭХО · '):''}×${spin.featuresAfter.multiplier}`,payoutUnits:spin.payoutUnits}))??[]});
    if(kind==='info')element.innerHTML=renderSlotInfo({style:'lg',eyebrow:translateText('КАРТА КОСМИЧЕСКОГО ПОБЕГА'),title:translateText('ПРАВИЛА И ВЫПЛАТЫ'),reduced:this.manualReduced,bodyHtml:tr`<p>Пять барабанов, три ряда, 20 фиксированных линий. Все линии всегда активны. На каждой оплачивается только наибольшая выплата за совпадение из трёх и более символов слева. Значения таблицы умножаются на общую ставку.</p><p>WILD заменяет обычные символы. Портал не участвует в линиях: 3, 4 и 5 порталов в основной игре открывают 10, 12 и 15 бесплатных вращений.</p><p>В миссии энергия усиливает все выигрышные линии. Перед бесплатным вращением она может увеличиться и сохраняется между вращениями до ×50. Луч материнского корабля создаёт целый WILD-барабан. Второй отголосок даёт второе поле с текущим множителем без новой ставки.</p>${renderSlotPaytable('lg',this.info.symbols.map(symbol=>({symbolHtml:this.symbol(symbol.id),name:cosmicSymbolName(symbol.id),values:[Object.entries(symbol.pays).map(([count,pay])=>`${count}: ${(pay/100).toLocaleString(locale)}×`).join(' · ')||(symbol.role==='scatter'?'3 / 4 / 5: 10 / 12 / 15 FS':translateText('Заменяет обычные символы'))]})))}<details open><summary>20 фиксированных линий</summary>${renderSlotPaylines(this.info.paylines,3)}</details><p>Миссии: Звёздный хаос (40 ставок, 10 вращений, ×1), Вторжение (75 ставок, 12 вращений, ×1, до двух лучей), Дальнее эхо (135 ставок, 15 вращений, ×3, эхо встречается чаще).</p><p>Максимум за раунд: ${this.info.maxWin.toLocaleString(locale)} базовых ставок. Выплаты округляются вниз до 0,01 USDT. Ставка списывается один раз, весь выигрыш серии зачисляется один раз по окончании.</p><p>${language==='en'?'Choose 10, 25, 50 or 100 paid spins. After the mission, confirm the result to resume the series. Hiding the window, leaving the game, switching accounts or an error stops autoplay. A saved mission can be resumed for free.':'Выбери 10, 25, 50 или 100 платных вращений. После миссии подтверди результат, чтобы продолжить серию. Скрытие окна, выход, смена аккаунта или ошибка останавливают авто. Сохранённую миссию можно продолжить бесплатно.'}</p><p>Скорость «Быстро» сокращает анимацию. Результат и выплата от скорости не зависят.</p><p>Расчётный возврат новых ставок: около 96% на длинной дистанции. Отдельный раунд может завершиться без выплаты.</p><p class="lg-math-note">Собственная версия Royal: свои изображения, звуки и частоты событий. Вероятности исходной игры не опубликованы.</p>`});
    this.controls();this.dialogShell.focus(kind==='info');
  }
  private missionsMarkup(){
    const at=COSMIC_ESCAPE_BET_UNITS.indexOf(this.stake as typeof COSMIC_ESCAPE_BET_UNITS[number]);
    const texts=[translateText('WILD может занять весь барабан.'),translateText('Две попытки раскрыть WILD за вращение.'),translateText('Эхо случается вдвое чаще.')];
    const cards=this.info.modes.filter(mode=>mode.bonus).map((mode,i)=>{
      const price=Number(this.stake)*mode.cost;
      return tr`<article class="cx-mission"><div aria-hidden="true">${this.symbol([4,7,8][i])}</div><h3>${tr`${mode.spins} вращений`}</h3><small>${escape(mode.name)}</small><b>${tr`Энергия с ×${mode.startMultiplier}`}</b><p>${texts[i]}</p><button type="button" class="lg-primary ce-primary" data-lg-dialog-action="buy:${mode.id}" data-cx-price="${price}" ${this.balance()<price/100?'disabled':''}>${tr`Купить за ${coins(price)}`}</button></article>`;
    }).join('');
    return tr`<h2 id="lg-dialog-title">Выбери миссию</h2><p>Цена списывается один раз. Все вращения миссии бесплатные.</p><div class="ce-mission-stake"><span>БАЗОВАЯ СТАВКА</span><button type="button" data-lg-dialog-action="stake:-1" aria-label="Уменьшить ставку миссии" ${at===0?'disabled':''}>−</button><strong>${coins(this.stake)}</strong><button type="button" data-lg-dialog-action="stake:1" aria-label="Увеличить ставку миссии" ${at===COSMIC_ESCAPE_BET_UNITS.length-1?'disabled':''}>+</button></div><div class="cx-missions-grid">${cards}</div><p class="cx-mission-note">Цена указана в USDT за всю миссию. Выплата может оказаться меньше цены или равной нулю.</p><p class="ce-insufficient" data-cosmic-buy-funds hidden>Недостаточно USDT (Nile). Выбери меньшую ставку.</p><button type="button" class="ce-dialog-back" data-lg-dialog-action="close">Вернуться в игру</button>`;
  }
  private ledger(session:Session){return renderSlotLedger('lg',session.spentUnits,session.state==='active'?session.view.luelon.totalPayoutUnits:session.returnedUnits,session.state==='active');}
  private closeDialog(){if(this.dialog==='buy'&&this.session()?.state!=='active')this.mode='normal';this.dialog='';this.controls();this.dialogShell.hide();}
  private async dialogAction(action:string){
    if(this.destroyed||!this.assets.ready)return;
    if(action.startsWith('stake:')&&this.dialog==='buy'&&!this.blocked()){const next=slotStakeStep(COSMIC_ESCAPE_BET_UNITS,this.stake,Number(action.slice(6)));if(next){this.stake=next;this.openDialog('buy');}return;}
    if(action==='enter'){this.entered=true;this.closeDialog();void this.audio.enter();if(this.session()?.state==='active'){this.bonusRunning=true;await this.request();}return;}
    if(action==='close'){this.closeDialog();return;}
    if(action.startsWith('buy:')&&this.dialog==='buy'){const selected=action.slice(4);if(this.blocked()||!this.info.modes.some(mode=>mode.id===selected&&mode.bonus))return;this.closeDialog();this.mode=selected;this.bonusRunning=false;await this.request();return;}
    if(action==='bonus'){this.closeDialog();this.bonusRunning=true;await this.request();return;}
    if(action==='complete'){this.closeDialog();if(this.autoRemaining>0)this.scheduleNext();}
  }
  getAudioState(){return this.audio.state();}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.unmountHeaderTools();document.removeEventListener('pointerdown',this.outside,true);this.layout.disconnect();this.assets.destroy();this.cancel();this.racer.destroy();this.audio.destroy();this.board.destroy();this.unsubscribe();this.settings?.destroy();this.dialogShell.destroy();this.stakeControls.destroy();this.soundControls.destroy();this.playback.destroy();this.host.replaceChildren();}
}
