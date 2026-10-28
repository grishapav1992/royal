import { flagSoundTimeline } from './FlagSoundTimeline';
import { FLAG_COUNTRIES, type FlagCountry, type FlagView } from '../../src/shared/flagBattle';
import { FLAG_BODY_RADIUS, FlagPhysics, planFlagPhysics, type FlagPhysicsPlan } from './FlagPhysics';

export const FLAG_ROUND_SECONDS = 20;
export const flagAsset = (id: string) => '/assets/flag-battle/flags/' + id.toLowerCase() + '.svg';
const smooth = (t: number) => { const p = Math.min(1, Math.max(0, t)); return p * p * (3 - 2 * p); };
export class FlagArena {
  private images = new Map<string, HTMLImageElement>();
  private world = new FlagPhysics(93, true);
  private plan?: FlagPhysicsPlan;
  private labels: FlagCountry[] = FLAG_COUNTRIES.map(c => c.id);
  private last?: number;
  private celebration = 0;
  private finished = false;
  constructor(private canvas: HTMLCanvasElement) {
    for (const country of FLAG_COUNTRIES) {
      const image = new Image(); image.src = flagAsset(country.id); this.images.set(country.id, image);
    }
  }
  reset(view?: FlagView) {
    this.last = undefined; this.celebration = 0; this.finished = false;
    this.plan = view ? planFlagPhysics(view.seed) : undefined;
    this.world = new FlagPhysics(view?.seed ?? 93, !view);
    this.labels = FLAG_COUNTRIES.map(c => c.id);
    if (view && this.plan) for (const [i, body] of this.plan.order.entries()) this.labels[body] = view.order[i];
  }
  soundTimeline(selected: FlagCountry, won: boolean) { return this.plan ? flagSoundTimeline(this.plan, this.labels, selected, won, FLAG_ROUND_SECONDS) : []; }
  count() { return this.world.exits.length; }
  finish() {
    if (this.plan) this.world.restore(this.plan);
    this.finished = true; this.celebration = 1;
  }
  getState() {
    return { physicsVersion: 2, simulatedTime: this.world.time, eliminated: this.count(),
      order: this.world.exits.map(e => this.labels[e.id]), winner: this.plan ? this.labels[this.plan.order[11]] : undefined,
      gap: this.world.gap, halfGap: this.world.halfGap,
      bodies: this.world.bodies.map(b => ({ country: this.labels[b.id], x: b.x, y: b.y, escaped: b.escapedAt !== null })) };
  }
  tick(now: number, running: boolean, selected: FlagCountry, motion: boolean) {
    const dt = this.last === undefined ? 0 : Math.max(0, Math.min(.1, (now - this.last) / 1000));
    this.last = now;
    if (motion && !this.finished) {
      if (running && this.plan) this.world.advance(dt * this.plan.duration / FLAG_ROUND_SECONDS);
      else if (!this.plan) this.world.advance(dt);
    }
    if (this.world.finished && !this.finished) {
      this.celebration = Math.min(1, this.celebration + dt / .7);
      if (this.celebration === 1) this.finished = true;
    }
    this.paint(selected);
    return { eliminated: this.count(), finished: this.finished, playhead: this.plan ? this.world.time / this.plan.duration * FLAG_ROUND_SECONDS + this.celebration * .7 : 0 };
  }
  private paint(selected: FlagCountry) {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const c = this.canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, rect.width, rect.height);
    const r = Math.min(rect.width, rect.height) * .405, cx = rect.width / 2, cy = rect.height / 2;
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, r * 1.23);
    glow.addColorStop(0, '#143f40'); glow.addColorStop(.8, '#102d32'); glow.addColorStop(1, '#0a202800');
    c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, r * 1.23, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      c.fillStyle = '#507173'; c.beginPath(); c.arc(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12, 1, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#47706b44'; c.lineWidth = 1;
    for (const radius of [.55, .2]) { c.beginPath(); c.arc(cx, cy, r * radius, 0, Math.PI * 2); c.stroke(); }
    const gap = this.world.gap, half = this.world.halfGap;
    c.lineCap = 'round'; c.lineWidth = Math.max(3, r * .024); c.strokeStyle = '#d9f4e5';
    c.shadowBlur = 15; c.shadowColor = '#74d8b755';
    if (half < Math.PI) { c.beginPath(); c.arc(cx, cy, r, gap + half, gap + Math.PI * 2 - half); c.stroke(); }
    c.shadowBlur = 0;
    if (half > 0) {
      c.strokeStyle = '#f69575'; c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, r * 1.06, gap - half, gap + half); c.stroke();
    }
    const alpha = this.world.finished ? 1 : this.world.interpolation;
    const p = smooth(this.celebration);
    for (const b of this.world.bodies) {
      const tail = this.world.finished ? this.celebration * .7 * (this.plan?.duration ?? FLAG_ROUND_SECONDS) / FLAG_ROUND_SECONDS : 0;
      const age = b.escapedAt === null ? 0 : this.world.time - b.escapedAt + tail;
      if (b.escapedAt !== null && (age > .75 || this.finished)) continue;
      let x = b.previousX + (b.x - b.previousX) * alpha, y = b.previousY + (b.y - b.previousY) * alpha;
      if (b.escapedAt !== null) { x += b.vx * tail; y += b.vy * tail + .325 * tail * tail; }
      let size = FLAG_BODY_RADIUS;
      if (b.escapedAt === null && this.world.finished) { x *= 1 - p; y *= 1 - p; size += (.24 - size) * p; }
      c.globalAlpha = b.escapedAt === null ? 1 : Math.max(0, 1 - age / .75);
      this.flag(c, this.labels[b.id], cx + x * r, cy + y * r, size * r, this.labels[b.id] === selected);
    }
    c.globalAlpha = 1;
  }
  private flag(c: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, selected: boolean) {
    c.save(); c.shadowColor = '#0008'; c.shadowBlur = 8; c.fillStyle = '#f5f0df'; c.beginPath(); c.arc(x, y, size + 1, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    if (selected) { c.strokeStyle = '#f2cb77'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, size + 4, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.clip();
    const img = this.images.get(id);
    if (img?.complete && img.naturalWidth) c.drawImage(img, x - size * 1.5, y - size, size * 3, size * 2);
    c.restore();
  }
}
