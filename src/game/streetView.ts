import type { Point } from './navigation';
import type { Facing } from '../shared/movement';
import { STREET } from '../shared/street';
import { STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE,ROOF_STAIR_DRAW } from '../shared/rooftop';

export type StreetSide = 'front' | 'rear';
export function streetSide(point: Point, previous: StreetSide = 'front'): StreetSide {
  const b=STREET.building;
  if(previous==='rear'){
    const outside=point.x<=b.x||point.x>=b.x+b.w;
    return point.y>b.y+b.h+24||outside&&point.y>b.y+48?'front':'rear';
  }
  // Enter the courtyard only after the whole character clears the rear corner.
  return point.y<b.y-48&&point.x>b.x+48&&point.x<b.x+b.w-48?'rear':'front';
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
  const b=STREET.building;
  if(side==='rear')return point.y<=b.y+64;
  return true;
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
      let closest=Infinity;
      for(let index=1;index<ROOF_STAIR_ROUTE.length;index++){
        const a=ROOF_STAIR_ROUTE[index-1],b=ROOF_STAIR_ROUTE[index],dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy)));
        const x=a.x+dx*t,y=a.y+dy*t,distance=(point.x-x)**2+(point.y-y)**2;
        if(distance>=closest)continue;
        closest=distance;const projected=projectStreetPoint({x,y},'rear');
        const fromRise=index===1?0:ROOF_STAIR_DRAW.ladderRise+(index-2)*ROOF_STAIR_DRAW.flightRise;
        const toRise=ROOF_STAIR_DRAW.ladderRise+(index-1)*ROOF_STAIR_DRAW.flightRise;
        result.x=foot.x+(projected.x-foot.x)*ROOF_STAIR_DRAW.widthScale;
        result.y=foot.y-fromRise-(toRise-fromRise)*t;
      }
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
  occluded(point:Point,halfWidth=30){
    if(this.overview)return false;
    const p=this.point(point),wall=this.wall;
    return p.y<wall.base&&p.x-halfWidth>=wall.left&&p.x+halfWidth<=wall.right;
  }
  depth(point:Point,climbing=false){
    const y=this.point(point,climbing).y;
    if(this.overview)return y;
    if(climbing)return this.wall.base+10;
    return y;
  }
  get wall(){
    const b=STREET.building;
    const points=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x,y:b.y+b.h},{x:b.x+b.w,y:b.y+b.h}].map(p=>projectStreetPoint(p,this.orientation));
    const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
    return {left,right,width:right-left,base:Math.max(...points.map(p=>p.y))};
  }
  get roofEdge(){return projectStreetPoint(STREET_ROOF_STAIRS.foot,'rear').y-ROOF_STAIR_DRAW.ladderRise-(ROOF_STAIR_ROUTE.length-2)*ROOF_STAIR_DRAW.flightRise;}
}
