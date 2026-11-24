import { gameAudio } from '../../src/game/GameAudio';
import type { RacePhase } from './model';
import type { SceneSound } from './scene-base';
import { clamp, ease } from './scene-kit';
import { cargo, explosionAt, heli, impactAt, pickStunt, rollAt, tunnel } from './stunts';

type EffectKind = Parameters<SceneSound>[0];
/** Shortest interval between two voices of one kind, in seconds. A long chase must not become noise. */
const spacing: Record<EffectKind, number> = { hit: .13, contact: .11, blast: .5, smash: .4, rock: .09, scrape: .16, gear: .4, bridge: 2 };
const MAX_VOICES = 14;

/** Original V8 harmonics, filtered road noise, pursuit siren, collisions and endings. Everything is synthesised. */
export class LastExitAudio {
 private static owners = new Set<LastExitAudio>();
 static inspect() { return { owners: this.owners.size, sources: [...this.owners].reduce((sum, owner) => sum + owner.sources.size, 0) }; }
 private bus?: GainNode; private engine?: GainNode; private road?: GainNode; private siren?: GainNode; private rotor?: GainNode; private analyser?: AnalyserNode; private roadFilter?: BiquadFilterNode;
 private oscillators: OscillatorNode[] = []; private sources = new Set<AudioScheduledSourceNode>(); private noise?: AudioBuffer; private sirenOsc?: OscillatorNode;
 private phase: RacePhase = 'idle'; private enabled = true; private disposed = false; private played: Record<string, number> = {};
 private phaseAt = 0; private runId = ''; private cueKeys = new Set<string>(); private cuePlayed: string[] = [];
 private unsubscribe: () => void; private preferenceMuted = false; private cueUntil = 0; private heard = new Map<EffectKind, number>(); private voices = 0; private underBridge = 0;
 constructor() {
  LastExitAudio.owners.add(this);
  try { this.enabled = localStorage.getItem('royal-last-exit-sound') !== '0'; } catch { /* private window */ }
  this.unsubscribe = gameAudio.onPreferences(p => { this.preferenceMuted = p.muted || p.volume === 0; if (this.preferenceMuted) this.silence(); });
 }
 isEnabled() { return this.enabled; }
 setEnabled(value: boolean) {
  this.enabled = value; try { localStorage.setItem('royal-last-exit-sound', value ? '1' : '0'); } catch { /* private window */ }
  if (!value) this.silence(); else void this.unlock();
 }
 async unlock() { if (this.disposed) return; await gameAudio.unlock(); if (this.disposed || !gameAudio.context || !gameAudio.output || this.bus) return; this.create(gameAudio.context, gameAudio.output); }
 private own<T extends AudioScheduledSourceNode>(s: T) { this.sources.add(s); s.onended = () => { this.sources.delete(s); s.disconnect(); }; return s; }
 private create(c: AudioContext, output: GainNode) {
  this.bus = c.createGain(); this.bus.gain.value = .62;
  const limiter = c.createDynamicsCompressor(); limiter.threshold.value = -16; limiter.ratio.value = 6; this.bus.connect(limiter);
  this.analyser = c.createAnalyser(); this.analyser.fftSize = 512; limiter.connect(this.analyser); this.analyser.connect(output);
  this.engine = c.createGain(); this.engine.gain.value = 0; const low = c.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 1300; this.engine.connect(low); low.connect(this.bus);
  for (const [i, level] of [.24, .12, .06, .028].entries()) { const o = this.own(c.createOscillator()), g = c.createGain(); o.type = i === 0 ? 'sawtooth' : 'triangle'; o.frequency.value = 42 * (i + 1); g.gain.value = level; o.connect(g); g.connect(this.engine); o.start(); this.oscillators.push(o); }
  this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate); const a = this.noise.getChannelData(0); let prev = 0;
  for (let i = 0; i < a.length; i++) { prev = (prev + (Math.random() * 2 - 1) * .035) / 1.035; a[i] = prev * 4; }
  const n = this.own(c.createBufferSource()); n.buffer = this.noise; n.loop = true;
  this.roadFilter = c.createBiquadFilter(); this.roadFilter.type = 'highpass'; this.roadFilter.frequency.value = 160; this.road = c.createGain(); this.road.gain.value = 0; n.connect(this.roadFilter); this.roadFilter.connect(this.road); this.road.connect(this.bus); n.start();
  this.siren = c.createGain(); this.siren.gain.value = 0; this.siren.connect(this.bus); this.sirenOsc = this.own(c.createOscillator()); this.sirenOsc.type = 'sine'; this.sirenOsc.frequency.value = 520; this.sirenOsc.connect(this.siren); this.sirenOsc.start();
  this.rotor = c.createGain(); this.rotor.gain.value = 0; this.rotor.connect(this.bus);
  for (const [frequency, level] of [[37, .24], [74, .11], [111, .035]]) { const o = this.own(c.createOscillator()), g = c.createGain(); o.type = 'triangle'; o.frequency.value = frequency; g.gain.value = level; o.connect(g); g.connect(this.rotor); o.start(); }
 }
 private allowed() { return this.enabled && !this.disposed && !document.hidden && !this.preferenceMuted && gameAudio.context?.state === 'running'; }
 private out(pan: number) {
  const c = gameAudio.context!; if (!pan || !c.createStereoPanner) return this.bus!;
  const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1) * .7; p.connect(this.bus!); return p;
 }
 private track(source: AudioScheduledSourceNode, extra: AudioNode[]) {
  this.voices++; const ended = source.onended as ((this: AudioScheduledSourceNode, event: Event) => void) | null;
  source.onended = event => { this.voices--; for (const node of extra) if (node !== this.bus) node.disconnect(); ended?.call(source, event); };
 }
 private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType = 'sine', pan = 0) {
  const c = gameAudio.context; if (!c || !this.bus || !this.allowed() || this.voices >= MAX_VOICES) return;
  const o = this.own(c.createOscillator()), g = c.createGain(), t = c.currentTime, out = this.out(pan); o.type = type;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + duration);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
  o.connect(g); g.connect(out); this.track(o, [g, out]); o.start(); o.stop(t + duration + .03); this.cueUntil = Math.max(this.cueUntil, t + duration);
 }
 private burst(duration: number, gain: number, frequency: number, pan = 0, floor = 90) {
  const c = gameAudio.context; if (!c || !this.bus || !this.noise || !this.allowed() || this.voices >= MAX_VOICES) return;
  const n = this.own(c.createBufferSource()), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime, out = this.out(pan); n.buffer = this.noise; f.type = 'lowpass';
  f.frequency.setValueAtTime(frequency, t); f.frequency.exponentialRampToValueAtTime(floor, t + duration);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
  n.connect(f); f.connect(g); g.connect(out); this.track(n, [f, g, out]); n.start(0, Math.random() * 2); n.stop(t + duration + .02); this.cueUntil = Math.max(this.cueUntil, t + duration);
 }
 /** Collision voices follow the picture. The loudest ones belong to confirmed endings, not to the chase. */
 effect(kind: EffectKind, power: number, pan: number) {
  const c = gameAudio.context; if (!c || !this.bus || !this.allowed()) return;
  if (c.currentTime - (this.heard.get(kind) ?? -9) < spacing[kind]) return; this.heard.set(kind, c.currentTime);
  const p = clamp(power, 0, 1.4), chase = this.phase === 'racing' ? .62 : 1;
  if (kind === 'hit') { this.burst(.12 + p * .12, (.16 + .22 * p) * chase, 2100, pan); this.tone(150, 42, .16, (.08 + .12 * p) * chase, 'triangle', pan); if (p > .8) this.tone(1300, 420, .22, .04 * chase, 'sawtooth', pan); }
  else if (kind === 'contact') { this.burst(.16, (.08 + .12 * p) * chase, 1600, pan); this.tone(420, 130, .14, .03 * chase, 'square', pan); }
  else if (kind === 'blast') { this.burst(.7 + p, (.22 + .34 * p) * chase, 1900, pan, 60); this.tone(84, 24, .6 + p * .6, (.12 + .15 * p) * chase, 'sine', pan); }
  else if (kind === 'smash') { this.burst(.3, .22 * chase, 3200, pan); this.tone(240, 70, .2, .08 * chase, 'square', pan); }
  else if (kind === 'rock') { this.burst(.22, .1 + .1 * p, 620, pan, 60); this.tone(96, 38, .2, .07, 'triangle', pan); }
  else if (kind === 'scrape') this.burst(.2, .09 * chase, 5200, pan, 900);
  else if (kind === 'gear') this.burst(.12, .085, 2200);
  else if (kind === 'bridge') { this.underBridge = c.currentTime + .75; this.burst(.8, .13, 900, 0, 120); }
 }
 update(phase: RacePhase, value: number, seconds: number, quiet = false, runId = '', presentationAge?: number, restored = false) {
  const old = this.phase; this.phase = phase; const c = gameAudio.context;
  // Reopened runs reuse the unlocked shared context, respecting mute and visibility.
  if (c && !this.bus && gameAudio.output && this.allowed() && !restored && phase !== 'idle') this.create(c, gameAudio.output);
  if (!c || !this.bus) return;
  const changed = old !== phase || runId !== this.runId; if (changed) { this.phaseAt = c.currentTime; this.runId = runId; this.cueKeys.clear(); this.cuePlayed = []; }
  const age = presentationAge === undefined ? c.currentTime - this.phaseAt : Math.max(0, presentationAge), on = this.allowed() && !restored, running = phase === 'racing', waiting = phase === 'waiting', variant = pickStunt(runId, phase, value);
  this.bus.gain.setTargetAtTime(on ? .62 : 0, c.currentTime, .035);
  const leaving = phase === 'escaped' && (variant === 'cargo-plane' ? age < cargo.landing : variant === 'tunnel' ? age < tunnel.slide : age < heli.lift);
  this.engine!.gain.setTargetAtTime(on && (running || waiting || leaving || phase === 'crashed' && age < .6) ? running ? .50 : leaving ? .34 * (variant === 'tunnel' ? clamp(1 - (age - tunnel.inside) / .7) : 1) : .17 : 0, c.currentTime, .09);
  const road = running ? 1 : phase === 'escaped' ? clamp(1 - age / 4) : phase === 'crashed' ? clamp(1 - age) : 0, muffled = c.currentTime < this.underBridge;
  this.road!.gain.setTargetAtTime(on ? road * (muffled ? .34 : .23 + Math.min(.10, seconds * .014)) : 0, c.currentTime, .1); this.roadFilter!.frequency.setTargetAtTime(muffled ? 60 : 160, c.currentTime, .08);
  this.siren!.gain.setTargetAtTime(on && running && !quiet ? .04 : 0, c.currentTime, .13);
  const rotor = phase === 'escaped' && variant === 'helicopter' ? ease(age / 1.2) * (1 - ease((age - heli.depart) / 2.9)) : 0;
  this.rotor!.gain.setTargetAtTime(on ? rotor * (quiet ? .09 : .34 * (.73 + .27 * Math.sin(age * 38))) : 0, c.currentTime, .025);
  const rev = running ? 78 + (seconds % 1.65) * 32 + Math.min(45, Math.log(Math.max(1, value)) * 15) : waiting ? 52 + 46 * Math.abs(Math.sin(seconds * 4 + age * 4)) : 38;
  this.oscillators.forEach((o, i) => o.frequency.setTargetAtTime(rev * (i + 1), c.currentTime, .07)); this.sirenOsc!.frequency.setTargetAtTime(620 + Math.sin(seconds * 2.7) * 220, c.currentTime, .06);
  const cue = (key: string, at: number, play: () => void) => { if (age >= at && !this.cueKeys.has(key)) { this.cueKeys.add(key); if (on && !quiet && age < at + .24) { play(); this.cuePlayed.push(key); } } };
  if (on && changed) { this.played[phase] = (this.played[phase] ?? 0) + 1; if (quiet && phase === 'crashed' && age < .24) this.burst(.3, .16, 900); }
  if (phase === 'racing' && seconds < .24) cue('launch', 0, () => { this.tone(42, 105, .9, .17, 'sawtooth'); this.burst(.35, .14, 1600); });
  if (phase === 'escaped' && variant === 'cargo-plane') {
   cue('cargo-aircraft', cargo.planeAt, () => this.tone(45, 85, 4.2, .17, 'sawtooth'));
   cue('ramp-launch', cargo.takeoff, () => { this.tone(90, 280, .65, .16, 'sawtooth'); this.burst(.65, .19, 4400); });
   cue('cargo-landing', cargo.landing, () => { this.burst(.5, .24, 1800); this.tone(95, 36, .6, .16); });
   cue('aircraft-departure', cargo.departure, () => { this.tone(90, 32, 2.2, .12, 'sawtooth'); this.burst(1.4, .08, 2400); });
  }
  if (phase === 'escaped' && variant === 'helicopter') {
   cue('helicopter-inbound', 0, () => this.tone(100, 43, .8, .13, 'sawtooth'));
   cue('winch', 1.15, () => this.tone(310, 520, 1.1, .04, 'triangle'));
   cue('cables-taut', heli.lift, () => { this.burst(.18, .17, 1600); this.tone(170, 360, .65, .035, 'triangle'); });
   cue('helicopter-departure', heli.depart, () => { this.tone(90, 42, 1.4, .08, 'triangle'); this.burst(.7, .07, 2400); });
  }
  if (phase === 'escaped' && variant === 'tunnel') {
   cue('exit-turn', tunnel.turn, () => { this.burst(.9, .16, 4200, .4, 700); this.tone(620, 320, .7, .05, 'sawtooth', .4); });
   cue('tunnel-entry', tunnel.inside, () => { this.burst(1.1, .16, 700, .4, 70); this.tone(70, 44, 1, .1, 'triangle', .4); });
   cue('rockslide', tunnel.slide, () => { this.burst(1.9, .3, 520, .4, 50); this.tone(62, 26, 1.5, .16, 'sine', .4); });
  }
  if (phase === 'crashed') {
   cue('intercept', impactAt, () => { this.tone(130, 34, .19, .26); this.tone(1400, 350, .45, .07, 'sawtooth'); this.burst(.18, .42, 1700); this.burst(.48, .18, 4200); });
   cue('rollover', rollAt, () => { this.tone(520, 110, .42, .12, 'triangle'); this.burst(.25, .24, 1800); });
   cue('explosion', explosionAt, () => { this.burst(2.6, .62, 2400); this.tone(78, 22, 1.6, .29); });
  }
 }
 silence() { const c = gameAudio.context; if (c && this.bus) this.bus.gain.setTargetAtTime(0, c.currentTime, .025); }
 state() { const a = new Float32Array(512); this.analyser?.getFloatTimeDomainData(a); return { enabled: this.enabled, context: gameAudio.context?.state ?? 'locked', sources: this.sources.size, voices: this.voices, phase: this.phase, rms: Math.sqrt(a.reduce((v, n) => v + n * n, 0) / a.length), played: { ...this.played }, cues: [...this.cuePlayed], phaseAge: (gameAudio.context?.currentTime ?? 0) - this.phaseAt, cueActive: (gameAudio.context?.currentTime ?? Infinity) < this.cueUntil }; }
 destroy() {
  this.disposed = true; this.unsubscribe(); this.silence();
  for (const s of this.sources) { s.onended = null; try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
  this.sources.clear(); this.bus?.disconnect(); this.analyser?.disconnect(); LastExitAudio.owners.delete(this);
 }
}
