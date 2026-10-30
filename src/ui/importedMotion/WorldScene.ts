import type { ImportedMotionGame } from './Outcome';
import './world-scene.css';

export type WorldAssets = { background: string; character: string };
type WorldPhase = 'idle' | 'anticipation' | 'spinning' | 'revealing' | 'landing' | 'settled';

const ornaments: Record<ImportedMotionGame, string> = {
  'royal-fruits': 'petal', 'royal-dice': 'bubble', 'royal-limbo': 'star',
  'royal-mines': 'firefly', 'royal-keno': 'constellation', 'github-craps': 'note',
  'github-diamonds': 'crystal', 'github-sic-bo': 'sand',
};

/** Layered artwork and decorative responses. Never owns a round or changes a result. */
export class WorldScene {
  private intro?: HTMLElement;
  private stage?: HTMLElement;
  private observed?: HTMLElement;
  private intersection?: IntersectionObserver;
  private animations = new Set<Animation>();
  private lifetime = new AbortController();
  private visible = true;
  private enabled = true;
  private alive = true;
  private lastPhase: WorldPhase = 'idle';
  private lastReel = '';
  private lastTitle = '';

  constructor(private root: HTMLElement, private content: HTMLElement, private game: ImportedMotionGame, private assets: WorldAssets) {
    root.dataset.world = game;
    root.dataset.worldMotion = 'true';
    root.dataset.worldVisible = 'true';
    if ('IntersectionObserver' in window) this.intersection = new IntersectionObserver(entries => {
      const entry = entries.find(value => value.target === this.observed);
      if (!entry) return;
      this.visible = entry.isIntersecting;
      root.dataset.worldVisible = String(this.visible);
    }, { threshold: .04 });
    this.sync();
  }

  sync() {
    if (!this.alive) return;
    const intro = this.content.querySelector<HTMLElement>('.imported-intro');
    if (intro && this.intro !== intro) {
      this.intersection?.disconnect(); this.observed = intro; this.intersection?.observe(intro);
      this.intro = intro; intro.classList.add('imp-world-intro');
      const scenery = document.createElement('div'); scenery.className = 'imp-world-scenery'; scenery.setAttribute('aria-hidden', 'true');
      const background = this.image(this.assets.background, 'imp-world-background', 1200, 675);
      const veil = document.createElement('div'); veil.className = 'imp-world-veil';
      const light = document.createElement('div'); light.className = 'imp-world-light';
      const orbit = document.createElement('div'); orbit.className = 'imp-world-orbit';
      const character = document.createElement('div'); character.className = 'imp-world-character';
      const figure = this.image(this.assets.character, 'imp-world-figure', 512, 768);
      character.append(figure);
      const atmosphere = document.createElement('div'); atmosphere.className = 'imp-world-atmosphere';
      for (let i = 0; i < 7; i++) {
        const mote = document.createElement('i'); mote.className = `imp-world-mote imp-world-${ornaments[this.game]}`;
        mote.style.setProperty('--mote-x', `${43 + (i * 13) % 53}%`);
        mote.style.setProperty('--mote-y', `${20 + (i * 23) % 68}%`);
        mote.style.setProperty('--mote-delay', `${-i * 1.13}s`);
        mote.style.setProperty('--mote-duration', `${5 + i % 4}s`);
        if (this.game === 'github-craps') mote.textContent = i % 2 ? '♪' : '♬';
        atmosphere.append(mote);
      }
      scenery.append(background, veil, light, orbit, character, atmosphere);
      intro.prepend(scenery);
      this.lastTitle = '';
      // Keep the existing illustration until both new layers are decoded.
      void Promise.all([this.decode(background), this.decode(figure)]).then(() => {
        if (this.alive && intro.isConnected) intro.dataset.worldLoaded = 'true';
      }).catch(() => { /* The previous vector scene remains available on an image error. */ });
    }
    const title = intro?.querySelector<HTMLElement>('.imported-title');
    if (title && (title.textContent !== this.lastTitle || !title.querySelector('.imp-world-title-shine'))) {
      const text = title.querySelector('.imp-world-title-text')?.textContent ?? title.textContent ?? '';
      const original = document.createElement('span'); original.className = 'imp-world-title-text'; original.textContent = text;
      const shine = document.createElement('span'); shine.className = 'imp-world-title-shine'; shine.textContent = text; shine.setAttribute('aria-hidden', 'true');
      title.replaceChildren(original, shine); title.classList.add('imp-world-title');
      this.lastTitle = title.textContent ?? '';
    }
    // Re-rendered boards get one decorative layer without changing their controls.
    const board = this.board();
    if (board && !board.querySelector(':scope > .imp-world-board-fx')) {
      const fx = document.createElement('div'); fx.className = 'imp-world-board-fx'; fx.setAttribute('aria-hidden', 'true');
      const sweep = document.createElement('i'); sweep.className = 'imp-world-board-sweep';
      const ring = document.createElement('i'); ring.className = 'imp-world-board-ring';
      fx.append(sweep, ring); board.append(fx); board.classList.add('imp-world-playfield');
      this.stage = fx;
    } else this.stage = board?.querySelector<HTMLElement>(':scope > .imp-world-board-fx') ?? undefined;
    const stopping = this.content.querySelector<HTMLElement>('.fruits-reel[data-state="stopping"]');
    const reel = stopping ? String(Array.from(this.content.querySelectorAll('.fruits-reel')).indexOf(stopping)) : '';
    if (stopping && reel !== this.lastReel) { this.lastReel = reel; this.pulseBoard(false); }
    if (!stopping) this.lastReel = '';
  }

  private image(src: string, name: string, width: number, height: number) {
    const image = document.createElement('img'); image.src = src; image.alt = ''; image.className = name;
    image.width = width; image.height = height; image.decoding = 'async'; image.draggable = false;
    return image;
  }
  private decode(image: HTMLImageElement): Promise<void> {
    if (image.decode) return image.decode();
    if (image.complete && image.naturalWidth) return Promise.resolve();
    return new Promise((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true, signal: this.lifetime.signal });
      image.addEventListener('error', () => reject(new Error('World artwork unavailable')), { once: true, signal: this.lifetime.signal });
    });
  }
  private board() {
    return this.content.querySelector<HTMLElement>('.fruits-frame,.dice-board,.limbo-board,.original-board-wrap,.royal-confirmed-motion,.expansion-board,.casino-board,.github-table');
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled; this.root.dataset.worldMotion = String(enabled);
    if (!enabled) this.cancel();
  }
  phase(phase: WorldPhase) {
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    if (phase === 'anticipation') this.gesture(false);
    if (phase === 'revealing') this.pulseBoard(false);
  }
  reveal(node: HTMLElement, safe: boolean, index: number) {
    if (!this.canAnimate()) return;
    if (safe) this.spark(node, index);
    if (this.game === 'royal-mines') this.gesture(false);
  }
  result(profit: boolean) {
    if (!profit) return;
    this.gesture(true); this.pulseBoard(true);
  }
  private canAnimate() { return this.alive && this.enabled && !document.hidden; }
  private gesture(win: boolean) {
    const figure = this.intro?.querySelector<HTMLElement>('.imp-world-character');
    if (!figure || !this.visible || !this.canAnimate()) return;
    const flying = ['royal-limbo', 'royal-keno', 'github-sic-bo'].includes(this.game);
    const distance = win ? -10 : flying ? -5 : 3;
    this.animate(figure, [{ translate: '0 0', rotate: '0deg' }, { translate: `0 ${distance}px`, rotate: `${win ? -3 : 2}deg`, offset: .4 }, { translate: '0 0', rotate: '0deg' }], win ? 720 : 420);
  }
  private pulseBoard(win: boolean) {
    const ring = this.stage?.querySelector<HTMLElement>('.imp-world-board-ring');
    if (!ring || !this.canAnimate()) return;
    this.animate(ring, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: win ? .85 : .45, transform: 'scale(1)', offset: .2 }, { opacity: 0, transform: 'scale(1.025)' }], win ? 850 : 480);
  }
  private spark(node: HTMLElement, index: number) {
    if (!this.stage) return;
    const board = this.stage.getBoundingClientRect(), cell = node.getBoundingClientRect();
    if (board.width === 0 || cell.width === 0) return;
    const spark = document.createElement('i'); spark.className = `imp-world-hit imp-world-${ornaments[this.game]}`;
    spark.style.left = `${cell.left + cell.width * .5 - board.left}px`;
    spark.style.top = `${cell.top + cell.height * .4 - board.top}px`;
    this.stage.append(spark);
    const sign = index % 2 ? 1 : -1;
    this.animate(spark, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)' }, { opacity: .95, transform: 'translate(-50%,-85%) scale(1)', offset: .22 }, { opacity: 0, transform: `translate(calc(-50% + ${sign * 16}px),-230%) scale(.3) rotate(${sign * 70}deg)` }], 620, () => spark.remove());
  }
  private animate(node: HTMLElement, frames: Keyframe[], duration: number, done?: () => void) {
    if (!this.canAnimate()) { done?.(); return; }
    try {
      const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.7,.25,1)' });
      this.animations.add(animation);
      const finish = () => { this.animations.delete(animation); animation.cancel(); done?.(); };
      animation.finished.then(finish, finish);
    } catch { done?.(); }
  }
  cancel() {
    this.lastPhase = 'idle';
    for (const animation of this.animations) animation.cancel();
    this.animations.clear(); this.stage?.querySelectorAll('.imp-world-hit').forEach(node => node.remove());
  }
  destroy() {
    this.alive = false; this.cancel(); this.intersection?.disconnect(); this.lifetime.abort();
    this.intro = undefined; this.stage = undefined;
  }
}
