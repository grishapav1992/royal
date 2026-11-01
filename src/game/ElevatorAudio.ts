import { gameAudio, type GameAudio } from './GameAudio';

export type ElevatorCue = 'close' | 'ride' | 'arrive';
type Host = Pick<GameAudio, 'context' | 'output' | 'getPreferences' | 'onPreferences'>;

/** Short, owned voices on the host output. No private context or saved preferences. */
export class ElevatorAudio {
  private voices = new Set<{ source: AudioScheduledSourceNode; gain: GainNode }>();
  private played: Partial<Record<ElevatorCue, number>> = {};
  private disposed = false;
  private context?: AudioContext;
  private stateChange = () => { if (this.context?.state !== 'running') this.cancel(); };
  private unsubscribe: () => void;
  private visibility = () => { if (document.hidden) this.cancel(); };
  constructor(private host: Host = gameAudio) {
    this.unsubscribe = host.onPreferences(value => { if (value.muted || value.volume === 0) this.cancel(); });
    document.addEventListener('visibilitychange', this.visibility);
  }
  play(cue: ElevatorCue): number {
    this.cancel();
    const c = this.host.context, output = this.host.output, preferences = this.host.getPreferences();
    if (this.disposed || !c || !output || c.state !== 'running' || document.hidden || preferences.muted || preferences.volume === 0) return 0;
    if (this.context !== c) {
      this.context?.removeEventListener('statechange', this.stateChange);this.context = c;
      c.addEventListener('statechange', this.stateChange);
    }
    const at = c.currentTime + .025;
    const voice = (source: AudioScheduledSourceNode, duration: number, level: number, through?: AudioNode) => {
      const gain = c.createGain(), item = { source, gain };
      gain.gain.setValueAtTime(0, at);gain.gain.linearRampToValueAtTime(level, at + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(through ?? gain);if (through) through.connect(gain);gain.connect(output);
      this.voices.add(item);
      source.onended = () => { source.disconnect();through?.disconnect();gain.disconnect();this.voices.delete(item); };
      source.start(at);source.stop(at + duration + .02);
    };
    if (cue === 'close') {
      const source = c.createBufferSource(), buffer = c.createBuffer(1, Math.ceil(c.sampleRate * .28), c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      source.buffer = buffer;
      const filter = c.createBiquadFilter();filter.type = 'lowpass';filter.frequency.value = 650;
      voice(source, .28, .045, filter);
    } else if (cue === 'ride') {
      const motor = c.createOscillator();motor.type = 'sine';
      motor.frequency.setValueAtTime(72, at);motor.frequency.linearRampToValueAtTime(90, at + .25);
      voice(motor, .65, .035);
    } else {
      for (const [frequency, level] of [[880, .06], [1320, .018]]) {
        const bell = c.createOscillator();bell.type = 'sine';bell.frequency.value = frequency;
        voice(bell, .3, level);
      }
    }
    this.played[cue] = (this.played[cue] ?? 0) + 1;
    // Schedule the visual against estimated speaker output, including device latency.
    const stamp = c.getOutputTimestamp?.();
    const audibleAt = stamp?.performanceTime && stamp.contextTime !== undefined && stamp.contextTime > 0
      ? stamp.performanceTime + (at - stamp.contextTime) * 1000
      : performance.now() + (at - c.currentTime + (c.outputLatency || c.baseLatency || 0)) * 1000;
    return Math.max(0, Math.min(500, audibleAt - performance.now()));
  }
  cancel() {
    const c = this.host.context;
    const preferences = this.host.getPreferences();
    const immediate = document.hidden || preferences.muted || preferences.volume === 0 || c?.state !== 'running';
    for (const { source, gain } of this.voices) {
      if (c) {
        gain.gain.cancelScheduledValues(c.currentTime);
        if (immediate) gain.gain.setValueAtTime(0, c.currentTime);
        else gain.gain.setTargetAtTime(.0001, c.currentTime, .008);
        try { source.stop(c.currentTime + (immediate ? 0 : .04)); } catch { /* Already ended. */ }
      }
    }
  }
  getState() { return { active: this.voices.size, played: { ...this.played } }; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;this.cancel();this.unsubscribe();document.removeEventListener('visibilitychange', this.visibility);
    this.context?.removeEventListener('statechange', this.stateChange);
  }
}
