type Point = { x: number; y: number };
type Side = -1 | 1;

const advances = [1, .35, -.5, -1, -.35, .5];
const lifts = [0, 0, 0, 0, 2.8, 3.6];
function phase(frame: number, side: Side) { return (frame + (side === -1 ? 3 : 0)) % 6; }
function advance(frame: number, side: Side, back: boolean) {
  return frame >= 0 && frame < 6 ? advances[phase(frame, side)] * (back ? -1 : 1) : 0;
}

/** Weight transfer stays small when the walk is projected toward or away from us. */
export function frontalBodyPose(frame: number) {
  const walking = frame >= 0 && frame < 6;
  return { y: walking ? [0, .7, .1, 0, .7, .1][frame] : 0, angle: walking ? [-.5, 0, .5, .5, 0, -.5][frame] : 0 };
}

export function frontalLegPose(frame: number, side: Side, hip: Point, span: number, back: boolean) {
  const depth = advance(frame, side, back), lift = frame >= 0 && frame < 6 ? lifts[phase(frame, side)] : 0;
  const foot = { x: 32 + side * (span + depth * .3), y: 76 - lift };
  const ankle = { x: foot.x, y: foot.y - 2.5 };
  const knee = { x: (hip.x + ankle.x) / 2 + side * (.4 + lift * .12), y: (hip.y + ankle.y) / 2 - lift * .12 };
  return { hip, knee, ankle, foot, scale: 1 + depth * .04 };
}

/** The shoulder sits above the armpit; the cuff stays beside the waist. */
export function frontalArmPose(frame: number, side: Side, shoulderY: number, half: number, length: number, back: boolean) {
  const depth = -advance(frame, side, back), rootX = 32 + side * (Math.min(half, 26) - 6);
  return {
    shoulder: { x: rootX, y: shoulderY },
    elbow: { x: rootX + side * 6.2, y: shoulderY + length * .5 + depth * .3 },
    wrist: { x: rootX + side * 7, y: shoulderY + length - 3.5 + depth * 1.8 },
    hand: { x: rootX + side * 7.3, y: shoulderY + length - .5 + depth * 1.8 },
  };
}

type Arm = ReturnType<typeof frontalArmPose>;
function sleeveEnd(pose: Arm, short: boolean) {
  return short ? { x: pose.shoulder.x + (pose.elbow.x - pose.shoulder.x) * .62, y: pose.shoulder.y + (pose.elbow.y - pose.shoulder.y) * .62 } : pose.wrist;
}

/** A single garment contour joins the sleeve to the shoulder, with an open armpit. */
export function traceFrontalTop(c: CanvasRenderingContext2D, left: Arm, right: Arm, half: number, neckLeft: number, neckRight: number, neckY: number, hemY: number, short = false) {
  const l = sleeveEnd(left, short), r = sleeveEnd(right, short), cuff = short ? 3.8 : 3.1;
  c.beginPath(); c.moveTo(neckLeft, neckY);
  c.quadraticCurveTo(left.shoulder.x - 2.5, left.shoulder.y - 2, left.shoulder.x - 4.5, left.shoulder.y + 3);
  c.quadraticCurveTo(left.elbow.x - 4, short ? l.y - 2 : left.elbow.y, l.x - cuff, l.y);
  c.lineTo(l.x + cuff, l.y);
  c.quadraticCurveTo(short ? l.x + cuff : left.elbow.x + 4, short ? l.y : left.elbow.y + 1.5, left.shoulder.x + 1, left.shoulder.y + 7);
  c.lineTo(32 - half + 5, hemY - 2);
  c.quadraticCurveTo(32, hemY + 4, 32 + half - 5, hemY - 2);
  c.lineTo(right.shoulder.x - 1, right.shoulder.y + 7);
  c.quadraticCurveTo(short ? r.x - cuff : right.elbow.x - 4, short ? r.y : right.elbow.y + 1.5, r.x - cuff, r.y);
  c.lineTo(r.x + cuff, r.y);
  c.quadraticCurveTo(right.elbow.x + 4, short ? r.y - 2 : right.elbow.y, right.shoulder.x + 4.5, right.shoulder.y + 3);
  c.quadraticCurveTo(right.shoulder.x + 2.5, right.shoulder.y - 2, neckRight, neckY);
  c.closePath();
}

/** Hands and exposed forearms are drawn below the continuous clothing silhouette. */
export function drawFrontalArmSkin(c: CanvasRenderingContext2D, pose: Arm, skin: string, ink: string, short = false) {
  c.lineJoin = c.lineCap = 'round';
  if (short) {
    const hem = sleeveEnd(pose, true);
    c.beginPath(); c.moveTo(hem.x, hem.y - .5); c.quadraticCurveTo(pose.elbow.x, pose.elbow.y, pose.wrist.x, pose.wrist.y);
    c.strokeStyle = ink; c.lineWidth = 7.8; c.stroke(); c.strokeStyle = skin; c.lineWidth = 6.6; c.stroke();
  }
  c.beginPath(); c.ellipse(pose.hand.x, pose.hand.y, 3.2, 3.8, 0, 0, Math.PI * 2);
  c.fillStyle = skin; c.fill(); c.strokeStyle = ink; c.lineWidth = .6; c.stroke();
  c.beginPath(); c.moveTo(pose.wrist.x, pose.wrist.y - 1); c.lineTo(pose.hand.x, pose.hand.y);
  c.strokeStyle = skin; c.lineWidth = 4.7; c.stroke();
}
