import { FLAG_COUNTRIES, flagCountries, flagModeInfo, flagViewMode, type FlagMode, type FlagCountry, type FlagView } from '../../src/shared/flagBattle';
import { FlagRollPhysics, planFlagRoll, ROLL_PHYSICS_VERSION, type RollContact, type RollPlan } from './FlagRollPhysics';
import { flagBattleTimeline, FLAG_CELEBRATION_SECONDS } from './FlagBattleCues';

export const flagStageAsset = (id: string) => '/assets/flag-battle/flags/' + id.toLowerCase() + '.svg';
const TAU = Math.PI * 2;
const smooth = (t: number) => { const p = Math.min(1, Math.max(0, t)); return p * p * (3 - 2 * p); };
const MAX_PARTICLES = 520;
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Bit = { x: number; y: number; vx: number; vy: number; rot: number; spin: number; life: number; max: number; color: string; w: number; h: number; coin?: boolean };
type Ring = { x: number; y: number; age: number; max: number; color: string; grow: number };
type Squash = { nx: number; ny: number; amount: number; age: number };

/**
 * Canvas arena for Flag Battle. Effects follow physics events of the confirmed replay; they never
 * decide or reveal anything before the playhead reaches it.
 */
export class FlagStage {
  private images = new Map<string, HTMLImageElement>();
  private palettes = new Map<string, string[]>();
  private contacts: RollContact[] = [];
  private world = new FlagRollPhysics(93, true, e => this.contacts.push(e));
  private plan?: RollPlan;
  private labels: FlagCountry[] = flagCountries().map(c => c.id);
  private mode: FlagMode = 'classic';
  private seconds: number = flagModeInfo('classic').seconds;
  private last?: number;
  private clock = 0;
  private celebration = 0;
  private finished = false;
  private seenExits = 0;
  private sparks: Spark[] = [];
  private bits: Bit[] = [];
  private rings: Ring[] = [];
  private rimHits: { angle: number; strength: number; age: number }[] = [];
  private squash = new Map<number, Squash>();
  private shake = 0;
  private spotlight = 0;
  private party?: { won: boolean; age: number; coins: number };
  private motion = true;
  constructor(private canvas: HTMLCanvasElement) {
    for (const country of FLAG_COUNTRIES) {
      const image = new Image(); image.decoding = 'async'; image.src = flagStageAsset(country.id); this.images.set(country.id, image);
    }
  }
  reset(view?: FlagView, mode: FlagMode = 'classic') {
    this.mode = view ? flagViewMode(view) : mode; this.seconds = flagModeInfo(this.mode).seconds;
    const count = flagModeInfo(this.mode).count;
    this.last = undefined; this.celebration = 0; this.finished = false; this.seenExits = 0; this.party = undefined; this.spotlight = 0;
    this.clearEffects();
    this.plan = view ? planFlagRoll(view.seed, count) : undefined;
    this.world = new FlagRollPhysics(view?.seed ?? 93, !view, e => this.contacts.push(e), count);
    this.labels = flagCountries(this.mode).map(c => c.id);
    if (view && this.plan) for (const [i, body] of this.plan.order.entries()) this.labels[body] = view.order[i];
  }
  private clearEffects() { this.contacts = []; this.sparks = []; this.bits = []; this.rings = []; this.rimHits = []; this.squash.clear(); this.shake = 0; }
  /** Shared rounds seek to server presentation time; the solo frame clock is unchanged. */
  seek(seconds: number) {
    if (!this.plan) return;
    const elapsed = Math.max(0, seconds);
    const target = Math.min(this.plan.duration, elapsed / this.seconds * this.plan.duration);
    if (target > this.world.time) this.world.advance(target - this.world.time);
    if (elapsed >= this.seconds + FLAG_CELEBRATION_SECONDS) this.finish();
    else if (this.world.finished) this.celebration = Math.min(1, Math.max(0, (elapsed - this.seconds) / FLAG_CELEBRATION_SECONDS));
  }
  soundTimeline(selected: FlagCountry, won: boolean) { return this.plan ? flagBattleTimeline(this.plan, this.labels, selected, won, this.seconds) : []; }
  count() { return this.world.exits.length; }
  finish() {
    if (this.plan) this.world.restore(this.plan);
    this.finished = true; this.celebration = 1; this.seenExits = this.world.exits.length; this.contacts = []; this.spotlight = 0;
    this.sparks = []; this.rimHits = []; this.squash.clear(); this.shake = 0;
  }
  /** Winner celebration after a fully played round. Replays and restored results stay quiet. */
  celebrate(won: boolean) {
    if (!this.plan || !this.motion) return;
    this.party = { won, age: 0, coins: 0 };
    const winner = this.labels[this.plan.order.at(-1)!], colors = this.palette(winner);
    const { cx, cy, r } = this.frame();
    const count = won ? 150 : 70;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, speed = (won ? 260 : 170) * (.35 + Math.random());
      this.bit({ x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 80, rot: Math.random() * TAU, spin: (Math.random() - .5) * 14,
        life: 0, max: 1.4 + Math.random() * 1.1, color: won && i % 3 === 0 ? '#f2cb77' : colors[i % colors.length], w: r * .028 + Math.random() * 3, h: r * .016 + Math.random() * 2 });
    }
    this.rings.push({ x: cx, y: cy, age: 0, max: .9, color: won ? '#f2cb77' : '#d9f4e5', grow: r * 1.1 });
  }
  /** Visual acknowledgement of a newly chosen country while waiting for a round. */
  pulse(country: FlagCountry) {
    if (!this.motion) return;
    const id = this.labels.indexOf(country); if (id < 0) return;
    const b = this.world.bodies[id]; if (!b || b.escapedAt !== null) return;
    const { cx, cy, r } = this.frame();
    this.rings.push({ x: cx + b.x * r, y: cy + b.y * r, age: 0, max: .55, color: '#f2cb77', grow: this.world.radius * r * 2.4 });
  }
  getState() {
    return { physicsVersion: ROLL_PHYSICS_VERSION, count: this.world.count, radius: this.world.radius, simulatedTime: this.world.time, eliminated: this.count(),
      order: this.world.exits.map(e => this.labels[e.id]), winner: this.plan ? this.labels[this.plan.order.at(-1)!] : undefined,
      gap: this.world.gap, halfGap: this.world.halfGap, effects: this.sparks.length + this.bits.length + this.rings.length, celebrating: !!this.party,
      bodies: this.world.bodies.map(b => ({ country: this.labels[b.id], x: b.x, y: b.y, angle: b.angle, escaped: b.escapedAt !== null })) };
  }
  tick(now: number, running: boolean, selected: FlagCountry, motion: boolean) {
    const dt = this.last === undefined ? 0 : Math.max(0, Math.min(.1, (now - this.last) / 1000));
    this.last = now; this.motion = motion;
    if (!motion) { this.clearEffects(); this.party = undefined; }
    const before = this.world.time;
    if (motion && !this.finished) {
      if (running && this.plan) this.world.advance(dt * this.plan.duration / this.seconds);
      else if (!this.plan) this.world.advance(dt);
    }
    if (this.world.finished && !this.finished) {
      this.celebration = Math.min(1, this.celebration + dt / FLAG_CELEBRATION_SECONDS);
      if (this.celebration === 1) this.finished = true;
    }
    this.clock += dt;
    this.absorb(before);
    this.updateEffects(dt, running);
    this.paint(selected, running);
    return { eliminated: this.count(), finished: this.finished, playhead: this.plan ? this.world.time / this.plan.duration * this.seconds + this.celebration * FLAG_CELEBRATION_SECONDS : 0 };
  }
  private frame() {
    const rect = this.canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height, cx: rect.width / 2, cy: rect.height / 2, r: Math.min(rect.width, rect.height) * .405 };
  }
  private palette(id: string) {
    const known = this.palettes.get(id); if (known) return known;
    const img = this.images.get(id), fallback = ['#d9f4e5', '#f2cb77', '#f69575'];
    if (!img?.complete || !img.naturalWidth) return fallback;
    try {
      const probe = document.createElement('canvas'); probe.width = 12; probe.height = 8;
      const p = probe.getContext('2d', { willReadFrequently: true })!; p.drawImage(img, 0, 0, 12, 8);
      const data = p.getImageData(0, 0, 12, 8).data, counts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const key = [data[i], data[i + 1], data[i + 2]].map(v => Math.round(v / 51) * 51).join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => 'rgb(' + k + ')');
      this.palettes.set(id, colors.length ? colors : fallback); return this.palettes.get(id)!;
    } catch { return fallback; }
  }
  private spark(s: Spark) { if (this.sparks.length < MAX_PARTICLES) this.sparks.push(s); }
  private bit(b: Bit) { if (this.bits.length < MAX_PARTICLES) this.bits.push(b); }
  /** Turn physics events of the last frame into effects. Large seeks only keep the freshest events. */
  private absorb(before: number) {
    const fresh = this.contacts.filter(e => e.time > Math.max(before, this.world.time - .2)); this.contacts = [];
    if (!this.motion || this.finished) { this.seenExits = this.world.exits.length; return; }
    const { cx, cy, r } = this.frame();
    for (const e of fresh) {
      const x = cx + e.x * r, y = cy + e.y * r, k = Math.min(1.6, e.strength), wall = e.kind === 'wall';
      const n = Math.round(2 + k * (wall ? 5 : 7));
      for (let i = 0; i < n; i++) {
        const side = Math.random() < .5 ? -1 : 1, spread = (Math.random() - .5) * 1.4;
        const dirX = wall ? -e.nx : -e.ny * side, dirY = wall ? -e.ny : e.nx * side;
        const a = Math.atan2(dirY, dirX) + spread, speed = (70 + Math.random() * 160) * (.5 + k * .5);
        this.spark({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0, max: .18 + Math.random() * .26,
          color: wall ? (Math.random() < .5 ? '#d9f4e5' : '#9df0d2') : (Math.random() < .4 ? '#ffffff' : '#f6e6b0'), size: .8 + Math.random() * 1.4 * k });
      }
      for (const id of [e.a, e.b]) if (id >= 0) this.squash.set(id, { nx: id === e.a ? e.nx : -e.nx, ny: id === e.a ? e.ny : -e.ny, amount: Math.min(.2, .05 + e.strength * .09), age: 0 });
      if (wall) this.rimHits.push({ angle: Math.atan2(e.y, e.x), strength: k, age: 0 });
      if (e.strength > .95) this.shake = Math.min(4, this.shake + (e.strength - .8) * 2.2);
    }
    if (this.rimHits.length > 24) this.rimHits.splice(0, this.rimHits.length - 24);
    for (let i = this.seenExits; i < this.world.exits.length; i++) {
      const exit = this.world.exits[i];
      if (exit.time < this.world.time - .35) continue;
      const id = this.labels[exit.id], colors = this.palette(id), x = cx + exit.x * r, y = cy + exit.y * r;
      const out = Math.atan2(exit.y, exit.x);
      for (let j = 0; j < 34; j++) {
        const a = out + (Math.random() - .5) * 2.2, speed = 90 + Math.random() * 220;
        this.bit({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, rot: Math.random() * TAU, spin: (Math.random() - .5) * 18,
          life: 0, max: .7 + Math.random() * .6, color: colors[j % colors.length], w: 2.5 + Math.random() * 3, h: 1.5 + Math.random() * 2 });
      }
      this.rings.push({ x, y, age: 0, max: .5, color: '#f69575', grow: this.world.radius * r * 3 });
      this.shake = Math.min(4, this.shake + 1.6);
    }
    this.seenExits = this.world.exits.length;
  }
  private updateEffects(dt: number, running: boolean) {
    for (const s of this.sparks) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 1 - 5 * dt; s.vy *= 1 - 5 * dt; }
    this.sparks = this.sparks.filter(s => s.life < s.max);
    for (const b of this.bits) { b.life += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += (b.coin ? 420 : 260) * dt; b.vx *= 1 - 1.6 * dt; b.rot += b.spin * dt; }
    this.bits = this.bits.filter(b => b.life < b.max);
    for (const ring of this.rings) ring.age += dt;
    this.rings = this.rings.filter(ring => ring.age < ring.max);
    for (const hit of this.rimHits) hit.age += dt;
    this.rimHits = this.rimHits.filter(hit => hit.age < .5);
    for (const [id, s] of this.squash) { s.age += dt; if (s.age > .25) this.squash.delete(id); }
    this.shake *= Math.exp(-dt * 12); if (this.shake < .05) this.shake = 0;
    const remaining = this.world.count - this.world.exits.length;
    const target = running && this.plan && remaining <= 2 && !this.world.finished ? 1 : 0;
    this.spotlight += (target - this.spotlight) * Math.min(1, dt * 4);
    const party = this.party;
    if (party) {
      party.age += dt;
      if (party.won && party.age < 2.6) {
        const { width, r } = this.frame();
        party.coins += dt * 34;
        while (party.coins >= 1) {
          party.coins--;
          this.bit({ x: Math.random() * width, y: -10, vx: (Math.random() - .5) * 40, vy: 40 + Math.random() * 80, rot: Math.random() * TAU, spin: 4 + Math.random() * 8,
            life: 0, max: 2.4, color: '#f2cb77', w: r * .045, h: r * .045, coin: true });
        }
      }
    }
  }
  private paint(selected: FlagCountry, running: boolean) {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const c = this.canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, rect.width, rect.height);
    const { cx, cy, r } = this.frame();
    const shakeX = this.shake ? (Math.random() - .5) * this.shake : 0, shakeY = this.shake ? (Math.random() - .5) * this.shake : 0;
    c.save(); c.translate(shakeX, shakeY);
    this.paintFloor(c, cx, cy, r);
    this.paintRim(c, cx, cy, r);
    this.paintGate(c, cx, cy, r);
    if (this.spotlight > .01) this.paintDarkness(c, rect.width, rect.height, cx, cy, r);
    this.paintParty(c, cx, cy, r);
    this.paintBodies(c, cx, cy, r, selected, running);
    this.paintEffects(c);
    c.restore();
  }
  private paintFloor(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const glow = c.createRadialGradient(cx, cy - r * .2, 0, cx, cy, r * 1.25);
    glow.addColorStop(0, '#1b4f4d'); glow.addColorStop(.62, '#123a3c'); glow.addColorStop(.86, '#0e2c32'); glow.addColorStop(1, '#0a202800');
    c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, r * 1.25, 0, TAU); c.fill();
    // Floor rings and a slowly turning compass of ticks.
    c.strokeStyle = '#5c8f8526'; c.lineWidth = 1;
    for (const radius of [.78, .55, .3]) { c.beginPath(); c.arc(cx, cy, r * radius, 0, TAU); c.stroke(); }
    const turn = this.clock * .05;
    c.strokeStyle = '#6ea59a30';
    for (let i = 0; i < 24; i++) {
      const a = turn + i / 24 * TAU, inner = i % 6 === 0 ? .7 : .74;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r * inner, cy + Math.sin(a) * r * inner); c.lineTo(cx + Math.cos(a) * r * .78, cy + Math.sin(a) * r * .78); c.stroke();
    }
    // Stadium lights: one bulb per country, lit while it is still in the arena.
    const total = this.world.count, alive = total - this.world.exits.length, bulbs = Math.max(24, total);
    for (let i = 0; i < bulbs; i++) {
      const a = -Math.PI / 2 + i / bulbs * TAU, lit = i < Math.round(alive / total * bulbs);
      const x = cx + Math.cos(a) * r * 1.13, y = cy + Math.sin(a) * r * 1.13;
      if (lit) {
        c.fillStyle = '#9df0d233'; c.beginPath(); c.arc(x, y, 3.4, 0, TAU); c.fill();
        c.fillStyle = '#c9f7e4'; c.beginPath(); c.arc(x, y, 1.4, 0, TAU); c.fill();
      } else { c.fillStyle = '#f6957555'; c.beginPath(); c.arc(x, y, 1.1, 0, TAU); c.fill(); }
    }
  }
  private paintRim(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const gap = this.world.gap, width = Math.max(3, r * .026);
    // The gate closes behind the winner during the celebration.
    const half = this.world.halfGap * (1 - smooth(this.celebration));
    if (half < Math.PI) {
      const start = gap + half, end = gap + TAU - half;
      c.lineCap = 'round';
      c.strokeStyle = '#74d8b722'; c.lineWidth = width * 4; c.beginPath(); c.arc(cx, cy, r, start, end); c.stroke();
      c.strokeStyle = '#74d8b744'; c.lineWidth = width * 2; c.beginPath(); c.arc(cx, cy, r, start, end); c.stroke();
      c.strokeStyle = '#d9f4e5'; c.lineWidth = width; c.beginPath(); c.arc(cx, cy, r, start, end); c.stroke();
      c.strokeStyle = '#ffffff88'; c.lineWidth = Math.max(1, width * .3); c.beginPath(); c.arc(cx, cy, r - width * .15, start, end); c.stroke();
    }
    c.globalCompositeOperation = 'lighter';
    for (const hit of this.rimHits) {
      const t = hit.age / .5, fade = (1 - t) * (1 - t), spread = .05 + t * .5;
      c.strokeStyle = `rgba(190,255,230,${.7 * fade * Math.min(1, hit.strength)})`; c.lineWidth = width * (2.2 - t);
      c.beginPath(); c.arc(cx, cy, r, hit.angle - .06, hit.angle + .06); c.stroke();
      c.lineWidth = width * 1.2;
      for (const side of [-1, 1]) { c.beginPath(); c.arc(cx, cy, r, hit.angle + side * spread - .04, hit.angle + side * spread + .04); c.stroke(); }
    }
    c.globalCompositeOperation = 'source-over';
  }
  private paintGate(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const gap = this.world.gap, half = this.world.halfGap;
    const closing = 1 - smooth(this.celebration);
    if (half <= 0 || closing <= .01) return;
    const heat = Math.min(1, .45 + half * .9) * closing;
    c.lineCap = 'round';
    c.strokeStyle = `rgba(246,149,117,${.18 * heat})`; c.lineWidth = r * .07; c.beginPath(); c.arc(cx, cy, r * 1.04, gap - half, gap + half); c.stroke();
    c.strokeStyle = `rgba(246,149,117,${.85 * heat})`; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r * 1.065, gap - half, gap + half); c.stroke();
    if (half < Math.PI) {
      // Chevrons run outward through the gate.
      c.strokeStyle = '#ffb59b'; c.lineWidth = 1.6;
      const span = Math.min(half * .6, .18);
      for (let k = 0; k < 3; k++) {
        const phase = (this.clock * .9 + k / 3) % 1, rr = r * (1.0 + phase * .2), alpha = Math.sin(phase * Math.PI) * heat;
        c.globalAlpha = alpha * .8;
        c.beginPath(); c.moveTo(cx + Math.cos(gap - span) * rr, cy + Math.sin(gap - span) * rr);
        c.lineTo(cx + Math.cos(gap) * (rr + r * .05), cy + Math.sin(gap) * (rr + r * .05));
        c.lineTo(cx + Math.cos(gap + span) * rr, cy + Math.sin(gap + span) * rr); c.stroke();
      }
      c.globalAlpha = 1;
      for (const side of [-1, 1]) {
        const a = gap + side * half, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        const halo = c.createRadialGradient(x, y, 0, x, y, r * .07);
        halo.addColorStop(0, `rgba(255,190,160,${.9 * heat})`); halo.addColorStop(1, 'rgba(246,149,117,0)');
        c.fillStyle = halo; c.beginPath(); c.arc(x, y, r * .07, 0, TAU); c.fill();
        c.fillStyle = '#fff1e9'; c.beginPath(); c.arc(x, y, Math.max(2.5, r * .016), 0, TAU); c.fill();
      }
    }
  }
  private paintDarkness(c: CanvasRenderingContext2D, width: number, height: number, cx: number, cy: number, r: number) {
    c.save();
    const outer = Math.min(Math.hypot(width, height) / 2, r * 1.45), dim = .5 * this.spotlight;
    const shade = c.createRadialGradient(cx, cy, r * .2, cx, cy, outer);
    shade.addColorStop(0, `rgba(3,14,18,${dim})`); shade.addColorStop(.72, `rgba(3,14,18,${dim})`); shade.addColorStop(1, 'rgba(3,14,18,0)');
    c.fillStyle = shade;
    c.beginPath(); c.arc(cx, cy, outer, 0, TAU);
    const alpha = this.world.interpolation;
    for (const b of this.world.bodies) {
      if (b.escapedAt !== null) continue;
      const x = cx + (b.previousX + (b.x - b.previousX) * alpha) * r, y = cy + (b.previousY + (b.y - b.previousY) * alpha) * r;
      c.moveTo(x + this.world.radius * r * 2.4, y); c.arc(x, y, this.world.radius * r * 2.4, 0, TAU, true);
    }
    c.fill('evenodd'); c.restore();
  }
  private paintParty(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const p = smooth(this.celebration);
    if (!this.world.finished || !this.plan || p < .05) return;
    const won = this.party?.won ?? false, grow = this.party ? smooth(this.party.age / .6) : this.finished ? .6 : p;
    const turn = this.motion ? this.clock * .25 : 0, rays = 14, length = r * (.55 + grow * .45);
    c.save(); c.translate(cx, cy); c.rotate(turn); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rays; i++) {
      const a = i / rays * TAU, w = TAU / rays * .32;
      const g = c.createRadialGradient(0, 0, r * .1, 0, 0, length);
      g.addColorStop(0, won ? 'rgba(242,203,119,.32)' : 'rgba(217,244,229,.2)'); g.addColorStop(1, 'rgba(242,203,119,0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, length, a - w, a + w); c.closePath(); c.fill();
    }
    c.restore();
    const halo = c.createRadialGradient(cx, cy, r * .12, cx, cy, r * .5);
    halo.addColorStop(0, won ? 'rgba(242,203,119,.35)' : 'rgba(217,244,229,.22)'); halo.addColorStop(1, 'rgba(242,203,119,0)');
    c.fillStyle = halo; c.beginPath(); c.arc(cx, cy, r * .5, 0, TAU); c.fill();
  }
  private paintBodies(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, selected: FlagCountry, running: boolean) {
    const alpha = this.world.finished ? 1 : this.world.interpolation;
    const p = smooth(this.celebration);
    const tailScale = (this.plan?.duration ?? this.seconds) / this.seconds;
    const order = [...this.world.bodies].sort((a, b) => Number(this.labels[a.id] === selected) - Number(this.labels[b.id] === selected));
    for (const b of order) {
      const tail = this.world.finished ? this.celebration * FLAG_CELEBRATION_SECONDS * tailScale : 0;
      const age = b.escapedAt === null ? 0 : this.world.time - b.escapedAt + tail;
      if (b.escapedAt !== null && (age > .6 || this.finished)) continue;
      let x = b.previousX + (b.x - b.previousX) * alpha, y = b.previousY + (b.y - b.previousY) * alpha;
      let angle = b.previousAngle + (b.angle - b.previousAngle) * alpha;
      if (b.escapedAt !== null) { x += b.vx * tail; y += b.vy * tail + .325 * tail * tail; angle += b.spin * tail; }
      let size = this.world.radius;
      if (b.escapedAt === null && this.world.finished) { x *= 1 - p; y *= 1 - p; size += (.24 - size) * p; angle *= 1 - p; }
      const fade = b.escapedAt === null ? 1 : Math.max(0, 1 - age / .6);
      const px = cx + x * r, py = cy + y * r, radius = size * r * (b.escapedAt === null ? 1 : 1 + age * .5);
      if (this.motion && running && !this.world.finished) this.paintTrail(c, px, py, b.vx, b.vy, radius, b.escapedAt !== null, fade);
      c.globalAlpha = fade;
      this.ball(c, b.id, px, py, radius, angle, this.labels[b.id] === selected);
      c.globalAlpha = 1;
    }
  }
  private paintTrail(c: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, radius: number, escaping: boolean, fade: number) {
    const speed = Math.hypot(vx, vy); if (speed < 1.05 && !escaping) return;
    const length = Math.min(radius * 5, radius * (speed - .7) * 2.6), ux = vx / speed, uy = vy / speed;
    const g = c.createLinearGradient(x - ux * length, y - uy * length, x, y);
    g.addColorStop(0, 'rgba(157,240,210,0)'); g.addColorStop(1, escaping ? `rgba(255,181,155,${.5 * fade})` : 'rgba(157,240,210,.22)');
    c.strokeStyle = g; c.lineCap = 'round'; c.lineWidth = radius * 1.5;
    c.beginPath(); c.moveTo(x - ux * length, y - uy * length); c.lineTo(x, y); c.stroke();
  }
  private ball(c: CanvasRenderingContext2D, id: number, x: number, y: number, size: number, angle: number, selected: boolean) {
    const country = this.labels[id], s = this.squash.get(id);
    c.save(); c.translate(x, y);
    // Contact shadow on the floor.
    c.fillStyle = 'rgba(0,8,12,.35)'; c.beginPath(); c.ellipse(size * .12, size * .9, size * .85, size * .3, 0, 0, TAU); c.fill();
    if (selected) {
      const pulse = .75 + Math.sin(this.clock * 5) * .25;
      const aura = c.createRadialGradient(0, 0, size, 0, 0, size * 2.1);
      aura.addColorStop(0, `rgba(242,203,119,${.55 * pulse})`); aura.addColorStop(1, 'rgba(242,203,119,0)');
      c.fillStyle = aura; c.beginPath(); c.arc(0, 0, size * 2.1, 0, TAU); c.fill();
    }
    if (s && this.motion) {
      const k = s.amount * Math.exp(-s.age * 20) * Math.cos(s.age * 34), a = Math.atan2(s.ny, s.nx);
      c.rotate(a); c.scale(1 - k, 1 + k * .55); c.rotate(-a);
    }
    c.fillStyle = selected ? '#f2cb77' : '#f5f0df'; c.beginPath(); c.arc(0, 0, size + (selected ? 2.2 : 1.2), 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, size, 0, TAU); c.clip();
    c.fillStyle = '#20403f'; c.fillRect(-size, -size, size * 2, size * 2);
    const img = this.images.get(country);
    c.rotate(angle);
    if (img?.complete && img.naturalWidth) c.drawImage(img, -size * 1.5, -size, size * 3, size * 2);
    c.restore();
    // Glass sphere: lit from the upper left, darker toward the rim.
    const shade = c.createRadialGradient(-size * .35, -size * .4, size * .05, 0, 0, size * 1.02);
    shade.addColorStop(0, 'rgba(255,255,255,.34)'); shade.addColorStop(.38, 'rgba(255,255,255,.05)');
    shade.addColorStop(.72, 'rgba(0,12,18,.08)'); shade.addColorStop(1, 'rgba(0,12,18,.5)');
    c.fillStyle = shade; c.beginPath(); c.arc(0, 0, size, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,.72)'; c.beginPath(); c.ellipse(-size * .36, -size * .48, size * .26, size * .13, -.55, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(157,240,210,.35)'; c.lineWidth = Math.max(1, size * .06);
    c.beginPath(); c.arc(0, 0, size * .9, .15, 1.35); c.stroke();
    c.restore();
  }
  private paintEffects(c: CanvasRenderingContext2D) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const t = s.life / s.max; c.globalAlpha = 1 - t; c.fillStyle = s.color;
      c.beginPath(); c.arc(s.x, s.y, s.size * (1 - t * .5), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    for (const ring of this.rings) {
      const t = ring.age / ring.max, e = 1 - (1 - t) * (1 - t);
      c.strokeStyle = ring.color; c.globalAlpha = (1 - t) * .8; c.lineWidth = 2.5 * (1 - t) + .5;
      c.beginPath(); c.arc(ring.x, ring.y, 4 + ring.grow * e, 0, TAU); c.stroke();
    }
    c.restore();
    for (const b of this.bits) {
      const t = b.life / b.max; c.globalAlpha = t > .7 ? (1 - t) / .3 : 1;
      c.save(); c.translate(b.x, b.y); c.rotate(b.rot);
      if (b.coin) {
        const squeeze = Math.abs(Math.cos(b.rot * 1.3));
        c.fillStyle = '#c99a3f'; c.beginPath(); c.ellipse(0, 0, b.w / 2 * squeeze + .6, b.h / 2, 0, 0, TAU); c.fill();
        c.fillStyle = '#f6d98f'; c.beginPath(); c.ellipse(0, 0, b.w / 2.6 * squeeze + .3, b.h / 2.6, 0, 0, TAU); c.fill();
      } else { c.fillStyle = b.color; c.fillRect(-b.w / 2, -b.h / 2 * Math.abs(Math.cos(b.rot * 2)), b.w, b.h * Math.abs(Math.cos(b.rot * 2)) + .5); }
      c.restore();
    }
    c.globalAlpha = 1;
  }
}
