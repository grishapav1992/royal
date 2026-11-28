import { advanceRoofStairStep,moveRoofStairs,settleRoofStairLanding,roofStairApproach,ROOF_STAIR_SPEED_SCALE,STREET_ROOF_STAIRS } from './rooftop';
export type Facing = 'down' | 'left' | 'right' | 'up';
import { walkable } from '../game/navigation';
import { PLAYER_SPEED, PLAYER_SPRINT_SPEED, hallObstacles, SEATS } from './world';
import { blockedByGuard, type GuardCollider } from './guardCollision';
import { intoxicatedMovement } from './intoxication';
import { leapDirection, leapLanding, type LeapKind } from './leap';

export type MovementInput = { seq: number; x: number; y: number; ms: number; sprint?: boolean; route?: boolean; leap?: LeapKind };
export type MovementBody = { hall?: string; stairStep?: number; stairDirection?:number; soberAt?: number; x: number; y: number; facing: string; moving: boolean; seat: string; action: string; drink: string; actionUntil: number;
  // A leap lands at once, then the following input time pays for the distance, so it never outruns a sprint.
  leapDebt?: number; leapSerial?: number; leapKind?: string; leapFromX?: number; leapFromY?: number };

/** Jump (any time) or slide (while sprinting) along the input direction, or the facing when standing. */
function applyLeap(body: MovementBody, input: MovementInput, guards: readonly GuardCollider[]) {
  const kind = input.leap;
  if (!kind || body.seat || body.action === 'drink' || (body.stairStep ?? 0) > 0) return;
  if (kind === 'slide' && input.sprint !== true) return;
  const direction = leapDirection(input.x, input.y, body.facing);
  // A blocked jump still hops on the spot, so the key always answers; a blocked slide does nothing.
  const landing = leapLanding(body, kind, direction, guards) ?? (kind === 'jump' ? { x: body.x, y: body.y } : null);
  if (!landing) return;
  const distance = Math.hypot(landing.x - body.x, landing.y - body.y);
  body.leapFromX = body.x; body.leapFromY = body.y; body.leapKind = kind;
  body.leapSerial = (body.leapSerial ?? 0) + 1;
  body.leapDebt = (body.leapDebt ?? 0) + distance;
  body.x = landing.x; body.y = landing.y;
  body.facing = movementFacing(direction.x, direction.y, body.facing as Facing);
}

/** Shared collision integration for local prediction, server validation and replay. */
export function applyMovementInput(body: MovementBody, input: MovementInput, guards:readonly GuardCollider[] = []) {
  let contact=false;
  applyLeap(body, input, guards);
  const length = Math.hypot(input.x, input.y);
  body.moving = false;
  if (!length) {if(body.hall==='street')settleRoofStairLanding(body);return;}
  const seat = SEATS.find(s => s.id === body.seat);
  if (seat) { body.x = seat.entry.x; body.y = seat.entry.y; }
  body.seat = ''; body.action = 'idle'; body.drink = ''; body.actionUntil = 0;
  const beforeX = body.x, beforeY = body.y;
  const impaired = intoxicatedMovement(body.soberAt ?? 0, input);
  if(body.hall==='street'&&moveRoofStairs(body,input,(input.sprint===true?PLAYER_SPRINT_SPEED:PLAYER_SPEED)*ROOF_STAIR_SPEED_SCALE*impaired.speedMultiplier*input.ms/1000)){
    if(body.moving)body.facing=movementFacing(body.x-beforeX,body.y-beforeY,body.facing as Facing);
    return;
  }
  const approach=body.hall==='street'?roofStairApproach(body,input,(input.sprint?PLAYER_SPRINT_SPEED:PLAYER_SPEED)*impaired.speedMultiplier*input.ms/1000):null;
  if(approach){
    if(walkable(approach.x,approach.y,hallObstacles('street'))){
      if(blockedByGuard(body,approach.x,approach.y,guards))contact=true;
      else{
        body.x=approach.x;body.y=approach.y;
        if(Math.hypot(body.x-STREET_ROOF_STAIRS.foot.x,body.y-STREET_ROOF_STAIRS.foot.y)<=7){body.x=STREET_ROOF_STAIRS.foot.x;body.y=STREET_ROOF_STAIRS.foot.y;body.stairStep=1;body.stairDirection=1;}
      }
    }
    body.moving=Math.hypot(body.x-beforeX,body.y-beforeY)>.001;
    if(body.moving)body.facing=movementFacing(body.x-beforeX,body.y-beforeY,body.facing as Facing);
    return contact;
  }
  // Click routes retain their checked direction while keeping the same speed impairment.
  if (input.route === true) { impaired.x = input.x / length; impaired.y = input.y / length; }
  let distance = (input.sprint === true ? PLAYER_SPRINT_SPEED : PLAYER_SPEED) * impaired.speedMultiplier * input.ms / 1000 / 3;
  if (body.leapDebt) {
    const paid = Math.min(body.leapDebt, distance * 3);
    body.leapDebt -= paid; distance -= paid / 3;
  }
  for (let step = 0; step < 3; step++) {
    const x = impaired.x * distance, y = impaired.y * distance;
    if (walkable(body.x + x, body.y, hallObstacles(body.hall))) {
      if(blockedByGuard(body,body.x+x,body.y,guards))contact=true;else body.x+=x;
    }
    if (walkable(body.x, body.y + y, hallObstacles(body.hall))) {
      if(blockedByGuard(body,body.x,body.y+y,guards))contact=true;else body.y+=y;
    }
  }
  if(body.hall==='street'){
    const previous=body.stairStep??0;body.stairStep=advanceRoofStairStep(previous,body);
    if(!previous&&body.stairStep===1){body.x=STREET_ROOF_STAIRS.foot.x;body.y=STREET_ROOF_STAIRS.foot.y;body.stairDirection=1;}
  }
  else if(body.stairStep)body.stairStep=0;
  const dx = body.x-beforeX, dy = body.y-beforeY;
  body.moving = Math.hypot(dx, dy) > .01;
  if (body.moving) body.facing = movementFacing(dx, dy, body.facing as Facing);
  return contact;
}

/** Keep a compatible facing near diagonals so rounding cannot restart the walk cycle. */
export function movementFacing(dx: number, dy: number, previous: Facing): Facing {
  const x = Math.abs(dx), y = Math.abs(dy);
  if (x + y < 1e-6) return previous;
  const horizontal = dx < 0 ? 'left' : 'right';
  const vertical = dy < 0 ? 'up' : 'down';
  if (x > y * 1.15) return horizontal;
  if (y > x * 1.15) return vertical;
  return previous === horizontal || previous === vertical ? previous : vertical;
}
