import { clamp, mix, rng, quad, line } from './scene-kit';
import { PROPS, PROP_H } from './scene-sprites';
import { zones } from './route';
import { SceneBase } from './scene-base';
export abstract class SceneRoad extends SceneBase {
 protected backdrop() {
  const { c, w, h, hy } = this;
  let acc = 0;
  for (let i = 0; i < 4; i++) {
   const k = this.weights[i], p = this.img['route-' + zones[i].key];
   if (k < .001 || !p)
    continue;
   const hp = zones[i].horizon, sc = Math.max(w * 1.06 / p.naturalWidth, hy * 1.02 / (p.naturalHeight * hp), (h - hy) * .9 / (p.naturalHeight * (1 - hp))), bw = p.naturalWidth * sc, bh = p.naturalHeight * sc;
   c.globalAlpha = k / (acc + k);
   c.drawImage(p, this.vpx - bw / 2 - this.camX * w * .01, hy - bh * hp, bw, bh);
   acc += k;
  }
  c.globalAlpha = 1;
 }
 protected ground(flow: number) {
  const { c, w, h, hy, G, R } = this;
  const W = this.weights;
  const sum = (f: (z: typeof zones[number]) => number) => zones.reduce((a, z, i) => a + f(z) * W[i], 0);
  const col = [0, 1, 2].map(k => Math.round(sum(z => z.ground[k]))).join(',');
  for (const side of [0, 1]) {
   const a = sum(z => z.side[side]);
   if (a < .02)
    continue;
   c.save();
   c.beginPath();
   const far = this.at(side ? 1.2 : -1.2, 60), near = this.at(side ? 1.2 : -1.2, .97);
   c.moveTo(far.x, far.y);
   c.lineTo(near.x, near.y);
   c.lineTo(side ? w + 400 : -400, near.y);
   c.lineTo(side ? w + 400 : -400, far.y);
   c.closePath();
   c.clip();
   const g = c.createLinearGradient(0, hy, 0, h);
   g.addColorStop(0, `rgba(${col},0)`);
   g.addColorStop(.1, `rgba(${col},${.25 * a})`);
   g.addColorStop(.38, `rgba(${col},${a})`);
   g.addColorStop(1, `rgba(${col},${a})`);
   c.fillStyle = g;
   c.fillRect(-20, hy, w + 40, G + 2);
   for (let y = Math.floor(hy + G * .06); y < h && this.quality < 1; y += 2) {
    const s = (y + 1 - hy) / G, z = 1 / s, foot = z * z / G * 64 + flow * .18, m = clamp(Math.round(Math.log2(Math.max(1, foot))), 0, 6), t = this.gravel[m], u = ((this.dist + z) * 64 % 512 + 512) % 512 / 512 * t.height;
    c.globalAlpha = a * .5 * clamp((s - .06) * 4);
    const span = R * s * 2.6, x0 = this.vpx - this.camX * R * s;
    for (let x = x0 - Math.ceil((x0 + 10) / span) * span; x < w + 10; x += span)
     c.drawImage(t, 0, Math.min(t.height - 1, Math.floor(u)), 512, 1, x, y, span + 1, 2.3);
   }
   c.restore();
  }
  // Asphalt rows use true inverse depth and a speed-dependent mip.
  for (let y = Math.floor(hy) + 1; y < h + 2;) {
   const s = Math.max(.004, (y + .5 - hy) / G), z = 1 / s, step = s < .12 ? 1 + (this.quality > 1 ? 1 : 0) : 2 + this.quality, foot = z * z / G * 128 * step + flow * 128 * .02;
   const m = clamp(Math.floor(Math.log2(Math.max(1, foot))), 0, this.road.length - 1), t = this.road[m], u = ((this.dist + z) * 128 % 1024 + 1024) % 1024 / 1024 * t.height;
   c.globalAlpha = clamp((s - .01) * 22);
   const hw = R * s * 1.25, x = this.vpx - this.camX * R * s;
   c.drawImage(t, 0, Math.min(t.height - 1, Math.floor(u)), 1024, 1, x - hw, y, hw * 2, step + .4);
   y += step;
  }
  c.globalAlpha = 1;
  const tint = [0, 1, 2].map(k => Math.round(sum(z => z.tint[k]))).join(',');
  c.save();
  this.roadPath();
  c.clip();
  c.globalCompositeOperation = 'soft-light';
  c.fillStyle = `rgba(${tint},.5)`;
  c.fillRect(0, hy, w, G);
  c.restore();
  const haze = c.createLinearGradient(0, hy - G * .05, 0, hy + G * .3);
  haze.addColorStop(0, '#d9c6a900');
  haze.addColorStop(.17, '#d9c9ac80');
  haze.addColorStop(1, '#d9c6a900');
  c.fillStyle = haze;
  c.fillRect(0, hy - G * .05, w, G * .35);
 }
 protected roadPath() { const c = this.c, a = this.at(-1.25, 200), b = this.at(1.25, 200), d = this.at(1.25, .95), e = this.at(-1.25, .95); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath(); }
 /** Barrier joints travel with the road; a gap opens on the left for the coast exit. */
 protected barrier(gap?: {
  from: number;
  to: number;
 }) {
  const c = this.c, steel = this.weights[2], step = 2.5, off = this.dist % step;
  for (const side of [-1, 1])
   for (let j = 16; j >= 0; j--) {
    let z1 = j * step - off + .55, z2 = z1 + step;
    if (z2 < .72)
     continue;
    z1 = Math.max(z1, .6);
    if (gap && side > 0) {
     if (z1 > gap.from && z2 < gap.to)
      continue;
     if (z1 < gap.from && z2 > gap.from)
      z2 = gap.from;
     else if (z1 < gap.to && z2 > gap.to)
      z1 = gap.to;
    }
    const X = side * 1.17, a = this.at(X, z1), b = this.at(X, z2), H = .17, at = this.at(X, z1, H), bt = this.at(X, z2, H), ao = this.at(X + side * .075, z1, H), bo = this.at(X + side * .075, z2, H);
    const fade = clamp((34 - z1) / 10);
    if (steel < .99) {
     c.globalAlpha = (1 - steel) * fade;
     const g = c.createLinearGradient(0, at.y, 0, a.y);
     g.addColorStop(0, '#cfc6b3');
     g.addColorStop(.5, '#b1a896');
     g.addColorStop(1, '#857d6d');
     c.fillStyle = g;
     quad(c, at, bt, b, a);
     c.fillStyle = '#e6dcc6';
     quad(c, at, bt, bo, ao);
     const calm = clamp((this.vel - 8) / 10);
     c.strokeStyle = '#5f594c';
     c.globalAlpha = (1 - steel) * fade * mix(.53, .18, calm);
     c.lineWidth = Math.max(.5, a.s * 2.4);
     line(c, at, a);
     c.globalAlpha = (1 - steel) * fade * mix(1, .45, calm);
     c.fillStyle = (j + Math.floor(this.dist / step)) % 2 ? '#f0d890' : '#d98b4a';
     const rw = Math.max(1, a.s * this.R * .012), rh = Math.max(1, a.s * this.U * .03);
     c.fillRect(a.x - side * rw * 1.4, at.y + (a.y - at.y) * .25, rw, rh);
     c.globalAlpha = (1 - steel) * fade;
     c.strokeStyle = '#40392c55';
     c.lineWidth = Math.max(.5, a.s * 3);
     const q = .62;
     line(c, { x: mix(at.x, a.x, q), y: mix(at.y, a.y, q) }, { x: mix(bt.x, b.x, q), y: mix(bt.y, b.y, q) });
    }
    if (steel > .01) {
     c.globalAlpha = steel * fade;
     c.strokeStyle = '#59605b';
     c.lineWidth = Math.max(.8, a.s * this.R * .012);
     line(c, a, at);
     for (const [k, col, lw] of [[.95, '#e3e4d8', .03], [.82, '#8f978f', .022], [.68, '#c9ccbf', .03]] as const) {
      c.strokeStyle = col;
      c.lineWidth = Math.max(1, a.s * this.U * lw);
      line(c, { x: mix(a.x, at.x, k), y: mix(a.y, at.y, k) }, { x: mix(b.x, bt.x, k), y: mix(b.y, bt.y, k) });
     }
    }
   }
  c.globalAlpha = 1;
 }
 protected scenery(flow: number, gap?: {
  from: number;
  to: number;
 }) {
  const sheet = this.img['route-props'];
  if (!sheet)
   return;
  const c = this.c, gapZ = 3.4, n = 12;
  const items: {
   z: number;
   k: number;
   i: number;
  }[] = [];
  const base = Math.floor(this.dist / gapZ);
  for (let j = n; j >= 0; j--) {
   const i = base + j, z = i * gapZ - this.dist + gapZ * .35;
   if (z < .68)
    continue;
   items.push({ z, k: i, i: j });
  }
  for (const it of items)
   for (let zn = 0; zn < 4; zn++) {
    const wt = this.weights[zn];
    if (wt < .01)
     continue;
    for (const side of [-1, 1]) {
     if (zn === 3 && side < 0)
      continue;
     const r = rng(it.k * 131 + (side > 0 ? 7 : 3) + zn * 17)();
     const pk = zones[zn].props[(it.k + (side > 0 ? 1 : 0)) % 2 === 0 ? 0 : 1], [sx, sy, sw, sh] = PROPS[pk];
     if (side > 0 && gap && it.z > gap.from - .9 && it.z < gap.from + 9)
      continue;
     const z = it.z + (side > 0 ? gapZ * .45 : 0) + r * .8;
     if (z < .68)
      continue;
     const H = PROP_H[pk] * (.9 + r * .25), wx = H * this.U * sw / sh / this.R, X = side * (1.36 + wx / 2 + r * .35), p = this.at(X, z), ph = H * this.U * p.s, pw = ph * sw / sh;
     if (p.x + pw < -40 || p.x - pw > this.w + 40)
      continue;
     const a = wt * clamp((38 - z) / 12) * clamp((z - .66) * 8);
     if (a < .01)
      continue;
     c.globalAlpha = a * .35;
     c.fillStyle = '#2a251a';
     c.beginPath();
     c.ellipse(p.x + pw * .1, p.y, pw * .55, Math.max(1, pw * .06), 0, 0, 7);
     c.fill();
     if (flow > 8 && z < 2.2) {
      c.globalAlpha = a * .16;
      c.drawImage(sheet, sx, sy, sw, sh, p.x - pw / 2 - side * pw * .1, p.y - ph * 1.03, pw * 1.05, ph * 1.03);
     }
     c.globalAlpha = a;
     c.drawImage(sheet, sx, sy, sw, sh, p.x - pw / 2, p.y - ph, pw, ph);
    }
   }
  c.globalAlpha = 1;
 }
 /** An overpass hides each change of location behind its own underside. */
 protected overpass(back: boolean) {
  if (this.bridge < -12)
   return;
  const c = this.c, z1 = this.bridge, depth = 9, z2 = z1 + depth, H = 1.42, T = .34, w = this.w;
  if (z2 < .75)
   return;
  const sheet = this.img['route-props'];
  const pillar = (z: number) => { if (z < .62 || !sheet)
   return; for (const side of [-1, 1]) {
   const p = this.at(side * 1.62, z), ph = H * this.U * p.s, pw = ph * .34;
   c.drawImage(sheet, 1058, 110, 100, 320, p.x - pw / 2, p.y - ph, pw, ph);
   const g = c.createLinearGradient(p.x - pw / 2, 0, p.x + pw / 2, 0);
   g.addColorStop(0, side < 0 ? '#0000' : '#1a1712aa');
   g.addColorStop(1, side < 0 ? '#1a1712aa' : '#0000');
   c.fillStyle = g;
   c.fillRect(p.x - pw / 2, p.y - ph, pw, ph);
  } };
  if (back) { // deck shadow on the road
   const n1 = Math.max(.7, z1 - 1), n2 = z2 - 1.4;
   if (n2 > .75) {
    const a = this.at(0, n2), b = this.at(0, n1);
    const g = c.createLinearGradient(0, a.y, 0, b.y);
    g.addColorStop(0, '#1512104d');
    g.addColorStop(.15, '#15121099');
    g.addColorStop(.9, '#15121099');
    g.addColorStop(1, '#15121000');
    c.fillStyle = g;
    c.fillRect(0, a.y, w, Math.max(0, b.y - a.y));
   }
   return;
  }
  for (const z of [z2 - .6, z1 + depth * .5, z1 + .5])
   pillar(z);
  const bb = this.at(0, z2, H).y, f1 = z1 > .7 ? this.at(0, z1, H).y : -this.h;
  if (bb > -10) { // underside
   const g = c.createLinearGradient(0, Math.min(f1, bb - 1), 0, bb);
   g.addColorStop(0, '#17140f');
   g.addColorStop(1, '#4b463b');
   c.fillStyle = g;
   c.fillRect(0, Math.min(f1, bb), w, Math.abs(bb - f1));
   c.strokeStyle = '#0c0a0799';
   for (let k = 0; k < 9; k++) {
    const z = z1 + k * depth / 9;
    if (z < .7)
     continue;
    const y = this.at(0, z, H).y;
    if (y < -4)
     continue;
    c.lineWidth = Math.max(1, this.U * .07 / z);
    line(c, { x: 0, y }, { x: w, y });
   }
   for (const X of [-.8, 0, .8]) {
    const a = this.at(X, Math.max(.7, z1), H), b = this.at(X, z2, H);
    c.strokeStyle = '#0c0a0766';
    c.lineWidth = 3;
    line(c, a, b);
   }
   c.fillStyle = '#fff2cf33';
   c.fillRect(0, bb - 1, w, 2);
  }
  if (z1 > .66) {
   const top = this.at(0, z1, H + T).y, bot = f1;
   if (bot > -5) {
    const g = c.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, '#d8cfba');
    g.addColorStop(.12, '#b9b09c');
    g.addColorStop(.8, '#8c8472');
    g.addColorStop(1, '#5e574a');
    c.fillStyle = g;
    c.fillRect(0, top, w, bot - top);
    c.strokeStyle = '#5e574a88';
    c.lineWidth = Math.max(1, 2 / z1);
    const st = this.R * .5 / z1;
    for (let x = this.vpx - Math.ceil(this.vpx / st) * st; x < w; x += st)
     line(c, { x, y: top }, { x, y: bot });
    const rail = this.at(0, z1, H + T + .16).y;
    c.fillStyle = '#8f887a';
    c.fillRect(0, rail, w, Math.max(1, 3 / z1));
    for (let x = this.vpx - Math.ceil(this.vpx / st) * st; x < w; x += st / 3)
     c.fillRect(x, rail, Math.max(1, 2 / z1), top - rail);
   }
  }
 }
 protected lensFlare() {
  const c = this.c;
  let a = 0, sx = 0, sy = 0;
  zones.forEach((z, i) => { if (z.sun && this.weights[i] > .05) {
   a = this.weights[i];
   sx = z.sun[0] * this.w;
   sy = z.sun[1] * this.h;
  } });
  if (a < .05)
   return;
  if (this.bridge > -11 && this.bridge < 2)
   a = 0;
  if (a < .05)
   return;
  const x = sx + (this.vpx - this.w / 2) * .5, y = sy, cx = this.w / 2, cy = this.h * .55;
  c.save();
  c.globalCompositeOperation = 'screen';
  c.globalAlpha = .5 * a;
  const S = this.h * 1.1;
  c.drawImage(this.white, x - S / 2, y - S / 2, S, S);
  for (const [t, r, k] of [[.45, .05, .16], [.72, .1, .1], [1.15, .035, .2], [1.45, .16, .08]] as const) {
   const px = mix(x, cx, t), py = mix(y, cy, t), s = this.h * r;
   c.globalAlpha = k * a;
   const gr = c.createRadialGradient(px, py, s * .3, px, py, s);
   gr.addColorStop(0, t > 1 ? '#ffd9a022' : '#cfe3ff22');
   gr.addColorStop(.85, t > 1 ? '#ffd9a0' : '#cfe3ff');
   gr.addColorStop(1, '#ffffff00');
   c.fillStyle = gr;
   c.fillRect(px - s, py - s, s * 2, s * 2);
  }
  c.restore();
 }
 protected haze(oy: number) { if (this.shake > .2 || this.quality > 0)
  return; const c = this.c, d = this.canvas.width / this.w, y0 = this.hy + oy - this.h * .012, n = 12, sh = this.h * .004; c.save(); c.setTransform(d, 0, 0, d, 0, 0); for (let i = 0; i < n; i++) {
  const y = y0 + i * sh, dx = Math.sin(this.clock * 5 + i * .9) * 1.1 * (1 - i / n);
  c.drawImage(this.canvas, 0, y * d, this.canvas.width, Math.ceil(sh * d), dx, y, this.w, sh + .4);
 } c.restore(); }
}
