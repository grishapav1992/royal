'use strict';
/* Макет «Живое дерево». Правила поля повторяют модель v1: 12 поворачиваемых корней, источник 10, цветы 4/14/24. */
(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = $('#fh'), fit = $('#fit'), shell = $('#shell');
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = t => 1 - (1 - t) ** 3, smooth = t => t * t * (3 - 2 * t);
const back = t => { const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const money = v => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- правила ---------- */
const ROT = [...Array(25).keys()].filter(p => ((p / 5 | 0) + p % 5) % 2 === 1);
const DIR = [[-1, 0], [0, 1], [1, 0], [0, -1]], PORT = [1, 2, 4, 8];
const nb = (p, d) => { const r = (p / 5 | 0) + DIR[d][0], c = p % 5 + DIR[d][1]; return r < 0 || r > 4 || c < 0 || c > 4 ? -1 : r * 5 + c; };
const boardOf = bits => [...Array(25).keys()].map(p => {
  const i = ROT.indexOf(p); if (i >= 0) return bits >> i & 1 ? 5 : 10;
  let m = 0; for (let d = 0; d < 4; d++) if (nb(p, d) >= 0) m |= PORT[d];
  if (p === 10) m |= 8; if (p === 4 || p === 14 || p === 24) m |= 2; return m;
});
function flowOf(board) {
  const seen = new Map([[10, { depth: 0, entry: 3 }]]), q = [10];
  for (let h = 0; h < q.length; h++) for (let d = 0; d < 4; d++) {
    const p = q[h], n = nb(p, d);
    if (n < 0 || seen.has(n) || !(board[p] & PORT[d]) || !(board[n] & PORT[(d + 2) % 4])) continue;
    seen.set(n, { depth: seen.get(p).depth + 1, entry: (d + 2) % 4 }); q.push(n);
  }
  let mask = 0, held = 0;
  [4, 14, 24].forEach((p, i) => {
    if (!seen.has(p)) return; mask |= 1 << i;
    for (let d = 0; d < 4; d++) { const n = nb(p, d), k = ROT.indexOf(n); if (n >= 0 && k >= 0 && seen.has(n) && board[p] & PORT[d] && board[n] & PORT[(d + 2) % 4]) { held |= 1 << k; break; } }
  });
  return { seen, mask, held };
}
const artOf = m => ({ 10: [0, 0], 5: [0, 1], 3: [1, 0], 6: [1, 1], 11: [2, 0], 14: [2, 2], 15: [3, 0] })[m];
const ENERGY = [[1, 9000], [2, 800], [5, 180], [20, 19], [100, 1]];
const energyDraw = () => { let r = rnd(10000); for (const [v, w] of ENERGY) if ((r -= w) < 0) return v; return 1; };
const ECOL = { 1: '#63f5d0', 2: '#6fd8ff', 5: '#b48bff', 20: '#ffc94f', 100: '#ffe08a' };
const EGEM = { 1: 'none', 2: 'hue-rotate(28deg) brightness(1.15)', 5: 'hue-rotate(105deg) brightness(1.1)', 20: 'hue-rotate(-118deg) saturate(1.3) brightness(1.2)', 100: 'hue-rotate(-115deg) saturate(.55) brightness(1.65)' };
/* осевые линии корней, сняты с рисунка v4/roots.webp: [сторона]=точки от края к узлу */
const ARMS = [
  { 3: [[0, .489], [.083, .468], [.167, .439], [.25, .387], [.333, .359], [.417, .368], [.5, .47]], 1: [[1, .481], [.917, .516], [.833, .585], [.75, .627], [.667, .63], [.583, .578], [.5, .47]] },
  { 0: [[.443, 0], [.436, .083], [.441, .167], [.459, .25], [.475, .333], [.53, .43], [.6, .475]], 1: [[1, .492], [.917, .479], [.833, .474], [.75, .497], [.667, .497], [.6, .475]] },
  { 0: [[.534, 0], [.533, .167], [.535, .33], [.53, .42]], 3: [[0, .476], [.083, .48], [.167, .504], [.25, .525], [.333, .501], [.417, .45], [.53, .42]], 1: [[1, .486], [.917, .491], [.833, .509], [.75, .511], [.667, .477], [.53, .42]] },
  { 0: [[.516, 0], [.52, .083], [.523, .167], [.545, .25], [.55, .36], [.54, .47]], 2: [[.517, 1], [.51, .917], [.522, .833], [.535, .75], [.52, .667], [.54, .47]], 3: [[0, .484], [.083, .481], [.167, .471], [.25, .482], [.333, .508], [.417, .527], [.54, .47]], 1: [[1, .469], [.917, .471], [.833, .486], [.75, .476], [.667, .439], [.54, .47]] },
];
const ADJ = [[0, 1], [.055, 1.02], [-.03, 1.06], [-.012, 1.03]]; // сдвиг и масштаб рисунка, чтобы соседние корни сходились
/* плечи клетки с учётом поворота; направление клетки -> точки в долях клетки */
function armsOf(mask) {
  const [col, q] = artOf(mask), out = {};
  for (const k in ARMS[col]) out[(+k + q) % 4] = ARMS[col][k].map(([x, y]) => { let a = (x - .5) * ADJ[col][1] + ADJ[col][0], b = (y - .5) * ADJ[col][1]; for (let i = 0; i < q; i++) [a, b] = [-b, a]; return [a + .5, b + .5]; });
  return out;
}

/* ---------- состояние ---------- */
const S = { balance: 1000, stake: 10, scenario: 'random', bits: 1771, energy: 1, mask: 0, held: 0, stage: 'idle', busy: false, skip: false, fast: false, calm: matchMedia('(prefers-reduced-motion: reduce)').matches,
  total: 0, bonusLeft: 0, bonusAt: 0, program: [], lit: null, flow: null, auto: null, paid: 0, tier: '' };
const cells = [...Array(25)].map((_, p) => ({ p, ang: 0, bump: 0, dim: 0, spin: 0, stopAt: 0, hover: 0 }));
let flyers = new Set();
const STAKES = [.1, .2, .5, 1, 2, 5, 10, 20, 50, 100];

/* ---------- время ---------- */
const waiters = new Set();
function tween(ms, fn) {
  return new Promise(res => {
    if (S.skip || S.calm || ms <= 0) { fn && fn(1); return res(); }
    const t0 = performance.now(); const w = { step(now) { const t = S.skip ? 1 : clamp((now - t0) / ms); fn && fn(t); if (t >= 1) { waiters.delete(w); res(); } } }; waiters.add(w);
  });
}
const wait = ms => tween(ms);
const pace = ms => S.fast ? ms * .5 : ms;

/* ---------- ресурсы ---------- */
const img = {}; const load = (k, u) => new Promise(r => { const i = new Image(); i.onload = r; i.onerror = r; i.src = 'assets/' + u + '.webp'; img[k] = i; });
const POSES = ['idle', 'choice', 'channel', 'flower', 'bonus', 'win', 'big'];
const elf = $('.fh-elf'); elf.innerHTML = POSES.map(p => `<img src="assets/elf-${p}.webp" alt="" data-p="${p}"${p === 'idle' ? ' class="on"' : ''}>`).join('');
const pose = p => $$('img', elf).forEach(i => i.classList.toggle('on', i.dataset.p === p));
const litTint = {};
function litSprite(e) {
  if (litTint[e]) return litTint[e];
  const c = document.createElement('canvas'); c.width = 1536; c.height = 384; const x = c.getContext('2d'); x.drawImage(img.roots, 0, 384, 1536, 384, 0, 0, 1536, 384);
  if (e !== 1) try {
    const [R, G, B] = [1, 3, 5].map(i => parseInt(ECOL[e].slice(i, i + 2), 16)), d = x.getImageData(0, 0, 1536, 384), a = d.data;
    for (let i = 0; i < a.length; i += 4) { if (!a[i + 3]) continue; const m = clamp((Math.min(a[i + 1], a[i + 2]) - a[i] + 22) / 62); if (!m) continue;
      const L = Math.max(a[i + 1], a[i + 2]) / 255, w = clamp((a[i] / 255 - .35) * 1.6);
      a[i] += (Math.min(255, (R + (255 - R) * w) * L) - a[i]) * m; a[i + 1] += (Math.min(255, (G + (255 - G) * w) * L) - a[i + 1]) * m; a[i + 2] += (Math.min(255, (B + (255 - B) * w) * L) - a[i + 2]) * m; }
    x.putImageData(d, 0, 0);
  } catch {}
  return litTint[e] = c;
}

/* ---------- компоновка ---------- */
const G = {}; const cv = { back: $('.fh-back'), frame: $('.fh-frame'), board: $('.fh-board'), fx: $('.fh-fx'), bloom: $('.fh-bloom') };
const X = Object.fromEntries(Object.entries(cv).map(([k, c]) => [k, c.getContext('2d')]));
let DPR = 1;
const size = (c, x, y, w, h) => { c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); Object.assign(c.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); c.getContext('2d').setTransform(DPR, 0, 0, DPR, 0, 0); };
const place = (el, x, y, w, h) => Object.assign(el.style, { left: x + 'px', top: y + 'px', ...(w != null && { width: w + 'px' }), ...(h != null && { height: h + 'px' }) });
function layout() {
  const W = root.clientWidth, H = root.clientHeight; if (!W || !H) return;
  const kind = W >= 900 && H >= 600 ? 'full' : W > H ? 'landscape' : 'portrait'; root.dataset.layout = kind; root.dataset.narrow = W < 350; elf.style.maskImage = elf.style.webkitMaskImage = ''; elf.style.opacity = 1; G.kind = kind; G.W = W; G.H = H;
  DPR = Math.min(2, (devicePixelRatio || 1) * Math.max(1, G.scale || 1));
  let b, F, bx, by, crystalH, fl, titleW;
  const ctl = $('.fh-ctl'), plate = $('.fh-plate'), tools = $('.fh-tools');
  if (kind === 'full') {
    const ctlH = 92, plateH = 62, over = clamp(H * .075, 46, 84);
    b = 200; for (let t = 1000; t > 200; t--) { F = t * .078; crystalH = t * .42; fl = t * .2; if (t + F * 2 + over + 8 + plateH * .55 + ctlH + 22 <= H && t + F * 2 + crystalH * .46 + fl * .86 + W * .235 + 8 <= W) { b = t; break; } }
    F = b * .078; crystalH = b * .42; fl = b * .2; titleW = b * .74;
    const net = crystalH * .46 + F * 2 + b + fl * .86; G.elfW = W - net - 8;
    bx = 8 + crystalH * .46 + F + Math.max(0, (W - net - G.elfW * 1 - 8) / 2); by = 8 + over + F;
    const extra = H - (by + b + F + plateH * .55 + ctlH + 18); if (extra > 0) by += extra * .4;
    const cx = bx + b / 2, pw = Math.min(b * 1.02, 760);
    place(plate, cx - pw / 2, by + b + F * .42, pw, plateH);
    const half = Math.min(cx - 14, 520); place(ctl, cx - half, by + b + F * .42 + plateH + 30, half * 2, ctlH - 18);
    place(tools, W - 160, 10);
    const eh = Math.min(H * .93, G.elfW * 3.1), ew = eh * 640 / 768, ec = W - clamp(eh * .222, 120, G.elfW * .72 + 12); place(elf, ec - ew * .5, H - eh, ew, eh); elf.style.opacity = 1;
    G.elf = { x: ec, y: H - eh * .68, r: eh * .4 };
  } else if (kind === 'portrait') {
    const ctlH = 158, plateH = 72; F = 13; crystalH = 0; const side = W * .1, right = W * .118;
    b = Math.min(W - side - right - F * 2 + 8, H - ctlH - plateH - 150); crystalH = b * .36; fl = right * 1.12; titleW = Math.min(b * .72, 240);
    const free = H - (b + F * 2 + ctlH + plateH + 16), head = clamp(free * .9, 84, 260);
    bx = side + F - 4 + Math.max(0, (W - side - right - F * 2 - b + 8) / 2); by = head + F + 4;
    const pw = Math.min(W - 16, 560); place(plate, (W - pw) / 2, by + b + F + 12, pw, plateH); place(ctl, (W - pw) / 2 + 4, H - ctlH + 2, pw - 8, ctlH - 10);
    place(tools, 8, 8);
    const eh = Math.min(head * 2.15, W * 1.28), ew = eh * 640 / 768, cut = (by - F * .5 - 4) / eh * 100; place(elf, W - ew * .74, 4, ew, eh); elf.style.maskImage = elf.style.webkitMaskImage = `linear-gradient(#000 ${cut - 7}%,transparent ${cut}%)`; G.elf = { x: W - ew * .28, y: head * .5, r: head * .6 };
  } else {
    const col = clamp(W * .235, 176, 230); F = 9; b = Math.min(H - F * 2 - 14, (W - col - 16 - F * 2) / 1.35); crystalH = b * .4; fl = b * .2; titleW = 0;
    bx = 6 + crystalH * .42 + F; by = (H - b) / 2;
    place(plate, W - col - 6, 51, col, Math.min(108, H - 168 - 51 - 12)); place(ctl, W - col - 6, H - 168, col, 162); place(tools, W - 152, 5);
    const x0 = bx + b + F + fl * .9, ew0 = W - col - 6 - x0, eh = H * .99, ew = eh * 640 / 768; place(elf, x0 + ew0 / 2 - ew * .5 + 4, H - eh, ew, eh); elf.style.opacity = ew0 < 90 ? 0 : 1;
    G.elf = { x: x0 + ew0 / 2, y: H * .4, r: H * .4 };
  }
  Object.assign(G, { b, F, bx, by, c: b / 5, fl, crystalH });
  place($('.fh-cells'), bx, by, b, b);
  const pad = F * 1.9; G.pad = pad; size(cv.frame, bx - pad, by - pad, b + pad * 2 + fl, b + pad * 2); size(cv.board, bx - 4, by - 4, b + 8, b + 8); size(cv.back, 0, 0, W, H); size(cv.fx, 0, 0, W, H); size(cv.bloom, 0, 0, W, H); bloomShown = -1;
  const cw = crystalH * 384 / 576, gemX = kind === 'full' ? bx - F - crystalH * .2 : Math.max(cw * .34, bx - F - crystalH * .13), gemY = by + b / 2;
  G.gem = { x: gemX, y: gemY }; place($('.fh-crystal'), gemX - cw * .51, gemY - crystalH * .43, cw, crystalH);
  const en = $('.fh-energy'); place(en, kind === 'full' ? gemX : Math.max(26, gemX), gemY + crystalH * .5 + (kind === 'full' ? 2 : 2));
  G.flowers = [0, 1, 2].map(i => ({ x: bx + b + F + (kind === 'full' ? fl * .4 : fl * .36), y: by + G.c * (i * 2 + .48) }));
  $$('.fh-flower').forEach((el, i) => {
    const f = G.flowers[i]; el.style.setProperty('--s', fl + 'px'); place(el, f.x - fl / 2, f.y - fl * .5, fl, fl);
    const o = $('.open', el), d = $('.bud', el); Object.assign(o.style, { left: -fl * .06 + 'px', top: -fl * .2 + 'px', width: fl * 1.12 + 'px', height: fl * 1.12 + 'px' });
    Object.assign(d.style, { left: fl * .13 + 'px', top: -fl * .08 + 'px', width: fl * .74 + 'px', height: fl * .93 + 'px' }); $('.v', el).style.top = fl * .9 + 'px';
  });
  const ti = $('.fh-title'); ti.hidden = !titleW; if (titleW) { const th = titleW * 467 / 1400; place(ti, kind === 'portrait' ? Math.max(4, bx - F) : bx + b / 2 - titleW / 2, by - F * .55 - th * (kind === 'portrait' ? .78 : .74), titleW, th); }
  const sd = kind === 'full' ? b * .044 : 15, xs = kind === 'full' ? [.02, .085, .915, .98] : kind === 'portrait' ? [.76, .84, .92, 1] : [.38, .46, .54, .62];
  $$('.fh-seed').forEach((s, i) => { place(s, bx + b * xs[i], by - F * (kind === 'full' ? .62 : .5), sd, sd); });
  const au = $('.fh-aura'); place(au, G.elf.x - G.elf.r, G.elf.y - G.elf.r, G.elf.r * 2, G.elf.r * 2);
  place($('.fh-banner'), bx + b / 2, by + b * .5); G.plateC = { x: plate.offsetLeft + plate.offsetWidth / 2, y: plate.offsetTop + plate.offsetHeight / 2 };
  const sum = $('.sum', plate); G.sum = { x: plate.offsetLeft + sum.offsetLeft + sum.offsetWidth / 2, y: plate.offsetTop + sum.offsetTop + sum.offsetHeight / 2 };
  drawFrame(); dirty = true; buildFalls(); if (S.lit) for (const g of S.lit.segs) { g.ox = g.p % 5 * G.c; g.oy = (g.p / 5 | 0) * G.c; } for (const m of beams) aim(m); litFor = null;
}

/* рама: вертикальные и горизонтальные ветви зеркально повторяются, поэтому стыков не видно */
function drawFrame() {
  const x = X.frame, { b, F, pad } = G, f = img.frame, k = F / 118, W = b + pad * 2 + G.fl; x.clearRect(0, 0, W + 9, b + pad * 2 + 9); if (!f || !f.naturalWidth) return;
  const IN = { l: 184, r: 839, t: 171, b: 828 }, s = (sx, sy, sw, sh, dx, dy, dw, dh) => x.drawImage(f, sx, sy, sw, sh, dx, dy, dw, dh);
  const o = pad, e = pad + b; x.save(); x.shadowColor = '#000b'; x.shadowBlur = 12; x.shadowOffsetY = 5;
  const edge = (horizontal, sx, sy, sw, sh, dx, dy) => { // зеркальная укладка вдоль стороны
    const len = horizontal ? sw : sh, n = Math.max(1, Math.round(b / (len * k))), d = b / n;
    for (let i = 0; i < n; i++) { x.save();
      if (horizontal) { x.translate(dx + i * d + (i % 2 ? d : 0), dy); x.scale(i % 2 ? -1 : 1, 1); s(sx, sy, sw, sh, 0, 0, d + .6, sh * k); }
      else { x.translate(dx, dy + i * d + (i % 2 ? d : 0)); x.scale(1, i % 2 ? -1 : 1); s(sx, sy, sw, sh, 0, 0, sw * k, d + .6); }
      x.restore(); }
  };
  const iw = IN.r - IN.l, ih = IN.b - IN.t, T = 171, L = 184, R = 1024 - 839, B = 1024 - 828;
  edge(true, IN.l + 60, 0, iw - 120, T, o, o - T * k); edge(true, IN.l + 60, IN.b, iw - 120, B, o, e);
  edge(false, 0, IN.t + 60, L, ih - 120, o - L * k, o); edge(false, IN.r, IN.t + 60, R, ih - 120, e, o);
  const c = 60; // углы берут немного соседней стороны
  s(0, 0, L + c, T + c * 0, o - L * k, o - T * k, (L + c) * k, T * k); s(0, 0, L, T + c, o - L * k, o - T * k, L * k, (T + c) * k);
  s(IN.r - c, 0, R + c, T, e - c * k, o - T * k, (R + c) * k, T * k); s(IN.r, 0, R, T + c, e, o - T * k, R * k, (T + c) * k);
  s(0, IN.b, L + c, B, o - L * k, e, (L + c) * k, B * k); s(0, IN.b - c, L, B + c, o - L * k, e - c * k, L * k, (B + c) * k);
  s(IN.r - c, IN.b, R + c, B, e - c * k, e, (R + c) * k, B * k); s(IN.r, IN.b - c, R, B + c, e, e - c * k, R * k, (B + c) * k);
  // ветви к цветам
  G.flowers.forEach((fl, i) => { const y = fl.y - G.by + pad + G.fl * .27, w = G.fl * .62; x.save(); x.translate(e + F * .55, y); x.rotate(i === 2 ? .1 : -.06); s(300, 70, 330, 101, 0, -G.fl * .13, w, G.fl * .24); x.restore(); });
  x.restore(); blossoms = Array.from({ length: 22 }, (_, i) => { const side = i % 4, t = ((i / 4 | 0) + rnd(.15, .85)) / 5.5; const p = side === 0 ? [o + b * t, o - F * rnd(.3, .9)] : side === 1 ? [e + F * rnd(.3, .9), o + b * t] : side === 2 ? [o + b * t, e + F * rnd(.3, .9)] : [o - F * rnd(.3, .9), o + b * t];
    return { x: p[0] + G.bx - pad, y: p[1] + G.by - pad, r: F * rnd(.2, .36), a: rnd(6.28), h: rnd(1), d: rnd(.9) }; });
}
let blossoms = [], bloomK = 0, bloomShown = -1;

/* ---------- поле ---------- */
const off = document.createElement('canvas'), litC = document.createElement('canvas'), gl = document.createElement('canvas'); let dirty = true, litFor = null;
function rot(x, col, row, cx, cy, s, ang, src) { x.save(); x.translate(cx, cy); x.rotate(ang * Math.PI / 180); const z = s * ADJ[col][1] + 1; x.drawImage(src || img.roots, col * 384 + 1, row * 384 + 1, 382, 382, -z / 2 + ADJ[col][0] * s, -z / 2, z, z); x.restore(); }
const tipAt = (pts, t) => { let L = 0; const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])); seg.forEach(v => L += v); let d = L * t; for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const k = seg[i] ? d / seg[i] : 0; return { i, p: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k] }; } d -= seg[i]; } return { i: pts.length - 2, p: pts[pts.length - 1] }; };
function tracePart(x, pts, t, ox, oy, c) { if (t <= 0) return null; const { i, p } = tipAt(pts, clamp(t)); x.beginPath(); x.moveTo(ox + pts[0][0] * c, oy + pts[0][1] * c); for (let j = 1; j <= i; j++) x.lineTo(ox + pts[j][0] * c, oy + pts[j][1] * c); x.lineTo(ox + p[0] * c, oy + p[1] * c); x.stroke(); return [ox + p[0] * c, oy + p[1] * c]; }
function drawBoard(now) {
  const x = X.board, { b, c } = G; if (!b) return; x.save(); x.translate(4, 4); x.clearRect(-4, -4, b + 8, b + 8);
  const choice = S.stage === 'choice' && !S.busy, breath = .5 + .5 * Math.sin(now / 520);
  const board = boardOf(S.bits);
  for (const k of cells) {
    const r = k.p / 5 | 0, q = k.p % 5, ox = q * c, oy = r * c, cx = ox + c / 2, cy = oy + c / 2, rotor = ROT.includes(k.p);
    x.save(); x.beginPath(); x.rect(ox, oy, c + .4, c + .4); x.clip();
    x.drawImage(img.tile, ox, oy, c, c);
    const [col, quarter] = artOf(board[k.p]); const s = c * (1 + k.bump * .07);
    const dim = choice && !rotor ? .3 : k.dim; if (rotor && k.spin > 260) { x.globalAlpha = .42; for (let g = 0; g < 3; g++) rot(x, col, 0, cx, cy, s, k.ang - g * k.spin * .02); x.globalAlpha = 1; }
    else rot(x, col, 0, cx, cy, s, rotor ? k.ang : quarter * 90);
    if (k.hover > .01) { x.globalAlpha = .5 * k.hover * (.8 + .2 * breath); x.globalCompositeOperation = 'lighter'; rot(x, col, 0, cx, cy, s, k.ang + 90); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; }
    if (dim > .01) { x.fillStyle = `rgba(4,10,14,${dim})`; x.fillRect(ox, oy, c + 1, c + 1); }
    x.restore();
  }
  if (S.lit) drawLit(x, now);
  for (let i = 0; i < 12; i++) if (S.held >> i & 1) vine(x, ROT[i], now); // закреплённые корни: золотая лоза
  if (choice) for (const p of ROT) { const ox = p % 5 * c, oy = (p / 5 | 0) * c, h = cells[p].hover, g = x.createRadialGradient(ox + c / 2, oy + c / 2, c * .1, ox + c / 2, oy + c / 2, c * .62);
    g.addColorStop(0, `rgba(255,236,170,${.13 + .12 * breath + h * .22})`); g.addColorStop(1, 'rgba(255,214,120,0)'); x.globalCompositeOperation = 'lighter'; x.fillStyle = g; x.fillRect(ox, oy, c, c); x.globalCompositeOperation = 'source-over';
    x.strokeStyle = `rgba(255,232,160,${.55 + .3 * breath + h * .3})`; x.lineWidth = 1.5 + h * 1.5; const m = c * .06; x.beginPath(); x.roundRect(ox + m, oy + m, c - m * 2, c - m * 2, c * .09); x.stroke();
    const a = now / 1600 + p; x.lineWidth = Math.max(1.6, c * .022); x.strokeStyle = `rgba(255,246,205,${.65 + .3 * breath})`; const rr = c * .105, gx = ox + c * .84, gy = oy + c * .84; x.fillStyle = '#0b2119d0'; x.beginPath(); x.arc(gx, gy, rr * 1.45, 0, 7); x.fill();
    const a0 = h > .2 ? now / 260 : a; x.beginPath(); x.arc(gx, gy, rr, a0, a0 + 4.6); x.stroke(); const tx = gx + rr * Math.cos(a0 + 4.6), ty = gy + rr * Math.sin(a0 + 4.6), t = a0 + 4.6 + Math.PI / 2; x.beginPath(); x.moveTo(tx + Math.cos(t - 2.5) * rr * .7, ty + Math.sin(t - 2.5) * rr * .7); x.lineTo(tx, ty); x.lineTo(tx + Math.cos(t + 2.5) * rr * .7, ty + Math.sin(t + 2.5) * rr * .7); x.stroke(); }
  x.restore();
}
function vine(x, p, now) {
  const c = G.c, ox = p % 5 * c, oy = (p / 5 | 0) * c, board = boardOf(S.bits), arms = armsOf(board[p]), ks = Object.keys(arms), pts = [...arms[ks[0]], ...[...arms[ks[1]]].reverse().slice(1)], N = 40, g = cells[p].grow ?? 1;
  x.save(); x.lineCap = 'round';
  for (const ph of [0, Math.PI]) for (let i = 0; i < N * g; i++) { const t = i / N, a = tipAt(pts, t).p, z = tipAt(pts, Math.min(1, t + 1 / N)).p, dx = z[0] - a[0], dy = z[1] - a[1], l = Math.hypot(dx, dy) || 1, wv = u => Math.sin(u * 20 + ph), n0 = wv(t) * .095, n1 = wv(t + 1 / N) * .095, front = Math.cos(t * 20 + ph) > -.25; if (!front) continue;
    x.strokeStyle = i % 2 ? '#ffe39a' : '#d99f32'; x.lineWidth = c * .03; x.shadowColor = '#ffc74a'; x.shadowBlur = c * .07; x.beginPath(); x.moveTo(ox + (a[0] - dy / l * n0) * c, oy + (a[1] + dx / l * n0) * c); x.lineTo(ox + (z[0] - dy / l * n1) * c, oy + (z[1] + dx / l * n1) * c); x.stroke(); }
  x.shadowBlur = 0; const pul = .6 + .4 * Math.sin(now / 600 + p); x.strokeStyle = `rgba(255,214,110,${.55 * g * pul + .25 * g})`; x.lineWidth = 2; const m = c * .05; x.beginPath(); x.roundRect(ox + m, oy + m, c - m * 2, c - m * 2, c * .08); x.stroke(); x.restore();
}
function drawLit(x, now) {
  const L = S.lit, { b, c } = G, px = Math.round(b * DPR); if (off.width !== px) for (const k of [off, litC]) { k.width = k.height = px; litFor = null; }
  const key = S.bits + ':' + S.energy; if (litFor !== key) { const y = litC.getContext('2d'); y.setTransform(DPR, 0, 0, DPR, 0, 0); y.clearRect(0, 0, b, b); const sp = litSprite(S.energy), board = boardOf(S.bits);
    for (const p of L.flow.seen.keys()) { const [col, q] = artOf(board[p]); y.save(); y.beginPath(); y.rect(p % 5 * c, (p / 5 | 0) * c, c + .4, c + .4); y.clip(); rot(y, col, 0, p % 5 * c + c / 2, (p / 5 | 0) * c + c / 2, c, q * 90, sp); y.restore(); } litFor = key; }
  const y = off.getContext('2d'); y.setTransform(DPR, 0, 0, DPR, 0, 0); y.globalCompositeOperation = 'source-over'; y.clearRect(0, 0, b, b); y.lineCap = y.lineJoin = 'round'; y.lineWidth = c * .34; y.strokeStyle = '#fff';
  L.heads = []; for (const s of L.segs) { const t = clamp((L.t - s.at) / s.len); if (t <= 0) continue; y.save(); y.beginPath(); y.rect(s.ox, s.oy, c + .4, c + .4); y.clip(); const h = tracePart(y, s.pts, t, s.ox, s.oy, c); y.restore(); if (t < 1 && h) L.heads.push([h[0], h[1]]); else if (!s.done) { s.done = true; s.end && s.end(); } }
  y.globalCompositeOperation = 'source-in'; y.setTransform(1, 0, 0, 1, 0, 0); y.drawImage(litC, 0, 0);
  const fade = L.fade ?? 1; x.globalAlpha = fade; x.drawImage(off, 0, 0, b, b);
  gl.width = gl.height = 90; const z = gl.getContext('2d'); z.drawImage(off, 0, 0, 90, 90); x.globalCompositeOperation = 'lighter'; x.globalAlpha = fade * (.42 + .1 * Math.sin(now / 420)); x.drawImage(gl, -2, -2, b + 4, b + 4);
  // живой сок: светлые импульсы бегут от источника
  x.globalAlpha = fade; x.lineCap = 'round'; x.lineWidth = c * .05; x.strokeStyle = '#ffffffb0'; x.setLineDash([c * .13, c * .55]);
  for (const s of L.segs) { if (clamp((L.t - s.at) / s.len) < 1) continue; x.lineDashOffset = -((now / 1000) * c * .55 - s.at / 260 * c * .2) + (s.inward ? 0 : c * .3); x.beginPath(); s.pts.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](s.ox + p[0] * c, s.oy + p[1] * c)); x.globalAlpha = fade * .5; x.stroke(); }
  x.setLineDash([]); x.globalAlpha = 1;
  for (const [hx, hy] of L.heads) { const r = c * .3, g = x.createRadialGradient(hx, hy, 0, hx, hy, r); g.addColorStop(0, '#fff'); g.addColorStop(.25, ECOL[S.energy]); g.addColorStop(1, 'transparent'); x.fillStyle = g; x.beginPath(); x.arc(hx, hy, r, 0, 7); x.fill(); if (Math.random() < .5) spark(G.bx + hx, G.by + hy, ECOL[S.energy], 1); }
  x.globalCompositeOperation = 'source-over';
}

/* ---------- частицы ---------- */
let parts = [], flies = [], falls = [], rays = 0, ring = -1, beams = [];
const spark = (x, y, color, n = 6, v = 60) => { if (S.calm) return; for (let i = 0; i < n && parts.length < 420; i++) { const a = rnd(6.28), s = rnd(.2, 1) * v; parts.push({ k: 's', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 12, g: 40, life: rnd(.35, .95), t: 0, r: rnd(1, 2.6), color }); } };
const petal = (x, y, vx, vy, big = 1) => { if (!S.calm && parts.length < 420) parts.push({ k: 'p', x, y, vx, vy, g: 26, life: rnd(2.4, 4.4), t: 0, r: rnd(4, 9) * big, a: rnd(6.28), va: rnd(-3, 3), color: ['#ffd98a', '#f6b6d8', '#d3aef5', '#fff0c0'][rnd(4) | 0], sway: rnd(6.28) }); };
const leaf = (x, y) => { if (!S.calm && parts.length < 420) parts.push({ k: 'p', x, y, vx: rnd(-60, 60), vy: rnd(-70, -10), g: 120, life: rnd(.6, 1.2), t: 0, r: rnd(2.5, 5), a: rnd(6.28), va: rnd(-6, 6), color: ['#6ea24a', '#8a6b3d', '#4f8a4f'][rnd(3) | 0], sway: 0 }); };
function buildFalls() { // водопады фона: координаты рисунка 1672x941 под object-fit cover
  const { W, H } = G, s = Math.max((W + 28) / 1672, (H + 28) / 941), ox = (W - 1672 * s) / 2, oy = (H - 941 * s) / 2;
  falls = [[200, 275, 55, 135], [323, 275, 28, 75], [440, 140, 36, 210], [349, 148, 20, 92], [196, 168, 20, 76], [1514, 240, 66, 130], [1462, 440, 56, 188], [1438, 662, 52, 84], [1546, 440, 20, 110], [180, 555, 70, 102], [756, 745, 56, 66]].map(([x, y, w, h]) => ({ x: ox + x * s, y: oy + y * s, w: w * s, h: h * s, st: Array.from({ length: 7 }, () => ({ u: rnd(1), t: rnd(1), v: rnd(.35, .75), l: rnd(.12, .3) })) }));
  flies = Array.from({ length: G.kind === 'full' ? 30 : 16 }, () => ({ x: rnd(W), y: rnd(H), a: rnd(6.28), v: rnd(5, 16), p: rnd(6.28), r: rnd(1.2, 2.4) }));
}
function drawBack(now, dt) {
  const x = X.back, { W, H } = G; x.clearRect(0, 0, W, H); x.globalCompositeOperation = 'lighter'; x.lineCap = 'round';
  if (!S.calm) for (const f of falls) for (const s of f.st) { s.t += dt * s.v; if (s.t > 1) { s.t -= 1; s.u = rnd(1); } const y0 = f.y + f.h * s.t, y1 = Math.min(f.y + f.h, y0 + f.h * s.l); x.strokeStyle = `rgba(190,225,255,${.28 * Math.sin(Math.PI * clamp(s.t))})`; x.lineWidth = Math.max(1, f.w * .06); x.beginPath(); x.moveTo(f.x + f.w * s.u, y0); x.lineTo(f.x + f.w * s.u, y1); x.stroke(); }
  if (rays > .01) { const cx = G.bx + G.b / 2, cy = G.by + G.b / 2, R = Math.max(W, H) * .8; x.save(); x.translate(cx, cy); x.rotate(now / 9000); const g = x.createRadialGradient(0, 0, G.b * .3, 0, 0, R); g.addColorStop(0, `rgba(255,214,110,${.36 * rays})`); g.addColorStop(1, 'rgba(255,190,80,0)'); x.fillStyle = g; for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, a, a + .2); x.fill(); } x.restore(); }
  const warm = S.mode === 'bonus' || rays > .1; if (!S.calm) for (const f of flies) { f.a += rnd(-1, 1) * dt * 2; f.x += Math.cos(f.a) * f.v * dt; f.y += Math.sin(f.a) * f.v * dt - 2 * dt; if (f.x < -9) f.x = W + 8; if (f.x > W + 9) f.x = -8; if (f.y < -9) f.y = H; if (f.y > H + 9) f.y = -8; const o = (.5 + .5 * Math.sin(now / 700 + f.p)) * .8, r = f.r * (warm ? 5.5 : 4), g = x.createRadialGradient(f.x, f.y, 0, f.x, f.y, r); g.addColorStop(0, warm ? `rgba(255,236,160,${o})` : `rgba(190,255,220,${o})`); g.addColorStop(1, 'transparent'); x.fillStyle = g; x.fillRect(f.x - r, f.y - r, r * 2, r * 2); }
  x.globalCompositeOperation = 'source-over';
}
function blossom(x, f, k) { const s = clamp((k - f.d * .5) / .5); if (s <= 0) return; const im = img[f.h > .5 ? 'bpink' : 'bgold'], d = f.r * 3.3 * Math.max(.01, back(s)); x.save(); x.translate(f.x, f.y); x.rotate(f.a + (1 - s) * 2); x.shadowColor = f.h > .5 ? '#ff9ad0' : '#ffcf6a'; x.shadowBlur = f.r * .9; x.drawImage(im, -d / 2, -d / 2, d, d); x.restore(); }
function drawFx(now, dt) {
  const x = X.fx, { W, H, F, b, bx, by } = G; x.clearRect(0, 0, W, H);
  const goal = S.mode === 'bonus' ? 1 : 0; bloomK += clamp(goal - bloomK, -dt * .9, dt * .7); if (S.calm) bloomK = goal; if (bloomK !== bloomShown) { bloomShown = bloomK; const y = X.bloom; y.clearRect(0, 0, W, H); if (bloomK > .01) for (const f of blossoms) blossom(y, f, bloomK); }
  x.globalCompositeOperation = 'lighter';
  for (const m of beams) { if (m.k <= 0) continue; const X1 = m.x0 + (m.x1 - m.x0) * clamp(m.k); for (const [w, a] of [[m.w * 2.6, .16], [m.w * 1.4, .4], [m.w * .5, .95]]) { x.globalAlpha = a * (m.o ?? 1); x.strokeStyle = w < m.w ? '#fff' : m.c; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); const N = 14; for (let i = 0; i <= N; i++) { const u = i / N, yy = m.y + (m.y1 - m.y) * u + Math.sin(u * 9 - now / 90) * m.w * .25 * Math.sin(u * Math.PI); x[i ? 'lineTo' : 'moveTo'](m.x0 + (X1 - m.x0) * u, yy); } x.stroke(); } x.globalAlpha = 1; }
  if (ring >= 0 && ring <= 1) { const l = bx - F * .5, rr = bx + b + F * .5, t = by - F * .5, sd = b + F, half = sd * 2, d0 = half * 1.25 * smooth(ring);
    const at = (d, up) => { const q = up ? -1 : 1, m = t + sd / 2; return d < sd / 2 ? [l, m + q * d] : d < sd * 1.5 ? [l + d - sd / 2, m + q * sd / 2] : [rr, m + q * (sd / 2 - (d - sd * 1.5))]; };
    for (const up of [1, 0]) for (let i = 0; i < 70; i++) { const u = i / 70, d = d0 - u * half * .42; if (d < 0 || d > half) continue; const [gx, gy] = at(d, up), k = (1 - u) ** 2, R = F * (.35 + 1.15 * k), g = x.createRadialGradient(gx, gy, 0, gx, gy, R); g.addColorStop(0, `rgba(255,250,220,${.5 * k})`); g.addColorStop(.35, `rgba(255,208,105,${.26 * k})`); g.addColorStop(1, 'rgba(255,180,60,0)'); x.fillStyle = g; x.fillRect(gx - R, gy - R, R * 2, R * 2); if (i === 0 && Math.random() < .7) spark(gx, gy, '#ffe39a', 2, 70); } }
  parts = parts.filter(p => (p.t += dt) < p.life); for (const p of parts) { p.vy += p.g * dt; p.x += (p.vx + (p.sway ? Math.sin(now / 500 + p.sway) * 26 : 0)) * dt; p.y += p.vy * dt; const o = clamp((1 - p.t / p.life) * 2);
    if (p.k === 's') { x.globalAlpha = o; x.fillStyle = p.color; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill(); x.globalAlpha = o * .3; x.beginPath(); x.arc(p.x, p.y, p.r * 2.6, 0, 7); x.fill(); }
    else { x.globalCompositeOperation = 'source-over'; p.a += p.va * dt; if (p.sway) p.vy = Math.min(p.vy, 90); x.globalAlpha = o * .95; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.scale(1, .5 + .5 * Math.abs(Math.sin(now / 350 + p.sway))); x.fillStyle = p.color; x.beginPath(); x.ellipse(0, 0, p.r, p.r * .55, 0, 0, 7); x.fill(); x.restore(); x.globalCompositeOperation = 'lighter'; } }
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; for (const w of [...waiters]) w.step(now);
  for (const k of cells) { if (k.target !== undefined) continue; if (k.spinning) { k.spin += (640 - k.spin) * Math.min(1, dt * 7); k.ang += k.spin * dt; dirty = true; } }
  for (const k of cells) { const h = k.hot && S.stage === 'choice' && !S.busy ? 1 : 0; if (Math.abs(h - k.hover) > .01) { k.hover += (h - k.hover) * Math.min(1, dt * 10); dirty = true; } else k.hover = h; }
  if (dirty || S.lit || S.held || S.stage === 'choice') { drawBoard(now); dirty = S.busy; }
  drawBack(now, dt); drawFx(now, dt); requestAnimationFrame(frame);
}

/* ---------- интерфейс ---------- */
$('.fh-flowers').innerHTML = [0, 1, 2].map(i => `<div class="fh-flower" data-i="${i}"><div class="petals">${[-58, -38, -19, 0, 19, 38, 58].map(a => `<i data-a="${a}"></i>`).join('')}</div><img class="open" src="assets/flower.webp" alt=""><img class="bud" src="assets/bud.webp" alt=""><span class="v"></span></div>`).join('');
$('.fh-seeds').innerHTML = '<i class="fh-seed"></i>'.repeat(4);
$('.fh-cells').innerHTML = cells.map(k => `<button disabled data-p="${k.p}" aria-label="Корень ${k.p + 1}"></button>`).join('');
const stakeSel = $('#stake'); stakeSel.innerHTML = STAKES.map(v => `<option value="${v}"${v === 10 ? ' selected' : ''}>${money(v)}</option>`).join('');
const say = (a, b = '') => { $('.say b').textContent = a; $('.say span').textContent = b; };
const flowerValue = () => S.stake * .631 * S.energy;
function setMode(m) { S.mode = m; root.dataset.mode = m; }
function ui() {
  $('.fh-money b').textContent = money(S.balance); stakeSel.value = S.stake;
  const go = $('[data-a=go]'), act = S.stage === 'bonus' || S.stage === 'choice';
  $('.fh-go').classList.toggle('wait', S.busy && !S.revealing);
  const [t, s] = S.busy ? S.revealing ? ['ПОКАЗАТЬ ИТОГ', 'пропустить анимацию'] : ['ПРОБУЖДАЕМ', 'ждём ответ леса'] : S.stage === 'choice' ? ['ОСТАВИТЬ', 'не поворачивать, бесплатно'] : S.stage === 'bonus' ? ['ПРОДОЛЖИТЬ', `бесплатно, осталось ${S.bonusLeft}`] : ['ПРОБУДИТЬ', `${money(S.stake)} USDT за поле`];
  $('span', go).textContent = t; $('small', go).textContent = s; go.disabled = S.busy && !S.revealing || !act && !S.busy && S.balance < S.stake;
  const au = $('[data-a=auto]'); au.setAttribute('aria-pressed', !!S.auto); $('em', au).textContent = S.auto ? `Стоп ${S.auto.left}` : 'Авто'; au.disabled = !S.auto && (S.busy || act);
  au.setAttribute('aria-label', S.auto ? `Остановить автоигру, осталось ${S.auto.left}` : 'Автоигра');
  for (const a of ['less', 'more']) $(`[data-a=${a}]`).disabled = S.busy || act || !!S.auto; stakeSel.disabled = S.busy || act || !!S.auto;
  $$('.fh-cells button').forEach(b => { b.disabled = S.busy || S.stage !== 'choice' || !ROT.includes(+b.dataset.p); });
  const tier = !S.busy && S.stage === 'idle' ? S.tier : ''; const plate = $('.fh-plate'); plate.dataset.tier = tier;
  $('.sum small', plate).textContent = (S.stage === 'idle' && !S.busy ? 'Возврат' : 'Собрано') + (G.kind === 'landscape' ? '' : ', USDT');
  const net = $('.net', plate); $('small', net).textContent = S.mode === 'bonus' ? 'Бесплатных' : tier ? 'Чистый итог' : ''; $('b', net).textContent = S.mode === 'bonus' ? `${S.bonusLeft} из 4` : tier ? (S.total - S.stakePaid > 0 ? '+' : '') + money(S.total - S.stakePaid) : '';
  $$('.fh-flower').forEach((el, i) => { const paid = S.paid >> i & 1; el.dataset.paid = !!paid; $('.v', el).textContent = money(flowerValue()); });
  $$('[data-sc]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.sc === S.scenario); b.disabled = !!act || S.busy; });
  $$('.fh-seed').forEach((s, i) => s.classList.toggle('used', S.mode === 'bonus' && i >= S.bonusLeft));
}
const setSum = v => { $('.fh-plate .sum b').textContent = money(v); };
function energy(e, pop) { S.energy = e; const el = $('.fh-energy'); el.firstChild.textContent = '×' + e; root.style.setProperty('--e', ECOL[e]); root.style.setProperty('--gem', EGEM[e]); root.style.setProperty('--halo', { 1: .8, 2: .95, 5: 1.1, 20: 1.3, 100: 1.6 }[e]); root.style.setProperty('--halo-o', { 1: .4, 2: .55, 5: .7, 20: .8, 100: .95 }[e]); litFor = null;
  if (pop && e > 1) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); spark(G.gem.x, G.gem.y, ECOL[e], Math.min(60, 10 + e), 150); } ui(); }
function aura(c, on = 1) { const a = $('.fh-aura'); a.style.setProperty('--aura', c); a.style.opacity = on ? .34 : 0; }
async function banner(t, s, ms) { const b = $('.fh-banner'); b.innerHTML = t + (s ? `<small>${s}</small>` : ''); if (S.calm || S.skip) return; b.style.top = G.by - G.F * .2 + G.b * .5 + 'px'; await b.animate([{ opacity: 0, transform: 'translate(-50%,-30%) scale(.8)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .22 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.02)', offset: .75 }, { opacity: 0, transform: 'translate(-50%,-64%) scale(1.04)' }], { duration: ms, easing: 'ease-out' }).finished.catch(() => {}); }

/* цветок: бутон расходится на лепестки, за ними раскрывается рисунок цветка */
function bloom(i, on, instant) {
  const el = $$('.fh-flower')[i], open = $('.open', el), bud = $('.bud', el); for (const n of [open, bud, ...$$('.petals i', el)]) n.getAnimations().forEach(a => a.cancel());
  open.style.opacity = on ? 1 : 0; open.style.transform = on ? 'scale(1)' : 'scale(.35)'; bud.style.opacity = on ? 0 : 1; if (instant || S.calm || S.skip) return;
  if (!on) { open.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4)' }], { duration: 320, easing: 'ease-in' }); bud.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 380 }); return; }
  bud.animate([{ opacity: 1, transform: 'scale(1)', filter: 'brightness(1)' }, { opacity: 1, transform: 'scale(1.16,1.08)', filter: 'brightness(2)', offset: .55 }, { opacity: 0, transform: 'scale(1.3,.8)', filter: 'brightness(2.4)' }], { duration: 360, easing: 'ease-in' });
  $$('.petals i', el).forEach((p, n) => { const a = +p.dataset.a; p.animate([{ opacity: 0, transform: 'rotate(0) scale(.5,.8)' }, { opacity: .95, transform: `rotate(${a * .35}deg) scale(.8,1)`, offset: .35 }, { opacity: .9, transform: `rotate(${a * .95}deg) scale(1.05)`, offset: .75 }, { opacity: 0, transform: `rotate(${a * 1.05}deg) scale(1.1)` }], { duration: 780, delay: 170 + Math.abs(n - 3) * 22, easing: 'cubic-bezier(.2,.8,.3,1)' }); });
  open.animate([{ opacity: 0, transform: 'scale(.3,.5)' }, { opacity: 1, transform: 'scale(1.18)', offset: .6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 620, delay: 330, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'backwards' });
  const f = G.flowers[i]; setTimeout(() => { spark(f.x, f.y, '#ffd875', 26, 120); for (let k = 0; k < 7; k++) petal(f.x, f.y, rnd(-70, 50), rnd(-90, -10), .8); }, 320);
}
async function flyValue(i) {
  const v = flowerValue(), f = G.flowers[i]; S.total = +(S.total + v).toFixed(2); const to = S.total;
  if (S.calm || S.skip) { setSum(to); return; }
  const el = document.createElement('div'); el.className = 'fh-fly'; el.textContent = '+' + money(v); root.append(el); flyers.add(el); const w = el.offsetWidth; el.style.left = f.x - w / 2 + 'px'; el.style.top = f.y - 8 + 'px';
  const dx = G.sum.x - f.x, dy = G.sum.y - f.y; await el.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'translateY(-26px) scale(1.15)', opacity: 1, offset: .3 }, { transform: `translate(${dx * .5}px,${dy * .55 - 40}px) scale(1)`, opacity: 1, offset: .65 }, { transform: `translate(${dx}px,${dy}px) scale(.8)`, opacity: .2 }], { duration: pace(820), easing: 'ease-in-out' }).finished.catch(() => {}); el.remove(); flyers.delete(el);
  if (!S.skip) { setSum(to); const s = $('.fh-plate .sum b'); s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); spark(G.sum.x, G.sum.y, '#ffe39a', 8, 60); }
}

/* ---------- раунд ---------- */
const rotTarget = (p, bits) => (bits >> ROT.indexOf(p) & 1) * 90;
function paintRest() { for (const k of cells) { k.spinning = false; k.spin = 0; k.target = undefined; k.bump = 0; k.dim = 0; if (ROT.includes(k.p)) k.ang = rotTarget(k.p, S.bits); } dirty = true; }
function startSpin(heldMask) { ROT.forEach((p, i) => { if (!(heldMask >> i & 1)) { cells[p].spinning = true; cells[p].target = undefined; if (!S.calm) { leaf(G.bx + (p % 5 + .5) * G.c, G.by + ((p / 5 | 0) + .5) * G.c); leaf(G.bx + (p % 5 + .5) * G.c, G.by + ((p / 5 | 0) + .5) * G.c); } } }); if (S.calm) return; for (const k of cells) k.dim = .16; }
async function stopSpin(bits, heldMask) {
  const jobs = ROT.map((p, i) => (async () => { const k = cells[p]; if (heldMask >> i & 1) { return; } const r = p / 5 | 0, q = p % 5; await wait(pace(q * 120 + Math.abs(r - 2) * 45)); k.spinning = false; k.target = 1; const t = (bits >> i & 1) * 90, from = k.ang; let to = Math.ceil((from + 130 - t) / 180) * 180 + t; const v0 = k.spin;
    await tween(pace(460), u => { k.ang = from + (to - from) * back(u); k.spin = v0 * (1 - u) * .5; k.bump = u > .7 ? Math.sin((u - .7) / .3 * Math.PI) : 0; dirty = true; }); k.ang = t; k.spin = 0; k.bump = 0; k.target = undefined;
    if (!S.skip && !S.calm) { const x = G.bx + (q + .5) * G.c, y = G.by + (r + .5) * G.c; spark(x, y, '#d9b56a', 5, 70); leaf(x, y); } })());
  await Promise.all(jobs); S.bits = bits; paintRest();
}
function aim(m) { Object.assign(m, m.f < 0 ? { x0: G.gem.x, x1: G.bx + 2, y: G.gem.y, y1: G.by + G.c * 2.484, w: Math.max(3, G.c * .07) } : { x0: G.bx + G.b - 2, x1: G.flowers[m.f].x, y: G.by + G.c * (m.f * 2 + .486), y1: G.flowers[m.f].y, w: Math.max(3, G.c * .06) }); return m; }
async function runFlow(prevMask) {
  const board = boardOf(S.bits), flow = flowOf(board), T = pace(150), segs = [], c = G.c, done = []; S.flow = flow; litFor = null;
  const beamIn = aim({ f: -1, k: 0, c: ECOL[S.energy] }); beams = [beamIn];
  for (const [p, { depth, entry }] of flow.seen) { const arms = armsOf(board[p]), ox = p % 5 * c, oy = (p / 5 | 0) * c; for (const d in arms) { const inward = +d === entry, n = nb(p, +d), port = +d === 1 && [4, 14, 24].includes(p), linked = port || inward || n >= 0 && board[n] & PORT[(+d + 2) % 4];
      const s = { p, ox, oy, pts: inward ? arms[d] : [...arms[d]].reverse(), at: depth * T + (inward ? 0 : T * .5), len: T * .5, inward }; segs.push(s);
      if (!linked) s.end = () => { if (S.skip || S.calm) return; const e = s.pts[s.pts.length - 1]; for (let i = 0; i < 6; i++) spark(G.bx + ox + e[0] * c, G.by + oy + e[1] * c, ECOL[S.energy], 1, 34); };
      if (port) { const i = [4, 14, 24].indexOf(p); if (!(prevMask >> i & 1)) done.push({ i, at: depth * T + T }); else { beams.push(aim({ f: i, k: 0, at: depth * T + T, c: ECOL[S.energy], o: .6 })); } } } }
  const maxD = Math.max(...[...flow.seen.values()].map(v => v.depth)), total = (maxD + 1) * T + 60;
  S.lit = { flow, segs, t: -1, heads: [], fade: 1 };
  pose('channel'); aura(ECOL[S.energy]); spark(G.gem.x, G.gem.y, ECOL[S.energy], 16, 90);
  await tween(pace(260), u => { beamIn.k = easeOut(u); });
  const flowers = done.map(async d => { await wait(d.at); const bm = aim({ f: d.i, k: 0, c: ECOL[S.energy] }); beams.push(bm); await tween(pace(140), u => { bm.k = u; }); S.paid |= 1 << d.i; ui(); bloom(d.i, true); if (S.mode !== 'bonus') pose('flower'); await wait(pace(420)); await flyValue(d.i); });
  for (const b of beams) if (b.at !== undefined) wait(b.at).then(() => tween(140, u => { b.k = u; }));
  const t0 = performance.now(); await tween(total, u => { S.lit.t = u * total; }); S.lit.t = 1e9; for (const b of beams) b.k = 1; dirty = true; await Promise.all(flowers);
  S.paid |= flow.mask; return flow;
}
function clearRound() { S.lit = null; beams = []; rays = 0; ring = -1; aura('#63f5d0', 0); for (let i = 0; i < 3; i++) if (S.paid >> i & 1) bloom(i, false); S.paid = 0; }
function pick() {
  const r = () => Math.random() * 4096 | 0, good = () => [132, 132 | 2048, 0, 36][rnd(4) | 0];
  switch (S.scenario) {
    case 'loss': return { bits: 4095, e: 1 }; case 'partial': return { bits: 0, e: 1 }; case 'win': return { bits: 132, e: 1 }; case 'e5': return { bits: 132, e: 5 }; case 'e20': return { bits: 132, e: 20 };
    case 'choice': return { bits: 0, e: 2, ability: true }; case 'bonus': return { bits: 0, e: 1, bonus: [[132, 1], [r(), 2], [0, 1], [132, 5]] };
    case 'max': return { bits: 132, e: 100, bonus: [[132, 100], [132, 100], [132, 100], [132, 100]] };
    default: { const o = { bits: r(), e: energyDraw(), ability: Math.random() < 1 / 32 }; if (Math.random() < 1 / 64) o.bonus = [0, 1, 2, 3].map(() => [r(), energyDraw()]); return o; }
  }
}
async function start() {
  if (S.busy || S.stage !== 'idle' || S.balance < S.stake) return;
  S.busy = true; S.revealing = false; S.skip = false; S.tier = ''; S.total = 0; S.stakePaid = S.stake; S.balance = +(S.balance - S.stake).toFixed(2); clearRound(); S.held = 0; setMode('base'); setSum(0); energy(1); pose('idle');
  say('Корни ищут путь', 'Ставка принята. Итог покажем, когда свет дойдёт до цветов.'); ui(); if (S.calm) paintRest(); startSpin(0);
  const o = pick(); await new Promise(r => setTimeout(r, S.calm ? 150 : pace(620))); S.round = o; S.revealing = true; ui();
  await stopSpin(o.bits, 0); energy(o.e, true); await wait(pace(o.e > 1 ? 520 : 120)); say(o.e > 1 ? `Энергия источника ×${o.e}` : 'Свет идёт по корням', `Каждый цветок принесёт ${money(flowerValue())} USDT.`);
  await runFlow(0); if (o.ability) return toChoice(); await afterBase();
}
async function toChoice() { await wait(pace(250)); finishSkip(); S.stage = 'choice'; pose('choice'); aura('#ffd875'); say('Поверни один корень', S.auto ? 'Автоигра ждёт твоего выбора.' : 'Бесплатно. Или оставь поле.'); S.busy = false; ui(); dirty = true; }
async function turn(p) {
  if (S.busy || S.stage !== 'choice') return; S.busy = true; S.skip = false; S.revealing = true; S.stage = 'turn'; const prev = S.paid; ui();
  if (p !== null) { say('Корень поворачивается', 'Собранные цветы останутся твоими.'); const k = cells[p], i = ROT.indexOf(p), from = k.ang; for (let n = 0; n < 5; n++) leaf(G.bx + (p % 5 + .5) * G.c, G.by + ((p / 5 | 0) + .5) * G.c);
    await tween(220, u => { if (S.lit) S.lit.fade = 1 - u; }); S.lit = null; beams = []; await tween(520, u => { k.ang = from + 90 * back(u); k.bump = Math.sin(u * Math.PI) * .6; dirty = true; }); spark(G.bx + (p % 5 + .5) * G.c, G.by + ((p / 5 | 0) + .5) * G.c, '#ffe39a', 22, 110); S.bits ^= 1 << i; paintRest(); await runFlow(prev); S.paid |= prev; }
  await afterBase();
}
async function afterBase() {
  if (S.round.bonus) { await wait(pace(420)); S.stage = 'bonus'; S.bonusLeft = 4; S.bonusAt = 0; S.baseTotal = S.total; S.held = 0; setMode('bonus'); pose('bonus'); aura('#ffd875'); ui(); say('Пробуждение леса', 'Корни у собранных цветов закрепятся.');
    ring = 0; tween(1100, u => { ring = u; }).then(() => { ring = -1; }); $$('.fh-seed').forEach((s, i) => setTimeout(() => { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); }, i * 140)); for (let i = 0; i < 34; i++) petal(rnd(G.W), rnd(-30, G.H * .25), rnd(-20, 20), rnd(10, 60), .9);
    await banner('Пробуждение леса', '4 бесплатных вращения', 1900); finishSkip(); S.busy = false; ui(); if (S.auto) autoNext(700); return; }
  await settle();
}
async function bonusSpin() {
  if (S.busy || S.stage !== 'bonus') return; S.busy = true; S.revealing = false; S.skip = false; clearRound(); energy(1); pose('idle'); const idx = 3 - (S.bonusLeft - 1); S.bonusLeft--; const sd = $$('.fh-seed')[S.bonusLeft]; sd.classList.remove('pop'); void sd.offsetWidth; sd.classList.add('pop'); ui(); say(`Бесплатное вращение ${idx + 1} из 4`, 'Закреплённые корни остаются на месте.');
  const [raw, e] = S.round.bonus[idx], bits = raw & ~S.held | S.bits & S.held; startSpin(S.held); await new Promise(r => setTimeout(r, S.calm ? 150 : pace(520))); S.revealing = true; ui(); await stopSpin(bits, S.held); energy(e, true); await wait(pace(e > 1 ? 420 : 80)); const fl = await runFlow(0);
  const fresh = fl.held & ~S.held; if (fresh && S.bonusLeft) { ROT.forEach((p, i) => { if (fresh >> i & 1) cells[p].grow = 0; }); S.held |= fresh; await tween(pace(650), u => ROT.forEach((p, i) => { if (fresh >> i & 1) cells[p].grow = smooth(u); })); ROT.forEach((p, i) => { if (fresh >> i & 1) { cells[p].grow = 1; spark(G.bx + (p % 5 + .5) * G.c, G.by + ((p / 5 | 0) + .5) * G.c, '#ffd875', 12, 80); } }); }
  if (S.bonusLeft) { await wait(pace(260)); finishSkip(); pose('bonus'); say('Лес ждёт', `Осталось бесплатных вращений: ${S.bonusLeft}.`); S.busy = false; ui(); if (S.auto) autoNext(650); return; }
  await settle(true);
}
function finishSkip() { S.skip = false; flyers.forEach(f => f.remove()); flyers.clear(); setSum(S.total); S.revealing = false; }
async function settle(bonus) {
  const x = S.total / S.stakePaid, tier = S.total === 0 ? 'loss' : S.total < S.stakePaid ? 'partial' : S.total === S.stakePaid ? 'even' : x >= 10 ? 'big' : 'win'; setSum(S.total); await wait(pace(tier === 'loss' ? 260 : 160));
  if (tier === 'loss') { say('Лес отдыхает', 'Свет не дошёл до цветов.'); pose('idle'); aura('#63f5d0', 0); }
  else if (tier === 'partial') { say('Частичный возврат', `Собрано меньше ставки ${money(S.stakePaid)} USDT.`); pose('idle'); aura('#63f5d0', 0); }
  else if (tier === 'even') say('Ставка возвращена', '');
  else { const big = tier === 'big'; say(big ? 'Сердце леса' : 'Лес откликается', big ? `×${x.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} к ставке` : `Ставка поля ${money(S.stakePaid)} USDT.`); pose(tier); aura('#ffd875'); $('.fh-plate').dataset.tier = tier;
    if (big && !S.calm) { ring = 0; tween(1250, u => { ring = u; }).then(() => { ring = -1; }); tween(700, u => { rays = u; }); const t0 = performance.now(); const rain = setInterval(() => { for (let i = 0; i < 4; i++) { const edge = Math.random() < .72; petal(edge ? (Math.random() < .35 ? rnd(G.bx) : rnd(G.bx + G.b, G.W)) : rnd(G.W), -12, rnd(-16, 16), rnd(30, 80), 1.1); } if (performance.now() - t0 > 3600) clearInterval(rain); }, 90); if (!S.skip) { const v = S.total; await tween(1500, u => setSum(v * smooth(u))); } setSum(S.total); await wait(500); }
    else if (!S.calm) { for (let i = 0; i < 16; i++) petal(G.bx + G.b + rnd(G.fl), rnd(G.by, G.by + G.b * .6), rnd(-40, 20), rnd(-20, 40), .8); await wait(400); } }
  S.balance = +(S.balance + S.total).toFixed(2); S.tier = tier; S.stage = 'idle'; finishSkip(); S.busy = false; if (bonus) { S.held = 0; } setMode('base'); ui(); dirty = true;
  if (bonus) { openResult(); return; } if (S.auto) autoNext(tier === 'loss' ? 520 : 950); else if (tier === 'win' || tier === 'big') setTimeout(() => { if (!S.busy && S.stage === 'idle') { pose('idle'); aura('#63f5d0', 0); } }, 4200);
}

/* ---------- автоигра ---------- */
let autoTimer;
function autoNext(ms) { clearTimeout(autoTimer); autoTimer = setTimeout(() => { if (!S.auto || S.busy || $('.fh-veil')) return; if (S.stage === 'bonus') return bonusSpin(); if (S.stage !== 'idle') return; if (!S.auto.left || S.balance < S.stake) { stopAuto(S.auto.left ? 'Не хватает средств для следующей ставки.' : 'Серия завершена.'); return; } S.auto.left--; start(); }, S.calm ? 400 : ms); }
function stopAuto(why) { clearTimeout(autoTimer); S.auto = null; ui(); if (!S.busy && S.stage === 'idle') say('Автоигра остановлена', why || ''); }
function modal(html, onClose) { const m = $('.fh-modal'), prev = document.activeElement; m.innerHTML = `<div class="fh-veil"><div class="fh-win" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`; const close = ok => { m.innerHTML = ''; document.removeEventListener('keydown', key); prev && prev.focus && prev.focus({ preventScroll: true }); onClose && onClose(ok); }; const key = e => { if (e.key === 'Escape') close(false); }; document.addEventListener('keydown', key); $$('.x', m).forEach(b => b.onclick = () => close(false)); $$('.ok', m).forEach(b => b.onclick = () => close(true)); $('.fh-win', m).focus({ preventScroll: true }); return m; }
const head = t => `<header><h3>${t}</h3><button class="x" aria-label="Закрыть">×</button></header>`;
function openAuto() { let n = 10; const m = modal(head('Автоигра') + `<p>Сколько полей пробудить подряд? Каждое поле стоит ${money(S.stake)} USDT. Бесплатные вращения бонуса в это число не входят.</p><div class="opts" role="radiogroup" aria-label="Число пробуждений">${[10, 25, 50, 100].map(v => `<button role="radio" aria-checked="${v === 10}" data-n="${v}">${v}</button>`).join('')}</div><button class="ok"></button>`, ok => { if (ok) { S.auto = { left: n, total: n }; ui(); autoNext(60); } }); const lab = () => { $('.ok', m).textContent = `Начать: ${n} по ${money(S.stake)} USDT`; $$('[data-n]', m).forEach(b => b.setAttribute('aria-checked', +b.dataset.n === n)); }; lab(); $$('[data-n]', m).forEach(b => b.onclick = () => { n = +b.dataset.n; lab(); }); }
function openResult() { const x = S.total / S.stakePaid; modal(head('Лес пробудился') + `<div class="ctr"><p>Основное поле и 4 бесплатных вращения</p><div class="big">${money(S.total)} USDT</div><p>×${x.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} к ставке. Сумма уже в кошельке.</p></div><button class="ok">${S.auto ? `Продолжить автоигру, осталось ${S.auto.left}` : 'Вернуться в лес'}</button>`, ok => { pose('idle'); aura('#63f5d0', 0); rays = 0; if (!S.auto) return; if (ok) autoNext(300); else stopAuto('Остаток серии отменён.'); }); }
function openRules() { modal(head('Как играть') + `<ul><li><b>Корни</b><span>12 прямых корней крутятся и встают случайно. Остальные 13 всегда на месте.</span></li><li><b>Свет</b><span>Идёт от кристалла по соединённым корням. Дошёл до цветка: цветок приносит 0,631 × ставка × энергия.</span></li><li><b>Энергия</b><span>×1, ×2, ×5, ×20 или ×100. У каждой свой цвет света.</span></li><li><b>Руна</b><span>Один бесплатный поворот корня. Собранные цветы не теряются.</span></li><li><b>Бонус</b><span>4 бесплатных вращения. Крайний корень у каждого цветка оплетает золотая лоза, он больше не крутится.</span></li></ul><p>Правила и выплаты прежние.</p>`); }
function openSettings() { const m = modal(head('Настройки') + `<label class="sw">Уменьшить движение<input id="calm" type="checkbox"${S.calm ? ' checked' : ''}></label>`); $('#calm', m).onchange = e => { S.calm = e.target.checked; root.classList.toggle('calm', S.calm); parts = []; dirty = true; }; }

/* ---------- события ---------- */
function act(a) {
  if (a === 'go') { if (S.busy) { if (S.revealing) S.skip = true; return; } if (S.stage === 'choice') return turn(null); if (S.stage === 'bonus') return bonusSpin(); if (S.auto) return; return start(); }
  if (a === 'auto') return S.auto ? stopAuto('Принятое поле доиграно до конца.') : openAuto();
  if (a === 'fast') { S.fast = !S.fast; $('[data-a=fast]').setAttribute('aria-pressed', S.fast); return; }
  if (a === 'less' || a === 'more') { const i = STAKES.indexOf(S.stake) + (a === 'more' ? 1 : -1); if (STAKES[i]) { S.stake = STAKES[i]; ui(); } return; }
  if (a === 'rules') return openRules(); if (a === 'settings') return openSettings();
  if (a === 'sound' && !S.busy) say('В макете звука нет', 'В игре музыка и звуки остаются прежними.');
}
root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && !b.disabled) act(b.dataset.a); });
stakeSel.onchange = () => { S.stake = +stakeSel.value; ui(); };
$$('.fh-cells button').forEach(b => { const k = cells[+b.dataset.p]; b.onpointerenter = b.onfocus = () => { k.hot = true; }; b.onpointerleave = b.onblur = () => { k.hot = false; }; b.onclick = () => { k.hot = false; turn(+b.dataset.p); }; });
$$('[data-dev]').forEach(b => b.onclick = () => device(b.dataset.dev));
$$('[data-sc]').forEach(b => b.onclick = () => { S.scenario = b.dataset.sc; ui(); if (!S.busy && S.stage === 'idle') say('Выбран исход: ' + b.textContent, 'Нажми «Пробудить».'); });
const DEV = { desk: [1108, 850], phone: [387, 800], land: [846, 342] }; let dev;
function device(d) { dev = d; $$('[data-dev]').forEach(b => b.setAttribute('aria-pressed', b.dataset.dev === d)); fitStage(); }
function fitStage() { let [w, h] = DEV[dev]; const vw = document.documentElement.clientWidth, vh = innerHeight - $('.bar').offsetHeight - 38; if (dev === 'phone' && vw < 460) { w = Math.max(320, vw); h = Math.max(568, Math.min(820, innerHeight - 20)); } const s = Math.min(vw / w, dev === 'desk' ? Math.max(.55, Math.min(1.35, vh / h)) : dev === 'land' ? 1.4 : Math.max(.9, Math.min(1.1, vh / h))); const k = Math.min(s, vw / w); G.scale = k; Object.assign(fit.style, { width: w + 'px', height: h + 'px', transform: `scale(${k})` }); Object.assign(shell.style, { width: w * k + 'px', height: h * k + 'px' }); layout(); }
addEventListener('resize', fitStage);
addEventListener('visibilitychange', () => { if (document.hidden && S.auto) stopAuto('Окно было скрыто.'); });
Promise.all([load('roots', 'roots'), load('tile', 'tile'), load('frame', 'frame'), load('bpink', 'blossom-pink'), load('bgold', 'blossom-gold'), document.fonts ? document.fonts.ready : 0]).then(() => { setMode('base'); root.classList.toggle('calm', S.calm); paintRest(); energy(1); say('Пробуди древние корни', 'Свет дойдёт от кристалла до цветов и соберёт выигрыш.'); device(document.documentElement.clientWidth < 700 ? 'phone' : 'desk'); ui(); requestAnimationFrame(frame); window.__fh = { S, G, act, turn, device, ui, layout }; });
})();
