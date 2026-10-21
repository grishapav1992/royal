export const CHARACTER_ASSETS = {
  idleA: '/assets/dracona/hero-idle-a.png',
  idleB: '/assets/dracona/hero-idle-b.png',
  wink: '/assets/dracona/hero-wink.png',
  cast: '/assets/dracona/hero-cast.webp',
  castB: '/assets/dracona/hero-cast-b.webp',
  stanceAB: '/assets/dracona/hero-stance-ab.webp',
  stanceBA: '/assets/dracona/hero-stance-ba.webp',
  reactions: {
    neutral: { a: '/assets/dracona/hero-idle-a.png', b: '/assets/dracona/hero-idle-b.png' },
    win: { a: '/assets/dracona/hero-idle-a.png', b: '/assets/dracona/hero-idle-b.png' },
    bonus: { a: '/assets/dracona/hero-idle-a.png', b: '/assets/dracona/hero-idle-b.png' },
  },
} as const;

const CLIP_MS = { cast: 1250, castB: 1042, stanceAB: 542, stanceBA: 709 };
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class CharacterDirector {
  private layers: HTMLImageElement[];
  private active = 0;
  private asset = CHARACTER_ASSETS.idleA as string;
  private token = 0;
  private action = 0;
  private destroyed = false;
  private busy = false;
  private pose: 'a' | 'b' = 'a';
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private stanceTimer: ReturnType<typeof setTimeout> | undefined;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private blobs = new Map<string, Promise<Blob>>();
  private urls: (string | undefined)[] = [];
  private renderTask: Promise<number> = Promise.resolve(0);
  private motionTask: Promise<void> = Promise.resolve();
  private blink: HTMLImageElement;
  private fades: Animation[] = [];

  constructor(private host: HTMLElement) {
    this.layers = Array.from(host.querySelectorAll<HTMLImageElement>('img'));
    this.host.setAttribute('role', 'img');
    this.host.setAttribute('aria-label', 'Героиня с волшебной палочкой');
    this.layers.forEach(image => { image.alt = ''; image.setAttribute('aria-hidden', 'true'); });
    this.blink = new Image();
    this.blink.className = 'hero-blink';
    this.blink.alt = ''; this.blink.setAttribute('aria-hidden', 'true');
    this.blink.src = CHARACTER_ASSETS.wink;
    this.host.append(this.blink);
    this.host.dataset.characterState = 'idle';
    const assets = [CHARACTER_ASSETS.idleA, CHARACTER_ASSETS.idleB, CHARACTER_ASSETS.wink, CHARACTER_ASSETS.cast, CHARACTER_ASSETS.castB, CHARACTER_ASSETS.stanceAB, CHARACTER_ASSETS.stanceBA, ...Object.values(CHARACTER_ASSETS.reactions).flatMap(poses => Object.values(poses))];
    for (const asset of new Set(assets)) void this.load(asset).catch(() => {});
    this.scheduleBlink();
    this.scheduleStance();
  }

  private load(asset: string): Promise<Blob> {
    let promise = this.blobs.get(asset);
    if (!promise) {
      promise = fetch(asset).then(response => {
        if (!response.ok) throw new Error('Не удалось загрузить анимацию: ' + response.status);
        return response.blob();
      }).catch(error => { this.blobs.delete(asset); throw error; });
      this.blobs.set(asset, promise);
    }
    return promise;
  }

  private show(asset: string, animated = false): Promise<number> {
    const ticket = ++this.token;
    const previous = this.renderTask;
    const render = async () => {
      const blob = await this.load(asset);
      await previous.catch(() => 0);
      if (this.destroyed || ticket !== this.token) return performance.now();
      if (!animated && this.asset === asset) return performance.now();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.alt = ''; image.setAttribute('aria-hidden', 'true');
      image.className = 'hero-layer';
      image.src = url;
      try { await image.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
      if (this.destroyed || ticket !== this.token) { URL.revokeObjectURL(url); return performance.now(); }
      const next = 1 - this.active;
      const outgoing = this.layers[this.active];
      if (this.urls[next]) URL.revokeObjectURL(this.urls[next]!);
      this.host.replaceChild(image, this.layers[next]);
      this.layers[next] = image;
      this.urls[next] = url;
      const started = performance.now();
      const duration = this.reduced ? 0 : 120;
      const timing: KeyframeAnimationOptions = { duration, easing: 'linear', fill: 'both' };
      const incomingFade = image.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      const outgoingFade = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], timing);
      const at = this.host.ownerDocument.timeline.currentTime;
      if (at !== null) { incomingFade.startTime = at; outgoingFade.startTime = at; }
      this.fades = [incomingFade, outgoingFade];
      await Promise.allSettled(this.fades.map(animation => animation.finished));
      if (this.destroyed) return started;
      image.classList.add('visible'); outgoing.classList.remove('visible');
      this.fades.forEach(animation => animation.cancel()); this.fades = [];
      this.active = next;
      this.asset = asset;
      return started;
    };
    this.renderTask = render();
    return this.renderTask;
  }

  private async clip(asset: string, duration: number) {
    const started = await this.show(asset, true);
    await pause(Math.max(0, duration - (performance.now() - started)));
  }

  private async moveTo(pose: 'a' | 'b') {
    if (pose === this.pose || this.destroyed) return;
    this.host.dataset.characterState = 'stance';
    if (!this.reduced) {
      const toB = pose === 'b';
      await this.clip(toB ? CHARACTER_ASSETS.stanceAB : CHARACTER_ASSETS.stanceBA, toB ? CLIP_MS.stanceAB : CLIP_MS.stanceBA);
    }
    if (this.destroyed) return;
    this.pose = pose;
    await this.show(pose === 'a' ? CHARACTER_ASSETS.idleA : CHARACTER_ASSETS.idleB);
  }

  cast(): Promise<void> {
    const action = ++this.action;
    this.busy = true;
    this.blink.classList.remove('blinking');
    this.host.classList.add('performing');
    const previous = this.motionTask;
    this.motionTask = (async () => {
      await previous.catch(() => {});
      if (this.destroyed || action !== this.action) return;
      this.host.dataset.characterState = 'casting';
      if (!this.reduced) await this.clip(this.pose === 'a' ? CHARACTER_ASSETS.cast : CHARACTER_ASSETS.castB, this.pose === 'a' ? CLIP_MS.cast : CLIP_MS.castB);
      if (this.destroyed || action !== this.action) return;
      await this.show(this.pose === 'a' ? CHARACTER_ASSETS.idleA : CHARACTER_ASSETS.idleB);
      this.host.dataset.characterState = 'holding';
    })();
    return this.motionTask;
  }

  async react(kind: keyof typeof CHARACTER_ASSETS.reactions) {
    await this.motionTask.catch(() => {});
    if (this.destroyed) return;
    const action = ++this.action;
    this.host.dataset.characterState = 'reaction';
    this.host.dataset.reaction = kind;
    await this.show(CHARACTER_ASSETS.reactions[kind][this.pose]);
    if (kind === 'win') await this.wink(action);
    await pause(this.reduced ? 0 : 500);
    if (this.destroyed || action !== this.action) return;
    delete this.host.dataset.reaction;
    this.busy = false;
    this.host.classList.remove('performing');
    this.host.dataset.characterState = 'idle';
  }

  async changeStance(): Promise<void> {
    if (this.busy || this.destroyed) return;
    const action = ++this.action;
    this.busy = true;
    this.host.classList.add('performing');
    const previous = this.motionTask;
    this.motionTask = (async () => {
      await previous.catch(() => {});
      await this.moveTo(this.pose === 'a' ? 'b' : 'a');
      if (this.destroyed || action !== this.action) return;
      this.busy = false;
      this.host.classList.remove('performing');
      this.host.dataset.characterState = 'idle';
    })();
    return this.motionTask;
  }

  private async wink(action: number) {
    if (this.reduced || this.destroyed || this.pose !== 'a') return;
    try { await this.blink.decode(); } catch { return; }
    if (action !== this.action) return;
    this.blink.classList.add('blinking');
    await pause(140);
    this.blink.classList.remove('blinking');
  }

  private scheduleBlink() {
    if (this.destroyed) return;
    this.idleTimer = setTimeout(async () => {
      if (!this.busy && !document.hidden && !this.reduced && this.pose === 'a') await this.wink(this.action);
      this.scheduleBlink();
    }, 5500 + Math.random() * 3000);
  }

  private scheduleStance() {
    if (this.destroyed) return;
    this.stanceTimer = setTimeout(async () => {
      if (!this.busy && !document.hidden && !this.reduced) await this.changeStance().catch(() => {});
      this.scheduleStance();
    }, 18000 + Math.random() * 5000);
  }

  destroy() {
    this.destroyed = true; ++this.token; ++this.action;
    clearTimeout(this.idleTimer); clearTimeout(this.stanceTimer);
    this.fades.forEach(animation => animation.cancel());
    this.urls.forEach(url => { if (url) URL.revokeObjectURL(url); });
  }
}
