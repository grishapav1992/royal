import { BOSSES, type Battle } from '../../src/shared/neopolisMath';
import { SCENES } from './art';
import type { NeopolisEffects, Point } from './NeopolisEffects';

type Box = { x: number; y: number; w: number; h: number };
type Segment = [number, number, number, number, number];
const FULL = Math.PI * 2;

/** The villain of the current battle: portrait, shield plates, power nodes, cracks
 * and the final destruction. It only shows confirmed battle values and never
 * decides a hit. Node coordinates are fractions of the portrait. */
const LOOKS = [
  { color: [176, 120, 255], nodes: [[.49, .104], [.545, .286], [.55, .43]] },
  { color: [255, 118, 66], nodes: [[.51, .143], [.27, .31], [.75, .31], [.545, .46]] },
  { color: [130, 215, 255], nodes: [[.476, .12], [.82, .175], [.52, .293], [.543, .41], [.375, .5]] },
] as const;
const rgb = (color: readonly number[], lift = 0) => 'rgb(' + color.map(value => Math.min(255, value + lift)).join(',') + ')';
const rgba = (color: readonly number[], alpha: number) => 'rgba(' + color.join(',') + ',' + alpha + ')';

function seeded(seed: number) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
}
function crackTree(u: number, v: number, seed: number) {
  const random = seeded(seed * 7919 + 13), segments: Segment[] = [];
  const grow = (x: number, y: number, angle: number, length: number, depth: number) => {
    angle += (depth % 2 ? 1 : -1) * (.35 + random() * .45);
    const x2 = x + Math.cos(angle) * length, y2 = y + Math.sin(angle) * length * .7;
    segments.push([x, y, x2, y2, depth]);
    if (depth >= 4) return;
    grow(x2, y2, angle + (random() - .5) * 1.1, length * .78, depth + 1);
    if (random() < .55) grow(x2, y2, angle + (random() < .5 ? -1 : 1) * (.6 + random() * .7), length * .6, depth + 1);
  };
  const first = random() * FULL;
  for (let i = 0; i < 3; i++) grow(u, v, first + i * FULL / 3 + random() * .8, .034 + random() * .03, 0);
  return segments;
}

export class NeopolisBoss {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private observer: ResizeObserver;
  private images = SCENES.map(scene => { const image = new Image(); image.decoding = 'async'; image.src = scene.villain; void image.decode().catch(() => {}); return image; });
  private layers: { normal: HTMLCanvasElement; dark: HTMLCanvasElement; bright: HTMLCanvasElement }[] = [];
  /** Drawn once per size: cracks, shield plates and node lights are only composed per frame. */
  private cracks: { left: number; top: number; width: number; height: number; dark: HTMLCanvasElement; glow: HTMLCanvasElement }[] = [];
  private plates: HTMLCanvasElement[] = [];
  private lights = new Map<string, HTMLCanvasElement>();
  private cells: { x: number; y: number; reach: number; angle: number; size: number }[] = [];
  private scale = 1;
  private skipped = 0;
  private warming = 0;
  private settled = false;
  private request = 0;
  private last = performance.now();
  private time = 0;
  private alive = true;
  private width = 1;
  private height = 1;
  private box: Box = { x: 0, y: 0, w: 1, h: 1 };
  private shell = { x: 0, y: 0, rx: 1, ry: 1 };
  private index = 0;
  private shield: number = BOSSES[0].shield;
  private core: number = BOSSES[0].core;
  private shadow = .9;
  private shadowTarget = .9;
  private entrance = 1;
  private recoil = 0;
  private flash = 0;
  private shieldFlash = 0;
  private ripple?: { x: number; y: number; radius: number; power: number };
  private phase: 'alive' | 'dying' | 'gone' = 'alive';
  private dying = 0;
  private dyingTime = 1900;

  constructor(private arena: HTMLElement, private frame: HTMLElement, private effects: NeopolisEffects,
    private paused: () => boolean, private reduced: () => boolean) {
    this.canvas = arena.ownerDocument.createElement('canvas');
    this.canvas.className = 'np-boss-canvas'; this.canvas.setAttribute('aria-hidden', 'true');
    arena.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(arena); this.observer.observe(frame); this.resize();
    this.request = requestAnimationFrame(this.tick);
  }
  private get look() { return LOOKS[this.index]; }
  private get max() { return BOSSES[this.index]; }

  private resize() {
    const scale = this.scale = Math.min(1.5, this.arena.ownerDocument.defaultView!.devicePixelRatio || 1);
    this.width = Math.max(1, this.arena.clientWidth); this.height = Math.max(1, this.arena.clientHeight);
    this.canvas.width = Math.round(this.width * scale); this.canvas.height = Math.round(this.height * scale);
    this.ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    const { width: W, height: H } = this, strip = W > H * 1.05;
    const arena = this.arena.getBoundingClientRect(), panel = this.frame.getBoundingClientRect();
    // A wide strip shows the bust; a column shows the figure above its panel.
    const w = strip ? Math.min(W * .74, H * 1.12) : Math.min(H * .93 * 2 / 3, W * .94), h = w * 1.5;
    const centre = strip ? W * .6 : panel.left + panel.width / 2 - arena.left + 4;
    this.box = { x: centre - w / 2, y: strip ? 2 : Math.max(-h * .02, Math.min(0, (H - h) * .2)), w, h };
    this.shell = { x: centre, y: this.box.y + h * (strip ? .25 : .34), rx: w * .47, ry: h * (strip ? .27 : .37) };
    this.layers = []; this.forget(); this.lights.clear(); this.cells = this.hexes(); this.settled = false;
  }
  private forget() { this.cracks = []; this.plates = []; this.warm(); }
  /** Prepare one heavy sheet per idle moment, so a hit or a new arena never waits for it. */
  private warm() {
    clearTimeout(this.warming);
    const next = () => {
      if (!this.alive || !this.prepare()) { if (this.alive) this.warming = window.setTimeout(next, 400); return; }
      const plate = this.plates.findIndex((ready, i) => i < this.max.shield && !ready), missing = this.plates.length < this.max.shield ? this.plates.length : plate;
      if (missing >= 0 && missing < this.max.shield) this.plate(missing);
      else if (this.cracks.length < this.max.core) this.crack(this.cracks.length);
      else { if (this.index < LOOKS.length - 1) this.prepare(this.index + 1); return; }
      this.warming = window.setTimeout(next, 120);
    };
    this.warming = window.setTimeout(next, 600);
  }
  private sheet(width: number, height: number, scale = this.scale) {
    const canvas = this.canvas.ownerDocument.createElement('canvas');
    canvas.width = Math.max(2, Math.round(width * scale)); canvas.height = Math.max(2, Math.round(height * scale));
    const ctx = canvas.getContext('2d')!; ctx.scale(canvas.width / width, canvas.height / height);
    return { canvas, ctx };
  }
  private prepare(index = this.index) {
    if (this.layers[index]) return true;
    const image = this.images[index];
    if (!image.complete || !image.naturalWidth) return false;
    const width = this.box.w, height = this.box.h, make = () => this.sheet(width, height), base = make();
    base.ctx.drawImage(image, 0, 0, width, height); base.ctx.globalCompositeOperation = 'destination-in';
    const sides = base.ctx.createLinearGradient(0, 0, width, 0);
    for (const [at, color] of [[0, 'transparent'], [.2, '#000'], [.8, '#000'], [1, 'transparent']] as const) sides.addColorStop(at, color);
    base.ctx.fillStyle = sides; base.ctx.fillRect(0, 0, width, height);
    const ends = base.ctx.createLinearGradient(0, 0, 0, height);
    for (const [at, color] of [[0, index ? 'transparent' : 'rgba(0,0,0,.5)'], [.06, '#000'], [.66, '#000'], [.97, 'transparent']] as const) ends.addColorStop(at, color);
    base.ctx.fillStyle = ends; base.ctx.fillRect(0, 0, width, height);
    const tint = (color: string) => {
      const copy = make(); copy.ctx.drawImage(base.canvas, 0, 0, width, height);
      copy.ctx.globalCompositeOperation = 'source-atop'; copy.ctx.fillStyle = color; copy.ctx.fillRect(0, 0, width, height);
      return copy.canvas;
    };
    this.layers[index] = { normal: base.canvas, dark: tint('rgba(2,4,9,.9)'), bright: tint('rgba(255,255,255,.9)') };
    return true;
  }

  /** `shadow` hides the villain before a battle: 0 is fully lit, 1 is a silhouette. */
  show(index: number, battle: Pick<Battle, 'shield' | 'core'> | null, shadow = 0) {
    if (this.index !== index) { this.forget(); this.lights.clear(); this.phase = 'alive'; }
    this.index = index; this.shadowTarget = shadow; this.settled = false; this.phase = this.phase === 'dying' ? 'dying' : 'alive';
    this.shield = battle ? battle.shield : this.max.shield; this.core = battle ? battle.core : this.max.core;
  }
  snap() { this.shadow = this.shadowTarget; }
  enter() { this.phase = 'alive'; this.entrance = 0; this.shadow = 1; this.shadowTarget = 0; this.settled = false; }
  hide() { if (this.phase !== 'dying') { this.phase = 'gone'; this.settled = false; } }
  get shielded() { return this.shield > 0; }

  private at(u: number, v: number): Point { return { x: this.box.x + u * this.box.w, y: this.box.y + v * this.box.h }; }
  private onStage(point: Point): Point {
    const origin = this.effects.point(this.canvas, 0, 0);
    return { x: origin.x + point.x, y: origin.y + point.y };
  }
  private plateAngle(index: number) { return (index + .5) / this.max.shield * FULL - Math.PI / 2; }
  centre() { return this.onStage({ x: this.shell.x, y: this.shell.y }); }
  target(): Point {
    if (this.shield > 0) {
      const angle = this.plateAngle(this.shield - 1);
      return this.onStage({ x: this.shell.x + Math.cos(angle) * this.shell.rx * .62, y: this.shell.y + Math.sin(angle) * this.shell.ry * .62 });
    }
    const [u, v] = this.look.nodes[Math.max(0, this.core - 1)];
    return this.onStage(this.at(u, v));
  }
  hit() {
    const color = rgb(this.look.color);
    if (this.shield > 0) {
      const plate = this.shield - 1, angle = this.plateAngle(plate);
      for (const hex of this.cells) if (this.plateOf(hex.angle) === plate) this.effects.burst(this.onStage(hex), 2, { speed: 230, life: 1150, size: hex.size * .62, color, gravity: 330, shape: 'shard' });
      this.ripple = { x: this.shell.x + Math.cos(angle) * this.shell.rx * .6, y: this.shell.y + Math.sin(angle) * this.shell.ry * .6, radius: 0, power: 1 };
      this.shieldFlash = 1; this.recoil = .55; this.shield--;
    } else if (this.core > 0) {
      const at = this.target();
      this.core--; this.recoil = 1; this.flash = 1;
      this.effects.burst(at, 46, { speed: 340, life: 1000, size: 4.5, color: '#ffdf9a', gravity: 220 });
      this.effects.burst(at, 16, { speed: 200, life: 1200, size: 9, color: '#2b2430', gravity: 420, shape: 'rock' });
      this.effects.ring(at, color, 140, 700, 9);
    }
  }
  die(duration: number) {
    if (this.reduced()) { this.phase = 'gone'; return; }
    this.phase = 'dying'; this.dying = 0; this.dyingTime = duration;
    const at = this.centre();
    this.effects.ring(at, '#fff1c0', 420, 1100, 16);
    this.effects.burst(at, 110, { speed: 520, life: 1500, size: 7, color: rgb(this.look.color), gravity: 150, shape: 'shard' });
    this.effects.burst(at, 60, { speed: 420, life: 1200, size: 4, color: '#ffe9b3', gravity: 60 });
  }

  private hexes() {
    const out: { x: number; y: number; reach: number; angle: number; size: number }[] = [], size = this.shell.rx * .155;
    for (let row = -9; row <= 9; row++) for (let col = -8; col <= 8; col++) {
      const x = (col + (row & 1 ? .5 : 0)) * size * 1.732, y = row * size * 1.5, reach = Math.hypot(x / this.shell.rx, y / this.shell.ry);
      if (reach >= 1.02) continue;
      const angle = (Math.atan2(y / this.shell.ry, x / this.shell.rx) + Math.PI / 2 + FULL) % FULL;
      out.push({ x: this.shell.x + x, y: this.shell.y + y, reach, angle, size });
    }
    return out;
  }
  private plateOf(angle: number) { return Math.min(this.max.shield - 1, Math.floor(angle / FULL * this.max.shield)); }
  private outline(ctx: CanvasRenderingContext2D, hex: { x: number; y: number; size: number }) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) ctx.lineTo(hex.x + Math.cos(i * FULL / 6 + FULL / 12) * hex.size * .93, hex.y + Math.sin(i * FULL / 6 + FULL / 12) * hex.size * .93);
    ctx.closePath();
  }
  private plate(index: number) {
    if (this.plates[index]) return this.plates[index];
    const { x, y, rx, ry } = this.shell, pad = 10, { canvas, ctx } = this.sheet(rx * 2 + pad * 2, ry * 2 + pad * 2);
    ctx.translate(pad + rx - x, pad + ry - y); ctx.strokeStyle = ctx.fillStyle = rgb(this.look.color); ctx.lineWidth = 1.3;
    for (const hex of this.cells) {
      if (this.plateOf(hex.angle) !== index) continue;
      const power = .09 + .5 * hex.reach ** 4;
      this.outline(ctx, hex); ctx.globalAlpha = power; ctx.stroke(); ctx.globalAlpha = power * .22; ctx.fill();
    }
    const from = index / this.max.shield * FULL - Math.PI / 2 + .035, to = (index + 1) / this.max.shield * FULL - Math.PI / 2 - .035;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, from, to);
    ctx.globalAlpha = .75; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = .22; ctx.lineWidth = 11; ctx.stroke();
    return this.plates[index] = canvas;
  }
  private drawShield(ctx: CanvasRenderingContext2D, alpha: number) {
    if (this.shield <= 0 || alpha <= 0) return;
    const { x, y, rx, ry } = this.shell, pad = 10;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.shield; i++) {
      ctx.globalAlpha = Math.min(1, (.82 + .14 * Math.sin(this.time * 2 + i) + this.shieldFlash * .4) * alpha);
      ctx.drawImage(this.plate(i), x - rx - pad, y - ry - pad, rx * 2 + pad * 2, ry * 2 + pad * 2);
    }
    // The travelling ripple only exists for a moment after a hit.
    if (this.ripple) {
      ctx.strokeStyle = rgb(this.look.color, 60); ctx.lineWidth = 1.6;
      for (const hex of this.cells) {
        const near = 1 - Math.abs(Math.hypot(hex.x - this.ripple.x, hex.y - this.ripple.y) - this.ripple.radius) / 26;
        if (near <= 0 || this.plateOf(hex.angle) >= this.shield) continue;
        this.outline(ctx, hex); ctx.globalAlpha = near * this.ripple.power * alpha; ctx.stroke();
      }
    }
    ctx.restore();
  }
  private crack(index: number) {
    if (this.cracks[index]) return this.cracks[index];
    const { w, h } = this.box, [u, v] = this.look.nodes[index], segments = crackTree(u, v, index + this.index * 10 + 1), pad = 10;
    const xs = segments.flatMap(([x1, , x2]) => [x1 * w, x2 * w]), ys = segments.flatMap(([, y1, , y2]) => [y1 * h, y2 * h]);
    const left = Math.min(...xs) - pad, top = Math.min(...ys) - pad, width = Math.max(...xs) + pad - left, height = Math.max(...ys) + pad - top;
    // One path per branch level and wide faint strokes instead of a blur per segment.
    const draw = (color: string, passes: readonly (readonly [number, number])[], base: number, step: number) => {
      const { canvas, ctx } = this.sheet(width, height); ctx.translate(-left, -top); ctx.lineCap = 'round'; ctx.strokeStyle = color;
      for (const [extra, alpha] of passes) for (let level = 0; level <= 4; level++) {
        ctx.globalAlpha = alpha * (1 - level * .14); ctx.lineWidth = Math.max(.7, base - level * step) + extra; ctx.beginPath();
        for (const segment of segments) if (segment[4] === level) { ctx.moveTo(segment[0] * w, segment[1] * h); ctx.lineTo(segment[2] * w, segment[3] * h); }
        ctx.stroke();
      }
      // The armour carries the crack: nothing is drawn beside the figure.
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(this.layers[this.index].normal, 0, 0, w, h);
      return canvas;
    };
    return this.cracks[index] = { left, top, width, height, dark: draw('#020308', [[0, .85]], 4.4, .8), glow: draw(rgb(this.look.color, 80), [[11, .07], [6, .13], [2.4, .24], [0, 1]], 2, .35) };
  }
  private drawCracks(ctx: CanvasRenderingContext2D, alpha: number) {
    const { x, y } = this.box;
    for (let i = this.core; i < this.max.core; i++) {
      const crack = this.crack(i);
      ctx.globalAlpha = alpha; ctx.drawImage(crack.dark, x + crack.left, y + crack.top, crack.width, crack.height);
      ctx.globalAlpha = (.65 + .35 * Math.sin(this.time * 3 + i * 2)) * alpha; ctx.drawImage(crack.glow, x + crack.left, y + crack.top, crack.width, crack.height);
    }
    ctx.globalAlpha = 1;
  }
  private light(name: string, size: number, stops: readonly (readonly [number, string])[]) {
    const ready = this.lights.get(name); if (ready) return ready;
    const { canvas, ctx } = this.sheet(size * 2, size * 2), gradient = ctx.createRadialGradient(size, size, 0, size, size, size);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, size * 2, size * 2); this.lights.set(name, canvas);
    return canvas;
  }
  private drawNodes(ctx: CanvasRenderingContext2D, alpha: number) {
    const open = this.shield === 0, base = this.box.w * .075 * 2.1;
    const light = this.light('node', base, [[0, 'rgba(255,255,255,.95)'], [.12, 'rgba(255,236,190,.85)'], [.42, rgba(this.look.color, .55)], [1, 'transparent']]);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.core; i++) {
      const [u, v] = this.look.nodes[i], at = this.at(u, v), beat = (open ? .8 : .46) * (1 + .12 * Math.sin(this.time * 3.4 + i)), size = base * beat;
      ctx.globalAlpha = alpha; ctx.drawImage(light, at.x - size, at.y - size, size * 2, size * 2);
      if (!open) continue;
      ctx.strokeStyle = '#ffe9bd'; ctx.lineWidth = 1.6; ctx.globalAlpha = .85 * alpha;
      for (let k = 0; k < 4; k++) {
        const from = this.time * .6 + i + k * Math.PI / 2 + .2;
        ctx.beginPath(); ctx.arc(at.x, at.y, size / 2.1 * .9, from, from + 1); ctx.stroke();
      }
    }
    ctx.restore();
  }
  private drawDeath(ctx: CanvasRenderingContext2D, t: number) {
    const { normal, bright } = this.layers[this.index], { x, y, w, h } = this.box;
    ctx.save();
    if (this.index === 0) { // Null is drawn into his own portal.
      const at = this.at(.545, .3);
      for (let i = 10; i >= 0; i--) {
        const k = i / 10, q = Math.max(0, Math.min(1, t * 1.9 - k * .55)), scale = 1 - q * q;
        if (scale <= .02) continue;
        ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(q * q * 5.5 * (1.15 - k * .4)); ctx.scale(scale, scale);
        ctx.beginPath(); ctx.arc(0, 0, h * (.1 + k * .95), 0, FULL); ctx.arc(0, 0, i ? h * (.1 + (i - 1) / 10 * .95) : 0, 0, FULL, true); ctx.clip();
        ctx.globalAlpha = 1 - q * .4; ctx.drawImage(normal, x - at.x, y - at.y, w, h); ctx.restore();
      }
      const open = Math.max(0, Math.sin(Math.min(1, t * 1.05) * Math.PI));
      ctx.globalCompositeOperation = 'lighter'; ctx.translate(at.x, at.y); ctx.lineWidth = 3; ctx.globalAlpha = .8 * open;
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.rotate(t * 13 + i * 1.25); ctx.strokeStyle = i % 2 ? '#f3e6ff' : '#a05cff';
        ctx.beginPath(); ctx.ellipse(0, 0, w * (.12 + .07 * i) * open, w * (.1 + .05 * i) * open, 0, 0, 5); ctx.stroke(); ctx.restore();
      }
    } else if (this.index === 1) { // Vespera's eclipse goes out and she burns to ash.
      const cols = 16, rows = 22, sw = normal.width / cols, sh = normal.height / rows, dw = w / cols, dh = h / rows;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const noise = (col * 73 + row * 151) % 37 / 37, k = Math.max(0, Math.min(1, (t * 1.75 - row / rows * .62 - noise * .28) / .32));
        if (k >= 1) continue;
        const px = x + col * dw + k * k * (40 + noise * 60), py = y + row * dh - k * k * (60 + noise * 90);
        ctx.globalAlpha = 1 - k; ctx.drawImage(normal, col * sw, row * sh, sw, sh, px, py, dw * (1 - k * .5), dh * (1 - k * .5));
        if (k <= .05 || k >= .8) continue;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * .8; ctx.fillStyle = '#ff7a2e'; ctx.fillRect(px, py, dw * .5, dh * .5); ctx.globalCompositeOperation = 'source-over';
      }
      const at = this.at(.51, .143);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(0, 1 - t * 1.2); ctx.strokeStyle = '#ff8d4d'; ctx.lineWidth = 10 * (1 - t) + .1;
      ctx.beginPath(); ctx.arc(at.x, at.y, Math.max(0, w * .28 * (1 - t * .9)), 0, FULL); ctx.stroke();
    } else { // Aeon's time stops, then the frozen figure shatters.
      const hold = .32, cols = 12, rows = 16, dw = w / cols, dh = h / rows, sw = normal.width / cols, sh = normal.height / rows;
      if (t < hold) {
        ctx.drawImage(normal, x, y, w, h); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35 * t / hold; ctx.drawImage(bright, x, y, w, h);
      } else for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const noise = (col * 97 + row * 57) % 41 / 41, k = Math.max(0, (t - hold) / (1 - hold) * 1.25 - noise * .25), alpha = 1 - k * 1.05;
        if (alpha <= 0) continue;
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.translate(x + (col + .5) * dw + (col + .5 - cols / 2) * k * k * 34 + (noise - .5) * 70 * k, y + (row + .5) * dh + k * k * (150 + noise * 240) - k * 36);
        ctx.rotate((noise - .5) * k * 3); ctx.drawImage(normal, col * sw, row * sh, sw, sh, -dw / 2, -dh / 2, dw + .5, dh + .5); ctx.restore();
      }
      const at = this.at(.52, .293), hand = -Math.PI / 2 + Math.min(1, t / hold) * FULL * .94;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(0, 1 - t * .95); ctx.strokeStyle = '#d7f4ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(at.x, at.y, w * .23, 0, FULL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x + Math.cos(hand) * w * .2, at.y + Math.sin(hand) * w * .2);
      ctx.moveTo(at.x, at.y); ctx.lineTo(at.x + Math.cos(hand * .5) * w * .13, at.y + Math.sin(hand * .5) * w * .13); ctx.stroke();
    }
    ctx.restore();
  }

  private tick = (now: number) => {
    if (!this.alive) return;
    this.request = requestAnimationFrame(this.tick);
    const delta = Math.min(50, now - this.last);
    if (this.paused() || !this.ctx) { this.last = now; return; }
    const ctx = this.ctx, still = this.reduced(), moving = this.phase === 'dying' || !!this.ripple || this.recoil > .02 || this.flash > .02 || this.shieldFlash > .02 || this.entrance < 1 || Math.abs(this.shadow - this.shadowTarget) > .01;
    if (!moving && (this.settled || ++this.skipped % 2)) return;
    this.last = now;
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.phase === 'gone') { this.settled = true; return; }
    if (!this.prepare()) return;
    this.time += still ? 0 : delta / 1000;
    this.recoil *= .993 ** delta; this.flash *= .9955 ** delta; this.shieldFlash *= .995 ** delta;
    this.shadow += (this.shadowTarget - this.shadow) * (still ? 1 : Math.min(1, delta / 420));
    this.entrance = still ? 1 : Math.min(1, this.entrance + delta / 900);
    if (this.ripple) { this.ripple.radius += delta * .42; this.ripple.power *= .9965 ** delta; if (this.ripple.power < .03) this.ripple = undefined; }
    if (this.phase === 'dying') {
      this.dying += delta;
      this.drawDeath(ctx, Math.min(1, this.dying / this.dyingTime));
      if (this.dying >= this.dyingTime) this.phase = 'gone';
      return;
    }
    const { x, y, w, h } = this.box, layer = this.layers[this.index], damage = 1 - this.core / this.max.core;
    ctx.save();
    if (!still) {
      ctx.translate(this.recoil * w * .1 + (damage > .5 ? Math.sin(this.time * 17) * damage * .7 : 0), Math.sin(this.time * 1.25) * h * .006 + damage * h * .025);
      ctx.translate(this.shell.x, this.shell.y); ctx.rotate(this.recoil * .05 + damage * .025);
      ctx.scale(1 + .04 * (1 - this.entrance), 1 + .04 * (1 - this.entrance)); ctx.translate(-this.shell.x, -this.shell.y);
    }
    ctx.globalAlpha = this.entrance; ctx.drawImage(layer.normal, x, y, w, h);
    const dim = Math.max(this.shadow, damage * .34);
    if (dim > .01) { ctx.globalAlpha = dim * this.entrance; ctx.drawImage(layer.dark, x, y, w, h); }
    if (this.flash > .02) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.flash * .75; ctx.drawImage(layer.bright, x, y, w, h); ctx.globalCompositeOperation = 'source-over'; }
    if (this.shadow > .3) {
      const [u, v] = this.look.nodes[0], at = this.at(u, v), size = w * .13, eyes = this.light('eyes', size, [[0, rgba(this.look.color, .9)], [1, 'transparent']]);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (.32 + .18 * Math.sin(this.time * 1.8)) * this.shadow;
      ctx.drawImage(eyes, at.x - size, at.y - size, size * 2, size * 2); ctx.globalCompositeOperation = 'source-over';
    }
    const lit = (1 - this.shadow) * this.entrance;
    if (this.core < this.max.core) this.drawCracks(ctx, lit);
    if (lit > .4) this.drawNodes(ctx, lit);
    ctx.restore();
    this.drawShield(ctx, Math.max(0, lit - .25) * 1.33);
    if (still && !moving) this.settled = true;
    if (!still && damage > 0 && Math.random() < delta / 90 * damage) {
      const node = this.look.nodes[this.core + Math.floor(Math.random() * (this.max.core - this.core))];
      if (node) this.effects.burst(this.onStage(this.at(node[0], node[1])), 1, { speed: 26, life: 1500, size: 15, color: '#1a1c24', gravity: -46, shape: 'smoke', spread: 6 });
    }
  };
  destroy() { this.alive = false; clearTimeout(this.warming); cancelAnimationFrame(this.request); this.observer.disconnect(); this.canvas.remove(); }
}
