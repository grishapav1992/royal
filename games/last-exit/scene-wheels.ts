import { clamp, mix } from './scene-kit';
import { WHEEL_CAP, wheelBlur } from './traffic';
import { SceneRoad } from './scene-road';
/** Wheels measured on the photographic sheets. The photographs stay whole: only spokes and tread are redrawn over them. */
type Rim = {
 /** Centre and radii of the turning part, in sheet pixels. */
 x: number;
 y: number;
 rx: number;
 ry: number;
 a?: number;
 /** The dish lip that covers the spokes in quarter views. */
 lip?: readonly [number, number, number, number];
};
type Tread = {
 poly: readonly (readonly [number, number])[];
 /** Axle height and radius. */
 y: number;
 r: number;
};
type Wheels = {
 rims?: readonly Rim[];
 treads?: readonly Tread[];
 steel?: boolean;
 /** Direction of the visible side: 1 is clockwise when driving on. */
 way: number;
};
const shift = (dx: number, dy: number, k: number, pts: readonly (readonly [number, number])[]) => pts.map(([x, y]) => [dx + x * k, dy + y * k] as const);
const flip = (about: number, pts: readonly (readonly [number, number])[]) => pts.map(([x, y]) => [about - x, y] as const);
const rim = (dx: number, dy: number, x: number, y: number, rx: number, ry = rx, a = 0): Rim => ({ x: dx + x / 3, y: dy + y / 3, rx: rx / 3, ry: ry / 3, a });
const deep = (dx: number, dy: number, hub: readonly [number, number, number, number], lip: readonly [number, number, number, number]): Rim => ({ ...rim(dx, dy, ...hub), lip: [dx + lip[0] / 3, dy + lip[1] / 3, lip[2] / 3, lip[3] / 3] });
const COUPE_TYRE = shift(147, 520, 1, [[24, 20], [34, 60], [47, 112], [66, 160], [94, 212], [124, 254], [152, 279], [212, 290], [218, 330], [214, 372], [204, 404], [40, 407], [17, 390], [5, 330], [4, 200], [8, 110]]);
const PATROL_TYRE = shift(152, 530, 1, [[10, 40], [18, 130], [34, 220], [46, 268], [56, 312], [88, 356], [168, 364], [181, 378], [178, 430], [164, 450], [40, 454], [12, 430], [4, 330], [4, 150]]);
export const WHEELS: Record<string, Wheels> = {
 'coupe': { way: -1, treads: [{ poly: COUPE_TYRE, y: 720, r: 212 }, { poly: flip(1538, COUPE_TYRE), y: 720, r: 212 }] },
 'patrol': { way: 1, treads: [{ poly: PATROL_TYRE, y: 762, r: 226 }, { poly: flip(1497, PATROL_TYRE), y: 762, r: 226 }] },
 'coupe-yaw/1': { way: -1, rims: [deep(483, 350, [446, 297, 44, 122], [417, 300, 44, 152]), deep(483, 350, [100, 202, 38, 96], [68, 200, 37, 117])], treads: [{ poly: shift(483, 350, 1 / 3, [[474, 300], [492, 342], [545, 362], [655, 372], [652, 430], [628, 486], [600, 508], [440, 510], [466, 470], [478, 400]]), y: 450, r: 71 }] },
 'coupe-yaw/2': { way: -1, rims: [deep(1030, 350, [532, 294, 50, 118], [497, 293, 52, 140]), deep(1030, 350, [85, 172, 32, 88], [62, 168, 33, 104])], treads: [{ poly: shift(1030, 350, 1 / 3, [[570, 235], [598, 285], [640, 336], [732, 366], [728, 420], [706, 464], [676, 486], [516, 490], [556, 440], [574, 350]]), y: 445, r: 68 }] },
 'coupe-yaw/3': { way: -1, rims: [rim(1570, 360, 333, 194, 84), rim(1570, 360, 1353, 194, 84)] },
 'patrol-ram/1': { way: 1, steel: true, rims: [rim(740, 370, 192, 314, 17, 112)], treads: [{ poly: shift(740, 370, 1 / 3, [[100, 415], [140, 330], [158, 350], [160, 440], [182, 500], [172, 508], [60, 506], [34, 470], [30, 410]]), y: 465, r: 79 }] },
 'patrol-ram/2': { way: 1, steel: true, rims: [rim(1180, 370, 194, 322, 34, 104), rim(1180, 370, 722, 221, 42, 70)], treads: [{ poly: shift(1180, 370, 1 / 3, [[98, 400], [130, 300], [142, 330], [146, 430], [184, 500], [176, 506], [80, 500], [40, 450], [30, 408]]), y: 465, r: 76 }] },
 'patrol-ram/3': { way: 1, steel: true, rims: [rim(1560, 380, 302, 262, 92), rim(1560, 380, 1517, 264, 56, 86)] },
 'coupe-depth-roll/0': { way: -1, rims: [rim(18, 320, 235, 139, 55), rim(18, 320, 1004, 139, 55)] },
 'coupe-depth-roll/1': { way: -1, rims: [rim(444, 360, 306, 95, 50, 45), rim(444, 360, 1020, 110, 48, 35)] },
 'coupe-depth-roll/3': { way: 1, rims: [rim(1330, 240, 283, 130, 52), rim(1330, 240, 960, 132, 50, 54)] },
 'coupe-depth-roll/4': { way: 1, rims: [rim(16, 570, 253, 125, 56), rim(16, 570, 1012, 127, 56)] },
 'coupe-depth-roll/5': { way: 1, rims: [rim(444, 560, 328, 96, 48, 37), rim(444, 560, 1004, 87, 48, 42)] },
 'coupe-depth-roll/7': { way: 1, rims: [rim(1330, 560, 307, 111, 54, 48, .15), rim(1330, 560, 975, 150, 49, 41, .25)] },
};
const PHASES = 12, PITCH = .34, TREAD = 6.2 / WHEEL_CAP;
type Frames = { x: number; y: number; w: number; h: number; list: HTMLCanvasElement[]; blur: HTMLCanvasElement };
const sheetOf = (key: string) => key.split('/')[0];
function layer(w: number, h: number) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
/** Moving tread: the photograph keeps its light, the blocks roll over it. */
function tread(im: CanvasImageSource, t: Tread, k: number): Frames {
 const xs = t.poly.map(p => p[0]), ys = t.poly.map(p => p[1]), x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys)), w = Math.ceil(Math.max(...xs)) - x, h = Math.ceil(Math.max(...ys)) - y, W = Math.max(2, Math.round(w * k)), H = Math.max(2, Math.round(h * k));
 const src = layer(W, H), g = src.getContext('2d', { willReadFrequently: true })!;
 g.filter = 'blur(.6px)';
 g.beginPath();
 t.poly.forEach(([px, py], i) => { const X = (px - x) * k, Y = (py - y) * k; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
 g.closePath();
 g.fill();
 g.filter = 'none';
 g.globalCompositeOperation = 'source-in';
 g.drawImage(im, x, y, w, h, 0, 0, W, H);
 const px = g.getImageData(0, 0, W, H), n = W * H, sum = new Float32Array(n * 3), R = Math.max(2, Math.round(W * .1));
 // Old grooves are averaged out inside the tyre only.
 for (let yy = 0; yy < H; yy++)
  for (let xx = 0; xx < W; xx++) {
   let a = 0, r = 0, gg = 0, b = 0;
   for (let dy = -R; dy <= R; dy += 2)
    for (let dx = -R; dx <= R; dx += 2) {
     const X = xx + dx, Y = yy + dy;
     if (X < 0 || Y < 0 || X >= W || Y >= H)
      continue;
     const o = (Y * W + X) * 4, q = px.data[o + 3];
     a += q;
     r += px.data[o] * q;
     gg += px.data[o + 1] * q;
     b += px.data[o + 2] * q;
    }
   const o = (yy * W + xx) * 3;
   if (a) {
    sum[o] = r / a;
    sum[o + 1] = gg / a;
    sum[o + 2] = b / a;
   }
  }
 const frames: HTMLCanvasElement[] = [], mean = new Float32Array(n);
 const paint = (value: (i: number, xx: number, yy: number) => number) => { const cv = layer(W, H), q = cv.getContext('2d')!, d = q.createImageData(W, H); for (let yy = 0; yy < H; yy++)
  for (let xx = 0; xx < W; xx++) {
   const i = yy * W + xx, f = value(i, xx, yy);
   for (let c = 0; c < 3; c++)
    d.data[i * 4 + c] = clamp(sum[i * 3 + c] * f + (f > 1.3 ? 12 : 0), 0, 255);
   d.data[i * 4 + 3] = px.data[i * 4 + 3];
  } q.putImageData(d, 0, 0); return cv; };
 for (let k2 = 0; k2 < PHASES; k2++)
  frames.push(paint((i, xx, yy) => {
   const v = clamp((t.y - (y + (yy + .5) / k)) / t.r, -.995, .995), u = xx / W, rib = Math.abs(u * 3 % 1 - .5), p = Math.asin(v) / PITCH - k2 / PHASES * 2 + rib * .5 + Math.floor(u * 3) * .5, f = ((p % 1) + 1) % 1, block = ((Math.floor(p) % 2) + 2) % 2;
   const edge = clamp(Math.cos(Math.asin(v)) * 2.2), cut = f < .22 ? .26 : f < .36 ? 2.1 : block ? 1.22 : .9, value = mix(1, cut * (rib > .44 ? .5 : 1), edge);
   mean[i] += value / PHASES;
   return value;
  }));
 return { x, y, w, h, list: frames, blur: paint(i => mean[i]) };
}
export abstract class SceneWheels extends SceneRoad {
 protected rims: { turn: HTMLCanvasElement; blur: HTMLCanvasElement }[] = [];
 private treads: Record<string, Frames[]> = {};
 /** Turn of the coupe's own wheels, and their rate. */
 protected heroTurn = 0;
 protected heroRev = 0;
 protected readonly wheelJobs = [() => { this.rims = [this.spokes('coupe-yaw', WHEELS['coupe-yaw/3'].rims![1], 5), this.spokes('patrol-ram', WHEELS['patrol-ram/3'].rims![0], 8)]; },
  ...['coupe', 'patrol', 'coupe-yaw/1', 'coupe-yaw/2', 'patrol-ram/1', 'patrol-ram/2'].map(key => () => { const im = this.img[sheetOf(key)]; if (im)
   this.treads[key] = WHEELS[key].treads!.map(t => tread(im, t, key.includes('/') ? 1 : .42)); })];
 /** Spokes are averaged over their own symmetry, so baked light does not travel with the wheel. */
 private spokes(sheet: string, r: Rim, count: number) {
  const S = 96, im = this.img[sheet], turn = layer(S, S), blur = layer(S, S);
  const stack = (cv: HTMLCanvasElement, n: number) => { const g = cv.getContext('2d')!; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 7); g.clip(); for (let i = 0; i < n; i++) {
   g.save();
   g.globalAlpha = 1 / (i + 1);
   g.translate(S / 2, S / 2);
   g.rotate(i / n * Math.PI * 2);
   g.drawImage(im, r.x - r.rx, r.y - r.ry, r.rx * 2, r.ry * 2, -S / 2, -S / 2, S, S);
   g.restore();
  } };
  stack(turn, count);
  stack(blur, count * 8);
  return { turn, blur };
 }
 /** Draws the moving parts over a sprite already placed at dx, dy with width dw. */
 protected wheels(key: string, box: readonly number[], dx: number, dy: number, dw: number, dh: number, turn: number, rate: number) {
  const set = WHEELS[key], c = this.c;
  if (!set || this.quality > 1 && dw < 60)
   return;
  const kx = dw / box[2], ky = dh / box[3], soft = wheelBlur(rate);
  if (set.rims && dw > 26) {
   const tex = this.rims[set.steel ? 1 : 0];
   if (tex)
    for (const r of set.rims) {
     c.save();
     const px = (v: number) => dx + (v - box[0]) * kx, py = (v: number) => dy + (v - box[1]) * ky;
     if (r.lip) {
      c.beginPath();
      c.ellipse(px(r.lip[0]), py(r.lip[1]), r.lip[2] * kx, r.lip[3] * ky, 0, 0, 7);
      c.clip();
     }
     c.translate(px(r.x), py(r.y));
     c.rotate(r.a ?? 0);
     c.scale(r.rx * kx, r.ry * ky);
     const base = c.globalAlpha;
     c.save();
     c.rotate(turn * set.way);
     c.drawImage(tex.turn, -1, -1, 2, 2);
     c.restore();
     if (soft > .02) {
      c.globalAlpha = base * soft * .72;
      c.drawImage(tex.blur, -1, -1, 2, 2);
     }
     c.restore();
    }
  }
  const list = this.treads[key];
  if (list && dw > 30)
   this.scroll(list, box, dx, dy, kx, ky, turn, soft);
 }
 private scroll(list: Frames[], box: readonly number[], dx: number, dy: number, kx: number, ky: number, turn: number, soft: number) {
  const c = this.c, base = c.globalAlpha, at = ((Math.floor(turn * TREAD / PITCH * PHASES / 2) % PHASES) + PHASES) % PHASES;
  for (const f of list) {
   const x = dx + (f.x - box[0]) * kx, y = dy + (f.y - box[1]) * ky;
   c.drawImage(f.list[at], x, y, f.w * kx, f.h * ky);
   if (soft > .02) {
    c.globalAlpha = base * soft * .34;
    c.drawImage(f.blur, x, y, f.w * kx, f.h * ky);
    c.globalAlpha = base;
   }
  }
 }
}
