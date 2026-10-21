import type { GameAudio } from '../../src/game/GameAudio';

export type MagicCue = 'cast' | 'settle' | 'cascade' | 'portal' | 'bonus' | 'finish' | 'fizzle';
type HostAudio = Pick<GameAudio, 'context' | 'output' | 'unlock' | 'getPreferences' | 'onPreferences'>;
type Voice = { source: AudioBufferSourceNode; gain: GainNode; cue: MagicCue; fading: boolean };
const CUES: MagicCue[] = ['cast', 'settle', 'cascade', 'portal', 'bonus', 'finish', 'fizzle'];
const QUICK = new Set<MagicCue>(['cast', 'cascade', 'portal']);
const LEVEL: Record<MagicCue, number> = { cast: .58, settle: .38, cascade: .48, portal: .58, bonus: .58, finish: .52, fizzle: .36 };

/** This module owns samples and voices, while Royal owns the context, output and preferences. */
export class DraconaAudio {
  private controller = new AbortController();
  private raw = new Map<string, Promise<ArrayBuffer | undefined>>();
  private decoded = new Map<string, Promise<AudioBuffer | undefined>>();
  private context?: AudioContext;
  private voices = new Set<Voice>();
  private previous = new Map<MagicCue, number>();
  private epoch = 0;
  private quick = false;
  private dead = false;
  private failed = 0;
  private played: Partial<Record<MagicCue, number>> = {};
  private skipped = 0;
  private ready = 0;
  private offPreferences: () => void;
  private visibility = () => { if (this.document.hidden) this.cancel(); };
  private stateChange = () => { if (this.context?.state !== 'running') this.cancel(); };

  constructor(private host: HostAudio, private document: Document, private fetcher: typeof fetch = fetch,
    private changed: (state: ReturnType<DraconaAudio['getState']>) => void = () => {}) {
    this.offPreferences = host.onPreferences(value => { if (value.muted || value.volume === 0) this.cancel(); });
    document.addEventListener('visibilitychange', this.visibility);
    for (const cue of CUES) void this.load(cue);
    for (const cue of QUICK) void this.load(cue + '-quick');
  }

  private enabled() {
    const preferences = this.host.getPreferences();
    return !this.dead && !this.document.hidden && !preferences.muted && preferences.volume > 0;
  }

  private load(name: string) {
    let promise = this.raw.get(name);
    if (!promise) {
      promise = this.fetcher.call(globalThis, '/assets/dracona/audio/' + name + '.mp3', { signal: this.controller.signal })
        .then(response => { if (!response.ok) throw Error('Audio unavailable'); return response.arrayBuffer(); })
        .then(bytes => { this.ready++; this.report(); return bytes; })
        .catch(() => { this.raw.delete(name); if (!this.dead) { this.failed++; this.report(); } return undefined; });
      this.raw.set(name, promise);
    }
    return promise;
  }

  private buffer(name: string, context: AudioContext) {
    let promise = this.decoded.get(name);
    if (!promise) {
      promise = this.load(name).then(bytes => bytes ? context.decodeAudioData(bytes.slice(0)) : undefined)
        .catch(() => { if (!this.dead) this.failed++; return undefined; });
      this.decoded.set(name, promise);
    }
    return promise;
  }

  begin(speed: 'normal' | 'fast' | 'turbo') {
    this.cancel(); this.previous.clear(); this.quick = speed !== 'normal';
  }

  async play(cue: MagicCue): Promise<void> {
    if (!this.enabled()) { this.skipped++; return; }
    const requested = performance.now();
    if (requested - (this.previous.get(cue) ?? -Infinity) < (cue === 'settle' ? 130 : 180)) { this.skipped++; return; }
    this.previous.set(cue, requested);
    if (cue === 'bonus' || cue === 'finish') this.cancel();
    const epoch = this.epoch;
    try {
      await this.host.unlock();
      const context = this.host.context, output = this.host.output;
      if (!context || !output || context.state !== 'running' || !this.enabled() || epoch !== this.epoch) return;
      // Changing to the shared context invalidates any voices from its predecessor.
      if (this.context !== context) {
        for (const voice of this.voices) this.fade(voice);
        this.context?.removeEventListener('statechange', this.stateChange);
        this.decoded.clear(); this.context = context;
        context.addEventListener('statechange', this.stateChange);
      }
      const quick = this.quick && QUICK.has(cue);
      const buffer = await this.buffer(cue + (quick ? '-quick' : ''), context);
      if (!buffer || !this.enabled() || context.state !== 'running' || this.context !== context || epoch !== this.epoch || performance.now() - requested > 700) {
        this.skipped++; return;
      }
      for (const voice of this.voices) {
        if (voice.cue === cue || (cue === 'portal' && voice.cue !== 'bonus') || (cue === 'cascade' && voice.cue === 'cast')) this.fade(voice);
      }
      const active = [...this.voices].filter(voice => !voice.fading);
      while (active.length >= 3) this.fade(active.shift()!);
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer;
      const at = context.currentTime + .005, duration = buffer.duration;
      const level = LEVEL[cue] * (this.quick && cue !== 'bonus' && cue !== 'finish' ? .78 : 1);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + .008);
      gain.gain.setValueAtTime(level, at + Math.max(.01, duration - .08));
      gain.gain.linearRampToValueAtTime(0, at + duration);
      source.connect(gain); gain.connect(output);
      const voice: Voice = { source, gain, cue, fading: false };
      this.voices.add(voice);
      source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); this.report(); };
      source.start(at); source.stop(at + duration + .01);
      this.played[cue] = (this.played[cue] ?? 0) + 1;
      this.report();
    } catch { if (!this.dead) this.failed++; }
  }

  private fade(voice: Voice) {
    if (voice.fading) return;
    voice.fading = true;
    const at = this.context?.currentTime ?? 0;
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setTargetAtTime(0, at, .008);
    try { voice.source.stop(at + .04); } catch { /* Already ended. */ }
  }

  private report() { if (!this.dead) this.changed(this.getState()); }
  cancel() { this.epoch++; for (const voice of this.voices) this.fade(voice); this.report(); }
  getState() { return { active: [...this.voices].filter(voice => !voice.fading).length, loaded: this.ready,
    played: { ...this.played }, failed: this.failed, skipped: this.skipped, quick: this.quick, enabled: this.enabled(),
    context: this.context?.state ?? 'locked' }; }
  destroy() {
    if (this.dead) return;
    this.dead = true; this.cancel(); this.controller.abort(); this.offPreferences();
    this.document.removeEventListener('visibilitychange', this.visibility);
    this.context?.removeEventListener('statechange', this.stateChange);
    this.raw.clear(); this.decoded.clear();
  }
}
