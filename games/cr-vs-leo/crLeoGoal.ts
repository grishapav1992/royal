import type { GoalGeometry } from './crLeoTimeline';

export type NetImpact = { x: number; y: number; age: number };
export const NET_TRAVEL = .09;
export const NET_SETTLE = 1.8;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { v = clamp(v); return v * v * (3 - 2 * v); };

/** One projection shared by the rear net, roof, side panels and their seams. */
export function goalNetPoint(goal: GoalGeometry, u: number, v: number, depth = 1, impact?: NetImpact) {
  const inset = goal.width * .045;
  const front = { x: goal.x + (u - .5) * goal.width, y: goal.bottom - goal.height + v * goal.height };
  const rear = goal.rear ? { x: goal.rear.x + (u - .5) * goal.rear.width, y: goal.rear.bottom - goal.rear.height + v * goal.rear.height } : { x: goal.x + (u - .5) * (goal.width - inset * 2), y: goal.bottom - goal.height + inset * .4 + v * (goal.height - inset * .65) };
  let x = mix(front.x, rear.x, depth), y = mix(front.y, rear.y, depth);
  if (impact && impact.age > 0 && impact.age < NET_SETTLE && depth > 0 && u > 0 && u < 1 && v > 0 && v < 1) {
    // Distances are measured in goal heights, so waves travel equally along both mesh axes.
    const dx = (u - impact.x) * 3, dy = v - impact.y, distance = Math.hypot(dx, dy);
    const elapsed = impact.age - distance / 3.2;
    if (elapsed > 0) {
      const pins = smooth(Math.min(u, 1-u) / .065) * smooth(Math.min(v, 1-v) / .10);
      const release = smooth((NET_SETTLE - impact.age) / .45), attack = 1 - Math.exp(-elapsed * 45);
      const pocket = Math.exp(-distance * distance / (.24 * .24));
      const pulse = Math.sin(elapsed * 11) * Math.exp(-elapsed * 3.4) * attack;
      const wave = Math.sin(elapsed * 18) * Math.exp(-elapsed * 4.4 - distance * 1.8) * attack;
      const weight = depth * pins * release, pressure = weight * (pocket * pulse + wave * .23);
      // Backward bowing, cloth drawn toward the pocket, then an outward travelling recoil.
      x += (rear.x - front.x) * pressure * .55;
      y += (rear.y - front.y) * pressure * .55;
      const strain = weight * goal.height * (.055 * pocket * pulse - .016 * wave);
      if (distance > 1e-8) { x -= dx / distance * strain; y -= dy / distance * strain; }
      y += weight * goal.height * .070 * pocket * Math.max(0, pulse);
    }
  }
  return { x, y };
}

/** The ball crosses the goal mouth, reaches the cloth, follows its pocket and drops out. */
export function goalBallPosition(goal: GoalGeometry, impact: NetImpact, radius: number) {
  const { x: u, y: v, age } = impact;
  if (age < 0) return goalNetPoint(goal, u, v, clamp(1 + age / NET_TRAVEL));
  const held = .13, releaseAge = Math.min(age, held);
  const release = goalNetPoint(goal, u, v, 1, { ...impact, age: releaseAge });
  const floor = goalNetPoint(goal, u, 1).y - radius;
  if (age <= held) return { x: release.x, y: Math.min(floor, release.y) };
  const previous = goalNetPoint(goal, u, v, 1, { ...impact, age: held - .001 });
  const vx = (release.x - previous.x) / .001, vy = (release.y - previous.y) / .001;
  const elapsed = age - held, gravity = goal.height * (9.81 / 2.44);
  const startY = Math.min(floor, release.y), fall = (-vy + Math.sqrt(vy * vy + 2 * gravity * Math.max(0, floor-startY))) / gravity;
  const after = elapsed - fall, speed = Math.max(0, vy + gravity * fall) * .20;
  const y = after > 0 ? floor - Math.max(0, speed * after - .5 * gravity * after * after) : startY + vy * elapsed + .5 * gravity * elapsed * elapsed;
  return { x: release.x + vx * .20 * (1 - Math.exp(-elapsed / .20)), y: Math.min(floor, y) };
}

export function drawGoalNet(c: CanvasRenderingContext2D, goal: GoalGeometry, impact?: NetImpact) {
  c.save();
  const point = (u: number, v: number, depth = 1) => goalNetPoint(goal, u, v, depth, impact);
  const line = (points: { x: number; y: number }[]) => { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); };
  const corners = [point(0,0), point(1,0), point(1,1), point(0,1)];
  c.fillStyle = '#14261b20'; c.beginPath(); corners.forEach((p, i) => i ? c.lineTo(p.x,p.y) : c.moveTo(p.x,p.y)); c.closePath(); c.fill();
  // Reuse the vertices for both thread directions, keeping every intersection joined.
  const mesh = Array.from({ length: 13 }, (_, row) => Array.from({ length: 37 }, (_, col) => point(col/36,row/12)));
  c.beginPath();
  const thread = (points: { x: number; y: number }[]) => points.forEach((p, i) => i ? c.lineTo(p.x,p.y) : c.moveTo(p.x,p.y));
  for (let col = 0; col <= 36; col++) thread(mesh.map(row => row[col]));
  for (const row of mesh) thread(row);
  c.lineWidth = 1.35; c.strokeStyle = '#15332340'; c.stroke();
  c.lineWidth = .65; c.strokeStyle = '#f0f4e3b5'; c.stroke();
  // Side and roof panels meet the same rear corners, with no loose diagonal threads.
  for (const u of [0,1]) {
    for (let row = 0; row <= 12; row++) line([point(u,row/12,0),point(u,row/12)]);
    for (let d = 0; d <= 3; d++) line([point(u,0,d/3),point(u,1,d/3)]);
  }
  for (let col = 0; col <= 36; col++) line([point(col/36,0,0),point(col/36,0)]);
  for (let d = 0; d <= 3; d++) line([point(0,0,d/3),point(1,0,d/3)]);
  c.strokeStyle = '#c4cfc4'; c.lineWidth = Math.max(1.2,goal.width*.003);
  line([point(0,1,0),point(0,1),point(0,0),point(1,0),point(1,1),point(1,1,0)]);
  line([point(0,0,0),point(0,0)]); line([point(1,0,0),point(1,0)]);
  c.restore();
}

/** The rigid front posts stay in front of the ball and keeper at the frame edge. */
export function drawGoalFrame(c: CanvasRenderingContext2D, goal: GoalGeometry) {
  const left = goal.x-goal.width/2, right = goal.x+goal.width/2, top = goal.bottom-goal.height;
  c.save(); c.strokeStyle = '#fff'; c.lineWidth = Math.max(3,goal.width*.009); c.lineCap = 'round'; c.lineJoin = 'round';
  c.shadowColor = '#17251b80'; c.shadowBlur = 2;
  c.beginPath(); c.moveTo(left,goal.bottom); c.lineTo(left,top); c.lineTo(right,top); c.lineTo(right,goal.bottom); c.stroke(); c.restore();
}
