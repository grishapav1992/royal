import test from 'node:test';
import assert from 'node:assert/strict';
import { volcanicFlight, flightPose, pinPosition, pocketPosition, volcanicTable, volcanicRtp, validVolcanicRound } from '../src/ui/volcanicPlinkoModel';

test('all 4096 accepted paths collide with their exact crystal pins and reach the paid pocket', () => {
  for (let bits = 0; bits < 4096; bits++) {
    const path = Array.from({ length: 12 }, (_, index) => bits >> index & 1), points = volcanicFlight(path);
    let column = 0;
    assert.equal(points.length, 14);
    for (let row = 0; row < 12; row++) {
      const pin = pinPosition(row, column);
      assert.deepEqual(points[row + 1], { x: pin.x, y: pin.y - 15 });
      column += path[row];
    }
    const paidPocket = pocketPosition(column), final = flightPose(points, 1);
    assert.equal(final.x, paidPocket.x); assert.equal(final.y, paidPocket.y - 18);
    for (let segment = 0; segment < 13; segment++) for (const t of [.1, .5, .9]) {
      const pose = flightPose(points, (segment + t) / 13);
      assert(pose.x >= Math.min(points[segment].x, points[segment + 1].x) - 1e-9);
      assert(pose.x <= Math.max(points[segment].x, points[segment + 1].x) + 1e-9);
      assert(Number.isFinite(pose.y));
    }
  }
});

test('the three profiles retain the original 12-row vFair payouts and returns', () => {
  assert.deepEqual(volcanicTable('easy'), [10,3,1.6,1.4,1.1,1,.5,1,1.1,1.4,1.6,3,10]);
  assert.deepEqual(volcanicTable('medium'), [33,11,4,2,1.1,.6,.3,.6,1.1,2,4,11,33]);
  assert.deepEqual(volcanicTable('hard'), [170,24,8.1,2,.7,.2,.2,.2,.7,2,8.1,24,170]);
  assert.equal(volcanicRtp('easy'), .989794921875);
  assert.equal(volcanicRtp('medium'), .989892578125);
  assert.equal(volcanicRtp('hard'), .991162109375);
});

test('a mismatched path, payout or table is never presented as a verified round', () => {
  const round = { gameId: 'royal-plinko', rulesVersion: 1, input: { rows: 12, risk: 'medium' }, outcome: { path: [0,0,0,0,0,0,1,1,1,1,1,1], bucket: 6 }, multiplier: .3, stakeUnits: '1000', payoutUnits: '300' };
  assert(validVolcanicRound(round));
  assert(!validVolcanicRound({ ...round, payoutUnits: '301' }));
  assert(!validVolcanicRound({ ...round, multiplier: 33 }));
  assert(!validVolcanicRound({ ...round, outcome: { ...round.outcome, bucket: 7 } }));
  assert(!validVolcanicRound({ ...round, outcome: { ...round.outcome, path: Array(12).fill(2) } }));
  assert.throws(() => volcanicFlight(Array(11).fill(0)));
});
