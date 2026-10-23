import type { GameAudio } from '../../src/game/GameAudio';

export type BattleCue = 'spin' | 'stop' | 'emblem' | 'scatter' | 'granite' | 'impulse' | 'prism'
  | 'win' | 'finisher' | 'boss-hit' | 'shield-break' | 'boss-arrival' | 'boss-defeated'
  | 'clear' | 'land' | 'tally' | 'round-win' | 'round-big' | 'round-epic' | 'round-end' | 'return';
export type ScheduledAccent = { cue: BattleCue; variant: number; audibleAt: number; at: number; mode: string; cancel: () => void; valid: () => boolean };
type HostAudio = Pick<GameAudio, 'context' | 'output' | 'unlock' | 'getPreferences' | 'onPreferences'>;
type Voice = { source: AudioScheduledSourceNode; gain: GainNode; nodes: AudioNode[]; music: boolean };
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const THEMES = [
  { root: 38, bpm: 108, chords: [0,-2,-5,-7,0,3,-5,-2], motif: [12,19,22,24,19,17,15,14] },
  { root: 36, bpm: 116, chords: [0,-1,-5,-2,0,3,-1,-2], motif: [12,13,19,24,22,19,13,12] },
  { root: 40, bpm: 126, chords: [0,-5,3,-2,0,5,3,-2], motif: [24,19,22,26,24,22,19,14] },
];

/** Original score and cinematic Foley. All voices feed Royal's shared audio output. */
export class NeopolisScore {
  private voices = new Set<Voice>();
  private music: GainNode;
  private effects: GainNode;
  private reverb: ConvolverNode;
  private wet: GainNode;
  private noise: AudioBuffer;
  private strings: PeriodicWave;
  private brass: PeriodicWave;
  private meter: AnalyserNode;
  private sample = new Float32Array(256);
  private reelLoop?: Voice;
  private scene = 0;

  constructor(readonly context: BaseAudioContext, output: AudioNode) {
    this.music = context.createGain(); this.music.gain.value = .6;
    this.effects = context.createGain(); this.effects.gain.value = .7;
    this.meter = context.createAnalyser(); this.meter.fftSize = 256;
    this.music.connect(this.meter); this.meter.connect(output); this.effects.connect(output);
    this.reverb = context.createConvolver(); this.wet = context.createGain(); this.wet.gain.value = .22;
    this.music.connect(this.reverb); this.effects.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(output);
    // Seeded buffers make the sound design reproducible and independent of game entropy.
    let seed = 271828;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const noise = this.noise.getChannelData(0); for (let i = 0; i < noise.length; i++) noise[i] = random();
    const impulse = context.createBuffer(2, context.sampleRate * 2.2, context.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = random() * (1 - i / data.length) ** 3;
    }
    this.reverb.buffer = impulse;
    const real = new Float32Array(24), stringHarmonics = new Float32Array(24), brassHarmonics = new Float32Array(24);
    for (let i = 1; i < 24; i++) { stringHarmonics[i] = 1 / i ** 1.3; brassHarmonics[i] = (i % 2 ? 1 : .5) / i ** .85; }
    this.strings = context.createPeriodicWave(real, stringHarmonics);
    this.brass = context.createPeriodicWave(real, brassHarmonics);
  }

  private voice(source: AudioScheduledSourceNode, nodes: AudioNode[], gain: GainNode, at: number, duration: number, music: boolean) {
    if (this.voices.size >= 76) { source.disconnect(); for (const node of nodes) node.disconnect(); return; }
    const voice = { source, nodes, gain, music }; this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); if (this.reelLoop===voice) this.reelLoop=undefined; source.disconnect(); for (const node of nodes) node.disconnect(); };
    source.start(at); source.stop(at + duration + .03);
    return voice;
  }

  private note(midi: number, at: number, duration: number, level: number, instrument: 'string' | 'horn' | 'bell' | 'bass' = 'string', music = true, endMidi = midi) {
    const c = this.context, osc = c.createOscillator(), filter = c.createBiquadFilter(), gain = c.createGain();
    if (instrument === 'string' || instrument === 'horn') osc.setPeriodicWave(instrument === 'string' ? this.strings : this.brass);
    else osc.type = instrument === 'bell' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(hz(midi), at); osc.frequency.exponentialRampToValueAtTime(hz(endMidi), at + duration);
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(instrument === 'horn' ? 650 : instrument === 'string' ? 1500 : 5000, at);
    if (instrument === 'horn') { filter.frequency.linearRampToValueAtTime(1500, at + .13); filter.frequency.exponentialRampToValueAtTime(450, at + duration); }
    const attack = instrument === 'horn' ? .075 : instrument === 'string' ? Math.min(.09, duration / 5) : .007;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001,level * .45), at + duration * .65);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    osc.connect(filter); filter.connect(gain); gain.connect(music ? this.music : this.effects);
    this.voice(osc, [filter,gain], gain, at, duration, music);
  }

  private air(at: number, duration: number, level: number, frequency: number, music = false, endFrequency = frequency) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.noise; source.loop = true;
    filter.type = 'bandpass'; filter.frequency.setValueAtTime(frequency, at); filter.frequency.exponentialRampToValueAtTime(endFrequency, at + duration); filter.Q.value = .7;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter); filter.connect(gain); gain.connect(music ? this.music : this.effects);
    this.voice(source, [filter,gain], gain, at, duration, music);
  }

  private drum(at: number, level: number, music: boolean, high = false) {
    this.note(high ? 50 : 38, at, high ? .25 : .52, level, 'bass', music, high ? 33 : 21);
    this.air(at, .12, level * .7, high ? 470 : 160, music);
  }

  /** One eighth-note tick. Eight bars form a seamless, varied musical phrase. */
  tick(tick: number, at: number, stage: number, battle: boolean) {
    const theme = THEMES[stage], beat = 60 / (theme.bpm + (battle ? 8 : 0)), step = tick % 8, bar = Math.floor(tick / 8) % 8;
    const chord = theme.root + theme.chords[bar], intensity = battle ? 1 : .68;
    const minor = theme.chords[bar] === 3 || theme.chords[bar] === -5 || theme.chords[bar] === -1 ? 4 : 3;
    // Cello ostinato and low strings keep motion under the heroic brass melody.
    this.note(chord + [12,19,12,24,12,19,15,19][step], at, beat * .41, .055 * intensity);
    if (step % 2 === 0) this.note(chord, at, beat * .82, .075 * intensity, 'bass');
    if (step === 0) {
      for (const offset of [12,12 + minor,19]) this.note(chord + offset, at, beat * 3.7, .035 * intensity);
      this.air(at, bar % 4 === 0 ? 1.7 : .65, bar % 4 === 0 ? .1 : .035, 6200, true);
    }
    if (step === 0 || step === 4 || (battle && (step === 3 || step === 7))) this.drum(at, (step === 0 ? .2 : .12) * intensity, true, step === 3 || step === 7);
    if (step === 2 || step === 6) this.air(at, .15, .035 * intensity, 2800, true);
    if (step === 0 || step === 3 || step === 6) {
      const melody = theme.root + theme.motif[(bar + (step === 0 ? 0 : step === 3 ? 2 : 4)) % 8];
      this.note(melody + 12, at, beat * (step === 6 ? .9 : 1.35), .064 * intensity, 'horn');
      if (battle) this.note(melody, at, beat * 1.1, .032, 'horn');
    }
    if (stage === 2) this.note(chord + (step % 2 ? 31 : 24), at, .14, .026, 'bell');
    return beat / 2;
  }

  cue(cue: BattleCue, at = this.context.currentTime + .006, variant = 0) {
    const root = 38;
    const transpose=THEMES[this.scene].root-38;
    if (cue === 'spin') { this.air(at,.32,.085,120,false,650); return; }
    if (cue === 'stop') { this.air(at,.045,.055,430); this.note(50+transpose+[0,3,5,7,10][variant%5],at,.09,.04,'bass',false,43+transpose); return; }
    if (cue === 'clear') { this.air(at,.15,.045,1600,false,550); return; }
    if (cue === 'land') { this.air(at,.06,.035,270); this.note(43+transpose+variant%3,at,.1,.028,'bass',false,35+transpose); return; }
    if (cue === 'tally') { this.note(74+transpose+[0,3,7,10][variant%4],at,.22,.025,'bell',false); return; }
    if (cue === 'return') { this.note(62,at,.2,.027,'bell',false); return; }
    if (cue === 'round-end') { [74,77,81].forEach(note=>this.note(note+transpose,at,.48,.045,'bell',false)); return; }
    if (cue === 'round-win' || cue === 'round-big' || cue === 'round-epic') {
      const large=cue!=='round-win', epic=cue==='round-epic';
      this.duck(at,large ? 1.2 : .65);
      [62,65,69,74].forEach((note,i)=>this.note(note+transpose,at+i*.035,large ? .95 : .5,large ? .06 : .035,'horn',false));
      [86,89,93].forEach((note,i)=>this.note(note+transpose,at+.08+i*.075,.65,.045,'bell',false));
      if (large) { this.drum(at,.24,false); this.air(at,.85,.065,4000); }
      if (epic) [74,77,81].forEach((note,i)=>this.note(note+transpose,at+.3+i*.09,.8,.05,'horn',false));
      return;
    }
    if (cue === 'emblem' || cue === 'win' || cue === 'scatter') {
      const notes = cue === 'scatter' ? [74,81,86] : cue === 'win' ? [74+transpose+[0,3,5,7,10][Math.min(variant,4)]] : [86];
      notes.forEach((note,i) => this.note(note,at+i*.06,.32,cue==='win' ? .035 : .06,'bell',false)); return;
    }
    this.duck(at, cue === 'boss-arrival' ? 1.8 : 1);
    if (cue === 'granite' || cue === 'boss-hit') {
      this.drum(at,cue==='granite' ? .55 : .34,false); this.air(at,.65,.25,380, false,90);
      this.note(30,at,.8,.13,'horn',false,21);
    } else if (cue === 'impulse') {
      for (let i=0;i<4;i++) { this.note(90-i*7,at+i*.045,.19,.075,'horn',false,42); this.air(at+i*.045,.13,.12,3000,false,650); }
      this.drum(at+.15,.25,false);
    } else if (cue === 'prism' || cue === 'shield-break') {
      this.air(at,.8,.14,cue==='prism' ? 350 : 4200,false,cue==='prism' ? 3000 : 450);
      [86,93,98,103,105].forEach((note,i) => this.note(note,at+i*.055,.7,.055,'bell',false));
      if (cue==='shield-break') this.drum(at,.38,false);
    } else {
      const victory = cue === 'boss-defeated' || cue === 'finisher';
      const chord = victory ? [12,15,19,24] : [0,1,7,12];
      chord.forEach((note,i) => this.note(root+note,at+(victory ? i*.08 : 0),1.5,.09,'horn',false));
      this.drum(at+.08,.48,false); this.air(at,1.4,.22,2800,false,500);
      if (cue === 'finisher') [74,77,81].forEach((note,i) => this.note(note,at+.15+i*.11,.9,.065,'bell',false));
    }
  }

  setScene(stage: number) { this.scene=stage; }
  schedule(cue: BattleCue, at: number, variant: number) {
    const before = new Set(this.voices); this.cue(cue,at,variant);
    const owned = [...this.voices].filter(voice => !before.has(voice));
    return () => { for (const voice of owned) if (this.voices.has(voice)) this.fade(voice); };
  }
  spinning(value: boolean) {
    if (!value) { if (this.reelLoop) this.fade(this.reelLoop); this.reelLoop=undefined; return; }
    if (this.reelLoop) return;
    const c=this.context,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain(),at=c.currentTime;
    source.buffer=this.noise; source.loop=true; filter.type='lowpass'; filter.frequency.value=420;
    gain.gain.setValueAtTime(0,at); gain.gain.linearRampToValueAtTime(.022,at+.22);
    source.connect(filter); filter.connect(gain); gain.connect(this.effects);
    this.reelLoop=this.voice(source,[filter,gain],gain,at,30,false);
  }
  private fade(voice: Voice) {
    const at=this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(at); voice.gain.gain.setTargetAtTime(0,at,.008);
    try { voice.source.stop(at+.04); } catch { /* The source may have ended. */ }
  }
  cancelEffects() { for (const voice of this.voices) if (!voice.music) this.fade(voice); this.reelLoop=undefined; }
  private duck(at: number, duration: number) {
    this.music.gain.cancelScheduledValues(at); this.music.gain.setValueAtTime(.2,at);
    this.music.gain.setTargetAtTime(.6,at+duration,.35);
  }
  cancel(musicOnly = false) {
    const at = this.context.currentTime;
    for (const voice of this.voices) {
      if (musicOnly && !voice.music) continue;
      this.fade(voice);
    }
    if (!musicOnly) this.reelLoop=undefined;
    this.music.gain.cancelScheduledValues(at); this.music.gain.setValueAtTime(.6,at);
    if (!musicOnly) {
      // Flush the convolution tail too, so a pause never leaks a battle sound.
      this.reverb.disconnect(); this.reverb.connect(this.wet); this.wet.gain.cancelScheduledValues(at);
      this.wet.gain.setValueAtTime(0,at); this.wet.gain.setValueAtTime(.22,at+2.3);
    }
  }
  getState() {
    this.meter.getFloatTimeDomainData(this.sample);
    return { voices: this.voices.size, musicRms: Math.sqrt(this.sample.reduce((sum,n) => sum+n*n,0)/this.sample.length) };
  }
  destroy() { this.cancel(); this.music.disconnect(); this.effects.disconnect(); this.meter.disconnect(); this.reverb.disconnect(); this.wet.disconnect(); }
}

export class NeopolisAudio {
  private score?: NeopolisScore;
  private context?: AudioContext;
  private timer?: ReturnType<typeof setInterval>;
  private next = 0;
  private tick = 0;
  private stage = 0;
  private battle = false;
  private paused = false;
  private dead = false;
  private requested = false;
  private spinningWanted = false;
  private epoch = 0;
  private accents: {cue:BattleCue;variant:number;audibleAt:number;visualAt:number;deltaMs:number;mode:string}[] = [];
  private cues: Partial<Record<BattleCue,number>> = {};
  private recent = new Map<BattleCue,number>();
  private off: () => void;
  private visibility = () => this.sync();
  private stateChange = () => this.sync();
  constructor(private host: HostAudio, private document: Document) {
    this.off = host.onPreferences(() => this.sync());
    document.addEventListener('visibilitychange',this.visibility);
    // The first deliberate interaction unlocks music, without changing saved mute preferences.
    document.addEventListener('pointerdown',this.gesture,true);
    document.addEventListener('keydown',this.gesture,true);
    if (host.context?.state === 'running') void this.start();
  }
  private gesture = () => { void this.start(); };
  private enabled() { const p = this.host.getPreferences(); return !this.dead && !this.paused && !this.document.hidden && !p.muted && p.volume > 0 && this.context?.state === 'running'; }
  async start() {
    if (this.dead) return;
    this.requested = true;
    await this.host.unlock();
    if (this.dead) return;
    this.sync();
  }
  private sync() {
    if (this.dead) return;
    const c = this.host.context, output = this.host.output;
    if (this.requested && c && output && c !== this.context) {
      this.stop(); this.score?.destroy(); this.context?.removeEventListener('statechange',this.stateChange);
      this.context = c; this.score = new NeopolisScore(c,output); this.score.setScene(this.stage); c.addEventListener('statechange',this.stateChange);
    }
    if (!this.requested || !this.enabled()) { this.stop(); return; }
    this.score?.spinning(this.spinningWanted);
    if (this.timer || !this.score || !this.context) return;
    this.next = this.context.currentTime + .04;
    this.timer = setInterval(() => this.scheduleMusic(),35); this.scheduleMusic();
  }
  private scheduleMusic() {
    if (!this.enabled() || !this.context || !this.score) { this.stop(); return; }
    // Small lookahead prevents stale notes after tab/host pauses, without timer jitter.
    if (this.next < this.context.currentTime) this.next = this.context.currentTime + .02;
    while (this.next < this.context.currentTime + .12) this.next += this.score.tick(this.tick++,this.next,this.stage,this.battle);
  }
  setScene(stage: number, battle: boolean) {
    if (this.stage === stage && this.battle === battle) return;
    this.stage = stage; this.battle = battle; this.tick = 0;
    this.score?.setScene(stage);
    this.score?.cancel(true); if (this.context) this.next = this.context.currentTime + .1;
  }
  play(cue: BattleCue) {
    if (!this.enabled() || !this.score) return;
    const now = performance.now();
    if (now - (this.recent.get(cue) ?? -Infinity) < (cue==='stop' ? 40 : cue==='emblem' ? 100 : 120)) return;
    this.recent.set(cue,now); this.cues[cue]=(this.cues[cue] ?? 0)+1; this.score.cue(cue);
  }
  pause(value: boolean) { this.paused = value; this.sync(); }
  private outputClock() {
    const c=this.context,now=performance.now();
    if (!c) return {lead:0,mode:'silent',contextTime:0,performanceTime:now};
    const stamp=c.getOutputTimestamp?.();
    if (stamp?.contextTime && stamp.performanceTime) {
      const lead=stamp.performanceTime+(c.currentTime-stamp.contextTime)*1000-now;
      if (lead>=0 && lead<1000) return {lead,mode:'output-timestamp',contextTime:stamp.contextTime,performanceTime:stamp.performanceTime};
    }
    const lead=((c.baseLatency || 0)+(c.outputLatency || 0))*1000;
    return {lead,mode:'latency-estimate',contextTime:c.currentTime,performanceTime:now+lead};
  }
  get leadMs() { return this.enabled() ? this.outputClock().lead : 0; }
  schedule(cue: BattleCue, delayMs: number, variant=0): ScheduledAccent | undefined {
    if (!this.enabled() || !this.context || !this.score) return;
    const clock=this.outputClock(),target=performance.now()+delayMs;
    const at=Math.max(this.context.currentTime+.008,clock.contextTime+(target-clock.performanceTime)/1000);
    const audibleAt=clock.performanceTime+(at-clock.contextTime)*1000,epoch=this.epoch;
    const stop=this.score.schedule(cue,at,variant); let canceled=false;
    this.cues[cue]=(this.cues[cue] ?? 0)+1;
    return {cue,variant,at,audibleAt,mode:clock.mode,cancel:()=>{canceled=true;stop();},valid:()=>!canceled && epoch===this.epoch && this.enabled()};
  }
  markVisual(ticket: ScheduledAccent, visualAt: number) {
    if (!ticket.valid()) return;
    this.accents.push({cue:ticket.cue,variant:ticket.variant,audibleAt:ticket.audibleAt,visualAt,deltaMs:visualAt-ticket.audibleAt,mode:ticket.mode});
    if (this.accents.length>64) this.accents.shift();
  }
  spinning(value: boolean) { this.spinningWanted=value; this.score?.spinning(value && this.enabled()); }
  cancelEffects() { this.epoch++; this.spinningWanted=false; this.score?.cancelEffects(); }
  private stop() { this.epoch++; if (this.timer) { clearInterval(this.timer); this.timer=undefined; } this.score?.cancel(); }
  getState() { return { playing:!!this.timer, stage:this.stage, battle:this.battle, tick:this.tick, context:this.context?.state ?? 'locked', cues:{...this.cues}, spinning:this.spinningWanted&&this.enabled(),leadMs:this.leadMs,accents:this.accents.map(value=>({...value})), ...this.score?.getState() }; }
  destroy() {
    if (this.dead) return;
    this.dead=true; this.stop(); this.score?.destroy(); this.off();
    this.context?.removeEventListener('statechange',this.stateChange);
    this.document.removeEventListener('visibilitychange',this.visibility);
    this.document.removeEventListener('pointerdown',this.gesture,true); this.document.removeEventListener('keydown',this.gesture,true);
  }
}
