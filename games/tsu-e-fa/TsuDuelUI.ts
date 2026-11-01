import type {GameModuleContextV1} from '../../src/modules/GameHostContract';
import {TSU_E_FA_CHOICES,type TsuEFaChoice} from '../../src/shared/tsuEFa';
import {TSU_DUEL_STAKES,TSU_DUEL_CHANT,TSU_DUEL_BEAT_MS} from '../../src/shared/tsuDuel';
import {formatNileUnits} from '../../src/shared/nileWallet';
import {handScene,handIcon} from './HandArt';
import './tsu-duel.css';
type Context=NonNullable<GameModuleContextV1['pvp']>;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const labels:Record<TsuEFaChoice,string>={rock:'Камень',scissors:'Ножницы',paper:'Бумага'};
const money=(v:string)=>formatNileUnits(v)+' USDT';
export class TsuDuelUI{
  private root=document.createElement('section');private unsubscribe:()=>void;private timer:ReturnType<typeof setInterval>;
  private key='';private confirm=false;private freshRound=-1;private showThree=false;
  constructor(host:HTMLElement,private context:Context){
    this.root.className='td-game';host.replaceChildren(this.root);this.unsubscribe=context.subscribe(()=>this.render());
    this.timer=setInterval(()=>this.clock(),100);this.render();
  }
  private render(){
    const snapshot=this.context.get(),c=snapshot?.active,s=snapshot?.tsuEFa;if(!c||!s)return;
    const busy=this.context.busy(),key=JSON.stringify([c,s,busy,this.confirm]);if(key===this.key){this.clock();return;}this.key=key;
    const self=s.self,other=self===0?1:0,ownId=self===0?c.creatorId:c.opponentId!,peerId=self===0?c.opponentId!:c.creatorId;
    const terms=c.status==='arriving',playing=c.status==='playing',finished=c.status==='finished'||c.status==='cancelled';
    const paused=!!c.disconnected.length,stage=s.duel?.stage??'select',revealed=stage==='reveal'||finished;
    const left=revealed?s.last?.choices[self]??'rock':'rock',right=revealed?s.last?.choices[other]??'rock':'rock';
    const names=[self===0?c.creatorName:c.opponentName,self===0?c.opponentName:c.creatorName];
    const ready=c.ready.includes(ownId),peerReady=c.ready.includes(peerId);
    const disabled=busy||paused||!playing||stage!=='select'||s.locked[self];
    const fresh=this.freshRound>=0&&!!s.last&&s.last.round>this.freshRound&&document.visibilityState==='visible';
    this.freshRound=s.last?.round??Math.max(0,this.freshRound);this.showThree=stage==='reveal'&&(this.showThree||fresh);
    const result=finished?c.winnerId===null?c.reason==='cancel'?'Подготовка отменена. Деньги не списаны.':'Матч отменён. Ставки возвращены.':c.winnerId===ownId?`Ты победил! Начислено ${money(c.payoutUnits)}.`:'Соперник выиграл матч.'
      :terms?'Согласуйте ставку и оба нажмите «Готово».':stage==='reveal'?(s.last?.winner===null?'Ничья. Повторяем раунд.':s.last?.winner===self?'Твоё очко!':'Очко соперника.')
      :stage==='countdown'?'Оба знака закрыты. Раскрываем на «три».':s.locked[self]?'Твой знак закрыт. Ждём выбор соперника.':'Выбери знак втайне от соперника.';
    const focus=(this.root.querySelector(':focus')as HTMLElement|null)?.dataset.choice;
    this.root.innerHTML=`<header class="td-heading"><span title="${esc(names[0])}">ТЫ</span><div><h2>Цу-е-фа</h2><small>До 3 побед · Раунд ${stage==='reveal'&&s.last?s.last.round:s.round}</small></div><strong class="td-score">${s.score[self]} : ${s.score[other]}</strong><span title="${esc(names[1])}">СОПЕРНИК</span></header>
      <div class="td-stage ${fresh?'td-new-result':''}" data-stage="${terms?'terms':stage}" data-paused="${paused}">${handScene(left,right)}<div class="td-chant" aria-live="polite" data-chant></div>${paused?'<div class="td-pause" role="status"><strong>Пауза · игрок потерял связь</strong><span data-reconnect></span><small>Счёт и закрытые знаки сохранены.</small></div>':''}</div>
      <p class="td-status" role="status">${esc(result)}</p>
      ${terms?`<div class="td-terms"><label>Ставка с каждого<select data-stake ${busy||paused?'disabled':''}>${TSU_DUEL_STAKES.map(v=>`<option value="${v}" ${v===c.stakeUnits?'selected':''}>${money(v)}</option>`).join('')}</select></label><div class="td-pot">Банк <b>${money(c.potUnits)}</b><br>Победителю <b>${money(c.payoutUnits)}</b><small>Комиссия ${money(c.feeUnits)} (5%). Одна ставка на весь матч.</small></div><div class="td-readiness"><button data-ready ${busy||paused?'disabled':''}>${ready?'Снять готовность':'Готово'}</button><span data-peer-ready>${peerReady?'Соперник готов ✓':'Соперник выбирает условия'}</span></div><small class="td-consent">${ready?'Ты подтвердил эту ставку. Изменение суммы снимает готовность у обоих.':'Списание произойдёт после двух подтверждений «Готово».'}</small></div>`:''}
      ${playing?`<div class="td-choices" role="group" aria-label="Выбери знак">${TSU_E_FA_CHOICES.map(choice=>`<button data-choice="${choice}" aria-pressed="${s.choice===choice}" ${disabled?'disabled':''}>${handIcon(choice)}<span>${labels[choice]}</span></button>`).join('')}</div><div class="td-round-meta"><span data-select-clock></span><span>${s.locked[other]?'Соперник выбрал знак':'Соперник выбирает'}</span></div>`:''}
      <footer class="td-footer"><span>${esc(names[0])} · ${esc(names[1])}</span>${!finished?`<button data-exit>${playing?'Сдаться':'Отказаться'}</button>`:''}</footer>
      ${this.confirm?'<div class="td-confirm" role="alertdialog" aria-label="Подтвердить сдачу"><strong>Сдаться в этом матче?</strong><p>Победа и банк за вычетом комиссии достанутся сопернику.</p><button data-confirm-exit>Да, сдаться</button><button data-continue>Продолжить играть</button></div>':''}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(b=>b.onclick=()=>this.context.move({kind:'choose',round:s.round,choice:b.dataset.choice as TsuEFaChoice}));
    const stake=this.root.querySelector<HTMLSelectElement>('[data-stake]');if(stake)stake.onchange=()=>this.context.terms?.(stake.value,c.termsRevision??0);
    const readyButton=this.root.querySelector<HTMLButtonElement>('[data-ready]');if(readyButton)readyButton.onclick=()=>this.context.ready?.(c.termsRevision??0,!ready);
    const exit=this.root.querySelector<HTMLButtonElement>('[data-exit]');if(exit)exit.onclick=()=>{if(playing){this.confirm=true;this.render();}else this.context.cancel?.();};
    const confirm=this.root.querySelector<HTMLButtonElement>('[data-confirm-exit]');if(confirm)confirm.onclick=()=>{this.confirm=false;this.context.cancel?.();this.render();};
    const back=this.root.querySelector<HTMLButtonElement>('[data-continue]');if(back)back.onclick=()=>{this.confirm=false;this.render();};
    if(focus)this.root.querySelector<HTMLButtonElement>(`[data-choice="${focus}"]:not(:disabled)`)?.focus({preventScroll:true});
    this.clock();
  }
  private clock(){
    const snapshot=this.context.get(),c=snapshot?.active,s=snapshot?.tsuEFa;if(!c||!s)return;const now=this.context.now?.()??Date.now();
    const chant=this.root.querySelector('[data-chant]');if(chant){
      const text=c.status==='playing'&&!s.duel?.paused&&s.duel?.stage==='countdown'?TSU_DUEL_CHANT[Math.min(4,Math.max(0,Math.floor((now-s.duel.startsAt)/TSU_DUEL_BEAT_MS)))]:this.showThree&&!s.duel?.paused?'Три!':'';
      if(chant.textContent!==text)chant.textContent=text;
    }
    const reconnect=this.root.querySelector('[data-reconnect]');if(reconnect)reconnect.textContent='На возвращение: '+Math.max(0,Math.ceil((Math.min(...c.disconnected.map(p=>p.until))-now)/1000))+' сек.';
    const select=this.root.querySelector('[data-select-clock]');if(select)select.textContent=s.duel?.stage==='select'&&!s.duel.paused?'На выбор: '+Math.max(0,Math.ceil((s.duel.endsAt-now)/1000))+' сек.':'';
  }
  destroy(){clearInterval(this.timer);this.unsubscribe();this.root.remove();}
}
