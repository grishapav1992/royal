interface Point { x: number; y: number }
interface Particle { born: number; life: number; size: number; color: string; at: (t: number) => Point; spin: number }

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const LIGHTS = ['#8bffd1', '#5fe39a', '#f0fff6'];

/** Emerald splinters drawn above the scene: the cast and the dissolving groups. */
export class MagicEffects {
  private context: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private frame = 0;
  enabled = false;

  constructor(private canvas: HTMLCanvasElement, private playSound: (kind: 'cast' | 'win' | 'portal' | 'bonus') => void) {
    this.context = canvas.getContext('2d')!;
  }

  cue(kind: 'cast' | 'win' | 'portal' | 'bonus') {
    if (!this.enabled) return;
    this.playSound(kind);
  }

  /** From the wand tip towards the cabinet. */
  cast(from: Point, target: DOMRect, factor: number) {
    if (still()) return;
    const origin = this.canvas.getBoundingClientRect(), now = performance.now();
    const start = { x: from.x - origin.left, y: from.y - origin.top };
    for (let i = 0; i < 26; i++) {
      const end = { x: target.left - origin.left + target.width * (0.3 + 0.4 * Math.random()), y: target.top - origin.top + target.height * (0.25 + 0.5 * Math.random()) };
      const middle = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 60 - 110 * Math.random() };
      this.particles.push({ born: now + (i * 20 + 90) * factor, life: 700 * factor + 140, size: 4 + (i % 4) * 2, color: LIGHTS[i % 3], spin: 0,
        at: t => { const u = 1 - t; return { x: u * u * start.x + 2 * u * t * middle.x + t * t * end.x, y: u * u * start.y + 2 * u * t * middle.y + t * t * end.y }; } });
    }
    this.run();
  }

  /** The removed cells turn into dust. */
  dust(cells: DOMRect[], factor: number) {
    if (still()) return;
    const origin = this.canvas.getBoundingClientRect(), now = performance.now();
    for (const cell of cells) for (let i = 0; i < 7; i++) {
      const angle = i / 7 * Math.PI * 2 + Math.random(), reach = cell.width * (0.25 + 0.35 * Math.random());
      const center = { x: cell.left - origin.left + cell.width / 2, y: cell.top - origin.top + cell.height / 2 };
      this.particles.push({ born: now + Math.random() * 90 * factor, life: 520 * factor + 80, size: 3 + (i % 3) * 2, color: LIGHTS[i % 3], spin: Math.random() * 2,
        at: t => { const e = 1 - (1 - t) * (1 - t); return { x: center.x + Math.cos(angle) * reach * e, y: center.y + Math.sin(angle) * reach * e - cell.height * 0.2 * t * t }; } });
    }
    this.run();
  }

  private run() { if (!this.frame) this.frame = requestAnimationFrame(this.render); }

  private render = (time: number) => {
    const c = this.context, width = this.canvas.clientWidth, height = this.canvas.clientHeight, ratio = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
    }
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, width, height);
    this.particles = this.particles.filter(particle => time < particle.born + particle.life);
    c.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      const t = (time - particle.born) / particle.life;
      if (t < 0) continue;
      const point = particle.at(t), s = particle.size * (t < 0.2 ? 0.5 + t * 2.5 : 1 - 0.4 * t);
      c.save();
      c.translate(point.x, point.y); c.rotate(particle.spin * t);
      c.globalAlpha = Math.min(1, t * 8) * Math.min(1, (1 - t) * 3);
      c.fillStyle = particle.color; c.shadowColor = '#65ffbb'; c.shadowBlur = 10;
      c.beginPath(); c.moveTo(0, -s * 0.85); c.lineTo(s * 0.5, 0); c.lineTo(0, s * 0.85); c.lineTo(-s * 0.5, 0); c.closePath(); c.fill();
      c.restore();
    }
    this.frame = this.particles.length ? requestAnimationFrame(this.render) : 0;
  };

  clear() {
    cancelAnimationFrame(this.frame); this.frame = 0; this.particles = [];
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  destroy() { this.clear(); }
}
