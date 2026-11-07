import type { Facing } from './movement';
import { barPoint } from './furniture';

export type MiraAction = 'walk' | 'polish' | 'wipe' | 'stock' | 'idle' | 'serve' | 'chat' | 'sit' | 'sit-down' | 'stand-up' | 'greet' | 'listen';
export type MiraAttention = 'closed' | 'greet' | 'listen' | 'speak';
export type MiraView = { x: number; y: number; facing: Facing; action: MiraAction; progress: number };
export const MIRA_HOME = barPoint(125,116);
export const MIRA_SEAT = barPoint(78,134);
export const MIRA_COUNTER_FRONT_Y = barPoint(0,129).y;
export const MIRA_TRANSITION_SECONDS = .96;
const MIRA_REST_SECONDS = 1.92;
export const MIRA_SERVICE_SECONDS = 3.2;
const jobs: { x: number; y: number; action: MiraAction; duration: number; facing: Facing }[] = [
  { ...MIRA_HOME, action: 'polish', duration: 7, facing: 'down' },
  { ...MIRA_HOME, action: 'sit', duration: MIRA_REST_SECONDS, facing: 'down' },
  { ...barPoint(51,116), action: 'wipe', duration: 6, facing: 'down' },
  { ...barPoint(195,106), action: 'stock', duration: 5, facing: 'up' },
  { ...barPoint(166,116), action: 'polish', duration: 8, facing: 'down' },
  { ...barPoint(194,116), action: 'wipe', duration: 6, facing: 'down' },
];

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
    const key = service ? 'serve' : attention !== 'closed' ? attention : chatting ? 'chat' : '';
    if (key !== this.activity) { this.activity = key; this.activityElapsed = 0; }
    if (this.breakPhase) {
      this.tickBreak(dt, Boolean(key));
      return;
    }
    const destination = key || task.action === 'sit' ? MIRA_HOME : task;
    const dx = destination.x - this.state.x, dy = destination.y - this.state.y, distance = Math.hypot(dx, dy);
    if (distance > .1) {
      const amount = Math.min(distance, dt * (key ? 65 : 30));
      this.state.x += dx / distance * amount; this.state.y += dy / distance * amount;
      this.state.action = 'walk'; this.state.facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
      this.state.progress = (this.state.progress + dt * 1.6) % 1;
      return;
    }
    this.state.x = destination.x; this.state.y = destination.y;
    if (key) {
      this.activityElapsed += dt;
      if(!service&&this.greetingPending) {this.greetingElapsed+=dt;if(this.greetingElapsed>=1.2)this.greetingPending=false;}
      this.state.action = service ? 'serve' : this.greetingPending || attention === 'greet' ? 'greet' : attention === 'listen' ? 'listen' : 'chat';
      this.state.facing = chatting && attention === 'closed' ? 'left' : 'down';
      this.state.progress = service ? Math.min(1, this.activityElapsed / MIRA_SERVICE_SECONDS)
        : this.state.action === 'greet' ? Math.min(1, this.greetingElapsed / 1.2) : (this.activityElapsed % 4) / 4;
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
      const speed = interrupted ? 105 : 85;
      this.breakDistance = Math.max(0, Math.min(routeLength, this.breakDistance + direction * speed * dt));
      const next = routeDistances.findIndex(distance => distance > this.breakDistance);
      const index = next < 0 ? counterRoute.length - 2 : next - 1;
      const a = counterRoute[index], b = counterRoute[index+1];
      const progress = (this.breakDistance - routeDistances[index]) / (routeDistances[index+1] - routeDistances[index]);
      const feet = mix(a, b, progress);
      const walkPhase = this.state.action === 'walk' ? this.state.progress : 0;
      Object.assign(this.state, feet, { action: 'walk', facing: (b.x-a.x)*direction >= 0 ? 'right' : 'left', progress: (walkPhase + dt*1.6) % 1 });
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
