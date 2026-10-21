import { shotZone, type PenaltyHero, type PenaltyRisk, type PenaltyShot } from '../shared/crLeo';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const hermite = (a: number, b: number, start: number, end: number, v: number) => (2*v*v*v-3*v*v+1)*a+(v*v*v-2*v*v+v)*start+(-2*v*v*v+3*v*v)*b+(v*v*v-v*v)*end;
export const WALL_CROSSING = .43;
export const wallCrossing = (risk: PenaltyRisk) => risk === 'extreme' ? .30 : WALL_CROSSING;
export type Point = { x: number; y: number };
export type FreeKickWall = { x: number; bottom: number; size: number; spacing: number; height: number; count: 3 | 5; crossing: number; risk: PenaltyRisk };
export function isWallHit(shot?: PenaltyShot, risk?: PenaltyRisk) {
  if (!shot || shot.finish !== 'wide') return false;
  const kind = shot.risk ?? risk, column = shotZone(shot).column;
  return kind === 'sharp' ? column >= 1 && column <= 4 : kind === 'extreme' && (column === 2 || column === 3);
}
export function shotLayout(w: number, h: number, hero: PenaltyHero, risk: PenaltyRisk) {
  const near = risk === 'sharp', far = risk === 'extreme', free = near || far, sign = hero === 'cr' ? 1 : -1;
  const goal = { x: w * .5 + (free ? sign * Math.min(w * (far ? .035 : .07), h * (far ? .05 : .10)) : 0), bottom: h * (far ? .47 : near ? .49 : .55), width: Math.min(w * (far ? .55 : near ? .68 : .72), h * (far ? .54 : near ? .72 : .94)), height: 0 };
  goal.height = goal.width / 3;
  const ball = { x: w * .5, y: h * (far ? .85 : near ? .83 : .80) };
  const crossing = wallCrossing(risk);
  const wall: FreeKickWall | undefined = free ? { x: ball.x + (goal.x - ball.x) * crossing, bottom: h * (far ? .70 : .66), size: h * (far ? .36 : .34), spacing: Math.min(h * (far ? .10 : .085), w * .09), height: h, count: far ? 3 : 5, crossing, risk } : undefined;
  return { near, far, free, goal, ball, wall, keeperScale: free ? goal.width / (h * .94) : 1 };
}
export function wallMotion(u: number, height: number, hit = false, crossing = WALL_CROSSING) {
  const impacted = hit && u >= crossing;
  u *= WALL_CROSSING / crossing;
  if (u < -.16) return { row: 0, jump: 0 };
  if (u < .05) return { row: 1, jump: 0 };
  const jump = Math.sin(Math.PI * clamp((u - .05) / .72)) * height * .045;
  return { row: impacted ? 3 : u < .77 ? 2 : u < .92 ? 1 : 0, jump };
}
export function wallContact(shot: PenaltyShot, wall: FreeKickWall) {
  const z = shotZone(shot), player = (z.column + z.row) % wall.count;
  return { x: wall.x + (player - (wall.count - 1) / 2) * wall.spacing, y: wall.bottom - wall.size * .52 - wallMotion(wall.crossing, wall.height, false, wall.crossing).jump, player };
}
/** Presentation only: accepted outcomes and sectors remain entirely server controlled. */
export function freeKickFlight(u: number, from: Point, to: Point, wall: FreeKickWall, shot: PenaltyShot) {
  u = clamp(u);
  const crossing = wall.crossing, z = shotZone(shot), blocked = isWallHit(shot, wall.risk), around = z.row === 2 || z.row === 1 && (z.column === 0 || z.column === 5);
  const hit = wallContact(shot, wall), route = blocked ? 'wall' : around ? 'around' : 'over';
  const pass = blocked ? hit : around ? { x: wall.x + z.side * ((wall.count - 1) / 2 * wall.spacing + wall.size * .20 + wall.height * .025), y: wall.bottom - wall.height * .018 } : { x: from.x + (to.x - from.x) * crossing, y: wall.bottom - wall.size * .90 - wall.height * .080 };
  if (u <= crossing) {
    const v = u / crossing;
    if (blocked) return { x: from.x+(pass.x-from.x)*v, y: from.y+(pass.y-from.y)*v, u, route };
    return { x: around ? hermite(from.x,pass.x,(pass.x-from.x)*1.5,0,v) : from.x+(to.x-from.x)*u, y: hermite(from.y,pass.y,(pass.y-from.y)*1.5,(around?(to.y-from.y)*.7:-wall.height*.12)*crossing,v), u, route };
  }
  const v = (u - crossing) / (1 - crossing);
  if (blocked) return { x: hit.x - z.side * wall.height * .09 * v, y: hit.y + (wall.bottom + wall.height * .075 - hit.y) * v * v, u, route };
  return { x: around ? hermite(pass.x,to.x,0,(to.x-pass.x)*1.4,v) : from.x+(to.x-from.x)*u, y: hermite(pass.y,to.y,(around?(to.y-from.y)*.7:-wall.height*.12)*(1-crossing),(to.y-pass.y)*1.4,v), u, route };
}
