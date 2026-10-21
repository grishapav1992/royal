export class CrLeoAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private crowd?: AudioBufferSourceNode;
  private live = new Set<AudioScheduledSourceNode>();
  enabled = true;
  private closed = false;
  async unlock() {
    if (this.closed) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = this.enabled ? .35 : 0; this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * .30;
      this.crowd = this.context.createBufferSource(); this.crowd.buffer = buffer; this.crowd.loop = true;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 950;
      const gain = this.context.createGain(); gain.gain.value = .10;
      this.crowd.connect(filter).connect(gain).connect(this.master); this.crowd.start();
    }
    await this.context.resume();
  }
  toggle() { this.enabled = !this.enabled; if (this.master && this.context) this.master.gain.setTargetAtTime(this.enabled ? .35 : 0, this.context.currentTime, .025); }
  private tone(frequency: number, duration: number, volume: number, end = frequency, delay = 0, type: OscillatorType = 'sine') {
    const c = this.context; if (!c || c.state !== 'running' || !this.master || !this.enabled || this.closed) return;
    const at = c.currentTime + delay, osc = c.createOscillator(), gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, at); osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    gain.gain.setValueAtTime(.001, at); gain.gain.exponentialRampToValueAtTime(volume, at + .012); gain.gain.exponentialRampToValueAtTime(.001, at + duration);
    osc.connect(gain).connect(this.master); this.live.add(osc); osc.onended = () => { this.live.delete(osc); osc.disconnect(); gain.disconnect(); }; osc.start(at); osc.stop(at + duration + .03);
  }
  kick() { this.tone(170, .16, .5, 50); this.tone(1600, .07, .12, 250, 0, 'triangle'); }
  wall() { this.tone(95,.18,.28,35); this.tone(450,.07,.08,180,0,'triangle'); }
  goal() { for (let i = 0; i < 7; i++) this.tone(210 + i * 47, .7, .05, 250 + i * 64, i * .025, 'triangle'); }
  miss(post: boolean) { this.tone(post ? 1200 : 110, post ? .55 : .22, .22, post ? 980 : 45, 0, post ? 'triangle' : 'sine'); }
  celebrate(hero: 'cr' | 'leo') {
    this.goal();
    if (hero === 'cr') {
      // Synthetic stadium chant with a descending vowel, no external voice recording.
      for (let i = 1; i <= 8; i++) this.tone(160 * i, 1.20, .10 / i, 105 * i, .8, 'sine');
      this.tone(1900, .20, .05, 700, .65, 'triangle');
    } else { this.tone(440, .7, .07, 660, .25); this.tone(660, .8, .07, 880, .6); }
  }
  silence() { if (this.context?.state === 'running') void this.context.suspend(); }
  destroy() {
    this.closed = true;
    try { this.crowd?.stop(); } catch {}
    for (const source of this.live) { try { source.stop(); } catch {} }
    this.live.clear(); void this.context?.close();
  }
  state() { return { sources: this.live.size, context: this.context?.state ?? 'none', enabled: this.enabled }; }
}
