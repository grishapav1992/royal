import { gameAudio } from '../../src/game/GameAudio';
import type { FlagCue, FlagSoundEvent } from './FlagSoundTimeline';
export interface FlagAudioPorts {
  context(): BaseAudioContext | undefined;
  output(): AudioNode | undefined;
  allowed(): boolean;
  unlock(): Promise<void>;
  subscribe(listener: () => void): () => void;
  now(): number;
}
const browserPorts: FlagAudioPorts = {
  context: () => gameAudio.context, output: () => gameAudio.output,
  allowed: () => !document.hidden && !gameAudio.getPreferences().muted && gameAudio.getPreferences().volume > 0 && gameAudio.context?.state === 'running',
  unlock: () => gameAudio.unlock(), subscribe: listener => gameAudio.onPreferences(listener), now: () => performance.now(),
};
type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] };
export class FlagAudio {
  private context?: BaseAudioContext;
  private master?: GainNode;
  private limiter?: DynamicsCompressorNode;
  private noise?: AudioBuffer;
  private voices = new Set<Voice>();
  private closed = false;
  private round?: { events: FlagSoundEvent[]; cursor: number };
  private lastRound = '';
  private audible = false;
  private lastFrame?: number;
  private scheduled: Partial<Record<FlagCue, number>> = {};
  private maxVoices = 0;
  private outputDelayMs = 0;
  private maxScheduleErrorMs = 0;
  private timing = 'unavailable';
  private unsubscribe: () => void;
  private contextChanged = () => { if (this.context?.state !== 'running') { this.stopVoices(); this.audible = false; } };
  constructor(private ports: FlagAudioPorts = browserPorts) {
    this.unsubscribe = ports.subscribe(() => { if (!ports.allowed()) { this.stopVoices(); this.audible = false; } });
  }
  async unlock() {
    if (this.closed) return;
    try { await this.ports.unlock(); } catch { return; }
    if (this.closed) return;
    const c = this.ports.context(), output = this.ports.output();
    if (!c || !output || c === this.context) return;
    this.stopVoices(); this.audible = false; this.lastFrame = undefined; this.context?.removeEventListener('statechange', this.contextChanged);
    this.master?.disconnect(); this.limiter?.disconnect(); this.context = c;
    this.master = c.createGain(); this.master.gain.value = .8;
    this.limiter = c.createDynamicsCompressor(); this.limiter.threshold.value = -12; this.limiter.knee.value = 8;
    this.limiter.ratio.value = 4; this.limiter.attack.value = .003; this.limiter.release.value = .1;
    this.master.connect(this.limiter).connect(output);
    this.noise = c.createBuffer(1, Math.ceil(c.sampleRate * .32), c.sampleRate);
    const data = this.noise.getChannelData(0); let seed = 81231;
    for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = ((seed >>> 0) / 2147483648 - 1) * .65; }
    c.addEventListener('statechange', this.contextChanged);
  }
  begin(id: string, events: FlagSoundEvent[]) {
    if (this.closed || id === this.lastRound) return false;
    this.silence(); this.lastRound = id; this.round = { events, cursor: 0 }; return true;
  }
  complete() { this.round = undefined; this.lastFrame = undefined; }
  instantResult(id: string, won: boolean) { if (this.begin(id, [])) { this.complete(); this.cue(won ? 'win' : 'lose'); } }
  private allowed() { return !this.closed && !!this.master && this.ports.allowed(); }
  private clock(now: number) {
    const c = this.context! as AudioContext;
    const stamp = typeof c.getOutputTimestamp === 'function' ? c.getOutputTimestamp() : undefined;
    const contextTime = stamp?.contextTime, performanceTime = stamp?.performanceTime;
    if (typeof contextTime === 'number' && typeof performanceTime === 'number' && performanceTime > 0 && Number.isFinite(contextTime)) {
      const audibleTime = contextTime + (now - performanceTime) / 1000;
      const delay = Math.max(0, Math.min(.5, c.currentTime - audibleTime));
      this.outputDelayMs = delay * 1000; this.timing = 'output-timestamp';
      return { delay, audioAt: (visualAt: number) => contextTime + (visualAt - performanceTime) / 1000 };
    }
    const delay = Math.max(0, Math.min(.5, (c.baseLatency || 0) + (c.outputLatency || 0)));
    this.outputDelayMs = delay * 1000; this.timing = 'reported-latency';
    return { delay, audioAt: (visualAt: number) => c.currentTime + (visualAt - now) / 1000 - delay };
  }
  advance(playhead: number, frameAt: number) {
    const r = this.round;
    if (!r || this.closed) return;
    if (!this.allowed()) {
      this.stopVoices(); this.audible = false;
      while (r.cursor < r.events.length && r.events[r.cursor].at <= playhead) r.cursor++;
      this.lastFrame = frameAt; return;
    }
    if (!this.audible || this.lastFrame !== undefined && frameAt - this.lastFrame > 180) {
      this.stopVoices();
      r.cursor = r.events.findIndex(e => e.at >= playhead);
      if (r.cursor < 0) r.cursor = r.events.length;
    }
    this.audible = true; this.lastFrame = frameAt;
    const now = this.ports.now(), clock = this.clock(now), c = this.context!;
    const horizon = playhead + Math.min(.55, clock.delay + .065);
    while (r.cursor < r.events.length && r.events[r.cursor].at <= horizon) {
      const e = r.events[r.cursor++];
      if (e.at < playhead - .04) continue;
      const visualAt = frameAt + (e.at - playhead) * 1000;
      const target = clock.audioAt(visualAt), at = Math.max(c.currentTime + .002, target);
      this.maxScheduleErrorMs = Math.max(this.maxScheduleErrorMs, (at - target) * 1000);
      this.playAt(e, at);
    }
  }
  cue(cue: FlagCue) {
    if (!this.allowed()) return;
    this.playAt({ cue, at: 0, strength: 1, pan: 0, variant: 0 }, this.context!.currentTime + .003);
  }
  private attach(source: AudioScheduledSourceNode, nodes: AudioNode[], at: number, duration: number) {
    const voice = { source, nodes }; this.voices.add(voice); this.maxVoices = Math.max(this.maxVoices, this.voices.size);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); for (const node of nodes) node.disconnect(); };
    source.start(at); source.stop(at + duration + .02);
  }
  private pop(frequency: number, end: number, duration: number, level: number, at: number, pan = 0) {
    const c = this.context; if (!this.allowed() || !c || !this.master || this.voices.size >= 16) return;
    const source = c.createOscillator(), gain = c.createGain(), position = c.createStereoPanner();
    source.type = 'sine'; source.frequency.setValueAtTime(frequency, at); source.frequency.exponentialRampToValueAtTime(Math.max(30, end), at + duration);
    gain.gain.setValueAtTime(.00001, at); gain.gain.linearRampToValueAtTime(level, at + .007); gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    position.pan.value = pan; source.connect(gain).connect(position).connect(this.master);
    this.attach(source, [gain, position], at, duration);
  }
  private air(at: number, pan: number, level: number, duration = .17, frequency = 1100) {
    const c = this.context; if (!this.allowed() || !c || !this.master || !this.noise || this.voices.size >= 16) return;
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(), position = c.createStereoPanner();
    source.buffer = this.noise; filter.type = 'lowpass'; filter.Q.value = .5;
    filter.frequency.setValueAtTime(frequency, at); filter.frequency.exponentialRampToValueAtTime(260, at + duration);
    gain.gain.setValueAtTime(.00001, at); gain.gain.linearRampToValueAtTime(level, at + Math.min(.022, duration * .2)); gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    position.pan.setValueAtTime(pan * .6, at); position.pan.linearRampToValueAtTime(pan, at + duration);
    source.connect(filter).connect(gain).connect(position).connect(this.master); this.attach(source, [filter, gain, position], at, duration);
  }
  playAt(e: FlagSoundEvent, at: number) {
    if (!this.allowed()) return;
    this.scheduled[e.cue] = (this.scheduled[e.cue] ?? 0) + 1;
    const s = e.strength;
    switch (e.cue) {
      case 'select': this.pop(360, 180, .065, .06, at); break;
      case 'start': this.pop(150, 280, .13, .075, at); this.air(at, 0, .12, .14, 950); break;
      case 'collision': this.pop(185 + e.variant * 13, 95 + e.variant * 7, .06, .065 * s, at, e.pan); break;
      case 'wall': this.pop(310 + e.variant * 17, 145 + e.variant * 9, .05, .052 * s, at, e.pan); break;
      case 'eliminate': this.air(at, e.pan, .15 * s); this.pop(e.variant < 0 ? 190 : 330 + e.variant * 6, e.variant < 0 ? 92 : 150, .105, .065 * s, at, e.pan); break;
      case 'final-two': this.pop(290, 170, .12, .075, at); this.air(at, 0, .085, .10, 750); break;
      case 'win': this.pop(430, 185, .17, .095, at); this.air(at, 0, .20, .28, 1500); break;
      case 'lose': this.pop(145, 90, .09, .055, at); break;
    }
  }
  private stopVoices() {
    for (const voice of this.voices) {
      voice.source.onended = null; try { voice.source.stop(); } catch {}
      voice.source.disconnect(); for (const node of voice.nodes) node.disconnect();
    }
    this.voices.clear();
  }
  silence() { this.stopVoices(); this.round = undefined; this.audible = false; this.lastFrame = undefined; }
  destroy() {
    if (this.closed) return;
    this.closed = true; this.silence(); this.unsubscribe(); this.context?.removeEventListener('statechange', this.contextChanged);
    this.master?.disconnect(); this.limiter?.disconnect(); this.noise = undefined;
  }
  state() { return { ready: !!this.master && !this.closed, audible: this.allowed(), voices: this.voices.size, maxVoices: this.maxVoices,
    scheduled: { ...this.scheduled }, outputDelayMs: this.outputDelayMs, maxScheduleErrorMs: this.maxScheduleErrorMs, timing: this.timing, timeline: !!this.round }; }
}
