import {gameReactionForAmounts} from '../../src/ui/gameReactions';
import {COSMIC_CREW_MEDIA} from './CosmicCrewView';
import type {CosmicCrewId} from '../../src/shared/cosmicCrew';

export const COSMIC_RACER_IDLE = COSMIC_CREW_MEDIA.racer + '/idle-still.webp';

const commonHolds = {idle: 0, focus: 0, calm: 1600, win: 1800, 'big-win': 2400, bonus: 2150, even: 1100, energy: 900, wild: 850, echo: 1050} as const;
const silverHolds = {greet: 1350, start: 800, pause: 1050, pickup: 2900, lean: 1700} as const;
const holds = {...commonHolds, ...silverHolds};
const idlePoses = ['pickup', 'lean'] as const;
const idlePoseDelay = 16000;
export type CosmicRacerCue = keyof typeof holds;
type Gesture = 'greet' | 'start' | 'pause';

// Match the large-result multiplier used by Caribbean Treasures presentation.
export function cosmicRacerOutcome(spent: string, returned: string): CosmicRacerCue {
  const reaction = gameReactionForAmounts(spent, returned);
  if (!reaction && /^[1-9]\d*$/.test(spent) && spent === returned) return 'even';
  if (reaction !== 'win') return 'calm';
  return BigInt(returned) >= BigInt(spent) * 20n ? 'big-win' : 'win';
}

export class CosmicEscapeRacer {
  private readonly loads = new Map<CosmicRacerCue, Promise<Blob | undefined>>();
  private readonly pending = new AbortController();
  private active = false;
  private animated = false;
  private rolling = false;
  private ready = false;
  private cue: CosmicRacerCue = 'idle';
  private generation = 0;
  private hold?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private idlePosesEnabled = false;
  private nextIdlePose = 0;
  private objectUrl?: string;
  private who: CosmicCrewId = 'racer';

  constructor(private readonly image: HTMLImageElement) {}

  /** Only the chosen character's clips are downloaded. */
  character(id: CosmicCrewId) {
    if (this.who === id) return;
    this.who = id;
    this.loads.clear();
    this.image.dataset.crew = id;
    if (!this.supports(this.cue)) this.cue = this.rolling ? 'focus' : 'idle';
    this.draw();
    this.prepareGestures();
  }

  showArtwork() {
    this.ready = true;
    this.draw();
  }

  context(active: boolean, animated: boolean, rolling = false, idlePosesEnabled = false) {
    const idleChanged = this.idlePosesEnabled !== idlePosesEnabled;
    this.idlePosesEnabled = idlePosesEnabled;
    const stopIdlePose = (!idlePosesEnabled || !animated) && (this.cue === 'pickup' || this.cue === 'lean');
    if (this.active === active && this.animated === animated && this.rolling === rolling) {
      if (stopIdlePose) this.show('idle');
      else if (idleChanged) this.scheduleIdlePose();
      return;
    }
    const resumes = active && !this.active;
    const changedRoundPhase = this.rolling !== rolling;
    this.active = active;
    this.animated = animated;
    this.rolling = rolling;
    if (!active) this.cue = 'idle';
    else if (resumes || changedRoundPhase) this.cue = rolling ? 'focus' : 'idle';
    else if (stopIdlePose) this.cue = 'idle';
    this.draw();
    this.prepareGestures();
  }

  prepare(cue: CosmicRacerCue) {
    if (this.active && this.animated && this.supports(cue)) void this.load(cue);
  }

  prepareFeatures() {
    for (const cue of ['energy', 'wild', 'echo'] as const) this.prepare(cue);
  }

  show(cue: CosmicRacerCue) {
    if (!this.active || this.cue === cue || !this.supports(cue)) return;
    this.cue = cue;
    this.draw();
  }

  gesture(cue: Gesture) {
    if (Object.hasOwn(commonHolds, this.cue) && this.cue !== 'idle' && this.cue !== 'focus') return;
    this.show(cue);
  }

  private supports(cue: CosmicRacerCue) {
    return this.who === 'silver' || !Object.hasOwn(silverHolds, cue);
  }

  private prepareGestures() {
    this.prepare('focus');
    this.prepare('start');
    this.prepare('pause');
  }

  private scheduleIdlePose() {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (!this.ready || !this.active || !this.animated || this.rolling ||
        !this.idlePosesEnabled || this.who !== 'silver' || this.cue !== 'idle') return;
    const pose = idlePoses[this.nextIdlePose];
    this.prepare(pose);
    this.idleTimer = setTimeout(() => {
      this.nextIdlePose = (this.nextIdlePose + 1) % idlePoses.length;
      this.show(pose);
    }, idlePoseDelay);
  }

  private load(cue: CosmicRacerCue) {
    const cached = this.loads.get(cue);
    if (cached) return cached;
    const load = fetch(`${COSMIC_CREW_MEDIA[this.who]}/${cue}.webp`, {signal: this.pending.signal})
      .then(response => response.ok ? response.blob() : undefined)
      .catch(() => undefined)
      .then(blob => {
        if (!blob?.size && this.loads.get(cue) === load) this.loads.delete(cue);
        return blob?.size ? blob : undefined;
      });
    this.loads.set(cue, load);
    return load;
  }

  private clear() {
    this.generation++;
    clearTimeout(this.hold);
    this.hold = undefined;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }

  private draw() {
    this.clear();
    if (!this.ready) return;
    const cue = this.cue;
    const hold = holds[cue];
    this.image.dataset.racerCue = cue;
    this.image.dataset.racerAnimated = 'false';
    this.image.src = `${COSMIC_CREW_MEDIA[this.who]}/${cue}-still.webp`;
    if (!this.active) return;
    if (hold) this.hold = setTimeout(() => this.show(this.rolling ? 'focus' : 'idle'), hold);
    if (!this.animated) return;
    this.scheduleIdlePose();

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
