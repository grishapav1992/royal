type Point = { x: number; y: number };

/** Six contact, weight-transfer and passing poses in the existing walking cadence. */
export function profileBodyPose(frame: number) {
  const walking = frame >= 0 && frame < 6;
  return { y: walking ? [0, .8, 0, 0, .8, 0][frame] : 0, angle: walking ? [1.2, 1.6, 1.2, 1.2, 1.6, 1.2][frame] : 0 };
}

/** Match a covered hip to the same transform that moves the torso above it. */
export function profileBodyPoint(point: Point, pivotY: number, pose: ReturnType<typeof profileBodyPose>): Point {
  const angle = pose.angle * Math.PI / 180, x = point.x - 32, y = point.y - pivotY;
  return { x: 32 + x * Math.cos(angle) - y * Math.sin(angle), y: pivotY + pose.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

function phase(frame: number, far: boolean) { return (frame + (far ? 3 : 0)) % 6; }
const travel = [6, 2, -3, -6, -2, 4];
const lift = [0, 0, 0, 0, 2.8, 3.6];

export function profileLegPose(frame: number, far: boolean, hip: Point) {
  const walking = frame >= 0 && frame < 6, index = phase(frame, far);
  const foot = { x: (far ? 33.5 : 30.5) + (walking ? travel[index] : 0), y: 76 - (walking ? lift[index] : 0) };
  const ankle = { x: foot.x, y: foot.y - 2.5 };
  // A forward knee joins two fixed-length segments instead of translating a leg column.
  const dx = ankle.x - hip.x, dy = ankle.y - hip.y, distance = Math.hypot(dx, dy);
  const upper = 8.5, lower = 8.5, along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  const knee = { x: hip.x + dx / distance * along + dy / distance * bend, y: hip.y + dy / distance * along - dx / distance * bend };
  return { hip, knee, ankle, foot, angle: walking ? [0, 0, -.08, -.14, -.1, .08][index] : 0 };
}

/** One tapered contour hides the joint inside the limb. Its covered root has no cap seam. */
export function drawProfileLimb(c: CanvasRenderingContext2D, root: Point, joint: Point, end: Point, rootWidth: number, endWidth: number, color: string, ink: string) {
  const normal = (a: Point, b: Point) => { const d = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.y - a.y) / d, y: (a.x - b.x) / d }; };
  const startNormal = normal(root, joint), endNormal = normal(joint, end);
  const middleNormal = normal(root, end), middleWidth = (rootWidth + endWidth) / 2;
  const point = (p: Point, n: Point, width: number, sign: number) => ({ x: p.x + n.x * width / 2 * sign, y: p.y + n.y * width / 2 * sign });
  const a = point(root, startNormal, rootWidth, 1), b = point(joint, middleNormal, middleWidth, 1), d = point(end, endNormal, endWidth, 1);
  const e = point(end, endNormal, endWidth, -1), f = point(joint, middleNormal, middleWidth, -1), g = point(root, startNormal, rootWidth, -1);
  const contour = () => {
    c.moveTo(a.x, a.y); c.quadraticCurveTo(b.x, b.y, d.x, d.y);
    c.lineTo(e.x, e.y); c.quadraticCurveTo(f.x, f.y, g.x, g.y);
  };
  c.beginPath(); contour(); c.closePath(); c.fillStyle = color; c.fill();
  c.beginPath(); contour(); c.strokeStyle = ink; c.lineWidth = .65; c.stroke();
}

export function profileArmPose(frame: number, far: boolean, shoulder: Point, length: number) {
  const walking = frame >= 0 && frame < 6, swing = walking ? -travel[phase(frame, far)] * .8 : 0;
  return {
    shoulder: { x: shoulder.x, y: shoulder.y - 2 },
    elbow: { x: shoulder.x - 1.4 + swing * .55, y: shoulder.y + length * .52 },
    wrist: { x: shoulder.x + 1.2 + swing, y: shoulder.y + length - 3.5 },
    hand: { x: shoulder.x + 1.5 + swing, y: shoulder.y + length - .5 },
  };
}

export function drawProfileArm(c: CanvasRenderingContext2D, pose: ReturnType<typeof profileArmPose>, sleeve: string, skin: string, ink: string, shortSleeve = false) {
  drawProfileLimb(c, pose.shoulder, pose.elbow, pose.wrist, shortSleeve ? 6.8 : 9, 5.7, shortSleeve ? skin : sleeve, ink);
  if (shortSleeve) {
    const hem = { x: pose.shoulder.x + (pose.elbow.x - pose.shoulder.x) * .52, y: pose.shoulder.y + (pose.elbow.y - pose.shoulder.y) * .52 };
    const middle = { x: (pose.shoulder.x + hem.x) / 2, y: (pose.shoulder.y + hem.y) / 2 };
    drawProfileLimb(c, pose.shoulder, middle, hem, 9, 7.5, sleeve, ink);
  }
  c.beginPath(); c.ellipse(pose.hand.x, pose.hand.y, 3.2, 3.8, -.1, 0, Math.PI * 2);
  c.fillStyle = skin; c.fill(); c.strokeStyle = ink; c.lineWidth = .6; c.stroke();
  // The wrist enters the hand rather than ending in a separate outlined patch.
  c.beginPath(); c.moveTo(pose.wrist.x, pose.wrist.y - .2); c.lineTo(pose.hand.x, pose.hand.y);
  c.strokeStyle = skin; c.lineWidth = 4.7; c.stroke();
}
