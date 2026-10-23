import type { Obstacle } from '../game/navigation';

// Visual dimensions and solid bounds share one source of truth.
export const FURNITURE = {
  pool: { x:562,y:484,width:208,height:134,scale:1.05,solid:{x:0,y:0,w:204,h:130} },
  sofa: { x:222,y:458,width:158,height:82,scale:1.18,solid:{x:4,y:5,w:150,h:74} },
  table: { x:1550,y:916,width:112,height:66,scale:1,solid:{x:3,y:3,w:104,h:59} },
} as const;
export const BAR_POSITION = {x:140,y:340} as const;
// Counter art, staff, visitors and server interactions use the same local coordinates.
export const barPoint = (x:number,y:number) => ({x:BAR_POSITION.x+x,y:BAR_POSITION.y+y});
export const BAR_SERVICE = {...barPoint(-21,175),w:285,h:108} as const;
export const PLANTS = [{x:105,y:254,scale:1.05},{x:968,y:251,scale:1.05},{x:980,y:621,scale:1.12}] as const;
export const plantBounds = (p: typeof PLANTS[number]): Obstacle => ({x:p.x-15*p.scale,y:p.y-37*p.scale,w:32*p.scale,h:29*p.scale});
export const BAR_SOLID: Obstacle = {...BAR_POSITION,w:262,h:163};
export function furnitureBounds(item: typeof FURNITURE[keyof typeof FURNITURE]): Obstacle {
  return {x:item.x-item.width*item.scale/2+item.solid.x*item.scale,y:item.y-item.height*item.scale+item.solid.y*item.scale,w:item.solid.w*item.scale,h:item.solid.h*item.scale};
}
