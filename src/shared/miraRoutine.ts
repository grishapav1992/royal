import type { Facing } from './movement';
import { barPoint } from './furniture';

export type MiraAction = 'walk' | 'polish' | 'wipe' | 'stock' | 'idle' | 'serve' | 'chat';
export type MiraView = { x: number; y: number; facing: Facing; action: MiraAction; progress: number };
export const MIRA_HOME = barPoint(125,116);
const jobs: { x: number; y: number; action: MiraAction; duration: number; facing: Facing }[] = [
  { ...MIRA_HOME, action: 'polish', duration: 7, facing: 'down' },
  { ...barPoint(51,116), action: 'wipe', duration: 6, facing: 'down' },
  { ...barPoint(195,106), action: 'stock', duration: 5, facing: 'up' },
  { ...barPoint(166,116), action: 'polish', duration: 8, facing: 'down' },
  { ...MIRA_HOME, action: 'idle', duration: 4, facing: 'left' },
  { ...barPoint(194,116), action: 'wipe', duration: 6, facing: 'down' },
];

/** Dedicated staff lane stays behind the counter, separate from visitor navigation. */
export class MiraRoutine {
  readonly state: MiraView = { ...MIRA_HOME, facing: 'down', action: 'polish', progress: 0 };
  private job = 0;
  private elapsed = 0;
  tick(delta: number, serving = false, chatting = false) {
    const dt = Math.max(0, Math.min(delta, .1));
    const task = jobs[this.job];
    const destination = serving || chatting ? MIRA_HOME : task;
    const dx = destination.x - this.state.x, dy = destination.y - this.state.y, distance = Math.hypot(dx, dy);
    if (distance > .1) {
      const amount = Math.min(distance, dt * (serving || chatting ? 80 : 30));
      this.state.x += dx / distance * amount; this.state.y += dy / distance * amount;
      this.state.action = 'walk'; this.state.facing = dx < 0 ? 'left' : 'right'; this.state.progress = 0;
      return;
    }
    this.state.x = destination.x; this.state.y = destination.y;
    if (serving || chatting) {
      this.state.action = serving ? 'serve' : 'chat'; this.state.facing = serving ? 'down' : 'left'; this.state.progress = 0;
      return;
    }
    this.state.action = task.action; this.state.facing = task.facing;
    this.elapsed += dt; this.state.progress = Math.min(1, this.elapsed / task.duration);
    if (this.elapsed >= task.duration) { this.job = (this.job + 1) % jobs.length; this.elapsed = 0; }
  }
}
