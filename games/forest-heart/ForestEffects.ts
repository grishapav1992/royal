import type { ForestGeometry } from './ForestLayout';

interface Particle { petal: boolean; x: number; y: number; vx: number; vy: number; gravity: number; life: number; time: number; radius: number; color: string; angle: number; spin: number; sway: number }
interface Mote { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; time: number; life: number; radius: number; color: string }
interface Stream { from: () => Point | undefined; to: () => Point; color: string; rate: number; pending: number; scatter: number }
type Point = { x: number; y: number };
interface Beam { flower: number; progress: number; color: string; opacity: number }
interface Streak { u: number; t: number; speed: number; length: number }
interface Blossom { x: number; y: number; radius: number; angle: number; pink: boolean; delay: number }
const rnd = (from: number, to: number) => from + Math.random() * (to - from);
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (t: number) => t * t * (3 - 2 * t);
const back = (t: number) => { const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
/** Waterfalls painted on v1/background.webp, in its own 1672 by 941 pixels. */
const waterfalls = [[200, 275, 55, 135], [323, 275, 28, 75], [440, 140, 36, 210], [349, 148, 20, 92], [196, 168, 20, 76], [1514, 240, 66, 130], [1462, 440, 56, 188], [1438, 662, 52, 84], [1546, 440, 20, 110], [180, 555, 70, 102], [756, 745, 56, 66]];
const petals = ['#ffd98a', '#f6b6d8', '#d3aef5', '#fff0c0'], leaves = ['#6ea24a', '#8a6b3d', '#4f8a4f'];

/** Decoration only. Random values here never touch an outcome, a payout or a request. */
export class ForestEffects {
  private geometry?: ForestGeometry;
  private particles: Particle[] = [];
  private beams: Beam[] = [];
  private motes: Mote[] = [];
  private streams = new Map<string, Stream>();
  private falls: { x: number; y: number; w: number; h: number; streaks: Streak[] }[] = [];
  private flies: { x: number; y: number; angle: number; speed: number; phase: number; radius: number }[] = [];
  private blossoms: Blossom[] = [];
  private bloom = 0; private bloomShown = -1; private bloomTarget = 0;
  private rain = 0;
  reduced = false;
  rays = 0;
  ring = -1;
  constructor(private backdrop: CanvasRenderingContext2D, private front: CanvasRenderingContext2D, private bloomLayer: CanvasRenderingContext2D, private pink: HTMLImageElement, private gold: HTMLImageElement) {}
  resize(g: ForestGeometry) {
    this.geometry = g; this.bloomShown = -1;
    const scale = Math.max((g.width + 28) / 1672, (g.height + 28) / 941), left = (g.width - 1672 * scale) / 2, top = (g.height - 941 * scale) / 2;
    this.falls = waterfalls.map(([x, y, w, h]) => ({ x: left + x * scale, y: top + y * scale, w: w * scale, h: h * scale, streaks: Array.from({ length: 7 }, () => ({ u: Math.random(), t: Math.random(), speed: rnd(.35, .75), length: rnd(.12, .3) })) }));
    this.flies = Array.from({ length: g.kind === 'full' ? 30 : 16 }, () => ({ x: rnd(0, g.width), y: rnd(0, g.height), angle: rnd(0, 6.28), speed: rnd(5, 16), phase: rnd(0, 6.28), radius: rnd(1.2, 2.4) }));
    const { x, y, board: b, frame } = g;
    this.blossoms = Array.from({ length: 22 }, (_, i) => {
      const t = (Math.floor(i / 4) + rnd(.15, .85)) / 5.5, depth = frame * rnd(.3, .9), point = i % 4 === 0 ? [x + b * t, y - depth] : i % 4 === 1 ? [x + b + depth, y + b * t] : i % 4 === 2 ? [x + b * t, y + b + depth] : [x - depth, y + b * t];
      return { x: point[0], y: point[1], radius: frame * rnd(.2, .36), angle: rnd(0, 6.28), pink: i % 2 === 0, delay: rnd(0, .9) };
    });
  }
  spark(x: number, y: number, color: string, count = 6, speed = 60) {
    if (this.reduced) return;
    for (let i = 0; i < count && this.particles.length < 420; i++) { const angle = rnd(0, 6.28), v = rnd(.2, 1) * speed; this.particles.push({ petal: false, x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 12, gravity: 40, life: rnd(.35, .95), time: 0, radius: rnd(1, 2.6), color, angle: 0, spin: 0, sway: 0 }); }
  }
  petal(x: number, y: number, vx: number, vy: number, scale = 1) {
    if (!this.reduced && this.particles.length < 420) this.particles.push({ petal: true, x, y, vx, vy, gravity: 26, life: rnd(2.4, 4.4), time: 0, radius: rnd(4, 9) * scale, color: petals[Math.floor(Math.random() * 4)], angle: rnd(0, 6.28), spin: rnd(-3, 3), sway: rnd(.1, 6.28) });
  }
  leaf(x: number, y: number, count = 1) {
    if (this.reduced) return;
    for (let i = 0; i < count && this.particles.length < 420; i++) this.particles.push({ petal: true, x, y, vx: rnd(-60, 60), vy: rnd(-70, -10), gravity: 120, life: rnd(.6, 1.2), time: 0, radius: rnd(2.5, 5), color: leaves[Math.floor(Math.random() * 3)], angle: rnd(0, 6.28), spin: rnd(-6, 6), sway: 0 });
  }
  /** Motes that keep flowing from her hand while an action lasts. A missing start point pauses the stream. */
  stream(name: string, from: () => Point | undefined, to: () => Point, color: string, rate = 26, scatter = 10) { if (!this.reduced) this.streams.set(name, { from, to, color, rate, scatter, pending: 0 }); }
  stopStream(name?: string) { if (name) this.streams.delete(name); else this.streams.clear(); }
  burst(from: Point, to: Point, color: string, count: number, scatter = 18) { if (!this.reduced) for (let i = 0; i < count; i++) this.mote(from, to, color, scatter); }
  private mote(from: Point, to: Point, color: string, scatter: number) {
    if (this.motes.length > 260) return; const x1 = to.x + rnd(-scatter, scatter), y1 = to.y + rnd(-scatter, scatter);
    this.motes.push({ x0: from.x + rnd(-6, 6), y0: from.y + rnd(-6, 6), x1, y1, cx: (from.x + x1) / 2 + rnd(-40, 40), cy: (from.y + y1) / 2 - rnd(20, 110), time: 0, life: rnd(.5, .95), radius: rnd(1.5, 3.2), color });
  }
  /** Petals mostly fall beside the field, so the winning light stays readable. */
  shower(seconds: number) { this.rain = this.reduced ? 0 : seconds; }
  scatter(count: number) { const g = this.geometry; if (g) for (let i = 0; i < count; i++) this.petal(rnd(0, g.width), rnd(-30, g.height * .25), rnd(-20, 20), rnd(10, 60), .9); }
  beam(flower: number, color: string, opacity = 1) { const beam = { flower, color, opacity, progress: 0 }; this.beams.push(beam); return beam; }
  clearBeams() { this.beams = []; }
  setBloom(value: boolean) { this.bloomTarget = value ? 1 : 0; if (this.reduced) this.bloom = this.bloomTarget; }
  quiet() { this.particles = []; this.motes = []; this.streams.clear(); this.rays = 0; this.ring = -1; this.rain = 0; }
  get active() { return this.particles.length > 0 || this.motes.length > 0 || this.streams.size > 0 || this.rays > 0 || this.ring >= 0 || this.rain > 0 || Math.abs(this.bloom - this.bloomTarget) > .001; }
  paint(now: number, dt: number, warm: boolean) {
    if (!this.geometry) return; this.paintBack(now, dt, warm); this.paintBloom(dt); this.paintFront(now, dt);
  }
  private paintBack(now: number, dt: number, warm: boolean) {
    const x = this.backdrop, g = this.geometry!, { width: W, height: H } = g; x.clearRect(0, 0, W, H); x.globalCompositeOperation = 'lighter'; x.lineCap = 'round';
    if (!this.reduced) for (const fall of this.falls) for (const streak of fall.streaks) {
      streak.t += dt * streak.speed; if (streak.t > 1) { streak.t -= 1; streak.u = Math.random(); }
      const from = fall.y + fall.h * streak.t, to = Math.min(fall.y + fall.h, from + fall.h * streak.length);
      x.strokeStyle = `rgba(190,225,255,${.28 * Math.sin(Math.PI * clamp(streak.t))})`; x.lineWidth = Math.max(1, fall.w * .06); x.beginPath(); x.moveTo(fall.x + fall.w * streak.u, from); x.lineTo(fall.x + fall.w * streak.u, to); x.stroke();
    }
    if (this.rays > .01) {
      const radius = Math.max(W, H) * .8; x.save(); x.translate(g.x + g.board / 2, g.y + g.board / 2); x.rotate(now / 9000);
      const shine = x.createRadialGradient(0, 0, g.board * .3, 0, 0, radius); shine.addColorStop(0, `rgba(255,214,110,${.36 * this.rays})`); shine.addColorStop(1, 'rgba(255,190,80,0)'); x.fillStyle = shine;
      for (let i = 0; i < 14; i++) { const angle = i / 14 * 6.283; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, radius, angle, angle + .2); x.fill(); } x.restore();
    }
    if (!this.reduced) for (const fly of this.flies) {
      fly.angle += rnd(-1, 1) * dt * 2; fly.x += Math.cos(fly.angle) * fly.speed * dt; fly.y += Math.sin(fly.angle) * fly.speed * dt - 2 * dt;
      if (fly.x < -9) fly.x = W + 8; if (fly.x > W + 9) fly.x = -8; if (fly.y < -9) fly.y = H; if (fly.y > H + 9) fly.y = -8;
      const opacity = (.5 + .5 * Math.sin(now / 700 + fly.phase)) * .8, radius = fly.radius * (warm ? 5.5 : 4), shine = x.createRadialGradient(fly.x, fly.y, 0, fly.x, fly.y, radius);
      shine.addColorStop(0, warm ? `rgba(255,236,160,${opacity})` : `rgba(190,255,220,${opacity})`); shine.addColorStop(1, 'transparent'); x.fillStyle = shine; x.fillRect(fly.x - radius, fly.y - radius, radius * 2, radius * 2);
    }
    x.globalCompositeOperation = 'source-over';
  }
  private paintBloom(dt: number) {
    this.bloom += clamp(this.bloomTarget - this.bloom, -dt * .9, dt * .7); if (this.reduced) this.bloom = this.bloomTarget;
    if (this.bloom === this.bloomShown) return; this.bloomShown = this.bloom;
    const x = this.bloomLayer, g = this.geometry!; x.clearRect(0, 0, g.width, g.height); if (this.bloom <= .01) return;
    for (const flower of this.blossoms) {
      const scale = clamp((this.bloom - flower.delay * .5) / .5), art = flower.pink ? this.pink : this.gold; if (scale <= 0 || !art.complete || !art.naturalWidth) continue;
      const side = flower.radius * 3.3 * Math.max(.01, back(scale)); x.save(); x.translate(flower.x, flower.y); x.rotate(flower.angle + (1 - scale) * 2); x.shadowColor = flower.pink ? '#ff9ad0' : '#ffcf6a'; x.shadowBlur = flower.radius * .9; x.drawImage(art, -side / 2, -side / 2, side, side); x.restore();
    }
  }
  private paintFront(now: number, dt: number) {
    const x = this.front, g = this.geometry!; x.clearRect(0, 0, g.width, g.height); x.globalCompositeOperation = 'lighter';
    if (this.rain > 0) { this.rain -= dt; if (Math.random() < dt * 42) { const beside = Math.random() < .72; this.petal(beside ? Math.random() < .35 ? rnd(0, g.x) : rnd(g.x + g.board, g.width) : rnd(0, g.width), -12, rnd(-16, 16), rnd(30, 80), 1.1); } }
    for (const beam of this.beams) if (beam.progress > 0) this.paintBeam(x, now, beam);
    if (this.ring >= 0 && this.ring <= 1) this.paintRing(x);
    for (const stream of this.streams.values()) { const from = stream.from(); if (!from) continue; stream.pending += dt * stream.rate; while (stream.pending >= 1) { stream.pending--; this.mote(from, stream.to(), stream.color, stream.scatter); } }
    this.motes = this.motes.filter(mote => (mote.time += dt) < mote.life);
    for (const mote of this.motes) for (let tail = 0; tail < 4; tail++) {
      const u = clamp(mote.time / mote.life - tail * .035), e = u * u * (3 - 2 * u), v = 1 - e, px = v * v * mote.x0 + 2 * v * e * mote.cx + e * e * mote.x1, py = v * v * mote.y0 + 2 * v * e * mote.cy + e * e * mote.y1;
      x.globalAlpha = Math.sin(Math.PI * clamp(u * .94 + .06)) * (1 - tail * .23); x.fillStyle = tail ? mote.color : '#fff'; x.beginPath(); x.arc(px, py, mote.radius * (1 - tail * .16), 0, 7); x.fill();
      if (!tail) { x.globalAlpha *= .3; x.fillStyle = mote.color; x.beginPath(); x.arc(px, py, mote.radius * 3, 0, 7); x.fill(); }
    }
    this.particles = this.particles.filter(particle => (particle.time += dt) < particle.life);
    for (const p of this.particles) {
      p.vy += p.gravity * dt; p.x += (p.vx + (p.sway ? Math.sin(now / 500 + p.sway) * 26 : 0)) * dt; p.y += p.vy * dt; const opacity = clamp((1 - p.time / p.life) * 2);
      if (!p.petal) { x.globalAlpha = opacity; x.fillStyle = p.color; x.beginPath(); x.arc(p.x, p.y, p.radius, 0, 7); x.fill(); x.globalAlpha = opacity * .3; x.beginPath(); x.arc(p.x, p.y, p.radius * 2.6, 0, 7); x.fill(); continue; }
      p.angle += p.spin * dt; if (p.sway) p.vy = Math.min(p.vy, 90); x.globalCompositeOperation = 'source-over'; x.globalAlpha = opacity * .95; x.save(); x.translate(p.x, p.y); x.rotate(p.angle); x.scale(1, .5 + .5 * Math.abs(Math.sin(now / 350 + p.sway))); x.fillStyle = p.color; x.beginPath(); x.ellipse(0, 0, p.radius, p.radius * .55, 0, 0, 7); x.fill(); x.restore(); x.globalCompositeOperation = 'lighter';
    }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  }
  private paintBeam(x: CanvasRenderingContext2D, now: number, beam: Beam) {
    const g = this.geometry!, source = beam.flower < 0, from = source ? g.gem : { x: g.x + g.board - 2, y: g.y + g.cell * (beam.flower * 2 + .486) }, to = source ? { x: g.x + 2, y: g.y + g.cell * 2.484 } : g.flowers[beam.flower];
    const width = Math.max(3, g.cell * (source ? .07 : .06)), end = from.x + (to.x - from.x) * clamp(beam.progress);
    for (const [size, opacity] of [[2.6, .16], [1.4, .4], [.5, .95]]) {
      x.globalAlpha = opacity * beam.opacity; x.strokeStyle = size < 1 ? '#fff' : beam.color; x.lineWidth = width * size; x.lineCap = 'round'; x.beginPath();
      for (let i = 0; i <= 14; i++) { const u = i / 14; x[i ? 'lineTo' : 'moveTo'](from.x + (end - from.x) * u, from.y + (to.y - from.y) * u + Math.sin(u * 9 - (this.reduced ? 0 : now / 90)) * width * .25 * Math.sin(u * Math.PI)); } x.stroke();
    }
    x.globalAlpha = 1;
  }
  private paintRing(x: CanvasRenderingContext2D) {
    const g = this.geometry!, half = g.frame * .5, left = g.x - half, right = g.x + g.board + half, top = g.y - half, side = g.board + g.frame, total = side * 2, head = total * 1.25 * smooth(this.ring);
    const at = (d: number, up: boolean): [number, number] => { const sign = up ? -1 : 1, middle = top + side / 2; return d < side / 2 ? [left, middle + sign * d] : d < side * 1.5 ? [left + d - side / 2, middle + sign * side / 2] : [right, middle + sign * (side / 2 - (d - side * 1.5))]; };
    for (const up of [true, false]) for (let i = 0; i < 70; i++) {
      const u = i / 70, d = head - u * total * .42; if (d < 0 || d > total) continue; const [px, py] = at(d, up), k = (1 - u) ** 2, radius = g.frame * (.35 + 1.15 * k), shine = x.createRadialGradient(px, py, 0, px, py, radius);
      shine.addColorStop(0, `rgba(255,250,220,${.5 * k})`); shine.addColorStop(.35, `rgba(255,208,105,${.26 * k})`); shine.addColorStop(1, 'rgba(255,180,60,0)'); x.fillStyle = shine; x.fillRect(px - radius, py - radius, radius * 2, radius * 2);
      if (i === 0 && Math.random() < .7) this.spark(px, py, '#ffe39a', 2, 70);
    }
  }
  state() { return { particles: this.particles.length, beams: this.beams.filter(beam => beam.progress > 0).length, motes: this.motes.length, streams: [...this.streams.keys()], rays: this.rays, ring: this.ring, bloom: this.bloom }; }
}
