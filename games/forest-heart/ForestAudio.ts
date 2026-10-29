import type { GameAudio } from '../../src/game/GameAudio';
import { ForestScore, type ForestCue } from './ForestScore';
import { FOREST_MUSIC_STEP } from './ForestMusic';
export { ForestScore } from './ForestScore';
export type { ForestCue } from './ForestScore';

type SharedAudio = Pick<GameAudio, 'context' | 'output' | 'unlock' | 'getPreferences' | 'onPreferences'>;
export class ForestAudio {
  private score?: ForestScore;
  private context?: AudioContext;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private paused = false;
  private index = 0;
  private nextBeat = 0;
  private stopPreferences: () => void;
  private stateListener = () => { if (this.context?.state !== 'running') this.cancel(); else this.startMusic(); };
  private played: Partial<Record<ForestCue, number>> = {};
  music = true;
  bonus = false;
  constructor(private host: SharedAudio, private doc: Document) {
    this.stopPreferences = host.onPreferences(() => { if (!this.enabled()) this.cancel(); else this.startMusic(); });
  }
  private enabled() {
    const p = this.host.getPreferences();
    return !this.disposed && !this.paused && !this.doc.hidden && !p.muted && p.volume > 0 && this.host.context?.state === 'running';
  }
  async unlock() {
    await this.host.unlock(); if (this.disposed || !this.enabled()) return;
    const context = this.host.context;
    if (!context || !this.host.output) return;
    if (!this.score) {
      this.context = context; this.score = new ForestScore(context, this.host.output);
      context.addEventListener('statechange', this.stateListener);
    }
    this.startMusic();
  }
  private startMusic() {
    if (!this.music || this.timer || !this.enabled() || !this.score || !this.context) return;
    const now = this.context.currentTime;
    // Schedule against the audio clock. A late/hidden tab never catches up old notes.
    if (this.nextBeat < now) this.nextBeat = now + .06;
    while (this.nextBeat < now + .14) {
      this.score.tick(this.index++, this.nextBeat, this.bonus); this.nextBeat += FOREST_MUSIC_STEP;
    }
    this.timer = setTimeout(() => { this.timer = undefined; this.startMusic(); }, 35);
  }
  /** Estimated wall-clock arrival of a future sample, not measured acoustic output. */
  accent(cue: ForestCue, variant = 0, delayMs = 0) {
    const now = performance.now(), c = this.context;
    if (!this.enabled() || !this.score || !c) return { audibleAt: now + delayMs, mode: 'silent', latencyMs: 0 };
    const at = c.currentTime + .035 + delayMs / 1000;
    let audibleAt: number, mode: string;
    const stamp = c.getOutputTimestamp?.();
    if (typeof stamp?.performanceTime === 'number' && typeof stamp.contextTime === 'number' && stamp.performanceTime > 0 && Math.abs(stamp.performanceTime - now) < 1500) {
      audibleAt = stamp.performanceTime + (at - stamp.contextTime) * 1000; mode = 'output-timestamp';
    } else {
      audibleAt = now + (at - c.currentTime + (c.outputLatency || c.baseLatency || 0)) * 1000; mode = 'latency-fallback';
    }
    this.score.cue(cue, at, variant); this.played[cue] = (this.played[cue] ?? 0) + 1;
    return { audibleAt: Math.max(now, audibleAt), mode, latencyMs: Math.max(0, audibleAt - now) };
  }
  setMusic(value: boolean) {
    this.music = value;
    if (!value) { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.nextBeat = 0; this.score?.cancelMusic(); }
    else this.startMusic();
  }
  pause() { this.paused = true; this.cancel(); }
  resume() { this.paused = false; if (this.enabled()) this.startMusic(); }
  cancel() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.nextBeat = 0; this.score?.cancel(); }
  state() { return { activeVoices: this.score?.active ?? 0, musicVoices: this.score?.activeMusic ?? 0, effectVoices: this.score?.activeEffects ?? 0,
    music: this.music, paused: this.paused, musicBar: Math.floor(Math.max(0,this.index-1)/8)%16+1, orchestrationPass:Math.floor(Math.max(0,this.index-1)/128)%3+1, played: { ...this.played } }; }
  destroy() {
    this.disposed = true; this.cancel(); this.stopPreferences();
    this.context?.removeEventListener('statechange', this.stateListener); this.score?.destroy();
  }
}
