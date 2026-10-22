import { gameAudio } from '../game/GameAudio';
import type { PenaltyHero } from '../shared/crLeo';

export const CR_LEO_SOUNDS = ['stadium', 'goal', 'miss', 'siuuu', 'ankara-messi', 'kick'] as const;
type Clip = typeof CR_LEO_SOUNDS[number];
type Role = 'ambience' | 'reaction' | 'voice' | 'effect';
export interface CrLeoAudioPorts {
  context: () => BaseAudioContext | undefined;
  output: () => AudioNode | undefined;
  allowed: () => boolean;
  unlock: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  fetch: (url: string) => Promise<Response>;
}
const browserPorts: CrLeoAudioPorts = {
  context: () => gameAudio.context, output: () => gameAudio.output,
  allowed: () => !document.hidden && !gameAudio.getPreferences().muted && gameAudio.getPreferences().volume > 0 && gameAudio.context?.state === 'running',
  unlock: () => gameAudio.unlock(), subscribe: listener => gameAudio.onPreferences(listener),
  fetch: url => fetch(url, { signal: AbortSignal.timeout(12000) }),
};
// Decoded recordings use the host context and survive a game window reopening.
const cache = new WeakMap<BaseAudioContext, Map<Clip, Promise<AudioBuffer>>>();
type Live = { source: AudioScheduledSourceNode; gain: GainNode; role: Role };
export class CrLeoAudio {
  enabled = true;
  private entered = false;
  private closed = false;
  private context?: BaseAudioContext;
  private master?: GainNode;
  private buffers = new Map<Clip, AudioBuffer>();
  private live = new Set<Live>();
  private crowd?: Live;
  private loading?: Promise<void>;
  private failures = 0;
  private played: Partial<Record<Clip, number>> = {};
  private unsubscribe: () => void;
  private contextChanged = () => { if (this.context?.state !== 'running') this.silence(); else this.ambient(); };
  constructor(private ports: CrLeoAudioPorts = browserPorts) {
    try { this.enabled = localStorage.getItem('royal-cr-leo-sound') !== '0'; } catch {}
    this.unsubscribe = ports.subscribe(() => { if (!this.allowed()) this.silence(); else this.ambient(); });
  }
  private allowed() { return this.entered && this.enabled && !this.closed && this.ports.allowed(); }
  async unlock() {
    if (this.closed) return;
    this.entered = true;
    try { await this.ports.unlock(); } catch { return; }
    if (this.closed) return;
    const context = this.ports.context(), output = this.ports.output();
    if (!context || !output) return;
    if (context !== this.context) {
      this.silence(); this.master?.disconnect(); this.buffers.clear();
      this.context?.removeEventListener('statechange', this.contextChanged);
      this.context = context; this.master = context.createGain(); this.master.gain.value = .85; this.master.connect(output);
      context.addEventListener('statechange', this.contextChanged);
    }
    await this.prepare(); this.ambient();
  }
  private prepare() {
    if (this.loading) return this.loading;
    const context = this.context; if (!context || this.closed) return Promise.resolve();
    let shared = cache.get(context); if (!shared) { shared = new Map(); cache.set(context, shared); }
    const task = Promise.all(CR_LEO_SOUNDS.filter(clip => !this.buffers.has(clip)).map(async clip => {
      let load = shared.get(clip);
      if (!load) {
        load = this.ports.fetch(`/assets/cr-vs-leo/audio/v1/${clip}.mp3`).then(async response => {
          if (!response.ok) throw Error('Stadium audio unavailable');
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw Error('Empty stadium audio');
          return buffer;
        });
        shared.set(clip, load);
        void load.catch(() => { if (shared.get(clip) === load) shared.delete(clip); });
      }
      try { const buffer = await load; if (!this.closed && this.context === context) { this.buffers.set(clip, buffer); if (clip === 'stadium') this.ambient(); } }
      catch { if (!this.closed) this.failures++; }
    })).then(() => {}).finally(() => { if (this.loading === task) this.loading = undefined; });
    this.loading = task; return task;
  }
  private attach(source: AudioScheduledSourceNode, gain: GainNode, role: Role) {
    const live = { source, gain, role }; this.live.add(live);
    source.onended = () => {
      this.live.delete(live); source.disconnect(); gain.disconnect();
      if (this.crowd === live) this.crowd = undefined;
      this.mix();
    };
    return live;
  }
  private stop(role?: Role) {
    for (const live of [...this.live]) if (!role || live.role === role) {
      live.source.onended = null; try { live.source.stop(); } catch {}
      live.source.disconnect(); live.gain.disconnect(); this.live.delete(live);
      if (this.crowd === live) this.crowd = undefined;
    }
    this.mix();
  }
  private mix() {
    if (!this.crowd || !this.context) return;
    const voice = [...this.live].some(live => live.role === 'voice'), reaction = [...this.live].some(live => live.role === 'reaction');
    this.crowd.gain.gain.setTargetAtTime(voice ? .09 : reaction ? .16 : .28, this.context.currentTime, .16);
  }
  private clip(clip: Clip, role: Role, volume: number, delay = 0, loop = false) {
    const c = this.context, buffer = this.buffers.get(clip);
    if (!this.allowed() || !c || !this.master || !buffer) return;
    const source = c.createBufferSource(), gain = c.createGain(); source.buffer = buffer; source.loop = loop;
    const at = c.currentTime + delay; gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(volume, at + (loop ? .6 : clip === 'kick' ? .002 : .025));
    source.connect(gain).connect(this.master); const live = this.attach(source, gain, role);
    source.start(at); this.played[clip] = (this.played[clip] ?? 0) + 1;
    return live;
  }
  private ambient() { if (!this.crowd) this.crowd = this.clip('stadium', 'ambience', .28, 0, true); }
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('royal-cr-leo-sound', this.enabled ? '1' : '0'); } catch {}
    if (!this.enabled) this.silence(); else void this.unlock();
  }
  private tone(frequency: number, duration: number, volume: number, end = frequency, delay = 0, type: OscillatorType = 'sine') {
    const c = this.context; if (!this.allowed() || !c || !this.master) return;
    const at = c.currentTime + delay, osc = c.createOscillator(), gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, at); osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    gain.gain.setValueAtTime(.001, at); gain.gain.exponentialRampToValueAtTime(volume, at + .012); gain.gain.exponentialRampToValueAtTime(.001, at + duration);
    osc.connect(gain).connect(this.master); this.attach(osc, gain, 'effect'); osc.start(at); osc.stop(at + duration + .03);
  }
  kick() {
    this.stop('voice'); this.stop('reaction');
    this.clip('kick', 'effect', 1);
    if (this.allowed() && this.crowd && this.context) this.crowd.gain.gain.setTargetAtTime(.42, this.context.currentTime, .25);
  }
  goal() {
    this.stop('voice'); this.stop('reaction');
    this.clip('goal', 'reaction', .70); this.mix();
  }
  celebrate(hero: PenaltyHero) {
    this.stop('voice');
    this.clip(hero === 'cr' ? 'siuuu' : 'ankara-messi', 'voice', 1); this.mix();
  }
  event(event: 'kick' | 'goal' | 'post' | 'save' | 'wall' | 'celebrate', hero: PenaltyHero) {
    if (event === 'kick') this.kick(); else if (event === 'goal') this.goal();
    else if (event === 'celebrate') this.celebrate(hero);
    else if (event === 'wall') this.wall(); else this.miss(event === 'post');
  }
  wall() { this.miss(false); this.tone(95, .18, .28, 35); this.tone(450, .07, .08, 180, 0, 'triangle'); }
  miss(post: boolean) {
    this.stop('voice'); this.stop('reaction'); this.clip('miss', 'reaction', .75); this.mix();
    if (post) this.tone(1200, .55, .22, 980, 0, 'triangle');
  }
  silence() { this.stop(); }
  destroy() {
    if (this.closed) return; this.closed = true; this.entered = false; this.silence(); this.unsubscribe();
    this.context?.removeEventListener('statechange', this.contextChanged); this.master?.disconnect(); this.buffers.clear();
  }
  state() { return { sources: this.live.size, crowd: !!this.crowd, voices: [...this.live].filter(live => live.role === 'voice').length, context: this.context?.state ?? 'none', enabled: this.enabled, ready: this.buffers.size, total: CR_LEO_SOUNDS.length, loading: !!this.loading, failures: this.failures, played: { ...this.played } }; }
}
