import { cardLabel, cardSuit, PVP_GAMES, type PvpCardGameId, type PvpCardMove } from '../shared/pvp';
import type { GameModuleContextV1 } from '../modules/GameHostContract';
import './pvp-cards.css';

const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class CardDuelView {
  private unsubscribe:()=>void;
  private target=0;private mode='';private suit=0;
  private renderKey='';
  constructor(private root:HTMLElement,private id:PvpCardGameId,private context:NonNullable<GameModuleContextV1['pvp']>){
    this.unsubscribe=context.subscribe(()=>this.render());this.render();
  }
  private render(force=false){
    const snapshot=this.context.get(),view=snapshot?.cards,match=snapshot?.active;
    if(!view||view.gameId!==this.id||!match){this.root.innerHTML='<p class="pvp-empty">Стол готов. Партия начнётся после подтверждения обоих игроков.</p>';return;}
    const key=[match.id,view.revision,match.status,this.context.busy()].join(':');if(!force&&this.renderKey===key)return;this.renderKey=key;
    if(!view.table[this.target]||view.table[this.target].defense!==undefined)this.target=Math.max(0,view.table.findIndex(pair=>pair.defense===undefined));
    const busy=this.context.busy(),modes=[...new Set(view.moves.filter(m=>'card'in m).map(m=>m.kind))];
    if(!modes.includes(this.mode as never))this.mode=modes.includes('defend')?'defend':modes[0]??'';
    const labels:Record<string,string>={attack:'Атаковать',defend:'Покрыть',transfer:'Перевести',play:'Сыграть',take:'Взять карты',done:view.collecting?'Завершить подкидывание':'Бито',draw:'Взять из колоды',pass:'Пропустить ход'};
    const actions=view.moves.filter(m=>!('card'in m));
    const allowed=(card:number)=>view.moves.filter(m=>'card'in m&&m.card===card&&m.kind===this.mode);
    const card=(value:number,button=false,enabled=true)=>`<${button?'button type="button"':'span'} class="pvp-card ${cardSuit(value)===1||cardSuit(value)===2?'red':''}" ${button?`data-card="${value}" ${!enabled||busy?'disabled':''}`:''}><b>${escape(cardLabel(value))}</b><span aria-hidden="true">${['♠','♥','♦','♣'][cardSuit(value)]}</span></${button?'button':'span'}>`;
    const otherName=view.self===0?match.opponentName:match.creatorName;
    this.root.innerHTML=`<section class="pvp-card-table" aria-label="${escape(PVP_GAMES[this.id])}">
      <div class="pvp-opponent"><strong>${escape(otherName)}</strong><span>${view.opponentCount} карт</span><div class="pvp-card-backs" aria-label="Закрытые карты соперника">${Array.from({length:Math.min(view.opponentCount,10)},()=>'<span class="pvp-card-back" aria-hidden="true">♛</span>').join('')}</div></div>
      <div class="pvp-play-area"><div class="pvp-deck"><span class="pvp-card-back" aria-hidden="true">♛</span><strong>Колода: ${view.stockCount}</strong>${view.trump!==null?`<span>Козырь ${escape(cardLabel(view.trump))}</span>`:view.gameId!=='crazy-eights'?`<span>Козырь ${['♠','♥','♦','♣'][view.suit]}</span>`:`<span>Масть ${['♠','♥','♦','♣'][view.suit]}</span>`}<small>Отбой: ${view.discardCount}</small></div>
      <div class="pvp-bouts">${view.table.length?view.table.map((pair,index)=>`<button type="button" class="pvp-pair ${this.target===index?'selected':''}" data-target="${index}" aria-label="Выбрать карту ${escape(cardLabel(pair.attack))}" ${busy?'disabled':''}>${card(pair.attack)}${pair.defense!==undefined?card(pair.defense):''}</button>`).join(''):'<span class="pvp-table-mark">ROYAL<br>ДУЭЛЬ</span>'}</div></div>
      <p class="pvp-turn" role="status">${view.phase==='finished'?'Партия завершена':view.actor===view.self?'Твой ход':'Ход соперника'}${view.collecting?' · Соперник берёт карты':''}</p>
      <div class="pvp-move-settings">${modes.length>1?`<label>Действие<select data-mode>${modes.map(mode=>`<option value="${mode}" ${mode===this.mode?'selected':''}>${labels[mode]}</option>`).join('')}</select></label>`:''}${view.gameId==='crazy-eights'?`<label>Масть после восьмёрки<select data-suit>${['♠ Пики','♥ Червы','♦ Бубны','♣ Трефы'].map((name,index)=>`<option value="${index}" ${this.suit===index?'selected':''}>${name}</option>`).join('')}</select></label>`:''}</div>
      <div class="pvp-hand" aria-label="Твои карты">${view.hand.map(value=>card(value,true,allowed(value).length>0)).join('')}</div>
      <div class="pvp-card-actions">${actions.map(move=>`<button type="button" class="primary-button" data-action="${move.kind}" ${busy?'disabled':''}>${labels[move.kind]}</button>`).join('')}</div>
      <details class="pvp-rules"><summary>Правила стола</summary><p>${this.id==='crazy-eights'?'Сбрось все карты первым. Играй в масть или в ранг верхней карты. Восьмёрка меняет масть. За ход можно взять одну карту; если после этого есть допустимая карта, её нужно сыграть. Последняя карта объявляется автоматически.':`Колода 36 карт, по шесть карт в руке. Покрывай старшей картой той же масти или козырем. Подкидывать можно ранги со стола, не больше шести карт и не больше исходного числа карт защитника. После взятия нападающий может подкинуть ещё карты. ${this.id==='transfer-durak'?'Переводить можно только до первого покрытия, картой того же ранга, если у нового защитника хватает карт.':''} Обмена козырной шестёрки нет. Если оба избавились от карт одновременно, ничья.`}</p><p>На ход 60 секунд. При ничьей ставки возвращаются. Комиссия с выигранного банка: 5%.</p></details></section>`;
    this.root.querySelector<HTMLSelectElement>('[data-mode]')?.addEventListener('change',event=>{this.mode=(event.target as HTMLSelectElement).value;this.render(true);});
    this.root.querySelector<HTMLSelectElement>('[data-suit]')?.addEventListener('change',event=>{this.suit=Number((event.target as HTMLSelectElement).value);});
    this.root.querySelectorAll<HTMLButtonElement>('[data-target]').forEach(button=>button.onclick=()=>{this.target=Number(button.dataset.target);this.render(true);});
    this.root.querySelectorAll<HTMLButtonElement>('[data-card]').forEach(button=>button.onclick=()=>{
      const options=allowed(Number(button.dataset.card));
      const move=options.find(m=>m.kind==='play'&&'suit'in m?m.suit===this.suit:'target'in m?m.target===this.target:true);
      if(move)this.context.move(move);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.onclick=()=>{const move=actions.find(m=>m.kind===button.dataset.action);if(move)this.context.move(move);});
  }
  destroy(){this.unsubscribe();this.root.replaceChildren();}
}
