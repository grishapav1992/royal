import { dealerForGame, isCardGame, type CardGameId, type DealerAction } from '../shared/cardTables';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { drawDealer, DEALER_SIZE } from '../game/dealerArt';
import './card-tables.css';

export const CARD_DEALER_EVENT = 'royal-card-dealer';
export type CardDealerSnapshot = {
  gameId: CardGameId; account: string; sessionId: string; phase: number; cards: string;
  active: boolean; busy: boolean; pending: boolean; spentUnits: string; returnedUnits: string;
};
export function emitCardDealer(host: HTMLElement, snapshot: CardDealerSnapshot) {
  host.dispatchEvent(new CustomEvent<CardDealerSnapshot>(CARD_DEALER_EVENT,{detail:snapshot,bubbles:true}));
}
export function emitExpansionDealer(host: HTMLElement, gameId: string, session: ExpansionSession | undefined, account: string | null, busy: boolean, pending: boolean) {
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
  private last?: CardDealerSnapshot;
  private destroyed = false;
  private changed = (event: Event) => this.accept((event as CustomEvent<CardDealerSnapshot>).detail);
  private motionChanged = () => { this.stopFrame(); this.draw(performance.now()); };
  constructor(container: HTMLElement, private gameId: CardGameId, private gameHost: HTMLElement, private onAction: (action: DealerAction)=>void = ()=>{}) {
    const profile=dealerForGame(gameId)!;
    this.root.className='card-dealer-stage';this.root.dataset.cardDealer=gameId;
    this.root.style.setProperty('--dealer-accent',profile.accent);this.root.style.setProperty('--dealer-table',profile.tableColor);
    const caption=document.createElement('div');caption.className='card-dealer-caption';
    const eyebrow=document.createElement('small');eyebrow.textContent='ТВОЙ КРУПЬЕ · ЭТАЖ 3';
    const name=document.createElement('strong');name.textContent=profile.name;
    this.status.className='card-dealer-status';this.status.textContent='Добро пожаловать за стол';
    caption.append(eyebrow,name,this.status);
    this.canvas.width=DEALER_SIZE.width*3;this.canvas.height=DEALER_SIZE.height*3;this.canvas.className='card-dealer-portrait';
    this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label',`Крупье ${profile.name}`);
    const felt=document.createElement('div');felt.className='card-dealer-felt';felt.setAttribute('aria-hidden','true');
    felt.innerHTML='<span>♠</span><span>♥</span><span>♣</span><span>♦</span>';
    this.root.append(felt,this.canvas,caption);container.append(this.root);
    gameHost.addEventListener(CARD_DEALER_EVENT,this.changed);this.media.addEventListener('change',this.motionChanged);
    this.setAction('idle');
  }
  private result(s: CardDealerSnapshot): DealerAction {
    const spent=BigInt(s.spentUnits),returned=BigInt(s.returnedUnits);
    return returned>spent?'win':returned<spent?'lose':'idle';
  }
  private accept(s: CardDealerSnapshot) {
    if(this.destroyed || !s || s.gameId!==this.gameId)return;
    const previous=this.last, sameParty=previous?.account===s.account && previous.sessionId===s.sessionId;
    const changed=!!s.sessionId && (!sameParty || previous?.phase!==s.phase || previous?.cards!==s.cards);
    const resultChanged=!!previous && (previous.active!==s.active || previous.spentUnits!==s.spentUnits || previous.returnedUnits!==s.returnedUnits);
    const freshAccount=!!previous && previous.account!==s.account;
    this.last=s;
    if(s.pending || s.busy) { clearTimeout(this.finish);if(this.action==='deal')this.setAction('idle');this.status.textContent=s.pending?'Проверяем сохранённый ход':'Ожидаем подтверждение';return; }
    const terminal=!s.active && !!s.sessionId;
    const result=terminal?this.result(s):'idle';
    const caption=!s.sessionId?'Добро пожаловать за стол':s.active?'Твой ход, карты на столе':result==='win'?'Поздравляю с выигрышем':result==='lose'?'Раздача завершена':'Ставка возвращена';
    if(changed && previous && !freshAccount) {
      clearTimeout(this.finish);this.setAction('deal');this.status.textContent='Карты розданы';
      this.finish=setTimeout(()=>{if(this.destroyed)return;this.setAction(result);this.status.textContent=caption;},this.media.matches?0:820);
      return;
    }
    if(!previous || freshAccount || !s.sessionId || resultChanged) { clearTimeout(this.finish);this.setAction(result); }
    if(this.action!=='deal')this.status.textContent=caption;
  }
  private stopFrame() { if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined; }
  private setAction(action: DealerAction) {
    this.action=action;this.root.dataset.dealerAction=action;this.onAction(action);this.started=performance.now();this.stopFrame();this.draw(this.started);
  }
  private draw(now: number) {
    if(this.destroyed)return;
    const ctx=this.canvas.getContext('2d')!;ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.save();
    ctx.scale(this.canvas.width/DEALER_SIZE.width,this.canvas.height/DEALER_SIZE.height);
    const frame=this.media.matches?(this.action==='idle'?0:2):Math.floor((now-this.started)/140)%6;
    const profile=dealerForGame(this.gameId)!;
    ctx.save();ctx.beginPath();ctx.rect(0,0,DEALER_SIZE.width,78);ctx.clip();
    drawDealer(ctx,profile,this.action,frame,'body');ctx.restore();
    drawDealer(ctx,profile,this.action,frame,'hands');ctx.restore();
    if(!this.media.matches)this.frame=requestAnimationFrame(time=>this.draw(time));
  }
  destroy() {
    if(this.destroyed)return;this.destroyed=true;clearTimeout(this.finish);this.stopFrame();this.onAction('idle');
    this.gameHost.removeEventListener(CARD_DEALER_EVENT,this.changed);this.media.removeEventListener('change',this.motionChanged);this.root.remove();
  }
}
