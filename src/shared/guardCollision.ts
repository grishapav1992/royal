export type GuardCollider = { x:number; y:number; hall:string; phase:string };
export const GUARD_CONTACT_RADIUS = 36;

// Feet form solid circles; moving out of an existing overlap is always allowed.
export function blockedByGuard(body:{x:number;y:number;hall?:string},x:number,y:number,guards:readonly GuardCollider[]) {
  return guards.some(g=>g.hall===body.hall&&g.phase!=='door'&&
    Math.hypot(x-g.x,y-g.y)<GUARD_CONTACT_RADIUS&&
    Math.hypot(x-g.x,y-g.y)<Math.hypot(body.x-g.x,body.y-g.y)-.0001);
}
