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
  private images = SCENES.map(scene => { const image = new Image(); image.decoding = 'async'; image.src = scene.villain; return image; });
  private layers: { normal: HTMLCanvasElement; dark: HTMLCanvasElement; bright: HTMLCanvasElement }[] = [];
  private cracks: Segment[][] = [];
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
    const scale = Math.min(2, this.arena.ownerDocument.defaultView!.devicePixelRatio || 1);
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
    this.layers = [];
  }
  private prepare() {
    if (this.layers[this.index]) return true;
    const image = this.images[this.index];
    if (!image.complete || !image.naturalWidth) return false;
    const make = () => {
      const canvas = this.canvas.ownerDocument.createElement('canvas');
      canvas.width = Math.max(2, Math.round(this.box.w * 1.5)); canvas.height = Math.max(2, Math.round(this.box.h * 1.5));
      return { canvas, ctx: canvas.getContext('2d')! };
    };
    const base = make(), { width, height } = base.canvas;
    base.ctx.drawImage(image, 0, 0, width, height); base.ctx.globalCompositeOperation = 'destination-in';
    const sides = base.ctx.createLinearGradient(0, 0, width, 0);
    for (const [at, color] of [[0, 'transparent'], [.2, '#000'], [.8, '#000'], [1, 'transparent']] as const) sides.addColorStop(at, color);
    base.ctx.fillStyle = sides; base.ctx.fillRect(0, 0, width, height);
    const ends = base.ctx.createLinearGradient(0, 0, 0, height);
    for (const [at, color] of [[0, this.index ? 'transparent' : 'rgba(0,0,0,.5)'], [.06, '#000'], [.66, '#000'], [.97, 'transparent']] as const) ends.addColorStop(at, color);
    base.ctx.fillStyle = ends; base.ctx.fillRect(0, 0, width, height);
    const tint = (color: string) => {
      const copy = make(); copy.ctx.drawImage(base.canvas, 0, 0);
      copy.ctx.globalCompositeOperation = 'source-atop'; copy.ctx.fillStyle = color; copy.ctx.fillRect(0, 0, width, height);
      return copy.canvas;
    };
    this.layers[this.index] = { normal: base.canvas, dark: tint('rgba(2,4,9,.9)'), bright: tint('rgba(255,255,255,.9)') };
    return true;
  }

  /** `shadow` hides the villain before a battle: 0 is fully lit, 1 is a silhouette. */
  show(index: number, battle: Pick<Battle, 'shield' | 'core'> | null, shadow = 0) {
    if (this.index !== index) { this.cracks = []; this.phase = 'alive'; }
    this.index = index; this.shadowTarget = shadow; this.phase = this.phase === 'dying' ? 'dying' : 'alive';
    this.shield = battle ? battle.shield : this.max.shield; this.core = battle ? battle.core : this.max.core;
  }
  snap() { this.shadow = this.shadowTarget; }
  enter() { this.phase = 'alive'; this.entrance = 0; this.shadow = 1; this.shadowTarget = 0; this.cracks = []; }
  hide() { if (this.phase !== 'dying') this.phase = 'gone'; }
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
      for (const hex of this.hexes()) if (this.plateOf(hex.angle) === plate) this.effects.burst(this.onStage(hex), 2, { speed: 230, life: 1150, size: hex.size * .62, color, gravity: 330, shape: 'shard' });
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
  private drawShield(ctx: CanvasRenderingContext2D, alpha: number) {
    if (this.shield <= 0 || alpha <= 0) return;
    const color = rgb(this.look.color);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = color; ctx.fillStyle = color;
    for (const hex of this.hexes()) {
      if (this.plateOf(hex.angle) >= this.shield) continue;
      let power = .09 + .5 * hex.reach ** 4 + .06 * Math.sin(this.time * 1.6 + hex.x * .03 + hex.y * .02) + this.shieldFlash * .35;
      if (this.ripple) power += Math.max(0, 1 - Math.abs(Math.hypot(hex.x - this.ripple.x, hex.y - this.ripple.y) - this.ripple.radius) / 26) * this.ripple.power;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) ctx.lineTo(hex.x + Math.cos(i * FULL / 6 + FULL / 12) * hex.size * .93, hex.y + Math.sin(i * FULL / 6 + FULL / 12) * hex.size * .93);
      ctx.closePath(); ctx.lineWidth = 1.3; ctx.globalAlpha = Math.max(0, Math.min(1, power)) * alpha; ctx.stroke();
      ctx.globalAlpha = Math.max(0, Math.min(.6, power * .22)) * alpha; ctx.fill();
    }
    for (let i = 0; i < this.shield; i++) {
      const from = i / this.max.shield * FULL - Math.PI / 2 + .035, to = (i + 1) / this.max.shield * FULL - Math.PI / 2 - .035;
      ctx.beginPath(); ctx.ellipse(this.shell.x, this.shell.y, this.shell.rx, this.shell.ry, 0, from, to);
      ctx.globalAlpha = (.6 + .2 * Math.sin(this.time * 2 + i)) * alpha; ctx.lineWidth = 3; ctx.stroke();
      ctx.globalAlpha = .2 * alpha; ctx.lineWidth = 11; ctx.stroke();
    }
    ctx.restore();
  }
  private drawCracks(ctx: CanvasRenderingContext2D, alpha: number) {
    ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'source-atop';
    for (let i = this.core; i < this.max.core; i++) {
      const [u, v] = this.look.nodes[i];
      this.cracks[i] ??= crackTree(u, v, i + this.index * 10 + 1);
      const stroke = (segment: Segment) => {
        const from = this.at(segment[0], segment[1]), to = this.at(segment[2], segment[3]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      };
      ctx.strokeStyle = '#020308'; ctx.globalAlpha = .85 * alpha;
      for (const segment of this.cracks[i]) { ctx.lineWidth = 4.4 - segment[4] * .8; stroke(segment); }
      ctx.strokeStyle = rgb(this.look.color, 80); ctx.shadowColor = rgb(this.look.color); ctx.shadowBlur = 9;
      const pulse = .65 + .35 * Math.sin(this.time * 3 + i * 2);
      for (const segment of this.cracks[i]) { ctx.globalAlpha = pulse * alpha * (1 - segment[4] * .16); ctx.lineWidth = Math.max(.7, 2 - segment[4] * .35); stroke(segment); }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  private drawNodes(ctx: CanvasRenderingContext2D, alpha: number) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.core; i++) {
      const [u, v] = this.look.nodes[i], at = this.at(u, v), open = this.shield === 0;
      const size = (open ? .8 : .46) * this.box.w * .075 * (1 + .12 * Math.sin(this.time * 3.4 + i));
      const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, size * 2.1);
      gradient.addColorStop(0, 'rgba(255,255,255,.95)'); gradient.addColorStop(.12, 'rgba(255,236,190,.85)');
      gradient.addColorStop(.42, rgba(this.look.color, .55)); gradient.addColorStop(1, 'transparent');
      ctx.globalAlpha = alpha; ctx.fillStyle = gradient; ctx.fillRect(at.x - size * 2.2, at.y - size * 2.2, size * 4.4, size * 4.4);
      if (!open) continue;
      ctx.strokeStyle = '#ffe9bd'; ctx.lineWidth = 1.6; ctx.globalAlpha = .85 * alpha;
      for (let k = 0; k < 4; k++) {
        const from = this.time * .6 + i + k * Math.PI / 2 + .2;
        ctx.beginPath(); ctx.arc(at.x, at.y, size * .9, from, from + 1); ctx.stroke();
      }
    }
    ctx.restore();
  }
  private drawDeath(ctx: CanvasRenderingContext2D, t: number) {
    const { normal, bright } = this.layers[this.index], { x, y, w, h } = this.box;
    ctx.save();
    if (this.index === 0) { // Null is drawn into his own portal.
      const at = this.at(.545, .3);
      for (let i = 16; i >= 0; i--) {
        const k = i / 16, q = Math.max(0, Math.min(1, t * 1.9 - k * .55)), scale = 1 - q * q;
        if (scale <= .02) continue;
        ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(q * q * 5.5 * (1.15 - k * .4)); ctx.scale(scale, scale);
        ctx.beginPath(); ctx.arc(0, 0, h * (.1 + k * .95), 0, FULL); ctx.arc(0, 0, i ? h * (.1 + (i - 1) / 16 * .95) : 0, 0, FULL, true); ctx.clip();
        ctx.globalAlpha = 1 - q * .4; ctx.drawImage(normal, x - at.x, y - at.y, w, h); ctx.restore();
      }
      const open = Math.max(0, Math.sin(Math.min(1, t * 1.05) * Math.PI));
      ctx.globalCompositeOperation = 'lighter'; ctx.translate(at.x, at.y); ctx.lineWidth = 3; ctx.globalAlpha = .8 * open;
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.rotate(t * 13 + i * 1.25); ctx.strokeStyle = i % 2 ? '#f3e6ff' : '#a05cff';
        ctx.beginPath(); ctx.ellipse(0, 0, w * (.12 + .07 * i) * open, w * (.1 + .05 * i) * open, 0, 0, 5); ctx.stroke(); ctx.restore();
      }
    } else if (this.index === 1) { // Vespera's eclipse goes out and she burns to ash.
      const cols = 22, rows = 30, sw = normal.width / cols, sh = normal.height / rows, dw = w / cols, dh = h / rows;
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
      const hold = .32, cols = 9, rows = 13, dw = w / cols, dh = h / rows;
      if (t < hold) {
        ctx.drawImage(normal, x, y, w, h); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35 * t / hold; ctx.drawImage(bright, x, y, w, h);
      } else for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) for (let half = 0; half < 2; half++) {
        const noise = (col * 97 + row * 57 + half * 31) % 41 / 41, k = Math.max(0, (t - hold) / (1 - hold) * 1.25 - noise * .25), alpha = 1 - k * 1.05;
        if (alpha <= 0) continue;
        const px = x + col * dw, py = y + row * dh;
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.translate(px + dw / 2 + (col + .5 - cols / 2) * k * k * 46 + (noise - .5) * 70 * k, py + dh / 2 + k * k * (150 + noise * 240) - k * 36);
        ctx.rotate((noise - .5) * k * 3); ctx.translate(-px - dw / 2, -py - dh / 2); ctx.beginPath();
        if (half) { ctx.moveTo(px, py); ctx.lineTo(px + dw + .5, py); ctx.lineTo(px, py + dh + .5); } else { ctx.moveTo(px + dw, py); ctx.lineTo(px + dw, py + dh); ctx.lineTo(px, py + dh); }
        ctx.closePath(); ctx.clip(); ctx.drawImage(normal, x, y, w, h); ctx.restore();
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
    const delta = Math.min(50, now - this.last); this.last = now;
    if (this.paused() || !this.ctx) return;
    const ctx = this.ctx, still = this.reduced();
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.phase === 'gone' || !this.prepare()) return;
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
      const [u, v] = this.look.nodes[0], at = this.at(u, v), size = w * .13, gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, size);
      gradient.addColorStop(0, rgba(this.look.color, .9)); gradient.addColorStop(1, 'transparent');
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (.32 + .18 * Math.sin(this.time * 1.8)) * this.shadow; ctx.fillStyle = gradient;
      ctx.fillRect(at.x - size, at.y - size, size * 2, size * 2); ctx.globalCompositeOperation = 'source-over';
    }
    const lit = (1 - this.shadow) * this.entrance;
    if (this.core < this.max.core) this.drawCracks(ctx, lit);
    if (lit > .4) this.drawNodes(ctx, lit);
    ctx.restore();
    this.drawShield(ctx, Math.max(0, lit - .25) * 1.33);
    if (!still && damage > 0 && Math.random() < delta / 90 * damage) {
      const node = this.look.nodes[this.core + Math.floor(Math.random() * (this.max.core - this.core))];
      if (node) this.effects.burst(this.onStage(this.at(node[0], node[1])), 1, { speed: 26, life: 1500, size: 15, color: '#1a1c24', gravity: -46, shape: 'smoke', spread: 6 });
    }
  };
  destroy() { this.alive = false; cancelAnimationFrame(this.request); this.observer.disconnect(); this.canvas.remove(); }
}
