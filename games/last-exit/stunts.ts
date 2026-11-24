import type { RacePhase } from './model';
import { ease } from './scene-kit';
export type StuntVariant = 'helicopter' | 'cargo-plane' | 'tunnel' | 'pit-left' | 'pit-right' | 'drive';
export const impactAt = .4, rollAt = .72, explosionAt = 3.48;
export const heli = { cables: .8, lift: 2.25, meet: 2.35, depart: 4.1, end: 7.6 };
export const cargo = { planeAt: 1.15, planeReady: 2.9, rampNear: 3.05, takeoff: 3.5, landing: 4.55, inside: 5.05, departure: 5.25, exit: 9 };
export const tunnel = { brake: .5, turn: 1.15, left: 2.6, stop: 2.3, inside: 3.1, slide: 3.75, end: 8 };
/** Distance from the gore to the tunnel mouth. */
export const MOUTH = 2.6;
/** Moment the closing title appears, in presentation seconds. The payout is already on the sign. */
export const titleAt: Record<StuntVariant, number> = { helicopter: heli.depart + 1.4, 'cargo-plane': cargo.departure + .7, tunnel: tunnel.slide + 2.1, 'pit-left': explosionAt + 1.5, 'pit-right': explosionAt + 1.5, drive: 0 };
export function runHash(id: string) { let hash = 2166136261; for (const char of id)
 hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0; return hash; }
/** Cosmetic selection uses only the public round ID and its confirmed terminal phase. */
export function pickStunt(runId: string, phase: RacePhase, value = 1): StuntVariant {
 if (phase !== 'crashed' && phase !== 'escaped')
  return 'drive';
 if (phase === 'escaped') {
  const cents = Math.round(value * 100);
  return cents >= 800 ? 'tunnel' : cents > 200 ? 'cargo-plane' : 'helicopter';
 }
 return (['pit-left', 'pit-right'] as const)[runHash(runId) % 2];
}
/** Cosmetic session sequence, stable for redraws and revisited recent rounds. */
export class CrashStuntSequence {
 private rounds = new Map<string, StuntVariant>();
 private previous?: StuntVariant;
 choose(runId: string, phase: RacePhase, value = 1): StuntVariant {
  if (phase !== 'crashed')
   return pickStunt(runId, phase, value);
  const cached = this.rounds.get(runId);
  if (cached)
   return cached;
  const variant = this.previous ? (this.previous === 'pit-left' ? 'pit-right' : 'pit-left') : pickStunt(runId, phase, value);
  this.previous = variant;
  this.rounds.set(runId, variant);
  if (this.rounds.size > 64)
   this.rounds.delete(this.rounds.keys().next().value!);
  return variant;
 }
}
const crashSequence = new CrashStuntSequence();
export const nextStunt = (id: string, phase: RacePhase, value = 1) => crashSequence.choose(id, phase, value);
export function cinematicLabel(phase: RacePhase, variant: StuntVariant, age: number, holding = false): string {
 if (phase === 'crashed')
  return age < rollAt ? 'intercept' : age < explosionAt ? 'depth-rollover' : 'explosion';
 if (phase !== 'escaped')
  return phase;
 if (holding)
  return 'passing-bridge';
 if (variant === 'helicopter')
  return age < heli.cables ? 'helicopter-approach' : age < heli.lift ? 'cables-descending' : age < heli.depart ? 'airlift' : age < heli.end ? 'fly-away' : 'extracted';
 if (variant === 'cargo-plane')
  return age < cargo.planeAt ? 'ramp-distant' : age < cargo.rampNear ? 'aircraft-approach' : age < cargo.takeoff ? 'ramp-climb' : age < cargo.landing ? 'cargo-jump' : age < cargo.departure ? 'cargo-entry' : age < cargo.exit ? 'cargo-escape' : 'extracted';
 return age < tunnel.turn ? 'exit-approach' : age < tunnel.left ? 'exit-turn' : age < tunnel.slide ? 'tunnel-entry' : age < tunnel.end ? 'rockslide' : 'extracted';
}
/** The losing roll is integrated once: ballistic hops, a barrier strike, then a rest pose. */
export type Frame = {
 t: number;
 x: number;
 y: number;
 roll: number;
};
export function rollPath(dir: number, x0: number, start: number, end: number, reach: number) {
 const frames: Frame[] = [], contacts: number[] = [];
 let x = x0, vx = dir * .62, y = 0, vy = 1.32, roll = 0, wr = 10.5, wall = 0;
 const T = end - start;
 let k = 0;
 for (let t = 0; t <= T + .02; t += 1 / 120) {
  frames.push({ t: start + t, x, y, roll });
  vy -= 3.35 * (1 / 120);
  y += vy / 120;
  x += vx / 120;
  roll += wr / 120;
  if (!wall && dir * x > reach) {
   wall = start + t;
   vx = -vx * .5;
   wr *= .9;
   vy = Math.max(vy, .5);
  }
  if (y <= 0 && vy < 0) {
   y = 0;
   k++;
   contacts.push(start + t);
   vy = Math.max(.12, -vy * .7);
   vx *= .8;
   wr *= .88;
   if (T - t < .22) {
    vy = 0;
    wr *= .4;
   }
  }
 }
 // rest exactly on the roof
 const total = frames[frames.length - 1].roll, rest = Math.max(1, Math.round((total / Math.PI - 1) / 2) * 2 + 1) * Math.PI;
 for (const f of frames)
  f.roll *= rest / total;
 return { frames, contacts: contacts.slice(0, 8), wall, restX: x };
}
