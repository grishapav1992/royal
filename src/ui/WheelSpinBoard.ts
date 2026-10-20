import { t as translateText, tr } from '../i18n/index';
import {studioWheelSegments} from '../shared/studioGames';
import type {WheelSpinPresentation,WheelSpinPresentationGameId,WheelSpinTarget} from '../shared/wheelSpinPresentation';
import {wheelGlyph,WHEEL_TARGET_NAMES,WHEEL_TARGET_COLORS} from './WheelSpinArtwork';

const NS='http://www.w3.org/2000/svg';
const normalized=(angle:number)=>(angle%360+360)%360;
export const wheelPointerSector=(rotation:number,count:number)=>Math.floor(normalized(-rotation)/(360/count));
export const wheelLandingRotation=(sector:number,count:number)=>normalized(-(sector+.5)*360/count);
type Callbacks={valid:()=>boolean;phase:(phase:'spinning'|'stopping')=>void;contact:(index:number)=>void};
const svg=(name:string,attributes:Record<string,string|number>={})=>{
  const node=document.createElementNS(NS,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
};
const polar=(radius:number,angle:number)=>{
  const radians=(angle-90)*Math.PI/180;
  return [210+radius*Math.cos(radians),210+radius*Math.sin(radians)];
};

export class WheelSpinBoard {
  private svg:SVGElement;
  private track:SVGGElement;
  private hub:SVGGElement;
  private sectors:readonly number[];
  private angle=0;
  private token='';
  private frame=0;
  private watchdog?:ReturnType<typeof setTimeout>;
  private resolve?:(complete:boolean)=>void;

  constructor(private host:HTMLElement,game:WheelSpinPresentationGameId){
    this.sectors=studioWheelSegments(game);
    host.className='wheel-spin-board';host.dataset.wheelBoard='';
    this.svg=svg('svg',{viewBox:'0 0 420 420',role:'img','aria-label':translateText('Колесо, выбери цель')}) as SVGElement;
    this.track=svg('g',{'data-wheel-track':''}) as SVGGElement;
    this.hub=svg('g',{'data-wheel-hub':''}) as SVGGElement;
    this.svg.append(svg('circle',{cx:210,cy:210,r:201,class:'wheel-shell'}));
    const lights=svg('g',{class:'wheel-lights'});
    for(let index=0;index<32;index++){
      const [cx,cy]=polar(194,index*360/32);
      lights.append(svg('circle',{cx,cy,r:index%2?2:3}));
    }
    this.svg.append(lights);
    const step=360/this.sectors.length;
    this.sectors.forEach((category,index)=>{
      const group=svg('g',{'data-wheel-sector':index,'data-category':category,class:'wheel-sector'});
      const start=polar(178,index*step),end=polar(178,(index+1)*step);
      group.append(svg('path',{d:`M210 210L${start.join(' ')}A178 178 0 0 1 ${end.join(' ')}Z`,fill:WHEEL_TARGET_COLORS[category]}));
      const [x,y]=polar(126,(index+.5)*step);
      const glyph=svg('g',{transform:`translate(${x} ${y})`,class:'wheel-sector-glyph'});
      glyph.innerHTML=wheelGlyph(category as WheelSpinTarget);group.append(glyph);
      const [nx,ny]=polar(159,(index+.5)*step);
      const number=svg('text',{x:nx,y:ny+5,'text-anchor':'middle',class:'wheel-sector-number'});
      number.textContent=String(index+1);group.append(number);
      const title=svg('title');title.textContent=tr`Сектор ${index+1}: ${WHEEL_TARGET_NAMES[category]}`;group.append(title);
      this.track.append(group);
    });
    this.track.append(svg('circle',{cx:210,cy:210,r:178,class:'wheel-rim'}));
    this.svg.append(this.track,svg('circle',{cx:210,cy:210,r:52,class:'wheel-hub'}),this.hub);
    this.svg.append(svg('path',{d:'M195 8H225L210 43Z',class:'wheel-pointer','data-wheel-pointer':''}));
    host.append(this.svg);host.dataset.sectors=String(this.sectors.length);this.show();
  }

  setTarget(target:WheelSpinTarget){
    this.track.querySelectorAll<SVGGElement>('[data-wheel-sector]').forEach(group=>group.classList.toggle('chosen-target',Number(group.dataset.category)===target));
    this.hub.innerHTML=`<g transform="translate(210 210)" class="wheel-hub-glyph">${wheelGlyph(target)}</g>`;
  }
  private rotate(angle:number){
    this.angle=angle;this.track.setAttribute('transform',`rotate(${angle} 210 210)`);
    this.host.dataset.rotation=String(normalized(angle));
    this.host.dataset.pointerSector=String(wheelPointerSector(angle,this.sectors.length));
  }
  show(p?:WheelSpinPresentation){
    this.cancel();this.host.dataset.state='stopped';
    this.track.querySelectorAll('[data-wheel-sector]').forEach(node=>node.classList.remove('landed','paid'));
    if(p){
      this.setTarget(p.target);this.rotate(wheelLandingRotation(p.sector,this.sectors.length));
      this.track.querySelector(`[data-wheel-sector="${p.sector}"]`)?.classList.add('landed',...(p.won?['paid']:[]));
      this.host.dataset.landedSector=String(p.sector);
      this.svg.setAttribute('aria-label',tr`Сектор ${p.sector+1} из ${p.segments.length}: ${WHEEL_TARGET_NAMES[p.sectorValue]}. ${p.won?translateText('Цель совпала.'):translateText('Цель не совпала.')}`);
    }else{
      this.rotate(0);delete this.host.dataset.landedSector;
      this.svg.setAttribute('aria-label',translateText('Колесо, результат ещё не подтверждён'));
    }
  }
  begin(token:string,valid:()=>boolean){
    this.show();this.token=token;this.host.dataset.state='moving';
    let last=performance.now();
    const tick=(now:number)=>{
      try{
        if(this.token!==token)return;
        if(!valid()||this.token!==token){this.cancel();return;}
        const delta=Math.max(0,Math.min(50,now-last));last=now;
        this.rotate(normalized(this.angle+delta*.15));
        this.frame=requestAnimationFrame(tick);
      }catch{this.cancel();}
    };
    try{this.frame=requestAnimationFrame(tick);}catch{this.cancel();}
  }
  finish(p:WheelSpinPresentation,token:string,callbacks:Callbacks):Promise<boolean>{
    cancelAnimationFrame(this.frame);this.frame=0;this.token=token;
    const from=normalized(this.angle),goal=wheelLandingRotation(p.sector,this.sectors.length);
    const distance=720+normalized(goal-from),duration=2800,start=performance.now(),initialVelocity=.15*duration;
    let previous=from,contact=0,lastContact=-Infinity,stopping=false;
    callbacks.phase('spinning');
    if(this.token!==token)return Promise.resolve(false);
    return new Promise(resolve=>{
      this.resolve=resolve;
      this.watchdog=setTimeout(()=>{if(this.token===token)this.cancel();},duration+450);
      const tick=(now:number)=>{
        try{
          if(this.token!==token)return;
          if(!callbacks.valid()||this.token!==token){this.cancel();return;}
          const t=Math.max(0,Math.min(1,(now-start)/duration));
          const angle=from+distance*(3*t*t-2*t*t*t)+initialVelocity*(t*t*t-2*t*t+t);
          this.rotate(angle);
          if(t>=.52&&!stopping){
            stopping=true;this.host.dataset.state='stopping';callbacks.phase('stopping');
            if(this.token!==token)return;
          }
          const step=360/this.sectors.length;
          if(Math.floor(angle/step)>Math.floor(previous/step)&&now-lastContact>=100&&contact<24){
            callbacks.contact(contact++);lastContact=now;if(this.token!==token)return;
          }
          previous=angle;
          if(t===1){
            clearTimeout(this.watchdog);this.watchdog=undefined;this.frame=0;
            this.rotate(from+distance);this.host.dataset.state='stopped';
            this.host.dataset.landedSector=String(p.sector);this.token='';
            const done=this.resolve;this.resolve=undefined;done?.(true);return;
          }
          this.frame=requestAnimationFrame(tick);
        }catch{this.cancel();}
      };
      try{this.frame=requestAnimationFrame(tick);}catch{this.cancel();}
    });
  }
  cancel(){
    cancelAnimationFrame(this.frame);clearTimeout(this.watchdog);
    this.watchdog=undefined;this.frame=0;this.token='';
    const resolve=this.resolve;this.resolve=undefined;resolve?.(false);
  }
  destroy(){this.cancel();this.host.replaceChildren();}
}
