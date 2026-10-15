import type { DealerAction, DealerProfile } from '../shared/cardTables';

export const DEALER_HANDS_SIZE = { width: 1000, height: 220 } as const;
export const DEALER_RELEASE = { x: 500, y: 184, phase: .6, angle: .06 } as const;
export const DEALER_CARD_WIDTH = 42;

type Pose = { x: number; y: number; angle: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const CARD_OFFSET = 76;
const DECK = { x: 632, y: 127 } as const;

function paperTint(base: string, tint: string, amount: number) {
  const a = Number.parseInt(base.slice(1), 16), b = Number.parseInt(tint.slice(1), 16);
  const channel = (shift: number) => Math.round(mix((a >> shift) & 255, (b >> shift) & 255, amount));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function cardPose(x: number, y: number, angle: number): Pose {
  return { x: x + Math.sin(angle) * CARD_OFFSET, y: y - Math.cos(angle) * CARD_OFFSET, angle };
}

function dealPose(progress: number): Pose {
  const poses: Array<{ at: number; pose: Pose }> = [
    { at: 0, pose: { x: 660, y: 48, angle: .1 } },
    { at: .2, pose: cardPose(DECK.x, DECK.y, -.15) },
    { at: .29, pose: cardPose(DECK.x - 3, DECK.y - 5, -.12) },
    { at: DEALER_RELEASE.phase, pose: cardPose(DEALER_RELEASE.x, DEALER_RELEASE.y, DEALER_RELEASE.angle) },
    { at: .8, pose: { x: 642, y: 64, angle: .06 } },
    { at: 1, pose: { x: 660, y: 48, angle: .1 } },
  ];
  const next = poses.findIndex(key => key.at >= progress);
  if (next <= 0) return poses[0]!.pose;
  const from = poses[next - 1]!, to = poses[next]!;
  const t = smooth((progress - from.at) / (to.at - from.at));
  return { x: mix(from.pose.x, to.pose.x, t), y: mix(from.pose.y, to.pose.y, t), angle: mix(from.pose.angle, to.pose.angle, t) };
}

/** A reusable overhead paper-cut scene, with only sleeves and hands above the felt. */
export function drawDealerHands(c: CanvasRenderingContext2D, p: DealerProfile, action: DealerAction = 'idle', progress = 0) {
  const t = clamp(progress), gesture = Math.sin(t * Math.PI);
  const ink = '#211f29', cream = '#fff0cd', skin = paperTint('#f5ddb2', p.skin, .09);
  const sleeve = paperTint('#252a41', p.uniform, .1);
  c.save();
  c.clearRect(0, 0, DEALER_HANDS_SIZE.width, DEALER_HANDS_SIZE.height);
  c.beginPath(); c.rect(0, 0, DEALER_HANDS_SIZE.width, DEALER_HANDS_SIZE.height); c.clip();
  c.lineJoin = 'round'; c.lineCap = 'round';

  const shape = (fill: string, path: () => void, edge = 0) => {
    c.beginPath(); path(); c.fillStyle = fill; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const line = (x: number, y: number, ex: number, ey: number, color: string, width = 1) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  const cardBack = (x: number, y: number, width: number, height: number, rotation = 0) => {
    c.save(); c.translate(x, y); c.rotate(rotation);
    shape('#142d2940', () => c.roundRect(-width / 2 + 2, -height / 2 + 4, width, height, 4));
    shape(cream, () => c.roundRect(-width / 2, -height / 2, width, height, 4), 2);
    shape('#8b3439', () => c.roundRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8, 2));
    c.save(); c.beginPath(); c.roundRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 1); c.clip();
    for (let y = -height; y < height; y += 13) {
      line(-width / 2, y, width / 2, y + width, '#f7dfbf', 1);
      line(-width / 2, y + width, width / 2, y, '#f7dfbf', 1);
    }
    c.restore(); c.restore();
  };

  // Simple flat objects frame the scene without branding a particular game.
  shape('#6b4e32', () => c.roundRect(50, -20, 196, 130, 14), 3);
  shape('#171b21', () => c.roundRect(65, -12, 166, 109, 9), 3);
  const chip = (x: number, y: number, color: string) => {
    shape(color, () => c.ellipse(x, y, 21, 12, 0, 0, Math.PI * 2), 2);
    for (let n = 0; n < 6; n++) {
      const a = n * Math.PI / 3;
      c.save(); c.translate(x + Math.cos(a) * 17, y + Math.sin(a) * 8); c.rotate(a);
      shape(cream, () => c.rect(-3, -2, 6, 4)); c.restore();
    }
  };
  for (const stack of [{ x: 99, color: '#e1c27c' }, { x: 149, color: '#9d4140' }, { x: 199, color: '#527d6d' }]) {
    for (let level = 0; level < 5; level++) chip(stack.x, 76 - level * 9, stack.color);
  }

  c.save(); c.translate(891, 73); c.rotate(.17);
  shape('#624a32', () => { c.moveTo(-42, -59); c.lineTo(45, -59); c.lineTo(49, 63); c.lineTo(-47, 63); c.closePath(); }, 3);
  shape('#282724', () => c.roundRect(-35, -54, 71, 104, 3), 2);
  for (const y of [15, 20, 25]) cardBack(0, y, 61, 84);
  c.restore();

  // The loose stack is where the moving hand takes every visible card.
  c.save(); c.translate(DECK.x, DECK.y); c.rotate(-.05);
  shape('#152e2a40', () => c.roundRect(-24, -29, 51, 72, 4));
  for (const y of [6, 3, 0]) cardBack(0, y, DEALER_CARD_WIDTH + 6, 66);
  c.restore();

  const drawArm = (pose: Pose, anchorX: number, thumbSide: number, grip = 0, open = 0, heldCard = false) => {
    c.save(); c.translate(pose.x, pose.y); c.rotate(pose.angle);
    const dx = anchorX - pose.x, dy = -48 - pose.y;
    const sx = dx * Math.cos(pose.angle) + dy * Math.sin(pose.angle);
    const sy = -dx * Math.sin(pose.angle) + dy * Math.cos(pose.angle);
    shape('#14252232', () => {
      c.moveTo(sx - 42 + 3, sy + 4); c.lineTo(sx + 42 + 3, sy + 4);
      c.lineTo(38, 9); c.lineTo(-32, 9); c.closePath();
    });
    shape(sleeve, () => {
      c.moveTo(sx - 42, sy); c.lineTo(sx + 42, sy);
      c.lineTo(35, -3); c.lineTo(-35, -3); c.closePath();
    });
    shape(cream, () => { c.moveTo(-35, -7); c.lineTo(35, -7); c.lineTo(33, 12); c.lineTo(-33, 12); c.closePath(); });
    shape('#e3cb9f', () => { c.moveTo(-33, 9); c.lineTo(33, 9); c.lineTo(32, 12); c.lineTo(-32, 12); c.closePath(); });

    if (heldCard) cardBack(0, CARD_OFFSET, DEALER_CARD_WIDTH, 60);
    c.save(); c.scale(thumbSide, 1);
    const curl = grip * 9, spread = open * 4;
    shape('#16392c25', () => {
      c.moveTo(-23 + 2, 12 + 4); c.bezierCurveTo(-35 + 2, 27 + 4, -36 + 2, 58 + 4, -30 + 2, 72 + 4);
      c.quadraticCurveTo(-14 + 2, 93 + 4, 10 + 2, 88 + 4);
      c.quadraticCurveTo(42 + 2, 83 + 4, 33 + 2, 48 + 4);
      c.lineTo(47 + 2, 49 + 4); c.lineTo(29 + 2, 13 + 4); c.closePath();
    });
    shape(skin, () => {
      c.moveTo(-25, 9);
      c.bezierCurveTo(-34, 22, -38, 40, -36, 58);
      c.bezierCurveTo(-35 - spread, 73 - curl, -29 - spread, 85 - curl, -17 - spread, 81 - curl);
      c.bezierCurveTo(-12, 96 - curl, 2, 96 - curl, 9, 85 - curl);
      c.bezierCurveTo(15 + spread, 93 - curl, 28 + spread, 89 - curl, 30 + spread, 79 - curl);
      c.bezierCurveTo(35 + spread, 72 - curl, 34, 59 - curl * .4, 31, 48 - curl * .25);
      c.lineTo(39 + spread, 54 - curl * .4);
      c.bezierCurveTo(48 + spread, 60 - curl * .4, 54 + spread, 52 - curl * .4, 49 + spread, 43 - curl * .4);
      c.bezierCurveTo(45, 33, 34, 22, 27, 11);
      c.bezierCurveTo(15, 4, -13, 4, -25, 9); c.closePath();
    });
    c.strokeStyle = '#cfb587'; c.lineWidth = 1.7;
    c.beginPath(); c.moveTo(-20 - spread, 62 - curl * .5); c.quadraticCurveTo(-20 - spread, 74 - curl, -17 - spread, 81 - curl); c.stroke();
    c.beginPath(); c.moveTo(5, 66 - curl * .5); c.quadraticCurveTo(6, 77 - curl, 9, 85 - curl); c.stroke();
    c.restore(); c.restore();
  };

  const dealing = action === 'deal';
  const left: Pose = { x: 404, y: 61, angle: -.16 };
  let right: Pose = dealing ? dealPose(t) : { x: 660, y: 48, angle: .1 };
  if (action === 'win') {
    left.x -= gesture * 12; left.y += gesture * 4; left.angle -= gesture * .08;
    right = { x: 660 + gesture * 12, y: 48 + gesture * 4, angle: .1 + gesture * .08 };
  } else if (action === 'lose') {
    left.y -= gesture * 8; left.angle += gesture * .08;
    right = { x: 660 - gesture * 6, y: 48 - gesture * 8, angle: .1 - gesture * .08 };
  }
  drawArm(left, 374, 1, action === 'lose' ? gesture : 0, action === 'win' ? gesture : 0);
  const holding = dealing && t >= .2 && t < DEALER_RELEASE.phase;
  const grip = dealing ? smooth((t - .16) / .1) * (1 - smooth((t - .56) / .1)) : action === 'lose' ? gesture : 0;
  const releaseOpen = dealing && t >= DEALER_RELEASE.phase ? Math.sin(clamp((t - DEALER_RELEASE.phase) / .24) * Math.PI) : action === 'win' ? gesture : 0;
  drawArm(right, 695, -1, grip, releaseOpen, holding);
  c.restore();
}
