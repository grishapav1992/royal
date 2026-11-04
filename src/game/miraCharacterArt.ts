import type { Facing } from '../shared/movement';
import { miraSeatAmount, type MiraAction } from '../shared/miraRoutine';

type Point = [number, number];
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** Portrait-derived character, in the existing 32x40 room-art coordinate system. */
export function paintMira(c: CanvasRenderingContext2D, facing: Facing, frame: number, sip: number, action: MiraAction = 'serve', phase = 0, progress = 0) {
  c.save(); c.beginPath(); c.rect(0, 0, 32, 40); c.clip(); c.scale(.5, .5);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (facing === 'left') { c.translate(64, 0); c.scale(-1, 1); }
  const side = facing === 'left' || facing === 'right', back = facing === 'up';
  const seat = miraSeatAmount(action, progress), wave = Math.sin(phase), step = action === 'walk' ? Math.sin(frame * Math.PI / 3) : 0;
  const skin = '#efb28b', highlight = '#ffd0a1', shade = '#c77c61', ink = '#55282b';
  const hair = '#b7351c', hairLight = '#ed6d2d', hairDark = '#85271c', red = '#9f2639', gold = '#e9b856';
  const shape = (fill: string, path: () => void, width = .65) => {
    c.beginPath(); path(); c.fillStyle = fill; c.fill();
    if (width) { c.strokeStyle = ink; c.lineWidth = width; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, fill: string, width = .5) => shape(fill, () => c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), width);
  const stroke = (fill: string, width: number, path: () => void) => { c.beginPath(); path(); c.strokeStyle = fill; c.lineWidth = width; c.stroke(); };
  const line = (a: Point, b: Point, fill: string, width: number) => stroke(fill, width, () => { c.moveTo(...a); c.lineTo(...b); });
  const limb = (a: Point, b: Point, d: Point, width: number, fill: string) => {
    const path = () => { c.moveTo(...a); c.lineTo(...b); c.lineTo(...d); };
    stroke(ink, width + 1, path); stroke(fill, width, path);
    oval(b[0], b[1], width / 2, width / 2, fill, 0);
  };
  const arm = (a: Point, b: Point, hand: Point) => { limb(a, b, hand, 3.5, skin); oval(hand[0], hand[1], 1.6, 1.25, highlight, .4); };
  const drink = (x: number, y: number, fill = '#e0b95e', garnish = true) => {
    shape('#e5ded0', () => { c.moveTo(x, y); c.lineTo(x + 6, y); c.lineTo(x + 5, y + 12); c.lineTo(x + 1, y + 12); c.closePath(); }, .6);
    if (fill) shape(fill, () => c.rect(x + 1.2, y + 4, 3.6, 7), 0);
    if (garnish) {
      line([x + 4, y + 7], [x + 6, y - 4], '#53432b', .8);
      oval(x + 2.8, y + 7, 1.7, 1.9, '#f1d274', .35); line([x + 3, y - 1], [x + 1, y - 4], '#6c8d47', 1.5);
    }
  };

  // Knees stay connected under the skirt; the resting pose crosses the shins.
  for (let i = 0; i < 2; i++) {
    const x = i ? 36 : 28, stride = (i ? -step : step) * 3;
    const knee: Point = [mix(x + stride, i ? 31 : 25, seat), mix(63 - Math.max(0, stride) * .8, i ? 60 : 58, seat)];
    const foot: Point = [mix(x - stride, i ? 23 : 31, seat), mix(75 - Math.max(0, stride) * 1.2, i ? 75 : 72, seat)];
    limb([x, 49], knee, foot, i ? 5 : 5.5, i ? shade : skin);
    line([knee[0] - .8, knee[1] + 2], [foot[0] - .7, foot[1] - 3], highlight, .65);
    shape('#30212b', () => { c.moveTo(foot[0] - 3, foot[1] - 2); c.lineTo(foot[0] + 2, foot[1] - 2); c.lineTo(foot[0] + 5, foot[1] + .8); c.quadraticCurveTo(foot[0] + 5, foot[1] + 3, foot[0] - 2, foot[1] + 2); c.closePath(); });
    line([foot[0] - 2, foot[1] - 4], [foot[0] + 2, foot[1] - 4], '#3c252e', 1.3);
    line([foot[0] - 2, foot[1] + 2], [foot[0] - 2, foot[1] + 4], '#3c252e', 1);
    line([foot[0] + 1, foot[1] + 1], [foot[0] + 4, foot[1] + 1], gold, .65);
  }
  c.save();
  if (action === 'wipe') c.transform(1, 0, -.15, .82, 8, 13);
  c.translate(action === 'walk' ? step * .15 : 0, action === 'walk' ? -Math.abs(step) * .45 : wave * .12);
  // Deep copper silhouette and a high asymmetric wave echo the dialogue portrait.
  shape(hairDark, () => { c.moveTo(19, 10); c.bezierCurveTo(15, 0, 27, -1, 32, 3); c.bezierCurveTo(44, -1, 47, 9, 44, 19); c.quadraticCurveTo(49, 26, 44, 32); c.quadraticCurveTo(47, 40, 39, 44); c.lineTo(21, 43); c.quadraticCurveTo(11, 40, 17, 33); c.quadraticCurveTo(10, 26, 17, 20); c.quadraticCurveTo(13, 14, 19, 10); c.closePath(); });
  shape(hair, () => { c.moveTo(19, 12); c.bezierCurveTo(16, 3, 28, -1, 32, 4); c.bezierCurveTo(43, 1, 45, 10, 42, 17); c.quadraticCurveTo(46, 23, 42, 29); c.quadraticCurveTo(46, 35, 40, 40); c.lineTo(23, 40); c.quadraticCurveTo(14, 39, 19, 32); c.quadraticCurveTo(13, 25, 19, 20); c.closePath(); });
  shape(skin, () => { c.moveTo(28, 18); c.lineTo(35, 18); c.lineTo(35, 24); c.quadraticCurveTo(41, 25, 42, 29); c.lineTo(38, 35); c.lineTo(24, 35); c.lineTo(21, 29); c.quadraticCurveTo(23, 25, 28, 24); c.closePath(); });
  shape(red, () => {
    c.moveTo(22, 29); c.quadraticCurveTo(27, 27, 31, 31); c.quadraticCurveTo(36, 27, 41, 29);
    c.quadraticCurveTo(43, 35, 36, 39); c.quadraticCurveTo(35, 43, 39, 46);
    c.quadraticCurveTo(44, 50, 43, 55); c.quadraticCurveTo(32, 60 - seat * 2, 22, 54);
    c.quadraticCurveTo(21, 49, 27, 43); c.quadraticCurveTo(29, 39, 24, 36); c.quadraticCurveTo(20, 34, 22, 29); c.closePath();
  });
  shape('#bd3848', () => { c.moveTo(23, 30); c.quadraticCurveTo(27, 28, 30, 31.5); c.quadraticCurveTo(26, 34, 23, 32.8); c.closePath(); }, 0);
  shape('#751e32', () => { c.moveTo(36, 35); c.quadraticCurveTo(33, 40, 37, 45); c.quadraticCurveTo(42, 48, 42, 53); c.lineTo(36, 54); c.lineTo(32, 41); c.closePath(); }, 0);
  line([24, 41], [38, 41], gold, 1.7); line([31, 40], [33, 42], '#f7d789', .7);
  shape('#302730', () => { c.moveTo(25, 43); c.lineTo(37, 43); c.lineTo(40, 53); c.quadraticCurveTo(32, 56, 23, 52); c.closePath(); }, .65);
  line([28, 46], [36, 46], '#6d5659', .6); line([28, 46], [29, 50], '#6d5659', .55); line([29, 50], [36, 50], '#6d5659', .55);
  if (back) { line([25, 42], [39, 42], '#54414a', 1); line([25, 42], [22, 48], '#302730', 1.8); }
  else { line([27, 25], [32, 27], gold, .7); line([32, 27], [37, 25], gold, .7); oval(32, 27, .8, 1, gold, 0); }
  // Slipped sleeves remain visibly separate from her bare shoulders.
  line([21, 30], [24, 31], '#782136', 3); line([40, 30], [43, 29], '#782136', 3);
  const left: Point = [22, 29], right: Point = [41, 29];
  if (action === 'wipe') {
    const reach = wave * 4; arm(left, [18, 43], [26, 47]); arm(right, [45, 48], [49 + reach, 68]);
    shape('#e6d6b1', () => c.roundRect(44 + reach, 68, 11, 3, .8), .5);
  } else if (action === 'polish') {
    arm(left, [20, 39], [31, 40]); arm(right, [43, 37], [36, 36 + wave * 1.4]);
    drink(29, 29, '', false); shape('#eddfbf', () => c.roundRect(33, 35 + wave * 1.4, 6, 4, .8), .4);
  } else if (action === 'stock') {
    const lift = (wave + 1) * 3; arm(left, [18, 35], [27, 31 - lift]); arm(right, [48, 36], [53, 27 - lift]);
    shape('#518168', () => c.roundRect(50, 15 - lift, 7, 12, 1.2)); shape('#9f9b5d', () => c.rect(52, 11 - lift, 3, 5)); line([51, 22 - lift], [56, 22 - lift], '#d4bd82', 3);
  } else if (action === 'walk') {
    arm(left, [19 - step * 2, 37], [24 - step * 3, 44]); arm(right, [44 + step * 2, 37], [39 + step * 3, 44]);
  } else if (action === 'greet') {
    const lift = Math.sin(Math.min(1, progress) * Math.PI);
    arm(left, [18, 35 - lift * 8], [18 + lift * 3, 42 - lift * 23]); arm(right, [45, 37], [38, 41]);
  } else if (action === 'chat') {
    arm(left, [19, 37], [26, 41]); arm(right, [45, 38 - wave], [46 + wave, 37 - wave]);
  } else if (action === 'serve') {
    const pour = progress < .55, handover = Math.max(0, Math.min(1, (progress - .55) / .35));
    if(pour) arm(left, [19, 30], [32, 23]); else arm(left, [19, 38], [29, 41]);
    arm(right, [44, 39], [43 + handover * 7, 40 + handover * 9]);
    drink(43 + handover * 7, 29 + handover * 9);
    if (pour) {
      c.save(); c.translate(36, 23); c.rotate(2.1); shape('#5d8262', () => c.roundRect(-2, -8, 7, 13, 1)); shape(gold, () => c.rect(0, -12, 3, 5)); c.restore();
      if (progress > .12) line([46.5, 29], [46.5, 34], '#e4c574', .65);
    }
  } else if (seat > .05) {
    arm(left, [14, 34], [12, 37]); drink(8, 27);
    arm(right, [44, 40], [49, 46]);
  } else {
    arm(left, [18, 36], [26, 41]); arm(right, [45, 36], [38, 41]);
  }

  if (back) {
    shape(hair, () => { c.moveTo(20, 8); c.bezierCurveTo(20, -1, 39, 0, 43, 8); c.quadraticCurveTo(46, 18, 40, 25); c.quadraticCurveTo(44, 33, 38, 38); c.quadraticCurveTo(30, 43, 22, 37); c.quadraticCurveTo(16, 32, 20, 25); c.quadraticCurveTo(15, 17, 20, 8); c.closePath(); });
    stroke(hairLight, 1.3, () => { c.moveTo(28, 5); c.quadraticCurveTo(22, 12, 27, 20); c.quadraticCurveTo(31, 28, 24, 34); });
    stroke('#d45525', 1, () => { c.moveTo(38, 7); c.quadraticCurveTo(43, 15, 36, 23); c.quadraticCurveTo(40, 32, 34, 36); });
  } else {
    c.save(); c.translate(32, 15); c.rotate(action === 'listen' ? -.09 : -.04); c.translate(-32, -15);
    shape(skin, () => { c.moveTo(25, 7); c.bezierCurveTo(29, 3, 39, 5, 40, 11); c.lineTo(side ? 42 : 39, 15); c.quadraticCurveTo(38, 19, 32, 21); c.quadraticCurveTo(26, 19, 25, 13); c.closePath(); });
    shape(highlight, () => { c.moveTo(34, 8); c.quadraticCurveTo(39, 8, 38, 13); c.quadraticCurveTo(36, 17, 33, 17); c.closePath(); }, 0);
    const blink = frame === 8 || frame === 24;
    for (const x of side ? [36.5] : [29, 36]) {
      if (blink) stroke('#42252c', .8, () => { c.moveTo(x - 2, 13); c.quadraticCurveTo(x, 14, x + 2, 12); });
      else {
        shape('#f5dfcc', () => { c.moveTo(x - 2.4, 12.4); c.lineTo(x + 2.2, 11.8); c.quadraticCurveTo(x + .5, 14.6, x - 2.4, 12.4); c.closePath(); }, .15);
        oval(x + .5, 12.7, .7, .85, '#526649', 0); line([x + .7, 12.2], [x + .7, 13.3], '#2b222b', .55);
        line([x - 2.5, 11.9], [x + 2.6, 11.2], '#76506b', 1.7);
        stroke('#35212c', .8, () => { c.moveTo(x - 2.5, 12.1); c.quadraticCurveTo(x, 13, x + 2.5, 11.5); c.lineTo(x + 3.5, 10.5); });
      }
    }
    stroke('#6c2c28', .7, () => { c.moveTo(26.8, 9.5); c.quadraticCurveTo(29, 7.7, 31, 9); });
    stroke('#6c2c28', .7, () => { c.moveTo(33.5, 8.7); c.quadraticCurveTo(35.5, 6.2, 38, 8); });
    line([32.5, 13], [31.5, 15.5], shade, .45); oval(27, 16, 1.1, .4, '#d88676', 0);
    const speaking = action === 'chat' && Math.sin(phase * 2) > -.1;
    shape('#8b233b', () => { c.moveTo(29.8, 17.2); c.quadraticCurveTo(31, 16.4, 32.1, 17); c.lineTo(35, 16.5); c.quadraticCurveTo(33.4, speaking ? 20 : 19, 29.8, 17.2); c.closePath(); }, .1);
    if (speaking) oval(32.5, 17.5, 1.1, .65, '#42232c', 0);
    for (const x of side ? [25] : [24.5, 41]) stroke(gold, .95, () => c.ellipse(x, 18, 1.55, 2.7, -.1, 0, Math.PI * 2));
    // A high swept fringe, then three large waves over the left shoulder.
    shape(hair, () => { c.moveTo(20, 13); c.bezierCurveTo(16, 4, 26, -2, 31, 2.5); c.quadraticCurveTo(35, 3, 35, 6); c.quadraticCurveTo(31, 8, 28, 11); c.quadraticCurveTo(24, 14, 24, 19); c.quadraticCurveTo(19, 20, 20, 13); c.closePath(); });
    shape(hair, () => { c.moveTo(35, 5); c.quadraticCurveTo(41, 2, 44, 9); c.quadraticCurveTo(46, 16, 42, 19); c.lineTo(40, 11); c.quadraticCurveTo(39, 7, 35, 6); c.closePath(); });
    stroke(hairLight, 1.6, () => { c.moveTo(27, 3); c.quadraticCurveTo(20, 7, 24, 12); });
    stroke('#dd5825', 1, () => { c.moveTo(37, 6); c.quadraticCurveTo(42, 8, 42, 14); });
    c.restore();
    shape(hair, () => { c.moveTo(22, 17); c.quadraticCurveTo(15, 20, 20, 25); c.quadraticCurveTo(24, 29, 19, 33); c.quadraticCurveTo(16, 36, 23, 38); c.quadraticCurveTo(17, 42, 15, 36); c.quadraticCurveTo(13, 32, 17, 28); c.quadraticCurveTo(12, 22, 18, 18); c.closePath(); });
    stroke(hairLight, 1.1, () => { c.moveTo(19, 21); c.quadraticCurveTo(16, 24, 21, 27); c.quadraticCurveTo(16, 32, 19, 35); });
  }
  c.restore(); c.restore();
}
