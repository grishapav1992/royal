import type { Facing } from '../shared/movement';
import type { MiraAction } from '../shared/miraRoutine';

/** An adult cartoon diva with a long dress, a clear profile and working gestures. */
export function drawMira(c: CanvasRenderingContext2D, facing: Facing, frame: number, sip: number, action: MiraAction = 'serve', phase = 0) {
  c.save(); c.beginPath(); c.rect(0, 0, 32, 40); c.clip(); c.scale(.5, .5);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (facing === 'left') { c.translate(64, 0); c.scale(-1, 1); }
  const side = facing === 'left' || facing === 'right', back = facing === 'up';
  const blink = frame === 8 || frame === 24, step = action === 'walk' ? Math.sin(frame * Math.PI / 3) : 0;
  const skin = '#f5c2a0', shade = '#d79077', ink = '#693329';
  const hair = '#c63e22', light = '#f17b38', hairShade = '#a72f22', red = '#b12b42', gold = '#efc36e';
  const shape = (color: string, path: () => void, edge = .55) => {
    c.beginPath(); path(); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = .55) => shape(color, () => c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), edge);
  const stroke = (color: string, width: number, path: () => void) => { c.beginPath(); path(); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  const line = (x: number, y: number, ex: number, ey: number, color: string, width = .6) => stroke(color, width, () => { c.moveTo(x, y); c.lineTo(ex, ey); });
  const arm = (x: number, y: number, ex: number, ey: number, hx: number, hy: number) => {
    const path = () => { c.moveTo(x, y); c.quadraticCurveTo(ex, ey, hx, hy); };
    stroke(ink, 3.5, path); stroke(skin, 2.55, path); oval(hx, hy, 1.45, 1.1, skin, .35);
  };
  // Long calves end in separate soles and heels, all anchored to the floor.
  for (const [x, offset] of side ? [[30, -step], [35, step]] : [[27, step], [36, -step]]) {
    shape(skin, () => { c.moveTo(x - 2.9, 47); c.lineTo(x + 3.2, 47); c.quadraticCurveTo(x + 3 + offset, 59, x + .6 + offset * 2, 72); c.lineTo(x - 1.4 + offset * 2, 74); c.quadraticCurveTo(x - 3.2 + offset, 61, x - 2.9, 47); c.closePath(); });
    const dx = offset * 2;
    shape('#4a2330', () => { c.moveTo(x - 1.5 + dx, 71.6); c.lineTo(x + .7 + dx, 72.3); c.quadraticCurveTo(x + 1 + dx, 74, x + 4.3 + dx, 75.5); c.quadraticCurveTo(x + 5.2 + dx, 77, x + 1 + dx, 76.9); c.lineTo(x - 2.4 + dx, 75.3); c.closePath(); }, .4);
    line(x - 2 + dx, 74.5, x - 2 + dx, 78, '#4a2330', .9); line(x - 2.4 + dx, 78, x - 1 + dx, 78, '#4a2330', .7);
  }
  c.translate(0, action === 'walk' ? -Math.abs(step) * .35 : Math.sin(phase) * .12);
  // A forward bend lowers the shoulder to the counter without lengthening the arm.
  if (action === 'wipe') c.transform(1, 0, -.12, .82, 9.4, 14);
  // Hair falls mainly to one side so the shoulders and waist stay readable.
  shape(hair, () => { c.moveTo(23, 12); c.bezierCurveTo(19, 3, 28, 1, 33, 4); c.bezierCurveTo(42, 1, 45, 10, 41, 18); c.quadraticCurveTo(44, 23, 41, 28); c.quadraticCurveTo(45, 35, 39, 39); c.quadraticCurveTo(35, 41, 33, 35); c.lineTo(26, 34); c.quadraticCurveTo(17, 38, 16, 31); c.quadraticCurveTo(21, 25, 18, 21); c.quadraticCurveTo(18, 17, 23, 12); c.closePath(); });
  shape(hairShade, () => { c.moveTo(31, 16); c.quadraticCurveTo(41, 19, 38, 27); c.quadraticCurveTo(43, 35, 36, 37); c.lineTo(24, 32); c.closePath(); }, 0);
  shape(skin, () => {
    if (side) { c.moveTo(31, 18); c.lineTo(35, 18); c.lineTo(34.5, 24); c.quadraticCurveTo(39, 25, 39.5, 28); c.quadraticCurveTo(40, 32, 35, 34); c.lineTo(28, 32); c.lineTo(28.5, 27); c.quadraticCurveTo(29, 25, 31, 24); }
    else { c.moveTo(29, 18); c.lineTo(33.5, 18); c.lineTo(34.2, 24); c.quadraticCurveTo(38.5, 25, 40, 28); c.lineTo(38, 34); c.lineTo(24, 34); c.lineTo(22.5, 28); c.quadraticCurveTo(24, 25, 29, 24); } c.closePath();
  });
  if (back) {
    shape(red, () => { c.moveTo(23, 29); c.quadraticCurveTo(31, 33, 39, 29); c.quadraticCurveTo(38, 36, 36, 40); c.quadraticCurveTo(37, 43, 41, 48); c.quadraticCurveTo(42, 56, 38, 66); c.quadraticCurveTo(38, 71, 43, 75); c.quadraticCurveTo(32, 78, 21, 75); c.quadraticCurveTo(25, 70, 25, 65); c.quadraticCurveTo(19, 52, 22, 47); c.quadraticCurveTo(28, 42, 26, 38); c.closePath(); });
    stroke('#db4b59', 1.1, () => { c.moveTo(35, 46); c.quadraticCurveTo(39, 52, 34, 66); c.quadraticCurveTo(33, 71, 36, 74); });
  } else if (side) {
    shape(red, () => { c.moveTo(28.5, 28.5); c.quadraticCurveTo(33, 31, 37, 28); c.bezierCurveTo(42, 27, 43, 32, 40, 35); c.quadraticCurveTo(34.5, 37, 35.5, 40); c.quadraticCurveTo(38, 44, 40, 47); c.quadraticCurveTo(42, 51, 38, 63); c.quadraticCurveTo(38, 71, 43, 75); c.quadraticCurveTo(35, 77, 26, 75); c.quadraticCurveTo(29, 66, 28, 60); c.lineTo(28, 50); c.quadraticCurveTo(23, 49, 24, 44); c.quadraticCurveTo(27, 41, 28, 38); c.closePath(); });
    shape('#d94a55', () => { c.moveTo(36, 29); c.quadraticCurveTo(40, 28, 41, 31); c.quadraticCurveTo(39, 35, 36, 34); c.closePath(); }, 0);
    shape(skin, () => { c.moveTo(30, 48); c.quadraticCurveTo(34, 56, 32, 65); c.lineTo(30, 72); c.lineTo(27.5, 72); c.quadraticCurveTo(29, 61, 28, 55); c.closePath(); }, .35);
  } else {
    shape(red, () => { c.moveTo(22.8, 29); c.quadraticCurveTo(26, 26.5, 31, 30.5); c.quadraticCurveTo(35.5, 26.5, 40, 28.5); c.quadraticCurveTo(42, 33, 37.5, 35); c.quadraticCurveTo(34, 38, 35.5, 40.5); c.quadraticCurveTo(42, 45, 42, 50); c.quadraticCurveTo(41, 61, 37, 67); c.quadraticCurveTo(38, 72, 44, 75); c.quadraticCurveTo(37, 78, 31, 76); c.lineTo(29, 47); c.quadraticCurveTo(24, 52, 22.5, 57); c.quadraticCurveTo(19, 54, 21, 49); c.quadraticCurveTo(23, 44, 27, 40.5); c.quadraticCurveTo(29, 38, 25, 35); c.quadraticCurveTo(21, 33, 22.8, 29); c.closePath(); });
    shape('#d94a55', () => { c.moveTo(24, 29.5); c.quadraticCurveTo(27, 27.5, 30, 31); c.quadraticCurveTo(26, 33.5, 24, 32); c.closePath(); }, 0);
    shape('#871f36', () => { c.moveTo(34, 35); c.quadraticCurveTo(35, 39, 34, 41); c.quadraticCurveTo(40, 46, 39, 53); c.lineTo(35, 62); c.quadraticCurveTo(33, 54, 33, 47); c.closePath(); }, 0);
    stroke('#e85d62', .8, () => { c.moveTo(31, 48); c.quadraticCurveTo(32, 65, 34, 73); });
  }
  line(side ? 28 : 27, 40.5, side ? 35 : 36, 40.5, gold, .9);
  // A small waist apron keeps the long evening silhouette recognisable as a bartender.
  shape('#352631', () => { c.moveTo(28, 42); c.lineTo(side ? 34 : 35, 42); c.lineTo(side ? 35 : 37, 49); c.quadraticCurveTo(31, 50.5, side ? 27 : 26, 49); c.closePath(); }, .35);
  if (!back) { line(side ? 31 : 27, 25, side ? 34 : 31, 27, gold, .45); if (!side) line(31, 27, 36, 25, gold, .45); oval(side ? 34 : 31, 27, .6, .8, gold, 0); }
  const left = side ? 29 : 23.5, right = side ? 37.5 : 39;
  if (action === 'polish' || action === 'stock') {
    arm(left, 28, side ? 25 : 20, 37, 31, 39); const rub = Math.sin(phase) * 1.3; arm(right, 28, 42, 37, 36, 37 + rub);
    shape(action === 'stock' ? '#57866c' : '#eff8f0', () => c.roundRect(30, action === 'stock' ? 28 : 33, 6, 10, 1.2), .5);
    if (action === 'stock') shape(gold, () => c.roundRect(31.6, 25, 2.8, 4, .6), .3);
    else { line(32, 36, 34, 36, '#b5ced1'); shape('#f8ebd3', () => c.roundRect(34, 36 + rub, 5, 4, .9), .3); }
  } else if (action === 'wipe') {
    const reach = Math.sin(phase) * 4; arm(left, 28, side ? 25 : 19, 40, 26, 43); arm(right, 28, 42, 43, 44 + reach, 54); shape('#f1e3bd', () => c.roundRect(39 + reach, 54, 10, 3, 1), .4);
  } else if (action === 'idle' || action === 'chat') {
    arm(left, 28, side ? 24 : 17.5, 36, side ? 29 : 27, 40); arm(right, 28, side ? 41 : 44, 36, side ? 35 : 36, 40);
  } else if (action === 'walk') {
    arm(left, 28, side ? 25 : 21, 38, 27 + step, 45); arm(right, 28, side ? 42 : 44, 38, 41 - step, 46);
  } else {
    arm(left, 28, side ? 24 : 18, 36, 27, 40); const raise = sip >= 0 ? [0, 2, 5, 5, 2, 0][sip] ?? 0 : 0; arm(right, 28, 43, 38, 51, 35 - raise);
    shape('#edf4e9', () => { c.moveTo(49, 28 - raise); c.lineTo(55, 28 - raise); c.lineTo(54, 38 - raise); c.lineTo(50, 38 - raise); c.closePath(); }, .5); shape('#d8ac52', () => c.roundRect(50, 32 - raise, 3.5, 5, .6), 0); line(54, 29 - raise, 56, 25 - raise, '#67936d', .8);
  }
  const eye = (x: number, profile = false) => {
    if (blink) stroke('#512c29', .65, () => { c.moveTo(x - 1.8, 12.6); c.quadraticCurveTo(x, 13.6, x + 2, 12.4); });
    else {
      shape('#fff8e8', () => { c.moveTo(x - 2, 12.5); c.quadraticCurveTo(x, 11.3, x + 2.1, 12.3); c.quadraticCurveTo(x + .1, 14.5, x - 2, 12.5); c.closePath(); }, .18);
      oval(x + (profile ? .7 : .35), 12.8, .65, .9, '#57816f', 0); oval(x + (profile ? .8 : .4), 12.8, .3, .65, '#342b2c', 0);
      stroke('#512c29', .7, () => { c.moveTo(x - 2, 12.5); c.quadraticCurveTo(x, 11.4, x + 2.1, 12.3); });
      if (profile) line(x - 1.7, 12.2, x - 2.6, 11.5, '#512c29', .5); else line(x + 1.8, 12.1, x + 2.8, 11.4, '#512c29', .5);
    }
  };
  if (back) {
    shape(hair, () => { c.moveTo(23, 13); c.bezierCurveTo(20, 2, 36, 0, 40, 9); c.quadraticCurveTo(44, 17, 38, 23); c.quadraticCurveTo(40, 28, 37, 33); c.quadraticCurveTo(40, 36, 35, 38); c.quadraticCurveTo(27, 37, 28, 31); c.quadraticCurveTo(17, 34, 19, 27); c.quadraticCurveTo(25, 22, 23, 13); c.closePath(); });
    stroke(light, 1.25, () => { c.moveTo(28, 6); c.quadraticCurveTo(24, 13, 27, 19); c.quadraticCurveTo(30, 26, 24, 29); }); stroke(light, .9, () => { c.moveTo(36, 8); c.quadraticCurveTo(40, 17, 34, 23); c.quadraticCurveTo(38, 29, 34, 34); });
  } else if (side) {
    shape(skin, () => { c.moveTo(29, 7); c.quadraticCurveTo(37, 4, 39, 10); c.lineTo(39, 12); c.quadraticCurveTo(40, 14, 42, 14.8); c.lineTo(39.3, 16); c.lineTo(40.2, 17.1); c.quadraticCurveTo(40.4, 20, 35, 20.7); c.quadraticCurveTo(30, 20, 29, 17); c.closePath(); });
    shape(hair, () => { c.moveTo(23, 14); c.bezierCurveTo(19, 7, 26, 1, 32, 4); c.quadraticCurveTo(38, 2, 40, 8.5); c.quadraticCurveTo(35, 8, 32, 7); c.quadraticCurveTo(31, 12, 29, 16); c.quadraticCurveTo(28, 21, 30, 24); c.quadraticCurveTo(26, 27, 22, 23); c.quadraticCurveTo(26, 19, 23, 14); c.closePath(); });
    stroke(light, 1.3, () => { c.moveTo(28, 5); c.quadraticCurveTo(23, 10, 26, 16); c.quadraticCurveTo(29, 20, 26, 23); }); eye(36, true);
    stroke('#8a452e', .55, () => { c.moveTo(34, 10.4); c.quadraticCurveTo(36, 9.4, 37.9, 10.1); }); oval(35.8, 16.5, .9, .45, '#e89b87', 0);
    shape('#ae2843', () => { c.moveTo(38.8, 16.8); c.lineTo(40.2, 17.1); c.quadraticCurveTo(39.5, 18.3, 38.7, 17.6); c.closePath(); }, 0); stroke(gold, .8, () => c.ellipse(29.4, 18, 1.1, 1.9, -.12, 0, Math.PI * 2));
  } else {
    c.save(); c.translate(31, 13); c.rotate(-.06); c.translate(-31, -13);
    shape(skin, () => { c.moveTo(25, 8); c.bezierCurveTo(26, 3, 39, 4, 39, 11); c.quadraticCurveTo(39, 17.5, 32, 20.5); c.quadraticCurveTo(26, 19.5, 25, 13); c.closePath(); });
    shape('#fbd1af', () => { c.moveTo(33, 8); c.quadraticCurveTo(38, 7, 37.5, 13); c.quadraticCurveTo(36, 17, 33, 17); c.closePath(); }, 0);
    eye(28.8); eye(35);
    stroke('#85412d', .6, () => { c.moveTo(26.8, 10.2); c.quadraticCurveTo(28.8, 9.3, 30.6, 10); }); stroke('#85412d', .6, () => { c.moveTo(33, 9.9); c.quadraticCurveTo(35, 8.8, 37, 9.5); });
    stroke(shade, .45, () => { c.moveTo(32, 13.3); c.quadraticCurveTo(33, 15.4, 31.6, 15.5); }); oval(27.5, 16, 1.2, .45, '#e99f89', 0); oval(36.4, 15.9, 1, .4, '#e99f89', 0);
    shape('#ae2843', () => { c.moveTo(29.6, 17); c.quadraticCurveTo(31, 16.2, 32, 16.8); c.lineTo(34.2, 16.6); c.quadraticCurveTo(32.5, 18.8, 29.6, 17); c.closePath(); }, 0);
    for (const x of [25, 39.5]) stroke(gold, .8, () => c.ellipse(x, 17.8, 1, 1.9, -.1, 0, Math.PI * 2));
    // One swept fringe, rather than two symmetric tufts around a large head.
    shape(hair, () => { c.moveTo(23, 13); c.bezierCurveTo(20, 5, 26, 1, 31, 3.7); c.quadraticCurveTo(34, 3, 35, 5.6); c.quadraticCurveTo(32, 9, 28, 11); c.quadraticCurveTo(25, 13, 24.5, 17); c.quadraticCurveTo(21.5, 17, 23, 13); c.closePath(); });
    shape(hair, () => { c.moveTo(35, 5); c.quadraticCurveTo(40, 3, 42, 9); c.quadraticCurveTo(43, 14, 39.5, 17); c.lineTo(39, 11); c.quadraticCurveTo(38, 7, 35, 6.5); c.closePath(); });
    stroke(light, 1.2, () => { c.moveTo(27, 5); c.quadraticCurveTo(22, 8, 25, 13); }); stroke(light, .8, () => { c.moveTo(37, 6); c.quadraticCurveTo(41, 8, 41, 12); }); c.restore();
  }
  if (!back) {
    shape(hair, () => { c.moveTo(24, 17); c.quadraticCurveTo(18, 20, 21, 25); c.quadraticCurveTo(24, 29, 20, 32); c.quadraticCurveTo(18, 35, 23, 36); c.quadraticCurveTo(17, 39, 16, 33); c.quadraticCurveTo(17, 29, 18, 27); c.quadraticCurveTo(14, 23, 20, 18); c.closePath(); });
    stroke(light, 1.1, () => { c.moveTo(20, 22); c.quadraticCurveTo(18, 25, 22, 28); c.quadraticCurveTo(18, 32, 21, 34); });
  }
  c.restore();
}
