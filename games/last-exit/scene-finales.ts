import { clamp, ease, mix, outCubic, rng, quad, line, round } from './scene-kit';
import { PROPS, YAW, RAM, ROLL, BOX } from './scene-sprites';
import { impactAt, rollAt, explosionAt, heli, cargo, tunnel, MOUTH, rollPath } from './stunts';
import { WALL } from './pursuit';
import type { RacePhase } from './model';
import { SceneEffects } from './scene-effects';
import type { Point } from './scene-base';
type P = Point;
export abstract class SceneFinales extends SceneEffects {
 /** Endings may begin in the middle of any stunt: free bodies keep moving and the two patrols are restored. */
 protected prepareEnding(phase: RacePhase) {
  const H = this.hero, chw = this.copW / this.R / 2;
  this.sim.slow = 0;
  this.sim.props = [];
  this.sim.calm = true;
  for (const c of this.sim.cars)
   if (c.kind === 'civ' && c.state === 'drive')
    c.tx = (Math.sign(c.x) || 1) * .86;
  for (const side of [-1, 1]) {
   let c = this.sim.cop(side);
   if (!c)
    c = this.sim.make('cop', { side, x: side * this.sim.laneX, z: .8, v: this.vel + 3, hw: chw });
   c.tx = side * this.sim.laneX;
   c.tz = 1.06;
   c.hold = 0;
   c.nose = 0;
   c.brake = 0;
   c.damage = Math.min(c.damage, .4);
  }
  if (phase === 'crashed')
   H.vx = 0;
  this.path = undefined;
 }
 /** Patrols that kept their wheels slide to a believable stop inside the frame. */
 protected settle(dt: number, park: number) { if (this.age > 3.4 && !this.sim.cars.some(c => c.kind === 'cop' && c.z > .75 && c.z < 3.6 && Math.abs(c.x) < .8))
  this.once('late', () => { this.sim.make('cop', { side: 1, x: park, z: .6, v: this.vel + 3, tx: park, tz: 1.13, hw: this.copW / this.R / 2, brake: 1 }); }); for (const c of this.sim.cars)
  if (c.kind === 'cop' && c.state === 'spin') {
   if (Math.abs(c.yaw) > 1.05) {
    c.yaw = Math.sign(c.yaw) * 1.05;
    c.w *= -.3;
   }
   c.v = mix(c.v, this.vel + (1.13 - c.z) * 4, Math.min(1, dt * 7));
   c.vx += (this.camX * (this.variant === 'tunnel' ? 1 : 0) + (this.variant === 'tunnel' ? c.side : Math.sign(c.x) || c.side) * park - c.x) * dt * 1.4;
   c.vx *= Math.exp(-dt * 1.2);
   if (this.vel < 2)
    c.w *= Math.exp(-dt * 3);
  } }
 protected crashEvents(dt: number, t: number) {
  const R = (a = 0, b = 1) => this.bits.rand(a, b), W = this.carW / this.R, dir = this.variant === 'pit-right' ? -1 : 1;
  if (t >= impactAt)
   this.once('hit', () => { this.shake = .8; this.sparks(this.carX - dir * W * .45, .16, this.carZ - .02, 46, 1.2); for (let i = 0; i < 14; i++)
    this.bits.add({ kind: 'shard', x: this.carX - dir * W * .4, y: .2, z: this.carZ, vx: R(-1.1, 1.1), vy: R(.3, 1.4), vz: R(-.6, .2), life: R(.6, 1.3), size: R(.003, .007), spin: R(-12, 12), gravity: 3, bounce: .3, pin: true }); });
  if (t > .4 && t < .95) {
   for (let i = 0; i < 2; i++)
    if (R() < dt * 50)
     this.tireSmoke(this.carX + R(-.2, .2), 1, 1.2);
   for (const q of [-.12, .12])
    this.mark(this.carX + dir * .16 * ease((t - impactAt) / .28) + q, 1.07, .034);
  }
  if (t >= rollAt && !this.path)
   this.path = rollPath(dir, this.carX + dir * .16, rollAt, explosionAt, this.portrait ? .8 : WALL - .2);
  this.path?.contacts.forEach((at, i) => { if (t >= at)
   this.once('c' + i, () => { this.sound?.('contact', .8 - i * .06, dir * .5); const m = this.tumble(at); this.shake = Math.max(this.shake, .6 - i * .05); this.dustRing(m.x, m.z, 10, .8); this.sparks(m.x, .05, m.z, 14, .9, 0); this.mark(m.x, m.z, .2); this.panels(m.x, .12, m.z, 3, 0); this.glass(m.x, .12, m.z, 4, 0); }); });
  if (this.path?.wall && t >= this.path.wall)
   this.once('wallhit', () => { this.sound?.('hit', 1.2, dir); const m = this.tumble(this.path!.wall); this.shake = .95; this.sparks(dir * WALL, .16, m.z, 44, 1.3, 0); for (let i = 0; i < 16; i++)
    this.bits.add({ kind: 'chip', x: dir * (WALL - .04), y: R(.04, .18), z: m.z + R(-.3, .3), vx: -dir * R(.1, 1.2), vy: R(.4, 1.5), vz: R(-.8, .5), life: R(1.2, 2.2), size: R(.012, .034), spin: R(-8, 8), gravity: 2.9, bounce: .35, tint: 1, pin: true }); this.dustRing(dir * WALL, m.z, 14, 1); });
  if (t >= explosionAt) {
   this.once('boom', () => {
    this.sound?.('blast', 1.4, 0);
    this.flash = 1;
    this.shake = 1.2;
    const { x, z } = this.wreck;
    this.sparks(x, .1, z, 60, 1.9);
    this.dustRing(x, z, 26, 1.7);
    for (let i = 0; i < 26; i++)
     this.bits.add({ kind: 'puff', x: x + R(-.15, .15), y: R(.05, .3), z, vx: R(-.7, .7), vy: R(.15, .6), life: R(1.2, 2.8), size: R(.07, .15), grow: R(.1, .2), spin: R(-1, 1), alpha: .8, tint: 2, front: false, pin: true });
    for (let i = 0; i < 22; i++)
     this.bits.add({ kind: 'fire', x: x + R(-.15, .15), y: R(.02, .25), z, vx: R(-.8, .8), vy: R(.2, 1.2), life: R(.4, 1), size: R(.08, .18), grow: .1, alpha: .8, pin: true });
    for (let i = 0; i < 10; i++)
     this.bits.add({ kind: 'panel', x, y: .2, z, vx: R(-1.8, 1.8), vy: R(1, 2.4), vz: R(-.9, .3), life: R(1.6, 2.8), size: R(.01, .028), spin: R(-10, 10), gravity: 2.6, bounce: .3, pin: true });
   });
   const calm = clamp(1.2 - (t - explosionAt) * .06, .55, 1);
   if (R() < dt * 34 * calm)
    this.bits.add({ kind: 'fire', x: this.wreck.x + R(-.15, .15), y: R(.03, .1), z: this.wreck.z - .02, vx: R(-.04, .04), vy: R(.18, .45), life: R(.4, .9), size: R(.045, .09), alpha: 1, pin: true });
   if (R() < dt * 15 * calm)
    this.bits.add({ kind: 'puff', x: this.wreck.x + R(-.1, .1), y: .18, z: this.wreck.z + .02, vx: R(.04, .2), vy: R(.28, .5), life: R(2.2, 3.6), size: .08, grow: .14, spin: R(-.4, .4), alpha: .8, tint: 2, front: false, pin: true });
   if (R() < dt * 5)
    this.bits.add({ kind: 'spark', x: this.wreck.x + R(-.1, .1), y: .15, z: this.wreck.z, vx: R(-.15, .15), vy: R(.4, .9), life: 1.2, size: .002, gravity: -.1, pin: true });
  }
 }
 protected tumble(t: number) { const f = this.path?.frames, dir = this.variant === 'pit-right' ? -1 : 1, p = clamp((t - rollAt) / (explosionAt - rollAt)), e = ease(p); if (!f)
  return { x: this.carX + dir * .16, z: 1.08, hop: 0, frame: 0, turns: 0, p }; const i = Math.min(f.length - 1, Math.max(0, Math.round((t - rollAt) * 120))), q = f[i], turns = q.roll / (Math.PI * 2); this.wreck = { x: f[f.length - 1].x, z: 3 }; return { x: q.x, z: mix(1.08, this.wreck.z, e), hop: q.y, frame: Math.round((turns % 1) * 8) % 8, turns, p }; }
 protected crashScene(t: number, quiet: boolean, far: (z?: number) => void, near: (z?: number) => void, copW: number) {
  const c = this.c, W = this.carW, dir = this.variant === 'pit-right' ? -1 : 1, A = this.sim.cop(-dir), foot = this.at(0, this.carZ).y;
  const hit = ease((t - impactAt) / .28), side = ease((t - impactAt) / .34);
  const heroX = this.carX + dir * .16 * hit;
  // attacking patrol
  const arrive = ease(t / impactAt), push = hit, ret = ease((t - .76) / .95), pose = Math.min(2, Math.round(ease(t / .32) * (1 - ret * .7) * 2)), [sx, sy, sw, sh] = RAM[pose];
  const rh = copW * .79, rw = rh * sw / sh;
  const panel = this.at(heroX, this.carZ).x - dir * W * .42;
  const from = this.at(A ? A.x : -dir * .5, this.carZ).x;
  const nose = mix(from + dir * rw * .5, panel + dir * W * .06 * push, arrive);
  const rx = nose - dir * rw * .5;
  this.attX = this.camX + (rx - this.vpx) * this.carZ / this.R;
  const copA = () => { this.shadow(rx, foot - 4, rw, .5); c.save(); c.translate(rx, foot); c.scale(dir, 1); c.drawImage(this.img['patrol-ram'], sx, sy, sw, sh, -rw / 2, -rh, rw, rh); c.restore(); const p = Math.sin(this.clock * 9); this.add(p > 0 ? this.red : this.blue, rx - dir * rw * .12, foot - rh * .93, copW * .2, .7); };
  if (quiet) {
   if (!this.path)
    this.path = rollPath(dir, .16 * dir, rollAt, explosionAt, this.portrait ? .8 : WALL - .2);
   this.parked(this.portrait ? .36 : .52);
  }
  if (t < rollAt) {
   far();
   copA();
   for (const k of this.sim.cars)
    if (k !== A && k.z <= this.carZ)
     this.drawCar(k, quiet);
   const [a, b, d, e] = YAW[Math.min(3, Math.round(side * 3))], cw = W * mix(1, 1.28, side), ch = cw * e / d, p = this.at(heroX, this.carZ);
   this.shadow(p.x, foot, cw, .55);
   c.save();
   c.translate(p.x, foot);
   if (dir < 0)
    c.scale(-1, 1);
   if (side < .17)
    this.body('coupe', 0, 0, W, 0);
   else
    c.drawImage(this.img['coupe-yaw'], a, b, d, e, -cw / 2, -ch, cw, ch);
   c.restore();
   return;
  }
  const m = this.tumble(Math.min(t, explosionAt));
  far(m.z);
  const p = this.at(m.x, m.z), cw = W * 1.28 * p.s * this.carZ;
  this.shadow(p.x, p.y, cw * (1 - m.hop * .4), .5 * (1 - m.hop));
  const fr = t >= explosionAt ? 4 : m.frame, [a, b, d, e] = ROLL[fr], ch = cw * e / d;
  c.save();
  c.translate(p.x, p.y - m.hop * this.U * p.s);
  if (dir < 0)
   c.scale(-1, 1);
  c.drawImage(this.img['coupe-depth-roll'], a, b, d, e, -cw / 2, -ch, cw, ch);
  if (t >= explosionAt) {
   c.globalAlpha = ease((t - explosionAt) / .4);
   c.drawImage(this.shadeOf('coupe-depth-roll'), a / 2, b / 2, d / 2, e / 2, -cw / 2, -ch, cw, ch);
  }
  c.restore();
  if (t >= explosionAt) {
   const q = t - explosionAt, size = Math.min(W * 2.3, this.h * .62) * (.35 + .65 * outCubic(q / .32)) * (1 + q * .05), al = q < .5 ? 1 : clamp(1 - (q - .5) / 1.3);
   if (q < .9 && !quiet) {
    const r = outCubic(q / .8);
    c.save();
    c.globalAlpha = (1 - r) * .6;
    c.strokeStyle = '#ffe7bd';
    c.lineWidth = 2 + 10 * (1 - r);
    c.beginPath();
    c.ellipse(p.x, p.y, this.R * .75 * r, this.R * .13 * r, 0, 0, 7);
    c.stroke();
    c.restore();
   }
   if (al > .01 && !quiet) {
    c.save();
    c.globalAlpha = al;
    c.drawImage(this.img.explosion, 43, 37, 1459, 928, p.x - size / 2, p.y + size * .04 - size * .636, size, size * .636);
    c.restore();
    this.add(this.flame, p.x, p.y - size * .2, size * .75, al * .5);
   }
   else {
    this.add(this.flame, p.x, p.y - ch * .2, cw * .95, .16 + .05 * Math.sin(this.clock * 11));
   }
   if (quiet)
    this.stillFire(p.x, p.y, cw);
  }
  near(m.z);
 }
 protected heliScene(t: number, quiet: boolean, far: (z?: number) => void, near: (z?: number) => void) {
  if (quiet)
   this.parked(this.portrait ? .36 : .52);
  const c = this.c, { w, h } = this, W = this.carW, foot = this.at(0, this.carZ).y, arr = outCubic(t / 1.6), lift = ease((t - heli.lift) / 1.85), cab = ease((t - heli.cables) / 1.35), dep = ease((t - heli.depart) / (heli.end - heli.depart));
  const pw = Math.min(W, h * .37), cw = mix(W, pw, arr), unit = mix(1, .15, Math.pow(dep, .72)), heliBase = Math.min(w * (this.portrait ? .56 : .34), 400, Math.max(h * .3, (h * .94 - h * .05 - pw * .652 - h * .04 - this.top - h * .02) / .80));
  const rx = mix(this.at(this.carX, this.carZ).x, this.vpx, arr) + w * (this.portrait ? .2 : .24) * dep;
  const air = h * .05 * lift, carH = cw * .652 * unit;
  const groundFoot = mix(foot, Math.min(foot, h * .95), arr);
  const footY = mix(groundFoot - air, this.top + (this.hy - this.top) * .82, Math.pow(dep, .85)), sway = quiet ? 0 : Math.sin(t * 2.3) * cw * .03 * lift * (1 - dep), cx = rx + sway * unit;
  const gap = Math.max(h * .04, cw * .1) * unit, hh = heliBase * .807 * unit, hw = heliBase * unit;
  const hy = footY - carH - gap - h * .62 * (1 - arr) - (quiet ? 0 : Math.sin(t * 3.1) * h * .006 * (1 - dep)), hx = rx - (dep > 0 ? w * .01 * dep : 0), tilt = quiet ? 0 : Math.sin(Math.min(1, dep * 2.4) * Math.PI) * .10;
  far(0);
  this.shadow(rx, groundFoot, cw * (1 - lift * .25), .6 * (1 - lift * .6) * (1 - dep));
  if (lift < .4)
   this.tail(cx, footY, cw, .8 * (1 - lift));
  this.body('coupe', cx, footY, cw * unit, sway * .0006 + tilt * .4);
  // slack cables become taut before the lift
  const slack = (1 - ease((t - 1.9) / .4)) * .5;
  c.lineWidth = Math.max(.8, hw * .007);
  c.strokeStyle = '#1d211f';
  for (const [sx, px] of [[-.17, -.36], [-.1, -.2], [.1, .2], [.17, .36]] as const) {
   const ax = hx + sx * hw, ay = hy - hh * .02, bx = cx + px * cw * unit, by = footY - carH * (Math.abs(px) > .3 ? .6 : .96), ex = mix(ax, bx, cab), ey = mix(ay, by, cab);
   if (cab <= 0)
    continue;
   c.beginPath();
   c.moveTo(ax, ay);
   c.quadraticCurveTo(mix(ax, ex, .5) + sx * hw * slack * 1.6, mix(ay, ey, .6) + hw * .05 * slack, ex, ey);
   c.stroke();
   if (cab > .98) {
    c.fillStyle = '#d6b46c';
    c.beginPath();
    c.arc(ex, ey, Math.max(1, hw * .009), 0, 7);
    c.fill();
   }
  }
  c.save();
  c.translate(hx, hy);
  c.rotate(tilt);
  c.translate(-hx, -hy);
  this.body('helicopter', hx, hy, hw);
  // rotor: blurred disc, blades and a bright rim sweep
  const ry = hy - hh * .945, rr = hw * .78;
  c.save();
  c.translate(hx, ry);
  c.scale(1, .12);
  c.globalAlpha = .34;
  c.fillStyle = '#22272a';
  c.beginPath();
  c.arc(0, 0, rr, 0, 7);
  c.fill();
  c.globalAlpha = .5;
  c.lineWidth = rr * .02;
  c.strokeStyle = '#e9e2cf';
  c.beginPath();
  c.arc(0, 0, rr, 0, 7);
  c.stroke();
  if (!quiet) {
   c.rotate(this.clock * 17);
   c.globalAlpha = .62;
   c.fillStyle = '#15191b';
   for (let i = 0; i < 4; i++) {
    c.rotate(Math.PI / 2);
    c.beginPath();
    c.moveTo(0, -rr * .02);
    c.lineTo(rr, -rr * .045);
    c.lineTo(rr, rr * .045);
    c.lineTo(0, rr * .02);
    c.fill();
   }
  }
  c.restore();
  c.restore();
 }
 protected planeScene(t: number, quiet: boolean, far: (z?: number) => void, near: (z?: number) => void) {
  if (quiet)
   this.parked(this.portrait ? .36 : .52);
  const c = this.c, { w, h } = this, k = cargo, W = this.carW, foot = this.at(0, this.carZ).y, arr = ease((t - k.planeAt) / (k.planeReady - k.planeAt)), climb = ease((t - k.rampNear) / (k.takeoff - k.rampNear)), jump = ease((t - k.takeoff) / (k.landing - k.takeoff)), entry = ease((t - k.landing) / (k.inside - k.landing)), dep = ease((t - k.departure) / (k.exit - k.departure));
  const base = Math.min(w * (this.portrait ? 1.5 : .8), (h - this.top) * 1.2, 960), sc = mix(1, .12, Math.pow(dep, .6)), pw = base * mix(.2, 1, arr) * sc, bob = quiet ? 0 : Math.sin(t * 2) * h * .006 * (1 - dep);
  const px = mix(w * .84, this.vpx, arr) + w * (this.portrait ? .16 : .22) * dep, py = mix(-h * .3, this.hy * .9, arr) - (this.hy * .9 - this.top - (this.hy - this.top) * .36) * dep + bob; // centre
  const ph = pw * .545;
  const z = mix(9, .86, Math.pow(clamp(t / k.rampNear), .8)) - Math.max(0, t - k.takeoff) * .9;
  if (t < k.takeoff)
   far();
  if (t >= k.planeAt) {
   if (!quiet)
    for (const s of [-.355, -.2, .2, .355])
     this.add(this.flame, px + s * pw, py + ph * .2, pw * .035, .35 + .2 * Math.sin(this.clock * 40 + s * 9));
   this.shadow(px, h * .84, pw * .7, .22 * (1 - dep));
   const [sx, sy, sw, sh] = BOX['cargo-plane'];
   c.drawImage(this.img['cargo-plane'], sx, sy, sw, sh, px - pw / 2, py - ph / 2, pw, ph);
  }
  // road ramp
  const R = (zz: number, X: number, Y: number) => this.at(X, zz, Y);
  if (z > .62 && t < k.takeoff + .5) {
   const n = Math.max(.64, z), f = z + .75, A = R(n, -.34, 0), B = R(n, .34, 0), C = R(f, .34, .3), D = R(f, -.34, .3);
   c.fillStyle = '#2c312c';
   quad(c, A, B, { x: B.x, y: B.y + 4 }, { x: A.x, y: A.y + 4 });
   const g = c.createLinearGradient(0, D.y, 0, A.y);
   g.addColorStop(0, '#a3a594');
   g.addColorStop(1, '#4a5049');
   c.fillStyle = g;
   quad(c, A, B, C, D);
   c.strokeStyle = '#2a302b';
   for (let i = 1; i < 9; i++) {
    const q = i / 9;
    c.lineWidth = Math.max(.6, 2.4 / mix(n, f, q));
    line(c, { x: mix(A.x, D.x, q), y: mix(A.y, D.y, q) }, { x: mix(B.x, C.x, q), y: mix(B.y, C.y, q) });
   }
   c.strokeStyle = '#e0b45f';
   c.lineWidth = Math.max(1, 4 / n);
   line(c, A, D);
   line(c, B, C);
   c.strokeStyle = '#f0e2b4';
   c.lineWidth = Math.max(1, 3 / f);
   line(c, D, C);
   const post = R(f, -.34, 0), post2 = R(f, .34, 0);
   c.strokeStyle = '#33372f';
   c.lineWidth = Math.max(1, 4 / f);
   line(c, D, post);
   line(c, C, post2);
  }
  // car
  let cw = mix(W, W * .8, climb), x = this.at(this.carX, this.carZ).x, y = foot - climb * h * .13;
  const holdW = pw * .105, holdY = py + ph * .5;
  if (t >= k.takeoff) {
   x = mix(this.vpx, px, jump);
   cw = mix(W * .8, holdW, outCubic(jump));
   y = mix(foot - h * .13, holdY, jump) - Math.sin(jump * Math.PI) * h * .14;
  }
  if (t >= k.landing) {
   const squash = Math.sin(clamp((t - k.landing) / .3) * Math.PI) * ph * .012;
   x = px;
   cw = pw * mix(.105, .05, entry);
   y = py + ph * mix(.5, .36, entry) + squash;
  }
  if (t < k.takeoff)
   this.shadow(x, foot, cw * 1.02, .6 * (1 - climb * .4));
  else if (jump < 1)
   this.shadow(x, h * .9, cw * .8, .35 * (1 - jump));
  c.save();
  if (entry > 0) {
   c.beginPath();
   c.rect(px - pw * .066, py + ph * .1, pw * .132, ph);
   c.clip();
  }
  if (!(entry >= 1 && dep > .2))
   this.body('coupe', x, y, cw, t >= k.takeoff && t < k.landing ? Math.sin(jump * Math.PI * 2) * .04 : 0, 1 - entry * .62);
  c.restore();
  if (t < k.takeoff + .3)
   this.exhaust(x, y, cw, quiet ? 0 : Math.max(this.kick, climb * .9));
  if (jump > 0 && jump < 1)
   this.tail(x, y, cw, .7);
  if (t < k.takeoff)
   near();
  else
   far(0);
 }
 /** Rock face cut from the highway plate: the sky is keyed out and the road-side edge is broken up. */
 protected buildCliff() {
  const im = this.img['route-highway'];
  if (!im)
   return;
  const cv = document.createElement('canvas');
  cv.width = 520;
  cv.height = 280;
  const g = cv.getContext('2d')!;
  g.drawImage(im, 1254, 200, 520, 280, 0, 0, 520, 280);
  const d = g.getImageData(0, 0, 520, 280), a = d.data, r = rng(409);
  const edge = Array.from({ length: 281 }, () => r());
  for (let y = 0; y < 280; y++)
   for (let x = 0; x < 520; x++) {
    const i = (y * 520 + x) * 4, key = clamp((a[i] - a[i + 2] + 6) / 12), wall = 66 + (258 - y) * .36 + Math.sin(y * .21) * 5 + edge[y >> 2] * 9 - 4;
    a[i + 3] = 255 * key * clamp((x - wall) / 5) * clamp((274 - y) / 22);
   }
  g.putImageData(d, 0, 0);
  this.cliff = cv;
 }
 protected exitGap(t: number) { this.once('gap', () => { this.exitAt = this.dist + (t > 50 ? 1.2 : 34.8); this.rocks = []; }); const from = this.exitAt - this.dist; return { from: Math.max(.7, from), to: from + 2.3 }; }
 protected rampX(d: number) { return 1 + .2 * d + .013 * d * d; }
 protected arch(x: number, y: number, w: number, h: number) { const c = this.c; c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x - w / 2, y - h * .55); c.ellipse(x, y - h * .55, w / 2, h * .45, 0, Math.PI, 0); c.lineTo(x + w / 2, y); c.closePath(); }
 protected exitRamp(gap: {
  from: number;
  to: number;
 }, t: number) {
  const c = this.c, z0 = this.exitAt - this.dist, seg = 26;
  const L: P[] = [], Q: P[] = [];
  const zp = z0 + MOUTH;
  if (zp < .7)
   return;
  const pm = this.at(this.rampX(MOUTH), zp), su = this.U * pm.s, pw = .6 * this.R * pm.s, ph = 1.02 * su, fade = clamp((40 - zp) / 10);
  // rock face behind the portal
  if (this.cliff && fade > 0) {
   const k = ph / 84;
   c.globalAlpha = fade;
   c.drawImage(this.cliff, pm.x - 150 * k, pm.y - 258 * k, 520 * k * 1.12, 280 * k);
   const g = c.createLinearGradient(0, pm.y - 150 * k, 0, pm.y);
   g.addColorStop(0, '#0000');
   g.addColorStop(1, '#2a1f1233');
   c.globalAlpha = 1;
  }
  for (let i = 0; i <= seg; i++) {
   const d = MOUTH * Math.pow(i / seg, 1.1), z = z0 + d;
   if (z < .7)
    continue;
   const X = this.rampX(d), hw = mix(.3, .36, clamp(d / 2));
   L.push(this.at(Math.max(.99, X - hw), z));
   Q.push(this.at(X + hw, z));
  }
  if (L.length >= 2) {
   const path = () => { c.beginPath(); L.forEach((p, i) => { i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); for (let i = Q.length - 1; i >= 0; i--)
    c.lineTo(Q[i].x, Q[i].y); c.closePath(); };
   const stroke = (pts: P[], dy: number, col: string, k: number) => { c.strokeStyle = col; for (let i = 1; i < pts.length; i++) {
    c.lineWidth = Math.max(.6, k * pts[i].s);
    c.beginPath();
    c.moveTo(pts[i - 1].x, pts[i - 1].y - dy * this.U * pts[i - 1].s);
    c.lineTo(pts[i].x, pts[i].y - dy * this.U * pts[i].s);
    c.stroke();
   } };
   c.fillStyle = '#837c6f';
   path();
   c.fill();
   const g = c.createLinearGradient(0, this.hy, 0, this.hy + this.G * .7);
   g.addColorStop(0, '#d9c9ac44');
   g.addColorStop(1, '#3f3b3466');
   c.fillStyle = g;
   c.fill();
   stroke(L, .01, '#eee7d6', 7);
   stroke(Q, .01, '#d9ac52', 7);
   stroke(Q, .06, '#a69d8a', 15);
   stroke(Q, .11, '#dcd3be', 5);
  }
  // portal: concrete collar, lit interior, lane leading in
  c.globalAlpha = fade;
  this.arch(pm.x, pm.y, pw * 1.2, ph * 1.13);
  const face = c.createLinearGradient(0, pm.y - ph * 1.13, 0, pm.y);
  face.addColorStop(0, '#d6cdb8');
  face.addColorStop(.5, '#aaa18d');
  face.addColorStop(1, '#7b7364');
  c.fillStyle = face;
  c.fill();
  c.strokeStyle = '#5c5548';
  c.lineWidth = Math.max(.7, su * .012);
  c.stroke();
  for (let i = 1; i < 8; i++) {
   const a = Math.PI + i * Math.PI / 8, cx = Math.cos(a), sy = Math.sin(a);
   line(c, { x: pm.x + cx * pw * .5, y: pm.y - ph * .55 + sy * ph * .45 }, { x: pm.x + cx * pw * .6, y: pm.y - ph * .62 + sy * ph * .51 });
  }
  c.save();
  this.arch(pm.x, pm.y, pw, ph);
  c.clip();
  const inn = c.createRadialGradient(pm.x, pm.y - ph * .42, 0, pm.x, pm.y - ph * .42, pw * .75);
  inn.addColorStop(0, '#0c0a07');
  inn.addColorStop(.5, '#1a150e');
  inn.addColorStop(1, '#3a3022');
  c.fillStyle = inn;
  c.fillRect(pm.x - pw, pm.y - ph * 1.2, pw * 2, ph * 1.3);
  c.fillStyle = '#3b362c';
  quad(c, { x: pm.x - pw * .5, y: pm.y }, { x: pm.x + pw * .5, y: pm.y }, { x: pm.x + pw * .07, y: pm.y - ph * .36 }, { x: pm.x - pw * .07, y: pm.y - ph * .36 });
  for (let i = 0; i < 6; i++) {
   const q = ((i + ((this.clock * .0) % 1)) / 6), k = mix(1, .12, Math.pow(q, .6));
   for (const sd of [-1, 1])
    this.add(this.white, pm.x + sd * pw * .36 * k, pm.y - ph * (.4 + .4 * k), Math.max(1.2, su * .06 * k), .75 * k + .15);
  }
  c.restore();
  c.globalAlpha = 1;
  // gore sign
  const gz = z0 + 1.1;
  if (gz > .8 && gz < 40) {
   const p = this.at(this.rampX(1.1) + .5, gz), q = this.U * p.s, bw = q * .5, bh = q * .27, by = p.y - q * .62;
   c.fillStyle = '#59605b';
   c.fillRect(p.x - bw * .28, by, Math.max(1, q * .025), p.y - by);
   c.fillRect(p.x + bw * .25, by, Math.max(1, q * .025), p.y - by);
   c.fillStyle = '#26331f';
   round(c, p.x - bw / 2, by, bw, bh, q * .03);
   c.fill();
   c.strokeStyle = '#eee8da';
   c.lineWidth = Math.max(1, q * .012);
   c.stroke();
   c.fillStyle = '#f3ead6';
   c.textAlign = 'center';
   c.textBaseline = 'middle';
   c.font = `italic 900 ${bh * .52}px Impact,'Arial Narrow',sans-serif`;
   c.fillText('EXIT ↗', p.x, by + bh * .54);
  }
 }
 /** The slide closes the mouth behind the coupe. */
 protected landslide(dt: number, t: number) {
  if (t < tunnel.slide)
   return;
  this.once('slide', () => { this.shake = .75; for (let i = 0; i < 20; i++) {
   const x = (this.bits.rand() - .5) * .62, h = Math.max(0, .62 - Math.abs(x) * 1.35) * this.bits.rand(.25, 1);
   this.rocks.push({ x, y: 1.12 + this.bits.rand(-.06, .1), vy: this.bits.rand(0, .35), wait: i * .042 + this.bits.rand(0, .1), rest: h, size: this.bits.rand(.17, .34), rot: this.bits.rand(-.5, .5), flip: this.bits.rand() < .5 ? -1 : 1, hit: false });
  } this.rocks.sort((a, b) => b.rest - a.rest); const zq = this.exitAt - this.dist + MOUTH, Xq = this.rampX(MOUTH); for (let i = 0; i < 14; i++)
   this.bits.add({ kind: 'puff', x: Xq + this.bits.rand(-.35, .35), y: this.bits.rand(1, 1.25), z: zq, vx: this.bits.rand(-.2, .2), vy: this.bits.rand(0, .3), life: this.bits.rand(.8, 1.6), size: .1, grow: .2, alpha: .6, tint: 1, front: true, pin: true }); });
  const zp = this.exitAt - this.dist + MOUTH, X = this.rampX(MOUTH);
  for (const r of this.rocks) {
   if ((r.wait -= dt) > 0 || r.y <= r.rest && r.hit)
    continue;
   r.vy -= 3.4 * dt;
   r.y += r.vy * dt;
   r.rot += dt * 2.2 * r.flip;
   if (r.y < r.rest) {
    r.y = r.rest;
    if (!r.hit) {
     r.hit = true;
     this.shake = Math.max(this.shake, .34);
     this.dustRing(X + r.x, zp - .25, 5, .55);
     this.sound?.('rock', r.size * 3, .5);
    }
    r.vy = 0;
   }
  }
  if (t < tunnel.slide + 1.6 && this.bits.rand() < dt * 36)
   this.bits.add({ kind: 'puff', x: X + this.bits.rand(-.35, .35), y: this.bits.rand(0, .5), z: zp - .2, vx: this.bits.rand(-.2, .2), vy: this.bits.rand(.05, .3), life: this.bits.rand(1, 2), size: .09, grow: .16, alpha: .5, tint: 1, front: true, pin: true });
 }
 protected drawRocks() { const sheet = this.img['route-props']; if (!sheet || !this.rocks.length)
  return; const c = this.c, zp = this.exitAt - this.dist + MOUTH - .15, X = this.rampX(MOUTH), [sx, sy, sw, sh] = PROPS[4]; for (const r of this.rocks) {
  if (r.wait > 0)
   continue;
  const p = this.at(X + r.x, zp, r.y), w = r.size * this.R * p.s * 1.15, h = w * sh / sw;
  c.save();
  c.translate(p.x, p.y);
  c.rotate(r.rot * .4);
  c.scale(r.flip, 1);
  c.drawImage(sheet, sx, sy, sw, sh, -w / 2, -h, w, h);
  c.restore();
 } }
 protected tunnelScene(t: number, quiet: boolean, far: (z?: number) => void, near: (z?: number) => void) {
  const c = this.c, k = tunnel, W = this.carW, go = ease((t - k.turn) / (k.left - k.turn)), z0 = this.exitAt - this.dist, zp = z0 + MOUTH, pre = ease(t / k.turn);
  let X = mix(this.carX, .5, pre), z = this.carZ;
  if (t >= k.turn) {
   z = mix(this.carZ, 3.3, go) + Math.max(0, t - k.left) * 2.4;
   const on = z - z0;
   X = on > 0 ? Math.max(this.rampX(on), .9) : mix(.5, .96, ease((t - k.turn) / .9));
  }
  if (quiet)
   this.parked(this.portrait ? .36 : .52, this.camX);
  if (quiet && !this.rocks.length)
   for (let i = 0; i < 20; i++) {
    const r = rng(i * 77 + 5), x = (r() - .5) * .62;
    this.rocks.push({ x, y: Math.max(0, .62 - Math.abs(x) * 1.35) * r(), vy: 0, rest: 0, size: .17 + r() * .17, rot: 0, flip: r() < .5 ? -1 : 1, hit: true, wait: 0 });
   }
  this.tunnelZ = z;
  const p = this.at(X, z), cw = W * p.s * this.carZ, pose = go < .12 ? 0 : go < .5 ? 1 : z < zp - .9 ? 2 : 1, foot = p.y, inside = z - zp;
  const car = () => {
   if (inside > 1.7)
    return;
   const pm = this.at(this.rampX(MOUTH), zp);
   c.save();
   if (inside > 0) {
    this.arch(pm.x, pm.y, .6 * this.R * pm.s, 1.02 * this.U * pm.s);
    c.clip();
   }
   if (inside <= 0)
    this.shadow(p.x, foot, cw * 1.1, .55);
   if (pose === 0)
    this.body('coupe', p.x, foot, cw, .02 * pre);
   else {
    const [a, b, d, e] = YAW[pose], yw = cw * (pose === 2 ? 1.22 : 1.16), yh = yw * e / d;
    c.save();
    c.translate(inside > 0 ? mix(p.x, pm.x, clamp(inside * 1.5)) : p.x, foot);
    c.scale(-1, 1);
    c.drawImage(this.img['coupe-yaw'], a, b, d, e, -yw / 2, -yh, yw, yh);
    if (inside > 0) {
     c.globalAlpha = mix(.35, 1, clamp(inside / 1.2));
     c.drawImage(this.shadeOf('coupe-yaw'), a / 2, b / 2, d / 2, e / 2, -yw / 2, -yh, yw, yh);
    }
    c.restore();
   }
   if (inside < 1.4)
    for (const s of [-.2, .25])
     this.add(this.red, (inside > 0 ? pm.x : p.x) + s * cw, foot - cw * .27, cw * .2, inside > 0 ? .8 : .35);
   if (!quiet && t < k.turn + .8)
    this.exhaust(p.x, foot, cw, this.kick * (pose ? 0 : 1));
   c.restore();
  };
  if (inside > -.2) {
   car();
   this.drawRocks();
   far(0);
  }
  else {
   far(z);
   car();
   near(z);
  }
 }
 protected endingCars(dt: number, t: number, flow: number, chw: number) {
  if (t < 1.5 && this.phase === 'escaped')
   for (const side of [-1, 1])
    if (!this.sim.cop(side) && !this.fired.has('lost' + side))
     this.sim.make('cop', { side, x: side * this.sim.laneX, z: .7, v: flow + 6, tx: side * this.sim.laneX, hw: chw });
  if (this.holding)
   return;
  const A = this.sim.cop(-1), B = this.sim.cop(1), v = this.variant, H = this.hero, R = (a = 0, b = 1) => this.bits.rand(a, b);
  const park = this.portrait ? .36 : .52;
  for (const c of this.sim.cars)
   if (c.kind === 'civ' && c.state === 'drive')
    c.v = mix(c.v, flow + 11, Math.min(1, dt * 4));
   else if (c.kind === 'civ' && t > 2)
    c.v = Math.max(c.v, flow);
  if (this.phase === 'crashed') {
   const dir = v === 'pit-right' ? -1 : 1, att = dir > 0 ? A : B, oth = dir > 0 ? B : A;
   if (att && t > rollAt)
    this.once('fishtail', () => { att.x = this.attX; att.z = 1.07; att.state = 'spin'; att.yaw = dir * .5; att.w = -dir * 1.5; att.vx = -dir * .35; att.v = flow + 1; att.brake = 1; });
   for (const c of this.sim.cars)
    if (c.kind === 'cop' && c.state !== 'air') {
     const s = Math.sign(c.x) || c.side;
     if (c.state === 'spin') {
      if (Math.abs(c.yaw) > 1.0) {
       c.yaw = Math.sign(c.yaw) * 1.0;
       c.w *= -.35;
      }
      c.v = mix(c.v, flow + (1.15 - c.z) * 4, Math.min(1, dt * 7));
      if (t > 3.6) {
       c.vx *= .9;
       c.w *= .9;
      }
      c.vx += (s * park - c.x) * dt * 1.2;
     }
    }
   if (oth) {
    oth.tx = dir * park;
    oth.tz = t < 2 ? 1.06 : 1.1;
    oth.brake = 1;
    if (t > 1.5)
     this.once('slew', () => { oth.state = 'spin'; oth.w = dir * -1.7; oth.vx = dir * .2; oth.v = flow + 1.5; });
   }
   return;
  }
  if (v === 'helicopter') {
   // The two patrols meet under the rising coupe.
   if (t < 1.9) {
    for (const c of [A, B])
     if (c) {
      c.tx = c.side * this.sim.laneX;
      c.tz = 1.06;
     }
   }
   else if (A && B && !this.fired.has('meet')) {
    for (const c of [A, B]) {
     c.hold = 1;
     c.brake = t > 2.35 ? 1 : 0;
     c.tz = c.side < 0 ? 1.12 : 1.2;
     c.tx = t < 2.35 ? c.side * (park + .04) : -c.side * .1;
     c.nose = t > 2.2 ? -c.side * .75 : 0;
    }
    if (Math.abs(A.x - B.x) < chw * (2 + 1.8 * Math.sin(.75)) + .05 && t > 2.35)
     this.once('meet', () => { this.sound?.('hit', 1.4, 0); this.sparks(0, .14, 1.14, 60, 1.3, 0); this.glass(0, .2, 1.14, 26, 0); this.panels(0, .2, 1.14, 9, 0); this.beacon(A); this.beacon(B); this.shake = .85; this.stop = .05; B.state = 'spin'; B.damage = 2; B.vx = R(.4, .6); B.w = -1.6; B.v = flow; B.brake = 1; this.sim.trip(A, -1, .8); A.vx = -.5; A.vy = .62; A.v = flow; A.burn = 1; this.blast(-.12, 1.2, .55, 0); });
   }
   const K = this.sim.cars.find(c => c.kind === 'cop' && c.side === -1 && c.hop);
   if (K && this.fired.has('meet')) {
    K.v = mix(K.v, flow + (1.45 - K.z) * 3, Math.min(1, dt * 6));
    K.vx *= Math.exp(-dt * .9);
   }
   this.settle(dt, park);
  }
  else if (v === 'cargo-plane') {
   // One patrol follows up the ramp and falls short.
   if (!A && !this.fired.has('follow') && t > 1 && t < cargo.takeoff)
    this.sim.make('cop', { side: -1, x: -this.sim.laneX, z: .75, v: flow + 6, tx: -this.sim.laneX, tz: 1.02, hw: chw });
   if (B) {
    B.tx = park;
    B.tz = 1.06;
    B.brake = t > cargo.takeoff ? 1 : 0;
    if (t > cargo.takeoff + .5)
     this.once('slewB', () => { B.state = 'spin'; B.w = -1.5; B.vx = .1; B.v = flow; });
   }
   if (A && A.state === 'drive') {
    if (t > cargo.takeoff - .55) {
     A.hold = 1;
     A.tx = -.2;
     A.tz = 1.02;
    }
    if (t > cargo.takeoff + .42)
     this.once('follow', () => { A.state = 'air'; A.vy = .92; A.y = .16; A.v = flow + 1.25; A.vx = -.06; A.wr = 0; A.yaw = 0; A.roll = 0; A.hop = false; this.shake = .4; this.sparks(A.x, .1, 1, 26, 1); });
   }
   const J = this.sim.cars.find(c => c.kind === 'cop' && c.side === -1 && c.state === 'air' && !c.hop && this.fired.has('follow'));
   if (J) {
    J.yaw = 0;
    if (J.vy < -.15 && !this.fired.has('flip')) {
     this.once('flip', () => { J.state = 'drive'; this.sim.trip(J, 1, .9); J.vy = -.4; J.burn = 1; J.v = flow + 2; J.vx = -.12; this.fired.add('flipped'); });
    }
   }
   const K = this.sim.cars.find(c => c.kind === 'cop' && c.side === -1 && c.hop);
   if (K && this.fired.has('flip')) {
    if (K.z > 2.1)
     K.v = Math.min(K.v, flow + Math.max(0, 2.5 - K.z));
    if (K.y <= .01 && this.fired.has('flip'))
     this.once('fallboom', () => this.blast(K.x, K.z, 1, K.v));
    if (K.state === 'slide' && K.z < 1.9)
     K.v = Math.max(K.v, flow);
    K.z = Math.max(K.z, 1.5);
   }
   this.settle(dt, park);
  }
  else {
   // The right patrol follows the ramp and meets the rockfall, the left one overshoots the exit.
   const z0 = this.exitAt - this.dist, zp = z0 + MOUTH;
   this.landslide(dt, t);
   if (!B && !this.fired.has('clip') && t < tunnel.slide + .2 && t > 1)
    this.sim.make('cop', { side: 1, x: .95, z: Math.max(.7, this.tunnelZ - 1), v: flow + 7, tx: .95, hw: chw, free: true });
   if (B) {
    B.free = true;
    if (t < tunnel.slide)
     B.w = 0;
   }
   if (B && B.state === 'drive') {
    if (t < tunnel.turn + .55) {
     B.tx = this.sim.laneX;
     B.tz = 1.02;
    }
    else {
     B.free = true;
     B.hold = 1;
     const on = B.z - z0;
     B.tz = Math.min(zp + .2, 1.1 + (t - tunnel.turn - .55) * 1.35);
     B.tx = on > 0 ? Math.max(.9, this.rampX(on)) : mix(this.sim.laneX, .96, ease((t - tunnel.turn - .4) / .8));
     B.nose = on > 0 && B.z < zp - .7 ? .3 : .1;
    }
    if (t < 3.4) {
     const lim = Math.max(.98, this.tunnelZ - .5);
     if (B.z > lim) {
      B.v = Math.min(B.v, flow - (B.z - lim) * 9);
     }
    }
    if (t > tunnel.slide + .35 && B.z > zp - .62)
     this.once('clip', () => { this.sim.trip(B, -1, .85); B.vx = -.42; B.vy = .75; B.v = flow; B.burn = 1; this.blast(B.x, zp - .5, .9, 0); this.panels(B.x, .15, zp - .5, 8, 0); this.shake = .8; });
   }
   const K = this.sim.cars.find(c => c.kind === 'cop' && c.side === 1 && c.hop);
   if (K && this.fired.has('clip')) {
    K.free = true;
    K.v = flow + clamp((zp - .95 - K.z) * 3, -1.2, 1.2);
    K.vx *= Math.exp(-dt * .7);
   }
   if (A) {
    A.tx = this.camX - park;
    A.tz = 1.08;
    A.free = true;
    if (A.z > 1.3)
     A.v = Math.min(A.v, flow - (A.z - 1.3) * 6);
    A.brake = t > tunnel.turn + .3 ? 1 : 0;
    if (t > tunnel.turn + .7)
     this.once('slewB', () => { A.state = 'spin'; A.w = 1.5; A.vx = -.05; A.v = flow; });
   }
   this.settle(dt, park);
  }
 }
}
