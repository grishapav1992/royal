export type CasinoSound = 'cabinet' | 'chips' | 'cards' | 'reels' | 'coin' | 'win' | 'start';
type Voice = { source: AudioScheduledSourceNode; gain: GainNode; background: boolean };

/** Original procedural sounds: no audio downloads or third-party recordings. */
export class CasinoAudio {
  private background: GainNode;
  private noise: AudioBuffer;
  private voices = new Set<Voice>();
  private timer?: ReturnType<typeof setTimeout>;
  private mode = '';
  private sequence = 0;
  private backgroundLevel = 0;

  constructor(private context: AudioContext, private output: GainNode, private onAmbient: (sound: CasinoSound) => void) {
    this.background = context.createGain();
    this.background.gain.value = 0;
    this.background.connect(output);
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * .25), context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  update(hall: string, game: string, enabled: boolean, duck = 1) {
    // Embedded games own their audio. Leave their soundtrack unobstructed.
    const running = enabled && game !== 'demo';
    const mode = `${hall}:${game}:${running}:${duck}`;
    if (mode === this.mode) return;
    this.mode = mode;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stopBackground();
    this.backgroundLevel = running ? (game === 'piano' ? .08 : game ? .2 : 1)*duck : 0;
    this.background.gain.setTargetAtTime(this.backgroundLevel, this.context.currentTime, .12);
    if (!running) return;
    const sounds: CasinoSound[] = hall === 'arcade'
      ? ['reels', 'cabinet', 'chips', 'coin', 'cabinet']
      : ['chips', 'cards', 'chips', 'cards'];
    const tick = () => {
      if (this.context.state === 'running' && !document.hidden) {
        const kind = sounds[this.sequence++ % sounds.length];
        if (this.play(kind, .16 + Math.random() * .09, Math.random() * 1.4 - .7, true)) this.onAmbient(kind);
      }
      this.timer = setTimeout(tick, 2300 + Math.random() * 2100);
    };
    this.timer = setTimeout(tick, 650);
  }

  private stopBackground() {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (!voice.background) continue;
      const gain = voice.gain.gain;
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else {
        const level = gain.value;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(level, now);
      }
      gain.linearRampToValueAtTime(0, now + .025);
      voice.source.stop(now + .03);
    }
  }

  private connect(source: AudioScheduledSourceNode, gain: GainNode, pan: number, background: boolean, nodes: AudioNode[] = []) {
    const stereo = this.context.createStereoPanner();
    stereo.pan.value = pan;
    gain.connect(stereo);
    stereo.connect(background ? this.background : this.output);
    const voice = { source, gain, background };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); stereo.disconnect();
      nodes.forEach(node => node.disconnect());
      this.voices.delete(voice);
    };
  }

  private tone(frequency: number, duration: number, level: number, delay: number, pan: number, background: boolean, end = frequency) {
    const at = this.context.currentTime + delay;
    const source = this.context.createOscillator(), gain = this.context.createGain();
    source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(end, at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + .003);
    gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    source.connect(gain);
    this.connect(source, gain, pan, background);
    source.start(at); source.stop(at + duration + .01);
  }

  private rustle(frequency: number, duration: number, level: number, delay: number, pan: number, background: boolean) {
    const at = this.context.currentTime + delay;
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
    source.buffer = this.noise;
    filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .8;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + .004);
    gain.gain.exponentialRampToValueAtTime(.00001, at + duration);
    source.connect(filter); filter.connect(gain);
    this.connect(source, gain, pan, background, [filter]);
    source.start(at); source.stop(at + duration + .01);
  }

  play(kind: CasinoSound, level = 1, pan = 0, background = false): boolean {
    if (this.context.state !== 'running' || this.voices.size > 90 || level <= 0) return false;
    const tone = (f: number, duration: number, volume: number, delay = 0, end = f) =>
      this.tone(f, duration, volume * level, delay, pan, background, end);
    const noise = (f: number, duration: number, volume: number, delay = 0) =>
      this.rustle(f, duration, volume * level, delay, pan, background);
    const bell = (f: number, delay: number, volume = .08, duration = .4) => {
      tone(f, duration, volume, delay);
      tone(f * 2.76, duration * .4, volume * .2, delay);
    };
    if (kind === 'chips') {
      for (let i = 0; i < 4; i++) {
        const at = i * .075 + Math.random() * .012;
        noise(2400, .045, .14, at);
        tone(1700 + Math.random() * 350, .035, .055, at);
        tone(680, .025, .035, at);
      }
    } else if (kind === 'cards') {
      for (let i = 0; i < 6; i++) noise(1800 + i * 190, .075, .085, i * .055);
      noise(650, .05, .1, .4);
    } else if (kind === 'reels') {
      let at = 0;
      for (let i = 0; i < 11; i++) {
        noise(1000 + i * 65, .022, .06, at);
        tone(185, .025, .035, at, 100);
        at += .038 + i * .005;
      }
      [0, .13, .28].forEach((delay, i) => {
        noise(750, .045, .16, at + delay);
        bell([659, 784, 1047][i], at + delay, .04, .23);
      });
    } else if (kind === 'coin') {
      bell(1397, 0, .085, .3); bell(2093, .075, .06, .38);
      noise(3200, .025, .04);
    } else if (kind === 'win') {
      [523, 659, 784, 1047, 1319].forEach((f, i) => bell(f, i * .105, .07, .55));
      [523, 659, 784].forEach(f => tone(f, .7, .035, .55));
      for (let i = 0; i < 7; i++) bell(1568 + (i % 3) * 260, .65 + i * .075, .025, .2);
    } else if (kind === 'start') {
      noise(1800, .04, .12);
      [392, 523, 659].forEach((f, i) => bell(f, .07 + i * .09, .07, .3));
    } else {
      const melodies = [[659, 784, 1047, 784], [523, 659, 784, 1047], [784, 1047, 988, 784]];
      const melody = melodies[Math.floor(Math.random() * melodies.length)];
      melody.forEach((f, i) => bell(f, i * .13, .055, .32));
    }
    return true;
  }

  getState() { return { active: this.voices.size, scheduled: this.timer !== undefined, level: this.backgroundLevel }; }
}
