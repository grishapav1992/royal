import { gameAudio } from '../../src/game/GameAudio';
import type { FlagBattleCue, FlagBattleSoundEvent } from './FlagBattleCues';
export interface FlagSoundPorts {
  context(): BaseAudioContext | undefined;
  output(): AudioNode | undefined;
  allowed(): boolean;
  unlock(): Promise<void>;
  subscribe(listener: () => void): () => void;
  now(): number;
}
const browserPorts: FlagSoundPorts = {
  context: () => gameAudio.context, output: () => gameAudio.output,
  allowed: () => !document.hidden && !gameAudio.getPreferences().muted && gameAudio.getPreferences().volume > 0 && gameAudio.context?.state === 'running',
  unlock: () => gameAudio.unlock(), subscribe: listener => gameAudio.onPreferences(listener), now: () => performance.now(),
};
type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] };
const MAX_VOICES = 28;
/** Impacts yield to meaningful events when the mix is busy. */
const IMPACT_VOICES = 18;
const FANFARE = [523.25, 659.25, 783.99, 1046.5];
const LAMENT = [329.63, 277.18];

/** Synthesized score for Flag Battle. It uses the shared host context, output and preferences. */
export class FlagBattleSound {
  private context?: BaseAudioContext;
  private master?: GainNode;
  private limiter?: DynamicsCompressorNode;
  private noise?: AudioBuffer;
  private voices = new Set<Voice>();
  private closed = false;
  private round?: { events: FlagBattleSoundEvent[]; cursor: number };
  private lastRound = '';
  private audible = false;
  private lastFrame?: number;
  private scheduled: Partial<Record<FlagBattleCue, number>> = {};
  private maxVoices = 0;
  private outputDelayMs = 0;
  private maxScheduleErrorMs = 0;
  private timing = 'unavailable';
  private unsubscribe: () => void;
  private contextChanged = () => { if (this.context?.state !== 'running') { this.stopVoices(); this.audible = false; } };
  constructor(private ports: FlagSoundPorts = browserPorts) {
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
    this.limiter.ratio.value = 4; this.limiter.attack.value = .003; this.limiter.release.value = .12;
    this.master.connect(this.limiter).connect(output);
    this.noise = c.createBuffer(1, Math.ceil(c.sampleRate * .6), c.sampleRate);
    const data = this.noise.getChannelData(0); let seed = 81231;
    for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = ((seed >>> 0) / 2147483648 - 1) * .65; }
    c.addEventListener('statechange', this.contextChanged);
  }
  begin(id: string, events: FlagBattleSoundEvent[]) {
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
  cue(cue: FlagBattleCue, variant = 0) {
    if (!this.allowed()) return;
    this.playAt({ cue, at: 0, strength: 1, pan: 0, variant }, this.context!.currentTime + .003);
  }
  private attach(source: AudioScheduledSourceNode, nodes: AudioNode[], at: number, duration: number) {
    const voice = { source, nodes }; this.voices.add(voice); this.maxVoices = Math.max(this.maxVoices, this.voices.size);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); for (const node of nodes) node.disconnect(); };
    source.start(at); source.stop(at + duration + .02);
  }
  private room(limit: number) { return this.allowed() && !!this.context && !!this.master && this.voices.size < limit; }
  /** Pitched partial with a short attack and an exponential tail that fully decays inside its slot. */
  private tone(type: OscillatorType, from: number, to: number, duration: number, level: number, at: number, pan = 0, attack = .004, limit = MAX_VOICES, detune = 0) {
    if (!this.room(limit)) return;
    const c = this.context!, source = c.createOscillator(), gain = c.createGain(), position = c.createStereoPanner();
    source.type = type; source.detune.value = detune;
    source.frequency.setValueAtTime(from, at); if (to !== from) source.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
    gain.gain.setValueAtTime(.00001, at); gain.gain.linearRampToValueAtTime(level, at + attack); gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    position.pan.value = pan; source.connect(gain).connect(position).connect(this.master!);
    this.attach(source, [gain, position], at, duration);
  }
  /** Filtered noise layer: transients, air and swooshes. */
  private hiss(type: BiquadFilterType, from: number, to: number, q: number, duration: number, level: number, at: number, pan = 0, attack = .002, limit = MAX_VOICES, panTo = pan) {
    if (!this.room(limit) || !this.noise) return;
    const c = this.context!, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain(), position = c.createStereoPanner();
    source.buffer = this.noise; filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + duration);
    gain.gain.setValueAtTime(.00001, at); gain.gain.linearRampToValueAtTime(level, at + attack); gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    position.pan.setValueAtTime(pan, at); position.pan.linearRampToValueAtTime(panTo, at + duration);
    source.connect(filter).connect(gain).connect(position).connect(this.master!); this.attach(source, [filter, gain, position], at, duration);
  }
  playAt(e: FlagBattleSoundEvent, at: number) {
    if (!this.allowed()) return;
    this.scheduled[e.cue] = (this.scheduled[e.cue] ?? 0) + 1;
    const s = e.strength, p = e.pan, v = e.variant;
    switch (e.cue) {
      case 'select':
        this.tone('triangle', 880 + v * 40, 660, .07, .05, at, 0, .003);
        this.hiss('bandpass', 4200, 3000, 4, .03, .05, at);
        break;
      case 'start':
        this.hiss('bandpass', 380, 2600, 1.2, .34, .12, at, -.4, .05, MAX_VOICES, .4);
        this.tone('sine', 220, 440, .26, .06, at + .04, 0, .02);
        this.tone('triangle', 660, 660, .3, .035, at + .2, 0, .006);
        this.tone('triangle', 990, 990, .34, .025, at + .28, 0, .006);
        break;
      case 'collision':
        // Glassy clack: bright click, short resonant body and a soft low knock.
        this.hiss('bandpass', 2900 + v * 180, 1900, 7, .035, .13 * s, at, p, .001, IMPACT_VOICES);
        this.tone('sine', 760 + v * 55, 520 + v * 30, .055, .075 * s, at, p, .002, IMPACT_VOICES);
        this.tone('sine', 150 + v * 8, 90, .05, .07 * s, at, p, .002, IMPACT_VOICES);
        break;
      case 'wall':
        // Rim knock with a short ring of the metal band.
        this.tone('sine', 128 + v * 6, 62, .09, .13 * s, at, p, .002, IMPACT_VOICES);
        this.hiss('bandpass', 1100, 520, 2.5, .05, .08 * s, at, p, .001, IMPACT_VOICES);
        this.tone('sine', 1240 + v * 37, 1180, .22, .022 * s, at, p, .003, IMPACT_VOICES);
        this.tone('sine', 1873 + v * 41, 1800, .16, .012 * s, at, p, .003, IMPACT_VOICES);
        break;
      case 'eliminate':
        if (v < 0) {
          // The player's own flag leaves: lower, slower fall.
          this.hiss('lowpass', 2200, 300, .7, .3, .12, at, p * .5, .02, MAX_VOICES, p);
          this.tone('triangle', 392, 196, .32, .06, at + .02, p, .01);
          this.tone('sine', 98, 55, .3, .09, at + .02, p, .008);
        } else {
          this.hiss('bandpass', 600, 3400, 1.4, .2, .11 * s, at, p * .4, .03, MAX_VOICES, p);
          this.tone('sine', 560 + v * 24, 150, .11, .085 * s, at + .05, p, .003);
          this.hiss('highpass', 5200, 7000, .8, .09, .05 * s, at + .06, p, .002);
          this.tone('triangle', 1320 + v * 66, 1320 + v * 66, .12, .02 * s, at + .09, p, .004);
        }
        break;
      case 'pulse':
        this.tone('sine', 72 + v * 6, 52, .14, .085 * s, at, 0, .006);
        this.hiss('lowpass', 900, 300, .7, .05, .03 * s, at, 0, .002);
        break;
      case 'final-two':
        this.hiss('bandpass', 300, 4200, 2, .42, .1, at, -.3, .12, MAX_VOICES, .3);
        this.tone('sawtooth', 110, 110, .55, .028, at, 0, .01, MAX_VOICES, -6);
        this.tone('sawtooth', 110, 110, .55, .028, at, 0, .01, MAX_VOICES, 6);
        this.tone('triangle', 440, 440, .26, .05, at, 0, .004);
        this.tone('triangle', 554.37, 554.37, .3, .04, at + .12, 0, .004);
        break;
      case 'heartbeat':
        this.tone('sine', 66, 44, .13, .13 * s, at, 0, .006);
        this.tone('sine', 58, 40, .15, .09 * s, at + .16, 0, .006);
        break;
      case 'reveal':
        this.hiss('highpass', 3000, 9000, .7, .5, .05, at, 0, .12);
        this.tone('sine', 523.25, 523.25, .6, .03, at, -.2, .03);
        this.tone('sine', 783.99, 783.99, .6, .025, at + .04, .2, .03);
        break;
      case 'win':
        FANFARE.forEach((f, i) => {
          this.tone('triangle', f, f, .5 - i * .04, .07, at + i * .085, (i - 1.5) * .25, .006);
          this.tone('sine', f * 2, f * 2, .32, .018, at + i * .085, (i - 1.5) * .25, .006, MAX_VOICES, 4);
        });
        this.tone('sine', 130.81, 130.81, .7, .07, at, 0, .02);
        this.hiss('highpass', 5000, 8000, .6, .7, .07, at + .32, -.5, .05, MAX_VOICES, .5);
        for (let i = 0; i < 4; i++) this.tone('sine', 2093 + i * 349, 2093 + i * 349, .09, .02, at + .4 + i * .07, i % 2 ? .45 : -.45, .002);
        break;
      case 'lose':
        LAMENT.forEach((f, i) => this.tone('triangle', f, f * .985, .34, .05, at + i * .16, 0, .01));
        this.tone('sine', 82.41, 70, .5, .05, at + .16, 0, .02);
        break;
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
