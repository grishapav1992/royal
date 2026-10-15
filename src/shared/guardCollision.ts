export type GuardCollider = { x:number; y:number; hall:string; phase:string };
export const GUARD_CONTACT_RADIUS = 36;

// Feet form solid circles; moving out of an existing overlap is always allowed.
export function blockedByGuard(body:{x:number;y:number;hall?:string},x:number,y:number,guards:readonly GuardCollider[],fromX=body.x,fromY=body.y) {
  for (const guard of guards) {
    if (guard.hall !== body.hall || guard.phase === 'door') continue;
    const dx = x - guard.x, dy = y - guard.y;
    if (Math.abs(dx) >= GUARD_CONTACT_RADIUS || Math.abs(dy) >= GUARD_CONTACT_RADIUS) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < GUARD_CONTACT_RADIUS && distance < Math.hypot(fromX - guard.x, fromY - guard.y) - .0001) return true;
  }
  return false;
}
