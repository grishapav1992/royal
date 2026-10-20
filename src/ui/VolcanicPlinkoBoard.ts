import { BOARD, pinPosition, pocketPosition, volcanicFlight, flightPose, type Point } from './volcanicPlinkoModel';

type Burst = Point & { born: number; color: string };
type Flight = { points: Point[]; path: readonly number[]; start: number; duration: number; lastHit: number; done: () => void };

export class VolcanicPlinkoBoard {
  private ctx: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private frame = 0;
  private flight?: Flight;
  private timeout?: ReturnType<typeof setTimeout>;
  private bursts: Burst[] = [];
  private trail: Point[] = [];
  private ball: Point = { x: 410, y: 18 };
  private landed = -1;
  private dead = false;
  private ratio = 1;
  private lastPaint = 0;
  constructor(private canvas: HTMLCanvasElement, private hit: (row: number, x: number) => void, private reduced: () => boolean) {
    this.ctx = canvas.getContext('2d')!;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement!.parentElement!); this.resize();
    document.addEventListener('visibilitychange', this.visibility);
    this.frame = requestAnimationFrame(this.tick);
  }
  private visibility = () => { if (document.hidden) this.finish(); };
  private resize() {
    const wrapper = this.canvas.parentElement!, available = wrapper.parentElement!.getBoundingClientRect();
    const width = Math.max(1, Math.min(available.width, available.height * BOARD.width / BOARD.height));
    wrapper.style.width = width + 'px'; wrapper.style.height = width * BOARD.height / BOARD.width + 'px';
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr)); this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ratio = this.canvas.width / BOARD.width; this.paint(performance.now());
  }
  private tick = (now: number) => {
    if (this.dead) return;
    if (!document.hidden && (this.flight || now - this.lastPaint > 45)) {
      const flight = this.flight;
      if (flight) {
        const progress = Math.min(1, Math.max(0, (now - flight.start) / flight.duration));
        const pose = flightPose(flight.points, progress); this.ball = pose;
        for (let row = flight.lastHit + 1; row < Math.min(12, pose.segment); row++) {
          const point = flight.points[row + 1]; this.bursts.push({ x: point.x, y: point.y + 15, born: now, color: '#e0b2ff' });
          this.hit(row, point.x - 410); flight.lastHit = row;
        }
        this.trail.unshift({ ...this.ball }); this.trail.length = Math.min(this.trail.length, 14);
        if (progress >= 1) this.finish();
      }
      this.paint(now); this.lastPaint = now;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  play(path: readonly number[], fast: boolean): Promise<void> {
    this.finish(); this.landed = -1; this.trail = []; this.bursts = [];
    const points = volcanicFlight(path);
    if (this.reduced() || document.hidden) { this.ball = points[13]; this.landed = path.reduce((a, b) => a + b, 0); this.paint(performance.now()); return Promise.resolve(); }
    return new Promise(resolve => {
      const duration = fast ? 1400 : 3200;
      this.flight = { points, path, start: performance.now(), duration, lastHit: -1, done: resolve };
      this.timeout = setTimeout(() => this.finish(), duration + 180);
    });
  }
  finish() {
    const flight = this.flight; if (!flight) return;
    this.flight = undefined; clearTimeout(this.timeout);
    this.ball = flight.points[flight.points.length - 1]; this.landed = flight.path.reduce((a, b) => a + b, 0);
    this.bursts.push({ ...this.ball, born: performance.now(), color: '#d9b9ff' }); this.trail = [];
    this.paint(performance.now()); flight.done();
  }
  reset() { this.finish(); this.landed = -1; this.ball = { x: 410, y: 18 }; this.trail = []; this.bursts = []; this.paint(performance.now()); }
  private rune(x: number, y: number, glow: number) {
    const c = this.ctx;
    c.save(); c.translate(x, y); c.shadowColor = '#c3a3ff'; c.shadowBlur = glow;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(2, -2); c.lineTo(6, 0); c.lineTo(2, 2); c.lineTo(0, 8); c.lineTo(-2, 2); c.lineTo(-6, 0); c.lineTo(-2, -2); c.closePath();
    const fill = c.createLinearGradient(-4, -8, 4, 8); fill.addColorStop(0, '#f5efff'); fill.addColorStop(.4, '#c7b2ea'); fill.addColorStop(1, '#6d5996');
    c.fillStyle = fill; c.fill(); c.strokeStyle = '#dfd5f688'; c.lineWidth = .65; c.stroke();
    c.beginPath(); c.arc(0, 0, 1.2, 0, Math.PI * 2); c.fillStyle = '#fffaff'; c.fill(); c.restore();
  }
  private paint(now: number) {
    try { this.draw(now); } catch { this.canvas.dataset.renderError = 'true'; }
  }
  private draw(now: number) {
    const c = this.ctx, reduced = this.reduced();
    c.setTransform(this.ratio, 0, 0, this.canvas.height / BOARD.height, 0, 0); c.clearRect(0, 0, BOARD.width, BOARD.height);
    c.beginPath(); c.roundRect(13, 2, 794, 775, 25);
    const panel = c.createLinearGradient(0, 0, 0, 790); panel.addColorStop(0, '#10122155'); panel.addColorStop(1, '#090c19d9'); c.fillStyle = panel; c.fill();
    c.strokeStyle = '#b0a2c92c'; c.lineWidth = 1; c.stroke();
    c.save(); c.translate(410, 380);
    for (const radius of [182, 255, 298, 314]) {
      c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.strokeStyle = radius === 314 ? '#c6b4ea33' : '#b5a2d614'; c.lineWidth = radius === 314 ? 1.3 : .8; c.stroke();
    }
    for (let index = 0; index < 24; index++) {
      const angle = index * Math.PI / 12;
      c.save(); c.rotate(angle); c.translate(0, -306);
      c.beginPath(); c.moveTo(-3, 3); c.lineTo(0, -4); c.lineTo(3, 3); if (index % 3) { c.moveTo(-4, 0); c.lineTo(4, 0); }
      c.strokeStyle = index % 2 ? '#d2c3ec3d' : '#aa92c443'; c.lineWidth = 1; c.stroke(); c.restore();
    }
    c.beginPath(); c.moveTo(-255, 0); c.lineTo(255, 0); c.moveTo(0, -255); c.lineTo(0, 255); c.strokeStyle = '#bba6df0d'; c.stroke(); c.restore();
    for (let bucket = 0; bucket < 13; bucket++) {
      const pocket = pocketPosition(bucket);
      const glow = c.createRadialGradient(pocket.x, 742, 0, pocket.x, 742, 34); glow.addColorStop(0, bucket === this.landed ? '#cfa5ff80' : '#b491dc12'); glow.addColorStop(1, '#b491dc00'); c.fillStyle = glow; c.fillRect(pocket.x - 34, 708, 68, 66);
    }
    for (let row = 0; row < 12; row++) for (let index = 0; index <= row; index++) {
      const point = pinPosition(row, index); this.rune(point.x, point.y, reduced ? 0 : 2 + Math.sin(now / 1600 + row) * 1.5);
    }
    c.strokeStyle = '#c7b7dd99'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(410, 18, 16, 0, Math.PI * 2); c.moveTo(386, 18); c.lineTo(393, 18); c.moveTo(427, 18); c.lineTo(434, 18); c.stroke();
    if (!reduced) this.trail.forEach((point, i) => { c.beginPath(); c.arc(point.x, point.y, 7 * (1 - i / 16), 0, Math.PI * 2); c.fillStyle = 'rgba(176,122,244,' + (1 - i / 14) * .13 + ')'; c.fill(); });
    const b = this.ball;
    const glow = c.createRadialGradient(b.x, b.y, 2, b.x, b.y, 32); glow.addColorStop(0, '#eee3ffbb'); glow.addColorStop(.35, '#aa6fee55'); glow.addColorStop(1, '#884ac900'); c.fillStyle = glow; c.fillRect(b.x - 32, b.y - 32, 64, 64);
    const orb = c.createRadialGradient(b.x - 3, b.y - 4, 1, b.x, b.y, 10); orb.addColorStop(0, '#ffffff'); orb.addColorStop(.22, '#efdeff'); orb.addColorStop(.55, '#b384eb'); orb.addColorStop(.82, '#613b98'); orb.addColorStop(1, '#c9a8ff');
    c.beginPath(); c.arc(b.x, b.y, 8, 0, Math.PI * 2); c.fillStyle = orb; c.fill();
    const phase = reduced ? 0 : now / 1200;
    c.save(); c.translate(b.x, b.y); c.rotate(phase); c.strokeStyle = '#e9d9ffb0'; c.lineWidth = .8;
    c.beginPath(); c.ellipse(0, 0, 12, 5, .7, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.ellipse(0, 0, 5, 12, -.7, 0, Math.PI * 2); c.stroke(); c.restore();
    this.bursts = this.bursts.filter(burst => now - burst.born < 650);
    if (!reduced) for (const burst of this.bursts) {
      const p = (now - burst.born) / 650; c.globalAlpha = 1 - p; c.strokeStyle = '#e6cfff'; c.lineWidth = 1;
      c.beginPath(); c.arc(burst.x, burst.y, 5 + p * 29, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.fillStyle = i % 2 ? '#ded5ff' : '#ad8bdb'; c.fillRect(burst.x + Math.cos(a) * p * 36, burst.y + Math.sin(a) * p * 28, 1.7 * (1 - p) + .5, 1.7 * (1 - p) + .5); } c.globalAlpha = 1;
    }
  }
  destroy() { this.dead = true; this.finish(); cancelAnimationFrame(this.frame); clearTimeout(this.timeout); this.observer.disconnect(); document.removeEventListener('visibilitychange', this.visibility); this.bursts = []; }
}
