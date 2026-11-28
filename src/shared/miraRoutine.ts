import type { Facing } from './movement';
import { barPoint } from './furniture';

export type MiraMood = 'smile' | 'tease' | 'concern';
export type MiraAction = 'walk' | 'polish' | 'wipe' | 'stock' | 'idle' | 'serve' | 'chat' | 'sit' | 'sit-down' | 'stand-up' | 'greet' | 'listen' | MiraMood;
/** A reply's mood rides on the speaking signal, so the whole hall sees the same short reaction. */
export type MiraAttention = 'closed' | 'greet' | 'listen' | 'speak' | `speak-${MiraMood}`;
export const MIRA_ATTENTION_PHASES: readonly MiraAttention[] = ['closed','greet','listen','speak','speak-smile','speak-tease','speak-concern'];
export const miraSpeaks = (attention: MiraAttention) => attention.startsWith('speak');
const moodOf = (attention: MiraAttention): MiraMood | null => attention.startsWith('speak-') ? attention.slice(6) as MiraMood : null;
export type MiraView = { x: number; y: number; facing: Facing; action: MiraAction; progress: number };
export const MIRA_HOME = barPoint(125,116);
export const MIRA_SEAT = barPoint(78,134);
export const MIRA_COUNTER_FRONT_Y = barPoint(0,129).y;
export const MIRA_TRANSITION_SECONDS = .96;
export const MIRA_REST_SECONDS = 10;
export const MIRA_SERVICE_SECONDS = 3.2;
export const MIRA_REACTION_SECONDS = 1.3;
/** World pixels per 24-frame walk cycle (two steps), measured on the painted walk sheet. */
export const MIRA_STRIDE = 76;
const WORK_SPEED = 52, ATTENTION_SPEED = 75, BREAK_SPEED = 85, HURRY_SPEED = 105;
const jobs: { x: number; y: number; action: MiraAction; duration: number; facing: Facing }[] = [
  { ...MIRA_HOME, action: 'polish', duration: 7, facing: 'down' },
  { ...MIRA_HOME, action: 'sit', duration: MIRA_REST_SECONDS, facing: 'down' },
  // Back behind the counter after her rest she looks over the hall before the next job.
  { ...MIRA_HOME, action: 'idle', duration: 3.5, facing: 'down' },
  { ...barPoint(51,116), action: 'wipe', duration: 6, facing: 'down' },
  { ...barPoint(195,106), action: 'stock', duration: 5, facing: 'up' },
  { ...barPoint(166,116), action: 'polish', duration: 8, facing: 'down' },
  { ...barPoint(166,116), action: 'idle', duration: 3, facing: 'down' },
  { ...barPoint(194,116), action: 'wipe', duration: 6, facing: 'down' },
];
/** Eases the first and last few pixels of a walk so she starts and stops instead of sliding at full speed. */
const ramp = (done: number, left: number, distance = 12) => Math.max(.3, Math.min(1, .3 + Math.min(done, left) / distance));

const ease = (p: number) => { const x = Math.max(0, Math.min(1, p)); return x * x * (3 - 2 * x); };
export function miraSeatAmount(action: MiraAction, progress: number) {
  if (action === 'sit') return 1;
  if (action !== 'sit-down' && action !== 'stand-up') return 0;
  const seating = action === 'sit-down' ? progress : 1 - progress;
  return ease((seating - .13) / .47);
}

type BreakPhase = 'out' | 'sit-down' | 'sit' | 'stand-up' | 'return';
type Point = { x: number; y: number };

// Rounded waypoints clear the left side of the counter and keep Mira above the stools.
const counterWaypoints = [MIRA_HOME, barPoint(-22,116), barPoint(-45,121), barPoint(-53,130),
  barPoint(-44,142), barPoint(-20,146), barPoint(18,144), barPoint(69,137), MIRA_SEAT];
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const counterRoute = [counterWaypoints[0]];
for (let i = 1; i < counterWaypoints.length - 1; i++) {
  const corner = counterWaypoints[i];
  const enter = mix(corner, counterWaypoints[i-1], .27), leave = mix(corner, counterWaypoints[i+1], .27);
  for (let n = 0; n <= 7; n++) {
    const t = n / 7;
    counterRoute.push(mix(mix(enter, corner, t), mix(corner, leave, t), t));
  }
}
counterRoute.push(MIRA_SEAT);
const routeDistances = [0];
for (let i = 1; i < counterRoute.length; i++) {
  const a = counterRoute[i-1], b = counterRoute[i];
  routeDistances.push(routeDistances[i-1] + Math.hypot(b.x-a.x, b.y-a.y));
}
const routeLength = routeDistances[routeDistances.length-1];

/** One room-owned timeline controls positions, transitions and meaningful gestures. */
export class MiraRoutine {
  readonly state: MiraView = { ...MIRA_HOME, facing: 'down', action: 'polish', progress: 0 };
  private job = 0;
  private elapsed = 0;
  private breakPhase: BreakPhase | null = null;
  private breakElapsed = 0;
  private breakDistance = 0;
  private activity = '';
  private activityElapsed = 0;
  private attentionActive = false;
  private greetingPending = false;
  private greetingElapsed = 0;
  private servicePending = false;
  private previousServing = false;
  private legStart: { to: Point; x: number; y: number } | null = null;
  tick(delta: number, serving = false, chatting = false, attention: MiraAttention = 'closed') {
    const dt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, .1));
    const task = jobs[this.job];
    if (attention !== 'closed' && !this.attentionActive) { this.greetingPending = true; this.greetingElapsed = 0; }
    if (attention === 'closed') this.greetingPending = false;
    this.attentionActive = attention !== 'closed';
    if(serving&&!this.previousServing)this.servicePending=true;
    this.previousServing=serving;
    if(this.state.action==='serve'&&this.state.progress>=1&&!serving)this.servicePending=false;
    const service=serving||this.servicePending;
    const key = service ? 'serve' : attention !== 'closed' ? miraSpeaks(attention) ? 'speak' : attention : chatting ? 'chat' : '';
    if (key !== this.activity) { this.activity = key; this.activityElapsed = 0; }
    if (this.breakPhase) {
      this.tickBreak(dt, Boolean(key));
      return;
    }
    const destination = key || task.action === 'sit' ? MIRA_HOME : task;
    const dx = destination.x - this.state.x, dy = destination.y - this.state.y, distance = Math.hypot(dx, dy);
    if (distance > .1) {
      if (this.legStart?.to !== destination) this.legStart = { to: destination, x: this.state.x, y: this.state.y };
      const done = Math.hypot(this.state.x - this.legStart.x, this.state.y - this.legStart.y);
      const amount = Math.min(distance, dt * (key ? ATTENTION_SPEED : WORK_SPEED) * ramp(done, distance));
      const walkPhase = this.state.action === 'walk' ? this.state.progress : 0;
      this.state.x += dx / distance * amount; this.state.y += dy / distance * amount;
      // Only side walks are painted: on a mostly vertical leg she keeps the side she was already facing.
      const side = this.state.action === 'walk' && (this.state.facing === 'left' || this.state.facing === 'right') ? this.state.facing : null;
      this.state.action = 'walk'; this.state.facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : side ?? (dx < 0 ? 'left' : 'right');
      // The step follows the distance covered, so the painted feet never slide.
      this.state.progress = (walkPhase + amount / MIRA_STRIDE) % 1;
      return;
    }
    this.legStart = null;
    this.state.x = destination.x; this.state.y = destination.y;
    if (key) {
      this.activityElapsed += dt;
      if(!service&&this.greetingPending) {this.greetingElapsed+=dt;if(this.greetingElapsed>=1.2)this.greetingPending=false;}
      const mood = !service && !this.greetingPending && key === 'speak' && this.activityElapsed < MIRA_REACTION_SECONDS ? moodOf(attention) : null;
      this.state.action = service ? 'serve' : this.greetingPending || attention === 'greet' ? 'greet' : mood ?? (attention === 'listen' ? 'listen' : 'chat');
      this.state.facing = chatting && attention === 'closed' ? 'left' : 'down';
      this.state.progress = service ? Math.min(1, this.activityElapsed / MIRA_SERVICE_SECONDS)
        : this.state.action === 'greet' ? Math.min(1, this.greetingElapsed / 1.2)
        : mood ? Math.min(1, this.activityElapsed / MIRA_REACTION_SECONDS) : (this.activityElapsed % 4) / 4;
      return;
    }
    if (task.action === 'sit') {
      this.breakPhase = 'out';
      this.breakDistance = 0;
      this.tickBreak(dt, false);
      return;
    }
    this.state.action = task.action; this.state.facing = task.facing;
    this.elapsed += dt; this.state.progress = Math.min(1, this.elapsed / task.duration);
    if (this.elapsed >= task.duration) this.advanceJob();
  }

  private advanceJob() {
    this.job = (this.job + 1) % jobs.length;
    this.elapsed = 0;
  }

  private tickBreak(dt: number, interrupted: boolean) {
    if (interrupted && (this.breakPhase === 'out' || this.breakPhase === 'sit-down' && this.state.action === 'walk')) {
      this.breakPhase = 'return';
    }
    if (interrupted && (this.breakPhase === 'sit-down' || this.breakPhase === 'sit')) {
      const reversed = this.breakPhase === 'sit-down' && this.state.action === 'sit-down';
      this.breakElapsed = reversed ? MIRA_TRANSITION_SECONDS - this.breakElapsed : 0;
      this.breakPhase = 'stand-up';
      this.state.action = 'stand-up';
      this.state.progress = this.breakElapsed / MIRA_TRANSITION_SECONDS;
      return;
    }
    const phase = this.breakPhase;
    if (!phase) return;
    if (phase === 'out' || phase === 'return') {
      const direction = phase === 'out' ? 1 : -1;
      const speed = interrupted ? HURRY_SPEED : BREAK_SPEED * ramp(this.breakDistance, routeLength - this.breakDistance, 8);
      const previous = this.breakDistance;
      this.breakDistance = Math.max(0, Math.min(routeLength, this.breakDistance + direction * speed * dt));
      const covered = Math.abs(this.breakDistance - previous);
      const next = routeDistances.findIndex(distance => distance > this.breakDistance);
      const index = next < 0 ? counterRoute.length - 2 : next - 1;
      const a = counterRoute[index], b = counterRoute[index+1];
      const progress = (this.breakDistance - routeDistances[index]) / (routeDistances[index+1] - routeDistances[index]);
      const feet = mix(a, b, progress);
      const walkPhase = this.state.action === 'walk' ? this.state.progress : 0;
      Object.assign(this.state, feet, { action: 'walk', facing: (b.x-a.x)*direction >= 0 ? 'right' : 'left', progress: (walkPhase + covered / MIRA_STRIDE) % 1 });
      if (direction === 1 && this.breakDistance === routeLength) {
        this.breakPhase = 'sit-down';
        this.breakElapsed = 0;
      } else if (direction === -1 && this.breakDistance === 0) {
        this.breakPhase = null;
        this.advanceJob();
      }
      return;
    }
    if (this.state.action !== phase) {
      Object.assign(this.state, { action: phase, facing: 'down', progress: 0 });
      return;
    }
    const duration = phase === 'sit' ? MIRA_REST_SECONDS : MIRA_TRANSITION_SECONDS;
    this.breakElapsed = Math.min(duration, this.breakElapsed + dt);
    this.state.action = phase;
    this.state.facing = 'down';
    this.state.progress = this.breakElapsed / duration;
    if (this.breakElapsed === duration) {
      this.breakPhase = phase === 'sit-down' ? 'sit' : phase === 'sit' ? 'stand-up' : 'return';
      this.breakElapsed = 0;
    }
  }
}
