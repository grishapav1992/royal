import type { GoalGeometry } from './crLeoTimeline';

export type NetImpact = { x: number; y: number; age: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** One projection shared by the rear net, roof, side panels and their seams. */
export function goalNetPoint(goal: GoalGeometry, u: number, v: number, depth = 1, impact?: NetImpact) {
  const inset = goal.width * .045;
  const front = { x: goal.x + (u - .5) * goal.width, y: goal.bottom - goal.height + v * goal.height };
  const rear = { x: goal.x + (u - .5) * (goal.width - inset * 2), y: goal.bottom - goal.height + inset * .4 + v * (goal.height - inset * .65) };
  let x = mix(front.x, rear.x, depth), y = mix(front.y, rear.y, depth);
  if (impact && impact.age > 0 && impact.age < .8 && u > 0 && u < 1 && v > 0 && v < 1) {
    const distance = Math.hypot((u - impact.x) * 2, v - impact.y);
    const wave = Math.sin(impact.age * 26 - distance * 8) * Math.exp(-impact.age * 6 - distance * 4);
    const motion = depth * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * Math.min(4, goal.width * .012) * Math.min(1, impact.age * 25) * wave;
    x += motion * (u - .5); y += motion;
  }
  return { x, y };
}

export function drawGoalNet(c: CanvasRenderingContext2D, goal: GoalGeometry, impact?: NetImpact) {
  c.save();
  const point = (u: number, v: number, depth = 1) => goalNetPoint(goal, u, v, depth, impact);
  const line = (points: { x: number; y: number }[]) => { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); };
  const corners = [point(0,0), point(1,0), point(1,1), point(0,1)];
  c.fillStyle = '#14261b20'; c.beginPath(); corners.forEach((p, i) => i ? c.lineTo(p.x,p.y) : c.moveTo(p.x,p.y)); c.closePath(); c.fill();
  c.lineWidth = .65; c.strokeStyle = '#f0f4e3a0';
  // Rear net intersections use identical sample points in both directions.
  for (let col = 0; col <= 36; col++) line(Array.from({length:13}, (_, row) => point(col/36,row/12)));
  for (let row = 0; row <= 12; row++) line(Array.from({length:37}, (_, col) => point(col/36,row/12)));
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
