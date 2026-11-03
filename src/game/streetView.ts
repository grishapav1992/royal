import type { Point } from './navigation';
import type { Facing } from '../shared/movement';
import { STREET } from '../shared/street';
import { STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE } from '../shared/rooftop';

export type StreetSide = 'front' | 'rear';
export function streetSide(point: Point, previous: StreetSide = 'front'): StreetSide {
  const b=STREET.building;
  if(previous==='rear'){
    const outside=point.x<=b.x||point.x>=b.x+b.w;
    return point.y>b.y+b.h+24||outside&&point.y>b.y+48?'front':'rear';
  }
  // Enter the courtyard only after the whole character clears the rear corner.
  return point.y<b.y-48&&point.x>b.x+32&&point.x<b.x+b.w-32?'rear':'front';
}
export function projectStreetPoint(point: Point, side: StreetSide): Point {
  if(side==='rear')return {x:STREET.width-point.x,y:STREET.height-point.y};
  return {x:point.x,y:point.y};
}
export function unprojectStreetPoint(point: Point, side: StreetSide): Point {
  if(side==='rear')return {x:STREET.width-point.x,y:STREET.height-point.y};
  return {x:point.x,y:point.y};
}
export function streetDirection(point: Point, side: StreetSide, _inverse=false): Point {
  if(side==='rear')return {x:-point.x,y:-point.y};
  return {...point};
}
export function streetPointVisible(point: Point, side: StreetSide): boolean {
  const b=STREET.building,margin=36;
  if(side==='rear')return point.y<=b.y+64;
  return point.y>=b.y+b.h-margin||point.x<=b.x+margin||point.x>=b.x+b.w-margin;
}
export class StreetView {
  side: StreetSide='front';
  overview=false;
  configure(point:Point,overview:boolean){
    const old=this.side,oldOverview=this.overview;
    this.side=streetSide(point,this.side);this.overview=overview;
    return old!==this.side||overview!==oldOverview;
  }
  get orientation():StreetSide{return this.overview?'front':this.side;}
  get size(){return {width:STREET.width,height:STREET.height};}
  get angle(){return this.orientation==='rear'?Math.PI:0;}
  point(point:Point,climbing=false){
    const result=projectStreetPoint(point,this.orientation);
    if(climbing&&!this.overview&&this.side==='rear'){
      const foot=projectStreetPoint(STREET_ROOF_STAIRS.foot,'rear');
      result.x=foot.x+(result.x-foot.x)*1.65;
      let rise=STREET_ROOF_STAIRS.foot.y-point.y;
      for(const [from,to] of [[2,3],[4,5],[6,7]])rise-=Math.max(0,Math.min(ROOF_STAIR_ROUTE[from].y-point.y,ROOF_STAIR_ROUTE[from].y-ROOF_STAIR_ROUTE[to].y));
      result.y=foot.y-rise*2.6;
    }
    return result;
  }
  world(point:Point){return unprojectStreetPoint(point,this.orientation);}
  facing(facing:Facing):Facing{
    const directions={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const p=streetDirection(directions[facing],this.orientation);
    return p.x<0?'left':p.x>0?'right':p.y<0?'up':'down';
  }
  visible(point:Point){return this.overview||streetPointVisible(point,this.side);}
  depth(point:Point,climbing=false){
    const y=this.point(point,climbing).y;
    if(this.overview)return y;
    if(climbing)return this.wall.base+10;
    // Walkable side paths must stay in front of the facade's flat screen edge.
    return y<this.wall.base?this.wall.base+6+y/1000:y;
  }
  get wall(){
    const b=STREET.building;
    const points=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}].map(p=>this.point(p));
    const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
    return {left,right,width:right-left,base:Math.max(...points.map(p=>p.y))};
  }
}
