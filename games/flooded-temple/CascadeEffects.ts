import {cascadeUnits} from '../../src/shared/floodedTempleCascade';
import {cascadeLandMs,cascadeCounter,cascadeLines,type CascadeBeat} from './cascadePresentation';

const clamp=(v:number)=>Math.min(1,Math.max(0,v));
type Piece={element:HTMLElement;cell:number;part:number};
/** Small board-local effects. Every transform is a function of the owned timeline. */
export class CascadeEffects{
  private cells:HTMLElement[]=[];
  private pieces:Piece[]=[];
  private lines?:SVGSVGElement;
  private layer?:HTMLElement;
  private counter?:HTMLElement;
  private award?:HTMLElement;
  private shownUnits='0';
  private maxNodes=0;
  private width=0;
  private height=0;
  private stride=0;
  constructor(private root:HTMLElement,private money:(units:string)=>string){}
  attach(beat:CascadeBeat|undefined,stake:string,offset:number,fallbackUnits='0'){
    this.clear();this.cells=Array.from(this.root.querySelectorAll<HTMLElement>('[data-cell]'));this.counter=this.root.querySelector<HTMLElement>('[data-ft-value=payout]')??undefined;this.award=this.root.querySelector<HTMLElement>('.ft-fall-award')??undefined;
    if(!beat){this.shownUnits=fallbackUnits;return;}
    const layer=this.root.querySelector<HTMLElement>('.ft-cascade-fx');if(!layer)return;this.layer=layer;this.width=layer.clientWidth;this.height=layer.clientHeight;
    const reels=this.root.querySelector<HTMLElement>('.ft-reels')!;this.stride=(this.cells[0]?.getBoundingClientRect().height??0)+parseFloat(this.root.ownerDocument.defaultView!.getComputedStyle(reels).rowGap);
    if(beat.kind==='break'){
      const box=layer.getBoundingClientRect(),mask=beat.removeMask??beat.frame.removeMask;
      for(const cell of this.cells){const index=Number(cell.dataset.cell);if(!(mask&(1<<index)))continue;
        const rect=cell.getBoundingClientRect(),symbol=Number(cell.dataset.symbol);
        for(let part=0;part<4;part++){
          const piece=this.root.ownerDocument.createElement('i');piece.className=part<3?'ft-stone-shard':'ft-stone-dust';
          piece.style.cssText=`left:${rect.left-box.left}px;top:${rect.top-box.top}px;width:${rect.width}px;height:${rect.height}px;--sx:${symbol%3*50}%;--sy:${Math.floor(symbol/3)*50}%`;
          piece.dataset.part=String(part);layer.append(piece);this.pieces.push({element:piece,cell:index,part});
        }
      }
    }
    if(beat.kind==='evaluate'&&beat.frame.wins.length){
      const doc=this.root.ownerDocument,svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 5 3');svg.setAttribute('preserveAspectRatio','none');svg.classList.add('ft-cascade-lines');
      for(const rows of cascadeLines(beat.frame)){const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',rows.map((r,c)=>(c?'L':'M')+(c+.5)+','+(r+.5)).join(' '));svg.append(path);}
      layer.append(svg);this.lines=svg;
    }
    this.maxNodes=Math.max(this.maxNodes,layer.querySelectorAll('*').length);this.tick(beat,offset,stake);
  }
  tick(beat:CascadeBeat,offset:number,stake:string){
    if(this.layer&&(this.width!==this.layer.clientWidth||this.height!==this.layer.clientHeight)){this.attach(beat,stake,offset);return;}
    const p=clamp(offset/beat.duration),envelope=Math.sin(p*Math.PI),mask=beat.removeMask??beat.frame.removeMask;
    if(beat.kind==='drop')for(const move of beat.moves){
      const cell=this.cells[move.cell];if(!cell||!move.rows)continue;
      const land=cascadeLandMs(move.cell),fall=clamp(offset/land),bounce=offset>land?Math.sin(clamp((offset-land)/80)*Math.PI):0;
      const travel=move.rows*this.stride;
      cell.style.transform=`translateY(${-travel*(1-fall*fall)}px) scale(${1+bounce*.018},${1-bounce*.04})`;
      cell.style.opacity=String(move.from===null?Math.max(.08,fall):1);
      cell.style.setProperty('--ft-glow',String(bounce*.16));
    }
    if(beat.kind==='break'){
      for(const cell of this.cells)if(mask&(1<<Number(cell.dataset.cell)))cell.style.opacity=String(Math.max(0,1-p*4));
      for(const {element,part,cell}of this.pieces){
        const direction=part===0?-1:part===2?1:0,delay=(cell%3)*.035,t=clamp((p-delay)/(1-delay));
        element.style.transform=part===3?`translateY(${t*12}px) scale(${.8+t*.5})`:`translate(${direction*t*24}px,${t*t*28}px) rotate(${direction*t*17}deg) scale(${1-t*.06})`;
        element.style.opacity=String(part===3?Math.sin(t*Math.PI)*.22:Math.pow(1-t,.8));
      }
    }
    if(beat.kind==='evaluate'){
      for(const cell of this.cells)if(mask&(1<<Number(cell.dataset.cell)))cell.style.setProperty('--ft-glow',String(envelope*.32));
      if(this.lines)this.lines.style.opacity=String(envelope*.65);
    }
    if(beat.kind==='bonus'||beat.kind==='base-return')this.root.style.setProperty('--ft-seal',String(envelope*.3));
    if(this.award){const profit=beat.outcome==='win'||beat.outcome==='big';this.award.style.transform=profit?`scale(${1+.025*Math.sin(clamp(p*2)*Math.PI)})`:'none';this.award.style.opacity=beat.kind==='bonus'?String(.65+envelope*.35):'1';}
    this.shownUnits=cascadeUnits(cascadeCounter(beat,offset),stake);if(this.counter)this.counter.textContent=this.money(this.shownUnits);
  }
  clear(){
    this.layer?.replaceChildren();this.layer=undefined;this.pieces=[];this.lines=undefined;
    for(const cell of this.cells){cell.style.removeProperty('transform');cell.style.removeProperty('opacity');cell.style.removeProperty('--ft-glow');}this.cells=[];
    this.root.style.removeProperty('--ft-seal');if(this.award){this.award.style.removeProperty('transform');this.award.style.removeProperty('opacity');}
  }
  getState(){return {nodes:this.layer?.querySelectorAll('*').length??0,maxNodes:this.maxNodes,shownUnits:this.shownUnits};}
}
