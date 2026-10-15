import type { DealerAction, DealerProfile } from '../shared/cardTables';
export type { DealerAction } from '../shared/cardTables';

export const DEALER_SIZE = { width: 88, height: 108 } as const;
export const DEALER_ACTIONS = ['idle', 'deal', 'win', 'lose'] as const;
export type DealerLayer = 'full' | 'body' | 'hands';

/** Original paper characters share the hall's dark outlines and warm lighting. */
export function drawDealer(c: CanvasRenderingContext2D, p: DealerProfile, action: DealerAction = 'idle', frame = 0, layer: DealerLayer = 'full') {
  c.save();
  c.beginPath(); c.rect(0, 0, DEALER_SIZE.width, DEALER_SIZE.height); c.clip();
  c.lineCap = 'round'; c.lineJoin = 'round';
  const ink = '#322936', cream = '#f7e9c8', shadow = '#302534';
  const phase = Math.max(0, Math.min(1, frame / 5)), gesture = Math.sin(phase * Math.PI);
  const breath = action === 'idle' ? Math.sin(frame * Math.PI / 3) * .6 : 0;
  const width = p.body * 1.3, center = 44;
  const shape = (color: string, path: () => void, edge = 1) => {
    c.beginPath(); path(); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = 1) => shape(color, () => c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), edge);
  const box = (x: number, y: number, w: number, h: number, color: string, radius = 0, edge = 1) => shape(color, () => c.roundRect(x, y, w, h, radius), edge);
  const line = (x: number, y: number, ex: number, ey: number, color = ink, weight = 1) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const arm = (x: number, y: number, ex: number, ey: number, hx: number, hy: number) => {
    const path = () => { c.moveTo(x, y); c.quadraticCurveTo(ex, ey, hx, hy); };
    c.beginPath(); path(); c.strokeStyle = ink; c.lineWidth = 11; c.stroke();
    c.beginPath(); path(); c.strokeStyle = cream; c.lineWidth = 8.7; c.stroke();
    oval(hx, hy, 5.2, 4.1, p.skin, .8);
    line(hx - 2, hy + .5, hx + 1.4, hy + 1, '#9a665b', .6);
  };
  c.translate(0, breath);
  if (layer !== 'hands') {
  // The lower silhouette remains behind the table, with two planted feet.
  for (const sign of [-1, 1]) {
    box(center + sign * 10 - 7, 80, 14, 23, shadow, 3);
    oval(center + sign * 11, 103, 10, 3.2, '#241f2b', .8);
  }
  if (p.hairStyle === 'bob' || p.hairStyle === 'braids') {
    shape(p.hair, () => { c.moveTo(24, 15); c.bezierCurveTo(22, 5, 66, 5, 65, 20); c.lineTo(70, 50); c.quadraticCurveTo(56, 57, 45, 47); c.quadraticCurveTo(31, 57, 18, 50); c.closePath(); });
  }
  // Crisp rolled sleeves, waistcoat and asymmetric lapels distinguish casino staff.
  shape(cream, () => { c.moveTo(34, 45); c.quadraticCurveTo(26 - width, 44, 20 - width, 61); c.lineTo(26 - width, 88); c.quadraticCurveTo(44, 96, 62 + width, 88); c.lineTo(68 + width, 61); c.quadraticCurveTo(62 + width, 44, 54, 45); c.closePath(); });
  shape(p.uniform, () => { c.moveTo(32, 48); c.lineTo(44, 59); c.lineTo(56, 48); c.quadraticCurveTo(62 + width, 57, 61 + width, 71); c.lineTo(64 + width, 88); c.lineTo(44, 92); c.lineTo(24 - width, 88); c.lineTo(27 - width, 69); c.quadraticCurveTo(25 - width, 56, 32, 48); c.closePath(); });
  line(44, 61, 44, 91, '#251f2c', 1.1);
  for (const y of [67, 76, 85]) oval(46.5, y, 1.3, 1.3, p.accent, .4);
  line(30, 70, 39, 70, p.accent, 1.8);
  shape(cream, () => { c.moveTo(34, 45); c.lineTo(43, 52); c.lineTo(36, 60); c.lineTo(31, 50); c.closePath(); }, .7);
  shape(cream, () => { c.moveTo(54, 45); c.lineTo(45, 52); c.lineTo(51, 60); c.lineTo(57, 50); c.closePath(); }, .7);
  shape(p.accent, () => { c.moveTo(36, 51); c.lineTo(42, 53); c.lineTo(36, 57); c.closePath(); }, .7);
  shape(p.accent, () => { c.moveTo(52, 51); c.lineTo(46, 53); c.lineTo(52, 57); c.closePath(); }, .7);
  oval(44, 54, 2.2, 2.2, p.accent, .6);
  box(52, 64, 11, 5, p.accent, 1, .7);
  line(54, 66, 61, 66, '#fff1c6', .8);
  }
  if (layer !== 'body') {
  const leftHand = action === 'win' ? { x: 16 - gesture * 4, y: 67 - gesture * 17 } : action === 'lose' ? { x: 36 + gesture * 2, y: 76 - gesture * 5 } : { x: 28, y: 75 - gesture * 1.5 };
  const rightHand = action === 'deal' ? { x: 59 - gesture * 14, y: 73 + gesture * 17 } : action === 'win' ? { x: 67 + gesture * 5, y: 71 - gesture * 17 } : action === 'lose' ? { x: 57 - gesture * 8, y: 76 - gesture * 6 } : { x: 60, y: 75 - gesture * 1.5 };
  arm(23 - width, 54, 17 - width, 70, leftHand.x, leftHand.y);
  arm(64 + width, 54, 73 + width, 68, rightHand.x, rightHand.y);
  if (action === 'deal') {
    c.save(); c.translate(rightHand.x, rightHand.y + 1); c.rotate(-.23 + gesture * .4);
    box(-4.5, -2, 9, 13, cream, 1.3, .7); box(-3, -.2, 6, 9, p.uniform, .7, .3);
    line(-2, 1.5, 2, 7, p.accent, .7); line(2, 1.5, -2, 7, p.accent, .7); c.restore();
  }
  if (action === 'lose') {
    for (let n = 0; n < 3; n++) box(34 + n * 2, 74 - n * 1.2, 11, 14, cream, 1, .5);
  }
  }
  if (layer !== 'hands') {
  // Faces are fully drawn, with individual hair, jewellery and glasses.
  oval(24, 27, 4, 6, p.skin, .7); oval(64, 27, 4, 6, p.skin, .7);
  oval(44, 28, 20 + p.body * .5, 21, p.skin, 1.1);
  shape('#ffffff19', () => { c.moveTo(47, 11); c.quadraticCurveTo(64, 12, 61, 30); c.quadraticCurveTo(59, 40, 47, 42); c.closePath(); }, 0);
  const blink = action === 'idle' && frame === 4;
  for (const x of [35, 53]) {
    line(x - 4.6, 24, x + 4, 23.6, p.hair, 1.4);
    if (blink) line(x - 3.2, 29.5, x + 3.2, 29.5, ink, 1.3);
    else {
      oval(x, 29, 3.5, 2.8, cream, .6); oval(x + .3, 29.4, 1.6, 2.1, ['#36516c', '#46563b', '#68452e'][p.index % 3], .2); oval(x + .3, 29.6, .75, 1.3, ink, 0); oval(x + .9, 28.7, .5, .5, '#fff8ea', 0);
    }
  }
  c.beginPath(); c.moveTo(44, 30); c.quadraticCurveTo(40.5, 35, 44.5, 35.5); c.strokeStyle = '#8b5c55'; c.lineWidth = .8; c.stroke();
  const smile = action === 'win' ? 3.5 + gesture : action === 'lose' ? .8 : 2.1;
  c.beginPath(); c.moveTo(38, 39); c.quadraticCurveTo(44, 39 + smile, 50, 38.8); c.strokeStyle = p.beard ? ink : '#854354'; c.lineWidth = 1.2; c.stroke();
  if (p.beard) {
    shape(p.hair, () => { c.moveTo(26, 32); c.quadraticCurveTo(31, 42, 40, 42); c.lineTo(49, 42); c.quadraticCurveTo(59, 40, 63, 32); c.quadraticCurveTo(62, 44, 52, 49); c.quadraticCurveTo(43, 54, 34, 47); c.quadraticCurveTo(26, 42, 26, 32); c.closePath(); }, .7);
    line(39, 42, 49, 42, p.skin, 1.2);
  }
  if (p.hairStyle === 'swept' || p.hairStyle === 'silver') {
    shape(p.hair, () => { c.moveTo(23, 25); c.quadraticCurveTo(17, 8, 36, 6); c.quadraticCurveTo(51, 0, 66, 13); c.lineTo(65, 25); c.lineTo(59, 18); c.quadraticCurveTo(49, 14, 42, 13); c.quadraticCurveTo(34, 21, 23, 25); c.closePath(); });
    for (const offset of [0, 6, 12]) { c.beginPath(); c.moveTo(25 + offset, 15); c.quadraticCurveTo(33 + offset, 7, 43 + offset, 10); c.strokeStyle = '#fff2db55'; c.lineWidth = 1; c.stroke(); }
  } else if (p.hairStyle === 'bob') {
    shape(p.hair, () => { c.moveTo(23, 27); c.quadraticCurveTo(16, 4, 42, 4); c.quadraticCurveTo(69, 4, 66, 28); c.lineTo(61, 23); c.lineTo(59, 14); c.quadraticCurveTo(47, 18, 39, 13); c.quadraticCurveTo(31, 23, 23, 27); c.closePath(); });
    line(25, 28, 23, 44, '#fff0d533', 1.4); line(64, 26, 66, 43, '#fff0d533', 1.4);
  } else if (p.hairStyle === 'curls') {
    for (let n = 0; n < 12; n++) { const a = Math.PI + n * Math.PI / 11; oval(44 + Math.cos(a) * 21, 23 + Math.sin(a) * 17, 6 + n % 3, 6, p.hair, .7); }
    oval(44, 10, 8, 6, p.hair, .7);
  } else if (p.hairStyle === 'bun') {
    oval(45, 7, 10, 6, p.hair, .8); line(38, 7, 51, 7, p.accent, 1.3);
    shape(p.hair, () => { c.moveTo(23, 27); c.quadraticCurveTo(16, 9, 40, 7); c.quadraticCurveTo(66, 7, 66, 27); c.lineTo(59, 19); c.quadraticCurveTo(48, 18, 38, 13); c.quadraticCurveTo(33, 23, 23, 27); c.closePath(); });
  } else {
    shape(p.hair, () => { c.moveTo(24, 27); c.quadraticCurveTo(19, 7, 43, 6); c.quadraticCurveTo(67, 8, 65, 27); c.lineTo(59, 18); c.quadraticCurveTo(49, 13, 44, 16); c.quadraticCurveTo(34, 17, 24, 27); c.closePath(); });
    for (const x of [23, 65]) for (let n = 0; n < 6; n++) oval(x + (n % 2 ? 1 : -1), 30 + n * 4, 3.5, 3.8, p.hair, .6);
    for (const x of [23, 65]) line(x - 3, 51, x + 3, 51, p.accent, 2);
  }
  if (p.glasses) {
    for (const x of [35, 53]) { c.beginPath(); c.roundRect(x - 6.7, 25, 13.4, 9, 3.4); c.strokeStyle = p.accent; c.lineWidth = 1.5; c.stroke(); }
    line(41.7, 28, 46.3, 28, p.accent, 1.1); line(23, 27, 28, 28, p.accent, 1.1); line(60, 28, 65, 27, p.accent, 1.1);
  }
  if (p.earrings) for (const x of [23, 65]) { oval(x, 34, 2.1, 3.4, p.accent, .6); oval(x, 34, 1, 2, p.skin, 0); }
  }
  c.restore();
}
