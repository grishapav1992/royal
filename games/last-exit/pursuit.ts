import { clamp, mix, rng } from './scene-kit';
import { GAP, MODELS, TrafficDeck, wheelTurn, type Model } from './traffic';
/** Cosmetic rigid bodies on the road plane. Nothing here reads a deadline, a seed or an outcome. */
export type State = 'drive' | 'spin' | 'air' | 'slide';
export type Car = {
 id: number;
 kind: 'cop' | 'civ';
 model: Model;
 side: number;
 tint: number;
 x: number;
 z: number;
 y: number;
 vx: number;
 v: number;
 vy: number;
 yaw: number;
 w: number;
 roll: number;
 wr: number;
 state: State;
 tx: number;
 tz: number;
 hold: number;
 hw: number;
 brake: number;
 lights: number;
 burn: number;
 damage: number;
 cool: number;
 age: number;
 nose: number;
 hop: boolean;
 free: boolean;
 len: number;
 mass: number;
 /** Visible wheel angle and the road speed under it. */
 turn: number;
 rev: number;
 /** Distance at which a calm driver pulls over for the sirens, and the indicator time left. */
 pull: number;
 blink: number;
};
export type Prop = {
 kind: 'board' | 'cone';
 x: number;
 z: number;
 w: number;
 broken: boolean;
};
export type Hero = {
 x: number;
 vx: number;
 hw: number;
 z: number;
 bias: number;
};
export type Fx = {
 hit(x: number, y: number, z: number, power: number, side: number): void;
 scrape(x: number, z: number, side: number, power: number): void;
 contact(c: Car, power: number): void;
 wreck(c: Car): void;
 boom(x: number, z: number, size: number, v: number): void;
 smash(p: Prop, v: number): void;
 hero(power: number): void;
};
export const LEN = .44, WALL = 1.13, GRAV = 3.1;
type Ev = {
 type: string;
 t: number;
 c?: Car;
 d?: Car;
 side: number;
 done: boolean;
};
export class Pursuit {
 cars: Car[] = [];
 props: Prop[] = [];
 laneX = .565;
 private next = 1.4;
 private ev?: Ev;
 private id = 0;
 private r = rng(1);
 private respawn = [0, 0];
 private bag: string[] = [];
 private deck = new TrafficDeck();
 private road = 0;
 /** Location of the chase: it only selects the mix of vehicles. */
 zone = 0;
 /** Vehicles whose pictures are painted; a saloon stands in for the rest. */
 painted: (model: Model) => boolean = () => true;
 slow = 0; /** Endings stage their own flips. */
 calm = false;
 private flow = 0;
 private lastSlow = -9;
 private time = 0;
 count = 0;
 constructor(private fx: Fx) { }
 reset(seed: number) { this.cars = []; this.props = []; this.next = .5; this.ev = undefined; this.r = rng(seed * 7919 + 13); this.respawn = [0, 0]; this.bag = []; this.deck.reset(); this.road = .2; this.slow = 0; this.lastSlow = -9; this.time = 0; this.count = 0; this.calm = false; }
 rand(a = 0, b = 1) { return a + this.r() * (b - a); }
 make(kind: 'cop' | 'civ', o: Partial<Car>): Car { const c: Car = { id: ++this.id, kind, side: 0, tint: 0, x: 0, z: 1, y: 0, vx: 0, v: 0, vy: 0, yaw: 0, w: 0, roll: 0, wr: 0, state: 'drive', tx: 0, tz: 1.06, hold: 0, hw: .13, brake: 0, lights: 1, burn: 0, damage: 0, cool: 0, age: 0, nose: 0, hop: false, free: false, model: kind === 'cop' ? 'patrol' : 'coupe', len: LEN, mass: 1, turn: 0, rev: o.v ?? 0, pull: 0, blink: 0, ...o }; this.cars.push(c); return c; }
 /** Any road user; a heavy one keeps to the outer lanes. */
 private civ(model: Model, hw: number, o: Partial<Car>) { if (!this.painted(model))
  model = 'sedan'; const m = MODELS[model]; return this.make('civ', { model, hw: hw * m.wide, len: m.len, mass: m.mass, tint: Math.floor(this.r() * m.tints), ...o }); }
 private outer(hw: number) { return Math.min(.84, WALL - hw - .03); }
 cop(side: number) { return this.cars.find(c => c.kind === 'cop' && c.side === side && c.state === 'drive'); }
 /** Lost patrols are replaced from behind the camera. */
 ensure(flow: number, hw: number, dt: number, at = 1.06) { for (const i of [0, 1]) {
  const side = i ? 1 : -1;
  if (this.cop(side)) {
   this.respawn[i] = 0;
   continue;
  }
  this.respawn[i] += dt;
  if (this.respawn[i] > 1.25)
   this.make('cop', { side, x: side * this.laneX, z: .58, v: flow + 5, tx: side * this.laneX, tz: at, hw });
 } }
 private big() { if (this.time - this.lastSlow > 6.5) {
  this.lastSlow = this.time;
  this.slow = .6;
 } }
 trip(c: Car, dir: number, power = 1) { if (c.state === 'air' || MODELS[c.model].rigid)
  return; c.state = 'air'; c.vy = this.rand(.75, 1.05) * power; c.wr = (dir || 1) * this.rand(7, 10) * power; c.lights = 0; c.yaw = (Math.sign(c.yaw) || dir || 1) * 1.55; c.w = 0; c.hop = true; c.v = Math.max(c.v, this.flow - 2.4); this.count++; this.fx.wreck(c); }
 spin(c: Car, w: number) { if (c.state !== 'drive' || MODELS[c.model].rigid)
  return; c.state = 'spin'; c.w = w; c.brake = 1; }
 private damage(c: Car, s: number, dir: number) { if (this.calm && c.free)
  return; c.damage += s; if (c.state === 'drive' && (s > .85 || c.damage > 2.4))
  this.spin(c, dir * this.rand(2.2, 4) * Math.min(1.4, s + .3)); }
 private collide(a: Car, b: Car) {
  if (Math.abs(a.y - b.y) > .3 || this.calm && (a.kind === 'civ' || b.kind === 'civ' || a.free || b.free))
   return;
  const ha = a.hw * (1 + .9 * Math.abs(Math.sin(a.yaw))), hb = b.hw * (1 + .9 * Math.abs(Math.sin(b.yaw)));
  const dx = b.x - a.x, dz = b.z - a.z, W = ha + hb, L = (dz > 0 ? a.len : b.len) * (1 - .25 * Math.abs(Math.sin(a.yaw))), px = W - Math.abs(dx), pz = L - Math.abs(dz);
  if (px <= 0 || pz <= 0)
   return;
  const sx = Math.sign(dx) || 1, sz = Math.sign(dz) || 1, M = a.mass + b.mass, ka = b.mass / M, kb = a.mass / M;
  if (px / W < pz / L) {
   a.x -= sx * px * ka;
   b.x += sx * px * kb;
   const vr = (a.vx - b.vx) * sx;
   if (vr <= 0)
    return;
   const j = vr * 1.45;
   a.vx -= sx * j * ka;
   b.vx += sx * j * kb;
   const s = vr / 1.1;
   if (a.cool <= 0 || b.cool <= 0) {
    this.fx.hit((a.x + b.x) / 2, .15, (a.z + b.z) / 2, s, sx);
    a.cool = b.cool = .16;
   }
   a.w -= sx * sz * s * .9;
   b.w += sx * sz * s * .9;
   this.damage(a, s, -sx);
   this.damage(b, s, sx);
  }
  else {
   a.z -= sz * pz * ka;
   b.z += sz * pz * kb;
   const vr = (a.v - b.v) * sz;
   if (vr <= 0)
    return;
   const j = vr * 1.3;
   a.v -= sz * j * ka;
   b.v += sz * j * kb;
   const s = vr / 6.5;
   if (a.cool <= 0 || b.cool <= 0) {
    this.fx.hit((a.x + b.x) / 2, .17, (a.z + b.z) / 2, s * 1.2, sx);
    a.cool = b.cool = .16;
   }
   const off = dx / W;
   a.w -= off * s * 4;
   b.w += off * s * 4 + this.rand(-1, 1) * s;
   a.brake = Math.max(a.brake, a.kind === 'civ' ? 1 : 0);
   b.brake = Math.max(b.brake, b.kind === 'civ' ? 1 : 0);
   a.vx -= off * s * .8 / a.mass + (a.kind === 'cop' ? this.rand(-.2, .2) * s : 0);
   b.vx += off * s * .8 / b.mass;
   this.damage(a, s, -sx);
   this.damage(b, s, sx);
   if (s > 1.15 && !this.calm) {
    for (const c of [a, b])
     if (c.state !== 'air' && this.rand() < .85)
      this.trip(c, c === a ? -sx : sx, clamp(s, .8, 1.35));
    if (s > (a.mass + b.mass > 3 ? 1.75 : 1.4))
     this.fx.boom((a.x + b.x) / 2, Math.max(a.z, b.z), .8, Math.max(a.v, b.v));
    this.big();
   }
  }
 }
 private heroCollide(h: Hero, c: Car, flow: number) {
  if (c.y > .3)
   return;
  const hc = c.hw * (1 + .9 * Math.abs(Math.sin(c.yaw))), dx = c.x - h.x, dz = c.z - h.z, W = h.hw + hc, px = W - Math.abs(dx), L = dz > 0 ? LEN : c.len, pz = L - Math.abs(dz);
  if (px <= 0 || pz <= 0)
   return;
  const sx = Math.sign(dx) || 1;
  const heavy = MODELS[c.model].rigid;
  if (px / W < pz / L || dz < -.1) {
   const vr = (h.vx - c.vx) * sx;
   c.x += sx * px * (heavy ? .15 : .8);
   h.x -= sx * px * (heavy ? .85 : .2);
   if (vr <= 0)
    return;
   const s = vr / 1;
   c.vx += sx * vr * 1.15 / c.mass;
   h.vx -= sx * vr * (heavy ? 1.3 : .42);
   if (c.cool <= 0) {
    this.fx.hit(h.x + sx * h.hw, .14, h.z - .02, s, sx);
    this.fx.hero(s);
    c.cool = .14;
   }
   c.w += sx * s * .4;
   c.damage += s * .5;
   if (c.state === 'drive' && s > 1.5)
    this.spin(c, sx * 3);
  }
  else if (heavy) { // the coupe glances off a truck and slides past its corner
   c.z = h.z + LEN;
   c.v = Math.max(c.v, flow - 1.5);
   c.brake = 1;
   h.vx -= sx * 1.9;
   h.x -= sx * px * .25;
   if (c.cool <= 0) {
    this.fx.hit((h.x + c.x) / 2, .18, h.z + .2, 1, sx);
    this.fx.hero(1.2);
    c.cool = .3;
   }
  }
  else { // the coupe rams a patrol from behind
   c.z = h.z + LEN;
   const s = clamp((flow - c.v) / 6 + .7, .7, 2);
   c.v = flow + 2.3 * s;
   c.vx += (dx / W || .3) * 1.0 * s + sx * .42;
   this.fx.hit((h.x + c.x) / 2, .18, h.z + .2, s * 1.3, sx);
   this.fx.hero(s * 1.4);
   c.w += sx * (2.2 + s);
   if (c.state === 'drive')
    c.state = 'spin';
   c.brake = 0;
   c.damage += s;
   if (s > .85 && c.state !== 'air') {
    this.trip(c, sx, .95);
    this.big();
   }
   c.cool = .4;
  }
 }
 private event(dt: number, h: Hero, flow: number, value: number) {
  h.bias = 0;
  if (!this.ev) {
   this.next -= dt;
   if (this.next > 0)
    return;
   const heat = value >= 4 ? 2 : value >= 2 ? 1 : 0, menu = [['swipe', 'traffic', 'wall', 'board', 'block'], ['wall', 'pincer', 'block', 'traffic', 'board', 'pileup'], ['block', 'pincer', 'wall', 'traffic', 'board', 'pileup']][heat];
   if (!this.bag.length) {
    this.bag = [...menu];
    for (let i = this.bag.length - 1; i > 0; i--) {
     const j = Math.floor(this.r() * (i + 1));
     [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
   }
   const L = this.cop(-1), R = this.cop(1);
   if (!L || !R) {
    this.next = .3;
    return;
   }
   const side = this.r() < .5 ? -1 : 1;
   this.ev = { type: this.bag.pop()!, t: 0, c: side < 0 ? L : R, d: side < 0 ? R : L, side, done: false };
   this.start(this.ev, flow, h);
  }
  const e = this.ev;
  e.t += dt;
  const c = e.c!, t = e.t, s = e.side, lane = this.laneX;
  const end = (gap = 0) => { this.ev = undefined; const heat = value >= 4 ? 2 : value >= 2 ? 1 : 0; this.next = gap + [.75, .5, .28][heat] * this.rand(.7, 1.5); for (const k of this.cars)
   if (k.kind === 'cop' && k.state === 'drive') {
    k.tx = k.side * lane;
    k.tz = 1.06;
    k.hold = 0;
    k.nose = 0;
    k.brake = 0;
   } };
  if (c.state !== 'drive' && (e.type !== 'traffic' && e.type !== 'pileup')) {
   if (t > 9 || !this.cars.includes(c) || c.age > 0 && (e as any).out > 0.5) {
    end();
    return;
   }
   (e as any).out = ((e as any).out ?? 0) + dt;
  }
  switch (e.type) {
   case 'swipe': {
    const contact = h.x + s * (h.hw + c.hw - .03);
    c.hold = 1;
    c.nose = t < 1.5 ? -s * .3 : 0;
    c.tx = t < .35 ? lane * s * 1.06 : t < .75 ? contact - s * .12 : t < 1.0 ? lane * s : t < 1.5 ? contact - s * .16 : lane * s;
    if (t > .7 && t < .95 || t > 1.35 && t < 1.7)
     h.bias = s * .16;
    if (t > 2)
     end();
    break;
   }
   case 'wall': {
    const contact = h.x + s * (h.hw + c.hw - .03);
    c.hold = 1;
    c.nose = t < .8 ? -s * .3 : 0;
    c.tx = t < .8 ? contact - s * .12 : contact;
    if (t > .75 && t < 2.1)
     h.bias = s * .95;
    if (t > .75 && Math.abs(c.x) > WALL - c.hw - .02 && c.state === 'drive') {
     c.age += 0;
     if (!e.done) {
      e.done = true;
     }
     c.damage += dt * 2.6;
     if (c.damage > 1.6) {
      c.yaw = -s * .5;
      c.w = -s * 3;
      c.v = flow + 3;
      c.vx = -s * .2;
      this.trip(c, -s, 1.05);
      this.big();
     }
    }
    if (t > 2.6)
     end();
    break;
   }
   case 'block': {
    if (t < 1.15) {
     c.tz = 2.7;
     c.tx = t < .55 ? s * lane : h.x + s * .15;
    }
    else {
     c.tz = 1.2;
     c.tx = h.x + s * .15;
     c.brake = 1;
     h.bias = -s * .1;
    }
    c.hold = 1;
    if (t > 3.6)
     end();
    break;
   }
   case 'pincer': {
    const d = e.d!;
    h.bias = -s * .34;
    for (const k of [c, d]) {
     k.tz = 2.05;
     k.hold = 1;
     k.tx = t < .85 ? k.side * .5 : -k.side * .2 + s * .16;
     k.nose = t > .7 ? -k.side * .5 : 0;
    }
    if (t > .85 && (c.state !== 'drive' || d.state !== 'drive') && !e.done) {
     e.done = true;
     for (const k of [c, d]) {
      if (k.state === 'drive')
       this.spin(k, k.side * -3);
      k.v = flow + 2.2;
     }
     this.big();
     const k = this.r() < .5 ? c : d;
     this.trip(k, k.side, .95);
    }
    if (t > 2.4)
     end();
    break;
   }
   case 'traffic':
   case 'pileup': { // a pursuing patrol overtakes into slower traffic
    if (t < 1.1) {
     c.tz = 2.3;
     c.tx = s * lane * .92;
     c.hold = 1;
    }
    if (t > 3.4)
     end();
    break;
   }
   case 'board': {
    if (t > 2.2)
     end();
    break;
   }
  }
 }
 private start(e: Ev, flow: number, h: Hero) {
  const s = e.side, lane = this.laneX;
  if (e.type === 'traffic') {
   this.civ(this.deck.draw(this.zone, this.r), h.hw * .86, { x: s * lane * .92, z: 26, v: flow * .52, tx: s * lane * .92 });
   if (this.r() < .6)
    this.civ(this.deck.draw(this.zone, this.r, true), h.hw * .86, { x: -s * .18, z: 34, v: flow * .56, tx: -s * .18 });
  }
  if (e.type === 'pileup') {
   for (const [x, z] of [[s * lane * .92, 24], [s * .1, 31], [-s * lane * .9, 38]])
    this.civ(this.deck.draw(this.zone, this.r, Math.abs(x) < .3), h.hw * .86, { x, z, v: flow * .52, tx: x });
  }
  if (e.type === 'board') {
   const x = h.x * .4;
   this.props.push({ kind: 'board', x, z: 32, w: .5, broken: false });
   for (let i = 0; i < 6; i++)
    this.props.push({ kind: 'cone', x: x + (i - 2.5) * .15, z: 29 + (i % 2) * 1.4, w: .05, broken: false });
  }
 }
 /** Ordinary traffic between the stunts. Most drivers pull over for the sirens, some keep their lane. */
 private ambient(dt: number, flow: number, h: Hero, value: number) {
  if ((this.road -= dt) > 0)
   return;
  if (this.cars.length >= 9) {
   this.road = .5;
   return;
  }
  const centre = this.r() < .2, drawn = this.deck.draw(this.zone, this.r, centre), model = this.painted(drawn) ? drawn : 'sedan', m = MODELS[model], hw = h.hw * .86 * m.wide, side = this.r() < .5 ? -1 : 1, x = centre ? this.rand(-.1, .1) : side * Math.min(this.laneX + .12, this.outer(hw)), z = this.rand(36, 42);
  if (this.cars.some(c => c.kind === 'civ' && c.z > 28 && Math.abs(c.x - x) < c.hw + hw)) {
   this.road = .6;
   return;
  }
  this.civ(model, h.hw * .86, { x, z, tx: x, v: Math.max(flow, 22) * this.rand(...m.pace), pull: centre || this.r() < .2 && !m.rigid ? 0 : this.rand(11, 20) });
  this.road = GAP[value >= 4 ? 2 : value >= 2 ? 1 : 0] * this.rand(.65, 1.4);
 }
 /** A driver reads only the road ahead: keeps a gap, and gives way once. */
 private drive(c: Car, dt: number) {
  for (const o of this.cars)
   if (o !== c && o.kind === 'civ' && o.state === 'drive' && o.z > c.z && o.z - c.z < c.len + 1.8 && Math.abs(o.x - c.x) < o.hw + c.hw && c.v > o.v)
    c.v = mix(c.v, o.v, Math.min(1, dt * 5));
  c.blink = Math.max(0, c.blink - dt);
  c.brake = Math.max(0, c.brake - dt * .8);
  if (c.pull && c.z < c.pull) {
   c.pull = 0;
   c.blink = 1.6;
   c.brake = .7;
   c.tx = (Math.sign(c.x) || 1) * this.outer(c.hw);
  }
 }
 /** A patrol without orders steers around slower traffic. */
 private around(c: Car) {
  let x = c.tx;
  for (const o of this.cars)
   if (o.kind === 'civ' && o.z + o.len > c.z && o.z - c.z < 5 && o.state === 'drive') {
    const need = c.hw + o.hw + .035;
    if (Math.abs(x - o.x) < need && Math.abs(o.x) > .25)
     x = o.x - Math.sign(o.x) * need;
   }
  return x;
 }
 /** Lateral space the coupe would like. Obstacles repel it long before contact. */
 wish(h: Hero, base: number) { let best = base, bc = 9e9; for (let x = -.6; x <= .601; x += .1) {
  let cost = Math.abs(x - base) * .55 + Math.abs(x - h.x) * .22;
  for (const c of this.cars) {
   if (c.kind === 'cop' && c.state === 'drive')
    continue;
   if (c.z + c.len - LEN < h.z + .1 || c.z > 13)
    continue;
   const o = h.hw + c.hw * 1.3 + .06 - Math.abs(x - c.x - c.vx * .25);
   if (o > 0)
    cost += o * (14 / Math.max(1.2, c.z - h.z));
  }
  if (cost < bc) {
   bc = cost;
   best = x;
  }
 } return clamp(best + h.bias, -.8, .8); }
 step(dt: number, flow: number, h: Hero, value: number, mode: 'race' | 'scene' | 'off') {
  this.time += dt;
  this.flow = flow;
  if (mode === 'race') {
   this.event(dt, h, flow, value);
   this.ambient(dt, flow, h, value);
  }
  else
   h.bias = 0;
  for (const c of this.cars) {
   c.age += dt;
   c.cool -= dt;
   if (c.state === 'drive') {
    if (c.kind === 'cop') {
     const ax = ((c.hold || mode !== 'race' ? c.tx : this.around(c)) - c.x) * (c.hold ? 34 : 15) - c.vx * (c.hold ? 8 : 6.2);
     c.vx += ax * dt;
     const tv = flow + clamp((c.tz - c.z) * 3.4, -11, 9);
     c.v += (tv - c.v) * Math.min(1, dt * (this.calm ? 15 : 5));
     c.yaw = mix(c.yaw, clamp(c.vx * .16, -.22, .22) + c.nose, Math.min(1, dt * 9));
     c.w = 0;
    }
    else {
     if (mode === 'race')
      this.drive(c, dt);
     const ax = (c.tx - c.x) * 6 - c.vx * 4;
     c.vx += ax * dt;
     c.yaw = 0;
    }
   }
   else if (c.state === 'spin') {
    c.yaw += c.w * dt;
    c.w *= Math.exp(-dt * .9);
    c.vx *= Math.exp(-dt * 1.2);
    c.v -= Math.sign(c.v) * (3.5 + 7 * Math.abs(Math.sin(c.yaw))) * dt;
    c.v = Math.max(0, c.v);
    if (Math.abs(c.yaw) > 1.5) {
     c.yaw = Math.sign(c.yaw) * 1.55;
     if (c.v > 9 && !this.calm)
      this.trip(c, Math.sign(c.yaw) || 1, .9);
     else {
      c.w = 0;
      c.state = 'slide';
      c.roll = 0;
     }
    }
    if (c.v < 1 && Math.abs(c.w) < .3)
     c.w = 0;
   }
   else if (c.state === 'air') {
    c.vy -= GRAV * dt;
    c.y += c.vy * dt;
    c.roll += c.wr * dt;
    if (c.y <= 0 && c.vy < 0) {
     const p = -c.vy;
     c.y = 0;
     this.fx.contact(c, p);
     c.vy = p * .46;
     c.v = Math.max(0, c.v - .9 - c.v * .035);
     c.vx *= .82;
     c.wr *= .86;
     if (c.vy < .2) {
      c.state = 'slide';
      c.roll = Math.round(c.roll / Math.PI) * Math.PI;
     }
    }
   }
   else {
    c.y = 0;
    c.v = Math.max(0, c.v - 8 * dt);
    c.vx *= Math.exp(-dt * 3);
   }
   // Wheels follow the road; a car thrown sideways drags them, a flying one lets them run down.
   c.rev = c.state === 'air' ? c.rev * Math.exp(-dt * .5) : mix(c.rev, c.v * Math.abs(Math.cos(c.yaw)) * (c.state === 'slide' ? 0 : 1), Math.min(1, dt * 12));
   c.turn += wheelTurn(c.rev) * dt;
   c.x += c.vx * dt;
   c.z += (c.v - flow) * dt;
   const lim = WALL - c.hw;
   if (!c.free && Math.abs(c.x) > lim && Math.abs(c.x) < WALL + .12 && c.y < .15) {
    const sd = Math.sign(c.x), vi = c.vx * sd;
    c.x = sd * lim;
    if (vi > 0) {
     if (vi > .35) {
      this.fx.hit(sd * WALL, .1, c.z, vi * 1.1, sd);
      this.fx.scrape(sd * WALL, c.z, sd, 1.5);
      c.damage += vi;
      if (c.state === 'spin' && vi > .7 && !this.calm)
       this.trip(c, -sd, .8);
     }
     c.vx = -vi * sd * .4;
    }
    this.fx.scrape(sd * WALL, c.z, sd, .5);
   }
  }
  for (let i = 0; i < this.cars.length; i++)
   for (let j = i + 1; j < this.cars.length; j++)
    this.collide(this.cars[i], this.cars[j]);
  if (mode !== 'off')
   for (const c of this.cars)
    if (mode === 'race')
     this.heroCollide(h, c, flow);
  for (const p of this.props) {
   p.z -= flow * dt;
   if (!p.broken && p.z < h.z + .3 && p.z > .8 && mode === 'race' && Math.abs(p.x - h.x) < p.w / 2 + h.hw) {
    p.broken = true;
    this.fx.smash(p, flow);
    if (p.kind === 'board') {
     this.fx.hero(1.1);
    }
   }
  }
  this.props = this.props.filter(p => p.z > .6 && !p.broken);
  this.cars = this.cars.filter(c => c.z > .46 && c.z < 60 && Math.abs(c.x) < 4);
 }
}
