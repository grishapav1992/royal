import { gameAudio } from '../../src/game/GameAudio';

export const contactAt = (index: number) => .72 + index * .62;
export const resultAt = (count: number) => contactAt(count - 1) + .32;
export class JackieAudio {
  enabled = true;
  private sources = new Set<AudioScheduledSourceNode>();
  private disposed = false;
  private unsubscribe = gameAudio.onPreferences(p => { if (p.muted || p.volume === 0) this.cancel(); });
  async unlock() { if (!this.disposed && this.enabled) await gameAudio.unlock(); }
  private allowed() { const p = gameAudio.getPreferences(); return !this.disposed && this.enabled && !p.muted && p.volume > 0 && !document.hidden && gameAudio.context?.state === 'running' && !!gameAudio.output; }
  private tone(at: number, frequency: number, duration: number, level: number, type: OscillatorType = 'sine') {
    if (!this.allowed()) return;
    const c = gameAudio.context!, source = c.createOscillator(), gain = c.createGain();
    source.type = type; source.frequency.setValueAtTime(frequency, at); source.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * .65), at + duration);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain); gain.connect(gameAudio.output!); this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + duration + .01);
  }
  /** Visuals follow estimated audible time, including the shared output latency. */
  private audible(at: number) {
    const c = gameAudio.context!; const stamp = c.getOutputTimestamp?.();
    return stamp?.performanceTime && stamp.contextTime ? stamp.performanceTime + (at - stamp.contextTime) * 1000
      : performance.now() + (at - c.currentTime + (c.outputLatency || c.baseLatency || 0)) * 1000;
  }
  begin(count: number, success: boolean, paid: boolean) {
    this.cancel();
    if (!this.allowed()) return performance.now();
    const at = gameAudio.context!.currentTime + .06;
    for (let i = 0; i < count; i++) {
      this.tone(at + contactAt(i) - .14, 680, .12, .018, 'triangle');
      this.tone(at + contactAt(i), success || i < count - 1 ? 145 : 95, .12, .13);
      this.tone(at + contactAt(i), 920, .045, .025, 'triangle');
    }
    const end = at + resultAt(count);
    if (paid) [392, 494, 587, 784].forEach((f, i) => this.tone(end + i * .10, f, .22, .035, 'triangle'));
    else this.tone(end, success ? 330 : 100, success ? .10 : .18, .028, 'triangle');
    return this.audible(at);
  }
  cashout() {
    this.cancel(); if (!this.allowed()) return;
    const at = gameAudio.context!.currentTime + .03;
    [392,494,587].forEach((f,i) => this.tone(at + i * .08, f, .2, .035, 'triangle'));
  }
  result(success:boolean,paid:boolean){this.cancel();if(paid){this.cashout();return;}if(this.allowed())this.tone(gameAudio.context!.currentTime+.02,success?330:100,.12,.028,'triangle');}
  toggle() { this.enabled = !this.enabled; if (!this.enabled) this.cancel(); else void this.unlock(); }
  cancel() { for (const source of this.sources) { try { source.stop(); } catch {} } this.sources.clear(); }
  state() { return { active: this.sources.size, enabled: this.enabled }; }
  destroy() { this.disposed = true; this.cancel(); this.unsubscribe(); }
}
