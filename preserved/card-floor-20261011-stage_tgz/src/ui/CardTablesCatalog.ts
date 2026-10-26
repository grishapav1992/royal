import { CARD_GAME_IDS, CARD_GAME_NAMES, dealerForGame, type CardGameId } from '../shared/cardTables';
import { drawDealer, DEALER_SIZE } from '../game/dealerArt';
import './card-tables.css';

export class CardTablesCatalog {
  private root=document.createElement('section');
  constructor(host: HTMLElement, onSelect: (id: CardGameId)=>void) {
    this.root.className='card-tables-catalog';this.root.setAttribute('aria-label','Карточные игры с крупье');
    const header=document.createElement('div');header.className='card-tables-heading';
    const title=document.createElement('strong');title.textContent='За стол к крупье';
    const count=document.createElement('span');count.textContent=String(CARD_GAME_IDS.length)+' стола';header.append(title,count);
    const intro=document.createElement('p');intro.textContent='Карточный этаж · У каждой игры свой крупье';
    const label=document.createElement('label');label.className='card-tables-search';label.textContent='Найти игру или крупье';
    const search=document.createElement('input');search.type='search';search.placeholder='Например: Баккара или Адель';label.append(search);
    const grid=document.createElement('div');grid.className='card-tables-grid';
    for(const id of CARD_GAME_IDS) {
      const profile=dealerForGame(id)!;
      const button=document.createElement('button');button.type='button';button.dataset.cardTable=id;button.className='card-table-card';
      button.setAttribute('aria-label',`${CARD_GAME_NAMES[id]}, крупье ${profile.name}`);button.style.setProperty('--dealer-accent',profile.accent);
      const portrait=document.createElement('canvas');portrait.width=DEALER_SIZE.width*2;portrait.height=DEALER_SIZE.height*2;portrait.className='card-table-portrait';portrait.setAttribute('aria-hidden','true');
      const ctx=portrait.getContext('2d')!;ctx.scale(2,2);drawDealer(ctx,profile,'idle',0);
      const copy=document.createElement('span');copy.className='card-table-copy';
      const name=document.createElement('strong');name.textContent=CARD_GAME_NAMES[id];
      const dealer=document.createElement('small');dealer.textContent='Крупье '+profile.name;
      const arrow=document.createElement('span');arrow.className='card-table-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
      copy.append(name,dealer);button.append(portrait,copy,arrow);button.onclick=()=>onSelect(id);grid.append(button);
    }
    const empty=document.createElement('p');empty.className='card-tables-empty';empty.textContent='Такой игры или крупье пока нет';empty.hidden=true;
    search.oninput=()=>{
      const query=search.value.trim().toLocaleLowerCase('ru-RU');let visible=0;
      grid.querySelectorAll<HTMLButtonElement>('[data-card-table]').forEach(button=>{button.hidden=!button.textContent!.toLocaleLowerCase('ru-RU').includes(query);if(!button.hidden)visible++;});
      count.textContent=String(visible)+(visible===33?' стола':' из 33');empty.hidden=visible!==0;
    };
    this.root.append(header,intro,label,grid,empty);host.append(this.root);
  }
  destroy() { this.root.remove(); }
}
