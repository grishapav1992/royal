import { FLAG_COUNTRIES, type FlagCountry, type FlagView } from '../../src/shared/flagBattle';

export const FLAG_ROUND_SECONDS = 19;
export const flagAsset = (id: string) => '/assets/flag-battle/flags/' + id.toLowerCase() + '.svg';
type Ball = { id: FlagCountry; x: number; y: number; vx: number; vy: number };
export class FlagArena {
  private images = new Map<string, HTMLImageElement>();
  private balls: Ball[] = [];
  private view?: FlagView;
  private elapsed = 0;
  private last = 0;
  private scale = 1;
  constructor(private canvas: HTMLCanvasElement) {
    for (const country of FLAG_COUNTRIES) {
      const image = new Image(); image.src = flagAsset(country.id); this.images.set(country.id, image);
    }
    this.reset();
  }
  reset(view?: FlagView) {
    this.view = view; this.elapsed = 0; this.last = 0;
    const seed = view?.seed ?? 93;
    this.balls = FLAG_COUNTRIES.map((c, i) => {
      const angle = i * 2.39996 + seed % 30, radius = .18 + Math.sqrt(i / 12) * .48;
      return { id: c.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
        vx: Math.cos(angle * 3) * .52, vy: Math.sin(angle * 3) * .52 };
    });
  }
  count() { return this.view ? Math.min(11, Math.max(0, Math.floor((this.elapsed - 2) / 1.5))) : 0; }
  finish() { this.elapsed = FLAG_ROUND_SECONDS; }
  tick(now: number, running: boolean, selected: FlagCountry, motion: boolean) {
    const dt = this.last ? Math.max(0, Math.min(.04, (now - this.last) / 1000)) : 0;
    this.last = now;
    if (running) this.elapsed = Math.min(FLAG_ROUND_SECONDS, this.elapsed + dt);
    const count = this.count(), eliminated = new Set(this.view?.order.slice(0, count) ?? []);
    const active = this.balls.filter(b => !eliminated.has(b.id));
    const gap = this.elapsed * .65 + Math.PI / 3;
    if ((running || !this.view) && motion) {
      for (const b of active) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        const dist = Math.hypot(b.x, b.y);
        if (dist > .89) {
          const nx = b.x / dist, ny = b.y / dist, dot = b.vx * nx + b.vy * ny;
          b.x = nx * .89; b.y = ny * .89;
          if (dot > 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
        }
      }
      for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
        if (distance < .16 && distance > .0001) {
          const nx = dx / distance, ny = dy / distance, overlap = (.16 - distance) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
          const dot = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (dot > 0) { a.vx -= dot * nx; a.vy -= dot * ny; b.vx += dot * nx; b.vy += dot * ny; }
        }
      }
    }
    this.paint(active, gap, selected, running);
    return { eliminated: count, finished: this.elapsed >= FLAG_ROUND_SECONDS };
  }
  private paint(active: Ball[], gap: number, selected: FlagCountry, running: boolean) {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const c = this.canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, rect.width, rect.height);
    const r = Math.min(rect.width, rect.height) * .405, cx = rect.width / 2, cy = rect.height / 2;
    this.scale = r;
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, r * 1.23);
    glow.addColorStop(0, '#143f40'); glow.addColorStop(.8, '#102d32'); glow.addColorStop(1, '#0a202800');
    c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, r * 1.23, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      c.fillStyle = '#507173'; c.beginPath(); c.arc(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12, 1, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#47706b44'; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, r * .55, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, r * .2, 0, Math.PI * 2); c.stroke();
    c.lineCap = 'round'; c.lineWidth = 5; c.strokeStyle = '#d9f4e5';
    c.shadowBlur = 15; c.shadowColor = '#74d8b755';
    c.beginPath(); c.arc(cx, cy, r, gap + .25, gap + Math.PI * 2 - .25); c.stroke();
    c.shadowBlur = 0; c.strokeStyle = '#f69575'; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, r * 1.06, gap - .21, gap + .21); c.stroke();
    const count = this.count(), target = this.view?.order[count];
    const until = 2 + (count + 1) * 1.5 - this.elapsed;
    const exiting = running && until < .7 && count < 11;
    for (const b of active) {
      let x = b.x, y = b.y, size = .087;
      if (exiting && b.id === target) {
        const p = Math.max(0, 1 - until / .7), ease = p * p;
        x += (Math.cos(gap) * 1.22 - x) * ease; y += (Math.sin(gap) * 1.22 - y) * ease;
      }
      if (active.length === 1) { x = 0; y = 0; size = .24; }
      this.flag(c, b.id, cx + x * r, cy + y * r, size * r, b.id === selected);
    }
  }
  private flag(c: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, selected: boolean) {
    c.save(); c.shadowColor = '#0008'; c.shadowBlur = 8; c.fillStyle = '#f5f0df'; c.beginPath(); c.arc(x, y, size + 2, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    if (selected) { c.strokeStyle = '#f2cb77'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, size + 5, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.clip();
    const img = this.images.get(id);
    if (img?.complete && img.naturalWidth) c.drawImage(img, x - size * 1.5, y - size, size * 3, size * 2);
    c.restore();
  }
}
