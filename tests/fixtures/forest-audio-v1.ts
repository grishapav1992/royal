/** Frozen client 1.1 sound reference for equal-level review, never loaded by the game. */

export type ForestCue = 'land' | 'turn' | 'flow' | 'flower' | 'choice' | 'bonus' | 'win' | 'big';
type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] };
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Original procedural score. No game RNG or separate audio context is involved. */
export class ForestScore {
  private voices = new Set<Voice>();
  private bus: GainNode;
  private noise: AudioBuffer;
  constructor(readonly context: BaseAudioContext, output: AudioNode) {
    this.bus = context.createGain(); this.bus.gain.value = .7; this.bus.connect(output);
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
    const data = this.noise.getChannelData(0); let seed = 161803, brown = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      brown = (brown + (seed / 4294967296 * 2 - 1) * .025) / 1.025; data[i] = brown * 5;
    }
  }
  private add(source: AudioScheduledSourceNode, nodes: AudioNode[], at: number, duration: number) {
    if (this.voices.size >= 32) { source.disconnect(); nodes.forEach(n => n.disconnect()); return; }
    const voice = { source, nodes }; this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); nodes.forEach(n => n.disconnect()); };
    source.start(at); source.stop(at + duration + .02);
  }
  private note(midi: number, at: number, duration: number, level: number, pad = false) {
    const c = this.context, osc = c.createOscillator(), g = c.createGain(), filter = c.createBiquadFilter();
    osc.type = pad ? 'triangle' : 'sine'; osc.frequency.value = hz(midi);
    filter.type = 'lowpass'; filter.frequency.value = pad ? 850 : 3800;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level, at + (pad ? .18 : .008));
    g.gain.exponentialRampToValueAtTime(.0001, at + duration); g.gain.linearRampToValueAtTime(0, at + duration + .01);
    osc.connect(filter); filter.connect(g); g.connect(this.bus); this.add(osc, [filter, g], at, duration);
  }
  private air(at: number, duration: number, level: number, frequency: number, end = frequency) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter(), g = c.createGain();
    source.buffer = this.noise; source.loop = true; filter.type = 'bandpass'; filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(frequency, at); filter.frequency.exponentialRampToValueAtTime(end, at + duration);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level, at + .012);
    g.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter); filter.connect(g); g.connect(this.bus); this.add(source, [filter, g], at, duration);
  }
  cue(cue: ForestCue, at: number, variant = 0) {
    if (cue === 'land' || cue === 'turn') {
      this.air(at, .17, .22, 520, 210); this.note(cue === 'turn' ? 62 : 50, at, .2, .065);
    } else if (cue === 'flow') this.air(at, .65, .15, 380, 1800);
    else if (cue === 'flower') {
      this.note([81, 86, 88][variant % 3], at, .7, .075);
      this.note([93, 98, 100][variant % 3], at + .012, .42, .018);
    } else {
      const notes = cue === 'choice' ? [74, 81] : cue === 'bonus' ? [62, 69, 74, 78, 81] : cue === 'big' ? [50, 62, 69, 74, 78, 81, 86] : [62, 69, 74, 78];
      notes.forEach((midi, i) => this.note(midi, at + i * .065, cue === 'big' ? 1.8 : 1.1, .045));
    }
  }
  tick(index: number, at: number, bonus: boolean) {
    const root = [50, 46, 53, 48][Math.floor(index / 8) % 4];
    const motif = [12, 19, 24, 22, 19, 15, 14, 19];
    this.note(root + motif[index % 8], at, 1.2, bonus ? .027 : .021);
    if (index % 4 === 0) {
      for (const n of [0, 7, 15]) this.note(root + n, at, 2.7, .012, true);
      this.air(at, 1.8, .045, 1100, 650);
    }
  }
  cancel() { for (const voice of this.voices) { try { voice.source.stop(); } catch {} voice.source.disconnect(); voice.nodes.forEach(n => n.disconnect()); } this.voices.clear(); }
  get active() { return this.voices.size; }
  destroy() { this.cancel(); this.bus.disconnect(); }
}

