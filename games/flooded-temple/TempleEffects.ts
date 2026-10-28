import {art} from './art';
import type {TempleBeat} from './presentation';
/** Every finite effect is paused and advanced by the same timeline clock. */
export class TempleEffects{
  private animations:Animation[]=[];
  private decorations:Element[]=[];
  constructor(private root:HTMLElement,private money:(units:string)=>string){}
  clear(){for(const animation of this.animations)animation.cancel();this.animations=[];for(const element of this.decorations)element.remove();this.decorations=[];}
  private animate(element:Element|null,frames:Keyframe[],duration:number){if(!element)return;const animation=element.animate(frames,{duration,fill:'both',easing:'ease-out'});animation.pause();animation.currentTime=0;this.animations.push(animation);}
  private element(parent:Element,className:string){const element=this.root.ownerDocument.createElement('span');element.className=className;element.setAttribute('aria-hidden','true');parent.append(element);this.decorations.push(element);return element;}
  private sparks(tile:Element,duration:number,count:number){
    for(let i=0;i<count;i++){const angle=(i/count*1.65+.17)*Math.PI,distance=15+(i%3)*9;
      this.animate(this.element(tile,'ft-spark'),[{opacity:0,transform:'translate(0,0) scale(.4)'},{opacity:.9,offset:.2},{opacity:0,transform:`translate(${Math.cos(angle)*distance}px,${-Math.abs(Math.sin(angle))*distance-10}px) scale(.25)`}],duration);
    }
  }
  decorate(beat:TempleBeat|undefined,reduced:boolean,offset:number){
    this.clear();if(!beat)return;
    const tile=beat.room===undefined?null:this.root.querySelector<HTMLElement>(`[data-room="${beat.room}"]`);
    if(tile)tile.dataset.feedback=beat.kind;
    if(reduced){this.tick(beat,offset);return;}
    if(beat.kind==='card')for(const cell of Array.from(this.root.querySelectorAll(`[data-room]`))){if(Math.floor(Number((cell as HTMLElement).dataset.room)/5)===beat.room)this.animate(cell,[{opacity:0,transform:'translateY(-14px) rotateX(9deg)',filter:'brightness(.5)'},{opacity:1,transform:'translateY(1px) rotateX(0deg)',filter:'brightness(1.12)',offset:.72},{opacity:1,transform:'translateY(0)',filter:'brightness(1)'}],beat.duration);}
    if(beat.kind==='travel'&&beat.from!==undefined&&beat.room!==undefined){
      const map=this.root.querySelector('.ft-map')!,marker=this.element(map,'ft-moving');marker.innerHTML=art.explorer;
      this.animate(marker,[{left:(beat.from%5*20+10)+'%',top:(Math.floor(beat.from/5)*25+12.5)+'%'},{left:(beat.room%5*20+10)+'%',top:(Math.floor(beat.room/5)*25+12.5)+'%'}],beat.duration);
      const line=this.root.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');line.classList.add('ft-travel-line');line.setAttribute('viewBox','0 0 500 400');line.setAttribute('aria-hidden','true');line.innerHTML=`<path pathLength="100" d="M${beat.from%5*100+50} ${Math.floor(beat.from/5)*100+50}L${beat.room%5*100+50} ${Math.floor(beat.room/5)*100+50}"/>`;map.append(line);this.decorations.push(line);
      this.animate(line.firstElementChild,[{strokeDasharray:'100',strokeDashoffset:'100'},{strokeDasharray:'100',strokeDashoffset:'0'}],beat.duration);
    }
    if(beat.kind==='arrive'&&tile)this.animate(this.element(tile,'ft-ripple'),[{opacity:.65,transform:'scale(.4)'},{opacity:0,transform:'scale(1.15)'}],beat.duration);
    if(beat.kind==='collect'&&tile){
      const symbol=tile.querySelector('.ft-room-art');this.animate(symbol,[{transform:'translateY(0) scale(1)'},{transform:'translateY(-3px) scale(1.1)',offset:.28},{transform:'translateY(0) scale(1)'}],beat.duration);
      const badge=this.element(tile,'ft-award');badge.textContent='+'+this.money(beat.awardUnits!);
      this.animate(badge,[{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'translateY(-7px)',offset:.27},{opacity:1,offset:.72},{opacity:0,transform:'translateY(-26px)'}],beat.duration);
      this.animate(tile.querySelector('.ft-prop-closed'),[{opacity:1},{opacity:0}],Math.min(240,beat.duration));
      this.animate(tile.querySelector('.ft-prop-open'),[{opacity:0,transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}],Math.min(240,beat.duration));
      this.animate(this.element(tile,'ft-treasure-glow'),[{opacity:0},{opacity:.8,offset:.3},{opacity:0}],beat.duration);this.sparks(tile,beat.duration,6);
    }
    if(beat.kind==='lever'){
      this.animate(tile?.querySelector('.ft-prop-upright')??null,[{opacity:1},{opacity:0}],beat.duration);
      this.animate(tile?.querySelector('.ft-prop-pulled')??null,[{opacity:0},{opacity:1}],beat.duration);
    }
    if(beat.kind==='gate'){
      const bars=this.root.querySelector(`.ft-gate[data-edge="${beat.edge}"] .ft-gate-body`);this.animate(bars,[{opacity:1,translate:'0 0'},{opacity:.8,translate:'0 -10px',offset:.22},{opacity:0,translate:'0 -45px'}],beat.duration);
    }
    if(beat.kind==='rope')this.animate(this.root.querySelector('.ft-bridge'),[{opacity:0,strokeDasharray:'40',strokeDashoffset:'40'},{opacity:1,strokeDasharray:'40',strokeDashoffset:'0',offset:.64},{opacity:.75,offset:.8},{opacity:1}],beat.duration);
    if(beat.kind==='relic'){
      this.animate(tile?.querySelector('.ft-room-art')??null,[{filter:'drop-shadow(0 0 0px #7ff8e9)',transform:'scale(1)'},{filter:'drop-shadow(0 0 16px #7ff8e9)',transform:'scale(1.12)',offset:.32},{filter:'drop-shadow(0 0 6px #7ff8e9)',transform:'scale(1)'}],beat.duration);
      if(tile){this.sparks(tile,beat.duration,8);this.animate(this.element(tile,'ft-ripple'),[{opacity:0,transform:'scale(.55)'},{opacity:.8,offset:.25},{opacity:0,transform:'scale(1.4)'}],beat.duration);}
    }
    if(beat.kind==='expedition')this.animate(this.root.querySelector('.ft-map'),[{opacity:.35,filter:'brightness(.55)'},{opacity:1,filter:'brightness(1)'}],beat.duration);
    if(beat.kind==='outcome'){
      this.root.dataset.outcome=beat.outcome;
      if(beat.outcome==='win'||beat.outcome==='big')this.animate(this.root.querySelector('.ft-collected-total'),[{filter:'drop-shadow(0 0 0px #f1c775)',transform:'scale(1)'},{filter:'drop-shadow(0 0 12px #f1c775)',transform:'scale(1.045)',offset:.3},{filter:'drop-shadow(0 0 2px #f1c775)',transform:'scale(1)'}],beat.duration);
    }
    this.tick(beat,offset);
  }
  tick(beat:TempleBeat,offset:number){
    for(const animation of this.animations)animation.currentTime=Math.max(0,Math.min(beat.duration,offset));
    if(beat.counterFrom!==undefined){const fraction=Math.min(1,Math.max(0,offset/beat.duration)),from=Number(beat.counterFrom),to=Number(beat.frame.totalUnits),units=String(Math.round(from+(to-from)*fraction));const output=this.root.querySelector('[data-ft-value=payout]');if(output)output.textContent=this.money(units);}
  }
  getState(){return {animations:this.animations.length,decorations:this.decorations.length};}
}
