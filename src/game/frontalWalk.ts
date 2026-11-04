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

/** Covered sleeve roots and foreshortening replace sideways flapping arm columns. */
export function frontalArmPose(frame: number, side: Side, shoulderY: number, half: number, length: number, back: boolean) {
  const depth = -advance(frame, side, back), rootX = 32 + side * (half - 10);
  return {
    shoulder: { x: rootX, y: shoulderY + 3 },
    elbow: { x: rootX + side * 10, y: shoulderY + length * .55 + depth * .3 },
    wrist: { x: rootX + side * 10.7, y: shoulderY + length - 3.5 + depth * 1.8 },
    hand: { x: rootX + side * 10.8, y: shoulderY + length - .5 + depth * 1.8 },
  };
}
