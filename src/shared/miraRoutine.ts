import type { Facing } from './movement';
import { barPoint } from './furniture';

export type MiraAction = 'walk' | 'polish' | 'wipe' | 'stock' | 'idle' | 'serve' | 'chat' | 'sit' | 'sit-down' | 'stand-up' | 'greet' | 'listen';
export type MiraAttention = 'closed' | 'greet' | 'listen' | 'speak';
export type MiraView = { x: number; y: number; facing: Facing; action: MiraAction; progress: number };
export const MIRA_HOME = barPoint(125,116);
export const MIRA_SEAT = barPoint(51,116);
// Game-specific initial art timings, to be checked in the real room.
export const MIRA_TRANSITION_SECONDS = .8;
export const MIRA_SERVICE_SECONDS = 3.2;
const jobs: { x: number; y: number; action: MiraAction; duration: number; facing: Facing }[] = [
  { ...MIRA_HOME, action: 'polish', duration: 7, facing: 'down' },
  { ...MIRA_SEAT, action: 'sit', duration: 10, facing: 'down' },
  { ...barPoint(51,116), action: 'wipe', duration: 6, facing: 'down' },
  { ...barPoint(195,106), action: 'stock', duration: 5, facing: 'up' },
  { ...barPoint(166,116), action: 'polish', duration: 8, facing: 'down' },
  { ...barPoint(194,116), action: 'wipe', duration: 6, facing: 'down' },
];

const ease = (p: number) => { const x = Math.max(0, Math.min(1, p)); return x * x * (3 - 2 * x); };
export function miraSeatAmount(action: MiraAction, progress: number) {
  return action === 'sit' ? 1 : action === 'sit-down' ? ease(progress) : action === 'stand-up' ? 1 - ease(progress) : 0;
}

/** One room-owned timeline controls positions, transitions and meaningful gestures. */
export class MiraRoutine {
  readonly state: MiraView = { ...MIRA_HOME, facing: 'down', action: 'polish', progress: 0 };
  private job = 0;
  private elapsed = 0;
  private transitionElapsed = 0;
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
    const destination = key ? MIRA_HOME : task;
    if (this.state.action === 'stand-up') {
      this.transitionElapsed += dt;
      this.state.progress = Math.min(1, this.transitionElapsed / MIRA_TRANSITION_SECONDS);
      if (this.state.progress === 1) { this.state.action = 'idle'; this.state.progress = 0; }
      return;
    }
    if ((this.state.action === 'sit' || this.state.action === 'sit-down') && (key || task.action !== 'sit')) {
      this.transitionElapsed = this.state.action === 'sit-down' ? (1 - this.state.progress) * MIRA_TRANSITION_SECONDS : 0;
      this.state.action = 'stand-up'; this.state.progress = this.transitionElapsed / MIRA_TRANSITION_SECONDS;
      return;
    }
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
    if (task.action === 'sit' && this.state.action !== 'sit') {
      if (this.state.action !== 'sit-down') { this.state.action = 'sit-down'; this.transitionElapsed = 0; }
      this.transitionElapsed += dt; this.state.progress = Math.min(1, this.transitionElapsed / MIRA_TRANSITION_SECONDS);
      if (this.state.progress < 1) return;
    }
    this.state.action = task.action; this.state.facing = task.facing;
    this.elapsed += dt; this.state.progress = Math.min(1, this.elapsed / task.duration);
    if (this.elapsed >= task.duration) { this.job = (this.job + 1) % jobs.length; this.elapsed = 0; }
  }
}
