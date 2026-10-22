import { t as translateText, tr } from '../i18n/index';
import {fruitSymbol,FRUITS_SYMBOL_NAMES,type FruitsSlotGame} from './FruitsArtwork';
import type {FruitsPresentation} from '../shared/fruitsPresentation';
const ACCELERATE=400,MINIMUM=900,GAP=210,BRAKE=470;
export class FruitsReels {
  private reels:{root:HTMLElement;track:HTMLElement;cells:HTMLElement[];offset:number;stop?:{at:number;from:number;target:number};stopped:boolean}[]=[];
  private previous=0;
  private get accelerate(){return this.game==='royal-fruits'?280:ACCELERATE;}
  private get minimum(){return this.game==='royal-fruits'?720:MINIMUM;}
  private get gap(){return this.game==='royal-fruits'?140:GAP;}
  private get brake(){return this.game==='royal-fruits'?360:BRAKE;}
  private token='';private frame=0;private started=0;private stopAt=0;private final?:FruitsPresentation;private motion=false;private phase='';private resolve?:()=>void;private lines:1|2|3;private watchdog=0;private fallback=false;
  get usedFallback(){return this.fallback;}
  constructor(private host:HTMLElement,private game:FruitsSlotGame,private callbacks:{phase:(state:'accelerating'|'spinning'|'stopping')=>void;stop:(index:number)=>void}){
    this.lines=game==='royal-fruits'?1:3;host.className='fruits-reels';host.dataset.fruitsReels='';host.setAttribute('role','group');host.setAttribute('aria-label',translateText('Три барабана'));
    for(let column=0;column<3;column++){
      const root=document.createElement('div');root.className='fruits-reel';root.dataset.fruitsReel=String(column);root.dataset.state='stopped';
      const track=document.createElement('div');track.className='fruits-track';track.dataset.fruitsTrack='';track.setAttribute('aria-hidden','true');
      const result=document.createElement('div');result.className='fruits-static';const cells=Array.from({length:3},(_,row)=>{const cell=document.createElement('div');cell.className='fruits-cell';cell.dataset.fruitsCell=String(row*3+column);result.append(cell);return cell;});root.append(track,result);host.append(root);this.reels.push({root,track,cells,offset:0,stopped:true});
    }this.show(undefined,this.lines);
  }
  private symbols(presentation:FruitsPresentation|undefined,lines:1|2|3):Array<number|undefined>{
    if(this.game==='royal-fruits'){const paid=presentation?.rows[0].symbols??[0,1,2];return [paid.map(v=>(v+1)%4),[...paid],paid.map(v=>(v+2)%4)].flat();}
    return Array.from({length:9},(_,position)=>Math.floor(position/3)>=lines?undefined:presentation?.rows[Math.floor(position/3)]?.symbols[position%3]??position%4);
  }
  show(presentation:FruitsPresentation|undefined,lines:1|2|3=this.lines){this.lines=lines;const symbols=this.symbols(presentation,lines);this.reels.forEach((reel,column)=>{reel.root.dataset.state='stopped';reel.cells.forEach((cell,row)=>{const position=row*3+column,symbol=symbols[position],paid=this.game==='royal-fruits'?row===1:row<lines;cell.dataset.symbol=symbol===undefined?'':String(symbol);cell.dataset.paid=String(paid);cell.dataset.lineIndex=paid?String(this.game==='royal-fruits'?0:row):'';cell.classList.toggle('decorative',this.game==='royal-fruits'&&!paid);cell.classList.toggle('off',symbol===undefined);cell.innerHTML=symbol===undefined?'<span class="fruits-off-mark" aria-hidden="true">·</span>':fruitSymbol(this.game,symbol);cell.setAttribute('aria-hidden',String(this.game==='royal-fruits'&&!paid));cell.setAttribute('role','img');cell.setAttribute('aria-label',symbol===undefined?translateText('Третья линия выключена'):paid?tr`Линия ${this.game==='royal-fruits'?1:row+1}, барабан ${column+1}: ${FRUITS_SYMBOL_NAMES[symbol]}`:translateText('Декоративный символ, не участвует в выплате'));});});}
  highlight(line?:number){this.host.querySelectorAll<HTMLElement>('[data-fruits-cell]').forEach(cell=>cell.classList.toggle('active-win',line!==undefined&&cell.dataset.paid==='true'&&cell.dataset.lineIndex===String(line)));}
  markWins(presentation:FruitsPresentation){const lines=new Set(presentation.rows.filter(row=>row.returnedUnits!=='0').map(row=>row.lineIndex));this.host.querySelectorAll<HTMLElement>('[data-fruits-cell]').forEach(cell=>cell.classList.toggle('win',cell.dataset.paid==='true'&&lines.has(Number(cell.dataset.lineIndex))));}
  clear(){this.host.querySelectorAll('.win,.active-win').forEach(cell=>cell.classList.remove('win','active-win'));}
  begin(token:string,motion:boolean){this.cancel();this.fallback=false;this.host.style.setProperty('--fruit-reel-height',`${this.host.clientHeight}px`);this.token=token;this.started=performance.now();this.previous=this.started;this.stopAt=0;this.final=undefined;this.motion=motion;this.phase='';this.reels.forEach((reel,column)=>{reel.offset=0;reel.stop=undefined;reel.stopped=false;reel.root.dataset.state=motion?'moving':'stopped';reel.track.innerHTML=Array.from({length:70},(_,i)=>`<div class="fruits-strip-cell">${fruitSymbol(this.game,(i+column)%4)}</div>`).join('');reel.track.style.transform='translateY(0px)';});if(motion)this.frame=requestAnimationFrame(time=>this.tick(time));}
  confirm(presentation:FruitsPresentation):Promise<void>{if(!this.token)return Promise.resolve();this.final=presentation;this.stopAt=Math.max(performance.now(),this.started+this.minimum);if(!this.motion){this.show(presentation,presentation.rows.length as 1|2|3);this.token='';return Promise.resolve();}return new Promise(resolve=>{this.resolve=resolve;const token=this.token;clearTimeout(this.watchdog);this.watchdog=window.setTimeout(()=>{if(this.token!==token||this.final!==presentation)return;this.fallback=true;cancelAnimationFrame(this.frame);this.frame=0;this.show(presentation,presentation.rows.length as 1|2|3);this.reels.forEach(reel=>{reel.stopped=true;reel.stop=undefined;});this.token='';this.watchdog=0;const done=this.resolve;this.resolve=undefined;done?.();},Math.max(0,this.stopAt-performance.now())+2*this.gap+this.brake+350);});}
  private setPhase(state:'accelerating'|'spinning'|'stopping'){if(this.phase!==state){this.phase=state;this.callbacks.phase(state);}}
  private tick(now:number){if(!this.token)return;const token=this.token;const elapsed=now-this.started,frameStep=this.game==='royal-fruits'?Math.min(40,Math.max(0,now-this.previous)):16;this.previous=now;if(!this.reels.some(reel=>reel.stop))this.setPhase(elapsed<this.accelerate?'accelerating':'spinning');
    this.reels.forEach((reel,column)=>{if(this.token!==token||reel.stopped)return;const speed=.008+Math.min(1,elapsed/this.accelerate)*.018;if(!reel.stop)reel.offset=(reel.offset+speed*frameStep)%40;
      if(!reel.stop&&this.final&&now>=this.stopAt+column*this.gap){const target=Math.ceil(reel.offset+4);reel.stop={at:now,from:reel.offset,target};const symbols=this.symbols(this.final,this.final.rows.length as 1|2|3);for(let row=0;row<3;row++){const symbol=symbols[row*3+column];(reel.track.children[target+row] as HTMLElement).innerHTML=symbol===undefined?'<span class="fruits-off-mark">·</span>':fruitSymbol(this.game,symbol);}reel.root.dataset.state='stopping';}
      if(reel.stop){this.setPhase('stopping');if(this.token!==token)return;const progress=Math.max(0,Math.min(1,(now-reel.stop.at)/this.brake));reel.offset=reel.stop.from+(reel.stop.target-reel.stop.from)*Math.sin(progress*Math.PI/2);if(progress===1){reel.stopped=true;reel.root.dataset.state='stopped';const symbols=this.symbols(this.final!,this.final!.rows.length as 1|2|3);reel.cells.forEach((cell,row)=>{const symbol=symbols[row*3+column];cell.dataset.symbol=symbol===undefined?'':String(symbol);cell.innerHTML=symbol===undefined?'<span class="fruits-off-mark">·</span>':fruitSymbol(this.game,symbol);});this.callbacks.stop(column);}}
      if(this.token!==token)return;const height=reel.root.clientHeight/3;reel.track.style.transform=`translateY(${-reel.offset*height}px)`;
    });
    if(this.token!==token)return;if(this.reels.every(reel=>reel.stopped)&&this.final){clearTimeout(this.watchdog);this.watchdog=0;this.show(this.final,this.final.rows.length as 1|2|3);this.frame=0;this.token='';const resolve=this.resolve;this.resolve=undefined;resolve?.();return;}this.frame=requestAnimationFrame(time=>this.tick(time));
  }
  cancel(){clearTimeout(this.watchdog);this.watchdog=0;cancelAnimationFrame(this.frame);this.frame=0;this.token='';this.motion=false;this.reels.forEach(reel=>{reel.root.dataset.state='stopped';});const resolve=this.resolve;this.resolve=undefined;resolve?.();}
  destroy(){this.cancel();this.host.replaceChildren();}
}
