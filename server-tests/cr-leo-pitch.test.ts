import test from 'node:test';
import assert from 'node:assert/strict';
import { createPitch, pitchMarkings, PITCH } from '../src/ui/crLeoPitch';
import { shotLayout } from '../src/ui/crLeoFreeKick';
import { goalNetPoint } from '../src/ui/crLeoGoal';

const close = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const sizes = [[320, 385], [390, 385], [643, 386], [1100, 560], [1440, 650]];
test('goal posts, rear supports and stadium share one ground projection in all six scenes', () => {
  for (const [w, h] of sizes) for (const hero of ['cr', 'leo'] as const) for (const risk of ['safe', 'sharp', 'extreme'] as const) {
    const { pitch, goal, ball, wall } = shotLayout(w, h, hero, risk);
    for (const side of [-1, 1]) {
      const front = pitch.project(side * 3.66, 0), back = pitch.project(side * 3.66, -2);
      close(front.x, goal.x + side * goal.width / 2); close(front.y, goal.bottom);
      const net = goalNetPoint(goal, (side + 1) / 2, 1);
      close(net.x, back.x); close(net.y, back.y);
    }
    assert(pitch.standBottom < goal.rear.bottom && goal.rear.bottom < goal.bottom);
    assert(goal.bottom - pitch.standBottom < h * .04, 'no unrelated strip of pitch between goal and stand');
    close(goal.width / goal.height, 3);
    close(ball.y + h * .028, pitch.project(pitch.cameraX, pitch.distance).y);
    if (wall) { close(wall.bottom, pitch.project(0, pitch.distance - 9.15).y); assert(wall.bottom > goal.bottom && wall.bottom < ball.y); }
  }
});
test('11, 20 and 30 metre positions move the camera back rather than independently scaling the goal', () => {
  for (const [w, h] of sizes) for (const hero of ['cr', 'leo'] as const) {
    const [penalty, near, far] = (['safe', 'sharp', 'extreme'] as const).map(r => createPitch(w, h, hero, r));
    assert.deepEqual([penalty.distance, near.distance, far.distance], [11, 20, 30]);
    close(near.goal.width / penalty.goal.width, 17.5 / 26.5); close(far.goal.width / penalty.goal.width, 17.5 / 36.5);
    assert(penalty.goal.bottom > near.goal.bottom && near.goal.bottom > far.goal.bottom);
    // The same six-yard area moves toward the goal as the viewer backs away.
    const areaGap = (p: typeof penalty) => p.project(0, 5.5).y - p.goal.bottom;
    assert(areaGap(penalty) > areaGap(near) && areaGap(near) > areaGap(far));
    close(penalty.project(0, 11).x, penalty.ball.x); close(penalty.project(0, 11).y, penalty.ball.y + h * .028);
  }
});
test('both boxes have regulation proportions and the arc meets the penalty box only at its two endpoints', () => {
  const [line, small, large, arc] = pitchMarkings();
  assert(line.every(p => p.z === 0));
  assert.deepEqual(small, [{ x: -9.16, z: 0 }, { x: -9.16, z: 5.5 }, { x: 9.16, z: 5.5 }, { x: 9.16, z: 0 }]);
  assert.deepEqual(large, [{ x: -20.16, z: 0 }, { x: -20.16, z: 16.5 }, { x: 20.16, z: 16.5 }, { x: 20.16, z: 0 }]);
  close(arc[0].z, 16.5); close(arc.at(-1)!.z, 16.5);
  for (const p of arc) { close(Math.hypot(p.x, p.z - 11), PITCH.arcRadius); assert(p.z >= 16.5 - 1e-9); }
});
test('all ground lines perpendicular to the goal line converge on the same vanishing point', () => {
  for (const [w, h] of sizes) for (const risk of ['safe', 'sharp', 'extreme'] as const) {
    const pitch = createPitch(w, h, 'cr', risk);
    for (const x of [-20.16, -9.16, 9.16, 20.16]) {
      const a = pitch.project(x, 0), b = pitch.project(x, 5.5);
      const atHorizon = a.x + (b.x - a.x) * (pitch.horizon - a.y) / (b.y - a.y);
      close(atHorizon, w / 2);
    }
  }
});
