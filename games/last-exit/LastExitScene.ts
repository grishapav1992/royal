import { clamp, ease, mix, quad, line, asphaltTile, gravelTile, puffs, glow } from './scene-kit';
import { YAW } from './scene-sprites';
import { heli, cargo, tunnel, nextStunt, runHash, cinematicLabel } from './stunts';
import { zones, zoneOf } from './route';
import type { RacePhase } from './model';
import { LastExitAssets, type LastExitAssetState } from './assets';
import { SceneFinales } from './scene-finales';
/** The chase: one fixed-step pursuit, one road projection and confirmed endings. Nothing here reads a deadline or an unconfirmed result. */
export class LastExitScene extends SceneFinales {
 private assets = new LastExitAssets();
 private prepared = false;
 private alive = true;
 private frames = 0;
 private bridgeHeard = true;
 private acc = 0;
 private slowFrames = 0;
 private frameAvg = 16;
 private warm = 0; private cost = 0;
 /** Neutral engine response while a start waits for confirmation. */
 revving = false;
 constructor(canvas: HTMLCanvasElement, private chooseStunt = nextStunt) { super(canvas); }
 get ready() { return this.assets.ready && this.prepared; }
 get jolt() { return this.shake; }
 async load(changed: (state: LastExitAssetState) => void) {
  const loaded = await this.assets.load(state => { this.canvas.dataset.assets = String(state.loaded); if (state.status !== 'ready')
   changed(state); });
  if (!loaded || !this.alive)
   return;
  for (const name of this.assets.names)
   this.img[name] = this.assets.get(name)!;
  // Textures are built between frames so a phone stays responsive.
  for (const step of [() => { this.road = asphaltTile(); }, () => { this.gravel = gravelTile(); this.red = glow('#ff4a2e'); this.blue = glow('#4f9bff'); this.flame = glow('#ffa640'); this.white = glow('#fff1cf'); }, () => { this.smoke = puffs('#d9d2c4'); this.dust = puffs('#cdb48a'); this.black = puffs('#2c2722'); this.hot = puffs('#ffc24a'); this.ember = puffs('#f06a1a'); }, () => this.paintTraffic(), () => this.buildCliff(), () => { for (const name of ['coupe', 'coupe-yaw', 'coupe-depth-roll'])
    this.shadeOf(name); }]) {
   await new Promise(resolve => setTimeout(resolve));
   if (!this.alive)
    return;
   step();
  }
  this.prepared = true;
  changed(this.assets.state);
 }
 /** A reopened run continues at speed: no burnout, no bridge and no launch sound. */
 private resume(value: number) { const hw = this.copW / this.R / 2; this.reset(); this.hero.x = 0; this.hero.vx = 0; this.booms = []; this.sim.reset(runHash(this.run) % 100000); this.jumpZone(value); this.vel = 24; this.since = 8; this.gear = 99; this.fired.add('launch'); for (const side of [-1, 1])
  this.sim.make('cop', { side, x: side * this.sim.laneX, z: 1.06, v: 24, tx: side * this.sim.laneX, hw }); }
 /** A weak device loses decoration before it loses frames. The level never rises again in one mount.
  * Only the scene's own cost counts: a busy hall behind the window is not its fault. */
 protected govern(raw: number) {
  if (this.warm++ < 40 || raw <= 0 || raw > .5) return;
  this.frameAvg = mix(this.frameAvg, raw * 1000, .04);
  const slow = this.quality === 0 ? this.frameAvg > 23 && this.cost > 5 : this.frameAvg > 32 && this.cost > 8;
  if (slow && this.quality < 2) {
   if (++this.slowFrames > 30) { this.quality++; this.slowFrames = 0; this.warm = 0; this.frameAvg = 16; this.bits.limit = this.quality === 1 ? 260 : 140; this.resize(); }
  } else this.slowFrames = Math.max(0, this.slowFrames - 1);
 }
 paint(now: number, phase: RacePhase, value: number, quiet: boolean, run = '', restored = false) {
  if (!this.alive || !this.prepared)
   return;
  const began = performance.now();
  const id = runHash(run) % 100000;
  const raw = this.last ? (now - this.last) / 1000 : 0, dt = clamp(raw, 0, .1);
  this.last = now;
  if (!quiet)
   this.govern(raw);
  // A reopened result shows its final pose and replays nothing.
  const still = quiet || restored && (phase === 'crashed' || phase === 'escaped');
  this.clock += dt;
  if (phase !== this.phase || run !== this.run) {
   const before = this.phase, sameRun = run === this.run;
   if (phase === 'waiting' || phase === 'idle') {
    this.reset();
    this.hero.x = 0;
    this.hero.vx = 0;
    this.scuff = 0;
    this.sim.reset(id);
    this.booms = [];
    this.gear = -1;
    this.holding = false;
    if (zoneOf(1) !== this.zone || this.bridge >= -12)
     this.jumpZone(1);
   }
   this.phase = phase;
   this.run = run;
   this.age = 0;
   this.since = 0;
   this.variant = this.chooseStunt(run, phase, value);
   if (phase === 'racing' && !(before === 'waiting' && sameRun))
    this.resume(value);
   if (phase === 'crashed' || phase === 'escaped') {
    this.prepareEnding(phase);
    if (still) {
     this.sim.cars = [];
     this.booms = [];
     this.bits.clear();
     this.skid = [];
     this.hero.x = 0;
     this.camX = 0;
     this.holding = false;
     this.rocks = [];
     this.fired.clear();
     this.jumpZone(value);
    }
    else if (phase === 'escaped' && (this.zone !== zoneOf(value) || this.bridge > -5 && this.bridge < 26)) {
     this.holding = true;
     this.bridgeTo = zoneOf(value);
     if (this.bridge < -12 && this.zone !== this.bridgeTo)
      this.bridge = 15;
    }
   }
  }
  this.since += dt;
  if (this.holding && this.zone === this.bridgeTo && this.bridge < -5)
   this.holding = false;
  const crash = phase === 'crashed', esc = phase === 'escaped', race = phase === 'racing' || this.holding, v = this.variant;
  // Slow motion covers the contact only. The confirmed result is already on the sign.
  const slow = crash && this.age > .32 && this.age < .66 ? .36 : crash && this.path && this.path.wall && this.age > this.path.wall - .05 && this.age < this.path.wall + .16 ? .45 : 1;
  if (!this.holding)
   this.age += dt * slow;
  this.sim.slow = Math.max(0, this.sim.slow - dt);
  this.drift = mix(this.drift, this.sim.slow > .1 ? 1 : 0, 1 - Math.exp(-dt * 8));
  this.stop = Math.max(0, this.stop - dt);
  const ts = still ? 1 : (phase === 'racing' ? (this.stop > 0 ? .12 : this.sim.slow > .12 ? .38 : this.sim.slow > 0 ? .7 : 1) : slow), sdt = dt * ts;
  const t = still ? crash ? 9 : esc ? 99 : 0 : this.age;
  // ---- speed
  let target = 0;
  if (race)
   target = 19 + 8 * ease((esc ? 4 : this.since) / 4) + Math.min(5, Math.log(Math.max(1, value)) * 2);
  if (phase === 'waiting')
   target = 0;
  if (crash)
   target = 24 * Math.max(0, 1 - t / 3.4);
  if (esc && !this.holding)
   target = v === 'helicopter' ? 24 * (1 - ease((t - .4) / 2.2)) : v === 'cargo-plane' ? 25 * (1 - ease((t - cargo.landing) / 2.6)) : 24 * (1 - ease((t - tunnel.brake) / (tunnel.stop - tunnel.brake)));
  // ---- steering and bodies advance on one fixed step, whatever the display rate
  const k = this.clock, H = this.hero;
  H.hw = this.carW / this.R / 2;
  this.sim.laneX = this.portrait ? .4 : .565;
  const chw = this.copW / this.R / 2;
  for (const c of this.sim.cars)
   if (c.kind === 'cop')
    c.hw = chw;
  const want = phase === 'idle' || phase === 'waiting' ? 0 : esc ? zoneOf(value) : Math.max(this.zone, zoneOf(value));
  if (still) {
   this.vel = 0;
   this.acc = 0;
   if (want !== this.zone)
    this.jumpZone(value);
   if ((race || phase === 'waiting') && this.sim.cars.length !== 2) {
    this.sim.cars = [];
    for (const side of [-1, 1])
     this.sim.make('cop', { side, x: side * this.sim.laneX, z: 1.06, tx: side * this.sim.laneX, hw: chw });
   }
   H.x = 0;
   H.vx = 0;
   this.roll = 0;
  }
  else {
   if (want !== this.zone && this.bridge < -12) {
    this.bridge = 26;
    this.bridgeTo = want;
    this.bridgeHeard = false;
   }
   const steer = phase === 'racing' || esc && (v !== 'tunnel' || t < .3), base = phase === 'racing' ? Math.sin(k * .9) * (this.portrait ? .05 : .15) : 0, h = 1 / 120;
   let ax = 0;
   this.acc = Math.min(.14, this.acc + sdt);
   while (this.acc >= h) {
    this.acc -= h;
    this.vel = esc && !this.holding && v === 'tunnel' ? target : mix(this.vel, target, 1 - Math.exp(-h * (race ? 1.9 : 4) / Math.max(.2, ts)));
    const f = this.vel;
    this.dist += f * h;
    if (this.bridge >= -12) {
     this.bridge -= Math.max(f, 9) * h * (this.holding ? 1.9 : 1);
     if (this.bridge < -2.5 && this.zone !== this.bridgeTo)
      this.zone = this.bridgeTo;
    }
    if (steer) {
     const wantX = phase === 'racing' ? this.sim.wish(H, base) : 0;
     ax = (wantX - H.x) * 22 - H.vx * 6;
     H.vx += ax * h;
     H.x += H.vx * h;
    }
    if (phase === 'racing') {
     this.sim.ensure(f, chw, h);
     this.sim.step(h, f, H, value, 'race');
    }
    else if (crash || esc) {
     this.endingCars(h, t, f, chw);
     this.sim.step(h, f, H, value, 'scene');
    }
    else if (phase === 'waiting') {
     for (const side of [-1, 1]) {
      if (this.since > .7 && !this.sim.cop(side))
       this.sim.make('cop', { side, x: side * this.sim.laneX, z: .56, v: 1.1, tx: side * this.sim.laneX, hw: chw });
     }
     this.sim.step(h, 0, H, 1, 'off');
    }
   }
   this.roll = mix(this.roll, clamp(-ax * .011, -.065, .065), 1 - Math.exp(-dt * 10));
  }
  if (!still && !this.bridgeHeard && this.bridge < 1 && this.bridge > -12) {
   this.bridgeHeard = true;
   this.sound?.('bridge', 1, 0);
  }
  const flow = this.vel;
  this.speed = Math.max(0, flow * 8.6);
  const sp = 1 - Math.exp(-dt * 9);
  this.weights = this.weights.map((a, i) => mix(a, i === this.zone ? 1 : 0, still ? 1 : sp));
  this.zoneIndex = this.zone;
  this.carX = H.x;
  this.carVX = H.vx;
  this.camX = still ? (esc && v === 'tunnel' ? this.portrait ? .8 : .6 : 0) : mix(this.camX, crash ? this.carX * .5 : esc && v === 'tunnel' ? Math.max(this.holding ? this.camX : 0, (this.portrait ? .8 : .6) * ease((t - .6) / 2.2)) : this.carX * .62, 1 - Math.exp(-dt * (esc ? 3 : 6)));
  this.vpx = this.w * .5 + (still ? 0 : (Math.sin(k * .5) * .012 - this.camX * .05) * this.w);
  // ---- gears
  this.rpm = phase === 'waiting' ? .3 + .5 * Math.abs(Math.sin(this.since * 4)) * ease(this.since / .6) : 0;
  if (race) {
   const gt = this.since < 6.6 ? this.since / 1.65 : 4 + (this.since - 6.6) / 3.2, g = Math.floor(gt);
   this.rpm = .42 + .5 * (gt - g);
   if (g > this.gear) {
    if (this.gear >= 0 || this.since < .3) {
     this.kick = 1;
     if (this.gear >= 0 && !still)
      this.sound?.('gear', 1, 0);
    }
    this.gear = g;
   }
  }
  this.kick = Math.max(0, this.kick - dt * 2.6);
  this.pitch = mix(this.pitch, race ? this.kick : 0, 1 - Math.exp(-dt * 12));
  if (!still)
   this.events(sdt, t, value);
  this.bits.step(sdt, flow);
  for (const b of this.booms) {
   b.age += sdt;
   b.z += (b.v - flow) * sdt;
   b.v = Math.max(0, b.v - 9 * sdt);
  }
  this.booms = this.booms.filter(b => b.age < 1.7 && b.z > .5);
  this.shake = Math.max(0, this.shake - dt * 2.2);
  this.flash = Math.max(0, this.flash - dt * 3.4);
  for (const s of this.skid)
   s.z -= flow * sdt;
  this.skid = this.skid.filter(s => s.z > .9);
  this.render(t, value, flow, still, slow);
  this.cost = mix(this.cost, performance.now() - began, .06);
  this.frames++;
  Object.assign(this.canvas.dataset, { renderer: 'canvas2d', phase, variant: v, cinematic: still && restored ? (crash ? 'explosion' : 'extracted') : cinematicLabel(phase, v, still && crash ? 9 : still && esc ? 99 : this.age, this.holding), restored: String(restored), frames: String(this.frames), location: zones[this.zone].key, locationIndex: String(this.zone), quality: String(this.quality), cars: String(this.sim.cars.length) });
 }
 protected render(t: number, value: number, flow: number, quiet: boolean, slow: number) {
  const { c, w, h } = this, ph = this.phase, v = this.variant, crash = ph === 'crashed', esc = ph === 'escaped' && !this.holding, race = ph === 'racing' || this.holding, W = this.carW;
  c.save();
  c.fillStyle = '#8fa4b0';
  c.fillRect(0, 0, w, h);
  const sh = quiet ? 0 : this.shake * this.shake, rush = clamp(flow / 27);
  const ox = Math.sin(this.clock * 61) * sh * h * .022 + Math.sin(this.clock * 37) * rush * .5, oy = Math.cos(this.clock * 53) * sh * h * .016 + (quiet ? 0 : Math.sin(this.clock * 47) * h * .0012 * rush);
  const push = crash && slow < 1 ? .035 : 0, zoom = 1.015 + rush * .018 + (quiet ? 0 : this.kick * .012) + push + (quiet ? 0 : this.drift * .03);
  c.translate(ox, oy);
  c.translate(w / 2, this.hy);
  c.scale(zoom, zoom);
  c.translate(-w / 2, -this.hy);
  this.backdrop();
  this.ground(flow);
  const gap = esc && v === 'tunnel' ? this.exitGap(t) : undefined;
  if (gap)
   this.exitRamp(gap, t);
  this.overpass(true);
  this.barrier(gap);
  this.scenery(flow, gap);
  if (this.skid.length) {
   c.fillStyle = '#1715127a';
   for (const s of this.skid) {
    const a = this.at(s.x - s.w / 2, s.z), b = this.at(s.x + s.w / 2, s.z), d = this.at(s.x + s.w / 2, s.z + s.l), e = this.at(s.x - s.w / 2, s.z + s.l);
    quad(c, a, b, d, e);
   }
  }
  this.overpass(false);
  if (!quiet && !crash)
   this.haze(oy);
  // ---- speed streaks over the asphalt
  if (rush > .25 && !quiet && this.quality < 2) {
   c.strokeStyle = '#f6ecd6';
   for (let i = 0; i < 16; i++) {
    const z = ((i * 1.7 - this.dist * .9) % 9 + 9) % 9 + .7, X = (i % 2 ? 1 : -1) * (.55 + (i % 5) * .22), a = this.at(X, z), b = this.at(X, z + .5 + rush);
    c.globalAlpha = .10 * rush * clamp(2 / z);
    c.lineWidth = Math.max(.6, a.s * 2.4);
    line(c, a, b);
   }
   c.globalAlpha = 1;
  }
  if (race && value >= 8 && !quiet) {
   const x = this.vpx + Math.sin(this.clock * .8) * w * .3, y = this.hy + this.G * (.45 + .12 * Math.sin(this.clock * .5));
   c.save();
   c.globalAlpha = .22;
   c.fillStyle = '#14120e';
   c.translate(x, y);
   c.scale(1, .28);
   c.rotate(this.clock * 9);
   for (let i = 0; i < 2; i++) {
    c.rotate(Math.PI / 2);
    c.fillRect(-w * .13, -w * .006, w * .26, w * .012);
   }
   c.beginPath();
   c.arc(0, 0, w * .03, 0, 7);
   c.fill();
   c.restore();
  }
  const foot = this.at(0, this.carZ).y, cx = this.at(this.carX, this.carZ).x;
  const copW = this.copW;
  const all = [...this.sim.cars].sort((a, b) => b.z - a.z);
  for (const p of [...this.sim.props].sort((a, b) => b.z - a.z))
   this.drawProp(p);
  const far = (z = this.carZ) => { for (const k of all)
   if (k.z > z)
    this.drawCar(k, quiet); }, near = (z = this.carZ) => { for (const k of all)
   if (k.z <= z)
    this.drawCar(k, quiet); };
  this.drawBits(false);
  if (crash)
   this.crashScene(t, quiet, far, near, copW);
  else if (esc && v === 'helicopter')
   this.heliScene(t, quiet, far, near);
  else if (esc && v === 'cargo-plane')
   this.planeScene(t, quiet, far, near);
  else if (esc && v === 'tunnel')
   this.tunnelScene(t, quiet, far, near);
  else {
   far();
   const squat = quiet ? 0 : this.pitch * W * .012, bob = quiet ? 0 : Math.sin(this.clock * 31) * W * .0022 * rush;
   this.shadow(cx, foot - W * .01, W * 1.02, .62);
   const slide = race && !quiet ? this.hero.vx : 0;
   if (Math.abs(slide) > 1.25)
    this.pose = Math.sign(slide);
   else if (Math.abs(slide) < .8)
    this.pose = 0;
   if (this.pose) {
    const [a, b, d, e] = YAW[1], yw = W * 1.17, yh = yw * e / d;
    c.save();
    c.translate(cx, foot + squat + bob);
    c.scale(this.pose > 0 ? -1 : 1, 1);
    c.rotate(-.02);
    c.drawImage(this.img['coupe-yaw'], a, b, d, e, -yw / 2, -yh, yw, yh);
    c.restore();
   }
   else
    this.body('coupe', cx, foot + squat + bob, W, quiet ? 0 : this.roll);
   this.scratches(cx, foot + squat + bob, W);
   this.tail(cx, foot, W, ph === 'idle' ? .25 : race ? .2 : .6);
   this.exhaust(cx, foot + squat, W, quiet ? 0 : race || ph === 'waiting' ? Math.pow(this.kick, 1.3) : 0);
   near();
  }
  this.drawBooms();
  this.drawBits(true);
  this.lensFlare();
  if (this.bridge >= -9 && this.bridge < 1.2) {
   const k = clamp((1.2 - this.bridge) / 1.5) * clamp((this.bridge + 9) / 2.2);
   c.fillStyle = `rgba(14,12,9,${.42 * k})`;
   c.fillRect(-20, -20, w + 40, h + 40);
  }
  const vg = c.createRadialGradient(w * .5, h * .58, Math.min(w, h) * .3, w * .5, h * .58, Math.max(w, h) * .72);
  vg.addColorStop(0, '#14170f00');
  vg.addColorStop(1, '#14170f70');
  c.fillStyle = vg;
  c.fillRect(-20, -20, w + 40, h + 40);
  if (this.flash > 0 && !quiet) {
   c.fillStyle = `rgba(255,224,170,${this.flash * .34})`;
   c.fillRect(-20, -20, w + 40, h + 40);
  }
  c.restore();
 }
 protected events(dt: number, t: number, value: number) {
  const ph = this.phase, v = this.variant, R = (a = 0, b = 1) => this.bits.rand(a, b), W = this.carW / this.R;
  if (ph === 'idle' && this.revving && R() < dt * 26) {
   this.kick = Math.max(this.kick, .35);
   for (const s of [-1, 1])
    this.tireSmoke(this.carX + s * W * .42, 1, .5);
  }
  if (ph === 'idle' && R() < dt * 5)
   for (const s of [-1, 1])
    this.bits.add({ kind: 'puff', x: this.carX + s * W * .22, y: .04, z: this.carZ - .03, vx: R(-.02, .02), vy: R(.02, .06), vz: -.06, life: 1.2, size: .012, grow: .05, alpha: .16, tint: 0, pin: true });
  if (ph === 'waiting') {
   if (this.since > .35 && this.since < 1.95) {
    const p = ease((this.since - .35) / .7);
    for (const s of [-1, 1])
     if (R() < dt * 46)
      this.tireSmoke(this.carX + s * W * .42, 1, .6 + p * .9);
    if (R() < dt * 6)
     this.kick = Math.max(this.kick, .5);
   }
   for (const c of this.sim.cars)
    if (this.since < 1.9 && R() < dt * 16)
     this.tireSmoke(c.x + R(-.1, .1), 1, .5, 0, c.z);
  }
  if (ph === 'racing') {
   this.once('launch', () => { this.kick = 1; this.shake = .35; for (const s of [-1, 1])
    this.tireSmoke(this.carX + s * W * .42, 9, 1.6); });
   if (this.since < 1.1)
    for (const s of [-1, 1])
     if (R() < dt * 40) {
      this.tireSmoke(this.carX + s * W * .42, 1, 1.2 * (1.1 - this.since));
     }
   if (R() < dt * 14)
    this.bits.add({ kind: 'puff', x: R(-1.1, 1.1) > 0 ? R(1.02, 1.2) : R(-1.2, -1.02), y: .02, z: R(1.5, 4), vy: .12, life: .8, size: .04, grow: .16, alpha: .2, tint: 1, front: false });
   for (const c of this.sim.cars) {
    const hot = c.state === 'spin' || Math.abs(c.vx) > .7;
    if (hot && R() < dt * 42) {
     this.tireSmoke(c.x + R(-c.hw, c.hw), 1, .8, 0, c.z, c.v);
    }
    if (c.state === 'spin')
     for (const q of [-.55, .55])
      this.mark(c.x + q * c.hw * 1.4, c.z, .028);
    this.trail(c, dt);
   }
   if (this.pose && R() < dt * 60) {
    this.tireSmoke(this.carX + R(-.15, .15), 1, .9);
    for (const q of [-.11, .11])
     this.mark(this.carX + q, 1.06, .03);
   }
   if (this.scuff > 2 && R() < dt * (this.scuff - 1) * 2.4)
    this.sparks(this.carX + R(-.1, .1), .02, this.carZ - .03, 2, .5);
  }
  else if (ph !== 'waiting')
   for (const c of this.sim.cars) {
    const hot = c.state === 'spin' || c.state === 'drive' && c.brake > .5 && this.vel > 2 || c.state === 'slide' && c.v > 2;
    if (hot && R() < dt * 34) {
     this.tireSmoke(c.x + R(-c.hw, c.hw), 1, .8, 0, c.z, c.v);
    }
    if (hot && c.y < .02)
     for (const q of [-.55, .55])
      this.mark(c.x + q * c.hw * 1.4, c.z, .028);
    this.trail(c, dt);
   }
  if (ph === 'crashed')
   this.crashEvents(dt, t);
  if (ph === 'escaped' && !this.holding) {
   if (v === 'helicopter') {
    if (t > .5 && t < heli.depart + .7 && R() < dt * 52) {
     const a = R(0, 6.28);
     this.bits.add({ kind: 'puff', x: Math.cos(a) * .22, y: .02, z: this.carZ + .1 + Math.sin(a) * .12, vx: Math.cos(a) * 1.5, vy: R(.02, .18), vz: Math.sin(a) * .6, life: R(.6, 1.2), size: .06, grow: .26, alpha: .3, tint: 1, front: Math.sin(a) < 0, pin: true });
    }
    this.once('taut', () => { });
    if (t > heli.lift && !this.fired.has('lift'))
     this.once('lift', () => { this.shake = .3; this.dustRing(0, this.carZ, 20, 1.1); });
   }
   else if (v === 'cargo-plane') {
    if (t > cargo.rampNear && t < cargo.takeoff)
     for (const s of [-1, 1])
      if (R() < dt * 70)
       this.sparks(this.carX + s * W * .4, .06, 1.0, 2, .8);
    if (t > cargo.takeoff)
     this.once('jump', () => { this.shake = .5; this.kick = 1; this.sparks(0, .1, 1, 30, 1.2); this.dustRing(0, 1, 14, .9); });
    if (t > cargo.landing)
     this.once('land', () => { this.shake = .35; });
   }
   else {
    if (t > tunnel.turn && t < tunnel.left && R() < dt * 50)
     this.tireSmoke(this.carX + R(-.15, .15), 1, .9, 1, 1.08);
    if (t > tunnel.turn)
     this.once('turn', () => { this.kick = 1; this.shake = .22; });
   }
  }
 }
 locationIndex() { return this.zone; }
 ending() { return this.variant; }
 presentationSeconds() { return this.age; }
 inspect() { return { renderer: 'canvas2d', phase: this.phase, age: this.age, frames: this.frames, variant: this.variant, zone: this.zone, weights: [...this.weights], holding: this.holding, quality: this.quality, dist: this.dist, vel: this.vel, carX: this.carX, cars: this.sim.cars.map(c => ({ kind: c.kind, state: c.state, x: c.x, z: c.z, y: c.y })), fired: [...this.fired], rocks: this.rocks.length }; }
 destroy() { this.alive = false; this.release(); this.assets.destroy(); }
}
