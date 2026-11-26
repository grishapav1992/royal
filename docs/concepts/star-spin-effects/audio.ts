// Тихий общий синтез: sine через lowpass, общий gain, все голоса отменяемы.
type Cue = "stop" | "nudge" | "positive" | "bonus" | "even";
const CUES: Record<Cue, { f: number[]; step: number; dur: number }> = {
  bonus: { f: [146.83, 220, 293.66], step: 0.045, dur: 0.42 },
  even: { f: [130.81], step: 0, dur: 0.12 },
  stop: { f: [110, 167], step: 0, dur: 0.22 },
  nudge: { f: [82.41, 164.81], step: 0.05, dur: 0.3 },
  positive: { f: [196, 246.94, 293.66], step: 0.11, dur: 0.6 },
};
class SharedAudio {
  enabled = false;
  private ctx?: AudioContext;
  private master?: GainNode;
  private voices = new Set<OscillatorNode>();
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) { this.cancel(); void this.ctx?.suspend(); return; }
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.07;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }
  play(cue: Cue) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const { f, step, dur } = CUES[cue];
    const t0 = this.ctx.currentTime + 0.01;
    f.forEach((hz, i) => {
      const ctx = this.ctx!;
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const g = ctx.createGain(); const t = t0 + i * step;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 / f.length + 0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.master!);
      o.start(t); o.stop(t + dur + 0.05);
      this.voices.add(o); o.onended = () => this.voices.delete(o);
    });
  }
  cancel() { for (const o of this.voices) { try { o.stop(); } catch { /* уже остановлен */ } } this.voices.clear(); }
}
export const sharedAudio = new SharedAudio();
