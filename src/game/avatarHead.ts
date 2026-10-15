import { CLOTHING_COLORS, HAIR_COLORS, MAKEUP_COLORS, SKIN_COLORS, type Appearance } from '../shared/appearance';

export type AvatarGamePose = { action: 'game' | 'win' | 'lose'; phase: number; pulse: number; sway: number } | null;

const ink = '#39332c';
const gold = '#d9ad48';

function shade(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount)).toString(16).padStart(2, '0')).join('');
}

function tools(c: CanvasRenderingContext2D) {
  const fill = (color: string, edge = .7) => {
    c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = .7) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); fill(color, edge);
  };
  const line = (x: number, y: number, xx: number, yy: number, color = ink, width = .7) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  const curve = (x: number, y: number, cx: number, cy: number, xx: number, yy: number, color = ink, width = .7) => {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(cx, cy, xx, yy); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  const box = (x: number, y: number, w: number, h: number, color: string, r = 2, edge = .7) => {
    c.beginPath(); c.roundRect(x, y, w, h, r); fill(color, edge);
  };
  return { fill, oval, line, curve, box };
}

function dimensions(side: boolean) {
  return { rx: 21.5, ry: 22.5, left: 10.5, right: side ? 51.5 : 53.5, top: 4.5 };
}

/** One affine head transform keeps the skull, face and every attached piece together. */
function canonicalHead(c: CanvasRenderingContext2D, a: Appearance) {
  const scaleX = a.body === 2 ? 17.6 / 21.5 : a.body === 1 ? 23 / 21.5 : 1;
  const scaleY = a.body === 2 ? .97 : 1;
  c.translate(32, 27); c.scale(scaleX, scaleY); c.translate(-32, -27);
  return a.body ? { ...a, body: 0 } : a;
}

function hatGeometry(side: boolean, back: boolean) {
  return {
    left: side ? 10 : 10.1, right: side ? 51.6 : 53.9, center: side ? 30.8 : 32,
    rearY: side ? 23 : back ? 25 : 17.8,
    frontY: side ? 14.3 : back ? 25 : 17.8,
    middleY: side ? 13.5 : back ? 19 : 10.8,
  };
}

function rimDepth(a: Appearance) { return a.hat === 6 ? 1.2 : a.hat === 3 ? 2.1 : a.hat === 4 ? 4.2 : 3.2; }

function starLens(c: CanvasRenderingContext2D, x: number, y: number) {
  c.beginPath();
  for (let n = 0; n < 10; n++) {
    const angle = n * Math.PI / 5 - Math.PI / 2, scale = n % 2 ? .51 : 1;
    const xx = x + Math.cos(angle) * 7.55 * scale, yy = y + Math.sin(angle) * 10.4 * scale;
    if (n) c.lineTo(xx, yy); else c.moveTo(xx, yy);
  }
  c.closePath();
}

function clipHairBelowHat(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean) {
  if (!a.hat) return;
  const g = hatGeometry(side, back), depth = rimDepth(a) - .3;
  c.beginPath(); c.moveTo(0, 64); c.lineTo(0, g.rearY + depth);
  c.lineTo(g.left, g.rearY + depth); c.quadraticCurveTo(g.center, g.middleY + depth, g.right, g.frontY + depth);
  c.lineTo(64, g.frontY + depth); c.lineTo(64, 64); c.closePath(); c.clip();
  if (a.hair === 3) {
    // A hat compresses curls at the temples instead of slicing wide curls into flat ledges.
    c.beginPath(); c.rect(g.left + .5, 0, g.right - g.left - 1, 64); c.clip();
  }
}

/** Hair behind the collar has its own silhouette, rather than a rectangle behind the face. */
export function drawAvatarHairBack(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean, step: number) {
  c.save(); a = canonicalHead(c, a);
  drawHairBack(c, a, side, back, step); c.restore();
}

function drawHairBack(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean, step: number) {
  const { left, right } = dimensions(side);
  const hair = HAIR_COLORS[a.hairColor], accent = CLOTHING_COLORS[a.accessoryColor];
  const { fill, oval, curve, line } = tools(c);
  const shine = shade(hair, 25), shadow = shade(hair, -15);
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  clipHairBelowHat(c, a, side, back);
  if (a.hair === 1 || a.hair === 2) {
    const long = a.hair === 2, end = long ? 57 : 47;
    const rear = side ? left - .2 : left - 1.2, front = side ? left + 20 : right + 1.2;
    c.beginPath(); c.moveTo(rear + 2, a.hat ? 20 : 17);
    c.bezierCurveTo(rear - 3, 30, rear + (long ? -1 : 0), end - 8, rear + 1, end - 1);
    c.quadraticCurveTo(rear + 4, end + 2, rear + 8, end - .5);
    if (long) {
      c.quadraticCurveTo(rear + 14, end + 3, rear + 20, end - 1);
      c.quadraticCurveTo(front - 5, end + 2, front, end - 2);
    } else c.quadraticCurveTo((rear + front) / 2, end + 2, front - 1, end - 1);
    c.bezierCurveTo(front + 3, end - 9, front + 2, 26, front - 2, a.hat ? 20 : 17);
    c.closePath(); fill(shadow);
    for (let x = rear + 5; x < front - 2; x += 6) curve(x, 25, x - 3, end - 7, x + (long ? 2 : 0), end - 2, shine, .8);
    if (back && long) curve(32, 29, 27, 47, 32, end - 1, shade(hair, -28), .8);
  }
  if (a.hair === 5) {
    const positions = side ? [left + 4] : [left + 4.5, right - 4.5];
    for (const x of positions) {
      const y = a.hat ? 31 : 12;
      oval(x, y, a.hat ? 6.4 : 7.3, a.hat ? 6.8 : 7.7, hair);
      c.beginPath(); c.ellipse(x, y, 4.5, 5, -.5, -.8, Math.PI * 1.5); c.strokeStyle = shine; c.lineWidth = 1.1; c.stroke();
      curve(x - 2, y + 3, x + 4, y + 3, x + 2, y - 2, shadow, .8);
      line(x - 4.5, y + 3.8, x - 2.5, y + 5, accent, 1.6);
    }
  }
  if (a.hair === 6) {
    const x = side ? left + 3 : back ? right - 8 : right - 3;
    const y = a.hat ? 30 : 27;
    const swing = step * (side ? 1.5 : .6);
    c.beginPath(); c.moveTo(x - 3, y - 2);
    if (side) {
      c.bezierCurveTo(x - 11, y, x - 10 + swing, 46, x - 3 + swing, 55);
      c.quadraticCurveTo(x + 6 + swing, 49, x + 4, 38);
      c.quadraticCurveTo(x + 7, y - 1, x + 2, y - 2);
    } else {
      c.bezierCurveTo(x + 9, y - 3, x + 11 + swing, 43, x + 3 + swing, 55);
      c.quadraticCurveTo(x + 4 + swing, 48, x - 1, 43);
      c.quadraticCurveTo(x - 7, 36, x - 3, y - 2);
    }
    c.closePath(); fill(hair);
    curve(x + 1, y + 2, x + (side ? -4 : 5) + swing, 43, x + (side ? -2 : 3) + swing, 50, shine, 1.1);
    curve(x - 2, y + 5, x + 1 + swing, 40, x + swing, 47, shadow, .8);
    oval(x, y, 4, 2.2, accent, .5);
  }
  c.restore();
}

function drawHair(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean) {
  if (a.hair === 7) return;
  const { left: l, right: r, rx, ry, top } = dimensions(side);
  const hair = HAIR_COLORS[a.hairColor], light = shade(hair, 30), dark = shade(hair, -17);
  const { fill, oval, line, curve } = tools(c);
  c.save();
  // Hair emerges along the actual curved rim rather than a horizontal cut through the hairstyle.
  clipHairBelowHat(c, a, side, back);
  if (a.hair === 4) {
    c.save(); c.globalAlpha = .2;
    for (const [x, y] of (side ? [[l + 5, 21], [l + 3, 26], [l + 5, 31], [l + 9, 18], [l + 10, 23]] : [[l + 6, 19], [l + 4, 25], [l + 7, 30], [r - 5, 20], [r - 4, 26], [r - 7, 31]])) line(x, y, x + .5, y - 1, hair, 1);
    c.restore();
    c.beginPath();
    if (side) {
      c.moveTo(l + 7, 27); c.quadraticCurveTo(l + 5, 13, l + 11, 9);
      c.quadraticCurveTo(l + 11, 1, l + 17, 5); c.quadraticCurveTo(l + 20, -3, l + 23, 3);
      c.quadraticCurveTo(l + 30, -1, l + 31, 7); c.quadraticCurveTo(r + 1, 8, r - 2, 17);
      c.quadraticCurveTo(r - 6, 13, r - 13, 14); c.quadraticCurveTo(l + 12, 17, l + 7, 27);
    } else {
      c.moveTo(26, back ? 44 : 18); c.quadraticCurveTo(25, 8, 27, 4);
      c.quadraticCurveTo(27, -1, 31, 5); c.quadraticCurveTo(35, -3, 37, 4);
      c.quadraticCurveTo(43, 1, 39, 11); c.quadraticCurveTo(39, 20, 38, back ? 43 : 18);
      c.quadraticCurveTo(32, back ? 47 : 15, 26, back ? 44 : 18);
    }
    c.closePath(); fill(hair);
    curve(side ? l + 12 : 29, 16, side ? l + 15 : 30, 7, side ? l + 23 : 32, 5, light, 1.2);
    if (back) curve(33, 13, 32, 30, 32, 41, light, 1);
    c.restore(); return;
  }
  if (a.hair === 3) {
    if (back) {
      c.beginPath(); c.ellipse(32, 27, rx + 1, ry, 0, 0, Math.PI * 2); fill(hair);
      for (const [x, y] of [[l + 4, 34], [l + 10, 42], [32, 44], [r - 10, 42], [r - 4, 34]]) oval(x, y, 5.1, 5.2, hair);
    }
    c.beginPath(); c.moveTo(l + 3, 29);
    c.bezierCurveTo(l - 4, 29, l - 5, 19, l + 1, 17);
    c.bezierCurveTo(l - 1, 9, l + 6, 4, l + 11, 7);
    c.bezierCurveTo(l + 15, 0, 29, 0, 32, 5);
    c.bezierCurveTo(38, -1, r - 9, 2, r - 8, 7);
    c.bezierCurveTo(r - 2, 3, r + 4, 10, r + 1, 16);
    c.bezierCurveTo(r + 7, 20, r + 2, 28, r - 2, 28);
    c.quadraticCurveTo(r - 8, 25, r - 6, 20);
    c.quadraticCurveTo(37, 20, 36, 16); c.quadraticCurveTo(30, 21, 27, 16);
    c.quadraticCurveTo(l + 11, 22, l + 8, 19); c.quadraticCurveTo(l + 9, 29, l + 3, 29); c.closePath(); fill(hair);
    for (const [x, y, radius] of [[l + 5, 17, 3.8], [l + 13, 11, 3.8], [31, 9, 4.2], [r - 11, 12, 4], [r - 2, 19, 3.7], ...(back ? [[22, 30, 4], [36, 33, 4], [28, 41, 3.4], [44, 28, 3.6]] : [])]) {
      c.beginPath(); c.arc(x, y, radius, -.7, Math.PI * 1.05); c.strokeStyle = light; c.lineWidth = .95; c.stroke();
      curve(x - 2, y, x + .7, y - 2, x + 1, y, dark, .7);
    }
    c.restore(); return;
  }
  if (back) {
    c.beginPath(); c.moveTo(l + 1, 31);
    c.bezierCurveTo(l - 3, top + 9, l + 5, top - 2, 32, top - 1.7);
    c.bezierCurveTo(r - 5, top - 2, r + 3, top + 9, r - 1, 31);
    c.quadraticCurveTo(r - 1, 39, r - 6, 44); c.quadraticCurveTo(32, 41, l + 6, 44); c.quadraticCurveTo(l + 1, 38, l + 1, 31); c.closePath(); fill(hair);
    for (const x of [l + 6, l + 13, r - 13, r - 6]) curve(32 + (x - 32) * .55, top + 7, x - 3, 25, x, a.hair === 0 ? 39 : 43, x < 32 ? light : dark, .85);
    if (a.hair === 6) { curve(17, 28, 29, 37, r - 6, 30, light, 1); curve(23, 15, 37, 22, r - 6, 29, light, .9); }
    c.restore(); return;
  }
  if (a.hair === 2) {
    c.beginPath(); c.moveTo(l + 1, 38); c.bezierCurveTo(l - 4, 20, l, top - 1, 30, top - 1.2);
    c.bezierCurveTo(r - 1, top - 2, r + 4, 23, r - 1, 39);
    c.lineTo(r - 4, 46); c.quadraticCurveTo(r - 7, 34, r - 5, 23);
    c.quadraticCurveTo(38, 16, 32, top + 7); c.quadraticCurveTo(27, 15, l + 7, 23);
    c.quadraticCurveTo(l + 4, 35, l + 6, 47); c.quadraticCurveTo(l + 1, 47, l + 1, 38); c.closePath(); fill(hair);
    curve(29, top + 4, l + 4, 12, l + 4, 31, light, 1.2);
    curve(35, top + 5, r + 1, 18, r - 3, 39, light, .9);
    curve(l + 3, 35, l + 2, 44, l + 6, 51, dark, .7);
  } else if (a.hair === 1) {
    c.beginPath(); c.moveTo(l, 39); c.bezierCurveTo(l - 3, 17, l + 1, top - 3, 32, top - 1.5);
    c.bezierCurveTo(r + 3, top - 2, r + 2, 22, r - 1, 39); c.quadraticCurveTo(r - 2, 43, r - 6, 43);
    c.lineTo(r - 6, 23); c.quadraticCurveTo(r - 9, 18, r - 13, 19);
    c.quadraticCurveTo(32, 22, 28, 18); c.quadraticCurveTo(l + 12, 22, l + 7, 20);
    c.lineTo(l + 6, 43); c.quadraticCurveTo(l + 1, 43, l, 39); c.closePath(); fill(hair);
    curve(l + 5, 32, l + 2, 15, l + 14, top + 5, light, 1.2);
    curve(32, top + 4, r - 4, top + 6, r - 3, 31, light, 1);
    curve(l + 9, 13, 25, 13, 28, 18, dark, .7);
  } else {
    c.beginPath(); c.moveTo(l + 1, 29); c.bezierCurveTo(l - 4, 14, l + 4, top - 2, 29, top - 1.8);
    c.bezierCurveTo(r - 6, top - 4, r + 4, 12, r - 1, 28);
    c.quadraticCurveTo(r - 5, 23, r - 5, 19); c.quadraticCurveTo(41, 17, 34, 13);
    c.quadraticCurveTo(28, 13, l + 8, 24); c.quadraticCurveTo(l + 7, 30, l + 4, 32);
    c.lineTo(l + 4, 25); c.quadraticCurveTo(l + 2, 28, l + 1, 29); c.closePath(); fill(hair);
    curve(l + 7, 17, 24, top + 2, 34, top + 3, light, 1.3);
    curve(30, top + 5, 42, top + 2, r - 5, 16, dark, .8);
    if (a.hair === 5) curve(32, top + 1, 28, 9, 33, 14, dark, .85);
    if (a.hair === 6) { curve(l + 5, 22, l + 10, 7, 32, top + 3, light, .8); curve(l + 5, 28, l + 10, 16, l + 17, 14, light, .8); }
  }
  if (side && a.hair !== 2 && a.hair !== 1) {
    c.beginPath(); c.moveTo(l + 5, 22); c.quadraticCurveTo(l + 13, 21, l + 12, 30); c.lineTo(l + 9, 32); c.lineTo(l + 8, 25); c.closePath(); fill(hair, .4);
  }
  c.restore();
}

function drawEarrings(c: CanvasRenderingContext2D, a: Appearance, side: boolean, left: number, right: number) {
  if (!a.earrings) return;
  const { oval, line, curve, fill } = tools(c);
  const positions = side ? [left + 9] : [left - .7, right + .7];
  for (const x of positions) {
    const y = side ? 36.1 : 35.2;
    oval(x, y, 1, 1, gold, .4);
    if (a.earrings === 1) { oval(x, y, 1.45, 1.5, gold, .45); oval(x - .4, y - .4, .4, .4, '#fff5cf', 0); }
    if (a.earrings === 2) {
      c.beginPath(); c.ellipse(x + .4, y + 2.5, 2.2, 3.1, .12, -.9, Math.PI * 1.75);
      c.strokeStyle = shade(gold, -50); c.lineWidth = 1.8; c.stroke(); c.strokeStyle = gold; c.lineWidth = 1.1; c.stroke();
    }
    if (a.earrings === 3) {
      curve(x, y + 1, x + 2, y + 3, x - 1.2, y + 5, '#577852', .7);
      curve(x, y + 1, x + 2.5, y + 2, x + 2.5, y + 4.3, '#577852', .7);
      oval(x - 1.2, y + 5.5, 1.5, 1.9, '#bc5254', .4); oval(x + 2.1, y + 4.8, 1.5, 1.9, '#bc5254', .4);
      line(x + .3, y + 1.4, x + 2.4, y + .9, '#577852', 1);
    }
    if (a.earrings === 4) {
      line(x, y + 1, x, y + 3, gold, .7); oval(x, y + 5, 1.6, 2.4, '#81aeb1', .4);
      c.beginPath(); c.moveTo(x, y + 7); c.quadraticCurveTo(x - 3, y + 9, x - 2.4, y + 9.3); c.lineTo(x + 2.4, y + 9.3); c.quadraticCurveTo(x + 3, y + 9, x, y + 7); c.closePath(); fill('#81aeb1', .4);
      oval(x + .5, y + 4, .3, .3, ink, 0);
    }
  }
}

function drawHat(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean) {
  if (!a.hat) return;
  const g = hatGeometry(side, back), l = g.left, r = g.right, cx = g.center;
  const accent = CLOTHING_COLORS[a.accessoryColor], light = shade(accent, 28), dark = shade(accent, -24);
  const { fill, oval, line, curve, box } = tools(c);
  const depth = rimDepth(a);
  const rimAt = (t: number, offset = 0) => ({
    x: (1 - t) ** 2 * l + 2 * (1 - t) * t * cx + t * t * r,
    y: (1 - t) ** 2 * g.rearY + 2 * (1 - t) * t * g.middleY + t * t * g.frontY + offset,
  });
  c.save();
  const dome = (top = 1.7, slouch = false) => {
    const peak = cx - (slouch ? side ? 5 : 3 : 0);
    c.beginPath(); c.moveTo(l, g.rearY + .5);
    c.bezierCurveTo(l - .8, top + 7, l + 5, top, peak, top);
    c.bezierCurveTo(r - 7, top - .3, r + .5, top + 8, r, g.frontY + .5);
    c.quadraticCurveTo(cx, g.middleY + .5, l, g.rearY + .5); c.closePath();
  };
  const cuff = (color: string, height = depth) => {
    c.beginPath(); c.moveTo(l - .2, g.rearY); c.quadraticCurveTo(cx, g.middleY, r + .2, g.frontY);
    c.lineTo(r, g.frontY + height); c.quadraticCurveTo(cx, g.middleY + height, l, g.rearY + height); c.closePath(); fill(color);
  };
  if (a.hat === 1 || a.hat === 2) {
    const slouch = a.hat === 2;
    dome(slouch ? .8 : 1.7, slouch); fill(accent);
    c.save(); dome(slouch ? .8 : 1.7, slouch); c.clip();
    for (let t = .09; t < 1; t += .115) {
      const end = rimAt(t);
      curve(cx + (end.x - cx) * .35 - (slouch ? 2 : 0), 3, end.x, 8, end.x, end.y, end.x < cx ? light : dark, .8);
    }
    c.restore(); cuff(light);
    for (let t = .05; t < 1; t += .075) {
      const start = rimAt(t, .6), end = rimAt(t, depth - .5);
      line(start.x, start.y, end.x, end.y, dark, .55);
    }
    if (a.hat === 1) {
      oval(cx, -.6, 4.5, 4.3, light, .7);
      curve(cx - 2.7, -2, cx - 1, -1.5, cx - 1, 1.4, accent, .7);
      curve(cx + 1.6, -3, cx + 2.4, -.4, cx + .6, 1.2, accent, .7);
    } else { const end = rimAt(.8, -1); curve(cx + 3, 3.3, r - 6, 5, end.x, end.y, dark, .7); }
  } else if (a.hat === 3) {
    dome(3); fill(accent);
    const panel = rimAt(side ? .73 : .5, -.5);
    curve(cx, 3.5, side ? 39 : cx, 7, panel.x, panel.y, dark, .85);
    const rearPanel = rimAt(.15, -.6); curve(cx - 1, 3.8, l + 7, 7, rearPanel.x, rearPanel.y, light, .8);
    oval(cx, 3.3, 1.5, 1, dark, .4); cuff(dark);
    if (back) {
      const middle = rimAt(.5);
      c.beginPath(); c.moveTo(cx - 5.5, middle.y + 1.5); c.bezierCurveTo(cx - 5.5, middle.y - 6, cx + 5.5, middle.y - 6, cx + 5.5, middle.y + 1.5); c.closePath(); fill(a.hair === 7 ? SKIN_COLORS[a.skinTone] : HAIR_COLORS[a.hairColor]);
      box(cx - 5.5, middle.y + .8, 11, 2, light, .7, .5); line(cx + 1, middle.y + 1, cx + 1, middle.y + 2.5, dark, .6);
    } else if (side) {
      const root = rimAt(.69, depth - .4);
      c.beginPath(); c.moveTo(root.x, root.y); c.quadraticCurveTo(55, 15.7, 59.5, 19.5);
      c.quadraticCurveTo(53, 22, root.x - 1.5, root.y + 2.4); c.closePath(); fill(dark);
      curve(root.x + 1, root.y + 1, 53, 18.1, 57, 19.2, light, .7);
    } else {
      const aa = rimAt(.2, depth), bb = rimAt(.8, depth), mid = rimAt(.5, depth);
      c.beginPath(); c.moveTo(aa.x, aa.y); c.quadraticCurveTo(cx, mid.y - 1, bb.x, bb.y);
      c.quadraticCurveTo(bb.x + 2, mid.y + 5.3, cx, mid.y + 5.5); c.quadraticCurveTo(aa.x - 2, mid.y + 5.3, aa.x, aa.y); c.closePath(); fill(dark);
      curve(aa.x + 2, aa.y + 1.2, cx, mid.y + 5, bb.x - 2, bb.y + 1.2, light, .7);
    }
  } else if (a.hat === 4) {
    const fur = '#d6c8a9', furShade = '#b6a78a';
    dome(2.3); fill(accent);
    const seam = rimAt(side ? .3 : .5, -1); curve(cx, 3.4, side ? 23 : cx, 9, seam.x, seam.y, dark, .8);
    const flaps = side ? [15.5] : [l - .5, r - 7.5];
    for (const x of flaps) {
      const startY = side ? 23 : back ? 26 : 19;
      c.beginPath(); c.moveTo(x, startY); c.lineTo(x + 7.5, startY - 1); c.lineTo(x + 7.6, 34.5);
      c.quadraticCurveTo(x + 6, 39.7, x + 2.5, 38); c.quadraticCurveTo(x - 1, 36, x, 31); c.closePath(); fill(fur);
      curve(x + 2, startY + 3, x + .5, 31, x + 3, 35, furShade, .9);
      line(x + 3, 38, x + 3.6, 41, dark, .8);
    }
    cuff(fur);
    for (let t = .07; t < 1; t += .1) {
      const p = rimAt(t, 1.3); line(p.x, p.y, p.x + 1.5, p.y + 1, furShade, .6);
    }
    if (!back) { const badge = rimAt(side ? .75 : .5, 1.4); box(badge.x - 2.3, badge.y - .7, 4.6, 2.1, dark, .5, .4); }
  } else if (a.hat === 5) {
    dome(3.2); fill(accent);
    for (const [x, y, size] of side ? [[28, .7, 1], [41, 3.4, .75]] : [[l + 8, .8, 1], [r - 8, .8, 1]]) {
      c.beginPath(); c.moveTo(x - 5 * size, y + 9 * size); c.quadraticCurveTo(x - 2 * size, y - 4 * size, x + .6 * size, y);
      c.lineTo(x + 7 * size, y + 8.5 * size); c.closePath(); fill(accent);
      c.beginPath(); c.moveTo(x - 2.3 * size, y + 6.7 * size); c.lineTo(x - .3 * size, y + 1.7 * size); c.lineTo(x + 3.9 * size, y + 6.8 * size); c.closePath(); fill(shade(accent, 47), .4);
    }
    cuff(light);
    for (let t = .07; t < 1; t += .1) { const p = rimAt(t, .6); line(p.x, p.y, p.x + .5, p.y + 2, dark, .5); }
  } else {
    const metal = '#a6b4b1', shadow = '#687e80';
    for (const [x, y] of [[l - 1.2, g.rearY], [r + 1.2, g.frontY]]) {
      c.beginPath(); c.ellipse(x, y, 3.1, 1.9, side ? -.15 : 0, 0, Math.PI * 2); c.strokeStyle = ink; c.lineWidth = 2.2; c.stroke(); c.strokeStyle = metal; c.lineWidth = 1.2; c.stroke();
    }
    dome(3.3); fill(metal);
    c.save(); dome(3.3); c.clip();
    curve(l + 5, g.rearY - 2, l + 8, 7, cx - 1, 4.7, '#e0e6d5', 1.5);
    for (let row = 0; row < 4; row++) for (let x = l + 5 + (row % 2) * 3; x < r - 3; x += 6) oval(x, 8 + row * 4, .9, .7, shadow, 0);
    c.restore();
    cuff(shadow, 1.2);
    c.beginPath(); c.moveTo(l, g.rearY + .1); c.quadraticCurveTo(cx, g.middleY + .1, r, g.frontY + .1); c.strokeStyle = '#d6e0d2'; c.lineWidth = .7; c.stroke();
  }
  c.restore();
}

function cheekTattoo(c: CanvasRenderingContext2D, a: Appearance, x: number, y: number) {
  const { fill, oval, curve, line } = tools(c);
  if (a.tattoo === 1) {
    c.beginPath(); c.moveTo(x - 3.2, y + 1); c.quadraticCurveTo(x - 2.7, y - 3, x + .3, y - 2.6); c.quadraticCurveTo(x + 3, y - 2.2, x + 3.2, y + 1); c.quadraticCurveTo(x, y + 3, x - 3.2, y + 1); c.closePath(); fill(shade(SKIN_COLORS[a.skinTone], 18), .5);
    curve(x - 2.8, y + .6, x, y - .3, x + 2.8, y + .6, '#7e6556', .55);
    for (const dx of [-1.6, 0, 1.6]) line(x + dx, y - 1.7, x + dx + .4, y - .9, '#7e6556', .4);
  } else if (a.tattoo === 2) {
    oval(x, y - 1, 1.6, 1.5, '#83a59a', .4); oval(x, y + .5, 3.4, 1.2, '#667981', .45);
    line(x - 1.7, y + 2, x - 2.2, y + 3, '#667981', .5); line(x + 1.7, y + 2, x + 2.2, y + 3, '#667981', .5);
    oval(x - .5, y - 1.4, .4, .4, '#e4e4c6', 0);
  } else if (a.tattoo === 5) {
    c.font = 'bold 3.8px Arial'; c.fillStyle = '#6f5c53'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('404', x, y + .3);
  }
}

/** Face details share anatomical anchors, so jewelry and eyewear follow every head shape. */
export function drawAvatarHead(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean, frame: number, sip: number, game: AvatarGamePose) {
  c.save(); a = canonicalHead(c, a);
  drawHead(c, a, side, back, frame, sip, game); c.restore();
}

function drawHead(c: CanvasRenderingContext2D, a: Appearance, side: boolean, back: boolean, frame: number, sip: number, game: AvatarGamePose) {
  const { rx, left, right, top } = dimensions(side);
  const skin = SKIN_COLORS[a.skinTone], hair = HAIR_COLORS[a.hairColor], accent = CLOTHING_COLORS[a.accessoryColor];
  const makeup = MAKEUP_COLORS[a.makeupColor];
  const lashes = a.makeup === 1 || a.makeup === 4 || a.makeup === 5;
  const lipstick = a.makeup === 2 || a.makeup === 4 || a.makeup === 5;
  const { fill, oval, line, curve, box } = tools(c);
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  const facePath = () => {
    c.beginPath();
    if (side) {
      c.moveTo(left + 7, top + 4);
      c.bezierCurveTo(left - 4, top + 11, left - 1, 36, left + 9, 44);
      c.bezierCurveTo(right - 11, 53, right + .5, 45, right - 1, 37);
      c.quadraticCurveTo(right + 8.5, 37.2, right + 4.5, 33.5); c.lineTo(right - .7, 29.5);
      c.bezierCurveTo(right + 2, 15, right - 7, top - 3, left + 7, top + 4);
    } else {
      c.moveTo(32, top); c.bezierCurveTo(32 + rx * .67, top - .4, 32 + rx + .5, top + 9, 32 + rx, 28);
      c.bezierCurveTo(32 + rx - .5, 43, 43, 49.8, 32, 49.5); c.bezierCurveTo(21, 49.8, 32 - rx + .5, 43, 32 - rx, 28);
      c.bezierCurveTo(32 - rx - .5, top + 9, 32 - rx * .67, top - .4, 32, top);
    }
    c.closePath();
  };
  if (!side) for (const x of [left, right]) {
    oval(x, 32.5, 3.4, 4.4, skin); curve(x - .6, 30.7, x + 1.6, 31.4, x + .2, 34, shade(skin, -29), .65);
  }
  facePath(); fill(skin);
  c.save(); facePath(); c.clip(); c.globalAlpha = .14;
  c.beginPath(); c.moveTo(left - 1, 28); c.quadraticCurveTo(left + 10, 50, right + 1, 41); c.lineTo(right + 5, 54); c.lineTo(left - 3, 54); c.closePath(); fill(shade(skin, -45), 0);
  c.restore();
  if (side) {
    oval(left + 9, 32.7, 3.8, 4.4, skin); curve(left + 8.2, 30.5, left + 11.8, 30.4, left + 9.6, 34.7, shade(skin, -32), .7);
  }
  drawEarrings(c, a, side, left, right);
  drawHair(c, a, side, back);
  if (back) {
    if (a.glasses) for (const x of [left, right]) curve(x, 28.5, x + (x < 32 ? -1 : 1), 30, x, 33, shade(accent, -45), 1.4);
    drawHat(c, a, side, back); c.restore(); return;
  }
  const eyes = side ? [right - 8.5] : [24, 40];
  const eyeX = a.glasses ? a.glasses === 4 ? 5.8 : 6.35 : a.eyes === 2 ? 8.5 : 7.7;
  const eyeY = a.glasses === 2 || a.glasses === 3 ? 7.15 : a.eyes === 2 ? 10 : 9.2;
  const closed = frame === 8 || game?.action === 'win';
  if (a.makeup === 3 || a.makeup === 5) {
    c.save(); facePath(); c.clip(); c.globalAlpha = .32;
    for (const x of side ? [right - 12] : [32 - rx + 5.5, 32 + rx - 5.5]) oval(x, 38.3, 4.1, 2, makeup, 0);
    c.restore();
  }
  for (const x of eyes) {
    const width = side ? eyeX - .8 : eyeX;
    c.save();
    if (a.glasses === 4) { starLens(c, x, 27); c.clip(); }
    if (closed) curve(x - width + 1, 28, x, game ? 20 : 24.4, x + width - 1, 28, ink, 1.1);
    else {
      oval(x, 27, width, eyeY, '#fffdf3', .5);
      oval(x + (side ? 1.3 : frame === 7 ? -1.5 : frame === 9 ? 1.5 : 0), 28.1, 1.4, 1.8, ink, 0);
      oval(x + (side ? 1 : frame === 7 ? -1.8 : frame === 9 ? 1.2 : -.3), 27.4, .35, .4, '#fffdf3', 0);
      if (a.eyes === 1 || frame === 24) {
        c.save(); c.beginPath(); c.ellipse(x, 27, width, eyeY, 0, 0, Math.PI * 2); c.clip();
        c.fillStyle = skin; c.fillRect(x - 10, 15, 20, 12.6); curve(x - width, 27.4, x, 28.3, x + width, 27.4, ink, .7); c.restore();
      }
    }
    c.restore();
    if (lashes) {
      const sleepy = a.eyes === 1 || frame === 24;
      const lid = closed ? 27.1 : sleepy ? 27.4 : 21.5;
      const outer = side || x > 32 ? 1 : -1;
      curve(x - width + 1, lid, x, lid - (closed ? 3 : sleepy ? -.7 : 3), x + width - 1, lid, ink, 1.1);
      for (let n = 0; n < 3; n++) {
        const lashX = x + outer * (width - 1.5 - n * 1.8);
        line(lashX, lid - n * .45, lashX + outer * (2.1 - n * .4), lid - 2.2 - n * .4, ink, .8);
      }
    }
    if (a.eyebrows !== 3 || side) {
      const browY = a.eyes === 2 ? 14.5 : 15.5;
      if (game?.action === 'lose') line(x - 4.8, side || x > 32 ? 18 : 14, x + 4.8, side || x > 32 ? 14 : 18, hair, 1.8);
      else if (a.eyebrows === 2) { curve(x - 5, browY + 1.5, x, browY - 5, x + 5, browY + 1.5, hair, 1.6); }
      else curve(x - 4.7, browY + .2, x, browY - (a.eyebrows === 1 ? 1.5 : .8), x + 4.7, browY + .8, hair, a.eyebrows === 1 ? 2.7 : 1.2);
    }
  }
  if (a.eyebrows === 3 && !side) curve(19.8, 16, 32, 13.3, 44.2, 16, hair, 2.5);
  if (!side) { curve(31.1, 33.5, 29.8, 36.6, 33.3, 36, shade(skin, -43), .65); }
  else line(right + 1, 35.5, right + 2.5, 35.6, shade(skin, -44), .65);
  if ([1, 2, 5].includes(a.tattoo)) cheekTattoo(c, a, side ? right - 11 : right - 6.8, side ? 39.8 : 40.1);

  const mouthX = side ? right - 3.5 : 32;
  if (a.facialHair === 2) {
    const ll = side ? mouthX - 13 : mouthX - 14, rr = side ? mouthX + 3.5 : mouthX + 14;
    c.beginPath(); c.moveTo(ll, 36.6); c.quadraticCurveTo(ll + 1, 43, mouthX - 7, 47.5);
    c.quadraticCurveTo(mouthX, 52, rr - 2, 46); c.quadraticCurveTo(rr + 1, 42, rr, 37);
    c.lineTo(rr - 5, 39.1); c.quadraticCurveTo(mouthX, 43, ll + 5, 39.3); c.closePath(); fill(hair, .5);
    curve(ll + 4, 42, mouthX - 8, 47, mouthX - 3, 48, shade(hair, 28), .8);
    curve(mouthX + 5, 45, mouthX + 5, 48, mouthX + 1, 49, shade(hair, 20), .7);
  }
  if (a.facialHair === 1 || a.facialHair === 2) {
    c.beginPath(); c.moveTo(mouthX, 38.2);
    c.bezierCurveTo(mouthX - 4, 36, mouthX - 5, 41.7, mouthX - (side ? 8 : 9), 39.8);
    c.quadraticCurveTo(mouthX - 7, 44, mouthX, 40.3);
    c.quadraticCurveTo(mouthX + (side ? 4 : 7), 44, mouthX + (side ? 5 : 9), 39.8);
    c.bezierCurveTo(mouthX + 5, 41.7, mouthX + 4, 36, mouthX, 38.2); c.closePath(); fill(hair, .45);
    curve(mouthX - 4.7, 39.2, mouthX - 2.5, 38.3, mouthX - 1, 39.1, shade(hair, 26), .6);
  }
  if (a.facialHair === 3) {
    c.beginPath(); c.moveTo(mouthX - 3.7, 45); c.quadraticCurveTo(mouthX, 43.6, mouthX + 3.5, 45);
    c.quadraticCurveTo(mouthX + 2.6, 49.2, mouthX, 50); c.quadraticCurveTo(mouthX - 2.7, 49, mouthX - 3.7, 45); c.closePath(); fill(hair, .45);
    line(mouthX, 46.2, mouthX, 48, shade(hair, 29), .65);
  }
  if (lipstick && sip < 2 && frame !== 23 && a.mouth !== 3) {
    c.beginPath(); c.moveTo(mouthX - (side ? 2.7 : 3.8), 43.4); c.quadraticCurveTo(mouthX - 1, 41.1, mouthX, 42.4);
    c.quadraticCurveTo(mouthX + 1.4, 41.3, mouthX + (side ? 2.7 : 3.8), 43.4); c.quadraticCurveTo(mouthX, 46.2, mouthX - (side ? 2.7 : 3.8), 43.4); c.closePath(); fill(makeup, 0);
  }
  if (game?.action === 'win') {
    c.beginPath(); c.moveTo(mouthX - 4.2, 40.9); c.quadraticCurveTo(mouthX, 50.6, mouthX + 4.2, 40.9); c.closePath(); fill('#593c34', .6); curve(mouthX - 2.7, 42, mouthX, 43, mouthX + 2.7, 42, '#fff7db', 1.3);
  } else if (game?.action === 'lose') curve(mouthX - 3.4, 44.8, mouthX, 39.8, mouthX + 3.4, 44.8, ink, 1.1);
  else if (sip === 2 || sip === 3) oval(mouthX, 43.7, 2.4, 2, '#674638', .6);
  else if (frame === 23 || a.mouth === 3) {
    oval(mouthX, 43.3, side ? 2.7 : 3.7, 3.1, '#593c34', .65);
    if (a.mouth === 3) box(mouthX - 1.2, 40.8, 2.4, 2.8, '#fff8e6', .5, .4);
  } else if (a.mouth === 1 || a.mouth === 2 || frame === 9) curve(mouthX - 3.6, 42.8, mouthX, a.mouth === 2 ? 39.8 : 47.2, mouthX + 3.6, 42.8, ink, .9);
  else curve(mouthX - 3.3, 43.7, mouthX, 44.1, mouthX + 3.3, 43.7, ink, .85);

  if (a.glasses) {
    const frameColor = a.glasses === 4 ? gold : shade(accent, -55);
    const frameHalf = a.glasses === 4 ? 7.18 : side ? 6.8 : 7.2;
    const hingeY = a.glasses === 4 ? 23.8 : 25.2;
    if (side) curve(left + 9, 30.5, left + 10, 25.2, eyes[0] - frameHalf, hingeY, frameColor, 1.25);
    else for (const sign of [-1, 1]) {
      const ear = sign < 0 ? left : right, lens = sign < 0 ? eyes[0] - frameHalf : eyes[1] + frameHalf;
      curve(ear, 30.4, ear - sign * 1.2, 26, lens, hingeY, frameColor, 1.15);
    }
    for (const x of eyes) {
      if (a.glasses === 4) {
        starLens(c, x, 27); c.fillStyle = '#fff9d414'; c.fill(); c.strokeStyle = shade(gold, -60); c.lineWidth = 1.9; c.stroke(); c.strokeStyle = gold; c.lineWidth = 1.2; c.stroke();
      } else if (a.glasses === 1) {
        c.beginPath(); c.ellipse(x, 27, frameHalf, 9.8, 0, 0, Math.PI * 2);
        c.fillStyle = '#c8e2df18'; c.fill(); c.strokeStyle = frameColor; c.lineWidth = 1.4; c.stroke();
      } else {
        const width = frameHalf * 2;
        c.beginPath(); c.roundRect(x - frameHalf, 18.9, width, 16.2, a.glasses === 3 ? 3.1 : 2.3);
        c.fillStyle = a.glasses === 3 ? '#35434a' : '#d7ebe41a'; c.fill(); c.strokeStyle = frameColor; c.lineWidth = 1.5; c.stroke();
        if (a.glasses === 3) { line(x - 4.7, 22.3, x + .4, 22.3, '#91aaaa', 1); line(x - 5.5, 24.3, x - 3.3, 24.3, '#91aaaa', .7); }
      }
    }
    if (!side) curve(eyes[0] + frameHalf, a.glasses === 4 ? 23.8 : 25.8, 32, a.glasses === 4 ? 23 : 24.4, eyes[1] - frameHalf, a.glasses === 4 ? 23.8 : 25.8, frameColor, 1.25);
  }
  drawHat(c, a, side, back);
  c.restore();
}
