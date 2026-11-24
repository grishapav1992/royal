export const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const ease = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p); };
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const outCubic = (n: number) => 1 - Math.pow(1 - clamp(n), 3);
/** Deterministic noise: effects never consume shared randomness. */
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function layer(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
/** One asphalt tile covers eight world units. Lower mips double as motion blur. */
export function asphaltTile() {
 const w = 1024, h = 1024, c = layer(w, h), g = c.getContext('2d')!, px = g.createImageData(w, h), r = rng(173);
 for (let i = 0; i < w * h; i++) {
  const n = (r() - .5) * 34, f = r() > .985 ? 26 : 0, o = i * 4;
  px.data[o] = 122 + n + f;
  px.data[o + 1] = 117 + n + f;
  px.data[o + 2] = 108 + n + f;
  px.data[o + 3] = 255;
 }
 g.putImageData(px, 0, 0);
 const X = (x: number) => w / 2 + x * w / 2.5;
 // Worn wheel tracks, oil line, seams and repairs.
 for (const lane of [-.665, 0, .665])
  for (const [off, width, a] of [[-.17, .1, .16], [.17, .1, .16], [0, .07, .22]] as const) {
   const grad = g.createLinearGradient(X(lane + off - width), 0, X(lane + off + width), 0);
   grad.addColorStop(0, '#2a282400');
   grad.addColorStop(.5, `rgba(42,40,36,${a})`);
   grad.addColorStop(1, '#2a282400');
   g.fillStyle = grad;
   g.fillRect(X(lane + off - width), 0, X(width * 2) - X(0), h);
  }
 g.strokeStyle = '#3a383399';
 g.lineWidth = 2;
 for (const x of [-.335, .325]) {
  g.beginPath();
  g.moveTo(X(x) + 6, 0);
  for (let y = 0; y <= h; y += 16)
   g.lineTo(X(x) + 6 + Math.sin(y * .037) * 2, y);
  g.stroke();
 }
 for (let i = 0; i < 10; i++) {
  g.strokeStyle = '#2f2d2a77';
  g.lineWidth = 1.5 + r();
  g.beginPath();
  let x = X(-1 + r() * 2), y = r() * h;
  g.moveTo(x, y);
  for (let k = 0; k < 9; k++) {
   x += (r() - .5) * 34;
   y += 10 + r() * 16;
   g.lineTo(x, y);
  }
  g.stroke();
 }
 for (let i = 0; i < 5; i++) {
  g.fillStyle = '#4b484266';
  g.fillRect(X(-.9 + r() * 1.6), r() * h, 70 + r() * 70, 60 + r() * 150);
 }
 const paint = (x: number, y: number, len: number, wide: number, color: string) => { g.fillStyle = color; g.fillRect(X(x) - wide / 2, y, wide, len); g.globalCompositeOperation = 'destination-out'; g.globalCompositeOperation = 'source-over'; for (let k = 0; k < len * wide / 60; k++) {
  g.fillStyle = '#7d776c88';
  g.fillRect(X(x) - wide / 2 + r() * wide, y + r() * len, 2 + r() * 3, 2 + r() * 5);
 } };
 for (const x of [-.333, .333])
  for (const y of [40, 552])
   paint(x, y, 185, 11, '#efe9d8');
 paint(-1.0, 0, h, 10, '#d9ac52');
 paint(1.0, 0, h, 10, '#eee7d6');
 // Shoulder dirt.
 for (const s of [-1, 1]) {
  const grad = g.createLinearGradient(X(s * 1.06), 0, X(s * 1.25), 0);
  grad.addColorStop(0, '#8d806800');
  grad.addColorStop(1, '#95876dcc');
  g.fillStyle = grad;
  g.fillRect(Math.min(X(s * 1.06), X(s * 1.25)), 0, X(.19) - X(0), h);
 }
 return mips(c);
}
export function gravelTile() {
 const w = 512, h = 512, c = layer(w, h), g = c.getContext('2d')!, px = g.createImageData(w, h), r = rng(911);
 for (let i = 0; i < w * h; i++) {
  const n = r() * 255, o = i * 4;
  px.data[o] = px.data[o + 1] = px.data[o + 2] = n > 128 ? 255 : 0;
  px.data[o + 3] = Math.abs(n - 128) * .55;
 }
 g.putImageData(px, 0, 0);
 for (let i = 0; i < 60; i++) {
  g.fillStyle = r() > .5 ? '#fff6dd33' : '#2a241a44';
  g.beginPath();
  g.ellipse(r() * w, r() * h, 3 + r() * 10, 2 + r() * 6, 0, 0, 7);
  g.fill();
 }
 return mips(c);
}
function mips(base: HTMLCanvasElement) {
 const out = [base];
 let cur = base;
 while (cur.height > 8) {
  const n = layer(base.width, cur.height / 2), g = n.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, n.width, n.height);
  out.push(n);
  cur = n;
 }
 return out;
}
/** Soft cauliflower puffs, tinted once per material. */
export function puffs(tint: string, count = 4) {
 return Array.from({ length: count }, (_, k) => {
  const c = layer(128, 128), g = c.getContext('2d')!, r = rng(31 + k * 97);
  for (let i = 0; i < 34; i++) {
   const a = r() * 7, d = Math.pow(r(), .7) * 36, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, s = 8 + r() * 20, gr = g.createRadialGradient(x, y, 0, x, y, s);
   gr.addColorStop(0, '#ffffff30');
   gr.addColorStop(1, '#ffffff00');
   g.fillStyle = gr;
   g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  g.globalCompositeOperation = 'source-in';
  const lg = g.createLinearGradient(30, 10, 90, 120);
  lg.addColorStop(0, tint);
  lg.addColorStop(1, shade(tint, .62));
  g.fillStyle = lg;
  g.fillRect(0, 0, 128, 128);
  return c;
 });
}
function shade(hex: string, k: number) { const n = parseInt(hex.slice(1), 16); return '#' + [16, 8, 0].map(s => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0')).join(''); }
export function glow(color: string) { const c = layer(128, 128), g = c.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, color); gr.addColorStop(.35, color + '66'); gr.addColorStop(1, color + '00'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; }
export function quad(c: CanvasRenderingContext2D, a: {
 x: number;
 y: number;
}, b: {
 x: number;
 y: number;
}, d: {
 x: number;
 y: number;
}, e: {
 x: number;
 y: number;
}) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath(); c.fill(); }
export function line(c: CanvasRenderingContext2D, a: {
 x: number;
 y: number;
}, b: {
 x: number;
 y: number;
}) { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
export function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { c.beginPath(); c.roundRect(x, y, w, h, r); }
