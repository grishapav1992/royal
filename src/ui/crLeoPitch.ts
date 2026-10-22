import type { PenaltyHero, PenaltyRisk } from '../shared/crLeo';

// Metres, measured from the centre of the goal line towards the kicker.
export const PITCH = { goalWidth: 7.32, goalHeight: 2.44, goalDepth: 2, goalArea: 5.5, penaltyArea: 16.5, penaltySpot: 11, arcRadius: 9.15, standBehindGoal: 4 } as const;
export function createPitch(width: number, height: number, hero: PenaltyHero, risk: PenaltyRisk) {
  const distance = risk === 'safe' ? 11 : risk === 'sharp' ? 20 : 30;
  const cameraZ = distance + 6.5, cameraX = risk === 'safe' ? 0 : hero === 'cr' ? -1.1 : 1.1;
  const horizon = height * .385;
  // Keep the foreground readable on portrait screens while retaining one ground projection.
  const focal = Math.min(height * .94, width * .72) * 17.5 / PITCH.goalWidth;
  const groundRise = height * (.84 - .385) * 6.5;
  const scale = (z: number) => focal / (cameraZ - z);
  const project = (x: number, z: number, elevation = 0) => ({
    x: width / 2 + (x - cameraX) * scale(z),
    y: horizon + groundRise / (cameraZ - z) - elevation * scale(z),
  });
  const mouth = (z: number) => ({ x: project(0, z).x, bottom: project(0, z).y, width: PITCH.goalWidth * scale(z), height: PITCH.goalHeight * scale(z) });
  const goal = { ...mouth(0), rear: mouth(-PITCH.goalDepth) };
  const ground = project(cameraX, distance);
  return { width, height, distance, cameraX, cameraZ, horizon, scale, project, goal,
    ball: { x: ground.x, y: ground.y - height * .028 },
    standBottom: project(0, -PITCH.standBehindGoal).y };
}
export type Pitch = ReturnType<typeof createPitch>;
export type PitchPoint = { x: number; z: number };

/** World-space paths, including only the part of the arc outside the penalty area. */
export function pitchMarkings() {
  const paths: PitchPoint[][] = [[{ x: -34, z: 0 }, { x: 34, z: 0 }]];
  for (const depth of [PITCH.goalArea, PITCH.penaltyArea]) {
    const half = PITCH.goalWidth / 2 + depth;
    paths.push([{ x: -half, z: 0 }, { x: -half, z: depth }, { x: half, z: depth }, { x: half, z: 0 }]);
  }
  const angle = Math.acos((PITCH.penaltyArea - PITCH.penaltySpot) / PITCH.arcRadius);
  paths.push(Array.from({ length: 65 }, (_, i) => {
    const a = -angle + 2 * angle * i / 64;
    return { x: Math.sin(a) * PITCH.arcRadius, z: PITCH.penaltySpot + Math.cos(a) * PITCH.arcRadius };
  }));
  return paths;
}

export function drawPitch(c: CanvasRenderingContext2D, pitch: Pitch, background?: HTMLImageElement) {
  const { width: w, height: h, project, cameraZ } = pitch;
  if (background) {
    // The clean plate has no baked-in lines. Its stand foot follows the same end of the pitch.
    const imageScale = Math.max(w / background.width, pitch.standBottom / 446);
    c.drawImage(background, (w - background.width * imageScale) / 2, pitch.standBottom - 446 * imageScale, background.width * imageScale, background.height * imageScale);
  } else { c.fillStyle = '#346d35'; c.fillRect(0, 0, w, h); }
  c.save(); c.lineCap = 'butt'; c.lineJoin = 'round'; c.strokeStyle = '#fffde7cf';
  // Clip to the visible ground before projecting, never through or behind the camera.
  const nearZ = cameraZ - (h * (.84 - .385) * 6.5) / (h - pitch.horizon);
  const segment = (a: PitchPoint, b: PitchPoint) => {
    if (a.z > nearZ && b.z > nearZ) return;
    const clipped = (p: PitchPoint, q: PitchPoint) => p.z <= nearZ ? p : { x: p.x + (q.x - p.x) * (nearZ - p.z) / (q.z - p.z), z: nearZ };
    const start = clipped(a, b), end = clipped(b, a), p = project(start.x, start.z), q = project(end.x, end.z);
    c.lineWidth = Math.max(.8, Math.min(3.2, pitch.scale((start.z + end.z) / 2) * .12));
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
  };
  for (const path of pitchMarkings()) for (let i = 1; i < path.length; i++) segment(path[i - 1], path[i]);
  const spot = project(0, PITCH.penaltySpot);
  if (PITCH.penaltySpot < nearZ) { c.fillStyle = '#fffde7df'; c.beginPath(); c.ellipse(spot.x, spot.y, Math.max(1.4, pitch.scale(11) * .11), Math.max(.65, pitch.scale(11) * .035), 0, 0, Math.PI * 2); c.fill(); }
  // A contact shadow anchors the net to the goal line and its rear supports.
  const corners = [[-3.66, 0], [3.66, 0], [3.66, -2], [-3.66, -2]];
  c.fillStyle = '#13281c28'; c.beginPath(); corners.forEach(([x, z], i) => { const p = project(x, z); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.closePath(); c.fill();
  c.restore();
}
