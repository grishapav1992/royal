import { ForestEffects } from './ForestEffects';
import { FOREST_ENERGY, ForestField } from './ForestField';
import { paintForestFrame } from './ForestFrame';
import type { ForestGeometry } from './ForestLayout';

/** Owns the painted layers and a single frame loop. It has no transport, wallet or outcome logic. */
export class ForestScene {
  readonly field: ForestField;
  readonly effects: ForestEffects;
  private canvases: Record<'backdrop' | 'frame' | 'field' | 'bloom' | 'front', HTMLCanvasElement>;
  private images: Record<'roots' | 'tile' | 'frame' | 'pink' | 'gold', HTMLImageElement>;
  private geometry?: ForestGeometry;
  private energy = 1;
  private raf = 0;
  private last = 0;
  private painted = -Infinity;
  private frames = 0;
  private alive = true;
  private paused = false;
  private reduced = false;
  /** The host page waits for these before reporting a ready scene. */
  ready = false;
  constructor(private root: HTMLElement) {
    const doc = root.ownerDocument, image = (src: string) => { const value = doc.createElement('img'); value.decoding = 'async'; value.src = src; return value; };
    const canvas = (name: string) => root.querySelector<HTMLCanvasElement>(`canvas[data-layer=${name}]`)!, context = (value: HTMLCanvasElement) => value.getContext('2d')!;
    this.canvases = { backdrop: canvas('backdrop'), frame: canvas('frame'), field: canvas('field'), bloom: canvas('bloom'), front: canvas('front') };
    this.images = { roots: image('/assets/forest-heart/v4/roots.webp'), tile: image('/assets/forest-heart/v4/tile.webp'), frame: image('/assets/forest-heart/v2/frame.webp'), pink: image('/assets/forest-heart/v5/blossom-pink.webp'), gold: image('/assets/forest-heart/v5/blossom-gold.webp') };
    this.field = new ForestField(context(this.canvases.field), this.images.roots, this.images.tile, Array.from(root.querySelectorAll<HTMLElement>('[data-cell]')));
    this.effects = new ForestEffects(context(this.canvases.backdrop), context(this.canvases.front), context(this.canvases.bloom), this.images.pink, this.images.gold);
    this.field.onHead = (x, y) => { if (Math.random() < .5) this.effects.spark(x, y, this.color, 1, 60); };
    this.field.onDead = (x, y) => { for (let i = 0; i < 6; i++) this.effects.spark(x, y, this.color, 1, 34); };
    this.field.onLand = cell => { const at = this.field.centre(cell); this.effects.spark(at.x, at.y, '#d9b56a', 5, 70); this.effects.leaf(at.x, at.y); };
    void Promise.all(Object.values(this.images).map(value => value.decode().catch(() => {}))).then(() => { if (!this.alive) return; this.ready = true; this.paintFrame(); this.field.dirty = true; this.run(); });
  }
  get color() { return FOREST_ENERGY[this.energy].color; }
  setEnergy(energy: number) {
    this.energy = energy; this.field.setEnergy(energy); const look = FOREST_ENERGY[energy], style = this.root.style;
    style.setProperty('--e', look.color); style.setProperty('--gem', look.gem); style.setProperty('--halo', String(look.halo)); style.setProperty('--halo-glow', String(look.glow)); this.wake();
  }
  resize(geometry: ForestGeometry) {
    this.geometry = geometry; const dpr = Math.min(2, this.root.ownerDocument.defaultView!.devicePixelRatio || 1), soft = Math.min(1.5, dpr);
    const size = (canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number, scale: number) => {
      canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale)); Object.assign(canvas.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); canvas.getContext('2d')!.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const { x, y, board, pad, flower, width, height } = geometry;
    size(this.canvases.frame, x - pad, y - pad, board + pad * 2 + flower, board + pad * 2, dpr); size(this.canvases.field, x - 4, y - 4, board + 8, board + 8, dpr);
    size(this.canvases.backdrop, 0, 0, width, height, soft); size(this.canvases.front, 0, 0, width, height, soft); size(this.canvases.bloom, 0, 0, width, height, soft);
    this.field.resize(geometry, dpr); this.effects.resize(geometry); this.paintFrame(); this.paint(performance.now(), 0); this.run();
  }
  private paintFrame() { if (this.geometry) paintForestFrame(this.canvases.frame.getContext('2d')!, this.geometry, this.images.frame); }
  mode(paused: boolean, reduced: boolean) {
    this.paused = paused; this.reduced = reduced; this.effects.reduced = reduced;
    if (reduced) this.effects.quiet();
    if (paused || reduced) this.stop(); else this.run();
    this.wake();
  }
  /** A still scene repaints once for every confirmed change. */
  wake() {
    if (!this.alive) return; this.field.dirty = true;
    if (this.paused || this.reduced) this.paint(performance.now(), 0); else this.run();
  }
  private paint(now: number, dt: number) {
    if (!this.geometry) return; this.frames++;
    const moving = this.field.step(this.reduced ? 0 : dt); if (moving) this.field.draw(this.reduced ? 0 : now);
    this.effects.paint(this.reduced ? 0 : now, dt, this.root.dataset.mode === 'bonus' || this.effects.rays > .1);
  }
  private tick = () => {
    this.raf = 0; if (!this.alive || this.paused || this.reduced || this.root.ownerDocument.hidden) { this.last = 0; return; }
    const now = performance.now(), busy = this.effects.active || this.root.dataset.motion !== undefined || this.field.state().spinning > 0 || this.field.state().choice;
    if (now - this.painted >= 1000 / (busy ? 60 : 30) - 2) { this.paint(now, this.last ? Math.min(.05, (now - this.last) / 1000) : 0); this.last = this.painted = now; }
    this.run();
  };
  private run() { if (!this.raf && this.alive && !this.paused && !this.reduced && !this.root.ownerDocument.hidden) this.raf = this.root.ownerDocument.defaultView!.requestAnimationFrame(this.tick); }
  private stop() { this.root.ownerDocument.defaultView!.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; }
  state() { return { ready: this.ready, energy: this.energy, frames: this.frames, running: !!this.raf, field: this.field.state(), effects: this.effects.state() }; }
  destroy() { this.alive = false; this.stop(); this.effects.quiet(); for (const image of Object.values(this.images)) image.removeAttribute('src'); }
}
