export type MiraEmotion = 'neutral' | 'smile' | 'tease' | 'concern';

/** Portrait frames animate the face independently from the breathing pose. */
export class MiraPortrait {
  readonly element = document.createElement('figure');
  private canvas = document.createElement('canvas');
  private context = this.canvas.getContext('2d')!;
  private original = new Image();
  private atlas = new Image();
  private atlasReady = false;
  private originalReady = false;
  private emotion: MiraEmotion = 'neutral';
  private speakingUntil = 0;
  private reactionUntil = 0;
  private lastFrame = -1;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    this.element.className = 'mira-portrait';
    this.canvas.width = 600; this.canvas.height = 900;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Мира, рыжая барменша с дерзкой усмешкой');
    const caption = document.createElement('figcaption');
    const name = document.createElement('strong'); name.textContent = 'Мира';
    const role = document.createElement('small'); role.textContent = 'Барменша «Рояля»';
    caption.append(name, role); this.element.append(this.canvas, caption);
    this.original.onload = () => { this.originalReady = true; this.lastFrame = -1; this.tick(Date.now()); };
    this.atlas.onload = () => { this.atlasReady = true; this.lastFrame = -1; this.tick(Date.now()); };
    this.original.src = '/assets/mira/portrait-haughty.jpg';
    this.atlas.src = '/assets/mira/animation-atlas.png';
  }

  react(value: unknown) {
    if (value === 'neutral' || value === 'smile' || value === 'tease' || value === 'concern') this.emotion = value;
    else this.emotion = 'neutral';
    this.element.dataset.emotion = this.emotion;
    this.reactionUntil = Date.now() + 2400;
  }

  speak(message: string) {
    this.speakingUntil = Date.now() + Math.min(8400, Math.max(1500, message.length * 42));
  }

  tick(now: number) {
    const reduced = this.reducedMotion.matches;
    const speaking = now < this.speakingUntil;
    this.element.classList.toggle('mira-speaking', speaking);
    this.element.classList.toggle('mira-motion-reduced', reduced);
    const cycle = now % 5200;
    let frame = this.emotion === 'smile' || this.emotion === 'tease' ? 4 : 0;
    if (speaking) frame = reduced ? 2 : [2, 0, 2, 2, 0, 2][Math.floor(now / 140) % 6];
    else if (!reduced && cycle > 4950 && cycle < 5120) frame = 1;
    else if (!reduced && this.emotion === 'tease' && now < this.reactionUntil) frame = 5;
    else if (!reduced && cycle > 3850 && cycle < 4550) frame = 5;
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.context.clearRect(0, 0, 600, 900);
    if (this.atlasReady) {
      const width = this.atlas.naturalWidth / 3, height = this.atlas.naturalHeight / 2;
      this.context.drawImage(this.atlas, frame % 3 * width, Math.floor(frame / 3) * height, width, height, 0, 0, 600, 900);
    } else if (this.originalReady) {
      this.context.drawImage(this.original, 0, 0, 600, 900);
    }
  }
}
