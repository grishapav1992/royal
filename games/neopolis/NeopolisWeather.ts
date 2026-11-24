type Drop = { x: number; y: number; depth: number; phase: number };
const random = (to: number) => Math.random() * to;

/** Arena weather: rain over the city, embers, frost, and dawn dust after the rescue. */
export class NeopolisWeather {
  private ctx: CanvasRenderingContext2D | null;
  private observer: ResizeObserver;
  private drops: Drop[] = [];
  private request = 0;
  private last = 0;
  private alive = true;

  constructor(private canvas: HTMLCanvasElement, private kind: () => number, private paused: () => boolean, private reduced: () => boolean) {
    this.ctx = canvas.getContext('2d');
    this.observer = new ResizeObserver(() => {
      const width = canvas.width = canvas.clientWidth, height = canvas.height = canvas.clientHeight;
      this.drops = Array.from({ length: Math.min(90, Math.round(width * height / 9000)) }, () => ({ x: random(width), y: random(height), depth: .3 + random(.7), phase: random(7) }));
    });
    this.observer.observe(canvas); this.request = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    if (!this.alive) return;
    this.request = requestAnimationFrame(this.tick);
    // Thirty frames a second are enough for falling drops.
    if (now - this.last < 30) return;
    const seconds = Math.min(50, now - this.last) / 1000; this.last = now;
    const ctx = this.ctx; if (!ctx || this.paused()) return;
    const { width, height } = this.canvas, kind = this.kind();
    ctx.clearRect(0, 0, width, height);
    if (this.reduced()) return;
    for (const drop of this.drops) {
      const { depth, phase } = drop;
      if (kind === 0) {
        drop.y += 560 * depth * seconds; drop.x -= 70 * depth * seconds;
        ctx.strokeStyle = 'rgba(160,190,230,' + .17 * depth + ')'; ctx.beginPath(); ctx.moveTo(drop.x, drop.y); ctx.lineTo(drop.x - 2.6, drop.y + 20 * depth); ctx.stroke();
      } else if (kind === 1) {
        drop.y -= 58 * depth * seconds; drop.x += Math.sin(now / 900 + phase) * 22 * seconds;
        ctx.fillStyle = 'rgba(255,' + Math.round(120 + 60 * depth) + ',50,' + (.25 + .5 * depth) * (.6 + .4 * Math.sin(now / 240 + phase)) + ')'; ctx.fillRect(drop.x, drop.y, 2.6 * depth, 2.6 * depth);
      } else if (kind === 2) {
        drop.y += 26 * depth * seconds; drop.x += Math.sin(now / 1400 + phase) * 16 * seconds;
        ctx.save(); ctx.translate(drop.x, drop.y); ctx.rotate(now / 1500 + phase); ctx.fillStyle = 'rgba(210,240,255,' + .5 * depth + ')';
        ctx.fillRect(-2.4 * depth, -.8, 4.8 * depth, 1.6); ctx.fillRect(-.8, -2.4 * depth, 1.6, 4.8 * depth); ctx.restore();
      } else {
        drop.y -= 14 * depth * seconds; drop.x += Math.sin(now / 1800 + phase) * 12 * seconds;
        ctx.fillStyle = 'rgba(255,224,150,' + .55 * depth * (.5 + .5 * Math.sin(now / 700 + phase)) + ')'; ctx.beginPath(); ctx.arc(drop.x, drop.y, 1.8 * depth, 0, Math.PI * 2); ctx.fill();
      }
      if (drop.y > height + 22) drop.y = -20; else if (drop.y < -22) drop.y = height + 20;
      if (drop.x < -10) drop.x = width + 8; else if (drop.x > width + 10) drop.x = -8;
    }
  };
  destroy() { this.alive = false; cancelAnimationFrame(this.request); this.observer.disconnect(); }
}
