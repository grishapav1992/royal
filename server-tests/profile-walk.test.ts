import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileArmPose, profileBodyPoint, profileBodyPose, profileLegPose } from '../src/game/profileWalk';

test('the stance foot stays down while the opposite foot clears the ground', () => {
  for (let frame = 0; frame < 6; frame++) {
    const hip = profileBodyPoint({ x: 31, y: 61 }, 66, profileBodyPose(frame));
    const near = profileLegPose(frame, false, hip), far = profileLegPose(frame, true, hip);
    assert.equal(Math.max(near.foot.y, far.foot.y), 76);
    for (const leg of [near, far]) {
      assert(Math.abs(Math.hypot(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y) - 8.5) < 1e-8);
      assert(Math.abs(Math.hypot(leg.knee.x - leg.ankle.x, leg.knee.y - leg.ankle.y) - 8.5) < 1e-8);
    }
  }
});

test('opposite arm and leg advance together and resting removes travel', () => {
  const hip = { x: 31, y: 61 }, shoulder = { x: 29, y: 48 };
  for (const frame of [0, 3]) {
    const leg = profileLegPose(frame, false, hip), arm = profileArmPose(frame, false, shoulder, 21);
    assert((leg.foot.x - 30.5) * (arm.hand.x - 30.5) < 0);
  }
  for (const frame of [6, 7, 8, 9, 23, 24]) {
    assert.deepEqual(profileBodyPose(frame), { y: 0, angle: 0 });
    assert.deepEqual(profileLegPose(frame, false, hip), profileLegPose(6, false, hip));
    assert.deepEqual(profileArmPose(frame, false, shoulder, 21), profileArmPose(6, false, shoulder, 21));
  }
});
