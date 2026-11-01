import { findPath, walkable, type Point } from './navigation';
import { STREET_OBSTACLES } from '../shared/street';
import { STREET_RESIDENTS, type StreetResidentId } from './streetDetails';
import type { Facing } from '../shared/movement';

type Stop=Point&{facing:Facing;stay:number};
type Patrol={speed:number;stops:readonly Stop[]};
export const STREET_PATROLS:Partial<Record<StreetResidentId,Patrol>>={
  tourist:{speed:58,stops:[
    {x:1420,y:1006,facing:'up',stay:12000},
    {x:1830,y:1000,facing:'up',stay:12000},
    {x:2320,y:740,facing:'left',stay:12000},
    {x:1570,y:360,facing:'down',stay:12000},
    {x:480,y:690,facing:'right',stay:12000},
  ]},
  janitor:{speed:46,stops:[
    {x:1370,y:320,facing:'down',stay:13000},
    {x:1800,y:320,facing:'down',stay:13000},
    {x:2420,y:680,facing:'down',stay:13000},
    {x:2170,y:980,facing:'down',stay:13000},
    {x:385,y:700,facing:'down',stay:13000},
  ]},
  mascot:{speed:39,stops:[
    {x:1130,y:1000,facing:'down',stay:4000},
    {x:1250,y:985,facing:'down',stay:4000},
    {x:1310,y:1010,facing:'down',stay:4000},
    {x:1190,y:1020,facing:'down',stay:4000},
  ]},
};
export const STREET_WORK_PATCHES=STREET_PATROLS.janitor!.stops.map(({x,y})=>({x:x+35,y:y+7}));
const obstacles=STREET_OBSTACLES.map(o=>({x:o.x-4,y:o.y-4,w:o.w+8,h:o.h+8}));
// Only resident routing avoids this area; it never becomes a player obstacle.
const patrolObstacles=[...obstacles,{x:756,y:911,w:178,h:108}];
type Actor={id:StreetResidentId;x:number;y:number;facing:Facing;index:number;stay:number;workTime:number;moving:boolean;path:Point[];cursor:number;greet:number;cooldown:number;greetings:number};
export type ResidentLocation=Point&{id:StreetResidentId;facing:Facing;moving:boolean;stop:number;workTime:number;greeting:boolean;greetingProgress:number;greetings:number};

/** Independent resident clocks stop for conversations, hidden scenes and reduced motion. */
export class StreetResidentPatrols {
  private actors:Actor[];
  private paths=new Map<StreetResidentId,Point[][]>();
  private motion=true;
  private frozen=new Set<StreetResidentId>();
  constructor(){
    this.actors=STREET_RESIDENTS.map(person=>{
      const patrol=STREET_PATROLS[person.id],start=patrol?.stops[0]??person;
      if(patrol)this.paths.set(person.id,patrol.stops.map((stop,i)=>{
        const path=findPath(stop,patrol.stops[(i+1)%patrol.stops.length],patrolObstacles);
        if(!path.length)throw Error('Unreachable street patrol: '+person.id);
        return path;
      }));
      return {id:person.id,x:start.x,y:start.y,facing:start.facing,index:0,stay:patrol?.stops[0].stay??0,workTime:0,moving:false,path:[],cursor:0,greet:0,cooldown:0,greetings:0};
    });
  }
  advance(delta:number,options:{motion?:boolean;frozen?:readonly StreetResidentId[];passers?:readonly Point[]}={}){
    this.motion=options.motion!==false;this.frozen=new Set(options.frozen??[]);
    const ms=Number.isFinite(delta)?Math.min(50,Math.max(0,delta)):0;
    for(const actor of this.actors){
      actor.moving=false;
      if(!this.motion||this.frozen.has(actor.id))continue;
      const patrol=STREET_PATROLS[actor.id];
      actor.cooldown=Math.max(0,actor.cooldown-ms);
      if(actor.id==='mascot'&&actor.cooldown===0&&(options.passers??[]).some(p=>{const d=Math.hypot(p.x-actor.x,p.y-actor.y);return d>24&&d<170;})){
        actor.greet=1800;actor.cooldown=9000;actor.greetings++;
      }
      if(actor.greet>0){actor.greet=Math.max(0,actor.greet-ms);continue;}
      if(!patrol){actor.workTime+=ms;continue;}
      if(actor.stay>0){
        actor.workTime+=ms;actor.stay=Math.max(0,actor.stay-ms);
        if(actor.stay===0){actor.path=this.paths.get(actor.id)![actor.index];actor.cursor=0;}
        continue;
      }
      let distance=patrol.speed*ms/1000;
      while(distance>0&&actor.cursor<actor.path.length){
        const next=actor.path[actor.cursor],dx=next.x-actor.x,dy=next.y-actor.y,length=Math.hypot(dx,dy);
        if(length<.001){actor.cursor++;continue;}
        actor.facing=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';
        const step=Math.min(distance,length);actor.x+=dx/length*step;actor.y+=dy/length*step;distance-=step;actor.moving=true;
        if(step===length)actor.cursor++;
      }
      if(actor.cursor===actor.path.length){
        actor.index=(actor.index+1)%patrol.stops.length;
        const stop=patrol.stops[actor.index];actor.x=stop.x;actor.y=stop.y;actor.facing=stop.facing;
        actor.stay=stop.stay;actor.workTime=0;actor.path=[];actor.moving=false;
      }
    }
    return this.snapshot();
  }
  snapshot():ResidentLocation[]{return this.actors.map(a=>({id:a.id,x:a.x,y:a.y,facing:a.facing,moving:this.motion&&!this.frozen.has(a.id)&&a.moving,stop:a.index,workTime:a.workTime,greeting:this.motion&&!this.frozen.has(a.id)&&a.greet>0,greetingProgress:a.greet>0?1-a.greet/1800:0,greetings:a.greetings}));}
  approach(id:StreetResidentId,visitor:Point):Point|null{
    const actor=this.actors.find(a=>a.id===id),person=STREET_RESIDENTS.find(p=>p.id===id);if(!actor||!person)return null;
    const dx=person.approach.x-person.x,dy=person.approach.y-person.y;
    let fallback:Point|null=null;
    for(const [ox,oy] of [[dx,dy],[-dx,dy],[0,76],[-80,0],[80,0],[0,-76]]){
      const point={x:actor.x+ox,y:actor.y+oy};
      if(walkable(point.x,point.y,STREET_OBSTACLES,16)&&findPath(visitor,point,obstacles).length){
        fallback??=point;
        const distance=Math.hypot(actor.x-point.x,actor.y-point.y);
        if(!this.actors.some(other=>other.id!==id&&Math.hypot(other.x-point.x,other.y-point.y)+10<distance))return point;
      }
    }
    return fallback;
  }
}
