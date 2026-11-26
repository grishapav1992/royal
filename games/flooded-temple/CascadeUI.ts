import {syncStakeSelect} from '../../src/ui/stakeSelection';
import {stakeRulesHtml} from '../../src/ui/stakeRules';
import {confirmedPayout} from '../../src/shared/roundPrecision';
import {ROYAL_GAME_STAKE_CENTS,validGameStake} from '../../src/shared/gameStakes';
import type {GameHostV1} from '../../src/modules/GameHostContract';
import type {ExpansionSession} from '../../src/shared/casinoExpansion';
import {TEMPLE_GAME} from '../../src/shared/floodedTemple';
import {CASCADE_DATA} from '../../src/shared/floodedTempleCascadeMath';
import {cascadeUnits,type TempleCascadeView} from '../../src/shared/floodedTempleCascade';
import {escape} from './art';
import {TempleAudio,type TempleCue} from './TempleAudio';
import {templeMusic} from './audioCredits';
import {templeOutcome} from './presentation';
import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {Stage} from './ebb/stage';
import {Show,type Cue} from './ebb/show';

const counts=[10,25,50,100];
const names=[['Идол','Idol'],['Солнце','Sun'],['Ягуар','Jaguar'],['Сокол','Falcon'],['Змея','Serpent'],['Луна','Moon'],['Рыба','Fish'],['Компас WILD','WILD compass'],['Реликвия BONUS','BONUS relic']];
const readyGrid=[0,3,6,1,4,5,2,7,6,3,5,1,4,2,0];
const CUES:Record<Cue,TempleCue[]>={lever:['lever'],sink:['cascadeReturn'],land:['cascadeLandA','cascadeLandB','cascadeLandC'],splash:[],crack:['cascadeBreakA','cascadeBreakB'],ebb:['scrape'],hook:['rope'],step:['step'],coin:[],win:['win'],big:['big'],chest:['chest'],bonus:['cascadeBonus'],gate:['stone'],neutral:['neutral'],relic:['relic']};
const compass='<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="m24 7 4 13 13 4-13 4-4 13-4-13-13-4 13-4z"/></svg>';

/** «Ebb» presentation of rules 2. The host owns entropy, money and operation identity; this class only asks and shows. */
export class CascadeUI{
  private root:HTMLElement;
  private dialog:HTMLDialogElement;
  private stage:Stage;
  private show:Show;
  private audio:TempleAudio;
  private media:MediaQueryList;
  private unsubscribe:()=>void;
  private owner:string|null=null;
  private marker='';
  private stake='10';
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
  private presenting=false;
  private completed=false;
  private pumpTimer=0;
  private lastRequestAt=0;
  private skippedRound:string|null=null;
  private returnFocus='rules';
  private sayText='';
  private sayKind='';
  private payText='0';
  private frame=0;
  private last=0;
  private ready=false;
  private cueRound=0;
  private el:Record<string,HTMLElement>={};
  private heldBalance:number|null=null;
  private resize:ResizeObserver;
  private get doc(){return this.host.ownerDocument;}
  private get client(){return this.services.expansionClient;}
  private get wallet(){return this.services.demoWallet;}
  private get en(){return this.services.i18n.language==='en';}
  private text(ru:string,en:string){return this.en?en:ru;}
  private money(units:string){return (Number(units)/100).toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});}
  private get session():ExpansionSession|undefined{return this.owner&&this.owner===this.wallet.accountId&&this.owner===this.client.accountId?this.client.sessions.find(s=>s.gameId===TEMPLE_GAME&&s.rulesVersion===2):undefined;}
  private get view(){return this.session?.view.templeCascade;}
  private get roundStake(){return this.session?.stakeUnits??this.stake;}
  private get connected(){return !!this.owner&&this.wallet.accountId===this.owner&&!!this.wallet.wallet;}
  private get hidden(){return this.doc.hidden||document.hidden;}
  private get pending(){return this.client.pending?.gameId===TEMPLE_GAME;}
  private get waiting(){return !this.presenting&&(this.sending||this.pending&&this.client.busy);}
  private get recovery(){return this.pending&&canRecoverOperation(this.client);}
  private get locked(){return this.sending||this.client.busy||this.client.loading||this.wallet.busy||!!this.wallet.pending||this.wallet.hasExternalBusy('expansion');}
  private get suspended(){return this.paused||this.hidden||this.dialog.open;}
  private get affordable(){return !!this.wallet.wallet&&this.wallet.wallet.balance>=Number(this.stake)/100;}
  private get playing(){return this.presenting||this.session?.state==='active';}
  private get reduced(){return this.media.matches;}
  private changed=()=>this.sync();
  constructor(private host:HTMLElement,private services:GameHostV1){
    const doc=this.doc;this.root=doc.createElement('section');this.root.className='ebb';this.root.setAttribute('aria-label',this.text('Затопленный храм','Flooded Temple'));
    this.dialog=doc.createElement('dialog');this.dialog.className='ft-dialog ft-cascade-dialog ebb-dialog';this.dialog.setAttribute('aria-labelledby','ft-dialog-title');
    this.root.innerHTML=`<header class="ebb-top"><h1>${this.text('Затопленный храм','Flooded Temple')}</h1><div class="ebb-free" data-el="free" hidden></div><nav><button type="button" data-ft="journal" aria-label="${this.text('История раунда','Round history')}"><svg viewBox="0 0 24 24"><path d="M6 7h12M6 12h12M6 17h8"/></svg></button><button type="button" data-ft="rules" aria-label="${this.text('Правила и выплаты','Rules and payouts')}"><svg viewBox="0 0 24 24"><path d="M9 9a3 3 0 1 1 4.4 2.7c-1 .5-1.4 1-1.4 2.1M12 17.4v.2"/></svg></button><button type="button" data-ft="mute" data-el="mute"><svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10zM17 9.5a4 4 0 0 1 0 5"/><path class="off" d="m16 9 6 6m0-6-6 6"/></svg></button></nav></header>
<div class="ebb-say" data-el="say" role="status" aria-live="polite"></div><div class="ebb-grid" data-el="board" role="img"></div>
<section class="ebb-console" aria-label="${this.text('Управление игрой','Game controls')}"><div class="money"><span>${this.text('Общий баланс','Shared balance')}</span><strong data-ft-value="balance" data-el="balance"></strong></div>
<label class="stake"><span>${this.text('Ставка за раунд','Stake per round')}</span><select data-ft="stake" data-el="stake" aria-label="${this.text('Общая ставка, USDT','Total stake, USDT')}">${ROYAL_GAME_STAKE_CENTS.map(n=>`<option value="${n}">${this.money(String(n))}</option>`).join('')}</select></label>
<div class="pay"><span>${this.text('Выплата раунда','Round payout')}</span><strong data-ft-value="payout" data-el="payout"></strong><em data-el="net"></em></div>
<div class="modes"><button type="button" data-ft="fast" data-el="fast">${this.text('Быстро','Quick')}</button><select data-ft="auto-count" data-el="count" aria-label="${this.text('Количество автоспинов','Autoplay count')}">${counts.map(n=>`<option value="${n}">${n}</option>`).join('')}</select><button type="button" data-ft="auto" data-el="auto"></button></div>
<button type="button" class="ebb-spin" data-ft="primary" data-el="primary">${compass}<span data-el="label"></span></button></section><p class="ebb-note" data-el="note"></p>`;
    host.replaceChildren(this.root,this.dialog);
    for(const node of Array.from(this.root.querySelectorAll<HTMLElement>('[data-el]')))this.el[node.dataset.el!]=node;
    try{const s=doc.defaultView!.localStorage;this.fast=s.getItem('royal:temple:fast')==='1';const n=Number(s.getItem('royal:temple:auto-count'));if(counts.includes(n))this.autoCount=n;}catch{}
    services.gameAudio.install();this.audio=new TempleAudio(services.gameAudio,doc,true);
    this.stage=new Stage(this.root);
    this.show=new Show(this.stage,{cue:(c,g)=>this.cue(c,g),t:(ru,en)=>this.text(ru,en),money:u=>this.money(u),pay:u=>{this.payText=u;this.el.payout.textContent=this.money(u);},say:(t,k='')=>{this.sayText=t;this.sayKind=k;this.paintSay();},free:n=>this.free(n),payAt:()=>{const a=this.el.payout.getBoundingClientRect(),b=this.root.getBoundingClientRect();return{x:a.left+a.width/2-b.left,y:a.top+a.height/2-b.top};}});
    this.media=doc.defaultView!.matchMedia('(prefers-reduced-motion: reduce)');this.media.addEventListener('change',this.motion);
    this.unsubscribe=services.gameAudio.onPreferences(()=>this.render());
    this.root.addEventListener('click',this.click);this.root.addEventListener('change',this.select);
    this.dialog.addEventListener('click',this.click);this.dialog.addEventListener('close',this.closed);
    doc.addEventListener('visibilitychange',this.visibility);if(doc!==document)document.addEventListener('visibilitychange',this.visibility);
    this.client.addEventListener('change',this.changed);this.wallet.addEventListener('change',this.changed);
    this.resize=new ResizeObserver(()=>{if(!this.disposed)this.fit();});this.resize.observe(this.root);
    this.calm();this.sync();void this.client.refresh();this.render();
    void this.stage.load().then(()=>{if(this.disposed)return;this.ready=true;this.fit();this.stage.warm();if(!this.presenting)this.show.settle(this.view,this.view&&this.session?confirmedPayout(this.session,this.view.totalPayoutUnits):undefined);if(!this.view)this.stage.lock.set(readyGrid);this.render();this.loop(performance.now());});
  }
  private fit(){const r=this.root.getBoundingClientRect();if(this.ready&&r.width&&r.height)this.stage.layout(r.width,r.height);}
  private loop=(now:number)=>{if(this.disposed)return;const dt=Math.min(.05,(now-(this.last||now))/1000);this.last=now;if(!this.suspended||this.presenting)this.stage.tick(this.suspended?0:dt);this.frame=requestAnimationFrame(this.loop);};
  private calm(){const k=this.reduced?0:1;const s=this.stage;s.calm=s.hero.calm=s.temple.calm=s.lock.calm=s.fx.calm=k;this.show.calm=this.reduced;this.show.fast=this.fast;if(this.reduced)s.fx.list=[];}
  private cue(c:Cue,gain=1){void gain;const list=CUES[c];if(!list.length||!this.audio.audible)return;const cue=list[this.cueRound++%list.length];this.audio.now(cue);}
  private free(left:number|null){const e=this.el.free;e.hidden=left===null;this.root.classList.toggle('free',left!==null);if(left!==null)e.textContent=this.text('Бесплатных: ','Free spins: ')+left;}
  private paintSay(){const text=this.presenting||this.sending?this.sayText:this.status(),e=this.el.say;if(e.textContent!==text)e.textContent=text;e.className='ebb-say '+(this.presenting?this.sayKind:this.recovery||this.localError||this.client.error?'err':this.completed?(this.outcomeWin()?'win':'quiet'):'');}
  private outcomeWin(){const v=this.view,s=this.session;if(!v||!s)return false;const o=templeOutcome(this.roundStake,confirmedPayout(s,v.totalPayoutUnits));return o==='win'||o==='big';}
  private sync(){
    if(this.disposed)return;
    if(this.owner!==this.client.accountId){this.skippedRound=null;this.epoch++;this.sending=false;this.stopAuto(this.owner?this.text('Автоспины остановлены: аккаунт изменён.','Autoplay stopped: account changed.'):'');this.owner=this.client.accountId;this.marker='';this.presenting=false;this.completed=false;if(this.ready)this.show.settle(undefined);}
    const s=this.session,v=this.view,key=s?s.id+':'+v?.revision:'';
    if(key!==this.marker){this.marker=key;if(s)this.stake=s.stakeUnits;if(!this.sending&&!this.presenting){this.completed=!!v&&s?.state==='settled';if(this.ready)this.show.settle(v,v&&s?confirmedPayout(s,v.totalPayoutUnits):undefined);if(!v&&this.ready)this.stage.lock.set(readyGrid);}}
    const p=this.client.pending;if(p?.gameId===TEMPLE_GAME&&p.action==='start')this.stake=p.stakeUnits;
    this.audio.setAccountActive(this.connected);this.audio.setAllowed(!this.suspended);this.render();this.pump();
  }
  private settleFeedback(){this.presenting=false;this.heldBalance=null;this.completed=this.session?.state==='settled';if(this.ready)this.show.settle(this.view,this.view&&this.session?confirmedPayout(this.session,this.view.totalPayoutUnits):undefined);this.render();this.pump();}
  private save(){try{const s=this.doc.defaultView!.localStorage;s.setItem('royal:temple:fast',this.fast?'1':'0');s.setItem('royal:temple:auto-count',String(this.autoCount));}catch{}}
  private select=(event:Event)=>{
    const target=event.target as HTMLSelectElement;
    if(target.dataset.ft==='stake'&&!this.locked&&!this.playing&&!this.client.pending&&!this.autoRunning&&validGameStake(target.value))this.stake=target.value;
    if(target.dataset.ft==='auto-count'&&!this.autoRunning&&counts.includes(Number(target.value)))this.autoCount=Number(target.value);
    this.save();this.render();
  };
  private click=(event:Event)=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('[data-ft]');if(!target||target.hasAttribute('disabled'))return;
    const action=target.dataset.ft;void this.audio.gesture();
    if(action==='close'){this.dialog.close();return;}
    if(action==='rules'||action==='journal'){this.returnFocus=action;this.stopAuto(this.text('Автоспины остановлены.','Autoplay stopped.'));if(this.presenting)this.skip();this.showDialog(action);return;}
    if(action==='mute'){const p=this.services.gameAudio.getPreferences();this.services.gameAudio.setMuted(!p.muted);return;}
    if(action==='fast'){this.fast=!this.fast;this.show.fast=this.fast;this.save();this.render();return;}
    if(action==='auto'){
      if(this.autoRunning){this.stopAuto(this.text('Автоспины остановлены. Принятый раунд будет завершён.','Autoplay stopped. The accepted round will finish.'));this.render();this.pump();return;}
      if(this.locked||this.playing||this.client.pending||!this.connected||this.suspended||!this.affordable)return;
      this.autoRunning=true;this.autoRemaining=this.autoCount;this.autoNote='';this.render();this.pump();return;
    }
    if(action==='primary'){
      if(this.presenting){this.skip();return;}
      if(this.locked||this.suspended||!this.connected)return;
      if(this.pending){void this.operate('retry');return;}
      if(this.client.pending)return;
      if(this.session?.state==='active'){void this.operate('continue');return;}
      if(!this.autoRunning&&this.affordable)void this.operate('start');
    }
  };
  /** Shows the confirmed end of the accepted round at once. Remaining free continuations still run, without decoration. */
  private skip(){this.skippedRound=this.session?.id??null;this.settleFeedback();}
  private stopAuto(note:string){this.autoRunning=false;this.autoRemaining=0;this.autoNote=note;clearTimeout(this.pumpTimer);this.pumpTimer=0;}
  private pump(){
    clearTimeout(this.pumpTimer);this.pumpTimer=0;
    if(this.disposed||this.suspended||!this.connected||this.locked||this.presenting||this.client.pending)return;
    // All automatic requests share the 120/minute account guard, including free continuations.
    const cadence=Math.max(0,550-(performance.now()-this.lastRequestAt));
    if(this.session?.state==='active'){this.pumpTimer=window.setTimeout(()=>{this.pumpTimer=0;void this.operate('continue');},Math.max(cadence,this.fast||this.reduced?30:280));return;}
    if(!this.autoRunning)return;
    if(this.autoRemaining===0){this.stopAuto(this.text('Серия автоспинов завершена.','Autoplay completed.'));this.render();return;}
    if(!this.affordable){this.stopAuto(this.text('Автоспины остановлены: недостаточно средств.','Autoplay stopped: insufficient balance.'));this.render();return;}
    this.pumpTimer=window.setTimeout(()=>{this.pumpTimer=0;void this.operate('start');},Math.max(cadence,this.fast||this.reduced?250:800));
  }
  private async operate(kind:'start'|'continue'|'retry'){
    if(this.disposed||this.suspended||this.locked||!this.connected||kind!=='retry'&&this.client.pending||kind==='start'&&(this.playing||!this.affordable)||kind==='continue'&&this.session?.state!=='active')return;
    const epoch=this.epoch,previous=this.view,oldId=this.session?.id,newRound=kind==='start'||kind==='retry'&&this.client.pending?.action==='start';
    this.sending=true;this.completed=false;this.localError='';this.lastRequestAt=performance.now();
    if(this.wallet.wallet&&this.heldBalance===null)this.heldBalance=this.wallet.wallet.balance-(newRound&&kind==='start'?Number(this.stake)/100:0);
    const started=kind==='start'&&this.ready?this.show.request():undefined;this.render();
    try{
      if(kind==='retry')await this.client.retry();
      else if(kind==='start')await this.client.act({gameId:TEMPLE_GAME,action:'start',stakeUnits:this.stake,settings:{temple:{mode:'cascades'}}});
      else await this.client.act({gameId:TEMPLE_GAME,action:'move',sessionId:this.session!.id,revision:this.view!.revision,move:'temple-cascade'});
      if(epoch!==this.epoch||this.disposed)return;
      if(kind==='start'&&this.autoRunning)this.autoRemaining=Math.max(0,this.autoRemaining-1);
      const v=this.view;this.marker=this.session?this.session.id+':'+v?.revision:'';
      if(v&&this.ready&&!this.suspended&&this.skippedRound!==this.session?.id&&!(kind==='retry'&&oldId===this.session?.id&&previous?.revision===v.revision)){this.sending=false;void this.present(v,newRound?undefined:previous,started);}
      else this.settleFeedback();
    }catch(error){if(epoch===this.epoch&&!this.disposed){this.heldBalance=null;this.localError=error instanceof Error?error.message:String(error);this.stopAuto(this.text('Автоспины остановлены после ошибки.','Autoplay stopped after an error.'));}}
    finally{if(epoch===this.epoch&&!this.disposed){this.sending=false;this.render();this.pump();}}
  }
  private async present(view:TempleCascadeView,previous:TempleCascadeView|undefined,started?:Promise<void>){
    this.presenting=true;this.completed=false;this.render();const run=this.show.run+(previous?1:0),epoch=this.epoch;
    try{
      await this.show.play(view,previous,started);
      if(view.phase==='complete'&&this.session&&!this.disposed&&epoch===this.epoch)await this.show.finish(view,confirmedPayout(this.session,view.totalPayoutUnits));
    }catch(error){console.warn('temple show',error);}
    if(this.disposed||epoch!==this.epoch||this.show.run!==run)return;
    this.presenting=false;this.heldBalance=null;this.completed=this.session?.state==='settled';this.render();this.pump();
  }
  private status(){
    if(!this.connected)return this.text('Войди в аккаунт Royal, чтобы начать.','Sign in to Royal to begin.');
    if(this.waiting)return this.text('Шлюз открыт…','The sluice is open…');
    if(this.recovery)return this.text('Ответ не подтверждён. «Проверить раунд» повторит ту же операцию без новой ставки.','Result unconfirmed. “Check round” retries the same operation without a new stake.');
    if(this.localError||this.client.error)return this.localError||this.client.error;
    if(this.session?.state==='active')return this.suspended?this.text('Раунд сохранён. Продолжение без новой ставки.','Round saved. Continue without a new stake.'):this.text('Продолжаем без новой ставки…','Continuing without a new stake…');
    if(this.completed&&this.view&&this.session){const payout=confirmedPayout(this.session,this.view.totalPayoutUnits),o=templeOutcome(this.roundStake,payout),cap=this.view.frames.at(-1)?.capped;
      const head=cap?this.text('Предел 500×','500× limit'):{loss:this.text('Без выигрыша','No win'),partial:this.text('Частичный возврат','Partial return'),return:this.text('Ставка возвращена','Stake returned'),win:this.text('Выигрыш','Win'),big:this.text('Крупный выигрыш','Big win')}[o];
      return o==='loss'?head:head+' · '+this.money(payout);}
    if(this.autoNote)return this.autoNote;
    if(!this.affordable)return this.text('Недостаточно средств для выбранной ставки.','Insufficient balance for this stake.');
    return this.text('Открой шлюз','Open the sluice');
  }
  private symbolName(symbol:number){return names[symbol][this.en?1:0];}
  private render(){
    if(this.disposed)return;
    if(!this.playing&&!this.client.pending&&!validGameStake(this.stake))this.stake='10';
    const e=this.el,disabled=this.locked||!this.connected||this.suspended,active=this.session?.state==='active',pending=!!this.client.pending,prefs=this.services.gameAudio.getPreferences();
    this.root.dataset.phase=this.root.classList.contains('free')?'free':this.completed?'complete':'base';this.root.dataset.motion=this.reduced?'reduced':'full';this.root.dataset.speed=this.fast?'quick':'normal';this.root.dataset.paused=String(this.suspended);this.root.dataset.requesting=String(this.waiting);this.root.setAttribute('aria-busy',String(this.sending||this.client.busy||this.client.loading));
    e.balance.textContent=this.connected?(this.presenting&&this.heldBalance!==null?this.heldBalance:this.wallet.wallet!.balance).toLocaleString(this.en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'···';
    const net=this.view&&this.completed&&this.session?BigInt(confirmedPayout(this.session,this.view.totalPayoutUnits))-BigInt(this.roundStake):undefined;
    if(!this.presenting&&!this.sending&&this.view&&this.session)this.payText=confirmedPayout(this.session,this.view.totalPayoutUnits);
    e.payout.textContent=this.money(this.payText);e.net.textContent=net===undefined?'':this.text('Итог ','Net ')+(net>0n?'+':net<0n?'−':'')+this.money(String(net<0n?-net:net));
    const stake=e.stake as HTMLSelectElement;this.stake=syncStakeSelect(stake,this.stake,ROYAL_GAME_STAKE_CENTS,disabled||this.playing||pending||this.autoRunning);
    const label=this.presenting?this.text('Показать итог','Show result'):this.waiting?this.text('Шлюз открыт','Sluice open'):this.recovery?this.text('Проверить раунд','Check round'):active?this.text('Продолжить','Continue'):this.text('Вращать','Spin');
    const p=e.primary as HTMLButtonElement;e.label.textContent=label;p.classList.toggle('run',this.waiting);p.classList.toggle('skip',this.presenting);
    p.disabled=this.presenting?this.suspended:disabled||pending&&!this.pending||!active&&!this.pending&&(!this.affordable||this.autoRunning);
    const fast=e.fast as HTMLButtonElement;fast.setAttribute('aria-pressed',String(this.fast));fast.setAttribute('aria-label',this.text('Быстрая игра','Quick play'));
    const count=e.count as HTMLSelectElement;count.value=String(this.autoCount);count.disabled=this.autoRunning;
    const auto=e.auto as HTMLButtonElement;auto.setAttribute('aria-pressed',String(this.autoRunning));auto.textContent=this.autoRunning?this.text('Стоп · ','Stop · ')+this.autoRemaining:this.text('Авто','Auto');auto.disabled=!this.autoRunning&&(disabled||this.playing||pending||!this.affordable);
    const mute=e.mute;mute.setAttribute('aria-pressed',String(!prefs.muted));mute.setAttribute('aria-label',prefs.muted?this.text('Включить звук','Unmute audio'):this.text('Выключить звук','Mute audio'));
    const grid=this.view?.frames.at(-1)?.grid??readyGrid;e.board.setAttribute('aria-label',this.text('Поле 5 на 3: ','5 by 3 grid: ')+[0,1,2].map(r=>[0,1,2,3,4].map(c=>this.symbolName(grid[c*3+r])).join(', ')).join('; '));
    e.note.textContent=this.autoRunning||this.autoNote?this.autoNote:'';
    this.paintSay();
  }
  private showDialog(kind:'rules'|'journal'){
    const v=this.view,s=this.session;
    const rules=`<p>${this.text('20 фиксированных линий. От трёх одинаковых символов подряд слева направо дают выплату. Ставка линии равна общей ставке / 20. Все выигравшие символы рассыпаются одновременно, остальные опускаются, вода приносит новые.','20 fixed paylines. Three or more matching symbols from the left pay. Line stake is total stake / 20. All winning symbols crumble together, the others sink and the water brings new ones.')}</p><p>${this.text('Уровень воды показывает множитель цепочки: ×1, ×2, ×3, ×5. В святилище реликвий свет поднимается по ступеням ×3, ×6, ×9, ×15. Последний множитель сохраняется до конца цепочки, каждое новое вращение начинает лестницу заново.','The water level shows the chain multiplier: ×1, ×2, ×3, ×5. In the Relic Sanctuary the light rises through ×3, ×6, ×9, ×15. The final multiplier holds for the rest of the chain. Each new spin resets the ladder.')}</p><p>${this.text('Компас WILD заменяет обычные символы и реликвию, появляется только в столбцах 2–4. Три реликвии BONUS на одной линии в первых трёх столбцах дают 10 бесплатных вращений. Каждая такая линия даёт ещё 10, в том числе повторно в бонусе. Сама линия реликвий не платит монеты.','WILD substitutes ordinary symbols and the relic and appears in columns 2–4. Three BONUS relics on a payline in the first three columns award 10 free spins. Every qualifying line adds another 10, including retriggers in the bonus. The relic line itself pays no coins.')}</p><p>${this.text('Базовая цепочка ждёт окончания бонуса и продолжается с сохранённым множителем. Вся цепочка и бесплатные вращения входят в одну ставку. Предел общей выплаты 500× ставки, после него раунд заканчивается. Сумма начисляется один раз в конце раунда.','The base chain waits for the bonus and resumes with its saved multiplier. Cascades and free spins belong to one paid round. Total payout is capped at 500× stake and reaching it ends the round. The payout is credited once at the end.')}</p><h3>${this.text('Выплаты в ставках линии, до множителя','Payouts in line stakes, before multiplier')}</h3><table><thead><tr><th>${this.text('Символ','Symbol')}</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>${CASCADE_DATA.paytable.map((row,i)=>`<tr><td>${this.symbolName(i)}</td>${row.map(n=>`<td>${n}×</td>`).join('')}</tr>`).join('')}</tbody></table><h3>${this.text('20 линий','20 paylines')}</h3><div class="ft-paylines">${CASCADE_DATA.paylines.map((rows,i)=>`<div aria-label="${this.text('Линия','Line')} ${i+1}: ${rows.map(r=>r+1).join(', ')}"><b>${i+1}</b><svg viewBox="0 0 100 55" aria-hidden="true"><path d="${rows.map((r,c)=>(c?'L':'M')+(c*22+6)+','+(r*20+7)).join(' ')}"/></svg></div>`).join('')}</div><p>${this.text('Быстрый режим вдвое ускоряет показ. Автоспины запускают выбранное число платных раундов. «Стоп» отменяет будущие ставки, принятый раунд завершается. Закрытие игры, смена аккаунта и скрытие окна останавливают серию.','Quick play shows everything at twice the normal speed. Autoplay starts the selected number of paid rounds. Stop cancels future stakes while the accepted round finishes. Closing, changing account or hiding the window stops autoplay.')}</p><p>${this.text('Целевой RTP: 96%. Статистическая оценка на 400 млн независимых раундов: 95,9988%. Это среднее на большой выборке, а не обещание результата отдельной сессии.','Target RTP: 96%. Statistical estimate over 400 million independent rounds: 95.9988%. This is a large-sample average, not a promise for an individual session.')}</p><p>Music: <a href="${templeMusic.source}" target="_blank" rel="noopener">${escape(templeMusic.title)}</a> · ${escape(templeMusic.author)} · CC BY 4.0</p>`;
    const journal=v?`<p>${this.text('Ставка','Stake')}: ${this.money(s!.stakeUnits)} · ${this.text('Подтверждено выпадений','Confirmed falls')}: ${v.state.falls} · ${this.text('Сыграно бесплатных вращений','Free spins played')}: ${v.state.playedFreeSpins}</p><p>${this.text('Накоплено','Accumulated')}: ${this.money(confirmedPayout(s,v.totalPayoutUnits))}. ${s?.state==='settled'?this.text('Раунд завершён, выплата начислена.','Round complete, payout credited.'):this.text('Раунд сохранён, выплата будет начислена в конце.','Round saved, payout will be credited at the end.')}</p><p>${this.text('Последняя подтверждённая часть','Latest confirmed batch')}:</p><ol>${v.frames.map(f=>`<li>${this.text('Выпадение','Fall')} ${f.fall} · ${f.mode==='free'?this.text('Бесплатное','Free'):this.text('Базовое','Base')} ×${f.multiplier} · +${this.money(cascadeUnits(f.awardedPoints,this.roundStake))}${f.addedFreeSpins?` · +${f.addedFreeSpins} FS`:''}</li>`).join('')}</ol>`:`<p>${this.text('Подтверждённых раундов пока нет.','There are no confirmed rounds yet.')}</p>`;
    this.dialog.innerHTML=`<button type="button" class="ft-dialog-close" data-ft="close" aria-label="${this.text('Закрыть','Close')}">×</button><h2 id="ft-dialog-title">${kind==='rules'?this.text('Правила и выплаты','Rules and payouts'):this.text('История раунда','Round history')}</h2>${kind==='rules'?rules+stakeRulesHtml(this.en):journal}`;
    if(!this.dialog.open)this.dialog.showModal();this.audio.setAllowed(false);this.render();
  }
  private closed=()=>{
    if(this.disposed)return;
    const focused=this.doc.activeElement,restore=!focused||focused===this.doc.body||this.dialog.contains(focused);
    this.audio.setAllowed(!this.suspended);this.render();
    if(restore)this.root.querySelector<HTMLElement>(`[data-ft="${this.returnFocus}"]`)?.focus({preventScroll:true});
    this.pump();
  };
  private motion=()=>{this.calm();if(this.reduced&&this.presenting)this.skip();this.render();};
  private visibility=()=>{if(this.hidden){this.stopAuto(this.text('Автоспины остановлены: окно скрыто.','Autoplay stopped: window hidden.'));clearTimeout(this.pumpTimer);this.pumpTimer=0;if(this.presenting)this.skip();}this.audio.setAllowed(!this.suspended);this.render();if(!this.hidden)this.pump();};
  pause(){this.paused=true;this.stopAuto(this.text('Автоспины остановлены.','Autoplay stopped.'));if(this.presenting)this.skip();this.audio.setAllowed(false);this.render();}
  resume(){if(this.disposed)return;this.paused=false;this.audio.setAllowed(!this.suspended);this.render();this.pump();}
  getState(){const v=this.view,f=v?.frames.at(-1);return {gameId:TEMPLE_GAME,version:2,presentation:'ebb',owner:this.owner,sessionId:this.session?.id,revision:v?.revision,phase:v?.phase??'ready',busy:this.locked,presenting:this.presenting,visual:f,completed:this.completed,selectedStakeUnits:this.stake,acceptedStakeUnits:this.session?.stakeUnits,decorationsSkipped:this.skippedRound===this.session?.id,fast:this.fast,autoplay:{running:this.autoRunning,remaining:this.autoRemaining,count:this.autoCount,note:this.autoNote},pending:this.pending,requesting:this.waiting,recovery:this.recovery,paused:this.paused,ready:this.ready,stage:{mode:this.stage.mode,level:this.stage.lock.level,step:this.stage.lock.step,holy:this.stage.lock.holy,spot:this.stage.spot,particles:this.stage.fx.list.length,maxParticles:this.stage.fx.max},character:this.stage.hero.state(),audio:this.audio.getState(),disposed:this.disposed};}
  destroy(){if(this.disposed)return;this.disposed=true;this.epoch++;this.stopAuto('');this.show.cancel();cancelAnimationFrame(this.frame);this.resize.disconnect();this.stage.destroy();this.unsubscribe();this.media.removeEventListener('change',this.motion);this.doc.removeEventListener('visibilitychange',this.visibility);document.removeEventListener('visibilitychange',this.visibility);this.client.removeEventListener('change',this.changed);this.wallet.removeEventListener('change',this.changed);this.root.removeEventListener('click',this.click);this.root.removeEventListener('change',this.select);this.dialog.removeEventListener('click',this.click);this.dialog.removeEventListener('close',this.closed);this.audio.destroy();this.dialog.remove();this.root.remove();}
}
