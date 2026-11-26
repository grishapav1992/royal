import { clamp, mix, quad, rng, round } from './scene-kit';
import { PROPS } from './scene-sprites';
import { MODELS, type Model } from './traffic';
import { SceneWheels } from './scene-wheels';
import type { Car } from './pursuit';
type Cv = HTMLCanvasElement;
type G = CanvasRenderingContext2D;
/** Paint colours by model. The first coupe colour belongs to the player and is never used in traffic. */
const COUPE = [[150, 38, 32], [44, 84, 132], [158, 152, 138], [52, 92, 66]];
const SEDAN = [[176, 178, 176], [38, 58, 96], [104, 30, 30], [74, 78, 80]];
const SUV = [[60, 74, 58], [190, 184, 170], [34, 38, 44]];
const TAXI = [214, 158, 34];
const RIGID: Partial<Record<Model, readonly string[]>> = { van: ['#cfc9ba', '#4d5963', '#6f3026'], box: ['#d3cdbd', '#a8977a', '#84959a'], tanker: ['#c3c8ca', '#ab9c80'], bus: ['#b98a34', '#c3c7c4'], container: ['blue', 'red'] };
function layer(w: number, h: number): [Cv, G] { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return [c, c.getContext('2d', { willReadFrequently: true })!]; }
const shade = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); return 'rgb(' + [16, 8, 0].map(s => Math.round(clamp(((n >> s) & 255) * k, 0, 255))).join(',') + ')'; };
/** Grime and grain keep drawn bodywork next to photographs. */
function weather(g: G, w: number, h: number, seed: number, dirt = 1, face = true) {
 const r = rng(seed);
 g.save();
 g.globalCompositeOperation = 'source-atop';
 for (let i = 0; i < 46; i++) {
  const x = r() * w, y = r() * h * .9, len = h * (.05 + r() * .22);
  g.fillStyle = `rgba(58,44,28,${(.03 + r() * .07) * dirt})`;
  g.fillRect(x, y, 1 + r() * 3, len);
 }
 // Photographic grade: rounded corners, sky on top, road below.
 const round3 = g.createLinearGradient(0, 0, w, 0);
 round3.addColorStop(0, '#0f0b0699');
 round3.addColorStop(.13, '#0f0b0622');
 round3.addColorStop(.5, '#0f0b0600');
 round3.addColorStop(.87, '#0f0b0622');
 round3.addColorStop(1, '#0f0b0699');
 g.fillStyle = round3;
 if (face)
  g.fillRect(0, 0, w, h);
 g.fillStyle = `rgba(58,50,40,${.2 * dirt})`;
 g.fillRect(0, 0, w, h);
 for (let i = 0; i < 260; i++) {
  g.fillStyle = r() < .5 ? `rgba(40,30,18,${r() * .16 * dirt})` : `rgba(255,236,200,${r() * .07})`;
  g.beginPath();
  g.ellipse(r() * w, h * (1 - r() * r()), 1 + r() * 9, 1 + r() * 4, 0, 0, 7);
  g.fill();
 }
 const low = g.createLinearGradient(0, h * .45, 0, h);
 low.addColorStop(0, 'rgba(70,56,38,0)');
 low.addColorStop(1, `rgba(44,35,24,${.62 * dirt})`);
 g.fillStyle = low;
 g.fillRect(0, 0, w, h);
 const sun = g.createLinearGradient(0, 0, w, 0);
 sun.addColorStop(0, '#ffd08a66');
 sun.addColorStop(.05, '#ffd08a00');
 sun.addColorStop(.95, '#ffd08a00');
 sun.addColorStop(1, '#ffd08a77');
 g.fillStyle = sun;
 if (face)
  g.fillRect(0, 0, w, h);
 const d = g.getImageData(0, 0, w, h);
 for (let i = 0; i < d.data.length; i += 4)
  if (d.data[i + 3]) {
   const n = (r() - .5) * 13;
   d.data[i] += n;
   d.data[i + 1] += n;
   d.data[i + 2] += n;
  }
 g.putImageData(d, 0, 0);
 g.restore();
}
function lamp(g: G, x: number, y: number, w: number, h: number, color: string, hot = '#ffd9c4') { const q = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * .6); q.addColorStop(0, hot); q.addColorStop(.25, color); q.addColorStop(1, shade(color, .45)); g.fillStyle = q; round(g, x, y, w, h, Math.min(w, h) * .25); g.fill(); g.strokeStyle = '#1a1512'; g.lineWidth = 1.5; g.stroke(); }
function plate(g: G, x: number, y: number, w: number) { g.fillStyle = '#d9d3c0'; round(g, x - w / 2, y, w, w * .45, 2); g.fill(); g.fillStyle = '#3a4250'; for (let i = 0; i < 5; i++)
 g.fillRect(x - w * .38 + i * w * .155, y + w * .13, w * .1, w * .2); }
function tape(g: G, x: number, y: number, w: number, h: number) { const n = Math.max(4, Math.round(w / h / 2.4)); for (let i = 0; i < n; i++) {
 g.fillStyle = i % 2 ? '#e9e4d8' : '#b5281f';
 g.fillRect(x + w * i / n, y, w / n + .5, h);
} }
function bodyFill(g: G, w: number, h: number, hex: string) { const q = g.createLinearGradient(0, 0, 0, h); q.addColorStop(0, shade(hex, 1.1)); q.addColorStop(.5, hex); q.addColorStop(1, shade(hex, .7)); return q; }
function glass(g: G, x: number, y: number, w: number, h: number, r = 6) { const q = g.createLinearGradient(x, y, x + w * .4, y + h); q.addColorStop(0, '#6d7a80'); q.addColorStop(.3, '#2c3235'); q.addColorStop(1, '#101314'); g.fillStyle = q; round(g, x, y, w, h, r); g.fill(); g.strokeStyle = '#0c0d0d'; g.lineWidth = 3; g.stroke(); g.save(); g.clip(); g.fillStyle = '#ffffff14'; g.beginPath(); g.moveTo(x + w * .1, y); g.lineTo(x + w * .4, y); g.lineTo(x + w * .16, y + h); g.lineTo(x - w * .1, y + h); g.fill(); g.restore(); }
type Rigid = { rear: Cv; side: Cv; under: number; roof: string; barrel?: Cv };
/** A rear face is 300 wide; `under` is the share of height that stays open for the wheels. */
function rearOf(model: Model, tint: number, props?: HTMLImageElement): Rigid {
 const spec = MODELS[model], W = 300, H = Math.round(W * spec.tall), hex = RIGID[model]![tint % RIGID[model]!.length], [rear, g] = layer(W, H), r = rng(91 + tint * 17 + model.length * 7);
 let barrel: Cv | undefined;
 const under = model === 'van' || model === 'bus' ? .1 : .2, floor = H * (1 - under), [side, s] = layer(420, 260);
 const base = hex.startsWith('#') ? hex : hex === 'blue' ? '#3f6f93' : '#8c3f34';
 const frame = () => { g.strokeStyle = '#2b2723'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, floor - 3); };
 if (model === 'box') {
  g.fillStyle = bodyFill(g, W, floor, base);
  g.fillRect(0, 0, W, floor);
  g.fillStyle = shade(base, .82);
  g.fillRect(18, 34, W - 36, floor - 62);
  for (let y = 34; y < floor - 34; y += 24) {
   g.fillStyle = '#00000026';
   g.fillRect(18, y, W - 36, 3);
   g.fillStyle = '#ffffff2e';
   g.fillRect(18, y + 3, W - 36, 2);
  }
  g.fillStyle = '#2d2a26';
  g.fillRect(W / 2 - 16, floor - 50, 32, 12);
  g.fillStyle = ['#b4522e', '#38575e', '#4a5d3c'][tint % 3];
  g.fillRect(18, floor * .42, W - 36, 26);
  frame();
  for (const x of [110, 144, 178])
   lamp(g, x, 10, 14, 9, '#c8321f');
  tape(g, 10, floor - 24, W - 20, 10);
  tape(g, 5, 5, 34, 7);
  tape(g, W - 39, 5, 34, 7);
 }
 else if (model === 'container') {
  if (props) {
   const [sx, sy] = [PROPS[0][0], PROPS[0][1]], y0 = hex === 'blue' ? sy + 24 : sy + 186;
   g.drawImage(props, sx + 110, y0, 110, 130, 0, 0, W / 2, floor);
   g.drawImage(props, sx + 190, y0, 110, 130, W / 2, 0, W / 2, floor);
   s.drawImage(props, sx + 92, y0 - 6, 290, 138, 0, 0, 420, 260);
  }
  else {
   g.fillStyle = base;
   g.fillRect(0, 0, W, floor);
  }
  g.fillStyle = '#0000002e';
  g.fillRect(W / 2 - 3, 0, 6, floor);
  for (const x of [34, 88, 212, 266]) {
   g.fillStyle = '#b9b4a6';
   g.fillRect(x - 3, 8, 6, floor - 16);
   g.fillStyle = '#00000055';
   g.fillRect(x + 3, 8, 3, floor - 16);
   g.fillStyle = '#57534a';
   g.fillRect(x - 7, floor * .52, 14, 12);
   g.fillRect(x - 6, 12, 12, 8);
   g.fillRect(x - 6, floor - 24, 12, 8);
  }
  g.strokeStyle = shade(base, .55);
  g.lineWidth = 12;
  g.strokeRect(6, 6, W - 12, floor - 12);
  tape(g, 10, floor - 12, W - 20, 9);
 }
 else if (model === 'van') {
  g.beginPath();
  g.moveTo(1, floor);
  g.lineTo(1, 20);
  g.quadraticCurveTo(3, 3, 24, 2);
  g.lineTo(W - 24, 2);
  g.quadraticCurveTo(W - 3, 3, W - 1, 20);
  g.lineTo(W - 1, floor);
  g.closePath();
  g.fillStyle = bodyFill(g, W, floor, base);
  g.fill();
  glass(g, 42, 40, 98, 92, 12);
  glass(g, 160, 40, 98, 92, 12);
  g.fillStyle = '#00000066';
  g.fillRect(W / 2 - 1.5, 14, 3, floor - 60);
  g.strokeStyle = '#00000040';
  g.lineWidth = 2;
  g.strokeRect(34, 150, 106, 82);
  g.strokeRect(160, 150, 106, 82);
  g.fillStyle = '#23211e';
  g.fillRect(W / 2 + 10, 168, 26, 10);
  for (const x of [8, W - 26])
   lamp(g, x, 134, 18, 76, '#c62a1c');
  g.fillStyle = '#24231f';
  round(g, 8, floor - 40, W - 16, 36, 8);
  g.fill();
  plate(g, W / 2 - 60, floor - 62, 54);
 }
 else if (model === 'bus') {
  g.beginPath();
  g.roundRect(4, 4, W - 8, floor - 4, [34, 34, 10, 10]);
  g.fillStyle = bodyFill(g, W, floor, base);
  g.fill();
  const band = tint % 2 ? '#2f5b86' : '#1d1b18';
  g.fillStyle = band;
  g.fillRect(4, floor * .55, W - 8, tint % 2 ? 34 : 12);
  g.fillRect(4, floor * .66, W - 8, 8);
  glass(g, 40, 58, W - 80, floor * .36, 14);
  g.fillStyle = '#12110f';
  round(g, 78, 18, W - 156, 28, 5);
  g.fill();
  g.fillStyle = '#ffa640';
  for (let i = 0; i < 46; i++)
   if (r() < .72)
    g.fillRect(86 + (i % 23) * 5.6, 25 + Math.floor(i / 23) * 8, 3, 4);
  for (const x of [14, W - 36]) {
   lamp(g, x, floor * .7, 22, 26, '#c62a1c');
   lamp(g, x, floor * .7 + 30, 22, 18, '#c9751c', '#ffe1a6');
   lamp(g, x + 2, 24, 16, 12, '#c9751c', '#ffe1a6');
  }
  g.fillStyle = '#1b1917';
  round(g, 62, floor * .74, W - 124, floor * .15, 5);
  g.fill();
  g.fillStyle = '#45413b';
  for (let y = floor * .755; y < floor * .88; y += 7)
   g.fillRect(68, y, W - 136, 2.5);
  g.fillStyle = '#23211e';
  round(g, 2, floor - 26, W - 4, 26, 6);
  g.fill();
  plate(g, W / 2, floor - 24, 46);
 }
 else { // tanker: the barrel is drawn in depth, this is its rear cap
  const cy = floor * .52, rx = W * .48, ry = floor * .5;
  g.save();
  g.beginPath();
  g.ellipse(W / 2, cy, rx, ry, 0, 0, 7);
  g.clip();
  const q = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  const tone: readonly (readonly [number, number])[] = [[0, 1.28], [.2, 1.12], [.42, .95], [.5, .5], [.56, .62], [.75, .86], [1, .38]];
  for (const [at, k] of tone)
   q.addColorStop(at, shade(base, k));
  g.fillStyle = q;
  g.fillRect(0, 0, W, H);
  barrel = layer(W, H)[0];
  const bg = barrel.getContext('2d')!, tone2 = bg.createLinearGradient(0, 0, 0, H);
  bg.drawImage(rear, 0, 0);
  bg.globalCompositeOperation = 'source-atop';
  tone2.addColorStop(0, '#4b545a55');
  tone2.addColorStop(.35, '#2b2c2c77');
  tone2.addColorStop(1, '#17130dbb');
  bg.fillStyle = tone2;
  bg.fillRect(0, 0, W, H);
  const rim = g.createRadialGradient(W / 2, cy, ry * .55, W / 2, cy, rx);
  rim.addColorStop(0, '#ffffff00');
  rim.addColorStop(.82, '#ffffff22');
  rim.addColorStop(.9, '#00000044');
  rim.addColorStop(1, '#00000088');
  g.fillStyle = rim;
  g.fillRect(0, 0, W, H);
  g.restore();
  g.strokeStyle = shade(base, .55);
  g.lineWidth = 6;
  g.beginPath();
  g.ellipse(W / 2, cy, rx - 3, ry - 3, 0, 0, 7);
  g.stroke();
  g.fillStyle = '#33312c';
  g.fillRect(W / 2 - 5, cy - ry + 10, 4, ry * 2 - 20);
  g.fillRect(W / 2 + 25, cy - ry + 10, 4, ry * 2 - 20);
  for (let y = cy - ry + 22; y < cy + ry - 12; y += 22)
   g.fillRect(W / 2 - 5, y, 34, 3);
  g.save();
  g.translate(W * .3, cy + 8);
  g.rotate(Math.PI / 4);
  g.fillStyle = '#d98b22';
  g.fillRect(-18, -18, 36, 36);
  g.strokeStyle = '#1c1a16';
  g.lineWidth = 2;
  g.strokeRect(-15, -15, 30, 30);
  g.restore();
 }
 if (under > .15) { // chassis, lamps and underrun guard
  g.fillStyle = '#1b1916';
  g.fillRect(W * .2, floor - 2, W * .6, H * .05);
  g.fillStyle = '#2a2723';
  g.fillRect(W * .04, floor + H * .035, W * .92, H * .045);
  g.fillRect(W * .16, floor, 10, H * .06);
  g.fillRect(W * .84 - 10, floor, 10, H * .06);
  for (const x of [W * .06, W * .84]) {
   lamp(g, x, floor + H * .038, 30, 13, '#d02a1c');
  }
  for (const x of [W * .18, W * .76])
   lamp(g, x, floor + H * .038, 16, 13, '#c9751c', '#ffe1a6');
  tape(g, W * .32, floor + H * .05, W * .36, 7);
  plate(g, W / 2, floor + H * .085, 40);
 }
 weather(g, W, H, 7 + tint, model === 'bus' ? .6 : 1);
 // The long side: same paint, seams and windows.
 if (model !== 'container' && model !== 'tanker') {
  s.fillStyle = bodyFill(s, 420, 260, base);
  s.fillRect(0, 0, 420, 260);
  if (model === 'bus') {
   for (let i = 0; i < 6; i++)
    glass(s, 14 + i * 67, 46, 58, 92, 5);
   s.fillStyle = tint % 2 ? '#2f5b86' : '#1d1b18';
   s.fillRect(0, 160, 420, tint % 2 ? 26 : 9);
  }
  else if (model === 'van') {
   glass(s, 296, 34, 96, 82, 8);
   s.strokeStyle = '#00000044';
   s.lineWidth = 2;
   s.strokeRect(150, 24, 130, 200);
   s.strokeRect(20, 40, 116, 90);
  }
  else {
   for (let x = 0; x < 420; x += 42) {
    s.fillStyle = '#00000022';
    s.fillRect(x, 0, 2, 260);
   }
   s.fillStyle = ['#b4522e', '#38575e', '#4a5d3c'][tint % 3];
   s.fillRect(0, 108, 420, 26);
   tape(s, 0, 240, 420, 9);
  }
 }
 const dark = s.createLinearGradient(0, 0, 0, 260);
 dark.addColorStop(0, '#0f0c0830');
 dark.addColorStop(1, '#0f0c0877');
 s.fillStyle = dark;
 s.fillRect(0, 0, 420, 260);
 weather(s, 420, 260, 31 + tint, 1, false);
 return { rear, side, under, roof: shade(base, 1.05), barrel };
}
export abstract class SceneTraffic extends SceneWheels {
 private rigid: Partial<Record<Model, Rigid[]>> = {};
 private tyre: Cv[] = [];
 protected shapes: Partial<Record<Model, Record<string, Cv>[]>> = {};
 /** One saloon and the tyres are ready with the scene; the rest is painted behind the first screen. */
 protected readonly trafficFirst = [() => this.paintTyre(), () => this.dress('sedan', 0, 'patrol', SEDAN[0]), () => this.dress('sedan', 0, 'patrol-ram', SEDAN[0])];
 protected trafficRest() {
  const jobs: (() => void)[] = [];
  for (let k = 0; k < 4; k++) {
   if (k)
    for (const sheet of ['patrol', 'patrol-ram'] as const)
     jobs.push(() => this.dress('sedan', k, sheet, SEDAN[k]));
   for (const sheet of ['coupe', 'coupe-yaw', 'coupe-depth-roll'])
    jobs.push(() => { ((this.shapes.coupe ??= [])[k] ??= {})[sheet] = this.coupe(sheet, COUPE[k]); });
   if (k < SUV.length) {
    jobs.push(() => this.dress('suv', k, 'patrol-ram', SUV[k]));
    jobs.push(() => { this.shapes.suv![k].suv = this.suv(SUV[k]); });
   }
  }
  jobs.push(() => this.dress('taxi', 0, 'patrol-ram', TAXI), () => { this.shapes.taxi![0].patrol = this.taxi(); });
  for (const model of Object.keys(RIGID) as Model[])
   RIGID[model]!.forEach((_, k) => jobs.push(() => { (this.rigid[model] ??= [])[k] = rearOf(model, k, this.img['route-props']); }));
  return jobs;
 }
 /** A model joins the traffic once every colour of it is complete. */
 protected painted(model: Model) { const m = MODELS[model]; if (m.rigid)
  return this.rigid[model]?.length === m.tints; const list = this.shapes[model], sheets = model === 'coupe' ? 3 : 2; return model === 'sedan' ? Boolean(list) : list?.length === m.tints && list.every(o => Object.keys(o).length === sheets); }
 private dress(model: Model, k: number, sheet: 'patrol' | 'patrol-ram', rgb: readonly number[]) { ((this.shapes[model] ??= [])[k] ??= {})[sheet] = this.repaint(sheet, rgb); }
 protected shapeOf(c: Car) { const list = this.shapes[c.model], o = list?.[c.tint % list.length]; return o && Object.keys(o).length > 1 ? o : list?.[0]; }
 protected shadow(x: number, y: number, w: number, a: number) { if (a <= 0)
  return; const c = this.c, g = c.createRadialGradient(0, 0, 0, 0, 0, w * .56); c.save(); c.translate(x, y); c.scale(1, .16); g.addColorStop(0, `rgba(16,14,10,${a})`); g.addColorStop(.6, `rgba(16,14,10,${a * .7})`); g.addColorStop(1, 'rgba(16,14,10,0)'); c.fillStyle = g; c.fillRect(-w * .6, -w * .6, w * 1.2, w * 1.2); c.restore(); }
 protected add(g: HTMLCanvasElement, x: number, y: number, r: number, a: number) { if (a <= .01)
  return; const c = this.c; c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = Math.min(1, a); c.drawImage(g, x - r, y - r, r * 2, r * 2); c.restore(); }
 private paintTyre() { this.tyre = Array.from({ length: 12 }, (_, f) => { const [cv, g] = layer(40, 80); for (let y = 0; y < 80; y++) {
  const v = (40 - y) / 41, p = Math.asin(v) / .34 - f / 6, q = ((p % 1) + 1) % 1, l = 26 + 20 * Math.cos(Math.asin(v)) * (.6 + .4 * v);
  g.fillStyle = `rgb(${[1, .95, .88].map(k => Math.round(l * k * (q < .22 ? .45 : q < .36 ? 1.5 : 1))).join(',')})`;
  g.fillRect(0, y, 40, 1);
 } g.globalCompositeOperation = 'destination-in'; round(g, 0, 0, 40, 80, 9); g.fill(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#0a0908aa'; for (const x of [12, 25])
  g.fillRect(x, 0, 2.5, 80); return cv; }); }
 /** Traffic coupe: the player's body in another colour. Glass, rubber, lamps and chrome keep their own colour. */
 private coupe(name: string, rgb: readonly number[]) {
  const im = this.img[name], [cv, g] = layer(im.naturalWidth >> 1, im.naturalHeight >> 1);
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
  return cv;
 }
 /** Civil saloon from the patrol body: no light bar, one paint instead of two. */
 private repaint(sheet: 'patrol' | 'patrol-ram', rgb: readonly number[]): Cv {
  const im = this.img[sheet], [cv, g] = layer(im.naturalWidth >> 1, im.naturalHeight >> 1), W = cv.width, H = cv.height;
  g.drawImage(im, 0, 0, W, H);
  const keep = (pts: readonly number[]) => { const p = new Path2D(); for (let i = 0; i < pts.length; i += 2)
   p.lineTo(pts[i] / 2, pts[i + 1] / 2); p.closePath(); return p; };
  const cut = (pts: readonly number[]) => { g.globalCompositeOperation = 'destination-out'; g.fill(keep(pts)); g.globalCompositeOperation = 'source-over'; };
  const masks = sheet === 'patrol' ? [[404, 176, 1086, 176, 1142, 362, 352, 362], [196, 452, 500, 452, 500, 566, 196, 566], [994, 452, 1300, 452, 1300, 566, 994, 566], [196, 792, 330, 792, 360, 800, 1140, 800, 1170, 792, 1300, 792, 1300, 1010, 196, 1010], [140, 560, 160, 560, 206, 800, 345, 890, 345, 1010, 140, 1010], [1353, 560, 1340, 560, 1292, 800, 1152, 890, 1152, 1010, 1360, 1010], [150, 262, 300, 262, 300, 355, 150, 355], [1200, 262, 1345, 262, 1345, 355, 1200, 355]]
   : [[532, 266, 756, 266, 744, 332, 508, 332], [780, 260, 900, 300, 876, 340, 790, 336], [1040, 270, 1240, 272, 1190, 346, 990, 344], [1232, 320, 1262, 290, 1400, 340, 1360, 352, 1240, 352], [1575, 330, 1620, 296, 1700, 300, 1650, 338, 1560, 338], [1690, 352, 1730, 308, 1800, 302, 1810, 356], [1820, 300, 1960, 356, 1830, 364], [452, 360, 545, 360, 545, 402, 452, 402], [668, 360, 772, 360, 772, 402, 668, 402], [920, 354, 990, 354, 990, 394, 920, 394], [1100, 358, 1200, 358, 1200, 402, 1100, 402]];
  if (sheet === 'patrol') {
   cut([0, 0, 1493, 0, 1493, 250, 1120, 180, 1062, 126, 1030, 116, 900, 109, 600, 109, 466, 116, 432, 126, 380, 180, 0, 250]);
  }
  else {
   cut([440, 190, 800, 190, 800, 247, 440, 247]);
   cut([940, 210, 1300, 210, 1300, 262, 1180, 264, 1080, 264, 940, 300]);
   cut([1640, 250, 1830, 250, 1830, 290, 1720, 291, 1690, 291, 1640, 300]);
  }
  const [mk, mg] = layer(W, H);
  mg.fillStyle = '#fff';
  for (const m of masks)
   mg.fill(keep(m));
  mg.fillStyle = '#0f0';
  if (sheet === 'patrol-ram')
   for (const [x, y, rx, ry] of [[786, 476, 33, 66], [886, 432, 33, 58], [1231, 478, 42, 65], [1419, 444, 44, 56], [1661, 467, 55, 55], [2058, 462, 48, 56], [588, 528, 160, 46], [470, 500, 34, 70], [1040, 536, 160, 48], [952, 520, 44, 40], [1500, 486, 34, 40], [1860, 520, 260, 30]]) {
    mg.beginPath();
    mg.ellipse(x / 2, y / 2, rx / 2, ry / 2, 0, 0, 7);
    mg.fill();
   }
  const hide = mg.getImageData(0, 0, W, H).data, d = g.getImageData(0, 0, W, H), a = d.data, roof = sheet === 'patrol' ? 78 : 136;
  for (let y = 0; y < H; y++)
   for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (a[i + 3] < 8 || hide[i] > 128)
     continue;
    let r = a[i], gg = a[i + 1], b = a[i + 2];
    if (y < roof && Math.max(r, gg, b) - Math.min(r, gg, b) > 70)
     r = gg = b = Math.min(r, gg, b) + 20;
    const lum = .3 * r + .6 * gg + .1 * b, sat = Math.max(r, gg, b) - Math.min(r, gg, b), rubber = hide[i + 1] > 128 && hide[i] < 128, warm = clamp((sat - 62) / 60);
    if (warm >= 1 || rubber && lum < 105)
     continue;
    // White panels carry their shading near full scale, black ones near zero: both map to one paint.
    const white = clamp((lum - 96) / 40), tone = mix(.5 + lum / 120, .18 + lum / 215 * .95, white), keepLight = clamp((lum - 205) / 50) * .5;
    const q = mix(tone, 1.2, keepLight);
    a[i] = mix(rgb[0] * q, r, warm);
    a[i + 1] = mix(rgb[1] * q, gg, warm);
    a[i + 2] = mix(rgb[2] * q, b, warm);
   }
  g.putImageData(d, 0, 0);
  return cv;
 }
 private taxi() {
  const out = this.repaint('patrol', TAXI), g = out.getContext('2d')!;
  g.fillStyle = '#f5e6b8';
  round(g, 318, 34, 112, 24, 5);
  g.fill();
  g.strokeStyle = '#2b2620';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#1c1a16';
  g.font = '900 20px Arial,sans-serif';
  g.textAlign = 'center';
  g.fillText('TAXI', 374, 53);
  for (let i = 0; i < 22; i++) {
   g.fillStyle = i % 2 ? '#1c1a16' : '#e9dfc2';
   g.fillRect(202 + i * 15.6, 322, 15.6, 8);
   g.fillStyle = i % 2 ? '#e9dfc2' : '#1c1a16';
   g.fillRect(202 + i * 15.6, 330, 15.6, 8);
  }
  return out;
 }
 /** Off-roader: the same body with a taller, squarer cabin. Rows are rescaled, so lamps and tyres stay photographic. */
 private suv(rgb: readonly number[]) {
  const src = this.repaint('patrol', rgb), [cv, g] = layer(src.width, 620), belt = 178, top = 54, foot = 494;
  for (let y = 0; y < 620; y++) {
   const low = y >= 250, sy = low ? belt + (y - 250) * (foot - belt) / (620 - 250) : top + y * (belt - top) / 250, t = clamp((y) / 250), wide = low ? 1 : mix(1.2, 1, t * t), w = src.width * wide;
   g.drawImage(src, 0, sy, src.width, Math.max(.6, low ? (foot - belt) / 370 : (belt - top) / 250), (src.width - w) / 2, y, w, 1.2);
  }
  // Roof rails and a spare wheel cover.
  g.fillStyle = '#1a1917';
  g.fillRect(196, 3, 10, 12);
  g.fillRect(src.width - 206, 3, 10, 12);
  const cx = src.width / 2, q = g.createRadialGradient(cx - 14, 370, 10, cx, 384, 84);
  q.addColorStop(0, '#5b5a55');
  q.addColorStop(.7, '#2a2926');
  q.addColorStop(1, '#100f0e');
  g.fillStyle = q;
  g.beginPath();
  g.arc(cx, 384, 80, 0, 7);
  g.fill();
  g.strokeStyle = '#0a0a09';
  g.lineWidth = 5;
  g.stroke();
  return cv;
 }
 protected tyres(x: number, foot: number, w: number, turn: number, pairs = 2) { const f = this.tyre[((Math.floor(turn * 6.2 / 15 / .34 * 6) % 12) + 12) % 12]; if (!f)
  return; const tw = w * (pairs === 2 ? .105 : .13), th = w * (pairs === 2 ? .235 : .25); for (const s of [-1, 1])
  for (let i = 0; i < pairs; i++)
   this.c.drawImage(f, x + s * (w * .5 - tw * .55 - i * tw * 1.08) - tw / 2, foot - th, tw, th); }
 /** Boxes have volume: the side nearest to the camera is projected strip by strip. */
 protected drawRigid(k: Car, fade: number, base: number) {
  const set = this.rigid[k.model]?.[k.tint % (this.rigid[k.model]!.length)], c = this.c;
  if (!set)
   return;
  const spec = MODELS[k.model], X = k.x, z1 = Math.max(.5, k.z), z2 = k.z + spec.len, unit = this.carW * .9 * this.carZ * spec.wide, at = (z: number) => { const p = this.at(X, z), w = unit * p.s; return { x: p.x, foot: p.y, w, h: w * spec.tall, s: p.s }; };
  const A = at(z1), B = at(z2), sway = clamp(k.vx * .05, -.03, .03), right = A.x + A.w / 2 < B.x + B.w / 2, left = A.x - A.w / 2 > B.x - B.w / 2, dir = right ? 1 : left ? -1 : 0, tank = k.model === 'tanker';
  this.shadow(A.x, A.foot, A.w * 1.08, .55 * fade);
  if (B.s > 0 && A.foot - B.foot > 1) {
   c.globalAlpha = fade * .38;
   c.fillStyle = '#14110d';
   quad(c, { x: A.x - A.w * .52, y: A.foot }, { x: A.x + A.w * .52, y: A.foot }, { x: B.x + B.w * .52, y: B.foot }, { x: B.x - B.w * .52, y: B.foot });
  }
  c.globalAlpha = fade;
  const wheelsAt = [.16, .34, .86];
  if (dir && !tank) {
   const n = this.quality ? 6 : 14, iw = set.side.width, ih = set.side.height, edge = (p: typeof A) => ({ x: p.x + dir * p.w / 2, top: p.foot - p.h, low: p.foot - p.h * set.under }), N = edge(A), F = edge(B);
   c.save();
   c.beginPath();
   c.moveTo(N.x, N.top);
   c.lineTo(F.x, F.top);
   c.lineTo(F.x, F.low);
   c.lineTo(N.x, N.low);
   c.closePath();
   c.clip();
   for (let i = n - 1; i >= 0; i--) {
    const f = edge(at(mix(z1, z2, (i + 1) / n))), q = edge(at(mix(z1, z2, i / n))), wide = Math.abs(f.x - q.x);
    if (wide < .15)
     continue;
    const tall = Math.max(q.low - q.top, f.low - f.top) + 2;
    const slope = (f.top + f.low - q.top - q.low) / 2 / (f.x - q.x), middle = (q.top + q.low) / 2 - q.x * slope;
    c.save();
    c.transform(1, slope, 0, 1, 0, 0);
    c.drawImage(set.side, iw * i / n, 0, iw / n, ih, Math.min(q.x, f.x) - .4, middle - tall / 2, wide + .8, tall);
    c.restore();
   }
   c.restore();
  }
  if (dir && A.w > 24)
   for (const u of wheelsAt) {
    if (k.model === 'van' && u === .34)
     continue;
    const p = at(mix(z1, z2, u)), rr = p.w * .12, x = p.x + dir * p.w * .49, rx = Math.max(.8, Math.abs(at(mix(z1, z2, u) + .16).x + dir * at(mix(z1, z2, u) + .16).w / 2 - p.x - dir * p.w / 2) * .5);
    c.fillStyle = '#12110f';
    c.beginPath();
    c.ellipse(x, p.foot - rr, rx, rr, 0, 0, 7);
    c.fill();
    const tex = this.rims[1];
    if (tex && rx > 2) {
     c.save();
     c.translate(x, p.foot - rr);
     c.scale(rx * .62, rr * .62);
     c.rotate(k.turn * dir);
     c.drawImage(tex.turn, -1, -1, 2, 2);
     c.restore();
    }
   }
  if (tank) {
   const n = this.quality ? 10 : 26, rear = set.barrel ?? set.rear, cap = rear.height * (1 - set.under);
   c.fillStyle = '#1c1916';
   quad(c, { x: A.x - A.w * .47, y: A.foot - A.h * .2 }, { x: A.x + A.w * .47, y: A.foot - A.h * .2 }, { x: B.x + B.w * .47, y: B.foot - B.h * .2 }, { x: B.x - B.w * .47, y: B.foot - B.h * .2 });
   if (dir)
    quad(c, { x: A.x + dir * A.w * .47, y: A.foot - A.h * .24 }, { x: B.x + dir * B.w * .47, y: B.foot - B.h * .24 }, { x: B.x + dir * B.w * .47, y: B.foot - B.h * .13 }, { x: A.x + dir * A.w * .47, y: A.foot - A.h * .13 });
   c.fillStyle = '#2b2420';
   c.fillRect(B.x - B.w * .44, B.foot - B.h * .98, B.w * .88, B.h * .86);
   for (let i = n; i >= 1; i--) {
    const p = at(mix(z1, z2, i / n)), h = p.h * (1 - set.under);
    c.drawImage(rear, 0, 0, rear.width, cap, p.x - p.w / 2, p.foot - p.h, p.w, h);
   }
   c.globalAlpha = fade;
  }
  else if (A.foot - A.h > B.foot - B.h) { // low enough to show its roof
   c.fillStyle = set.roof;
   quad(c, { x: A.x - A.w * .45, y: A.foot - A.h * .98 }, { x: A.x + A.w * .45, y: A.foot - A.h * .98 }, { x: B.x + B.w * .45, y: B.foot - B.h }, { x: B.x - B.w * .45, y: B.foot - B.h });
  }
  c.save();
  c.translate(A.x, A.foot);
  c.rotate(sway);
  this.tyres(0, 0, A.w * .94, k.turn, k.model === 'van' ? 1 : 2);
  c.drawImage(set.rear, -A.w / 2, -A.h - A.h * .012 * Math.sin(k.turn * .9) * clamp(k.rev / 12), A.w, A.h);
  c.restore();
  c.globalAlpha = 1;
  const lampY = A.foot - A.h * (k.model === 'van' ? .42 : k.model === 'bus' ? .2 : .13);
  if (k.brake > .05)
   for (const s of [-1, 1])
    this.add(this.red, A.x + s * A.w * .42, lampY, A.w * .16, k.brake * fade * .8);
  this.blinker(k, A.x, lampY, A.w, fade);
  void base;
 }
 /** Indicator of a driver giving way. */
 protected blinker(k: Car, x: number, y: number, w: number, fade: number) { if (k.blink > 0 && Math.sin(k.blink * 14) > 0)
  this.add(this.flame, x + (Math.sign(k.tx - k.x) || Math.sign(k.x) || 1) * w * .43, y, w * .17, .95 * fade); }
 protected release() { super.release(); this.rigid = {}; this.shapes = {}; this.tyre = []; this.rims = []; }
}
