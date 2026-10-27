import {art} from './art';
import type {TempleBeat} from './presentation';
/** Every finite effect is paused and advanced by the same timeline clock. */
export class TempleEffects{
  private animations:Animation[]=[];
  constructor(private root:HTMLElement,private money:(units:string)=>string){}
  clear(){for(const animation of this.animations)animation.cancel();this.animations=[];}
  private animate(element:Element|null,frames:Keyframe[],duration:number){if(!element)return;const animation=element.animate(frames,{duration,fill:'both',easing:'ease-out'});animation.pause();animation.currentTime=0;this.animations.push(animation);}
  decorate(beat:TempleBeat|undefined,reduced:boolean,offset:number){
    this.clear();if(!beat)return;
    const tile=beat.room===undefined?null:this.root.querySelector<HTMLElement>(`[data-room="${beat.room}"]`);
    if(tile)tile.dataset.feedback=beat.kind;
    if(reduced){this.tick(beat,offset);return;}
    if(beat.kind==='card')for(const cell of Array.from(this.root.querySelectorAll(`[data-room]`))){if(Math.floor(Number((cell as HTMLElement).dataset.room)/5)===beat.room)this.animate(cell,[{opacity:0,transform:'translateY(-7px) rotateX(12deg)'},{opacity:1,transform:'translateY(0) rotateX(0deg)'}],beat.duration);}
    if(beat.kind==='travel'&&beat.from!==undefined&&beat.room!==undefined){
      const marker=this.root.ownerDocument.createElement('span');marker.className='ft-moving';marker.innerHTML=art.explorer;this.root.querySelector('.ft-map')?.append(marker);
      this.animate(marker,[{left:(beat.from%5*20+10)+'%',top:(Math.floor(beat.from/5)*25+12.5)+'%'},{left:(beat.room%5*20+10)+'%',top:(Math.floor(beat.room/5)*25+12.5)+'%'}],beat.duration);
    }
    if(beat.kind==='collect'&&tile){
      const symbol=tile.querySelector('.ft-room-art');this.animate(symbol,[{transform:'translateY(0) scale(1)'},{transform:'translateY(-3px) scale(1.1)',offset:.28},{transform:'translateY(0) scale(1)'}],beat.duration);
      const badge=this.root.ownerDocument.createElement('span');badge.className='ft-award';badge.textContent='+'+this.money(beat.awardUnits!);tile.append(badge);
      this.animate(badge,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(-6px)',offset:.32},{opacity:0,transform:'translateY(-22px)'}],beat.duration);
      this.animate(tile.querySelector('.ft-chest-lid'),[{transform:'rotate(0deg)'},{transform:'rotate(-28deg)'}],150);
    }
    if(beat.kind==='lever')this.animate(tile?.querySelector('.ft-room-art')??null,[{transform:'rotate(0deg)'},{transform:'rotate(-15deg)'}],beat.duration);
    if(beat.kind==='gate'){
      const bars=this.root.querySelector(`.ft-gate[data-edge="${beat.edge}"]`);this.animate(bars,[{opacity:1,translate:'0 0'},{opacity:0,translate:'0 -35px'}],beat.duration);
      this.animate(tile?.querySelector('.ft-room-art')??null,[{transform:'rotate(-15deg)'},{transform:'rotate(-15deg)'}],beat.duration);
    }
    if(beat.kind==='rope')this.animate(this.root.querySelector('.ft-bridge'),[{opacity:0,strokeDasharray:'40',strokeDashoffset:'40'},{opacity:1,strokeDasharray:'40',strokeDashoffset:'0',offset:.8},{opacity:1}],beat.duration);
    if(beat.kind==='relic')this.animate(tile?.querySelector('.ft-room-art')??null,[{filter:'drop-shadow(0 0 0px #7ff8e9)',transform:'scale(1)'},{filter:'drop-shadow(0 0 16px #7ff8e9)',transform:'scale(1.1)',offset:.4},{filter:'drop-shadow(0 0 6px #7ff8e9)',transform:'scale(1)'}],beat.duration);
    if(beat.kind==='expedition')this.animate(this.root.querySelector('.ft-map'),[{opacity:.4},{opacity:1}],beat.duration);
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
  getState(){return {animations:this.animations.length};}
}
