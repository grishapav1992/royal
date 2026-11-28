import { walkable, type Point } from '../game/navigation';
import { obstacleKind } from './obstacleKinds';
import { blockedByGuard, type GuardCollider } from './guardCollision';
import { hallObstacles, PLAYER_SPRINT_SPEED } from './world';

export type LeapKind = 'jump' | 'slide';
export const LEAP_KINDS: readonly LeapKind[] = ['jump', 'slide'];

/**
 * A jump clears low furniture and cabinets, a slide passes under game tables.
 * Both stop at walls and solid fixtures and never pass through a guard.
 * The distances clear the deepest crossable obstacle plus the body radius on both sides.
 */
export const LEAP_RULES = {
  jump: { distance: 128, crosses: 'vault' },
  slide: { distance: 200, crosses: 'under' },
} as const;

/** The server accepts one leap per window. The client waits slightly longer, so jitter never rejects it. */
export const LEAP_COOLDOWN_MS = 900;
export const CLIENT_LEAP_COOLDOWN_MS = 1000;
/** The character is airborne for as long as running the same distance would take. */
export const leapDuration = (distance: number) => distance / PLAYER_SPRINT_SPEED * 1000;

const SAMPLE = 4, MIN_DISTANCE = 16, BODY_RADIUS = 12;
const FACING: Record<string, Point> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export function leapDirection(x: number, y: number, facing: string): Point {
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : FACING[facing] ?? FACING.down;
}

/** The farthest walkable landing along a straight line, or null when the leap cannot leave the spot. */
export function leapLanding(body: { x: number; y: number; hall?: string }, kind: LeapKind, direction: Point, guards: readonly GuardCollider[] = []): Point | null {
  const obstacles = hallObstacles(body.hall);
  const rule = LEAP_RULES[kind];
  const blocking = obstacles.filter(obstacle => obstacleKind(obstacle) !== rule.crosses);
  let reach = 0;
  for (let distance = SAMPLE; distance <= rule.distance; distance += SAMPLE) {
    const x = body.x + direction.x * distance, y = body.y + direction.y * distance;
    if (!walkable(x, y, blocking, BODY_RADIUS) || blockedByGuard(body, x, y, guards)) break;
    reach = distance;
  }
  for (let distance = reach; distance >= MIN_DISTANCE; distance -= SAMPLE) {
    const x = body.x + direction.x * distance, y = body.y + direction.y * distance;
    if (walkable(x, y, obstacles, BODY_RADIUS)) return { x, y };
  }
  return null;
}
