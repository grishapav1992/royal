import type { Hero } from '../../src/shared/neopolisMath';

export type Point = { x: number; y: number };
export type Effect = Hero | 'win' | 'celebrate' | 'finisher' | 'scatter' | 'emblem';
type Draw = (ctx: CanvasRenderingContext2D, t: number) => void;
type Layer = { age: number; duration: number; draw: Draw };
type Shape = 'spark' | 'shard' | 'rock' | 'smoke';
type Particle = Point & {
  vx: number; vy: number; age: number; life: number; size: number; color: string;
  gravity: number; angle: number; turn: number; shape: Shape;
};
export type Burst = { speed: number; life: number; size: number; color: string; gravity?: number; shape?: Shape; spread?: number };

export const HERO_COLORS: Record<Hero, string> = { granite: '#ffb957', impulse: '#73ecff', prism: '#d0a2ff' };
const FULL = Math.PI * 2;
const between = (from: number, to: number) => from + Math.random() * (to - from);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Presentation only. Events are emitted by confirmed replay frames and landed
 * symbols, never by a random suggestion of a bonus or an unconfirmed outcome. */
export class NeopolisEffects {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private observer: ResizeObserver;
  private layers: Layer[] = [];
  private particles: Particle[] = [];
  private request = 0;
  private last = 0;
  private alive = true;
  private width = 1;
  private height = 1;

  constructor(private stage: HTMLElement, private paused: () => boolean, private reduced: () => boolean) {
    this.canvas = stage.ownerDocument.createElement('canvas');
    this.canvas.className = 'np-effects'; this.canvas.setAttribute('aria-hidden', 'true');
    stage.append(this.canvas); this.ctx = this.canvas.getContext('2d');
    const resize = () => {
      if (this.width !== stage.clientWidth || this.height !== stage.clientHeight) this.clear();
      this.width = stage.clientWidth; this.height = stage.clientHeight;
      const scale = Math.min(2, stage.ownerDocument.defaultView!.devicePixelRatio || 1);
      this.canvas.width = Math.max(1, Math.round(this.width * scale));
      this.canvas.height = Math.max(1, Math.round(this.height * scale));
      this.ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    };
    this.observer = new ResizeObserver(resize); this.observer.observe(stage); resize();
  }

  /** A fraction of an element's box in the canvas coordinates. */
  point(element: Element | null | undefined, fx = .5, fy = .5): Point {
    if (!element) return { x: this.width * .5, y: this.height * .5 };
    const parent = this.stage.getBoundingClientRect(), box = element.getBoundingClientRect();
    if (!box.width || !box.height) return { x: this.width * .5, y: this.height * .5 };
    const scale = parent.width / this.width || 1;
    return { x: (box.left - parent.left + box.width * fx) / scale, y: (box.top - parent.top + box.height * fy) / scale };
  }
  cell(index: number): Point { return this.point(this.stage.querySelectorAll('.np-board [role=gridcell]')[index]); }
  hero(hero: Hero): Point { return this.point(this.stage.querySelector('[data-hero="' + hero + '"]'), .72, .38); }

  private get idle() { return !this.alive || this.reduced() || !this.ctx; }
  private start() { if (!this.request) { this.last = performance.now(); this.request = requestAnimationFrame(this.tick); } }
  private add(duration: number, draw: Draw) {
    if (this.idle) return;
    this.layers.push({ age: 0, duration, draw });
    if (this.layers.length > 80) this.layers.shift();
    this.start();
  }

  burst(at: Point, count: number, options: Burst) {
    if (this.idle) return;
    const spread = options.spread ?? 0;
    for (let i = 0; i < count; i++) {
      const angle = between(0, FULL), speed = between(options.speed * .2, options.speed);
      this.particles.push({
        x: at.x + between(-spread, spread), y: at.y + between(-spread, spread),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: between(options.life * .5, options.life),
        size: between(options.size * .4, options.size), color: options.color, gravity: options.gravity ?? 160,
        angle: between(0, 6), turn: between(-9, 9), shape: options.shape ?? 'spark',
      });
    }
    if (this.particles.length > 620) this.particles.splice(0, this.particles.length - 620);
    this.start();
  }
  ring(at: Point, color: string, radius: number, duration = 650, width = 6) {
    this.add(duration, (ctx, t) => {
      ctx.strokeStyle = color; ctx.globalAlpha = 1 - t; ctx.lineWidth = width * (1 - t) + .5;
      ctx.beginPath(); ctx.arc(at.x, at.y, 8 + radius * easeOut(t), 0, FULL); ctx.stroke();
      ctx.globalAlpha = (1 - t) * .25; ctx.lineWidth = width * 4 * (1 - t) + 1; ctx.stroke();
    });
  }
  glow(at: Point, color: string, radius: number, duration = 420) {
    this.add(duration, (ctx, t) => {
      const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
      gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
      ctx.globalAlpha = 1 - t; ctx.fillStyle = gradient; ctx.fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2);
    });
  }
  bolt(from: Point, to: Point, color: string, duration = 600, width = 3) {
    const seed = between(0, 40), dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
    this.add(duration, (ctx, t) => {
      for (const [offset, thickness] of [[0, width], [9, width * .5]]) {
        ctx.beginPath(); ctx.moveTo(from.x, from.y);
        for (let i = 1; i <= 16; i++) {
          const k = i / 16, beat = Math.floor(t * 20);
          const jitter = (Math.sin(i * 7.3 + seed + offset + beat * 2.1) + Math.sin(i * 3.1 + seed * 2 + beat)) * .036 * length * Math.sin(k * Math.PI);
          ctx.lineTo(from.x + dx * k - dy / length * jitter, from.y + dy * k + dx / length * jitter);
        }
        const alpha = (1 - t) ** .8;
        ctx.strokeStyle = color; ctx.globalAlpha = alpha * .35; ctx.lineWidth = thickness * 4; ctx.stroke();
        ctx.globalAlpha = alpha; ctx.lineWidth = thickness; ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = thickness * .4; ctx.stroke();
      }
    });
  }
  beam(from: Point, to: Point, color: string, duration = 800, width = 16) {
    this.add(duration, (ctx, t) => {
      const reach = Math.min(1, t * 5), alpha = t < .7 ? 1 : (1 - t) / .3;
      const end = { x: from.x + (to.x - from.x) * reach, y: from.y + (to.y - from.y) * reach };
      const line = () => { ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(end.x, end.y); ctx.stroke(); };
      ctx.lineCap = 'round'; ctx.strokeStyle = color;
      for (const [scale, opacity] of [[3, .12], [1.6, .3], [.8, .9]]) {
        ctx.globalAlpha = alpha * opacity; ctx.lineWidth = width * scale * (1 + .12 * Math.sin(t * 70)); line();
      }
      ctx.globalAlpha = alpha; ctx.strokeStyle = '#fff'; ctx.lineWidth = width * .28; line();
    });
  }
  private rock(from: Point, to: Point, duration = 420) {
    const at = (t: number): Point => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * 70 });
    this.add(duration, (ctx, t) => {
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#ffa63d';
      for (let i = 6; i >= 0; i--) {
        const tail = at(Math.max(0, t - i * .03));
        ctx.globalAlpha = .12 * (7 - i) / 7; ctx.beginPath(); ctx.arc(tail.x, tail.y, 22 - i * 2, 0, FULL); ctx.fill();
      }
      const head = at(t);
      ctx.globalAlpha = 1; ctx.translate(head.x, head.y); ctx.rotate(t * 9);
      ctx.fillStyle = '#4a3c30'; ctx.strokeStyle = '#ffb957'; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const radius = 20 + i * 37 % 9, angle = i * FULL / 7;
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });
  }
  portal(at: Point, color: string, radius: number, duration = 760) {
    this.add(duration, (ctx, t) => {
      const open = Math.max(0, t < .25 ? t * 4 : t > .75 ? (1 - t) * 4 : 1), size = radius * open;
      ctx.translate(at.x, at.y);
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.rotate(t * 8 + i * Math.PI / 2); ctx.globalAlpha = .75 * open;
        ctx.strokeStyle = i % 2 ? '#fff' : color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, 0, size, size * (.55 + .12 * i), 0, .2, 4.6); ctx.stroke(); ctx.restore();
      }
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size + 1);
      gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
      ctx.globalAlpha = .5 * open; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, size, 0, FULL); ctx.fill();
    });
  }
  private orb(from: Point, to: Point, color: string, duration = 620) {
    const at = (t: number): Point => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * 60 });
    this.add(duration, (ctx, t) => {
      const eased = t * t * (3 - 2 * t);
      for (let i = 0; i < 9; i++) {
        const tail = at(Math.max(0, eased - i * .025));
        ctx.globalAlpha = (1 - i / 9) * .7; ctx.fillStyle = i ? color : '#fff';
        ctx.beginPath(); ctx.arc(tail.x, tail.y, 8 - i * .7, 0, FULL); ctx.fill();
      }
    });
  }
  private crack(at: Point, color: string) {
    for (let i = 0; i < 9; i++) {
      const angle = i * .7 + between(0, .3), points = [at,
        { x: at.x + Math.cos(angle) * 60, y: at.y + Math.sin(angle) * 50 },
        { x: at.x + Math.cos(angle + .25) * 125, y: at.y + Math.sin(angle + .25) * 105 }];
      this.add(560, (ctx, t) => {
        const reach = Math.min(1, t * 2.6) * 2;
        ctx.globalAlpha = t < .6 ? 1 : (1 - t) / .4; ctx.lineJoin = 'round';
        for (const [width, stroke] of [[5, color], [1.6, '#fff']] as const) {
          ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
          for (let j = 1; j < 3; j++) {
            const part = Math.max(0, Math.min(1, reach - j + 1)); if (!part) break;
            ctx.lineTo(points[j - 1].x + (points[j].x - points[j - 1].x) * part, points[j - 1].y + (points[j].y - points[j - 1].y) * part);
          }
          ctx.stroke();
        }
      });
    }
  }

  /** A hero's blow in their own colour. `strong` marks the last blow of a battle. */
  strike(hero: Hero, to: Point, strong = false) {
    if (this.idle) return;
    const from = this.hero(hero);
    if (hero === 'granite') this.rock(from, to, strong ? 560 : 420);
    else if (hero === 'impulse') { this.bolt(from, to, HERO_COLORS.impulse, 680, strong ? 6 : 4); this.bolt(from, to, HERO_COLORS.impulse, 500, 2); }
    else { this.portal(from, '#b37bff', 44, 700); this.portal(to, '#b37bff', 58); this.beam(from, to, '#c08cff', 560, 9); }
  }

  play(kind: Effect, cells: number[] = [], hero?: Hero) {
    if (this.idle) return;
    const points = cells.map(cell => this.cell(cell)), field = this.point(this.stage.querySelector('.np-board'));
    const middle = points.length ? { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length } : field;
    if (kind === 'granite') {
      this.ring(middle, '#ffb957', 210, 650, 12); this.glow(middle, '#ffcf8a', 190); this.crack(middle, '#ffb04a');
      for (const point of points) {
        this.burst(point, 12, { speed: 310, life: 900, size: 9, color: '#6b5a49', gravity: 620, shape: 'rock' });
        this.burst(point, 8, { speed: 240, life: 600, size: 4, color: '#ffb957' });
      }
    } else if (kind === 'impulse') {
      const top = points[0] ? { x: points[0].x, y: points[0].y - 70 } : field;
      this.bolt(this.hero('impulse'), top, HERO_COLORS.impulse, 420, 3);
      for (const point of points) {
        this.bolt(top, point, HERO_COLORS.impulse, 480, 4); this.glow(point, '#9af2ff', 90, 320);
        this.burst(point, 12, { speed: 200, life: 520, size: 3.4, color: '#b9f6ff' });
      }
    } else if (kind === 'prism') {
      this.portal(this.hero('prism'), '#b37bff', 46, 800);
      for (const point of points) {
        this.portal(point, '#b37bff', 46);
        this.burst(point, 8, { speed: 150, life: 600, size: 3, color: '#d9b6ff', gravity: -30 });
      }
    } else if (kind === 'emblem') {
      for (const point of points) { this.orb(point, this.hero(hero!), HERO_COLORS[hero!]); this.ring(point, HERO_COLORS[hero!], 34, 420, 3); }
    } else if (kind === 'scatter') {
      for (const point of points) { this.ring(point, '#b06bff', 54, 700, 4); this.glow(point, '#8f4dff', 80, 520); }
    } else if (kind === 'finisher') {
      for (const point of points) { this.glow(point, '#ffe3a0', 120, 460); this.burst(point, 16, { speed: 210, life: 700, size: 4, color: '#ffdf8f' }); }
    } else if (kind === 'win') {
      for (const point of points) this.burst(point, 3, { speed: 90, life: 600, size: 3, color: '#ffe39c', gravity: 40 });
    } else {
      this.ring(field, '#ffe39c', 260, 900, 9);
      this.burst(field, 70, { speed: 420, life: 1300, size: 5, color: '#ffe39c', gravity: 120 });
    }
  }

  private tick = (now: number) => {
    this.request = 0;
    if (!this.alive) return;
    const delta = Math.min(50, now - this.last); this.last = now;
    if (!this.paused()) {
      const ctx = this.ctx!; ctx.clearRect(0, 0, this.width, this.height);
      for (const layer of this.layers) {
        layer.age += delta;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; layer.draw(ctx, Math.min(1, layer.age / layer.duration)); ctx.restore();
      }
      for (const particle of this.particles) this.drawParticle(ctx, particle, delta);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      this.layers = this.layers.filter(layer => layer.age < layer.duration);
      this.particles = this.particles.filter(particle => particle.age < particle.life);
    }
    if (this.layers.length || this.particles.length) this.request = requestAnimationFrame(this.tick);
    else this.ctx?.clearRect(0, 0, this.width, this.height);
  };
  private drawParticle(ctx: CanvasRenderingContext2D, particle: Particle, delta: number) {
    const seconds = delta / 1000;
    particle.age += delta; particle.vx *= .985; particle.vy = particle.vy * .985 + particle.gravity * seconds;
    particle.x += particle.vx * seconds; particle.y += particle.vy * seconds; particle.angle += particle.turn * seconds;
    const left = 1 - particle.age / particle.life, { size, shape } = particle;
    if (left <= 0) return;
    ctx.globalCompositeOperation = shape === 'rock' || shape === 'smoke' ? 'source-over' : 'lighter'; ctx.fillStyle = particle.color;
    if (shape === 'smoke') {
      ctx.globalAlpha = left * .22; ctx.beginPath(); ctx.arc(particle.x, particle.y, size * (2 - left), 0, FULL); ctx.fill();
      return;
    }
    const alpha = Math.min(1, left * 1.6);
    if (shape === 'spark') {
      ctx.globalAlpha = alpha * .4; ctx.beginPath(); ctx.arc(particle.x, particle.y, size * 2.2, 0, FULL); ctx.fill();
      ctx.globalAlpha = alpha; ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
      return;
    }
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(particle.x, particle.y); ctx.rotate(particle.angle);
    ctx.beginPath(); ctx.moveTo(-size, -size * .5); ctx.lineTo(size * .3, -size); ctx.lineTo(size, size * .4); ctx.lineTo(-size * .4, size); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = alpha * .5; ctx.strokeStyle = '#fff'; ctx.lineWidth = .7; ctx.stroke(); ctx.restore();
  }
  clear() {
    cancelAnimationFrame(this.request); this.request = 0; this.layers = []; this.particles = [];
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }
  destroy() { this.alive = false; this.clear(); this.observer.disconnect(); this.canvas.remove(); }
}
