import { t as translateText, tr, locale } from '../i18n/index';
import { emitGameOutcome } from './gameReactions';
import {DEMO_BETS} from '../shared/demoWallet';
import type {ExpansionAction} from '../shared/casinoExpansion';
import {studioWheelMultiplier,studioWheelSegments} from '../shared/studioGames';
import {wheelSpinPresentation,type WheelSpinPresentation,type WheelSpinPresentationGameId,type WheelSpinTarget} from '../shared/wheelSpinPresentation';
import {expansionClient as client} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {gameAudio} from '../game/GameAudio';
import {WheelSpinBoard} from './WheelSpinBoard';
import {WHEEL_SPIN_NAMES,WHEEL_TARGET_NAMES,wheelCategoryIcon,wheelEmblem} from './WheelSpinArtwork';
import './wheel-spin.css';

type Start=Extract<ExpansionAction,{action:'start'}>;
type Live={token:string;account:string;epoch:number;request?:Start;requestId:string;stake:string;target:WheelSpinTarget;motion:boolean;balance:number;accepted?:WheelSpinPresentation};
const amount=(units:string|number)=>(Number(units)/100).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
const multiple=(value:number)=>`${value.toLocaleString(locale,{maximumFractionDigits:2})}×`;
const targetValue=(value:number):value is WheelSpinTarget=>Number.isInteger(value)&&value>=0&&value<=3;

export class WheelSpinUI {
  private root=document.createElement('section');
  private board:WheelSpinBoard;
  private audio:ReturnType<typeof gameAudio.createSlotAudio>;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  private owner=client.accountId;
  private epoch=0;
  private alive=true;
  private stake='1000';
  private stakeChosen=false;
  private target:WheelSpinTarget=0;
  private live?:Live;
  private shown?:WheelSpinPresentation;
  private history:WheelSpinPresentation[]=[];
  private preview=false;
  private error='';
  private payoutFrame=0;
  private timers=new Map<ReturnType<typeof setTimeout>,()=>void>();
  private unsubscribe:()=>void;
  private change=()=>this.sync();
  private visibility=()=>{if(document.hidden)this.cancel();this.sync();};
  private motionChange=()=>{this.cancel();this.root.dataset.reducedMotion=String(this.reduced.matches);this.sync();};
  private preferences=()=>{
    const p=gameAudio.getPreferences();
    this.find('[data-wheel-mute]').setAttribute('aria-pressed',String(p.muted));
    this.find<HTMLInputElement>('[data-wheel-volume]').value=String(p.volume);
  };

  constructor(host:HTMLElement,readonly game:WheelSpinPresentationGameId){
    this.root.className=`wheel-spin-slot ${game}`;this.root.dataset.wheelSpinSlot=game;
    this.root.dataset.reducedMotion=String(this.reduced.matches);this.markup();host.replaceChildren(this.root);
    this.board=new WheelSpinBoard(this.find('[data-wheel-board-host]'),game);this.board.setTarget(this.target);
    this.audio=gameAudio.createSlotAudio(game);
    this.find('[data-wheel-spin]').onclick=()=>void this.spin();
    this.find('[data-wheel-retry]').onclick=()=>void this.retry();
    this.find('[data-wheel-refresh]').onclick=()=>void this.refresh();
    this.find('[data-wheel-targets]').onclick=e=>{
      const button=(e.target as HTMLElement).closest<HTMLElement>('[data-wheel-target]');
      if(button)this.selectTarget(Number(button.dataset.wheelTarget));
    };
    this.find<HTMLSelectElement>('[data-wheel-stake]').onchange=e=>{
      const value=(e.target as HTMLSelectElement).value;
      if(this.blocked()||client.pending||!DEMO_BETS.some(bet=>String(bet*100)===value))return;
      this.stake=value;this.stakeChosen=true;this.controls();
    };
    this.find('[data-wheel-facts]').onclick=()=>{if(this.shown&&!this.live)this.selectReceipt();};
    this.find('[data-wheel-history]').onclick=e=>{
      const button=(e.target as HTMLElement).closest<HTMLElement>('[data-wheel-receipt]');
      const p=this.history.find(v=>v.outcomeId===button?.dataset.wheelReceipt);
      if(p&&!this.live)this.static(p);
    };
    this.find('[data-wheel-mute]').onclick=()=>gameAudio.setMuted(!gameAudio.getPreferences().muted);
    this.find<HTMLInputElement>('[data-wheel-volume]').oninput=e=>gameAudio.setVolume(Number((e.target as HTMLInputElement).value));
    client.addEventListener('change',this.change);demoWallet.addEventListener('change',this.change);
    document.addEventListener('visibilitychange',this.visibility);this.reduced.addEventListener('change',this.motionChange);
    this.unsubscribe=gameAudio.onPreferences(this.preferences);this.sync();void this.refresh();
  }
  private find<T extends HTMLElement=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  private balance(){return demoWallet.wallet?.balance??client.wallet?.balance;}
  private ownPending():Start|undefined{const p=client.pending;return p?.action==='start'&&p.gameId===this.game?p:undefined;}
  private blocked(){return !!this.live||document.hidden||client.busy||client.loading||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion');}
  private requestTarget(p:Start){return (p.settings as {studio:{target:WheelSpinTarget}}).studio.target;}
  private phase(value:'idle'|'waiting'|'spinning'|'stopping'|'result'|'uncertain'){this.root.dataset.phase=value;}
  private markup(){
    const gold=this.game==='studio-saffron-spin';
    this.root.innerHTML=tr`<header class="wheel-spin-head"><div><span class="wheel-spin-eyebrow">ROYAL CLUB / КОЛЕСО</span><h3>${WHEEL_SPIN_NAMES[this.game]}</h3></div><div class="wheel-spin-balance">USDT · Демо<strong data-wheel-balance>…</strong></div></header><div class="wheel-spin-brand">${wheelEmblem(this.game)}<span>${gold?'SAFFRON CERAMIC':'SPOTLIGHT STAGE'}</span></div><div class="wheel-spin-targets" data-wheel-targets>${WHEEL_TARGET_NAMES.map((name,index)=>`<button data-wheel-target="${index}" aria-pressed="${index===0}"><span>${wheelCategoryIcon(index as WheelSpinTarget)}${name}</span><small data-wheel-target-value></small></button>`).join('')}</div><div class="wheel-spin-frame"><div data-wheel-board-host></div><span class="wheel-spin-wait" data-wheel-wait hidden>Ждём подтверждения вращения</span></div><div class="wheel-spin-result"><div><span data-wheel-caption>Выбери цель и вращай</span><strong data-wheel-payout data-units="0" data-target-units="0"><span data-wheel-amount>0,00</span><small> USDT</small></strong></div><span data-wheel-bigwin hidden>БОЛЬШОЙ ВЫИГРЫШ</span></div><button class="wheel-spin-facts" data-wheel-facts hidden></button><p data-wheel-detail hidden></p><div class="wheel-spin-console"><label>Общая ставка<select data-wheel-stake>${DEMO_BETS.map(bet=>tr`<option value="${bet*100}">${bet} USDT</option>`).join('')}</select></label><button data-wheel-spin data-start>ВРАЩАТЬ КОЛЕСО</button></div><div class="wheel-spin-tools"><button data-wheel-retry hidden>Проверить то же вращение</button><button data-wheel-refresh>Обновить</button><button data-wheel-mute aria-pressed="false">Звук</button><label aria-label="Громкость"><input data-wheel-volume type="range" min="0" max="1" step=".05"></label></div><p data-wheel-status role="status"></p><p data-wheel-error role="alert"></p><div data-wheel-history></div><details><summary>Вероятности и правила</summary><p>Выбери одну из четырёх целей. Все физические сектора равновероятны. Повторяющиеся знаки занимают отдельные сектора. Множитель включает ставку.</p><p>Расчётный возврат 98%. Один оплаченный результат, без бесплатных вращений. При несовпадении цели выплата равна нулю.</p></details><footer>Виртуальные USDT.</footer>`;
    this.phase('idle');
  }
  private selectTarget(value:number){
    if(!targetValue(value)||this.blocked()||client.pending)return;
    this.target=value;this.preview=true;this.clearResult();this.board.setTarget(value);this.board.show();this.controls();
  }
  private clearDetail(){delete this.root.dataset.selectedReceipt;this.find('[data-wheel-detail]').replaceChildren();this.find('[data-wheel-detail]').hidden=true;}
  private clearResult(){
    this.shown=undefined;for(const key of ['outcomeId','sector','sectorValue','won','animationFallback'])delete this.root.dataset[key];
    this.root.dataset.presentation='';this.clearDetail();this.find('[data-wheel-facts]').replaceChildren();
    this.find('[data-wheel-facts]').hidden=true;this.find('[data-wheel-bigwin]').hidden=true;
    this.find('[data-wheel-caption]').textContent=translateText('Выбери цель и вращай');this.setPayout(0,0);
  }
  private currentMatches(live:Live){
    if(!live.accepted)return true;
    const current=client.sessions.find(s=>s.gameId===this.game);
    return current?.id===live.requestId&&current.state==='settled'&&current.view.phase===1;
  }
  private sync(){
    if(!this.alive)return;
    if(client.accountId!==this.owner){
      this.epoch++;this.cancel();this.owner=client.accountId;this.target=0;this.stake='1000';this.stakeChosen=false;
      this.history=[];this.preview=false;this.error='';this.clearResult();this.find('[data-wheel-history]').replaceChildren();
      this.board.setTarget(0);this.board.show();
    }
    const pending=this.ownPending(),live=this.live;
    if(live&&!live.request&&pending){live.request=structuredClone(pending);live.requestId=pending.id;}
    if(live&&live.accepted&&!this.currentMatches(live))this.cancel();
    else if(live&&!client.busy&&!client.pending){
      const saved=client.sessions.find(s=>s.gameId===this.game&&s.id===live.requestId),p=wheelSpinPresentation(saved,live.request);
      if(p)this.accept(p,live);else{this.cancel();if(saved)this.error=translateText('Результат колеса не удалось подтвердить. Обнови кошелёк.');}
    }else if(live&&!client.busy&&client.pending)this.cancel();
    if(!this.live&&!this.preview&&!client.pending){
      const p=wheelSpinPresentation(client.sessions.find(s=>s.gameId===this.game));
      if(p&&p.outcomeId!==this.shown?.outcomeId)this.static(p);
    }
    if(pending){this.stake=pending.stakeUnits;this.target=this.requestTarget(pending);if(!this.live)this.board.setTarget(this.target);}
    if(!this.live&&client.pending)this.phase('uncertain');this.controls();
  }
  private controls(){
    if(!this.alive)return;
    const pending=this.ownPending(),blocked=this.blocked(),balance=this.balance(),ready=!!client.accountId&&balance!==undefined;
    this.find('[data-wheel-balance]').textContent=balance===undefined?'…':(this.live?.balance??balance).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
    this.root.dataset.target=String(this.target);this.root.dataset.sectorCount=String(studioWheelSegments(this.game).length);
    this.find<HTMLSelectElement>('[data-wheel-stake]').value=this.stake;this.find<HTMLSelectElement>('[data-wheel-stake]').disabled=blocked||!!client.pending;
    const segments=studioWheelSegments(this.game);
    this.root.querySelectorAll<HTMLButtonElement>('[data-wheel-target]').forEach(button=>{
      const value=Number(button.dataset.wheelTarget) as WheelSpinTarget,count=segments.filter(v=>v===value).length;
      button.disabled=blocked||!!client.pending;button.setAttribute('aria-pressed',String(value===this.target));
      const probability=(count/segments.length*100).toLocaleString(locale,{maximumFractionDigits:2});
      button.querySelector('[data-wheel-target-value]')!.textContent=`${probability}% · ${multiple(studioWheelMultiplier(this.game,value))}`;
      button.setAttribute('aria-label',tr`${WHEEL_TARGET_NAMES[value]}, вероятность ${probability}%, множитель ${multiple(studioWheelMultiplier(this.game,value))}`);
    });
    this.find<HTMLButtonElement>('[data-wheel-spin]').disabled=blocked||!!client.pending||!ready||Number(this.stake)>(balance??0)*100;
    const retry=this.find<HTMLButtonElement>('[data-wheel-retry]');retry.hidden=!pending;retry.disabled=blocked||!ready;
    this.find<HTMLButtonElement>('[data-wheel-refresh]').disabled=blocked||!client.accountId;
    this.find('[data-wheel-wait]').hidden=this.root.dataset.phase!=='waiting';this.root.setAttribute('aria-busy',String(!!this.live||client.busy));
    this.find('[data-wheel-status]').textContent=!client.accountId?translateText('Войди в аккаунт, чтобы играть на виртуальные USDT.'):!ready?translateText('Загружаем баланс…'):this.live?this.live.accepted?translateText('Колесо выбирает свой сектор.'):translateText('Ждём подтверждения вращения…'):pending?translateText('Проверь тот же результат без новой ставки.'):client.pending||demoWallet.hasExternalBusy('expansion')?translateText('Сначала проверь незавершённый ход другой игры.'):this.shown?translateText('Раунд завершён. Выплата начислена.'):translateText('Выбери цель и ставку.');
    this.find('[data-wheel-error]').textContent=this.error||client.error;
    this.find('[data-wheel-history]').innerHTML=this.history.map((p,index)=>`<button data-wheel-receipt="${p.outcomeId}" ${this.live?'disabled':''}>${index===0?translateText('Последнее вращение'):tr`Вращение ${this.history.length-index}`} · ${amount(p.returnedUnits)}</button>`).join('');
  }
  private async spin(){
    if(this.blocked()||client.pending||!client.accountId||this.balance()===undefined)return;
    const live:Live={token:crypto.randomUUID(),account:client.accountId,epoch:++this.epoch,requestId:'',stake:this.stake,target:this.target,motion:!this.reduced.matches,balance:this.balance()!};
    this.live=live;this.preview=true;this.error='';this.clearResult();this.root.dataset.animationToken=live.token;
    this.root.dataset.presentation='waiting';this.phase('waiting');
    this.audio.beginWheel(live.token,{sectors:studioWheelSegments(this.game).length as 12|16,motion:live.motion,click:live.motion});
    if(live.motion)this.board.begin(live.token,()=>this.valid(live));else this.board.show();
    this.controls();
    try{await client.act({gameId:this.game,action:'start',stakeUnits:live.stake,settings:{studio:{target:live.target}}});}
    catch(error){if(this.sameEpoch(live)){this.error=(error as Error).message;if(this.live===live)this.cancel();}}
    this.sync();
  }
  private sameEpoch(live:Live){return this.alive&&live.epoch===this.epoch&&live.account===client.accountId;}
  private valid(live:Live){
    if(this.live===live&&(document.hidden||live.motion&&this.reduced.matches||!this.currentMatches(live))){
      this.root.dataset.reducedMotion=String(this.reduced.matches);this.cancel();return false;
    }
    return this.sameEpoch(live)&&this.live===live;
  }
  private accept(p:WheelSpinPresentation,live:Live){
    if(!this.sameEpoch(live)||this.live!==live||live.accepted||p.outcomeId!==live.requestId||p.stakeUnits!==live.stake||p.target!==live.target)return;
    if(document.hidden||live.motion&&this.reduced.matches){this.cancel();this.static(p);return;}
    live.accepted=p;void this.present(p,live);
  }
  private async present(p:WheelSpinPresentation,live:Live){
    if(!this.valid(live))return;
    this.audio.confirmWheel(live.token,{sector:p.sector,target:p.target,segments:p.segments});
    let complete=true;
    if(live.motion)complete=await this.board.finish(p,live.token,{
      valid:()=>this.valid(live),phase:phase=>{if(this.valid(live)){this.phase(phase);this.controls();}},
      contact:index=>{if(this.valid(live))this.audio.wheelContact(live.token,index);},
    });
    if(!this.valid(live))return;
    if(!complete){this.root.dataset.animationFallback='static';this.cancel();return;}
    if(live.motion)this.audio.wheelLanding(live.token,p.sector);
    this.show(p);this.root.dataset.presentation=live.motion?'animated':'static';this.phase('result');
    if(live.motion&&!await this.delay(380,live))return;
    const total=Number(p.returnedUnits),stake=Number(p.stakeUnits);
    this.audio.outcome(live.token,total===0?'loss':total>=stake*4?'bigwin':'win');
    this.find('[data-wheel-bigwin]').hidden=total<stake*4;this.count(total,live);
  }
  private show(p:WheelSpinPresentation){
    if(this.shown?.outcomeId!==p.outcomeId)this.clearDetail();
    this.shown=p;this.preview=false;if(!this.history.some(row=>row.outcomeId===p.outcomeId))this.history=[p,...this.history].slice(0,12);
    this.target=p.target;if(!this.stakeChosen)this.stake=p.stakeUnits;this.board.show(p);
    this.root.dataset.outcomeId=p.outcomeId;this.root.dataset.sector=String(p.sector);this.root.dataset.sectorValue=String(p.sectorValue);this.root.dataset.won=String(p.won);
    this.find('[data-wheel-caption]').textContent=p.won?translateText('Цель совпала'):translateText('Сектор не совпал с целью');
    const facts=this.find('[data-wheel-facts]');facts.hidden=false;
    facts.innerHTML=tr`Сектор ${p.sector+1} из ${p.segments.length}: <strong>${WHEEL_TARGET_NAMES[p.sectorValue]}</strong> · выплата <strong>${p.won?multiple(p.multiplier):'0×'}</strong>`;
    this.controls();
  }
  private static(p:WheelSpinPresentation){
    this.show(p);this.root.dataset.presentation='static';this.phase('result');
    this.setPayout(Number(p.returnedUnits),Number(p.returnedUnits));this.find('[data-wheel-bigwin]').hidden=Number(p.returnedUnits)<Number(p.stakeUnits)*4;this.controls();
  }
  private selectReceipt(){
    const p=this.shown;if(!p)return;
    this.root.dataset.selectedReceipt=p.outcomeId;const detail=this.find('[data-wheel-detail]');detail.hidden=false;
    detail.textContent=tr`Ставка ${amount(p.stakeUnits)} USDT, цель ${WHEEL_TARGET_NAMES[p.target]}, сектор ${p.sector+1}, выплата ${amount(p.returnedUnits)} USDT. Уже включена в общую сумму.`;
  }
  private count(total:number,live:Live){
    const start=performance.now(),duration=live.motion&&total>0?800:0;
    let timer:ReturnType<typeof setTimeout>;
    const finish=()=>{
      if(!this.valid(live))return;
      clearTimeout(timer);this.timers.delete(timer);cancelAnimationFrame(this.payoutFrame);this.payoutFrame=0;
      this.setPayout(total,total);this.live=undefined;this.root.dataset.animationToken='';this.controls();if(live.accepted)emitGameOutcome(this.root,live.accepted.stakeUnits,live.accepted.returnedUnits);
    };
    const tick=(now:number)=>{
      if(!this.valid(live))return;
      try{
        const progress=duration?Math.max(0,Math.min(1,(now-start)/duration)):1;
        this.setPayout(Math.floor(total*(1-(1-progress)**3)),total);
        if(progress<1)this.payoutFrame=requestAnimationFrame(tick);else finish();
      }catch{finish();}
    };
    timer=setTimeout(finish,duration+250);this.timers.set(timer,()=>{});
    try{this.payoutFrame=requestAnimationFrame(tick);}catch{finish();}
  }
  private setPayout(value:number,target:number){
    const payout=this.find('[data-wheel-payout]');payout.dataset.units=String(value);payout.dataset.targetUnits=String(target);
    this.find('[data-wheel-amount]').textContent=amount(value);
  }
  private delay(ms:number,live:Live){
    return new Promise<boolean>(resolve=>{
      const timer=setTimeout(()=>{this.timers.delete(timer);resolve(this.valid(live));},ms);
      this.timers.set(timer,()=>resolve(false));
    });
  }
  private async retry(){
    if(!this.ownPending()||this.blocked())return;
    const account=client.accountId,epoch=++this.epoch;this.preview=false;this.error='';
    try{await client.retry();}catch(error){if(this.alive&&account===client.accountId&&epoch===this.epoch)this.error=(error as Error).message;}
    this.sync();
  }
  private async refresh(){if(!this.alive)return;try{await client.refresh();}finally{this.sync();}}
  private cancel(){
    const p=this.live?.accepted??this.shown;
    if(this.live)this.preview=false;
    this.audio?.cancel(this.live?.token);this.live=undefined;this.board?.cancel();
    cancelAnimationFrame(this.payoutFrame);this.payoutFrame=0;
    this.timers.forEach(resolve=>resolve());this.timers.forEach((_,timer)=>clearTimeout(timer));this.timers.clear();
    this.root.dataset.animationToken='';this.phase('idle');
    if(p)this.static(p);else{this.board?.show();this.find('[data-wheel-wait]').hidden=true;}
  }
  destroy(){
    this.alive=false;this.epoch++;this.cancel();client.removeEventListener('change',this.change);demoWallet.removeEventListener('change',this.change);
    document.removeEventListener('visibilitychange',this.visibility);this.reduced.removeEventListener('change',this.motionChange);
    this.unsubscribe();this.audio.dispose();this.board.destroy();this.root.remove();
  }
}
