import { CLOTHING_COLORS, HAIR_COLORS, MAKEUP_COLORS, SKIN_COLORS, type Appearance } from '../shared/appearance';
import type { Facing } from '../shared/movement';

const ink = '#39332c';
function shade(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount)).toString(16).padStart(2, '0')).join('');
}

/** Separate paper pieces share the same foot anchor and animation poses as club visitors. */
export function drawAvatar(c: CanvasRenderingContext2D, a: Appearance, facing: Facing, frame: number, seated = false, sip = -1) {
  c.save(); c.beginPath(); c.rect(0, 0, 32, 40); c.clip(); c.scale(.5, .5);
  if (facing === 'left') { c.translate(64, 0); c.scale(-1, 1); }
  c.translate(32, 76); c.scale(.94, .94); c.translate(-32, -76);
  const side = facing === 'left' || facing === 'right', back = facing === 'up';
  const walking = frame < 6, step = walking ? [0, 1, .55, 0, -1, -.55][frame] : 0;
  const bounce = walking ? [0, -1.2, -.5, 0, -1.2, -.5][frame] : 0;
  const tall = a.body === 2, fat = a.body === 1;
  const lashes = a.makeup === 1 || a.makeup === 4 || a.makeup === 5;
  const lipstick = a.makeup === 2 || a.makeup === 4 || a.makeup === 5;
  const blush = a.makeup === 3 || a.makeup === 5, makeupColor = MAKEUP_COLORS[a.makeupColor];
  const skin = SKIN_COLORS[a.skinTone], hair = HAIR_COLORS[a.hairColor];
  const top = CLOTHING_COLORS[a.topColor], bottom = CLOTHING_COLORS[a.bottomColor], shoe = CLOTHING_COLORS[a.shoeColor];
  const accent = CLOTHING_COLORS[a.accessoryColor], gold = '#e6b94e';
  const headY = tall ? 26.5 : 27, headR = tall ? 17.6 : fat ? 23 : 21.5;
  const shoulderY = tall ? 39 : 45, bodyBottom = a.top === 4 ? 70 : 66;
  const half = side ? (fat ? 19 : tall ? 10 : 14) : (fat ? 27 : tall ? 17 : 21);
  const fill = (color: string, edge = .65) => { c.fillStyle = color; c.fill(); if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); } };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = .65) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); fill(color, edge);
  };
  const box = (x: number, y: number, w: number, h: number, color: string, r = 0) => { c.beginPath(); c.roundRect(x, y, w, h, r); fill(color); };
  const line = (x: number, y: number, endX: number, endY: number, color = ink, weight = .8) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(endX, endY); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const path = (points: number[][], color: string) => {
    c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); fill(color);
  };
  const star = (x: number, y: number, radius: number, color: string) => {
    path(Array.from({ length: 10 }, (_, i) => { const angle = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? radius * .48 : radius; return [x + Math.cos(angle) * r, y + Math.sin(angle) * r]; }), color);
  };
  const tattoo = (x: number, y: number, kind: number) => {
    if (kind === 1) {
      oval(x, y, 3.8, 2.5, shade(skin, 15)); line(x - 3, y, x + 3, y, '#665343'); line(x - 1, y - 2, x - .5, y, '#665343', .6);
    } else if (kind === 2) {
      oval(x, y - 1, 1.8, 1.9, '#75a798'); oval(x, y + .8, 4, 1.3, '#596a71');
      for (const dx of [-2, 0, 2]) line(x + dx, y + 2, x + dx - .5, y + 3, '#596a71', .55);
    } else if (kind === 3) {
      oval(x, y, 3.2, 1.6, '#5e8491'); path([[x - 2, y], [x - 5, y - 2], [x - 5, y + 2]], '#5e8491'); oval(x + 1.5, y - .3, .4, .4, ink, 0);
    } else if (kind === 4) {
      oval(x, y, 2.7, 3.2, '#a7844e'); for (const dx of [-1, 1]) oval(x + dx, y + dx, .4, .4, ink, 0);
    } else if (kind === 5) {
      c.font = 'bold 4px Arial'; c.fillStyle = '#65574e'; c.textAlign = 'center'; c.fillText('404', x, y + 1.5);
    }
  };
  c.lineJoin = 'round'; c.lineCap = 'round';
  for (const leg of [-1, 1]) {
    const swing = step * leg, x = 32 + leg * (side ? 3 : fat ? 13 : 9) + (side ? swing * 5 : swing);
    const y = 76 - Math.max(0, swing) * 2.3, width = side ? 9 : fat ? 17 : 13;
    const knee = seated ? 67 : a.bottom === 1 ? 70 : 65;
    box(x - width / 2 + (seated && side ? 6 : 0), knee, width, y - knee, a.bottom === 1 || a.bottom === 2 ? skin : bottom, 1);
    if (seated && side) box(x - width / 2, 64, width + 7, 6, a.bottom === 2 ? skin : bottom, 1);
    const footX = x + (side ? 2 : 0) + (seated && side ? 7 : 0);
    if (a.shoes === 1) box(footX - width / 2, y - 5, width, 5, shoe, 1);
    oval(footX, y, side ? 8.5 : fat ? 10 : 8.5, a.shoes === 2 ? 2.6 : 3, shoe);
    if (a.shoes === 0) { line(footX - 5, y + 1.6, footX + 5, y + 1.6, '#f2e9d1', 1.1); if (!back) line(footX - 1, y - 1, footX + 2, y - 1, '#f2e9d1', .8); }
    if (a.shoes === 2) oval(footX + (side ? 4 : 0), y - 1, 3, 1.6, shade(shoe, 28));
  }
  c.save(); c.translate(0, bounce + (seated ? 2 : 0));
  c.translate(32, 64); c.rotate(step * (side ? 2.8 : 1.2) * Math.PI / 180); c.translate(-32, -64);
  // Long hair sits behind the clothing, independently of the selected top.
  if (a.hair === 2 || a.hair === 1) box(side ? 13 : 10, headY - 10, side ? 25 : 44, a.hair === 2 ? 42 : 29, hair, 10);
  if (a.hair === 6) oval(side ? 12 : back ? 44 : 54, headY + 8, 7, 13, hair);
  const sleeve = a.top !== 0, sleeveColor = a.top === 5 ? '#efe0bd' : top;
  const arm = (far: boolean) => {
    const shoulder = side ? (far ? 39 : 26) : 32 + (far ? -1 : 1) * (half - 5);
    c.save(); c.translate(shoulder, shoulderY + 2); c.rotate((far ? -1 : 1) * step * (side ? 20 : 9) * Math.PI / 180);
    const end = 67 - shoulderY;
    if (!far && sip >= 0) {
      const raise = [0, 6, 17, 18, 8, 0][sip];
      line(0, 0, side ? 9 : 1, 13, sleeveColor, 8); line(side ? 9 : 1, 13, 46 - shoulder, 61 - raise - shoulderY, sleeve ? sleeveColor : skin, 6);
      c.save(); c.translate(49 - shoulder, 61 - raise - shoulderY); c.rotate(-raise * .015);
      box(-5, -10, 10, 14, '#fff1ca', 1); box(-4, -5, 8, 8, '#e7a632'); oval(0, -10, 5, 1.5, '#fff8de'); oval(-4.5, 0, 3, 3.5, skin); c.restore();
    } else {
      box(-4, 0, 8, sleeve ? end - 4 : 7, far && side ? shade(sleeveColor, -28) : sleeveColor, 2);
      if (!sleeve) box(-3.4, 6, 6.8, end - 9, skin, 2);
      oval(.2, end - 1, 3.5, 4, skin);
      if (!far && (a.tattoo === 3 || a.tattoo === 4)) tattoo(.2, sleeve ? end - 1 : end - 8, a.tattoo);
    }
    c.restore();
  };
  if (side) arm(true);
  const traceTorso = () => {
    c.beginPath();
    c.moveTo(32 - half + 9, shoulderY - 2); c.quadraticCurveTo(32 - half, shoulderY, 32 - half, bodyBottom - 2);
    c.quadraticCurveTo(32, bodyBottom + (fat ? 8 : 4), 32 + half, bodyBottom - 2); c.quadraticCurveTo(32 + half, shoulderY, 32 + half - 9, shoulderY - 2);
    c.closePath();
  };
  traceTorso(); fill(top);
  if (a.bottom === 2) path([[32 - half + 4, 65], [32 + half - 4, 65], [32 + half, 72], [32 - half, 72]], bottom);
  else if (a.top !== 4) box(side ? 22 : 32 - half + 4, 65, side ? 24 : half * 2 - 8, a.bottom === 1 ? 6 : 5, bottom, 1);
  c.save(); traceTorso(); c.clip();
  if (a.top === 5 && !back) {
    const center = side ? 40 : 32;
    path([[center - 7, shoulderY + 7], [center + 7, shoulderY + 7], [center + 5, 65], [center - 5, 65]], '#efe0bd');
    for (const sign of [-1, 1]) line(center + sign * 7, shoulderY + 7, center + sign * 5, 65, shade(top, -25), 1.1);
  }
  if (a.top === 3) {
    c.save(); c.beginPath();
    c.rect(32 - half + 1, shoulderY + 4, half * 2 - 2, bodyBottom - shoulderY - 5);
    c.clip();
    for (let y = shoulderY + 6; y < bodyBottom; y += 7) line(32 - half, y, 32 + half, y, shade(top, 50), 3); c.restore();
  }
  if (a.top === 2 || a.top === 4 || a.top === 5) {
    const seam = side ? 43 : 32;
    if (!back) {
      line(seam, shoulderY + 2, seam, bodyBottom, shade(top, -38));
      for (let y = shoulderY + 8; y < bodyBottom; y += 6) oval(seam + 2, y, .8, .8, ink, 0);
      if (a.top === 5) { path([[side ? 30 : 23, shoulderY], [seam, shoulderY + 8], [side ? 45 : 41, shoulderY]], '#efe0bd'); }
      else { path([[side ? 31 : 23, shoulderY - 1], [seam, shoulderY + 7], [seam + 5, shoulderY]], shade(top, 30)); }
      line(side ? 29 : 40, 58, side ? 37 : 47, 58, shade(top, -40));
    } else line(32, shoulderY + 5, 32, bodyBottom, shade(top, -30));
  }
  if (a.top === 1) {
    if (back) oval(32, shoulderY + 3, 10, 6, shade(top, -22));
    else { for (const x of side ? [40] : [26, 38]) line(x, shoulderY + 2, x, shoulderY + 10, '#f2dfba', 1.2); box(side ? 31 : 22, 57, 19, 7, shade(top, -22), 2); }
  }
  if (!back && a.necklace) {
    const center = side ? 42 : 32;
    if (a.necklace === 2) path([[center - 2, shoulderY], [center + 2, shoulderY], [center + 3, shoulderY + 13], [center, shoulderY + 17], [center - 3, shoulderY + 13]], accent);
    else {
      c.beginPath(); c.moveTo(center - 7, shoulderY); c.quadraticCurveTo(center, shoulderY + 17, center + 7, shoulderY); c.strokeStyle = gold; c.lineWidth = 1.5; c.stroke();
      if (a.necklace === 3) { oval(center, shoulderY + 12, 4.5, 4.5, gold); c.fillStyle = ink; c.font = 'bold 5px Arial'; c.textAlign = 'center'; c.fillText('1', center, shoulderY + 14); }
    }
  }
  c.restore();
  if (a.scarf) { box(side ? 25 : 16, shoulderY - 3, side ? 21 : 32, 6, accent, 1); box(back ? 20 : 40, shoulderY + 1, 6, 15, accent, 1); line(back ? 20 : 40, shoulderY + 12, back ? 26 : 46, shoulderY + 12, shade(accent, -25)); }
  if (!side) arm(true);
  if (back) arm(false);

  c.save(); c.translate(32, headY); c.rotate((walking ? -step * 1.2 : frame === 9 ? 1 : 0) * Math.PI / 180); c.translate(-32, -27);
  if (side && tall) { c.translate(32, 27); c.scale(.84, .9); c.translate(-32, -27); }
  const radius = headR;
  if (a.hair === 5) for (const x of side ? [17] : [13, 51]) oval(x, 13, 7, 8, hair);
  if (side) {
    c.beginPath(); c.moveTo(20, 11); c.quadraticCurveTo(38, 1, 47, 15); c.quadraticCurveTo(52, 21, 50, 29);
    c.lineTo(56, 34); c.quadraticCurveTo(58, 36, 51, 36);
    c.quadraticCurveTo(53, 45, 39, 49);
    c.quadraticCurveTo(15, 51, 13, 29); c.quadraticCurveTo(12, 19, 20, 11); c.closePath(); fill(skin);
  } else {
    for (const x of [32 - radius, 32 + radius]) oval(x, 33, 3.5, 4.4, skin);
    oval(32, 27, radius, tall ? 20 : 22.5, skin);
  }
  if (blush && !back) {
    c.save(); c.clip(); c.globalAlpha = .4;
    for (const x of side ? [38] : tall ? [17, 47] : [15, 49]) oval(x, 36, 4, 2.5, makeupColor, 0);
    c.restore();
  }
  const hairPiece = () => {
    if (a.hair === 7) return;
    if (a.hair === 4) {
      if (back) { oval(32, 25, radius - 1, tall ? 19 : 21.5, skin); }
      path([[26, back ? 42 : 17], [25, 9], [28, 3], [32, 8], [36, 2], [39, 10], [42, 5], [39, back ? 41 : 17]], hair); return;
    }
    if (a.hair === 3) {
      if (back) oval(32, 23, radius + 1, 21, hair);
      for (let n = 0; n < (side ? 5 : 8); n++) { const x = side ? 15 + n * 6 : 11 + n * 6; oval(x, 14 - Math.sin(n / (side ? 4 : 7) * Math.PI) * 6, 5, 6, hair); }
      if (back) for (const x of [16, 26, 36, 46]) oval(x, 39, 5, 5, hair);
      return;
    }
    const left = side ? 13 : 32 - radius, right = side ? 48 : 32 + radius;
    c.beginPath(); c.moveTo(left, 28); c.bezierCurveTo(left - 5, 2, right - 6, -2, right, 20);
    c.lineTo(right, back ? 39 : 26); c.lineTo(right - 6, back ? 42 : 18); c.lineTo(32, back ? 40 : 13); c.lineTo(left + 8, back ? 42 : 21); c.closePath(); fill(hair);
    if (a.hair === 1 || a.hair === 2) {
      if (side) box(13, 24, 9, a.hair === 2 ? 27 : 17, hair, 3);
      else if (back) box(left, 21, right - left, a.hair === 2 ? 33 : 21, hair, 6);
      else for (const x of [left, right - 5]) box(x, 22, 5, a.hair === 2 ? 30 : 19, hair, 2);
    }
    line(left + 8, 12, 32, 8, shade(hair, 35), 1.7);
    if (a.hair === 6 && side) oval(13, 30, 6, 10, hair);
  };
  hairPiece();
  if (!back) {
    const eyes = side ? [43] : tall ? [25, 39] : [24, 40];
    const eyeR = tall ? 6.6 : a.eyes === 2 ? 8.8 : 8;
    for (const x of eyes) {
      if (frame === 8) line(x - eyeR + 1, 28, x + eyeR - 1, 28.2);
      else {
        oval(x, 27, side ? eyeR - 1 : eyeR, a.eyes === 2 ? 10 : tall ? 8.3 : 9, '#fffdf5', .3);
        oval(x + (side ? 1 : frame === 7 ? -1.5 : frame === 9 ? 1.5 : 0), 28, 1.35, 1.65, ink, 0);
        if (a.eyes === 1 || frame === 24) {
          c.save(); c.beginPath(); c.ellipse(x, 27, side ? eyeR - 1 : eyeR, tall ? 8.3 : 9, 0, 0, Math.PI * 2); c.clip(); c.fillStyle = skin; c.fillRect(x - 10, 16, 20, 12); line(x - 9, 28, x + 9, 28, ink, .6); c.restore();
        }
      }
      if (lashes) {
        const outer = side || x > 32 ? 1 : -1, lidY = frame === 8 ? 28 : a.eyes === 1 || frame === 24 ? 27.5 : 22;
        const outerX = x + outer * (eyeR - 1);
        c.beginPath(); c.moveTo(x - eyeR + 1, lidY); c.quadraticCurveTo(x, lidY - (frame === 8 ? 0 : 4), x + eyeR - 1, lidY);
        c.strokeStyle = ink; c.lineWidth = 1.15; c.stroke();
        for (const offset of [0, 2, 4]) line(outerX - outer * offset, lidY - 1 - offset * .2, outerX - outer * offset + outer * (offset ? 1.2 : 2.3), lidY - 3 - offset * .3, ink, 1);
      }
      const brow = a.eyebrows;
      if (brow === 2) { line(x - 5, 16, x, 13, hair, 1.5); line(x, 13, x + 5, 16, hair, 1.5); }
      else line(x - 5, brow === 1 ? 15 : 16, x + 5, 16, hair, brow === 1 ? 3.2 : 1.2);
    }
    if (a.eyebrows === 3 && !side) line(19, 16, 45, 16, hair, 2.6);
    if (a.glasses) {
      for (const x of eyes) {
        if (a.glasses === 4) star(x, 27, eyeR + 2, gold);
        else if (a.glasses === 1) { c.beginPath(); c.ellipse(x, 28, eyeR + 1, 10, 0, 0, Math.PI * 2); c.strokeStyle = shade(accent, -60); c.lineWidth = 1.5; c.stroke(); }
        else box(x - eyeR, 20, eyeR * 2, 14, a.glasses === 3 ? '#353b45' : '#e5eee638', 2);
        if (a.glasses === 4) { oval(x, 27, 3, 3.8, '#fffdf5'); oval(x, 28, 1.2, 1.5, ink, 0); }
        if (a.glasses === 3) line(x - 4, 23, x, 23, '#9aadaf', 1);
      }
      if (!side) line(31, 26, 33, 26, shade(accent, -50), 1.5);
      line(side ? 26 : 10, 24, side ? 36 : 16, 26, shade(accent, -50), 1.5);
    }
    const mouthX = side ? 49 : 32;
    if (lipstick && sip < 2 && frame !== 23 && a.mouth !== 3) oval(mouthX, a.mouth === 2 ? 42.2 : 43.6, side ? 2 : 3.2, 1.3, makeupColor, 0);
    if (a.facialHair === 2) { c.beginPath(); c.moveTo(mouthX - (side ? 9 : 14), 37); c.quadraticCurveTo(mouthX, 55, mouthX + (side ? 3 : 14), 37); c.lineTo(mouthX + 5, 39); c.lineTo(mouthX - 5, 39); c.closePath(); fill(hair); }
    if (a.facialHair === 1 || a.facialHair === 2) for (const dx of side ? [-3] : [-3, 3]) oval(mouthX + dx, 38, 4, 2, hair);
    if (a.facialHair === 3) path([[mouthX - 4, 44], [mouthX + 4, 44], [mouthX + 2, 49], [mouthX - 2, 49]], hair);
    if (sip === 2 || sip === 3) oval(mouthX, 43, 2.6, 2, '#633e31');
    else if (frame === 23 || a.mouth === 3) { oval(mouthX, 43, side ? 2.5 : 4, 3, '#51372e'); if (a.mouth === 3) box(mouthX - 1, 40.3, 2, 3, '#fffdf5'); }
    else if (a.mouth === 1 || a.mouth === 2 || frame === 9) {
      c.beginPath(); c.moveTo(mouthX - 3, 42); c.quadraticCurveTo(mouthX, a.mouth === 2 ? 39 : 46, mouthX + 3, 42); c.strokeStyle = ink; c.lineWidth = .9; c.stroke();
    } else line(mouthX - 3, 43, mouthX + 3, 43.2);
    if ([1, 2, 5].includes(a.tattoo)) tattoo(side ? 40 : 46, 38, a.tattoo);
  }
  if (a.earrings) {
    const locations = side ? [25] : [32 - radius - 1, 32 + radius + 1];
    for (const x of locations) {
      if (a.earrings === 1) oval(x, 36, 1.6, 1.6, gold);
      if (a.earrings === 2) { c.beginPath(); c.ellipse(x, 38, 2.2, 3.2, 0, 0, Math.PI * 2); c.strokeStyle = gold; c.lineWidth = 1.5; c.stroke(); }
      if (a.earrings === 3) { line(x, 35, x, 39, '#528655'); oval(x - 1, 40, 1.6, 1.8, '#c64d4c'); oval(x + 1.5, 39.5, 1.6, 1.8, '#c64d4c'); }
      if (a.earrings === 4) { line(x, 35, x, 38, gold); oval(x, 40, 1.5, 2.6, '#83b4bd'); path([[x, 42], [x - 2, 44], [x + 2, 44]], '#83b4bd'); }
    }
  }
  if (a.hat) {
    c.save(); c.translate(0, tall && !side ? 3 : 1.5);
    const left = tall ? 13 : 8, right = tall ? 51 : 56;
    if (a.hat === 6) {
      c.beginPath(); c.moveTo(left, 17); c.quadraticCurveTo(left, 3, 32, 4); c.quadraticCurveTo(right, 3, right, 17); c.closePath(); fill('#a6b4b4');
      line(left - 2, 17, right + 2, 17, '#6d797c', 2.6);
      for (const x of [22, 30, 38, 45]) oval(x, 12, .9, .9, '#586568', 0);
    } else {
      c.beginPath(); c.moveTo(left, back ? 31 : 18); c.bezierCurveTo(left - 3, 2, right + 3, 2, right, back ? 31 : 18); c.closePath(); fill(accent);
      box(left, back ? 29 : 16, right - left, 6, shade(accent, 32), 2);
      if (a.hat === 1) oval(32, 5, 4.5, 4.5, shade(accent, 38));
      if (a.hat === 3) box(side ? 40 : 21, back ? 32 : 20, side ? 20 : 28, 3, shade(accent, -24), 1);
      if (a.hat === 4) { for (const x of side ? [17] : [left, right - 6]) box(x, 18, 6, 18, shade(accent, 25), 2); }
      if (a.hat === 5) for (const x of [left + 5, right - 5]) path([[x - 5, 11], [x - 4, 2], [x + 5, 10]], accent);
    }
    c.restore();
  }
  c.restore();
  if (!back) arm(false);
  c.restore(); c.restore();
}
