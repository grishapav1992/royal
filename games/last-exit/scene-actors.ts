import { clamp, mix, rng, round } from './scene-kit';
import { PROPS, YAW, RAM, ROLL, BOX } from './scene-sprites';
import { type Car, type Prop } from './pursuit';
import { SceneRoad } from './scene-road';
export abstract class SceneActors extends SceneRoad {
 /** Traffic reuses the coupe with repainted bodywork. Glass, rubber, lamps and chrome keep their own colour. */
 protected paintTraffic() {
  const colors = [[0, 0, 0], [150, 38, 32], [44, 84, 132], [158, 152, 138]];
  this.tints = colors.map((rgb, k) => {
   const out: Record<string, HTMLCanvasElement> = {};
   if (!k)
    return out;
   for (const name of ['coupe', 'coupe-depth-roll', 'coupe-yaw']) {
    const im = this.img[name];
    if (!im)
     continue;
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth >> 1;
    cv.height = im.naturalHeight >> 1;
    const g = cv.getContext('2d')!;
    g.drawImage(im, 0, 0, cv.width, cv.height);
    const d = g.getImageData(0, 0, cv.width, cv.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
     if (a[i + 3] < 8)
      continue;
     const r = a[i], gg = a[i + 1], b = a[i + 2], lum = .3 * r + .6 * gg + .1 * b, sat = Math.max(r, gg, b) - Math.min(r, gg, b), m = clamp((lum - 30) / 26) * clamp((150 - lum) / 40) * clamp((46 - sat) / 18);
     if (m <= 0)
      continue;
     const q = Math.pow(lum / 74, .85);
     a[i] = mix(r, rgb[0] * q, m);
     a[i + 1] = mix(gg, rgb[1] * q, m);
     a[i + 2] = mix(b, rgb[2] * q, m);
    }
    g.putImageData(d, 0, 0);
    out[name] = cv;
   }
   return out;
  });
 }
 protected shadow(x: number, y: number, w: number, a: number) { if (a <= 0)
  return; const c = this.c, g = c.createRadialGradient(0, 0, 0, 0, 0, w * .56); c.save(); c.translate(x, y); c.scale(1, .16); g.addColorStop(0, `rgba(16,14,10,${a})`); g.addColorStop(.6, `rgba(16,14,10,${a * .7})`); g.addColorStop(1, 'rgba(16,14,10,0)'); c.fillStyle = g; c.fillRect(-w * .6, -w * .6, w * 1.2, w * 1.2); c.restore(); }
 protected body(name: string, x: number, foot: number, w: number, angle = 0, bright = 1) { const i = this.img[name]; if (!i)
  return; const [sx, sy, sw, sh] = BOX[name], h = w * sh / sw, c = this.c; c.save(); c.translate(x, foot); c.rotate(angle); c.drawImage(i, sx, sy, sw, sh, -w / 2, -h, w, h); if (bright < 1) {
  c.globalAlpha = clamp((1 - bright) * 1.2);
  c.drawImage(this.shadeOf(name), sx / 2, sy / 2, sw / 2, sh / 2, -w / 2, -h, w, h);
 } c.restore(); }
 protected add(g: HTMLCanvasElement, x: number, y: number, r: number, a: number) { if (a <= .01)
  return; const c = this.c; c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = Math.min(1, a); c.drawImage(g, x - r, y - r, r * 2, r * 2); c.restore(); }
 protected police(x: number, foot: number, w: number, angle: number, brake: number, quiet: boolean, lights = 1) {
  this.shadow(x, foot - w * .02, w * 1.05, .5);
  this.body('patrol', x, foot, w, angle);
  if (!lights)
   return;
  const h = w * .774, t = quiet ? 0 : this.clock, p = Math.sin(t * 9);
  const flashR = quiet ? .5 : clamp(p * 3), flashB = quiet ? .5 : clamp(-p * 3);
  this.add(this.red, x - w * .17, foot - h * .965, w * .2, .35 + .55 * flashR);
  this.add(this.blue, x + w * .17, foot - h * .965, w * .2, .35 + .55 * flashB);
  // light spills on the asphalt
  const c = this.c;
  c.save();
  c.globalCompositeOperation = 'screen';
  c.globalAlpha = .16;
  c.translate(x, foot);
  c.scale(1, .22);
  c.drawImage(p > 0 ? this.red : this.blue, -w * .9, -w * .9, w * 1.8, w * 1.8);
  c.restore();
  if (brake > .02)
   for (const s of [-1, 1])
    this.add(this.red, x + s * w * .34, foot - h * .5, w * .2, brake);
 }
 protected drawProp(p: Prop) { const c = this.c, q = this.at(p.x, p.z), a = clamp((34 - p.z) / 8); if (a <= 0)
  return; c.globalAlpha = a; if (p.kind === 'board') {
  const sheet = this.img['route-props'];
  if (sheet) {
   const [sx, sy, sw, sh] = PROPS[3], pw = p.w * this.R * q.s, ph = pw * sh / sw;
   this.shadow(q.x, q.y, pw, .4);
   c.globalAlpha = a;
   c.drawImage(sheet, sx, sy, sw, sh, q.x - pw / 2, q.y - ph, pw, ph);
  }
 }
 else {
  const s = .045 * this.R * q.s;
  c.fillStyle = '#e8692c';
  c.beginPath();
  c.moveTo(q.x, q.y - s * 1.9);
  c.lineTo(q.x + s * .55, q.y);
  c.lineTo(q.x - s * .55, q.y);
  c.fill();
  c.fillStyle = '#f4efe2';
  c.fillRect(q.x - s * .3, q.y - s * 1.05, s * .6, s * .36);
  c.fillStyle = '#b64a1a';
  c.fillRect(q.x - s * .75, q.y - s * .14, s * 1.5, s * .16);
 } c.globalAlpha = 1; }
 /** Pose comes from the body state: rear, two quarter views, side, or a roll about the long axis. */
 protected drawCar(k: Car, quiet: boolean) {
  const c = this.c, p = this.at(k.x, k.z), cop = k.kind === 'cop', base = (cop ? this.copW : this.carW * .9) * this.carZ * p.s, fade = clamp((46 - k.z) / 10);
  if (fade <= 0 || p.x < -base * 2 || p.x > this.w + base * 2)
   return;
  const lift = k.y * this.U * p.s, foot = p.y - lift, ay = Math.abs(k.yaw), dir = Math.sign(k.yaw) || 1, tumbling = k.state === 'air' && k.hop || k.state === 'slide' && Math.abs(k.roll) > .2;
  this.shadow(p.x, p.y, base * (1 + .5 * Math.sin(Math.min(1.5, ay))) * (1 - clamp(k.y) * .4), .5 * (1 - clamp(k.y * .9)));
  c.save();
  c.globalAlpha = fade;
  if (tumbling) {
   const draw = (roll: number, alpha: number) => {
    const turn = ((roll / (Math.PI * 2)) % 1 + 1) % 1, sideW = base * 1.6;
    c.save();
    c.globalAlpha = fade * alpha;
    c.translate(p.x, foot);
    c.scale(cop ? dir : -dir, 1);
    if (cop) {
     const co = Math.cos(roll), [sx, sy, sw, sh] = RAM[3], bh = sideW * sh / sw;
     if (co < -.0 && Math.abs(co) < .55 || co >= 0 && co < .3 && Math.sin(roll) > 0) {
      const [a, b, d, e] = ROLL[6], uw = sideW * .98, uh = uw * e / d * .86;
      c.drawImage(this.img['coupe-depth-roll'], a, b, d, e, -uw / 2, -uh, uw, uh);
     }
     else {
      const hh = bh * mix(.66, 1, Math.abs(co));
      if (co < 0) {
       c.translate(0, -hh);
       c.scale(1, -1);
       c.drawImage(this.img['patrol-ram'], sx, sy, sw, sh, -sideW / 2, -hh, sideW, hh);
      }
      else
       c.drawImage(this.img['patrol-ram'], sx, sy, sw, sh, -sideW / 2, -hh, sideW, hh);
     }
    }
    else {
     const [a, b, d, e] = ROLL[Math.round(turn * 8) % 8], cv = this.tints[k.tint]?.['coupe-depth-roll'];
     const dh = sideW * e / d;
     if (cv)
      c.drawImage(cv, a / 2, b / 2, d / 2, e / 2, -sideW / 2, -dh, sideW, dh);
    }
    c.restore();
   };
   if (k.state === 'air' && !quiet)
    draw(k.roll - k.wr * .028, .35);
   draw(k.roll, 1);
  }
  else if (cop && ay < .2) {
   c.restore();
   this.police(p.x, foot, base, clamp(-k.vx * .05, -.045, .045) + (k.state === 'air' ? clamp(-k.vy * .05, -.06, .06) : 0), k.brake, quiet || k.lights === 0 && true, k.lights);
   return;
  }
  else if (cop) {
   const i = ay < .5 ? 1 : ay < 1.15 ? 2 : 3, [sx, sy, sw, sh] = RAM[i], hh = base * .799 * (sh / 338), ww = hh * sw / sh;
   c.translate(p.x, foot);
   c.scale(dir, 1);
   c.drawImage(this.img['patrol-ram'], sx, sy, sw, sh, -ww / 2, -hh, ww, hh);
   c.restore();
   if (k.lights) {
    const q = Math.sin((quiet ? 0 : this.clock) * 9);
    this.add(q > 0 ? this.red : this.blue, p.x - dir * ww * (i === 1 ? .14 : .1), foot - hh * .95, base * .2, .7);
   }
   return;
  }
  else {
   const cv = this.tints[k.tint];
   if (ay < .2) {
    const i = cv?.coupe;
    if (i) {
     const [sx, sy, sw, sh] = BOX.coupe, hh = base * sh / sw;
     c.drawImage(i, sx / 2, sy / 2, sw / 2, sh / 2, p.x - base / 2, foot - hh, base, hh);
    }
   }
   else {
    const n = ay < .5 ? 1 : ay < 1.15 ? 2 : 3, [sx, sy, sw, sh] = YAW[n], i = cv?.['coupe-yaw'], ww = base * 1.25, hh = ww * sh / sw;
    if (i) {
     c.translate(p.x, foot);
     c.scale(-dir, 1);
     c.drawImage(i, sx / 2, sy / 2, sw / 2, sh / 2, -ww / 2, -hh, ww, hh);
    }
   }
  }
  c.restore();
 }
 /** Bodywork scuffs accumulate with contacts and clear on a new run. */
 protected scratches(x: number, foot: number, w: number) { const n = Math.floor(this.scuff * 2.2); if (n < 1)
  return; const c = this.c, r = rng(55); c.save(); c.lineCap = 'round'; for (let i = 0; i < n; i++) {
  const s = r() < .5 ? -1 : 1, px = x + s * w * (.36 + r() * .1), py = foot - w * (.13 + r() * .2), l = w * (.02 + r() * .05);
  c.strokeStyle = r() < .5 ? '#d9d4c899' : '#0a0a0a99';
  c.lineWidth = Math.max(.7, w * .004);
  c.beginPath();
  c.moveTo(px, py);
  c.lineTo(px - s * l, py + (r() - .5) * l * .6);
  c.stroke();
 } c.restore(); }
 protected exhaust(x: number, foot: number, w: number, power: number) { if (power <= .02)
  return; for (const s of [-1, 1]) {
  const px = x + s * w * .223, py = foot - w * .045;
  this.add(this.flame, px, py, w * (.06 + .1 * power), power);
  this.add(this.white, px, py, w * .05, power * .9);
 } }
 /** Final pose without motion: two parked patrols. */
 protected parked(park: number, off = 0) { if (this.sim.cars.length === 2 && this.sim.cars.every(c => c.state === 'drive'))
  return; this.sim.cars = []; for (const side of [-1, 1])
  this.sim.make('cop', { side, x: off + side * park, z: 1.08, tx: off + side * park, yaw: side * -.35, hw: this.copW / this.R / 2 }); }
 protected stillFire(x: number, y: number, w: number) { const c = this.c, r = rng(91); for (let i = 0; i < 7; i++) {
  const s = w * (.1 + r() * .07);
  c.globalAlpha = .8;
  c.drawImage((i % 2 ? this.hot : this.ember)[i % 4], x + (r() - .5) * w * .6 - s, y - w * .2 - s * 1.3 * r() - s, s * 2, s * 3);
 } for (let i = 0; i < 9; i++) {
  const q = i / 9, s = w * (.14 + .3 * q);
  c.globalAlpha = .5 * (1 - q * .7);
  c.drawImage(this.black[i % 4], x + w * .35 * q + (r() - .5) * w * .1 - s, y - w * (.35 + 1.1 * q) - s, s * 2, s * 2);
 } c.globalAlpha = 1; this.add(this.flame, x, y - w * .15, w * .7, .3); }
 protected tail(x: number, foot: number, w: number, a: number) { for (const s of [-1, 1])
  this.add(this.red, x + s * w * .285, foot - w * .265, w * .17, a); }
 protected shadeOf(name: string) { if (this.dark[name])
  return this.dark[name]; const im = this.img[name], cv = document.createElement('canvas'); cv.width = im.naturalWidth >> 1; cv.height = im.naturalHeight >> 1; const g = cv.getContext('2d')!; g.drawImage(im, 0, 0, cv.width, cv.height); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(14,11,8,.8)'; g.fillRect(0, 0, cv.width, cv.height); return this.dark[name] = cv; }
}
