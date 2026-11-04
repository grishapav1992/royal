import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontalArmPose, frontalBodyPose, frontalLegPose } from '../src/game/frontalWalk';

test('front and rear walking plant a foot and project opposite arm and leg depth', () => {
  for (const back of [false, true]) for (let frame = 0; frame < 6; frame++) {
    const legs = ([-1, 1] as const).map(side => frontalLegPose(frame, side, { x: 32 + side * 8, y: 61 }, 10, back));
    assert.equal(Math.max(...legs.map(leg => leg.foot.y)), 76);
    for (const side of [-1, 1] as const) {
      const leg = legs[side === -1 ? 0 : 1], arm = frontalArmPose(frame, side, 48, 21, 21, back);
      const rest = frontalArmPose(6, side, 48, 21, 21, back);
      assert((leg.scale - 1) * (arm.hand.y - rest.hand.y) < 0);
      assert(Math.abs(leg.foot.x - (32 + side * 10)) < .4);
      for (const point of [leg.hip, leg.knee, leg.ankle, arm.shoulder, arm.elbow, arm.wrist, arm.hand]) {
        assert(Number.isFinite(point.x) && Number.isFinite(point.y));
      }
    }
  }
});

test('stopping removes frontal motion, with the same stable anchors from front and back', () => {
  for (const frame of [6, 7, 8, 9, 23, 24]) {
    assert.deepEqual(frontalBodyPose(frame), { y: 0, angle: 0 });
    for (const side of [-1, 1] as const) for (const back of [false, true]) {
      assert.deepEqual(frontalArmPose(frame, side, 48, 21, 21, back), frontalArmPose(6, side, 48, 21, 21, false));
      assert.deepEqual(frontalLegPose(frame, side, { x: 32 + side * 8, y: 61 }, 10, back), frontalLegPose(6, side, { x: 32 + side * 8, y: 61 }, 10, false));
    }
  }
});
