import type { Point } from './navigation';
import type { Facing } from '../shared/movement';
import { STREET } from '../shared/street';
import { STREET_ROOF_STAIRS } from '../shared/rooftop';

export type StreetSide = 'front' | 'right' | 'rear' | 'left';
export function streetSide(point: Point, previous: StreetSide = 'front'): StreetSide {
  const b=STREET.building,margin=24;
  if(point.y>b.y+b.h+margin)return 'front';
  if(point.y<b.y-margin)return 'rear';
  if(point.x<b.x-margin)return 'left';
  if(point.x>b.x+b.w+margin)return 'right';
  return previous;
}
export function projectStreetPoint(point: Point, side: StreetSide): Point {
  if(side==='right')return {x:STREET.height-point.y,y:point.x};
  if(side==='rear')return {x:STREET.width-point.x,y:STREET.height-point.y};
  if(side==='left')return {x:point.y,y:STREET.width-point.x};
  return {x:point.x,y:point.y};
}
export function unprojectStreetPoint(point: Point, side: StreetSide): Point {
  if(side==='right')return {x:point.y,y:STREET.height-point.x};
  if(side==='rear')return {x:STREET.width-point.x,y:STREET.height-point.y};
  if(side==='left')return {x:STREET.width-point.y,y:point.x};
  return {x:point.x,y:point.y};
}
export function streetDirection(point: Point, side: StreetSide, inverse=false): Point {
  if(side==='rear')return {x:-point.x,y:-point.y};
  if(side==='right')return inverse?{x:point.y,y:-point.x}:{x:-point.y,y:point.x};
  if(side==='left')return inverse?{x:-point.y,y:point.x}:{x:point.y,y:-point.x};
  return {...point};
}
export function streetPointVisible(point: Point, side: StreetSide): boolean {
  const b=STREET.building,margin=36;
  if(side==='rear')return point.y<=b.y+margin;
  if(side==='right')return point.x>=b.x+b.w-margin;
  if(side==='left')return point.x<=b.x+margin;
  return point.y>=b.y+b.h-margin;
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
  get size(){return this.orientation==='left'||this.orientation==='right'?{width:STREET.height,height:STREET.width}:{width:STREET.width,height:STREET.height};}
  get angle(){return ({front:0,right:Math.PI/2,rear:Math.PI,left:-Math.PI/2})[this.orientation];}
  point(point:Point,climbing=false){
    const result=projectStreetPoint(point,this.orientation);
    if(climbing&&!this.overview&&this.side==='rear')result.y-=2*(STREET_ROOF_STAIRS.foot.y-point.y);
    return result;
  }
  world(point:Point){return unprojectStreetPoint(point,this.orientation);}
  facing(facing:Facing):Facing{
    const directions={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
    const p=streetDirection(directions[facing],this.orientation);
    return p.x<0?'left':p.x>0?'right':p.y<0?'up':'down';
  }
  visible(point:Point){return this.overview||streetPointVisible(point,this.side);}
  get wall(){
    const b=STREET.building;
    const points=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}].map(p=>this.point(p));
    const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
    return {left,right,width:right-left,base:Math.max(...points.map(p=>p.y))};
  }
}
