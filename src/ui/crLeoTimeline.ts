import { shotZone, type PenaltyHero, type PenaltyRisk, type PenaltyShot } from '../shared/crLeo';
import { isWallHit, wallCrossing } from './crLeoFreeKick';

export const PENALTY_CONTACT = 1.12;
export const PENALTY_RESULT = 1.70;
export const PENALTY_READY = 2.35;
export const PENALTY_CELEBRATION = 4.3;
export function shotTiming(risk: PenaltyRisk = 'safe', shot?: PenaltyShot) {
  const flightEnd = risk === 'extreme' ? 2.50 : risk === 'sharp' ? 2.12 : PENALTY_RESULT;
  const result = isWallHit(shot, risk) ? PENALTY_CONTACT + (flightEnd - PENALTY_CONTACT) * wallCrossing(risk) : flightEnd;
  return { contact: PENALTY_CONTACT, flightEnd, result, ready: flightEnd + .65, celebration: result + .20 };
}
/** Keep the ball readable at the goal while retaining perspective along the flight. */
export function shotBallRadius(height: number, risk: PenaltyRisk, progress = 0, blocked = false) {
  const u = Math.max(0, Math.min(1, progress)), crossing = wallCrossing(risk);
  const scale = blocked && u > crossing ? 1-crossing*.70+(u-crossing)*.20 : 1-u*(risk==='extreme'?.80:risk==='sharp'?.70:.60);
  return Math.max(5.5, height*.015, Math.max(8, height*.028)*scale);
}
/** Cosmetic spin starts at contact, mirrors the kicking foot and settles after impact. */
export function shotBallRotation(t: number, hero: PenaltyHero, risk: PenaltyRisk, result = PENALTY_RESULT, held = false) {
  const rate = risk === 'safe' ? 13 : risk === 'sharp' ? 15 : 17;
  const elapsed = Math.max(0, t - PENALTY_CONTACT), duration = Math.max(0, result - PENALTY_CONTACT);
  const after = Math.max(0, elapsed - duration);
  const rotation = rate * (Math.min(elapsed, duration) + (held ? 0 : .28 * (1 - Math.exp(-after / .28))));
  return (hero === 'cr' ? 1 : -1) * rotation;
}
export const strikeAnchors = { cr: { x: .79, y: .88 }, leo: { x: .22, y: .87 } } as const;
export function strikePlacement(hero: PenaltyHero, ball: {x:number;y:number}, size: number, radius = 0) {
  const toe = strikeAnchors[hero];
  const sign = hero === 'cr' ? 1 : -1;
  // Meet the near surface with the instep instead of putting the toe in the centre.
  return { x: ball.x - sign * radius * .8 - (toe.x - .5) * size, bottom: ball.y + radius * .6 + (.94 - toe.y) * size };
}
export function shotPose(t: number, hero: PenaltyHero, shot?: PenaltyShot, risk?: PenaltyRisk): number {
  const timing = shotTiming(shot?.risk ?? risk, shot);
  if (t < .46) return 0;
  if (t < .68) return 1;
  if (t < .89) return 2;
  if (t < PENALTY_CONTACT) return 3;
  if (t < 1.25) return 4;
  if (t < 1.48) return 5;
  if (t < timing.result) return 6;
  if (shot && !shot.goal) return hero === 'cr' ? t < timing.result + .85 ? 12 : t < timing.result + 1.70 ? 13 : 14 : t < timing.result + .85 ? 12 : 13;
  return t < timing.ready ? 7 : 0;
}
export function celebrationPose(t: number, hero: PenaltyHero): number {
  if (hero === 'cr') return t < .45 ? 8 : t < .80 ? 9 : t < 1.35 ? 10 : 11;
  return t < .55 ? 8 : t < 1.10 ? 9 : t < 1.75 ? 10 : 11;
}
export function flightPosition(t: number, from: {x:number;y:number}, to: {x:number;y:number}, arc = .20, bend = 0) {
  const u = Math.max(0, Math.min(1, (t - PENALTY_CONTACT) / (PENALTY_RESULT - PENALTY_CONTACT)));
  return { x: from.x + (to.x - from.x) * u + Math.sin(Math.PI * u) * bend, y: from.y + (to.y - from.y) * u - Math.sin(Math.PI * u) * Math.abs(from.y - to.y) * arc, u };
}
export type GoalGeometry = { x: number; bottom: number; width: number; height: number };
export function shotTarget(shot: PenaltyShot, goal: GoalGeometry) {
  const zone = shotZone(shot), left = goal.x - goal.width / 2, top = goal.bottom - goal.height;
  let x = left + goal.width * zone.x, y = top + goal.height * zone.y;
  if (shot.finish === 'post') { if (zone.column === 0 || zone.column === 5) x = goal.x + zone.side * goal.width / 2; else y = top; }
  if (shot.finish === 'wide') { if (zone.row === 0) y = top - goal.height * .35; else x = goal.x + zone.side * goal.width * .68; }
  return { x, y };
}
/** Align the actual glove centroid with the ball, regardless of keeper pose or height. */
export function keeperPlacement(ball: {x:number;y:number}, hand: {x:number;y:number}, size: number) {
  return { x: ball.x - (hand.x - .5) * size, bottom: ball.y - (hand.y - .94) * size };
}
