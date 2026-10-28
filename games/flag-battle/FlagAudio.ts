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
    this.noise = c.createBuffer(1, Math.ceil(c.sampleRate * .2), c.sampleRate);
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
  private tone(frequency: number, end: number, duration: number, level: number, at: number, pan = 0, type: OscillatorType = 'sine') {
    const c = this.context; if (!this.allowed() || !c || !this.master || this.voices.size >= 16) return;
    const source = c.createOscillator(), gain = c.createGain(), position = c.createStereoPanner();
    source.type = type; source.frequency.setValueAtTime(frequency, at); source.frequency.exponentialRampToValueAtTime(Math.max(30, end), at + duration);
    gain.gain.setValueAtTime(.00001, at); gain.gain.linearRampToValueAtTime(level, at + .005); gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    position.pan.value = pan; source.connect(gain).connect(position).connect(this.master);
    this.attach(source, [gain, position], at, duration);
  }
  private air(at: number, pan: number, strength: number) {
    const c = this.context; if (!this.allowed() || !c || !this.master || !this.noise || this.voices.size >= 16) return;
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(), position = c.createStereoPanner();
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1900, at); filter.frequency.exponentialRampToValueAtTime(380, at + .16);
    gain.gain.setValueAtTime(.00001, at); gain.gain.linearRampToValueAtTime(.2 * strength, at + .018); gain.gain.exponentialRampToValueAtTime(.00001, at + .16);
    position.pan.setValueAtTime(pan * .6, at); position.pan.linearRampToValueAtTime(pan, at + .16);
    source.connect(filter).connect(gain).connect(position).connect(this.master); this.attach(source, [filter, gain, position], at, .16);
  }
  playAt(e: FlagSoundEvent, at: number) {
    if (!this.allowed()) return;
    this.scheduled[e.cue] = (this.scheduled[e.cue] ?? 0) + 1;
    const s = e.strength;
    switch (e.cue) {
      case 'select': this.tone(640, 580, .065, .075, at); break;
      case 'start': this.tone(262, 392, .18, .12, at); this.tone(523, 523, .22, .07, at + .07); break;
      case 'collision': this.tone(210 + e.variant * 23, 130 + e.variant * 12, .055, .11 * s, at, e.pan, 'triangle'); break;
      case 'wall': this.tone(760 + e.variant * 47, 680 + e.variant * 37, .085, .075 * s, at, e.pan); break;
      case 'eliminate': this.air(at, e.pan, s); this.tone(e.variant < 0 ? 330 : 620 + e.variant * 18, e.variant < 0 ? 165 : 390, .19, .11 * s, at, e.pan); break;
      case 'final-two': this.tone(392, 392, .15, .09, at, -.12); this.tone(494, 494, .21, .085, at + .16, .12); break;
      case 'win':
        for (const [i, f] of [523.25, 659.25, 783.99, 1046.5].entries()) { this.tone(f, f, .34, .115, at + i * .095, (i - 1.5) * .12); this.tone(f * 2, f * 2, .14, .022, at + i * .095); } break;
      case 'lose': this.tone(155, 98, .16, .11, at); this.tone(310, 196, .1, .035, at); break;
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
