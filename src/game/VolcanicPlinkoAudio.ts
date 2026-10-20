import { gameAudio } from './GameAudio';

type Voice = { source: OscillatorNode; gain: GainNode; pan: StereoPannerNode };

/** Crystal bells and warm low notes share the club's volume and audio context. */
export class VolcanicPlinkoAudio {
  private voices = new Set<Voice>();
  private dead = false;
  private unsubscribe: () => void;
  readonly counts = { launch: 0, hit: 0, land: 0 };
  constructor() {
    this.unsubscribe = gameAudio.onPreferences(p => { if (p.muted || p.volume === 0) this.cancel(); });
  }
  async unlock() { if (!this.dead) await gameAudio.unlock(); }
  private note(frequency: number, duration: number, level: number, delay = 0, pan = 0, type: OscillatorType = 'sine') {
    const context = gameAudio.context, output = gameAudio.output, prefs = gameAudio.getPreferences();
    if (this.dead || document.hidden || prefs.muted || !prefs.volume || !context || !output || context.state !== 'running') return;
    const start = context.currentTime + delay;
    const source = context.createOscillator(), gain = context.createGain(), stereo = context.createStereoPanner();
    const voice = { source, gain, pan: stereo }; this.voices.add(voice);
    source.type = type; source.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    stereo.pan.value = Math.max(-1, Math.min(1, pan)); source.connect(gain).connect(stereo).connect(output);
    source.onended = () => { source.disconnect(); gain.disconnect(); stereo.disconnect(); this.voices.delete(voice); };
    source.start(start); source.stop(start + duration + .02);
  }
  launch() {
    this.counts.launch++;
    this.note(73.42, .48, .11, 0, 0, 'triangle'); this.note(293.66, .5, .055, .04);
  }
  hit(row: number, x: number) {
    this.counts.hit++;
    const scale = [293.66, 349.23, 392, 440, 523.25, 587.33, 698.46, 783.99, 880, 1046.5, 1174.66, 1396.91];
    const frequency = scale[row % scale.length];
    this.note(frequency, .44, .095, 0, x / 600);
    this.note(frequency * 2.756, .13, .018, 0, x / 600);
    this.note(frequency * 2, .65, .015, .04, x / 600);
  }
  land(multiplier: number) {
    this.counts.land++;
    this.note(55, .65, .17, 0, 0, 'triangle');
    const notes = multiplier > 1 ? [293.66, 349.23, 440, 587.33] : [293.66, 220];
    notes.forEach((f, i) => this.note(f, .8, multiplier > 1 ? .075 : .035, .07 + i * .085));
    if (multiplier >= 10) [698.46, 880, 1174.66].forEach((f, i) => this.note(f, 1.2, .07, .4 + i * .12));
  }
  cancel() { for (const voice of this.voices) { try { voice.source.stop(); } catch {} voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); } this.voices.clear(); }
  get activeSources() { return this.voices.size; }
  destroy() { this.dead = true; this.cancel(); this.unsubscribe(); }
}
