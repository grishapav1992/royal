import { CLOTHING_COLORS, SKIN_COLORS, type Appearance } from '../shared/appearance';

export type GarmentFit = { center: number; half: number; shoulderY: number; hem: number; side: boolean; back: boolean };
const ink = '#39332c';
function shade(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount)).toString(16).padStart(2, '0')).join('');
}
function brushes(c: CanvasRenderingContext2D) {
  const fill = (color: string, edge = .65) => { c.fillStyle = color; c.fill(); if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); } };
  const line = (x: number, y: number, xx: number, yy: number, color: string, weight = .8) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const curve = (x: number, y: number, cx: number, cy: number, xx: number, yy: number, color: string, weight = .8) => {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(cx, cy, xx, yy); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const box = (x: number, y: number, w: number, h: number, color: string, edge = .65) => { c.beginPath(); c.roundRect(x, y, w, h, .8); fill(color, edge); };
  const dot = (x: number, y: number, radius: number, color: string) => { c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); fill(color, .35); };
  const path = (points: number[][], color: string, edge = .65) => { c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); fill(color, edge); };
  return { fill, line, curve, box, dot, path };
}

/** A garment pattern scales as a whole with the shoulders and hem, including every seam and accessory. */
function fitted(c: CanvasRenderingContext2D, a: Appearance, fit: GarmentFit, draw: () => void) {
  const patternHem = a.top === 4 ? 71 : 66;
  c.save(); c.translate(fit.center, fit.shoulderY);
  c.scale(fit.half / 20, (fit.hem - fit.shoulderY) / (patternHem - 44)); c.translate(-32, -44);
  draw(); c.restore();
}

/** Front and profile use different visible garment panels on the same body pattern. */
export function drawAvatarGarmentDetails(c: CanvasRenderingContext2D, a: Appearance, fit: GarmentFit) {
  fitted(c, a, fit, () => {
    const { line, curve, box, dot, path, fill } = brushes(c);
    const { side, back } = fit;
    const top = CLOTHING_COLORS[a.topColor], skin = SKIN_COLORS[a.skinTone], accent = CLOTHING_COLORS[a.accessoryColor];
    const h = a.top === 4 ? 71 : 66, seam = side ? 41 : 32, neck = side ? 37 : 32;
    c.beginPath(); c.moveTo(11, 44); c.quadraticCurveTo(19, 53, 17, h + 2); c.lineTo(10, h + 2); c.closePath(); fill(shade(top, -16), 0);
    curve(18, h - 3, 32, h + .2, 46, h - 3, shade(top, 23), .8);
    if (a.top === 0 || a.top === 3) {
      const start = side ? 31 : 25, end = side ? 43 : 39;
      curve(start, 44, neck, 53, end, 44, shade(top, -34), 2.1);
      curve(start + .3, 44, neck, 50.5, end - .3, 44, skin, 1.8);
      if (a.top === 3) {
        for (let y = 53; y < h - 3; y += 6.5) line(11, y, 53, y, shade(top, 49), 2.7);
        box(11, h - 3, 42, 4, shade(top, -17), 0);
        for (let x = 14; x < 51; x += 3) line(x, h - 2.5, x, h - .4, shade(top, 18), .55);
      }
    } else if (a.top === 1) {
      if (back) {
        c.beginPath(); c.moveTo(21, 45); c.quadraticCurveTo(32, 39, 43, 45); c.quadraticCurveTo(42, 56, 32, 58); c.quadraticCurveTo(22, 56, 21, 45); c.closePath(); fill(shade(top, -14));
        curve(25, 49, 32, 59, 39, 49, shade(top, 25), .9);
      } else {
        curve(side ? 30 : 22, 44, neck, 53, side ? 45 : 42, 44, shade(top, -27), 2.6);
        const strings = side ? [39, 43] : [28, 36];
        for (const x of strings) { curve(x, 49, x + .8, 53, x, 56, '#f3e4c8', .9); dot(x, 56, .7, '#e9d8b6'); }
        const pLeft = side ? 30 : 21, pRight = side ? 47 : 43;
        c.beginPath(); c.moveTo(pLeft + 3, h - 9); c.lineTo(pRight - 3, h - 9); c.lineTo(pRight, h - 3); c.quadraticCurveTo((pLeft + pRight) / 2, h - 1.5, pLeft, h - 3); c.closePath(); fill(shade(top, -12), .55);
        line(pLeft + 3, h - 8, pLeft + 5, h - 4, shade(top, 28), .7);
        line(pRight - 3, h - 8, pRight - 5, h - 4, shade(top, 28), .7);
      }
      box(11, h - 2.5, 42, 3.5, shade(top, -19), 0);
    } else if (a.top === 5) {
      if (!back) {
        const collarLeft = side ? 30 : 23, collarRight = side ? 46 : 41;
        path([[collarLeft, 43], [collarRight, 43], [seam, 58]], '#eee1bf', .6);
        line(collarLeft, 44, seam, 58, shade(top, -31), 1);
        line(collarRight, 44, seam, 58, shade(top, -31), 1);
        line(seam, 58, seam, h, shade(top, -31), .7);
        for (let y = 60; y < h - 1; y += 3.5) dot(seam + 1.5, y, .75, '#dfc17d');
        if (!side) for (const sign of [-1, 1]) line(32 + sign * 7, h - 5, 32 + sign * 13, h - 6, shade(top, -34), .9);
        else line(24, h - 5, 31, h - 5.5, shade(top, -34), .9);
      } else { line(32, 49, 32, h - 3, shade(top, -23), .6); box(25, h - 7, 14, 2, shade(top, -25), .4); }
    } else {
      const long = a.top === 4;
      if (!back) {
        if (side) {
          path([[30, 44], [41, 51], [38, long ? 60 : 56], [33, 51], [28, 49]], shade(top, 26));
          path([[44, 44], [41, 51], [44, long ? 56 : 53], [48, 48]], shade(top, 15), .5);
        } else {
          path([[22, 44], [31, 51], [27, long ? 61 : 56], [20, 49]], shade(top, 29));
          path([[42, 44], [33, 51], [37, long ? 61 : 56], [44, 49]], shade(top, 17));
        }
        line(seam, 51, seam, h, shade(top, -36), .9);
        for (let y = 56; y < h - 2; y += 5) dot(seam + (long ? 3 : 1.8), y, long ? .9 : .7, long ? '#a18455' : '#ead7ab');
        const pockets = side ? [27] : [20, 44];
        for (const x of pockets) { line(x - 2, h - 11, x + 2, h - 7, shade(top, -32), 1.1); line(x - 1, h - 12, x + 3, h - 8, shade(top, 26), .65); }
        if (long) { box(13, h - 13, 38, 2.3, shade(top, -18), .4); box(seam - 1.5, h - 13.6, 4, 3.5, '#b9a476', .4); }
      } else {
        curve(17, 50, 32, 56, 47, 50, shade(top, -26), .7); line(32, 54, 32, h - 2, shade(top, -23), .6);
        if (long) { box(23, h - 14, 18, 2.3, shade(top, -19), .4); for (const x of [24, 40]) dot(x, h - 12.8, .7, '#baa476'); }
      }
    }
    if (!back && a.necklace) {
      const jewelX = side ? 42 : 32;
      if (a.necklace === 2) {
        path([[jewelX - 2, 48], [jewelX + 2, 48], [jewelX + 1, 51], [jewelX + 2.7, 60], [jewelX, 63], [jewelX - 2.7, 60], [jewelX - 1, 51]], accent, .5);
        line(jewelX - .5, 53, jewelX + .6, 59, shade(accent, 30), .7);
      } else {
        const start = side ? 33 : 25, end = side ? 46 : 39;
        curve(start, 47, jewelX, 64, end, 47, '#7e653e', 1.6); curve(start, 47, jewelX, 63, end, 47, '#dfb356', 1);
        if (a.necklace === 3) {
          dot(jewelX, 57.8, 3.3, '#dfb356'); dot(jewelX, 57.8, 2.5, '#eecb76');
          c.fillStyle = '#70592f'; c.font = 'bold 4.8px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('1', jewelX, 58);
        }
      }
    }
  });
}

export function drawAvatarScarf(c: CanvasRenderingContext2D, a: Appearance, fit: GarmentFit) {
  if (!a.scarf) return;
  fitted(c, a, fit, () => {
    const { fill, line, curve } = brushes(c), accent = CLOTHING_COLORS[a.accessoryColor];
    const { side, back } = fit;
    const neck = side ? 37 : 32;
    if (!back) {
      const tail = side ? 40 : 37;
      c.beginPath(); c.moveTo(tail - 3, 49); c.lineTo(tail + 3, 49); c.quadraticCurveTo(tail + 4, 58, tail + 2, 64); c.lineTo(tail - 4, 63); c.closePath(); fill(accent);
      for (let x = tail - 3; x < tail + 2; x += 1.5) line(x, 62, x, 65, shade(accent, -24), .6);
      curve(tail - 1, 52, tail + 1, 59, tail - 1, 62, shade(accent, 27), .7);
    }
    c.beginPath(); c.moveTo(side ? 29 : 21, 45); c.quadraticCurveTo(neck, 50, side ? 46 : 43, 45);
    c.lineTo(side ? 45 : 42, 52); c.quadraticCurveTo(neck, 56, side ? 30 : 22, 52); c.closePath(); fill(accent);
    curve(side ? 31 : 23, 49, neck, 54, side ? 44 : 41, 49, shade(accent, 31), .8);
  });
}
