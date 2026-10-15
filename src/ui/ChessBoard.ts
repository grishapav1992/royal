import type { ChessState } from '../shared/activities';
import { chessPiece } from './ChessPieces';
const names:Record<string,string>={k:'Король',q:'Ферзь',r:'Ладья',b:'Слон',n:'Конь',p:'Пешка'};
export class ChessBoard {
  readonly element=document.createElement('div');
  private board=document.createElement('div');
  private promotion=document.createElement('div');
  private resign=document.createElement('button');
  private clocks=document.createElement('div');
  private receivedAt=0;
  private selected='';
  private pending:{from:string;to:string}|null=null;
  private state?:ChessState;
  private self='';
  constructor(private send:(value:unknown)=>void){
    this.element.id='chess-game';this.board.className='chess-board';this.board.setAttribute('aria-label','Шахматная доска');
    this.clocks.className='chess-clocks';this.clocks.setAttribute('aria-label','Шахматные часы');
    for(const color of ['w','b']){const clock=document.createElement('div');clock.className='chess-clock';clock.dataset.color=color;const label=document.createElement('span');label.textContent=color==='w'?'Белые':'Чёрные';const time=document.createElement('strong');time.textContent='15:00';clock.append(label,time);this.clocks.append(clock);}
    this.promotion.className='chess-promotion';this.promotion.hidden=true;
    const title=document.createElement('span');title.textContent='Превратить пешку:';this.promotion.append(title);
    for(const type of ['q','r','b','n']){const b=document.createElement('button');b.type='button';b.append(chessPiece(type,'w','promotion-'+type));b.setAttribute('aria-label',names[type]);b.onclick=()=>{if(this.pending)this.send({type:'chess-move',...this.pending,promotion:type});this.clear();};this.promotion.append(b);}
    this.resign.type='button';this.resign.className='invite-button';this.resign.textContent='Сдаться';this.resign.onclick=()=>this.send({type:'chess-resign'});
    this.element.append(this.clocks,this.board,this.promotion,this.resign);
  }
  clear(){this.selected='';this.pending=null;this.promotion.hidden=true;this.render();}
  update(state:ChessState,self:string){const changed=this.state?.revision!==state.revision||this.self!==self;if(this.state?.clock!==state.clock)this.receivedAt=performance.now();this.state=state;this.self=self;this.drawClocks(performance.now());if(changed)this.clear();}
  drawClocks(time:number){
    const s=this.state;if(!s)return;
    this.clocks.querySelectorAll<HTMLElement>('.chess-clock').forEach((el,i)=>{
      const running=s.phase==='playing'&&s.clock.running===el.dataset.color;
      const ms=Math.max(0,s.clock.remainingMs[i]-(running?Math.max(0,time-this.receivedAt):0)),seconds=Math.ceil(ms/1000);
      el.querySelector('strong')!.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
      el.classList.toggle('running',running);el.classList.toggle('low-time',ms<=60000);
      el.setAttribute('aria-label',(i===0?'Белые':'Чёрные')+': '+Math.floor(seconds/60)+' мин '+seconds%60+' сек'+(running?', время идёт':''));
    });
  }
  private render(){
    const s=this.state;if(!s)return;
    const side=s.players.indexOf(this.self),own=s.phase==='playing'&&s.players[s.turn==='w'?0:1]===this.self;
    this.resign.hidden=side<0||s.phase!=='playing';
    const focus=this.board.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset.square:undefined;
    this.board.replaceChildren();
    const files=side===1?'hgfedcba':'abcdefgh',ranks=side===1?'12345678':'87654321';
    for(const rank of ranks)for(const file of files){
      const square=file+rank,p=s.board.find(p=>p.square===square),target=s.moves.some(m=>m.from===this.selected&&m.to===square);
      const b=document.createElement('button');b.type='button';b.dataset.square=square;
      b.className='chess-square '+((file.charCodeAt(0)+Number(rank))%2?'light':'dark')+(p?' piece-'+p.color:'')+(square===this.selected?' selected':'')+(target?' legal':'')+(s.last&&(square===s.last.from||square===s.last.to)?' last-move':'')+(s.check&&p?.type==='k'&&p.color===s.turn?' in-check':'');
      b.setAttribute('aria-label',square+(p?` ${p.color==='w'?'Белые':'Чёрные'} ${names[p.type]}`:' пусто'));b.setAttribute('aria-pressed',String(square===this.selected));b.disabled=!own;
      if(p)b.append(chessPiece(p.type,p.color,square));
      const label=document.createElement('small');label.textContent=square;b.append(label);
      b.onclick=()=>{
        if(!own||this.pending)return;
        const moves=s.moves.filter(m=>m.from===this.selected&&m.to===square);
        if(moves.length){
          if(moves.some(m=>m.promotion)){this.pending={from:this.selected,to:square};this.promotion.hidden=false;this.promotion.querySelector('button')?.focus();}
          else {this.send({type:'chess-move',from:this.selected,to:square});this.clear();}
        }else{this.selected=p?.color===s.turn&&this.selected!==square?square:'';this.render();}
      };
      this.board.append(b);
    }
    if(focus)this.board.querySelector<HTMLButtonElement>(`[data-square="${focus}"]`)?.focus({preventScroll:true});
  }
}
