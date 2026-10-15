import { observeGameOutcome, observeExpansionOutcome } from './gameReactions';
import { dealerForGame, isCardGame, type CardGameId, type DealerAction } from '../shared/cardTables';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { drawDealerHands, DEALER_HANDS_SIZE, DEALER_RELEASE, DEALER_CARD_WIDTH } from '../game/dealerHandsArt';
import './card-tables.css';

export const CARD_DEALER_EVENT = 'royal-card-dealer';
export type CardDealerSnapshot = {
  gameId: CardGameId; account: string; sessionId: string; phase: number; cards: string;
  active: boolean; busy: boolean; pending: boolean; spentUnits: string; returnedUnits: string;
};
const TABLE_CARDS='.github-card,.expansion-card,.expansion-back,.casino-card,.next-playing-card,.batch-card';
type TableCard={element:HTMLElement;key:string;face:string};
const HAND_CYCLE_MS=460;
const CARD_FLIGHT_MS=300;
export function emitCardDealer(host: HTMLElement, snapshot: CardDealerSnapshot) {
  observeGameOutcome(host, snapshot);
  host.dispatchEvent(new CustomEvent<CardDealerSnapshot>(CARD_DEALER_EVENT,{detail:snapshot,bubbles:true}));
}
export function emitExpansionDealer(host: HTMLElement, gameId: string, session: ExpansionSession | undefined, account: string | null, busy: boolean, pending: boolean) {
  observeExpansionOutcome(host, gameId, session, account, busy, pending);
  if (!isCardGame(gameId)) return;
  const view = session?.view;
  emitCardDealer(host,{gameId,account:account??'',sessionId:session?.id??'',phase:view?.phase??0,
    cards:JSON.stringify([view?.player,view?.dealer,view?.community,view?.hands?.map(h=>h.cards),view?.variant]),
    active:session?.state==='active',busy,pending,spentUnits:session?.spentUnits??'0',returnedUnits:session?.returnedUnits??'0'});
}

/** This display only observes confirmed parties. It never sends a game action. */
export class CardDealerStage {
  private root = document.createElement('section');
  private canvas = document.createElement('canvas');
  private status = document.createElement('span');
  private media = window.matchMedia('(prefers-reduced-motion: reduce)');
  private frame?: number;
  private finish?: ReturnType<typeof setTimeout>;
  private action: DealerAction = 'idle';
  private started = 0;
  private handDeals = 1;
  private last?: CardDealerSnapshot;
  private confirmed?: CardDealerSnapshot;
  private cardFaces = new Map<string,string>();
  private cardAnimations = new Set<Animation>();
  private cardFrame?: number;
  private destroyed = false;
  private layoutObserver = new MutationObserver(() => this.layoutHands());
  private changed = (event: Event) => this.accept((event as CustomEvent<CardDealerSnapshot>).detail);
  private motionChanged = () => {
    if(!this.media.matches)return;
    clearTimeout(this.finish);this.stopCardAnimations();this.stopFrame();
    const snapshot=this.confirmed;
    const result=snapshot&&!snapshot.active&&snapshot.sessionId?this.result(snapshot):'idle';
    this.setAction(result);this.status.textContent=snapshot?this.caption(snapshot,result):'Добро пожаловать за стол';
  };
  constructor(container: HTMLElement, private gameId: CardGameId, private gameHost: HTMLElement, private onAction: (action: DealerAction)=>void = ()=>{}) {
    const profile=dealerForGame(gameId)!;
    this.root.className='card-dealer-stage';this.root.dataset.cardDealer=gameId;this.root.dataset.dealerView='overhead';
    this.root.style.setProperty('--dealer-accent',profile.accent);this.root.style.setProperty('--dealer-table',profile.tableColor);
    const dialog=container.closest<HTMLElement>('.mini-dialog');
    dialog?.style.setProperty('--card-felt','#305b50');
    dialog?.style.setProperty('--card-accent','#ead19c');
    gameHost.dataset.cardGame=gameId;
    const caption=document.createElement('div');caption.className='card-dealer-caption';
    const eyebrow=document.createElement('small');eyebrow.textContent='КРУПЬЕ';
    const name=document.createElement('strong');name.textContent=profile.name;
    this.status.className='card-dealer-status';this.status.setAttribute('role','status');this.status.textContent='Добро пожаловать за стол';
    caption.append(eyebrow,name,this.status);
    this.canvas.width=DEALER_HANDS_SIZE.width*2;this.canvas.height=DEALER_HANDS_SIZE.height*2;this.canvas.className='card-dealer-hands';
    this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label',`Руки крупье ${profile.name}, вид сверху`);
    this.root.append(this.canvas,caption);container.append(this.root);
    gameHost.addEventListener(CARD_DEALER_EVENT,this.changed);this.media.addEventListener('change',this.motionChanged);
    this.layoutObserver.observe(gameHost,{childList:true,subtree:true});this.layoutHands();
    this.setAction('idle');
  }
  private layoutHands() {
    const board=this.gameHost.querySelector<HTMLElement>('.expansion-board');
    if(!board)return;
    const hands=Array.from(board.querySelectorAll<HTMLElement>(':scope > .expansion-hand'));
    for(const hand of hands){
      const label=hand.querySelector(':scope > span')?.textContent?.trim()??'';
      hand.dataset.tableZone=label==='Дилер'||label==='Тигр'?'dealer':label==='Общие / новые карты'||label==='Младшая рука'||label==='Карта-ориентир'?'community':'player';
      hand.style.setProperty('--hand-count',String(Math.max(1,hand.querySelector(':scope > div')?.children.length??1)));
    }
    board.dataset.playerHands=String(hands.filter(hand=>hand.dataset.tableZone==='player').length);
  }
  private result(s: CardDealerSnapshot): DealerAction {
    const spent=BigInt(s.spentUnits),returned=BigInt(s.returnedUnits);
    return returned>spent?'win':returned<spent?'lose':'idle';
  }
  private caption(s: CardDealerSnapshot, result: DealerAction) {
    return !s.sessionId?'Добро пожаловать за стол':s.active?'Твой ход, карты на столе':result==='win'?'Поздравляю с выигрышем':result==='lose'?'Раздача завершена':'Ставка возвращена';
  }
  private tableCards(): TableCard[] {
    const groups=new Map<HTMLElement,string>();
    return Array.from(this.gameHost.querySelectorAll<HTMLElement>(TABLE_CARDS))
      .filter(element=>!element.closest('.game-window-sheet'))
      .map(element=>{
        const group=element.closest<HTMLElement>('.github-cards,.expansion-hand,.casino-cards,.next-color-step,.next-war-front,.next-duel-cards,.batch-three-cards')??element.parentElement!;
        let groupKey=groups.get(group);
        if(!groupKey){
          const kind=Array.from(group.classList).find(name=>name!=='active-hand')??group.tagName;
          const label=group.matches('.expansion-hand')?group.querySelector(':scope > span')?.textContent:group.matches('.github-cards')?group.previousElementSibling?.textContent:'';
          const stableLabel=label?.split(' · ')[0]?.trim();
          const ordinal=Array.from(this.gameHost.querySelectorAll(`.${kind}`)).indexOf(group);
          groupKey=kind+':'+(stableLabel||ordinal);groups.set(group,groupKey);
        }
        const index=Array.from(group.querySelectorAll(TABLE_CARDS)).indexOf(element);
        const image=element.querySelector('img');
        const face=image?.getAttribute('src')??(element.matches('.back,.expansion-back')?'back':[
          element.querySelector(':scope > b')?.textContent,element.querySelector(':scope > span')?.textContent,
        ].join(':'));
        return {element,key:groupKey+':'+index,face};
      });
  }
  private stopCardAnimations() {
    if(this.cardFrame!==undefined)cancelAnimationFrame(this.cardFrame);this.cardFrame=undefined;
    for(const animation of this.cardAnimations)animation.cancel();this.cardAnimations.clear();
  }
  private dealCards(cards: TableCard[], snapshot: CardDealerSnapshot, result: DealerAction, caption: string) {
    this.stopCardAnimations();
    if(this.media.matches||!cards.length) { this.setAction(result);this.status.textContent=caption;return; }
    this.cardFrame=requestAnimationFrame(()=>{
      this.cardFrame=undefined;
      if(this.destroyed||this.media.matches||this.last?.account!==snapshot.account||this.last.sessionId!==snapshot.sessionId||this.last.pending||this.last.busy)return;
      const dealer=this.canvas.getBoundingClientRect();
      if(!dealer.width||!dealer.height)return;
      const currentCards=new Map(this.tableCards().map(card=>[card.key,card]));
      this.handDeals=cards.length;this.setAction('deal');this.status.textContent='Крупье раздаёт карты';
      let dealt=0;
      for(const card of cards){
        const current=currentCards.get(card.key);
        if(!current||current.face!==card.face)continue;
        const element=current.element;
        const target=element.getBoundingClientRect();
        if(!target.width||!target.height)continue;
        const style=getComputedStyle(element),resting=style.transform;
        const matrix=new DOMMatrixReadOnly(resting==='none'?undefined:resting);
        const width=element.offsetWidth,height=element.offsetHeight;
        const [originX=width/2,originY=height/2]=style.transformOrigin.split(' ').map(Number.parseFloat);
        const center=matrix.transformPoint(new DOMPoint(width/2-originX,height/2-originY));
        const shiftX=center.x+originX-width/2,shiftY=center.y+originY-height/2;
        const x=dealer.left+dealer.width*DEALER_RELEASE.x/DEALER_HANDS_SIZE.width-target.left-target.width/2+shiftX;
        const y=dealer.top+dealer.height*DEALER_RELEASE.y/DEALER_HANDS_SIZE.height-target.top-target.height/2+shiftY;
        const startScale=DEALER_CARD_WIDTH*dealer.width/DEALER_HANDS_SIZE.width/width;
        const destination=resting==='none'?'none':`matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${shiftX},${shiftY})`;
        element.classList.add('card-being-dealt');
        const animation=element.animate([
          {transform:`translate(${x}px,${y}px) rotate(${DEALER_RELEASE.angle}rad) scale(${startScale})`,transformOrigin:'50% 50%',opacity:0,offset:0},
          {transform:`translate(${x}px,${y}px) rotate(${DEALER_RELEASE.angle}rad) scale(${startScale})`,transformOrigin:'50% 50%',opacity:1,offset:.01},
          {transform:destination,transformOrigin:'50% 50%',opacity:1,offset:1},
        ],{duration:CARD_FLIGHT_MS,delay:dealt++*HAND_CYCLE_MS+HAND_CYCLE_MS*DEALER_RELEASE.phase,easing:'cubic-bezier(.18,.72,.24,1)',fill:'backwards'});
        this.cardAnimations.add(animation);
        const cleanup=()=>{element.classList.remove('card-being-dealt');this.cardAnimations.delete(animation);};
        animation.onfinish=cleanup;animation.oncancel=cleanup;
      }
      if(dealt) {
        this.handDeals=dealt;
        this.finish=setTimeout(()=>{if(this.destroyed)return;this.setAction(result);this.status.textContent=caption;},(dealt-1)*HAND_CYCLE_MS+HAND_CYCLE_MS*DEALER_RELEASE.phase+CARD_FLIGHT_MS);
      } else { this.setAction(result);this.status.textContent=caption; }
    });
  }
  private accept(s: CardDealerSnapshot) {
    if(this.destroyed || !s || s.gameId!==this.gameId)return;
    const previous=this.last;
    const resultChanged=!!previous && (previous.active!==s.active || previous.spentUnits!==s.spentUnits || previous.returnedUnits!==s.returnedUnits);
    const freshAccount=!!previous && previous.account!==s.account;
    this.last=s;
    if(freshAccount){this.stopCardAnimations();this.confirmed=undefined;this.cardFaces.clear();}
    if(s.pending || s.busy) { this.stopCardAnimations();clearTimeout(this.finish);if(this.action==='deal')this.setAction('idle');this.status.textContent=s.pending?'Проверяем сохранённый ход':'Ожидаем подтверждение';return; }
    const confirmed=this.confirmed;
    const cards=this.tableCards(),newRound=!!confirmed&&confirmed.sessionId!==s.sessionId;
    const newCards=cards.filter(card=>card.face!=='back'&&!card.face.includes('cardBack')&&(newRound||this.cardFaces.get(card.key)!==card.face));
    const confirmedChange=!!s.sessionId&&!!confirmed&&confirmed.account===s.account&&(confirmed.sessionId!==s.sessionId||confirmed.phase!==s.phase||confirmed.cards!==s.cards);
    this.confirmed=s;this.cardFaces=new Map(cards.map(card=>[card.key,card.face]));
    const terminal=!s.active && !!s.sessionId;
    const result=terminal?this.result(s):'idle';
    const caption=this.caption(s,result);
    if(confirmedChange && newCards.length && !freshAccount) {
      clearTimeout(this.finish);this.dealCards(newCards,s,result,caption);
      return;
    }
    if(!previous || freshAccount || !s.sessionId || resultChanged || confirmedChange) { clearTimeout(this.finish);this.setAction(result); }
    if(this.action!=='deal')this.status.textContent=caption;
  }
  private stopFrame() { if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined; }
  private setAction(action: DealerAction) {
    this.action=action;this.root.dataset.dealerAction=action;this.onAction(action);this.started=performance.now();this.stopFrame();this.draw(this.started);
  }
  private draw(now: number) {
    if(this.destroyed)return;
    const ctx=this.canvas.getContext('2d')!;ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.save();
    ctx.scale(this.canvas.width/DEALER_HANDS_SIZE.width,this.canvas.height/DEALER_HANDS_SIZE.height);
    const elapsed=Math.max(0,now-this.started);
    const progress=this.media.matches?0:this.action==='deal'?Math.min(1,(elapsed%HAND_CYCLE_MS)/HAND_CYCLE_MS):Math.min(1,elapsed/650);
    const profile=dealerForGame(this.gameId)!;
    drawDealerHands(ctx,profile,this.action,progress);ctx.restore();
    if(!this.media.matches && (this.action==='deal'&&elapsed<this.handDeals*HAND_CYCLE_MS||this.action!=='idle'&&this.action!=='deal'&&elapsed<650))this.frame=requestAnimationFrame(time=>this.draw(time));
  }
  destroy() {
    if(this.destroyed)return;this.destroyed=true;clearTimeout(this.finish);this.stopCardAnimations();this.stopFrame();this.onAction('idle');
    this.layoutObserver.disconnect();
    if(this.gameHost.dataset.cardGame===this.gameId)delete this.gameHost.dataset.cardGame;
    this.gameHost.removeEventListener(CARD_DEALER_EVENT,this.changed);this.media.removeEventListener('change',this.motionChanged);this.root.remove();
  }
}
