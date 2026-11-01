import type {GameModuleContextV1} from '../../src/modules/GameHostContract';
import {TSU_E_FA_CHOICES,type TsuEFaChoice} from '../../src/shared/tsuEFa';
import {TSU_DUEL_STAKES,TSU_DUEL_CHANT,TSU_DUEL_BEAT_MS} from '../../src/shared/tsuDuel';
import {formatNileUnits} from '../../src/shared/nileWallet';
import {handScene,handIcon} from './HandArt';
import type {GameAudio} from '../../src/game/GameAudio';
import {TsuSounds} from './TsuSounds';
import {TsuFeedback} from './TsuFeedback';
import './tsu-duel.css';
type Context=NonNullable<GameModuleContextV1['pvp']>;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const labels:Record<TsuEFaChoice,string>={rock:'Камень',scissors:'Ножницы',paper:'Бумага'};
const money=(v:string)=>formatNileUnits(v)+' USDT';
export class TsuDuelUI{
  private root=document.createElement('section');private unsubscribe:()=>void;private frame=0;private stopPreferences:()=>void;
  private sounds:TsuSounds;private feedback:TsuFeedback;private paused=false;private dead=false;
  private key='';private confirm=false;private freshRound=-1;private showThree=false;
  constructor(host:HTMLElement,private context:Context,private sharedAudio:GameAudio){
    this.root.className='td-game';host.replaceChildren(this.root);
    this.sounds=new TsuSounds(sharedAudio,this.root.ownerDocument);this.feedback=new TsuFeedback(this.sounds);
    this.unsubscribe=context.subscribe(()=>this.render());this.stopPreferences=sharedAudio.onPreferences(()=>this.render());
    this.root.addEventListener('pointerdown',this.gesture);this.root.addEventListener('keydown',this.gesture);
    document.addEventListener('visibilitychange',this.visibility);this.render();this.frame=requestAnimationFrame(this.tick);
  }
  private gesture=()=>{void this.sounds.unlock();};
  private visibility=()=>{if(document.hidden)this.sounds.cancel();this.render();};
  private tick=()=>{if(this.dead)return;this.clock();this.frame=requestAnimationFrame(this.tick);};
  private feedbackFrame(){const snapshot=this.context.get(),c=snapshot?.active,s=snapshot?.tsuEFa;return c&&s?this.feedback.update(c,s,this.context.now?.()??Date.now(),performance.now(),!this.paused&&!document.hidden):false;}
  private render(){
    const snapshot=this.context.get(),c=snapshot?.active,s=snapshot?.tsuEFa;if(!c||!s)return;
    if(c.status!=='playing')this.confirm=false;
    const waiting=this.feedbackFrame(),muted=this.sharedAudio.getPreferences().muted;
    const busy=this.context.busy(),key=JSON.stringify([c,s,busy,this.confirm,waiting,muted]);if(key===this.key)return;this.key=key;
    const wasWaiting=this.root.dataset.waiting==='true';this.root.dataset.waiting=String(waiting);
    const self=s.self,other=self===0?1:0,ownId=self===0?c.creatorId:c.opponentId!,peerId=self===0?c.opponentId!:c.creatorId;
    const terms=c.status==='arriving',playing=c.status==='playing',finished=c.status==='finished'||c.status==='cancelled';
    const paused=!!c.disconnected.length,stage=s.duel?.stage??'select',revealed=(stage==='reveal'||finished)&&!waiting;
    const score=this.feedback.score(s.score,performance.now());
    const left=revealed?s.last?.choices[self]??'rock':'rock',right=revealed?s.last?.choices[other]??'rock':'rock';
    const names=[self===0?c.creatorName:c.opponentName,self===0?c.opponentName:c.creatorName];
    const ready=c.ready.includes(ownId),peerReady=c.ready.includes(peerId);
    const disabled=busy||paused||!playing||stage!=='select'||s.locked[self];
    const fresh=this.freshRound>=0&&!!s.last&&s.last.round>this.freshRound&&document.visibilityState==='visible';
    this.freshRound=s.last?.round??Math.max(0,this.freshRound);this.showThree=stage==='reveal'&&(this.showThree||fresh);
    const result=waiting?'Оба знака закрыты. Раскрываем на «три».':finished?c.winnerId===null?c.reason==='cancel'?'Подготовка отменена. Деньги не списаны.':'Матч отменён. Ставки возвращены.':c.winnerId===ownId?`Ты победил! Начислено ${money(c.payoutUnits)}.`:'Соперник выиграл матч.'
      :terms?'Согласуйте ставку и оба нажмите «Готово».':stage==='reveal'?(s.last?.winner===null?'Ничья. Повторяем раунд.':s.last?.winner===self?'Твоё очко!':'Очко соперника.')
      :stage==='countdown'?'Оба знака закрыты. Раскрываем на «три».':s.locked[self]?'Твой знак закрыт. Ждём выбор соперника.':'Выбери знак втайне от соперника.';
    const focus=(this.root.querySelector(':focus')as HTMLElement|null)?.dataset.choice;
    const beatDelay=s.duel?Math.max(0,(this.context.now?.()??Date.now())-s.duel.startsAt)%TSU_DUEL_BEAT_MS:0;
    this.root.innerHTML=`<header class="td-heading"><span title="${esc(names[0])}">ТЫ</span><div><h2>Цу-е-фа</h2><small>До ${s.target} побед · Раунд ${stage==='reveal'&&s.last?s.last.round:s.round}</small></div><strong class="td-score">${score[self]} : ${score[other]}</strong><span title="${esc(names[1])}">СОПЕРНИК</span></header>
      <div class="td-stage ${(fresh&&!waiting||wasWaiting&&!waiting)?'td-new-result':''}" style="--td-beat-delay:-${beatDelay}ms" data-stage="${terms?'terms':stage}" data-paused="${paused}">${handScene(left,right)}<div class="td-chant" aria-live="polite" data-chant></div>${paused?'<div class="td-pause" role="status"><strong>Пауза · игрок потерял связь</strong><span data-reconnect></span><small>Счёт и закрытые знаки сохранены.</small></div>':''}</div>
      <p class="td-status" role="status">${esc(result)}</p>
      ${terms?`<div class="td-terms"><label>Ставка с каждого<select data-stake ${busy||paused?'disabled':''}>${TSU_DUEL_STAKES.map(v=>`<option value="${v}" ${v===c.stakeUnits?'selected':''}>${money(v)}</option>`).join('')}</select></label><div class="td-pot">Банк <b>${money(c.potUnits)}</b><br>Победителю <b>${money(c.payoutUnits)}</b><small>Комиссия ${money(c.feeUnits)} (5%). Одна ставка на весь матч.</small></div><div class="td-readiness"><button data-ready ${busy||paused?'disabled':''}>${ready?'Снять готовность':'Готово'}</button><span data-peer-ready>${peerReady?'Соперник готов ✓':'Соперник выбирает условия'}</span></div><small class="td-consent">${ready?'Ты подтвердил эту ставку. Изменение суммы снимает готовность у обоих.':'Списание произойдёт после двух подтверждений «Готово».'}</small></div>`:''}
      ${playing?`<div class="td-choices" role="group" aria-label="Выбери знак">${TSU_E_FA_CHOICES.map(choice=>`<button data-choice="${choice}" aria-pressed="${s.choice===choice}" ${disabled?'disabled':''}>${handIcon(choice)}<span>${labels[choice]}</span></button>`).join('')}</div><div class="td-round-meta"><span data-select-clock></span><span>${s.locked[other]?'Соперник выбрал знак':'Соперник выбирает'}</span></div>`:''}
      <footer class="td-footer"><span>${esc(names[0])} · ${esc(names[1])}</span><div class="td-footer-actions"><button data-sound aria-label="${muted?'Включить звук':'Выключить звук'}" aria-pressed="${!muted}" title="Общий звук Royal">${muted?'♪ Выкл.':'♫ Звук'}</button>${!finished?`<button data-exit>${playing?'Сдаться':'Отказаться'}</button>`:''}</div></footer>
      ${this.confirm?'<div class="td-confirm" role="alertdialog" aria-label="Подтвердить сдачу"><strong>Сдаться в этом матче?</strong><p>Победа и банк за вычетом комиссии достанутся сопернику.</p><button data-confirm-exit>Да, сдаться</button><button data-continue>Продолжить играть</button></div>':''}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(b=>b.onclick=()=>this.context.move({kind:'choose',round:s.round,choice:b.dataset.choice as TsuEFaChoice}));
    const stake=this.root.querySelector<HTMLSelectElement>('[data-stake]');if(stake)stake.onchange=()=>this.context.terms?.(stake.value,c.termsRevision??0);
    const readyButton=this.root.querySelector<HTMLButtonElement>('[data-ready]');if(readyButton)readyButton.onclick=()=>this.context.ready?.(c.termsRevision??0,!ready);
    const exit=this.root.querySelector<HTMLButtonElement>('[data-exit]');if(exit)exit.onclick=()=>{if(playing){this.confirm=true;this.render();}else this.context.cancel?.();};
    const confirm=this.root.querySelector<HTMLButtonElement>('[data-confirm-exit]');if(confirm)confirm.onclick=()=>{this.confirm=false;this.context.cancel?.();this.render();};
    const back=this.root.querySelector<HTMLButtonElement>('[data-continue]');if(back)back.onclick=()=>{this.confirm=false;this.render();};
    this.root.querySelector<HTMLButtonElement>('[data-sound]')!.onclick=()=>{this.sharedAudio.setMuted(!this.sharedAudio.getPreferences().muted);void this.sounds.unlock();};
    if(focus)this.root.querySelector<HTMLButtonElement>(`[data-choice="${focus}"]:not(:disabled)`)?.focus({preventScroll:true});
    this.clock();
  }
  private clock(){
    const waiting=this.feedbackFrame();if(String(waiting)!==this.root.dataset.waiting){this.render();return;}
    const snapshot=this.context.get(),c=snapshot?.active,s=snapshot?.tsuEFa;if(!c||!s)return;const now=this.context.now?.()??Date.now();
    const chant=this.root.querySelector('[data-chant]');if(chant){
      const text=c.status==='playing'&&!s.duel?.paused&&s.duel?.stage==='countdown'?TSU_DUEL_CHANT[Math.min(4,Math.max(0,Math.floor((now-s.duel.startsAt)/TSU_DUEL_BEAT_MS)))]:this.showThree&&!s.duel?.paused&&!waiting?'Три!':'';
      if(chant.textContent!==text)chant.textContent=text;
    }
    const reconnect=this.root.querySelector('[data-reconnect]');if(reconnect)reconnect.textContent='На возвращение: '+Math.max(0,Math.ceil((Math.min(...c.disconnected.map(p=>p.until))-now)/1000))+' сек.';
    const select=this.root.querySelector('[data-select-clock]');if(select)select.textContent=s.duel?.stage==='select'&&!s.duel.paused?'На выбор: '+Math.max(0,Math.ceil((s.duel.endsAt-now)/1000))+' сек.':'';
  }
  pause(){this.paused=true;this.sounds.setAllowed(false);this.render();}
  resume(){this.paused=false;this.sounds.setAllowed(true);this.render();}
  getState(){return {gameId:'tsu-e-fa',audio:this.sounds.getState(),paused:this.paused,disposed:this.dead};}
  destroy(){this.dead=true;cancelAnimationFrame(this.frame);this.unsubscribe();this.stopPreferences();this.sounds.destroy();document.removeEventListener('visibilitychange',this.visibility);this.root.removeEventListener('pointerdown',this.gesture);this.root.removeEventListener('keydown',this.gesture);this.root.remove();}
}
