import { clamp, outCubic } from './scene-kit';
import { PROPS } from './scene-sprites';
import { type Car, type Prop } from './pursuit';
import { SceneActors } from './scene-actors';
export abstract class SceneEffects extends SceneActors {
 protected drawBooms() { for (const b of this.booms) {
  const p = this.at(b.x, b.z), q = b.age, size = b.size * this.R * .62 * p.s * (.4 + .6 * outCubic(q / .28)) * (1 + q * .12), al = q < .35 ? 1 : clamp(1 - (q - .35) / .9);
  if (al <= 0)
   continue;
  const c = this.c;
  c.save();
  c.globalAlpha = al;
  c.drawImage(this.img.explosion, 43, 37, 1459, 928, p.x - size / 2, p.y + size * .04 - size * .636, size, size * .636);
  c.restore();
  this.add(this.flame, p.x, p.y - size * .2, size * .7, al * .4);
 } }
 protected drawBits(front: boolean) {
  const c = this.c;
  for (const b of this.bits.list) {
   if (b.front !== front)
    continue;
   const p = this.at(b.x, b.z, b.y), t = b.age / b.life, s = b.size * this.R * p.s, a = b.alpha * clamp(t < .12 ? t / .12 : 1 - (t - .12) / .88) * clamp((b.z - .42) * 5);
   if (a < .01)
    continue;
   if (b.kind === 'puff') {
    const set = [this.smoke, this.dust, this.black][b.tint];
    c.globalAlpha = a;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(b.rot);
    c.drawImage(set[b.k], -s, -s, s * 2, s * 2);
    c.restore();
   }
   else if (b.kind === 'fire') {
    const set = t < .45 ? this.hot : this.ember, k = 1 - t * .45;
    c.globalAlpha = a;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(Math.sin(b.rot + t * 4) * .35);
    c.drawImage(set[b.k], -s * k, -s * 1.5 * k, s * 2 * k, s * 3 * k);
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = a * .5 * (1 - t);
    c.drawImage(this.flame, -s * 1.2, -s * 1.4, s * 2.4, s * 2.8);
    c.restore();
   }
   else if (b.kind === 'spark') {
    const q = this.at(b.x - b.vx * .03, b.z, b.y - b.vy * .03);
    c.globalAlpha = a;
    c.strokeStyle = t < .4 ? '#fff3c9' : '#ffb04a';
    c.lineWidth = Math.max(1, s);
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(q.x, q.y);
    c.stroke();
   }
   else {
    c.globalAlpha = a;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(b.rot);
    c.scale(1, Math.max(.25, Math.abs(Math.cos(b.rot * 1.7))));
    if (b.kind === 'cone') {
     c.fillStyle = '#e8692c';
     c.beginPath();
     c.moveTo(0, -s);
     c.lineTo(s * .5, s * .8);
     c.lineTo(-s * .5, s * .8);
     c.fill();
     c.fillStyle = '#f4efe2';
     c.fillRect(-s * .3, -s * .05, s * .6, s * .3);
     c.fillStyle = '#b64a1a';
     c.fillRect(-s * .7, s * .75, s * 1.4, s * .2);
    }
    else if (b.kind === 'chip') {
     const sheet = this.img['route-props'];
     if (sheet && b.tint !== 1) {
      const [sx, sy, sw, sh] = PROPS[3];
      c.drawImage(sheet, sx + sw * (.1 + b.k * .2), sy + sh * .1, sw * .18, sh * .6, -s, -s * .8, s * 2, s * 1.6);
     }
     else {
      c.fillStyle = b.k % 2 ? '#cfc6b3' : '#a39a88';
      c.beginPath();
      c.moveTo(-s, -s * .5);
      c.lineTo(s * .6, -s * .8);
      c.lineTo(s, s * .4);
      c.lineTo(-s * .5, s * .7);
      c.fill();
     }
    }
    else if (b.kind === 'shard') {
     c.fillStyle = b.tint === 1 ? '#ff5a44' : b.tint === 2 ? '#58a2ff' : b.k % 2 ? '#d7e6ea' : '#9fb4ba';
     c.beginPath();
     c.moveTo(-s, -s * .5);
     c.lineTo(s, -s * .2);
     c.lineTo(s * .1, s);
     c.fill();
    }
    else {
     const g = c.createLinearGradient(-s, -s, s, s);
     g.addColorStop(0, b.tint === 1 ? '#f2efe6' : '#5d5c5a');
     g.addColorStop(.45, b.tint === 1 ? '#cfcabd' : '#23242a');
     g.addColorStop(1, b.tint === 1 ? '#8f8a7e' : '#101114');
     c.fillStyle = g;
     c.beginPath();
     c.moveTo(-s, -s * .35);
     c.lineTo(s * .8, -s * .5);
     c.lineTo(s, s * .2);
     c.lineTo(-s * .6, s * .45);
     c.closePath();
     c.fill();
     c.strokeStyle = '#8d8678';
     c.lineWidth = 1;
     c.stroke();
    }
    c.restore();
   }
  }
  c.globalAlpha = 1;
 }
 protected tireSmoke(x: number, n: number, power = 1, tint = 0, z = this.carZ, v = -1) { for (let i = 0; i < n; i++)
  this.bits.add({ kind: 'puff', x: x + this.bits.rand(-.03, .03), y: .03, z: z - .02, vx: this.bits.rand(-.3, .3) + Math.sign(x - this.carX) * .18, vy: this.bits.rand(.03, .14), vz: this.bits.rand(-.2, .02) + (v < 0 ? 0 : v * .95), life: this.bits.rand(.5, 1.1), size: .045 * power, grow: .13 * power, spin: this.bits.rand(-1, 1), alpha: .24 * Math.min(1.2, power), tint, front: this.bits.rand() < .3, pin: v < 0 }); }
 protected sparks(x: number, y: number, z: number, n: number, power = 1, v = -1) { const fwd = v < 0 ? this.vel * .86 : v; for (let i = 0; i < n; i++)
  this.bits.add({ kind: 'spark', x, y, z, vx: this.bits.rand(-1.4, 1.4) * power, vy: this.bits.rand(.2, 1.5) * power, vz: fwd + this.bits.rand(-1.6, .6), life: this.bits.rand(.25, .7), size: .0035, gravity: 3.4, bounce: .4, pin: false }); }
 protected dustRing(x: number, z: number, n: number, power = 1, tint = 1, v = -1) { for (let i = 0; i < n; i++) {
  const a = i / n * 6.28 + this.bits.rand(0, .4);
  this.bits.add({ kind: 'puff', x: x + Math.cos(a) * .1, y: .02, z: z + Math.sin(a) * .08, vx: Math.cos(a) * .9 * power, vy: this.bits.rand(.02, .15), vz: Math.sin(a) * .5 * power + (v < 0 ? 0 : v * .93), life: this.bits.rand(.7, 1.4), size: .06 * power, grow: .2 * power, alpha: .34, tint, front: Math.sin(a) < 0, pin: v < 0 });
 } }
 protected trail(c: Car, dt: number) {
  const R = (a = 0, b = 1) => this.bits.rand(a, b);
  if (c.burn > 0) {
   if (R() < dt * 30)
    this.bits.add({ kind: 'fire', x: c.x + R(-.08, .08), y: c.y + R(.08, .2), z: c.z, vy: R(.2, .4), vz: c.v, life: R(.25, .6), size: R(.035, .07), alpha: 1, front: R() < .4, vx: R(-.05, .05) });
   if (R() < dt * 16)
    this.bits.add({ kind: 'puff', x: c.x, y: c.y + .2, z: c.z, vx: R(-.05, .12), vy: R(.25, .45), vz: c.v * .9, life: R(1, 2), size: .06, grow: .14, alpha: .7, tint: 2, front: false });
  }
  else if (c.damage > 1.2 && R() < dt * 9)
   this.bits.add({ kind: 'puff', x: c.x, y: c.y + .22, z: c.z, vy: R(.15, .3), vz: c.v, life: R(.5, 1), size: .035, grow: .1, alpha: .34, tint: 0, front: false });
 }
 protected mark(x: number, z: number, w: number) { if (z > .9 && z < 9) {
  if (this.skid.length > 360)
   this.skid.shift();
  this.skid.push({ x, z, w, l: clamp(this.vel / 60 * 1.7, .035, .8) });
 } }
 protected glass(x: number, y: number, z: number, n: number, v = this.vel * .9) { for (let i = 0; i < n; i++)
  this.bits.add({ kind: 'shard', x, y, z, vx: this.bits.rand(-.9, .9), vy: this.bits.rand(.3, 1.2), vz: v + this.bits.rand(-2, 1.5), life: this.bits.rand(.5, 1.1), size: this.bits.rand(.003, .007), spin: this.bits.rand(-12, 12), gravity: 3, bounce: .3 }); }
 protected panels(x: number, y: number, z: number, n: number, v = this.vel * .85) { for (let i = 0; i < n; i++)
  this.bits.add({ kind: 'panel', x, y, z, vx: this.bits.rand(-.9, .9), vy: this.bits.rand(.6, 1.6), vz: v + this.bits.rand(-2, 2), life: this.bits.rand(.9, 1.8), size: this.bits.rand(.01, .026), spin: this.bits.rand(-10, 10), gravity: 2.9, bounce: .36, tint: this.bits.rand() < .4 ? 1 : 0 }); }
 /** The broken light bar scatters in its own colours. */
 protected beacon(c: Car) { for (let i = 0; i < 10; i++)
  this.bits.add({ kind: 'shard', x: c.x + this.bits.rand(-.06, .06), y: c.y + .36, z: c.z, vx: this.bits.rand(-.8, .8), vy: this.bits.rand(.5, 1.3), vz: c.v + this.bits.rand(-2, 2), life: this.bits.rand(.7, 1.4), size: this.bits.rand(.005, .011), spin: this.bits.rand(-12, 12), gravity: 3, bounce: .35, tint: i % 2 ? 1 : 2 }); }
 protected smash(p: Prop, v: number) {
  const n = p.kind === 'board' ? 14 : 1;
  this.shake = Math.max(this.shake, p.kind === 'board' ? .6 : .12);
  if (p.kind === 'cone') {
   this.bits.add({ kind: 'cone', x: p.x, y: .05, z: p.z, vx: (p.x - this.carX) * 4 + this.bits.rand(-.6, .6), vy: this.bits.rand(.8, 1.5), vz: v * 1.12, life: 1.6, size: .045, spin: this.bits.rand(-14, 14), gravity: 2.8, bounce: .45 });
   return;
  }
  for (let i = 0; i < n; i++)
   this.bits.add({ kind: 'chip', x: p.x + this.bits.rand(-.24, .24), y: this.bits.rand(.04, .2), z: p.z, vx: this.bits.rand(-1.3, 1.3), vy: this.bits.rand(.5, 1.7), vz: v * this.bits.rand(.85, 1.25), life: this.bits.rand(1, 1.8), size: this.bits.rand(.018, .05), spin: this.bits.rand(-9, 9), gravity: 2.9, bounce: .35 });
  this.dustRing(p.x, p.z, 16, 1, 1, v * .9);
  this.sparks(p.x, .12, p.z, 20, 1);
 }
 protected blast(x: number, z: number, size: number, v: number) { this.booms.push({ x, z, age: 0, size, v }); this.sound?.('blast', clamp(size / Math.max(1, z * .6), .2, 1), clamp(x, -1)); this.shake = Math.max(this.shake, .8 / Math.max(1, z * .5)); const R = (a: number, b: number) => this.bits.rand(a, b); for (let i = 0; i < 12; i++)
  this.bits.add({ kind: 'puff', x: x + R(-.1, .1), y: R(.1, .3), z, vx: R(-.5, .5), vy: R(.25, .8), vz: v * .8, life: R(.9, 1.8), size: R(.06, .12), grow: R(.15, .25), alpha: .75, tint: 2, front: false }); this.sparks(x, .15, z, 26, 1.5, v); this.panels(x, .2, z, 6, v); }
 protected onHit(x: number, y: number, z: number, p: number, _side: number) { this.sparks(x, y, z, Math.round(10 + 16 * p), .6 + p * .5); this.glass(x, y + .05, z, Math.round(2 + 6 * p)); if (p > .7)
  this.panels(x, y, z, Math.round(p * 2)); this.shake = Math.max(this.shake, clamp(.18 + p * .28, 0, .75) / Math.max(1, z * .7)); this.stop = Math.max(this.stop, p > 1 ? .05 : 0); this.sound?.('hit', clamp(p / Math.max(1, z * .6), .15, 1.4), clamp(x, -1)); }
 protected onScrape(x: number, z: number, side: number, p: number) { if (this.bits.rand() < .75 * p) {
  this.sparks(x - side * .02, .08, z, 2, .7);
  this.sound?.('scrape', .4 / Math.max(1, z * .6), side);
 } }
 protected onContact(c: Car, p: number) { this.dustRing(c.x, c.z, 8, .55 + p * .4, 1, c.v); this.sparks(c.x, .05, c.z, 9, .8, c.v); this.panels(c.x, .1, c.z, 2, c.v); this.glass(c.x, .15, c.z, 4, c.v); this.shake = Math.max(this.shake, .35 / Math.max(1, c.z * .6)); this.mark(c.x, c.z, .16); this.sound?.('contact', clamp(p / Math.max(1, c.z * .6), .1, 1), clamp(c.x, -1)); }
 protected onWreck(c: Car) { if (c.kind === 'cop')
  this.beacon(c); if (this.bits.rand() < .45)
  c.burn = 1; }
 protected onBoom(x: number, z: number, size: number, v: number) { this.blast(x, z, size, v); }
 protected onSmash(p: Prop, v: number) { this.smash(p, v); if (p.kind === 'board')
  this.sound?.('smash', 1, clamp(p.x, -1)); }
 protected onHero(p: number) { this.shake = Math.max(this.shake, clamp(.25 + p * .25, 0, .8)); this.kick = Math.max(this.kick, .4); this.scuff = Math.min(6, this.scuff + p * .35); }
}
