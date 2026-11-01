import type { GameAudio } from '../../src/game/GameAudio';

export type TsuCue = 'lock' | 'ready' | 'beat' | 'reveal' | 'draw' | 'round-win' | 'round-lose' | 'match-win' | 'match-lose';
const durations: Record<TsuCue, number> = { lock: .09, ready: .23, beat: .13, reveal: .19, draw: .23, 'round-win': .31, 'round-lose': .28, 'match-win': .62, 'match-lose': .37 };

/** Original dry percussion and wooden notes. No external recordings or speech. */
export function renderTsuCue(cue: TsuCue, rate: number, variant = 0) {
  const samples = new Float32Array(Math.ceil(durations[cue] * rate));
  let seed = 0x51a7 + variant * 197, low = 0;
  const note = (t: number, at: number, hz: number, level: number) => {
    const x = t - at;
    return x < 0 ? 0 : Math.min(1, x / .0025) * Math.exp(-x * 30) * level
      * (Math.sin(x * hz * Math.PI * 2) + .24 * Math.sin(x * hz * 5.52 * Math.PI));
  };
  const melody: Partial<Record<TsuCue, number[]>> = { ready: [330, 440], draw: [260, 260], 'round-win': [440, 554], 'round-lose': [330, 277], 'match-win': [523, 659, 784, 1047], 'match-lose': [294, 247, 196] };
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const white = (seed >>> 0) / 2147483648 - 1;
    low += (1 - Math.exp(-2 * Math.PI * (cue === 'reveal' ? 1800 : 900) / rate)) * (white - low);
    let value = 0;
    if (cue === 'beat' || cue === 'reveal') {
      const attack = Math.min(1, t / .002), decay = Math.exp(-t * (cue === 'reveal' ? 30 : 43));
      value = attack * decay * (.38 * low + .26 * Math.sin(2 * Math.PI * ((cue === 'reveal' ? 145 : 115 + variant * 8) * t - 110 * t * t)));
    } else if (cue === 'lock') value = note(t, 0, 370, .27) + low * Math.exp(-t * 85) * Math.min(1, t / .002) * .12;
    else for (const [j, hz] of (melody[cue] ?? []).entries()) value += note(t, j * (cue === 'match-win' ? .105 : .085), hz, cue === 'match-win' ? .24 : .18);
    // A short fade protects the tail at every device sample rate.
    samples[i] = value * Math.min(1, (samples.length - 1 - i) / (rate * .02));
  }
  return samples;
}

type SharedAudio = Pick<GameAudio, 'context' | 'output' | 'unlock' | 'getPreferences' | 'onPreferences'>;
type Voice = { source: AudioBufferSourceNode; gain: GainNode; finish: () => void };
export class TsuSounds {
  private voices = new Set<Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private context?: AudioContext;
  private dead = false;
  private allowed = true;
  private stopPreferences: () => void;
  private played: Partial<Record<TsuCue, number>> = {};
  private timing: { cue: TsuCue; target: number; audibleAt: number; method: string }[] = [];
  private stateChange = () => { if (this.context?.state !== 'running') this.cancel(); };
  constructor(private host: SharedAudio, private doc: Document) {
    this.stopPreferences = host.onPreferences(() => { if (!this.available()) this.cancel(); });
  }
  available() { const p = this.host.getPreferences(); return !this.dead && this.allowed && !this.doc.hidden && !p.muted && p.volume > 0 && this.host.context?.state === 'running' && !!this.host.output; }
  async unlock() { await this.host.unlock(); }
  setAllowed(value: boolean) { this.allowed = value; if (!value) this.cancel(); }
  private clock() {
    const c = this.host.context!, now = performance.now();
    let stamp: AudioTimestamp | undefined;
    try { stamp = c.getOutputTimestamp?.(); } catch { /* Use the device latency estimate. */ }
    if (stamp?.performanceTime && Number.isFinite(stamp.contextTime) && Math.abs(now - stamp.performanceTime) < 250 && stamp.contextTime! <= c.currentTime + .05)
      return { audio: stamp.contextTime!, wall: stamp.performanceTime, method: 'output-timestamp' };
    return { audio: c.currentTime - ((c.outputLatency || 0) + (c.baseLatency || 0)), wall: now, method: 'latency-estimate' };
  }
  lead() { if (!this.available()) return 0; const c = this.host.context!, stamp = this.clock(); return Math.max(0, (c.currentTime - stamp.audio) * 1000); }
  play(cue: TsuCue, target = performance.now(), variant = 0): number | undefined {
    if (!this.available() || this.voices.size >= 12) return;
    const c = this.host.context!;
    if (this.context !== c) {
      this.context?.removeEventListener('statechange', this.stateChange); this.buffers.clear();
      this.context = c; c.addEventListener('statechange', this.stateChange);
    }
    const key = cue + ':' + variant;
    let buffer = this.buffers.get(key);
    if (!buffer) { const data = renderTsuCue(cue, c.sampleRate, variant); buffer = c.createBuffer(1, data.length, c.sampleRate); buffer.copyToChannel(data, 0); this.buffers.set(key, buffer); }
    const stamp = this.clock(), at = Math.max(c.currentTime + .006, stamp.audio + (target - stamp.wall) / 1000);
    const audibleAt = stamp.wall + (at - stamp.audio) * 1000;
    const source = c.createBufferSource(), gain = c.createGain(); source.buffer = buffer; gain.gain.value = .65;
    source.connect(gain); gain.connect(this.host.output!);
    const voice: Voice = { source, gain, finish: () => { source.onended = null; source.disconnect(); gain.disconnect(); this.voices.delete(voice); } };
    this.voices.add(voice); source.onended = voice.finish;
    source.start(at); source.stop(at + buffer.duration + .005);
    this.played[cue] = (this.played[cue] ?? 0) + 1;
    this.timing.push({ cue, target, audibleAt, method: stamp.method }); if (this.timing.length > 24) this.timing.shift();
    return audibleAt;
  }
  cancel() { for (const voice of [...this.voices]) { try { voice.source.stop(); } catch { /* Already ended. */ } voice.finish(); } }
  getState() { return { activeVoices: this.voices.size, played: { ...this.played }, timing: [...this.timing], available: this.available(), disposed: this.dead }; }
  destroy() { this.dead = true; this.cancel(); this.stopPreferences(); this.context?.removeEventListener('statechange', this.stateChange); this.buffers.clear(); }
}
