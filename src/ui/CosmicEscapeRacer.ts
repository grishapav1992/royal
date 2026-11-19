import {gameReactionForAmounts} from './gameReactions';

const racerMedia = '/assets/cosmic-guardians/racer-v1';
export const COSMIC_RACER_IDLE = racerMedia + '/idle-still.webp';

const cues = {
  idle: {still: COSMIC_RACER_IDLE, clip: racerMedia + '/idle.webp', hold: 0},
  focus: {still: racerMedia + '/focus-still.webp', clip: racerMedia + '/focus.webp', hold: 0},
  calm: {still: racerMedia + '/calm-still.webp', clip: racerMedia + '/calm.webp', hold: 1600},
  win: {still: racerMedia + '/win-still.webp', clip: racerMedia + '/win.webp', hold: 1800},
  'big-win': {still: racerMedia + '/big-win-still.webp', clip: racerMedia + '/big-win.webp', hold: 2400},
  bonus: {still: racerMedia + '/bonus-still.webp', clip: racerMedia + '/bonus.webp', hold: 2150},
} as const;
export type CosmicRacerCue = keyof typeof cues;

// Match the large-result multiplier used by Caribbean Treasures presentation.
export function cosmicRacerOutcome(spent: string, returned: string): CosmicRacerCue {
  if (gameReactionForAmounts(spent, returned) !== 'win') return 'calm';
  return BigInt(returned) >= BigInt(spent) * 20n ? 'big-win' : 'win';
}

export class CosmicEscapeRacer {
  private readonly loads = new Map<CosmicRacerCue, Promise<Blob | undefined>>();
  private readonly pending = new AbortController();
  private active = false;
  private animated = false;
  private ready = false;
  private cue: CosmicRacerCue = 'idle';
  private generation = 0;
  private hold?: ReturnType<typeof setTimeout>;
  private objectUrl?: string;

  constructor(private readonly image: HTMLImageElement) {}

  showArtwork() {
    this.ready = true;
    this.draw();
  }

  context(active: boolean, animated: boolean) {
    if (this.active === active && this.animated === animated) return;
    this.active = active;
    this.animated = animated;
    if (!active) this.cue = 'idle';
    this.draw();
    if (active && animated) void this.load('focus');
  }

  show(cue: CosmicRacerCue) {
    if (!this.active || this.cue === cue) return;
    this.cue = cue;
    this.draw();
  }

  private load(cue: CosmicRacerCue) {
    const cached = this.loads.get(cue);
    if (cached) return cached;
    const load = fetch(cues[cue].clip, {signal: this.pending.signal})
      .then(response => response.ok ? response.blob() : undefined)
      .catch(() => undefined)
      .then(blob => {
        if (!blob?.size) this.loads.delete(cue);
        return blob?.size ? blob : undefined;
      });
    this.loads.set(cue, load);
    return load;
  }

  private clear() {
    this.generation++;
    clearTimeout(this.hold);
    this.hold = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }

  private draw() {
    this.clear();
    if (!this.ready) return;
    const cue = this.cue;
    const {still, hold} = cues[cue];
    this.image.dataset.racerCue = cue;
    this.image.dataset.racerAnimated = 'false';
    this.image.src = still;
    if (!this.active) return;
    if (hold) this.hold = setTimeout(() => this.show('idle'), hold);
    if (!this.animated) return;

    const generation = this.generation;
    void this.load(cue).then(blob => {
      if (!blob || generation !== this.generation) return;
      this.objectUrl = URL.createObjectURL(blob);
      this.image.src = this.objectUrl;
      this.image.dataset.racerAnimated = 'true';
    });
  }

  destroy() {
    this.clear();
    this.active = false;
    this.ready = false;
    this.pending.abort();
    this.loads.clear();
  }
}
