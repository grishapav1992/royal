import { STREET } from '../shared/street';
import type { Facing } from '../shared/movement';
import type { Point } from './navigation';

type Route = { points: readonly Point[]; lengths: number[]; length: number };
function route(points: readonly Point[]): Route {
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  return {points,lengths,length:lengths.reduce((sum,n)=>sum+n,0)};
}
const perimeter=[...STREET.loop,STREET.loop[0]];
const walkers=[
  {id:'street-amber',skin:7,speed:52,offset:8000,rest:4000,route:route([{x:360,y:1070},{x:2400,y:1070},{x:360,y:1070}])},
  {id:'street-teal',skin:10,speed:58,offset:19000,rest:5000,route:route([{x:2440,y:990},{x:380,y:990},{x:2440,y:990}])},
  {id:'street-pink',skin:5,speed:48,offset:41000,rest:3000,route:route(perimeter)},
  {id:'street-blue',skin:3,speed:50,offset:94000,rest:4000,route:route([...perimeter].reverse())},
  {id:'street-silver',skin:12,speed:40,offset:4000,rest:6000,route:route([{x:980,y:1060},{x:1700,y:1060},{x:980,y:1060}])},
] as const;
export const STREET_CARS=[
  {id:'street-blue-car',color:'#648aab',direction:1,y:1288,period:36000,travel:15000,offset:3500},
  {id:'street-berry-car',color:'#9c5266',direction:-1,y:1365,period:27000,travel:17000,offset:13000},
  {id:'street-gold-car',color:'#d8ad4f',direction:1,y:1288,period:36000,travel:15000,offset:21500},
] as const;

function sampleWalker(def: typeof walkers[number], time:number, moving:boolean) {
  const travel=def.route.length/def.speed*1000,phase=(time+def.offset)%(travel+def.rest);
  const walking=moving&&phase<travel;
  let distance=Math.min(phase,travel)/1000*def.speed;
  for(let i=0;i<def.route.lengths.length;i++){
    const length=def.route.lengths[i];
    if(distance<=length||i===def.route.lengths.length-1){
      const a=def.route.points[i],b=def.route.points[i+1],ratio=Math.min(1,distance/length);
      const facing:Facing=Math.abs(b.x-a.x)>Math.abs(b.y-a.y)?b.x>a.x?'right':'left':b.y>a.y?'down':'up';
      return {id:def.id,skin:def.skin,x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,facing,moving:walking};
    }
    distance-=length;
  }
  throw Error('Street walking route has no segment');
}

/** Decorative time advances only with the visible street, never with wall-clock gaps. */
export class StreetLife {
  private time=0;
  private moving=true;
  advance(deltaMs:number,options:{paused?:boolean;reducedMotion?:boolean}={}){
    this.moving=!options.paused&&!options.reducedMotion;
    if(this.moving&&Number.isFinite(deltaMs))this.time+=Math.min(50,Math.max(0,deltaMs));
    return this.snapshot();
  }
  snapshot(){
    const time=this.time,phase=(time+600)%7800;
    const progress=phase/1900;
    const sparkle=(time+2200)%6200/1400;
    return {
      time,motion:this.moving,
      pedestrians:walkers.map(def=>sampleWalker(def,time,this.moving)),
      cars:STREET_CARS.map(def=>{
        const phase=(time+def.offset)%def.period,progress=phase/def.travel;
        const from=-170,to=STREET.width+170;
        return {id:def.id,color:def.color,direction:def.direction,y:def.y,visible:phase<def.travel,
          x:def.direction===1?from+(to-from)*progress:to-(to-from)*progress};
      }),
      sign:{sheen:this.moving&&progress<1?Math.sin(Math.PI*progress)*.24:0,sweep:-44+388*Math.min(1,progress),
        sparkle:this.moving&&sparkle<1?Math.sin(Math.PI*sparkle)**2*.72:0,
        starIndex:Math.floor((time+2200)/6200)%3},
    };
  }
}
