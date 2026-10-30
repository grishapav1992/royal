import {readGameHost} from '../../src/modules/GameHostContract';
import {WILD_NUDGE_GAME,type WildNudgeView} from '../../src/shared/wildNudge';
import {WILD_NUDGE_DATA as R,WILD_NUDGE_STAKES,wildNudgeSpin,type NudgeSpin} from '../../src/shared/wildNudgeMath';
import {GalacticAudio,type GalacticCue} from './GalacticAudio';
const image=(symbol:number)=>`/assets/wild-nudge/symbol-${symbol}.webp`;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const symbolNames=['Кристалл','Дроид','Шлем','Истребитель','Энергокапсула','Знак флота','Реактор WILD','Портал SCATTER'];
const symbolNamesEn=['Crystal','Droid','Helmet','Starfighter','Power capsule','Fleet insignia','WILD reactor','SCATTER portal'];
export class GalacticReactorUI {
  private services=readGameHost();private client=this.services.expansionClient;
  private root:HTMLElement;private modal:HTMLDialogElement;private priorFocus?:HTMLElement;
  private lifetime=new AbortController();private motion=new AbortController();private resize:ResizeObserver;
  private audio=new GalacticAudio();private animations=new Set<Animation>();private timers=new Set<ReturnType<typeof setTimeout>>();
  private media=window.matchMedia('(prefers-reduced-motion: reduce)');
  private owner=this.client.accountId;private epoch=0;private dead=false;private paused=false;private busy=false;private presenting=false;
  private shown?:WildNudgeView;private shownKey='';private note='';private error='';private stake='100';private fast=false;private forceReduced=false;
  private auto=false;private autoLeft=0;private autoCount=10;private autoEpoch=0;private lastBalance?:number;
  private skew:{cue:string;mode:string;skewMs:number}[]=[];private unsubscribe:()=>void;
  private changed=()=>this.sync();
  private hidden=()=>{if(document.hidden)this.pause();else this.resume();};
  private blurred=()=>{this.stopAuto();};
  get title(){return this.text('Галактический реактор','Galactic Reactor');}
  private text(ru:string,en:string){return this.services.i18n.language==='en'?en:ru;}
  private get reduced(){return this.media.matches||this.forceReduced;}
  private money(value:string){return this.services.walletCoins(Number(value)/100);}
  private get session(){return this.client.sessions.find(s=>s.gameId===WILD_NUDGE_GAME);}
  private get view(){return this.session?.view.wildNudge;}
  private get active(){return this.session?.state==='active';}
  private get wallet(){return this.services.demoWallet.accountId===this.client.accountId?this.services.demoWallet.wallet??this.client.wallet:undefined;}
  private get blocked(){return this.dead||this.paused||this.busy||this.presenting||this.modal.open||!this.client.accountId||!this.client.wallet||this.client.busy||this.client.loading||!!this.client.pending||this.services.demoWallet.busy||!!this.services.demoWallet.pending||this.services.demoWallet.hasExternalBusy('expansion');}
  private afford(){return !!this.wallet&&Math.round(this.wallet.balance*100)>=Number(this.stake);}
  private el<T extends HTMLElement=HTMLElement>(name:string){return this.root.querySelector<T>(`[data-gn="${name}"]`)!;}
  constructor(host:HTMLElement){
    try{this.fast=localStorage.getItem('gn-fast')==='1';this.forceReduced=localStorage.getItem('gn-reduced')==='1';}catch{}
    this.root=document.createElement('section');this.root.className='gn';this.root.tabIndex=0;this.root.setAttribute('aria-label',this.title);
    this.root.innerHTML=`<header class="gn-header"><div class="gn-brand">R<span>ROYAL<br>SPACE DIVISION</span></div><div class="gn-title"><small>${this.text('ОРБИТАЛЬНАЯ СТАНЦИЯ · СЕКТОР 07','ORBITAL STATION · SECTOR 07')}</small><h2>${this.title}</h2></div><nav class="gn-tools" aria-label="${this.text('Настройки игры','Game settings')}"><button data-gn="sound" aria-label="${this.text('Общий звук','Shared sound')}">♪</button><button data-gn="rules" aria-label="${this.text('Правила','Rules')}">?</button><button data-gn="settings" aria-label="${this.text('Настройки','Settings')}">⚙</button></nav></header>
    <main class="gn-world"><div class="gn-machine"><div class="gn-machine-label"><span>REACTOR CONTROL</span><b>5 × 3 · 20 ${this.text('ЛИНИЙ','LINES')}</b></div><div class="gn-stage" data-gn="stage"><div class="gn-board" data-gn="board" role="group" aria-label="${this.text('Игровое поле','Slot field')}">${Array.from({length:5},(_,i)=>`<div class="gn-reel" data-reel="${i}" role="img"><div class="gn-track"></div><div class="gn-roll" aria-hidden="true">${Array.from({length:12},(_,j)=>`<div class="gn-cell"><img src="${image(j%6)}" alt="" draggable="false"></div>`).join('')}</div><span class="gn-multiplier" hidden></span></div>`).join('')}<svg class="gn-payline" data-gn="payline" viewBox="0 0 500 300" aria-hidden="true"></svg><div class="gn-bonus-overlay" data-gn="bonus-overlay" hidden><strong>${this.text('ПЕРЕГРУЗКА РЕАКТОРА','REACTOR OVERDRIVE')}</strong><span>8 ${this.text('БЕСПЛАТНЫХ ВРАЩЕНИЙ','FREE SPINS')}</span></div></div></div><div class="gn-field-caption"><span data-gn="field-note">${this.text('Доводка повышает заряд WILD','Dovetail raises the WILD charge')}</span><span>RTP 96,14%</span></div></div>
    <aside class="gn-telemetry"><div class="gn-orbit">◉</div><small>ENERGY ARRAY</small><h3>${this.text('Пробуждение реактора','Awaken the reactor')}</h3><p>${this.text('Совмести секции. Усиль WILD.','Align the chambers. Power up WILD.')}</p><div class="gn-reactor-bars" data-gn="bars">${Array.from({length:5},(_,i)=>`<span><i data-bar="${i}"></i><b>0${i+1}</b></span>`).join('')}</div><div class="gn-charge"><span>${this.text('ОБЫЧНЫЙ РЕЖИМ','NORMAL MODE')}</span><strong>×1 <i>→</i> ×2 <i>→</i> ×3</strong><span>${this.text('БОНУСНЫЙ РЕЖИМ','BONUS MODE')}</span><strong>×1 <i>→</i> ×3 <i>→</i> ×5</strong></div><div class="gn-bonus-meter"><span>${this.text('БЕСПЛАТНЫХ ВРАЩЕНИЙ','FREE SPINS')}</span><strong data-gn="remaining">0</strong><div data-gn="bonus-dots">${Array(8).fill('<i></i>').join('')}</div></div></aside></main>
    <section class="gn-money" data-gn="money" aria-label="${this.text('Баланс и итог раунда','Balance and round result')}"><div><span>${this.text('Баланс','Balance')} · USDT</span><strong data-gn="balance">…</strong><button data-gn="wallet" aria-label="${this.text('Открыть кошелёк','Open wallet')}">+</button></div><div><span>${this.text('Ставка раунда','Round stake')}</span><strong data-gn="cost">1</strong></div><div><span>${this.text('Выплата раунда','Round payout')}</span><strong data-gn="payout">0</strong></div><div><span>${this.text('Чистый итог','Net result')}</span><strong data-gn="net">…</strong></div></section>
    <div class="gn-controls" data-gn="controls"><label class="gn-stake"><span>${this.text('Общая ставка','Total stake')} · USDT</span><select data-gn="stake" aria-label="${this.text('Общая ставка','Total stake')}">${WILD_NUDGE_STAKES.map(stake=>`<option value="${stake}">${this.money(stake)}</option>`).join('')}</select></label><button data-gn="spin" class="gn-spin"><span aria-hidden="true">⟳</span><b>${this.text('Вращать','Spin')}</b><small>USDT</small></button><button data-gn="lines" class="gn-lines-button">20 ${this.text('линий','lines')}<small>${this.text('Показать маршруты','Show routes')}</small></button></div>
    <div class="gn-playback" data-gn="playback"><label><span>${this.text('Автокрутка','Autoplay')}</span><select data-gn="count" aria-label="${this.text('Число платных раундов','Number of paid rounds')}">${[10,25,50,100].map(n=>`<option>${n}</option>`).join('')}</select></label><button data-gn="auto" aria-pressed="false">${this.text('Авто','Auto')}</button><button data-gn="skip" hidden>${this.text('Показать итог','Show result')}</button><button data-gn="retry" hidden>${this.text('Повторить запрос','Retry request')}</button><button data-gn="refresh" hidden>${this.text('Обновить','Refresh')}</button></div><p class="gn-status" data-gn="status" role="status" aria-live="polite"></p>
    <dialog class="gn-modal" data-gn="modal" aria-labelledby="gn-modal-title"><header><h3 id="gn-modal-title" data-gn="modal-title"></h3><button data-gn="close" aria-label="${this.text('Закрыть','Close')}">×</button></header><div data-gn="modal-body"></div></dialog>`;
    host.replaceChildren(this.root);this.modal=this.el<HTMLDialogElement>('modal');
    this.root.addEventListener('pointerdown',()=>void this.audio.unlock(),{signal:this.lifetime.signal});
    this.root.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('button[data-gn]');if(button&&!button.disabled)this.click(button.dataset.gn!);},{signal:this.lifetime.signal});
    this.el('stake').addEventListener('change',()=>{if(this.blocked||this.auto||this.active){this.render();return;}this.stake=this.el<HTMLSelectElement>('stake').value;this.error='';this.note='';this.render();},{signal:this.lifetime.signal});
    this.el('count').addEventListener('change',()=>{if(!this.auto)this.autoCount=Number(this.el<HTMLSelectElement>('count').value);},{signal:this.lifetime.signal});
    this.root.addEventListener('keydown',event=>{const target=event.target as HTMLElement;if(this.modal.open&&event.key==='Escape')event.stopPropagation();if(event.code==='Space'&&!event.repeat&&!this.modal.open&&target===this.root){event.preventDefault();if(!this.el<HTMLButtonElement>('spin').disabled)void this.perform();}},{signal:this.lifetime.signal});
    this.modal.addEventListener('close',()=>{this.priorFocus?.focus();this.render();},{signal:this.lifetime.signal});
    document.addEventListener('visibilitychange',this.hidden,{signal:this.lifetime.signal});window.addEventListener('blur',this.blurred,{signal:this.lifetime.signal});window.addEventListener('offline',this.blurred,{signal:this.lifetime.signal});
    this.media.addEventListener('change',()=>{this.cancelPresentation();this.sync();},{signal:this.lifetime.signal});
    this.client.addEventListener('change',this.changed);this.services.demoWallet.addEventListener('change',this.changed);
    this.unsubscribe=this.services.gameAudio.onPreferences(()=>{this.el('sound').setAttribute('aria-pressed',String(!this.services.gameAudio.getPreferences().muted));});
    this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(this.root);this.resize.observe(this.el('stage'));
    this.drawPreview();this.sync();this.fit();
  }
  private click(action:string){
    if(action==='spin')void this.perform();
    else if(action==='auto'){if(this.auto)this.stopAuto();else this.beginAuto();}
    else if(action==='skip')this.cancelPresentation();
    else if(action==='retry')void this.perform(true);
    else if(action==='refresh'){this.stopAuto();void this.client.refresh();}
    else if(action==='sound'){const p=this.services.gameAudio.getPreferences();this.services.gameAudio.setMuted(!p.muted);}
    else if(action==='wallet'){this.stopAuto();window.dispatchEvent(new Event('royal-open-wallet'));}
    else if(action==='close')this.modal.close();
    else if(action==='rules'||action==='settings'||action==='lines')this.openModal(action);
  }
  private fit(){this.root.classList.toggle('gn-compact',this.root.clientHeight<700);this.root.classList.toggle('gn-short',this.root.clientHeight<350);const margin=this.root.clientHeight<350?8:16,stage=this.el('stage'),width=Math.max(1,Math.floor(Math.min(stage.clientWidth-margin,(stage.clientHeight-margin)*5/3))),board=this.el('board');board.style.width=width+'px';board.style.height=(width*3/5)+'px';board.style.setProperty('--cell',(width/5)+'px');}
  private column(column:number,stop:number,multiplier:number){
    const reel=this.root.querySelector<HTMLElement>(`[data-reel="${column}"]`)!,track=reel.querySelector<HTMLElement>('.gn-track')!,strip=R.reels[column],wrap=(n:number)=>(n%strip.length+strip.length)%strip.length;
    const symbols=Array.from({length:5},(_,row)=>strip[wrap(stop+row-1)]);
    let delta=wrap(-stop);if(delta>strip.length/2)delta-=strip.length;
    track.innerHTML=symbols.map((symbol,row)=>`<div class="gn-cell" data-row="${row-1}" data-symbol="${symbol}">${symbol===6?'':`<img src="${image(symbol)}" alt="" draggable="false">`}</div>`).join('')+(delta>=-3&&delta<=4?`<img class="gn-tower" src="${image(6)}" alt="" draggable="false" style="top:calc(var(--cell) * ${1+delta})">`:'');
    const badge=reel.querySelector<HTMLElement>('.gn-multiplier')!;badge.hidden=!symbols.slice(1,4).includes(6);badge.textContent='×'+multiplier;
    reel.setAttribute('aria-label',this.text('Барабан ','Reel ')+(column+1)+': '+symbols.slice(1,4).map(s=>this.services.i18n.language==='en'?symbolNamesEn[s]:symbolNames[s]).join(', ')+(badge.hidden?'':' ×'+multiplier));
  }
  private drawFrame(frame:NudgeSpin){for(const [c,reel]of frame.reels.entries())this.column(c,reel.finalStop,reel.multiplier);this.paintLines(frame);}
  private drawPreview(){this.drawFrame(wildNudgeSpin([10,20,30,40,50],'base'));this.el('payline').replaceChildren();this.root.querySelectorAll('.gn-paid').forEach(el=>el.classList.remove('gn-paid'));this.el('field-note').textContent=this.text('20 линий активны','20 active paylines');}
  private paintLines(frame:NudgeSpin){
    this.el('payline').replaceChildren();this.root.querySelectorAll('.gn-paid').forEach(el=>el.classList.remove('gn-paid'));
    const win=[...frame.wins].sort((a,b)=>b.points-a.points)[0];
    if(win){const points=R.lines[win.line].slice(0,win.count).map((row,c)=>`${c*100+50},${row*100+50}`).join(' ');this.el('payline').innerHTML=`<polyline points="${points}"/>`;for(let c=0;c<win.count;c++)this.root.querySelector(`[data-reel="${c}"] [data-row="${R.lines[win.line][c]}"]`)?.classList.add('gn-paid');}
    this.el('field-note').textContent=frame.wins.length?this.text('Оплачено линий: ','Paid lines: ')+frame.wins.length:this.text('Доводка повышает заряд WILD','Dovetail raises the WILD charge');
    for(const [c,reel]of frame.reels.entries()){const bar=this.root.querySelector<HTMLElement>(`[data-bar="${c}"]`)!;bar.style.height=(reel.after.includes(6)?20+reel.steps*35:8)+'%';}
  }
  private sync(){
    if(this.dead)return;
    if(this.owner!==this.client.accountId){this.owner=this.client.accountId;this.epoch++;this.busy=false;this.presenting=false;this.stopAuto(false);this.cancelPresentation();this.shown=undefined;this.shownKey='';this.error='';this.note='';this.audio.cancel();this.drawPreview();this.root.dataset.phase='idle';}
    if(this.wallet?.balance!==this.lastBalance){this.error='';this.lastBalance=this.wallet?.balance;}
    if(!this.busy&&!this.presenting&&this.view){const key=this.session!.id+':'+this.view.revision;if(key!==this.shownKey){this.shown=structuredClone(this.view);this.shownKey=key;this.stake=this.view.stakeUnits;this.drawFrame(this.view.spins.at(-1)!);this.note=this.view.stage==='bonus'?this.text('Бонус восстановлен. Продолжение бесплатно.','Bonus restored. Continue without another stake.'):this.resultText(this.view);}}
    this.render();
  }
  private resultText(view:WildNudgeView){const net=BigInt(view.totalPayoutUnits)-BigInt(view.stakeUnits);return net>0n?this.text('Положительный итог раунда.','Net-positive round.'):net===0n?this.text('Стоимость раунда возвращена.','Round cost returned.'):BigInt(view.totalPayoutUnits)>0n?this.text('Частичный возврат. Выплата меньше ставки.','Partial return. Payout is below the stake.'):this.text('Раунд завершён без выплаты.','Round ended without a payout.');}
  private render(){
    if(this.dead)return;const shown=this.shown,active=this.active,blocked=this.blocked;
    this.el('balance').textContent=this.wallet?this.services.walletCoins(this.wallet.balance):'…';this.el('cost').textContent=this.money(active?this.view!.stakeUnits:this.stake);
    this.el('payout').textContent=this.money(shown?.totalPayoutUnits??'0');this.el('net').textContent=shown?.stage==='settled'?this.money(String(BigInt(shown.totalPayoutUnits)-BigInt(shown.stakeUnits))):'…';
    this.el<HTMLSelectElement>('stake').value=this.stake;this.el<HTMLSelectElement>('stake').disabled=blocked||this.auto||active;
    const spin=this.el<HTMLButtonElement>('spin');spin.disabled=blocked||this.auto||!active&&!this.afford();spin.querySelector('b')!.textContent=active?this.text('Бесплатно','Free spin'):this.text('Вращать','Spin');spin.querySelector('small')!.textContent=active?this.text('Осталось: ','Remaining: ')+(this.view?.remaining??0):this.money(this.stake)+' USDT';
    const auto=this.el<HTMLButtonElement>('auto');auto.disabled=!this.auto&&(blocked||active||!this.afford()||!!this.client.error||!!this.error);auto.textContent=this.auto?this.text('Стоп · ','Stop · ')+this.autoLeft:this.text('Авто','Auto');auto.setAttribute('aria-pressed',String(this.auto));auto.setAttribute('aria-label',this.auto?this.text('Остановить автокрутку','Stop autoplay'):this.text('Начать автокрутку','Start autoplay'));
    this.el<HTMLSelectElement>('count').disabled=blocked||this.auto;this.el<HTMLSelectElement>('count').value=String(this.autoCount);
    this.el('skip').hidden=!this.presenting;this.el('retry').hidden=!this.client.pending;this.el<HTMLButtonElement>('retry').disabled=this.busy||this.client.busy||this.client.loading||this.paused;
    this.el('refresh').hidden=!!this.client.pending||!(this.error||this.client.error);this.el<HTMLButtonElement>('wallet').disabled=!this.client.accountId;
    this.el('remaining').textContent=String(shown?.remaining??0);this.el('bonus-dots').querySelectorAll('i').forEach((dot,i)=>dot.classList.toggle('gn-active',i<(shown?.remaining??0)));this.root.classList.toggle('gn-bonus',shown?.stage==='bonus');
    const status=!this.client.accountId?this.text('Войди в зал, чтобы играть.','Enter the hall to play.'):this.error||this.client.error?this.error||this.client.error:this.client.pending&&!this.busy?this.text('Ответ не подтверждён. Повтори тот же запрос.','Reply not confirmed. Retry the same request.'):this.busy&&!this.presenting?this.text('Реактор запускается. Ожидаем подтверждение.','Starting the reactor. Awaiting confirmation.'):this.auto?this.text('Автокрутка: платных раундов осталось ','Autoplay: paid rounds remaining ')+this.autoLeft:!active&&this.wallet&&!this.afford()?this.text('Недостаточно средств. Уменьши ставку или открой кошелёк.','Insufficient funds. Lower the stake or open the wallet.'):this.note||this.text('Система готова. Запусти реактор.','System ready. Start the reactor.');
    this.el('status').textContent=status;
  }
  private wait(ms:number,signal=this.motion.signal){return new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);this.timers.delete(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,Math.max(0,ms));this.timers.add(timer);signal.addEventListener('abort',done,{once:true});});}
  private async accent(cue:GalacticCue,action:()=>void,signal:AbortSignal){if(signal.aborted||this.dead)return;const sync=this.audio.schedule(cue);await this.wait(sync.delayMs,signal);if(signal.aborted||this.dead)return;action();this.skew.push({cue,mode:sync.mode,skewMs:performance.now()-sync.target});if(this.skew.length>60)this.skew.shift();}
  private async animate(element:HTMLElement,frames:Keyframe[],duration:number,signal:AbortSignal){if(this.reduced||signal.aborted)return;const animation=element.animate(frames,{duration,easing:'cubic-bezier(.2,.75,.3,1)'});this.animations.add(animation);const cancel=()=>animation.cancel();signal.addEventListener('abort',cancel,{once:true});await animation.finished.catch(()=>{});signal.removeEventListener('abort',cancel);this.animations.delete(animation);}
  private cancelPresentation(){this.motion.abort();for(const animation of this.animations)animation.cancel();this.animations.clear();this.audio.cancel();this.root.querySelectorAll('.gn-spinning,.gn-charging').forEach(el=>el.classList.remove('gn-spinning','gn-charging'));}
  private async show(view:WildNudgeView){
    this.motion.abort();this.motion=new AbortController();const signal=this.motion.signal,frame=view.spins.at(-1)!,epoch=this.epoch,owner=this.owner;this.presenting=true;this.root.dataset.phase='reveal';this.el('payline').replaceChildren();this.render();
    for(let c=0;c<5&&!signal.aborted;c++){
      const reel=frame.reels[c],column=this.root.querySelector<HTMLElement>(`[data-reel="${c}"]`)!;
      await this.accent('stop',()=>{column.classList.remove('gn-spinning');this.column(c,reel.stop,1);},signal);
      if(!this.reduced){await this.animate(column,[{filter:'brightness(1.3)'},{filter:'brightness(1)'}],this.fast?60:130,signal);await this.wait(this.fast?15:35,signal);}
    }
    for(let c=0;c<5&&!signal.aborted;c++){
      const reel=frame.reels[c],column=this.root.querySelector<HTMLElement>(`[data-reel="${c}"]`)!;
      for(let i=1;i<reel.path.length&&!signal.aborted;i++){
        this.root.dataset.phase='nudge';const track=column.querySelector<HTMLElement>('.gn-track')!,cell=this.el('board').clientWidth/5;
        const shifted=-cell-reel.direction*cell;
        await this.accent('nudge',()=>column.classList.add('gn-charging'),signal);
        await this.animate(track,[{transform:`translateY(${-cell}px)`},{transform:`translateY(${shifted}px)`}],this.fast?90:230,signal);
        if(signal.aborted)break;
        this.column(c,reel.path[i].stop,reel.path[i].multiplier);column.classList.remove('gn-charging');
      }
    }
    if(this.dead||epoch!==this.epoch||owner!==this.client.accountId)return;
    if(!this.dead){this.root.querySelectorAll('.gn-spinning').forEach(el=>el.classList.remove('gn-spinning'));this.drawFrame(frame);this.shown=structuredClone(view);this.shownKey=this.session!.id+':'+view.revision;this.note=view.stage==='bonus'?this.text('Режим перегрузки. Продолжение бесплатно.','Overdrive mode. Continue without another stake.'):this.resultText(view);this.root.dataset.phase=view.stage==='bonus'?'bonus':'result';
      if(!signal.aborted&&!this.paused&&!this.modal.open){
        if(frame.awardedSpins){await this.accent('bonus',()=>{this.el('bonus-overlay').hidden=false;},signal);await this.wait(this.reduced?0:this.fast?180:650,signal);}
        else if(view.stage==='settled'){const total=BigInt(view.totalPayoutUnits),stake=BigInt(view.stakeUnits);this.audio.schedule(total>stake?'win':total===stake?'return':'partial');}
      }
      this.el('bonus-overlay').hidden=true;
    }
    this.presenting=false;this.render();
  }
  private async perform(retry=false,automatic=false):Promise<boolean>{
    if(this.dead||this.paused||this.busy||this.modal.open||!this.client.accountId||this.client.busy||this.client.loading||!retry&&this.blocked||!automatic&&this.auto)return false;
    if(!retry&&!this.active&&!this.afford())return false;
    const owner=this.client.accountId,epoch=++this.epoch;this.busy=true;this.error='';this.note='';
    this.root.dataset.phase='request';this.root.querySelectorAll('[data-reel]').forEach(el=>el.classList.add('gn-spinning'));this.el('payline').replaceChildren();this.render();
    try{
      await this.audio.unlock();
      if(this.dead||epoch!==this.epoch||owner!==this.client.accountId||this.paused||this.modal.open||automatic&&!this.auto)return false;
      this.audio.schedule('start');
      if(retry)await this.client.retry();else if(this.active)await this.client.act({gameId:WILD_NUDGE_GAME,action:'move',sessionId:this.session!.id,move:'wild-nudge-spin',revision:this.view!.revision});else await this.client.act({gameId:WILD_NUDGE_GAME,action:'start',stakeUnits:this.stake,settings:{wildNudge:{mode:'normal'}}});
      if(this.dead||epoch!==this.epoch||owner!==this.client.accountId)return false;
      const view=this.view;if(!view||this.client.pending)throw Error(this.text('Раунд не подтверждён. Повтори запрос.','Round not confirmed. Retry the request.'));
      if(this.paused||this.modal.open){this.shown=structuredClone(view);this.shownKey=this.session!.id+':'+view.revision;this.drawFrame(view.spins.at(-1)!);this.note=view.stage==='bonus'?this.text('Бонус сохранён. Продолжение бесплатно.','Bonus saved. Continue without another stake.'):this.resultText(view);}else await this.show(view);
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
    this.stopAuto();this.cancelPresentation();this.priorFocus=document.activeElement as HTMLElement;this.el('modal-title').textContent=kind==='settings'?this.text('Настройки','Settings'):kind==='lines'?this.text('20 активных линий','20 active paylines'):this.text('Правила реактора','Reactor rules');
    const body=this.el('modal-body');
    if(kind==='settings'){
      body.innerHTML=`<label>${this.text('Музыка','Music')}<input type="checkbox" data-setting="music" ${this.audio.music?'checked':''}></label><label>${this.text('Звуковые эффекты','Sound effects')}<input type="checkbox" data-setting="effects" ${this.audio.effects?'checked':''}></label><label>${this.text('Общая громкость','Shared volume')}<input type="range" min="0" max="1" step="0.05" data-setting="volume" value="${this.services.gameAudio.getPreferences().volume}"></label><label>${this.text('Быстрый режим','Quick play')}<input type="checkbox" data-setting="fast" ${this.fast?'checked':''}></label><label>${this.text('Уменьшенное движение','Reduced motion')}<input type="checkbox" data-setting="reduced" ${this.forceReduced?'checked':''}></label>`;
      body.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.addEventListener('change',()=>{const name=input.dataset.setting;if(name==='music')this.audio.setMusic(input.checked);else if(name==='effects')this.audio.setEffects(input.checked);else if(name==='volume')this.services.gameAudio.setVolume(Number(input.value));else if(name==='fast'){this.fast=input.checked;try{localStorage.setItem('gn-fast',this.fast?'1':'0');}catch{}}else if(name==='reduced'){this.forceReduced=input.checked;try{localStorage.setItem('gn-reduced',this.forceReduced?'1':'0');}catch{}}}));
    }else{
      body.innerHTML=`<p>${this.text('Поле 5×3. Все 20 линий участвуют в каждом спине. Три или больше совпадений оплачиваются слева направо.','A 5×3 field with 20 fixed paylines. Three or more matches pay from left to right.')}</p><p>${this.text('Неполный WILD доводится на один или два шага: ×1 → ×2 → ×3. Прибавки нескольких WILD складываются, например ×2 и ×3 дают множитель линии ×4.','A partial WILD moves one or two steps: ×1 → ×2 → ×3. WILD increments add: ×2 and ×3 produce a ×4 line multiplier.')}</p><p>${this.text('Три, четыре или пять SCATTER дают 8 бесплатных вращений. В бонусе WILD усиливается до ×3 или ×5. Продлений и платных покупок нет.','Three, four or five SCATTER reels award 8 free spins. Bonus WILDs grow to ×3 or ×5, without retriggers or paid purchases.')}</p><p>${this.text('RTP полного раунда 96,1372%. Максимум 8607,9 ставки. Выплата меньше стоимости раунда является частичным возвратом.','Full-round RTP is 96.1372%, maximum 8607.9 stakes. A payout below round cost is a partial return.')}</p><p>${this.text('Автокрутка считает только платные старты; бонусы входят в тот же раунд. «Стоп» отменяет следующие ставки. Ошибка, пауза, уход со страницы или закрытие останавливают авто без самостоятельного возобновления. Неизвестный ответ проверяется повтором того же запроса.','Autoplay counts paid starts only and completes their free bonuses. Stop cancels future wagers. Errors, pause, leaving or closing stop autoplay without automatic resumption. An unknown reply is recovered by retrying the same request.')}</p><div class="gn-paytable">${R.paytable.map((p,i)=>`<div><img src="${image(i)}" alt="${escape(this.services.i18n.language==='en'?symbolNamesEn[i]:symbolNames[i])}"><span>3 · ${p[0]/5}×<br>4 · ${p[1]/5}×<br>5 · ${p[2]/5}×</span></div>`).join('')}</div><p>${this.text('Коэффициенты таблицы применяются к ставке на линию, равной 1/20 общей ставки.','Paytable multipliers apply to the line stake, one twentieth of the total stake.')}</p><div class="gn-line-list">${R.lines.map((line,i)=>`<span>${i+1}: ${line.map(row=>row+1).join(' · ')}</span>`).join('')}</div>`;
    }
    this.modal.showModal();this.render();
  }
  pause(){if(this.dead)return;this.paused=true;this.stopAuto();this.cancelPresentation();this.audio.pause();this.render();}
  resume(){if(this.dead||document.hidden)return;this.paused=false;this.audio.resume();this.sync();}
  getState(){return {gameId:WILD_NUDGE_GAME,title:this.title,phase:this.root.dataset.phase,revision:this.view?.revision,remaining:this.view?.remaining,busy:this.busy,presenting:this.presenting,autoplay:{running:this.auto,remaining:this.autoLeft,count:this.autoCount},ownedTimers:this.timers.size,animations:this.animations.size,audio:this.audio.getState(),synchronization:this.skew.slice(),shownRevision:this.shown?.revision};}
  destroy(){if(this.dead)return;this.dead=true;this.stopAuto(false);this.epoch++;this.cancelPresentation();this.lifetime.abort();this.resize.disconnect();this.client.removeEventListener('change',this.changed);this.services.demoWallet.removeEventListener('change',this.changed);this.unsubscribe();this.audio.destroy();if(this.modal.open)this.modal.close();this.root.remove();}
}
