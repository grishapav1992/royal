export type Facing = 'down' | 'left' | 'right' | 'up';
import { walkable } from '../game/navigation';
import { PLAYER_SPEED, PLAYER_SPRINT_SPEED, hallObstacles, SEATS } from './world';
import { blockedByGuard, type GuardCollider } from './guardCollision';
import { intoxicatedMovement } from './intoxication';

export type MovementInput = { seq: number; x: number; y: number; ms: number; sprint?: boolean };
export type MovementBody = { hall?: string; soberAt?: number; x: number; y: number; facing: string; moving: boolean; seat: string; action: string; drink: string; actionUntil: number };

/** Shared collision integration for local prediction, server validation and replay. */
export function applyMovementInput(body: MovementBody, input: MovementInput, guards:readonly GuardCollider[] = []) {
  let contact=false;
  const length = Math.hypot(input.x, input.y);
  if (!length) { body.moving = false; return; }
  const seat = SEATS.find(s => s.id === body.seat);
  if (seat) { body.x = seat.entry.x; body.y = seat.entry.y; }
  body.seat = ''; body.action = 'idle'; body.drink = ''; body.actionUntil = 0;
  const beforeX = body.x, beforeY = body.y;
  const impaired = intoxicatedMovement(body.soberAt ?? 0, input);
  const distance = (input.sprint === true ? PLAYER_SPRINT_SPEED : PLAYER_SPEED) * impaired.speedMultiplier * input.ms / 1000 / 3;
  const stepX = impaired.x * distance, stepY = impaired.y * distance;
  const obstacles = hallObstacles(body.hall);
  let nextX = beforeX, nextY = beforeY;
  // Integrate every collision substep locally, then publish the final position.
  // Schema setters need not track intermediate positions within one input.
  for (let step = 0; step < 3; step++) {
    if (stepX && walkable(nextX + stepX, nextY, obstacles)) {
      if(blockedByGuard(body,nextX+stepX,nextY,guards,nextX,nextY))contact=true;else nextX+=stepX;
    }
    if (stepY && walkable(nextX, nextY + stepY, obstacles)) {
      if(blockedByGuard(body,nextX,nextY+stepY,guards,nextX,nextY))contact=true;else nextY+=stepY;
    }
  }
  body.x = nextX; body.y = nextY;
  const dx = nextX-beforeX, dy = nextY-beforeY;
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
