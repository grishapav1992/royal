import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {readGameHost} from '../../src/modules/GameHostContract';
import {WILD_NUDGE_GAME,STAR_SPIN_STAKES as WILD_NUDGE_STAKES,type WildNudgeView} from '../../src/shared/wildNudgeStakes';
import {WILD_NUDGE_DATA as R,wildNudgeSpin,type NudgeSpin} from '../../src/shared/wildNudgeMath';
import {DEFAULT_GAME_STAKE} from '../../src/shared/gameStakes';
import {syncStakeSelect} from '../../src/ui/stakeSelection';
import {GalacticAudio,type GalacticCue} from './GalacticAudio';
import {StarSpinCollection} from './StarSpinCollection';
import {StarSpinCharacter} from './StarSpinCharacter';
import {StarSpinLayout} from './StarSpinLayout';
import {StarSpinFx,GOLD} from './StarSpinFx';
const image=(symbol:number)=>`/assets/wild-nudge/symbol-${symbol}.webp`;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const symbolNames=['Энергетический клинок','Куб знаний','Звёздный компас','Реликтовая маска','Космический кристалл','Медальон','Реактор WILD','Портал SCATTER'];
const symbolNamesEn=['Energy blade','Knowledge cube','Star compass','Relic mask','Cosmic crystal','Medallion','WILD reactor','SCATTER portal'];
const svg=(body:string)=>`<svg class="gn-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
/** Drawn icons stay optically centred in every system font, unlike symbol glyphs. */
const ICON={star:svg('<path d="M12 2.2 14.1 9.9 21.8 12 14.1 14.1 12 21.8 9.9 14.1 2.2 12 9.9 9.9Z" fill="currentColor"/>'),note:svg('<path d="M9 17.5V5.5l10-2v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="17.5" r="2.6" fill="currentColor"/><circle cx="16.5" cy="15.5" r="2.6" fill="currentColor"/>'),help:svg('<path d="M9 8.6a3 3 0 1 1 4.2 2.75c-.75.35-1.2 1.05-1.2 1.9v.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.35" fill="currentColor"/>'),gear:svg('<path d="M19.36 10.11 L21.87 10.37 L21.87 13.63 L19.36 13.89 L18.54 15.87 L20.13 17.83 L17.83 20.13 L15.87 18.54 L13.89 19.36 L13.63 21.87 L10.37 21.87 L10.11 19.36 L8.13 18.54 L6.17 20.13 L3.87 17.83 L5.46 15.87 L4.64 13.89 L2.13 13.63 L2.13 10.37 L4.64 10.11 L5.46 8.13 L3.87 6.17 L6.17 3.87 L8.13 5.46 L10.11 4.64 L10.37 2.13 L13.63 2.13 L13.89 4.64 L15.87 5.46 L17.83 3.87 L20.13 6.17 L18.54 8.13Z M15.2 12a3.2 3.2 0 1 0-6.4 0a3.2 3.2 0 1 0 6.4 0Z" fill="currentColor" fill-rule="evenodd"/>'),spin:svg('<path d="M21.5 3.5v6h-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.1 15a8.5 8.5 0 1 1-2-8.85L21.5 9.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')};
export class GalacticReactorUI {
  private services=readGameHost();private client=this.services.expansionClient;
  private root:HTMLElement;private modal:HTMLDialogElement;private priorFocus?:HTMLElement;
  private collection:StarSpinCollection;private character:StarSpinCharacter;
  private lifetime=new AbortController();private motion=new AbortController();private layout:StarSpinLayout;
  private secondary:HTMLElement;private secondaryHome:HTMLElement;
  private audio=new GalacticAudio();private animations=new Set<Animation>();private timers=new Set<ReturnType<typeof setTimeout>>();
  private media=window.matchMedia('(prefers-reduced-motion: reduce)');
  private fx!:StarSpinFx;private cycle?:ReturnType<typeof setInterval>;private cycleAnimations=new Set<Animation>();private cycleAbort=new AbortController();private lastSide='';private lastRemaining?:number;
  private owner=this.client.accountId;private epoch=0;private dead=false;private paused=false;private busy=false;private presenting=false;
  private shown?:WildNudgeView;private shownKey='';private shownPayout='0';private note='';private error='';private stake=DEFAULT_GAME_STAKE;private fast=false;private forceReduced=false;
  private auto=false;private autoLeft=0;private autoCount=10;private autoEpoch=0;private lastBalance?:number;
  private skew:{cue:string;mode:string;skewMs:number}[]=[];private unsubscribe:()=>void;
  private changed=()=>this.sync();
  private hidden=()=>{if(document.hidden)this.pause();else this.resume();};
  private blurred=()=>{this.stopAuto();};
  get title(){return 'Star Spin';}
  private text(ru:string,en:string){return this.services.i18n.language==='en'?en:ru;}
  private get reduced(){return this.media.matches||this.forceReduced;}
  private money(value:string){return this.services.walletCoins(Number(value)/100);}
  private get session(){return this.client.sessions.find(s=>s.gameId===WILD_NUDGE_GAME);}
  private get view(){return this.session?.view.wildNudge;}
  private get active(){return this.session?.state==='active';}
  private get wallet(){return this.services.demoWallet.accountId===this.client.accountId?this.services.demoWallet.wallet??this.client.wallet:undefined;}
  private get blocked(){return this.dead||this.paused||this.busy||this.presenting||this.modal.open||this.collection?.open||this.collection?.locksPlay||!this.client.accountId||!this.client.wallet||this.client.busy||this.client.loading||!!this.client.pending||this.services.demoWallet.busy||!!this.services.demoWallet.pending||this.services.demoWallet.hasExternalBusy('expansion');}
  private afford(){return !!this.wallet&&Math.round(this.wallet.balance*100)>=Number(this.stake);}
  private el<T extends HTMLElement=HTMLElement>(name:string){return this.root.querySelector<T>(`[data-gn="${name}"]`)!;}
  constructor(host:HTMLElement){
    try{this.fast=localStorage.getItem('gn-fast')==='1';this.forceReduced=localStorage.getItem('gn-reduced')==='1';}catch{}
    this.root=document.createElement('section');this.root.className='gn';this.root.tabIndex=0;this.root.setAttribute('aria-label',this.title);
    this.root.innerHTML=`<div class="gn-scene" aria-hidden="true"><div class="gn-bg"></div><div class="gn-tint light"></div><div class="gn-tint dark"></div><div class="gn-tint amber"></div><div class="gn-nebula n1"></div><div class="gn-nebula n2"></div><div class="gn-shafts"></div></div><header class="gn-header"><div class="gn-brand">R<span>ROYAL<br>SPACE DIVISION</span></div><div class="gn-title"><h2>${this.title}<i class="gn-sparkle" aria-hidden="true"></i></h2><small>${this.text('ВЫБЕРИ СВОЮ СТОРОНУ','CHOOSE YOUR SIDE')}</small></div><nav class="gn-tools" aria-label="${this.text('Настройки игры','Game settings')}"><button data-gn="crew" class="ss-open" aria-label="${this.text('Героини и выбор стороны','Companions and side selection')}">${ICON.star}</button><button data-gn="sound" aria-label="${this.text('Общий звук','Shared sound')}">${ICON.note}</button><button data-gn="rules" aria-label="${this.text('Правила','Rules')}">${ICON.help}</button><button data-gn="settings" aria-label="${this.text('Настройки','Settings')}">${ICON.gear}</button></nav></header>
    <main class="gn-world"><div class="gn-machine"><div class="gn-machine-label"><span>REACTOR CONTROL</span><b>5 × 3 · 20 ${this.text('ЛИНИЙ','LINES')}</b></div><div class="gn-stage" data-gn="stage"><div class="gn-frame" aria-hidden="true"><i class="gn-halo"></i><i class="gn-ring"></i><i class="gn-conduit l"></i><i class="gn-conduit r"></i><i class="gn-gem tl"></i><i class="gn-gem tr"></i><i class="gn-gem bl"></i><i class="gn-gem br"></i></div><div class="gn-board" data-gn="board" role="group" aria-label="${this.text('Игровое поле','Slot field')}">${Array.from({length:5},(_,i)=>`<div class="gn-reel" data-reel="${i}" role="img"><div class="gn-track"></div><div class="gn-roll" aria-hidden="true">${Array.from({length:12},(_,j)=>`<div class="gn-cell"><img src="${image(j%6)}" alt="" draggable="false"></div>`).join('')}</div><span class="gn-multiplier" hidden></span><i class="gn-streaks" aria-hidden="true"></i><i class="gn-impact" aria-hidden="true"></i><i class="gn-wave" aria-hidden="true"></i></div>`).join('')}<svg class="gn-payline" data-gn="payline" viewBox="0 0 500 300" aria-hidden="true"></svg></div></div><div class="gn-field-caption"><span data-gn="field-note">${this.text('Доводка повышает заряд WILD','Dovetail raises the WILD charge')}</span><span>RTP 96,14%</span></div></div>
    <aside class="gn-telemetry"><div class="ss-companion"><i class="ss-aura" aria-hidden="true"></i><i class="ss-platform" aria-hidden="true"></i><i class="ss-burst" aria-hidden="true"></i><div class="ss-neutral" aria-hidden="true">✦<span>LIGHT / DARK</span></div><img data-ss-portrait hidden alt=""></div><div class="ss-identity"><small data-ss-label></small><strong data-ss-name></strong></div><div class="ss-side-picker"><button data-ss="side:light">${this.text('Свет','Light')}</button><button data-ss="side:dark">${this.text('Тьма','Dark')}</button><button data-ss="open" aria-label="${this.text('Открыть героинь','Open companions')}">✦</button></div><div class="ss-old-telemetry"><small>ENERGY ARRAY</small><h3>${this.text('Пробуждение реактора','Awaken the reactor')}</h3><p>${this.text('Совмести секции. Усиль WILD.','Align the chambers. Power up WILD.')}</p><div class="gn-reactor-bars" data-gn="bars">${Array.from({length:5},(_,i)=>`<span><i data-bar="${i}"></i><b>0${i+1}</b></span>`).join('')}</div><div class="gn-charge"><span>${this.text('ОБЫЧНЫЙ РЕЖИМ','NORMAL MODE')}</span><strong>×1 <i>→</i> ×2 <i>→</i> ×3</strong><span>${this.text('БОНУСНЫЙ РЕЖИМ','BONUS MODE')}</span><strong>×1 <i>→</i> ×3 <i>→</i> ×5</strong></div></div><div class="gn-bonus-meter"><span>${this.text('БЕСПЛАТНЫХ ВРАЩЕНИЙ','FREE SPINS')}</span><strong data-gn="remaining">0</strong><div data-gn="bonus-dots">${Array(8).fill('<i></i>').join('')}</div></div></aside></main>
    <section class="gn-money" data-gn="money" aria-label="${this.text('Баланс и итог раунда','Balance and round result')}"><div><span>${this.text('Баланс','Balance')} · USDT</span><strong data-gn="balance">…</strong><button data-gn="wallet" aria-label="${this.text('Открыть кошелёк','Open wallet')}">+</button></div><div><span>${this.text('Ставка раунда','Round stake')}</span><strong data-gn="cost">1</strong></div><div><span>${this.text('Выплата раунда','Round payout')}</span><strong data-gn="payout">0</strong></div><div><span>${this.text('Чистый итог','Net result')}</span><strong data-gn="net">…</strong></div></section>
    <div class="gn-controls" data-gn="controls"><label class="gn-stake"><span>${this.text('Ставка','Stake')} · USDT</span><select data-gn="stake" aria-label="${this.text('Общая ставка','Total stake')}">${WILD_NUDGE_STAKES.map(stake=>`<option value="${stake}">${this.money(stake)}</option>`).join('')}</select></label><button data-gn="spin" class="gn-spin"><span class="gn-spin-icon" aria-hidden="true">${ICON.spin}</span><b>${this.text('Вращать','Spin')}</b><small>USDT</small></button><button data-gn="lines" class="gn-lines-button">20 ${this.text('линий','lines')}<small>${this.text('Показать маршруты','Show routes')}</small></button></div>
    <div class="gn-playback" data-gn="playback"><label><span>${this.text('Автокрутка','Autoplay')}</span><select data-gn="count" aria-label="${this.text('Число платных раундов','Number of paid rounds')}">${[10,25,50,100].map(n=>`<option>${n}</option>`).join('')}</select></label><button data-gn="auto" aria-pressed="false">${this.text('Авто','Auto')}</button><button data-gn="skip" hidden>${this.text('Показать итог','Show result')}</button><button data-gn="retry" hidden>${this.text('Повторить запрос','Retry request')}</button><button data-gn="refresh" hidden>${this.text('Обновить','Refresh')}</button></div><p class="gn-status" data-gn="status" role="status" aria-live="polite"></p>
    <div class="gn-overlay" aria-hidden="true"><div class="gn-flash" data-gn="flash"></div><div class="gn-sweep" data-gn="sweep"></div></div><dialog class="gn-modal" data-gn="modal" aria-labelledby="gn-modal-title"><header><h3 id="gn-modal-title" data-gn="modal-title"></h3><button data-gn="close" aria-label="${this.text('Закрыть','Close')}">×</button></header><div data-gn="modal-body"></div></dialog>`;
    host.replaceChildren(this.root);this.modal=this.el<HTMLDialogElement>('modal');
    const console=document.createElement('footer');console.className='gn-console';
    for(const name of ['money','controls','status'])console.append(this.el(name));this.root.insertBefore(console,this.modal);
    this.el('controls').append(this.el('auto'),this.el('playback'));
    this.root.querySelector('.gn-machine-label')!.prepend(this.root.querySelector('.gn-bonus-meter')!);
    this.secondaryHome=document.createElement('div');this.secondaryHome.hidden=true;this.root.append(this.secondaryHome);
    this.secondary=document.createElement('div');this.secondary.className='gn-secondary';this.secondaryHome.append(this.secondary);
    this.secondary.append(this.el('count').closest('label')!,this.el('lines'),this.el('sound'),this.el('rules'),this.el('wallet'));
    this.collection=new StarSpinCollection(this.root,()=>this.services.i18n.language,()=>!this.busy&&!this.presenting&&!this.active&&!this.auto&&!this.client.busy&&!this.client.pending&&!this.modal.open,()=>this.render(),()=>{this.stopAuto();this.cancelPresentation();});
    this.character=new StarSpinCharacter(this.root);
    this.root.addEventListener('star-spin-selected',()=>this.character.selected(),{signal:this.lifetime.signal});
    this.root.addEventListener('pointerdown',()=>void this.audio.unlock(),{signal:this.lifetime.signal});
    this.root.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('button[data-gn]');if(button&&!button.disabled)this.click(button.dataset.gn!);},{signal:this.lifetime.signal});
    this.el('stake').addEventListener('change',()=>{if(this.blocked||this.auto||this.active){this.render();return;}this.stake=this.el<HTMLSelectElement>('stake').value;this.error='';this.note='';this.render();},{signal:this.lifetime.signal});
    this.el('count').addEventListener('change',()=>{if(!this.auto)this.autoCount=Number(this.el<HTMLSelectElement>('count').value);},{signal:this.lifetime.signal});
    this.root.addEventListener('keydown',event=>{const target=event.target as HTMLElement;if((this.modal.open||this.collection.open)&&event.key==='Escape')event.stopPropagation();if(event.code==='Space'&&!event.repeat&&!this.modal.open&&target===this.root){event.preventDefault();if(!this.el<HTMLButtonElement>('spin').disabled)void this.perform();}},{signal:this.lifetime.signal});
    this.modal.addEventListener('close',()=>{this.priorFocus?.focus();this.render();},{signal:this.lifetime.signal});
    document.addEventListener('visibilitychange',this.hidden,{signal:this.lifetime.signal});window.addEventListener('blur',this.blurred,{signal:this.lifetime.signal});window.addEventListener('offline',this.blurred,{signal:this.lifetime.signal});
    this.media.addEventListener('change',()=>{this.cancelPresentation();this.sync();},{signal:this.lifetime.signal});
    this.client.addEventListener('change',this.changed);this.services.demoWallet.addEventListener('change',this.changed);
    this.unsubscribe=this.services.gameAudio.onPreferences(()=>{this.el('sound').setAttribute('aria-pressed',String(!this.services.gameAudio.getPreferences().muted));});
    this.layout=new StarSpinLayout(this.root);
    this.fx=new StarSpinFx(this.root,()=>!this.reduced&&!this.paused&&!this.dead&&this.root.isConnected,()=>this.rgb(),()=>this.shown?.stage==='bonus',()=>this.root.dataset.phase==='request'||this.root.dataset.phase==='reveal');
    this.drawPreview();this.sync();
  }
  private click(action:string){
    if(action==='crew')this.collection.show();
    else if(action==='spin')void this.perform();
    else if(action==='auto'){if(this.auto)this.stopAuto();else this.beginAuto();}
    else if(action==='skip')this.cancelPresentation();
    else if(action==='retry')void this.perform(true);
    else if(action==='refresh'){this.stopAuto();void this.client.refresh();}
    else if(action==='sound'){const p=this.services.gameAudio.getPreferences();this.services.gameAudio.setMuted(!p.muted);}
    else if(action==='wallet'){this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));}
    else if(action==='close')this.modal.close();
    else if(action==='rules'||action==='settings'||action==='lines')this.openModal(action);
  }
  private column(column:number,stop:number,multiplier:number){
    const reel=this.root.querySelector<HTMLElement>(`[data-reel="${column}"]`)!,track=reel.querySelector<HTMLElement>('.gn-track')!,strip=R.reels[column],wrap=(n:number)=>(n%strip.length+strip.length)%strip.length;
    const symbols=Array.from({length:5},(_,row)=>strip[wrap(stop+row-1)]);
    let delta=wrap(-stop);if(delta>strip.length/2)delta-=strip.length;
    track.innerHTML=symbols.map((symbol,row)=>`<div class="gn-cell" data-row="${row-1}" data-symbol="${symbol}">${symbol===6?'':`<img src="${image(symbol)}" alt="" draggable="false">`}</div>`).join('')+(delta>=-3&&delta<=4?`<div class="gn-tower" style="top:calc(var(--cell) * ${1+delta})"><img src="${image(6)}" alt="" draggable="false"><i class="gn-orb"></i><i class="gn-orb"></i><i class="gn-orb"></i></div>`:'');
    const badge=reel.querySelector<HTMLElement>('.gn-multiplier')!;badge.hidden=!symbols.slice(1,4).includes(6);badge.textContent='×'+multiplier;
    reel.setAttribute('aria-label',this.text('Барабан ','Reel ')+(column+1)+': '+symbols.slice(1,4).map(s=>this.services.i18n.language==='en'?symbolNamesEn[s]:symbolNames[s]).join(', ')+(badge.hidden?'':' ×'+multiplier));
  }
  private drawFrame(frame:NudgeSpin){for(const [c,reel]of frame.reels.entries())this.column(c,reel.finalStop,reel.multiplier);this.paintLines(frame);}
  private drawPreview(){this.clearWinFx();this.drawFrame(wildNudgeSpin([10,20,30,40,50],'base'));this.el('payline').replaceChildren();this.root.querySelectorAll('.gn-paid').forEach(el=>el.classList.remove('gn-paid'));this.el('field-note').textContent=this.text('20 линий активны','20 active paylines');}
  private paintLines(frame:NudgeSpin){
    this.el('payline').replaceChildren();this.root.querySelectorAll('.gn-paid').forEach(el=>el.classList.remove('gn-paid'));
    const win=[...frame.wins].sort((a,b)=>b.points-a.points)[0];
    if(win)this.paintWin(win);
    this.el('field-note').textContent=frame.wins.length?this.text('Оплачено линий: ','Paid lines: ')+frame.wins.length:this.text('Доводка повышает заряд WILD','Dovetail raises the WILD charge');
    for(const [c,reel]of frame.reels.entries()){const bar=this.root.querySelector<HTMLElement>(`[data-bar="${c}"]`)!;bar.style.height=(reel.after.includes(6)?20+reel.steps*35:8)+'%';}
  }
  private sync(){
    if(this.dead)return;
    if(this.owner!==this.client.accountId){this.owner=this.client.accountId;this.epoch++;this.busy=false;this.presenting=false;this.stopAuto(false);this.cancelPresentation();this.shown=undefined;this.shownKey='';this.error='';this.note='';this.audio.cancel();this.drawPreview();this.root.dataset.phase='idle';}
    if(this.wallet?.balance!==this.lastBalance){this.error='';this.lastBalance=this.wallet?.balance;}
    if(!this.busy&&!this.presenting&&this.view){const key=this.session!.id+':'+this.view.revision;if(key!==this.shownKey){this.markShown(this.view);this.stake=this.session!.rulesVersion===1&&this.view.stage==='settled'?DEFAULT_GAME_STAKE:this.view.stakeUnits;this.drawFrame(this.view.spins.at(-1)!);this.note=this.view.stage==='bonus'?this.text('Бонус восстановлен. Продолжение бесплатно.','Bonus restored. Continue without another stake.'):this.resultText(this.view);}}
    this.collection.sync(this.client.accountId??'');this.render();
  }
  private markShown(view:WildNudgeView){this.shown=structuredClone(view);this.shownKey=this.session!.id+':'+view.revision;this.shownPayout=view.stage==='settled'?this.session!.returnedUnits:view.totalPayoutUnits;if(view.stage==='settled'&&this.session!.rulesVersion===1)this.stake=DEFAULT_GAME_STAKE;}
  private payout(view:WildNudgeView){if(view===this.shown)return this.shownPayout;return view.stage==='settled'&&view.revision===this.view?.revision?this.session!.returnedUnits:view.totalPayoutUnits;}
  private resultText(view:WildNudgeView){const paid=BigInt(this.payout(view)),net=paid-BigInt(view.stakeUnits);return net>0n?this.text('Положительный итог раунда.','Net-positive round.'):net===0n?this.text('Стоимость раунда возвращена.','Round cost returned.'):paid>0n?this.text('Частичный возврат. Выплата меньше ставки.','Partial return. Payout is below the stake.'):this.text('Раунд завершён без выплаты.','Round ended without a payout.');}
  private render(){
    if(this.dead)return;const shown=this.shown,active=this.active,blocked=this.blocked;
    this.collection?.sync(this.client.accountId??'');
    this.character?.sync(this.client.accountId??'',this.root.dataset.character??'',this.collection.open?'idle':this.root.dataset.phase??'idle',this.shown?.stage==='bonus',this.paused||this.modal.open,this.reduced);
    this.el('balance').textContent=this.wallet?this.services.walletCoins(this.wallet.balance):'…';this.el('cost').textContent=this.money(active?this.view!.stakeUnits:this.stake);
    this.el('payout').textContent=this.money(shown?this.payout(shown):'0');this.el('net').textContent=shown?.stage==='settled'?this.money(String(BigInt(this.payout(shown))-BigInt(shown.stakeUnits))):'…';
    this.stake=syncStakeSelect(this.el<HTMLSelectElement>('stake'),this.stake,WILD_NUDGE_STAKES,blocked||this.auto||active);
    const spin=this.el<HTMLButtonElement>('spin');spin.disabled=blocked||this.auto||!active&&!this.afford();spin.querySelector('b')!.textContent=active?this.text('Бесплатно','Free spin'):this.text('Вращать','Spin');spin.querySelector('small')!.textContent=active?this.text('Осталось: ','Remaining: ')+(this.view?.remaining??0):this.money(this.stake)+' USDT';
    const auto=this.el<HTMLButtonElement>('auto');auto.disabled=!this.auto&&(blocked||active||!this.afford()||!!this.client.error||!!this.error);auto.textContent=this.auto?this.text('Стоп · ','Stop · ')+this.autoLeft:this.text('Авто','Auto');auto.setAttribute('aria-pressed',String(this.auto));auto.setAttribute('aria-label',this.auto?this.text('Остановить автокрутку','Stop autoplay'):this.text('Начать автокрутку','Start autoplay'));
    this.el<HTMLSelectElement>('count').disabled=this.auto||this.busy||this.presenting||this.client.busy||!!this.client.pending;this.el<HTMLSelectElement>('count').value=String(this.autoCount);
    this.el('skip').hidden=!this.presenting;this.el('retry').hidden=!canRecoverOperation(this.client);this.el<HTMLButtonElement>('retry').disabled=this.busy||this.client.busy||this.client.loading||this.paused;
    this.el('refresh').hidden=!!this.client.pending||!(this.error||this.client.error);this.el<HTMLButtonElement>('wallet').disabled=!this.client.accountId;
    this.root.classList.toggle('gn-action-overlay',!this.el('skip').hidden||!this.el('retry').hidden||!this.el('refresh').hidden);
    this.el('remaining').textContent=String(shown?.remaining??0);this.el('bonus-dots').querySelectorAll('i').forEach((dot,i)=>dot.classList.toggle('gn-active',i<(shown?.remaining??0)));this.root.classList.toggle('gn-bonus',shown?.stage==='bonus');this.root.classList.toggle('gn-still',this.reduced);
    const remaining=shown?.remaining??0;if(this.lastRemaining!==undefined&&remaining<this.lastRemaining&&!this.reduced&&this.fx){void this.animate(this.el('remaining'),[{transform:'translateY(-100%)',opacity:0},{transform:'translateY(60%)',opacity:0,offset:.4},{transform:'translateY(0)',opacity:1}],this.fast?160:320,this.lifetime.signal);this.audio.schedule('flip');}this.lastRemaining=remaining;
    const side=this.root.dataset.side??'';if(side!==this.lastSide){const was=this.lastSide,swap=(was==='light'||was==='dark')&&(side==='light'||side==='dark');this.lastSide=side;if(swap&&!this.reduced&&!this.paused)this.audio.schedule('side');this.audio.side=side==='dark'?'dark':'light';if(swap&&!this.reduced&&!this.paused&&this.fx){this.sideSweep(side);void this.wait(430,this.lifetime.signal).then(()=>{if(!this.dead)this.audio.igniteSide();});}}
    const status=!this.client.accountId?this.text('Войди в зал, чтобы играть.','Enter the hall to play.'):this.error||this.client.error?this.error||this.client.error:this.client.pending&&!this.busy?this.text('Ответ не подтверждён. Повтори тот же запрос.','Reply not confirmed. Retry the same request.'):this.busy&&!this.presenting?this.text('Реактор запускается. Ожидаем подтверждение.','Starting the reactor. Awaiting confirmation.'):this.auto?this.text('Автокрутка: платных раундов осталось ','Autoplay: paid rounds remaining ')+this.autoLeft:!active&&this.wallet&&!this.afford()?this.text('Недостаточно средств. Уменьши ставку или открой кошелёк.','Insufficient funds. Lower the stake or open the wallet.'):this.note||this.text('Система готова. Запусти реактор.','System ready. Start the reactor.');
    this.el('status').textContent=status;
  }
  private wait(ms:number,signal=this.motion.signal){return new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);this.timers.delete(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,Math.max(0,ms));this.timers.add(timer);signal.addEventListener('abort',done,{once:true});});}
  private async accent(cue:GalacticCue,action:()=>void,signal:AbortSignal,index=0){if(signal.aborted||this.dead)return;const sync=this.audio.schedule(cue,index);await this.wait(sync.delayMs,signal);if(signal.aborted||this.dead)return;action();this.skew.push({cue,mode:sync.mode,skewMs:performance.now()-sync.target});if(this.skew.length>60)this.skew.shift();}
  private async animate(element:Element,frames:Keyframe[],timing:number|KeyframeAnimationOptions,signal:AbortSignal){if(this.reduced||signal.aborted)return;const animation=element.animate(frames,typeof timing==='number'?{duration:timing,easing:'cubic-bezier(.2,.75,.3,1)'}:{easing:'cubic-bezier(.2,.75,.3,1)',...timing});this.animations.add(animation);const cancel=()=>animation.cancel();signal.addEventListener('abort',cancel,{once:true});await animation.finished.catch(()=>{});signal.removeEventListener('abort',cancel);this.animations.delete(animation);}
  private cancelPresentation(){this.character?.cancelReaction();this.motion.abort();for(const animation of this.animations)animation.cancel();this.animations.clear();this.audio.cancel();this.root.querySelectorAll('.gn-spinning,.gn-charging').forEach(el=>el.classList.remove('gn-spinning','gn-charging'));this.fx?.clear();this.root.querySelectorAll('.gn-banner').forEach(b=>b.remove());this.clearCycle();}
  private reelEl(c:number){return this.root.querySelector<HTMLElement>(`[data-reel="${c}"]`)!;}
  private rgb(){return this.shown?.stage==='bonus'?'255,210,122':this.root.dataset.side==='dark'?'243,164,206':'131,237,255';}
  private get cellSize(){return this.el('board').clientWidth/5;}
  private lastFlash=0;
  /** Light flashes are rate limited to fewer than three per second, whatever the speed setting. */
  private flash(strength:number,duration:number,signal:AbortSignal){const now=performance.now();if(now-this.lastFlash<350)return;this.lastFlash=now;void this.animate(this.el('flash'),[{opacity:0},{opacity:strength,offset:.25},{opacity:0}],duration,signal);}
  /** A landed reel: short drop with rebound, a contact glow, sparks, and portals that start turning. */
  private land(c:number,signal:AbortSignal){
    const column=this.reelEl(c);column.querySelectorAll('.gn-cell[data-symbol="7"]').forEach(cell=>{const row=Number((cell as HTMLElement).dataset.row);if(row>=0&&row<=2)cell.classList.add('gn-swirl');});
    if(this.reduced)return;const cell=this.cellSize,track=column.querySelector<HTMLElement>('.gn-track')!;
    void this.animate(track,[{transform:`translateY(${-cell*1.22}px)`},{transform:`translateY(${-cell*.95}px)`,offset:.62},{transform:`translateY(${-cell}px)`}],this.fast?160:300,signal);
    column.querySelectorAll<HTMLElement>('.gn-cell>img').forEach(img=>void this.animate(img,[{transform:'scaleY(1.12)'},{transform:'scale(1.08,.86)',offset:.6},{transform:'scale(1)'}],this.fast?170:320,signal));
    void this.animate(column.querySelector<HTMLElement>('.gn-impact')!,[{opacity:0},{opacity:1,offset:.25},{opacity:0}],this.fast?220:460,signal);
    const p=this.fx.at(column,.5,1);this.fx.ring(p.x,p.y-4,this.rgb(),cell*.55,3);this.fx.sparks(p.x,p.y-4,10,this.rgb(),1.1,1.2);
  }
  /** One recorded dovetail step: lightning into the tower and a wave up the column. */
  private zap(c:number,signal:AbortSignal){
    if(this.reduced)return;const column=this.reelEl(c),top=this.fx.at(column,.5,0),cell=this.cellSize,color=this.shown?.stage==='bonus'||this.view?.stage==='bonus'?GOLD:this.rgb();
    this.fx.bolt(top.x+(Math.random()-.5)*cell*.3,top.y-cell*.35,top.x,top.y+cell*.3,color);this.fx.bolt(top.x-cell*.4,top.y-cell*.25,top.x,top.y+cell*.45,'255,255,255',.7);
    void this.animate(column.querySelector<HTMLElement>('.gn-wave')!,[{top:'100%',opacity:0},{opacity:1,offset:.25},{top:'-60%',opacity:0}],this.fast?220:420,signal);this.flash(.22,260,signal);
  }
  private badgePop(c:number,signal:AbortSignal){
    const badge=this.reelEl(c).querySelector<HTMLElement>('.gn-multiplier')!;if(badge.hidden||this.reduced)return;
    void this.animate(badge,[{transform:'scale(1)'},{transform:'scale(1.7) rotate(-6deg)'},{transform:'scale(1)'}],this.fast?200:380,signal);
    const p=this.fx.at(badge);this.fx.ring(p.x,p.y,'255,255,255',this.cellSize*.45,3);this.fx.sparks(p.x,p.y,14,this.rgb(),1.3);
  }
  /** Draws one confirmed line as a beam; below-stake returns stay thin, silver and quiet. */
  private paintWin(win:{line:number;count:number}){
    const svg=this.el('payline'),points=R.lines[win.line].slice(0,win.count).map((row,c)=>`${c*100+50},${row*100+50}`).join(' ');
    svg.innerHTML=['glow','mid','core'].map(c=>`<polyline class="${c}" points="${points}"/>`).join('');
    this.root.querySelectorAll('.gn-paid').forEach(el=>el.classList.remove('gn-paid'));this.root.querySelectorAll('.gn-rays').forEach(el=>el.remove());
    for(let c=0;c<win.count;c++){const cell=this.root.querySelector(`[data-reel="${c}"] [data-row="${R.lines[win.line][c]}"]`);cell?.classList.add('gn-paid');const tower=this.root.querySelector<HTMLElement>(`[data-reel="${c}"] .gn-tower`);if(tower&&cell?.getAttribute('data-symbol')==='6')tower.classList.add('gn-paid');}
  }
  private decorate(kind:string){
    const board=this.el('board'),svg=this.el('payline'),positive=kind==='win'||kind==='big'||kind==='inter';
    svg.setAttribute('class','gn-payline'+(kind==='partial'?' muted':kind==='return'?' neutral':''));board.classList.toggle('gn-dim',positive);board.classList.toggle('gn-muted',kind==='partial');
    if(positive&&!this.reduced)this.root.querySelectorAll('.gn-cell.gn-paid:not([data-symbol="6"])').forEach(cell=>{const rays=document.createElement('i');rays.className='gn-rays';cell.prepend(rays);});
  }
  private async beam(win:{line:number;count:number},kind:string,signal:AbortSignal,owned=this.animations){
    this.paintWin(win);this.decorate(kind);if(this.reduced||signal.aborted)return;
    const svg=this.el('payline'),lines=Array.from(svg.querySelectorAll<SVGPolylineElement>('polyline')),duration=this.fast?200:420;
    const drawn=lines.map(line=>{line.setAttribute('pathLength','1');line.style.strokeDasharray='1';const a=line.animate([{strokeDashoffset:1},{strokeDashoffset:0}],{duration,easing:'ease-out',fill:'forwards'});owned.add(a);const cancel=()=>a.cancel();signal.addEventListener('abort',cancel,{once:true});return a.finished.catch(()=>{}).finally(()=>{owned.delete(a);signal.removeEventListener('abort',cancel);});});
    const pts=R.lines[win.line].slice(0,win.count).map((row,c)=>[c*100+50,row*100+50]),scale=this.cellSize/100,origin=this.fx.at(this.el('board'),0,0);
    if(kind!=='partial'){
      const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('r','5');svg.append(dot);
      const segs=pts.slice(1).map((p,i)=>Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1])),total=segs.reduce((a,b)=>a+b,0),t0=performance.now();
      const step=(now:number)=>{if(signal.aborted||this.dead){dot.remove();return;}let d=Math.min(1,(now-t0)/duration)*total,i=0;while(i<segs.length-1&&d>segs[i]){d-=segs[i];i++;}const q=Math.min(1,d/(segs[i]||1)),x=pts[i][0]+(pts[i+1][0]-pts[i][0])*q,y=pts[i][1]+(pts[i+1][1]-pts[i][1])*q;dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));if(now-t0<duration)requestAnimationFrame(step);else dot.remove();};requestAnimationFrame(step);
    }
    if(kind!=='partial'&&kind!=='return')pts.forEach(([x,y],c)=>{const cell=this.root.querySelector<HTMLElement>(`[data-reel="${c}"] [data-row="${R.lines[win.line][c]}"]`),img=cell?.querySelector<HTMLElement>('img')??this.root.querySelector<HTMLElement>(`[data-reel="${c}"] .gn-tower>img`);if(img){const a=img.animate([{transform:'scale(1)'},{transform:'scale(1.32)'},{transform:'scale(1.12)'}],{duration:this.fast?180:340,delay:c*(this.fast?40:85),easing:'ease-out'});owned.add(a);a.finished.catch(()=>{}).finally(()=>owned.delete(a));signal.addEventListener('abort',()=>a.cancel(),{once:true});}this.fx.sparks(origin.x+x*scale,origin.y+y*scale,kind==='inter'?4:9,GOLD,1,.6);});
    await Promise.all(drawn);
  }
  private clearCycle(){if(this.cycle)clearInterval(this.cycle);this.cycle=undefined;for(const a of this.cycleAnimations)a.cancel();this.cycleAnimations.clear();this.cycleAbort.abort();this.cycleAbort=new AbortController();}
  /** Several paid lines take turns after the presentation; nothing here changes the shown amounts. */
  private startCycle(frame:NudgeSpin,kind:string){
    this.clearCycle();const wins=[...frame.wins].sort((a,b)=>b.points-a.points);if(wins.length<2||this.reduced)return;let i=0;const signal=this.cycleAbort.signal;
    this.cycle=setInterval(()=>{if(this.dead||this.busy||this.presenting||this.paused){this.clearCycle();return;}i=(i+1)%wins.length;void this.beam(wins[i],kind,signal,this.cycleAnimations);},this.fast?1100:1700);
  }
  private clearWinFx(){this.clearCycle();this.el('board').classList.remove('gn-dim','gn-muted');this.el('payline').setAttribute('class','gn-payline');this.root.querySelectorAll('.gn-rays,.gn-banner').forEach(el=>el.remove());}
  private banner(title:string,sub:string,{sum=false,big=false,segs=0,plain=false}={},signal:AbortSignal){
    const b=document.createElement('div');b.className='gn-banner'+(big?' big':'')+(plain?' plain':'');b.setAttribute('aria-hidden','true');
    b.innerHTML=`<i class="rays"></i><span class="t">${escape(title)}</span>${sum?'<span class="sum">0</span>':''}<span class="s">${escape(sub)}</span>${segs?`<span class="segs">${'<i></i>'.repeat(segs)}</span>`:''}`;
    this.el('stage').append(b);void this.animate(b,[{opacity:0,scale:.3},{opacity:1,scale:1.12,offset:.6},{opacity:1,scale:1}],{duration:this.fast?240:480,easing:'cubic-bezier(.2,1.4,.4,1)'},signal);
    signal.addEventListener('abort',()=>b.remove(),{once:true});return b;
  }
  private async drop(b:HTMLElement,signal:AbortSignal){await this.animate(b,[{opacity:1,scale:1,filter:'blur(0)'},{opacity:0,scale:1.15,filter:'blur(6px)'}],this.fast?160:320,signal);b.remove();}
  /** Counts up to the confirmed amount; skipping shows the exact amount at once. */
  private countUp(el:HTMLElement,units:bigint,duration:number,signal:AbortSignal){
    const target=Number(units),show=(v:number)=>{el.textContent=this.services.walletCoins(v/100);};
    if(this.reduced||signal.aborted){show(target);return Promise.resolve();}
    return new Promise<void>(resolve=>{const t0=performance.now(),D=this.fast?duration*.45:duration;const step=(now:number)=>{if(signal.aborted||this.dead){show(target);resolve();return;}const t=Math.min(1,(now-t0)/D),e=1-Math.pow(1-t,3);show(t<1?Math.round(target*e):target);if(t<1)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
  }
  private burst(big:boolean,signal:AbortSignal){if(this.reduced)return;void this.animate(this.root.querySelector<HTMLElement>('.ss-burst')!,[{opacity:0,transform:'scale(.5)'},{opacity:.95,transform:'scale(1)',offset:.25},{opacity:0,transform:'scale(1.35)'}],big?1400:1000,signal);const feet=this.fx.at(this.root.querySelector('.ss-companion')!,.5,.97);this.fx.ring(feet.x,feet.y,this.rgb(),big?220:160,3);}
  private times(total:bigint,stake:bigint){const x=Math.round(Number(total*10n/stake))/10,n=Math.floor(x),plural=x!==n||(n%10>=2&&n%10<=4&&(n%100<12||n%100>14));return this.text(`В ${String(x).replace('.',',')} ${plural?'РАЗА':'РАЗ'} БОЛЬШЕ СТАВКИ`,`${x}× THE STAKE`);}
  private async winBanner(total:bigint,stake:bigint,signal:AbortSignal){
    let b:HTMLElement|undefined;await this.accent('win',()=>{this.character.react('round_win');if(this.reduced)return;b=this.banner(this.text('ВЫИГРЫШ','WIN'),this.times(total,stake),{sum:true},signal);this.burst(false,signal);const c=this.fx.at(this.el('board'));this.fx.fountain(c.x,c.y+this.cellSize*.3,26);},signal);
    if(!b)return;await this.countUp(b.querySelector('.sum')!,total,900,signal);await this.wait(this.fast?250:800,signal);await this.drop(b,signal);
  }
  private async bigWin(total:bigint,stake:bigint,signal:AbortSignal){
    const c=this.fx.at(this.el('board'));
    await this.accent('big',()=>{this.character.react('round_win');if(this.reduced)return;this.flash(1,520,signal);this.fx.warp(c.x,c.y,this.fast?1000:2300,12);void this.animate(this.root.querySelector<HTMLElement>('.gn-bg')!,[{scale:'1'},{scale:'1.16',offset:.4},{scale:'1'}],{duration:this.fast?1200:2600,easing:'ease-in-out'},signal);},signal);
    if(this.reduced)return;await this.wait(this.fast?400:900,signal);if(signal.aborted)return;
    const b=this.banner(this.text('КРУПНЫЙ ИТОГ','BIG RESULT'),this.times(total,stake),{sum:true,big:true},signal);this.burst(true,signal);
    const rain=setInterval(()=>{if(signal.aborted){clearInterval(rain);return;}this.fx.fountain(c.x+(Math.random()-.5)*this.cellSize*2.4,c.y+this.cellSize*.4,6);},this.fast?160:120);signal.addEventListener('abort',()=>clearInterval(rain),{once:true});
    await this.countUp(b.querySelector('.sum')!,total,1800,signal);clearInterval(rain);this.fx.ring(c.x,c.y,GOLD,this.cellSize*3,5);await this.wait(this.fast?400:1300,signal);await this.drop(b,signal);
  }
  private async bonusEntry(frame:NudgeSpin,signal:AbortSignal){
    const portals=Array.from(this.root.querySelectorAll<HTMLElement>('.gn-cell[data-symbol="7"]')).filter(cell=>{const row=Number(cell.dataset.row);return row>=0&&row<=2;});
    if(!this.reduced&&portals.length){
      const c=this.fx.at(this.el('board'));this.el('board').classList.add('gn-dim');portals.forEach(cell=>cell.classList.add('gn-paid'));
      await this.accent('vortex',()=>{portals.forEach(cell=>{const img=cell.querySelector<HTMLElement>('img');if(img)void this.animate(img,[{transform:'scale(1)'},{transform:'scale(1.4)'},{transform:'scale(1.12)'}],this.fast?350:700,signal);});},signal);
      for(let k=0;k<5&&!signal.aborted;k++){portals.forEach(cell=>{const p=this.fx.at(cell);this.fx.bolt(p.x,p.y,c.x,c.y,GOLD,.8);});await this.wait(this.fast?60:140,signal);}
      this.fx.vortex(c.x,c.y,this.cellSize*2.2);await this.wait(this.fast?300:700,signal);if(signal.aborted)return;
      this.flash(.95,500,signal);this.fx.ring(c.x,c.y,GOLD,this.cellSize*3.4,5);this.fx.ring(c.x,c.y,'255,255,255',this.cellSize*2.4,3);
      this.el('board').classList.remove('gn-dim');portals.forEach(cell=>cell.classList.remove('gn-paid'));
    }
    let b:HTMLElement|undefined;
    await this.accent('bonus',()=>{this.character.react('bonus_enter');if(this.reduced)return;b=this.banner(this.text('ПЕРЕГРУЗКА РЕАКТОРА','REACTOR OVERDRIVE'),`${frame.awardedSpins} ${this.text('БЕСПЛАТНЫХ ВРАЩЕНИЙ','FREE SPINS')}`,{segs:frame.awardedSpins},signal);this.burst(false,signal);},signal);
    if(!b)return;await this.wait(this.fast?150:420,signal);
    const segs=Array.from(b.querySelectorAll('.segs i'));for(let i=0;i<segs.length&&!signal.aborted;i++){segs[i].classList.add('on');this.audio.schedule('segment',i);const p=this.fx.at(segs[i]);this.fx.sparks(p.x,p.y,5,GOLD,.8);await this.wait(this.fast?40:90,signal);}
    await this.wait(this.fast?250:900,signal);await this.drop(b,signal);
  }
  private async bonusEnd(total:bigint,stake:bigint,signal:AbortSignal){
    const positive=total>stake,big=total>=stake*20n,c=this.fx.at(this.el('board'));let b:HTMLElement|undefined;
    await this.accent(big?'big':positive?'finale':total===stake?'return':'partial',()=>{if(positive)this.character.react('round_win');if(this.reduced)return;if(big){this.flash(1,520,signal);this.fx.warp(c.x,c.y,this.fast?900:1800);}b=this.banner(this.text('ПЕРЕГРУЗКА ЗАВЕРШЕНА','OVERDRIVE COMPLETE'),this.text('ВЫПЛАТА ЗА ВЕСЬ РАУНД, USDT','PAID FOR THE WHOLE ROUND, USDT'),{sum:true,plain:!positive},signal);if(positive){this.burst(big,signal);this.fx.fountain(c.x,c.y+this.cellSize*.3,36);}},signal);
    if(!b)return;await this.countUp(b.querySelector('.sum')!,total,1200,signal);await this.wait(this.fast?300:1200,signal);await this.drop(b,signal);
  }
  private sideSweep(side:string){
    if(this.reduced||this.paused)return;const sweep=this.el('sweep');sweep.style.setProperty('--sweep',side==='dark'?'#f3a4ce':'#83edff');
    void this.animate(sweep,[{transform:'translateX(-100%)',opacity:1},{transform:'translateX(190%)',opacity:1}],{duration:850,easing:'ease-in-out'},this.lifetime.signal);
    void this.animate(this.root.querySelector<HTMLElement>('.ss-burst')!,[{opacity:0,transform:'scale(.5)'},{opacity:.8,transform:'scale(1)',offset:.3},{opacity:0,transform:'scale(1.3)'}],900,this.lifetime.signal);
  }
  private async show(view:WildNudgeView){
    this.motion.abort();this.motion=new AbortController();const signal=this.motion.signal,frame=view.spins.at(-1)!,epoch=this.epoch,owner=this.owner;this.presenting=true;this.root.dataset.phase='reveal';this.clearWinFx();this.el('payline').replaceChildren();this.render();
    for(let c=0;c<5&&!signal.aborted;c++){
      const reel=frame.reels[c],column=this.reelEl(c);
      await this.accent('stop',()=>{column.classList.remove('gn-spinning');this.column(c,reel.stop,1);this.land(c,signal);},signal,c);
      if(!this.reduced)await this.wait(this.fast?45:150,signal);
    }
    for(let c=0;c<5&&!signal.aborted;c++){
      const reel=frame.reels[c],column=this.reelEl(c);
      for(let i=1;i<reel.path.length&&!signal.aborted;i++){
        this.root.dataset.phase='nudge';const track=column.querySelector<HTMLElement>('.gn-track')!,cell=this.cellSize;
        const shifted=-cell-reel.direction*cell;
        await this.accent('nudge',()=>{column.classList.add('gn-charging');this.character.react('wild_align');this.zap(c,signal);},signal);
        await this.animate(track,[{transform:`translateY(${-cell}px)`},{transform:`translateY(${shifted}px)`}],this.fast?90:230,signal);
        if(signal.aborted)break;
        this.column(c,reel.path[i].stop,reel.path[i].multiplier);column.classList.remove('gn-charging');this.badgePop(c,signal);
        if(!this.reduced)await this.wait(this.fast?40:120,signal);
      }
    }
    if(this.dead||epoch!==this.epoch||owner!==this.client.accountId)return;
    this.root.querySelectorAll('.gn-spinning').forEach(el=>el.classList.remove('gn-spinning'));this.drawFrame(frame);this.markShown(view);this.note=view.stage==='bonus'?this.text('Режим перегрузки. Продолжение бесплатно.','Overdrive mode. Continue without another stake.'):this.resultText(view);this.root.dataset.phase=view.stage==='bonus'?'bonus':'result';this.render();
    if(!signal.aborted&&!this.paused&&!this.modal.open&&!this.collection.open){
      const stake=BigInt(view.stakeUnits),total=BigInt(this.payout(view)),best=[...frame.wins].sort((a,b)=>b.points-a.points)[0];
      if(frame.awardedSpins)await this.bonusEntry(frame,signal);
      else{
        const kind=view.stage==='bonus'?'inter':total>stake?(total>=stake*20n?'big':'win'):total===stake?'return':'partial';
        if(best){if(kind!=='partial'&&kind!=='return')this.audio.schedule('line');await this.beam(best,kind,signal);}
        if(view.stage==='settled'&&!signal.aborted){
          if(view.spins.length>1)await this.bonusEnd(total,stake,signal);
          else if(kind==='big')await this.bigWin(total,stake,signal);
          else if(kind==='win')await this.winBanner(total,stake,signal);
          else this.audio.schedule(kind==='return'?'return':'partial');
          if(total>stake&&!signal.aborted){const payout=this.el('payout');payout.classList.add('gn-glow');void this.wait(1200,this.lifetime.signal).then(()=>payout.classList.remove('gn-glow'));}
        }
        if(!signal.aborted)this.startCycle(frame,kind);
      }
    }
    this.audio.release();
    this.presenting=false;this.render();
  }
  /** Pressing the reactor: a shock ring from the button and a charge that flies to the reels. */
  private launch(){if(this.reduced)return;const spin=this.fx.at(this.el('spin')),board=this.fx.at(this.el('board'),.5,1);this.fx.ring(spin.x,spin.y,this.rgb(),Math.max(60,this.el('spin').clientWidth*.9),4);this.fx.travel(spin.x,spin.y-this.el('spin').clientHeight*.3,board.x,board.y,this.rgb(),.045,60);}
  private async perform(retry=false,automatic=false):Promise<boolean>{
    if(this.dead||this.paused||this.busy||this.modal.open||!this.client.accountId||this.client.busy||this.client.loading||!retry&&this.blocked||!automatic&&this.auto)return false;
    if(!retry&&!this.active&&!this.afford())return false;
    const owner=this.client.accountId,epoch=++this.epoch;this.busy=true;this.error='';this.note='';
    this.root.dataset.phase='request';this.clearWinFx();this.root.querySelectorAll('[data-reel]').forEach(el=>el.classList.add('gn-spinning'));this.el('payline').replaceChildren();this.render();
    try{
      await this.audio.unlock();
      if(this.dead||epoch!==this.epoch||owner!==this.client.accountId||this.paused||this.modal.open||automatic&&!this.auto)return false;
      this.audio.schedule('start');this.launch();
      if(retry)await this.client.retry();else if(this.active)await this.client.act({gameId:WILD_NUDGE_GAME,action:'move',sessionId:this.session!.id,move:'wild-nudge-spin',revision:this.view!.revision});else await this.client.act({gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:this.stake,settings:{wildNudge:{mode:'normal'}}});
      if(this.dead||epoch!==this.epoch||owner!==this.client.accountId)return false;
      const view=this.view;if(!view||this.client.pending)throw Error(this.text('Раунд не подтверждён. Повтори запрос.','Round not confirmed. Retry the request.'));
      if(this.paused||this.modal.open||this.collection.open){this.markShown(view);this.drawFrame(view.spins.at(-1)!);this.note=view.stage==='bonus'?this.text('Бонус сохранён. Продолжение бесплатно.','Bonus saved. Continue without another stake.'):this.resultText(view);}else await this.show(view);
      return true;
    }catch(error){if(!this.dead&&epoch===this.epoch){this.error=error instanceof Error?error.message:String(error);this.stopAuto(false);this.cancelPresentation();}return false;}
    finally{if(!this.dead&&epoch===this.epoch){this.busy=false;this.root.querySelectorAll('.gn-spinning').forEach(el=>el.classList.remove('gn-spinning'));this.sync();}}
  }
  private beginAuto(){if(this.blocked||this.active||!this.afford()||this.error||this.client.error||document.hidden)return;this.auto=true;this.autoLeft=this.autoCount;this.note='';const epoch=++this.autoEpoch;this.render();void this.autoLoop(epoch);}
  private async autoLoop(epoch:number){
    while(this.auto&&!this.dead&&epoch===this.autoEpoch){
      if(this.paused||document.hidden||this.modal.open||this.owner!==this.client.accountId){this.stopAuto();return;}
      if(!this.active&&this.autoLeft===0){this.stopAuto(false);this.note=this.text('Автокрутка завершена.','Autoplay complete.');this.render();return;}
      if(this.blocked||this.error||this.client.error||!this.active&&!this.afford()){this.stopAuto();return;}
      const paid=!this.active,accepted=await this.perform(false,true);if(!accepted){this.stopAuto(false);return;}
      if(!this.auto||epoch!==this.autoEpoch)return;if(paid)this.autoLeft--;this.render();await this.wait(this.fast?510:700,this.lifetime.signal);
    }
  }
  private stopAuto(notify=true){const running=this.auto;this.auto=false;this.autoLeft=0;this.autoEpoch++;if(running&&notify){this.note=this.text('Автокрутка остановлена. Принятый ход сохраняется.','Autoplay stopped. Accepted moves are preserved.');this.render();}}
  private openModal(kind:string){
    if(this.collection.open)return;this.stopAuto();this.cancelPresentation();if(!this.modal.open)this.priorFocus=document.activeElement as HTMLElement;this.secondaryHome.append(this.secondary);this.el('modal-title').textContent=kind==='settings'?this.text('Настройки','Settings'):kind==='lines'?this.text('20 активных линий','20 active paylines'):this.text('Правила Star Spin','Star Spin rules');
    const body=this.el('modal-body');
    if(kind==='settings'){
      body.innerHTML=`<label>${this.text('Музыка','Music')}<input type="checkbox" data-setting="music" ${this.audio.music?'checked':''}></label><label>${this.text('Звуковые эффекты','Sound effects')}<input type="checkbox" data-setting="effects" ${this.audio.effects?'checked':''}></label><label>${this.text('Общая громкость','Shared volume')}<input type="range" min="0" max="1" step="0.05" data-setting="volume" value="${this.services.gameAudio.getPreferences().volume}"></label><label>${this.text('Быстрый режим','Quick play')}<input type="checkbox" data-setting="fast" ${this.fast?'checked':''}></label><label>${this.text('Уменьшенное движение','Reduced motion')}<input type="checkbox" data-setting="reduced" ${this.forceReduced?'checked':''}></label>`;
      body.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.addEventListener('change',()=>{const name=input.dataset.setting;if(name==='music')this.audio.setMusic(input.checked);else if(name==='effects')this.audio.setEffects(input.checked);else if(name==='volume')this.services.gameAudio.setVolume(Number(input.value));else if(name==='fast'){this.fast=input.checked;try{localStorage.setItem('gn-fast',this.fast?'1':'0');}catch{}}else if(name==='reduced'){this.forceReduced=input.checked;try{localStorage.setItem('gn-reduced',this.forceReduced?'1':'0');}catch{}}}));
      body.prepend(this.secondary);
    }else{
      body.innerHTML=`<p>${this.text('Поле 5×3. Все 20 линий участвуют в каждом спине. Три или больше совпадений оплачиваются слева направо.','A 5×3 field with 20 fixed paylines. Three or more matches pay from left to right.')}</p><p>${this.text('Неполный WILD доводится на один или два шага: ×1 → ×2 → ×3. Прибавки нескольких WILD складываются, например ×2 и ×3 дают множитель линии ×4.','A partial WILD moves one or two steps: ×1 → ×2 → ×3. WILD increments add: ×2 and ×3 produce a ×4 line multiplier.')}</p><p>${this.text('Три, четыре или пять SCATTER дают 8 бесплатных вращений. В бонусе WILD усиливается до ×3 или ×5. Продлений и платных покупок нет.','Three, four or five SCATTER reels award 8 free spins. Bonus WILDs grow to ×3 or ×5, without retriggers or paid purchases.')}</p><p>${this.text('RTP полного раунда 96,1372%. Максимум 8607,9 ставки. Выплата меньше стоимости раунда является частичным возвратом.','Full-round RTP is 96.1372%, maximum 8607.9 stakes. A payout below round cost is a partial return.')}</p><p>${this.text('Автокрутка считает только платные старты; бонусы входят в тот же раунд. «Стоп» отменяет следующие ставки. Ошибка, пауза, уход со страницы или закрытие останавливают авто без самостоятельного возобновления. Неизвестный ответ проверяется повтором того же запроса.','Autoplay counts paid starts only and completes their free bonuses. Stop cancels future wagers. Errors, pause, leaving or closing stop autoplay without automatic resumption. An unknown reply is recovered by retrying the same request.')}</p><div class="gn-paytable">${R.paytable.map((p,i)=>`<div><img src="${image(i)}" alt="${escape(this.services.i18n.language==='en'?symbolNamesEn[i]:symbolNames[i])}"><span>3 · ${p[0]/5}×<br>4 · ${p[1]/5}×<br>5 · ${p[2]/5}×</span></div>`).join('')}</div><p>${this.text('Коэффициенты таблицы применяются к ставке на линию, равной 1/20 общей ставки.','Paytable multipliers apply to the line stake, one twentieth of the total stake.')}</p><div class="gn-line-list">${R.lines.map((line,i)=>`<span>${i+1}: ${line.map(row=>row+1).join(' · ')}</span>`).join('')}</div>`;
    }
    this.modal.showModal();this.render();
  }
  pause(){if(this.dead)return;this.paused=true;this.stopAuto();this.cancelPresentation();this.audio.pause();this.render();}
  resume(){if(this.dead||document.hidden)return;this.paused=false;this.audio.resume();this.sync();}
  getState(){return {effects:this.fx?.active??0,character:this.character.state,collection:this.collection.state,gameId:WILD_NUDGE_GAME,title:this.title,phase:this.root.dataset.phase,revision:this.view?.revision,remaining:this.view?.remaining,busy:this.busy,presenting:this.presenting,autoplay:{running:this.auto,remaining:this.autoLeft,count:this.autoCount},ownedTimers:this.timers.size,animations:this.animations.size,audio:this.audio.getState(),synchronization:this.skew.slice(),shownRevision:this.shown?.revision};}
  destroy(){if(this.dead)return;this.dead=true;this.stopAuto(false);this.epoch++;this.cancelPresentation();this.lifetime.abort();this.layout.destroy();this.client.removeEventListener('change',this.changed);this.services.demoWallet.removeEventListener('change',this.changed);this.unsubscribe();this.collection.destroy();this.character.destroy();this.audio.destroy();this.clearCycle();this.fx.destroy();if(this.modal.open)this.modal.close();this.root.remove();}
}
