import test from 'node:test';
import assert from 'node:assert/strict';
import { createPitch, createPitchAt, kickSpot } from '../games/cr-vs-leo/crLeoPitch';
import { shotLayout, wallFor, wallCrossing } from '../games/cr-vs-leo/crLeoFreeKick';
import { easeFlight } from '../games/cr-vs-leo/crLeoTimeline';
import { Camera } from '../games/cr-vs-leo/camera';
import { Effects } from '../games/cr-vs-leo/effects';
import { platePlacement } from '../games/cr-vs-leo/stands';

const risks = ['safe', 'sharp', 'extreme'] as const, heroes = ['cr', 'leo'] as const;
test('slowing near the goal keeps the accepted start, wall and arrival moments and never runs backwards', () => {
  for (const risk of risks) {
    assert.equal(easeFlight(0, risk, false), 0); assert.equal(easeFlight(1, risk, false), 1);
    const from = risk === 'safe' ? 0 : wallCrossing(risk); let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const u = i / 1000, e = easeFlight(u, risk, false); assert(e >= previous && e <= 1); previous = e;
      if (u <= from) assert.equal(e, u);
      assert.equal(easeFlight(u, risk, true), u, 'a wall contact keeps its own clock');
    }
    const last = (easeFlight(1, risk, false) - easeFlight(.99, risk, false)) / .01, middle = (easeFlight(from + (1 - from) / 2 + .005, risk, false) - easeFlight(from + (1 - from) / 2 - .005, risk, false)) / .01;
    assert(last > .2 && last < middle);
  }
});
test('travelling between spots ends on exactly the same projection and wall as the shot itself', () => {
  for (const [w, h] of [[320, 186], [387, 468], [846, 235], [1104, 572]]) for (const hero of heroes) for (const risk of risks) {
    const spot = kickSpot(hero, risk), pitch = createPitchAt(w, h, spot.distance, spot.cameraX);
    assert.deepEqual(pitch.goal, createPitch(w, h, hero, risk).goal); assert.deepEqual(pitch.ball, createPitch(w, h, hero, risk).ball);
    assert.deepEqual(wallFor(pitch, h, risk), shotLayout(w, h, hero, risk).wall);
  }
});
test('the plate always covers the window from the stands to the bottom of the grass', () => {
  for (const [w, h] of [[320, 186], [387, 468], [846, 235], [1104, 572], [1440, 650]]) for (const risk of risks) {
    const at = platePlacement(w, createPitch(w, h, 'cr', risk).standBottom);
    assert(at.x <= 1e-6 && at.x + 1536 * at.scale >= w - 1e-6); assert(at.y <= 1e-6);
  }
});
test('the camera never shows anything outside the picture, even during a knock', () => {
  const camera = new Camera(), calls: [string, number, number][] = [];
  const c = { translate: (x: number, y: number) => calls.push(['t', x, y]), scale: (x: number, y: number) => calls.push(['s', x, y]) } as unknown as CanvasRenderingContext2D;
  camera.snap(390, 470);
  for (let i = 0; i < 600; i++) {
    if (i % 60 === 0) camera.knock(6);
    camera.follow({ zoom: i % 200 < 100 ? 1.015 : 1.16, x: i % 300 < 150 ? -200 : 900, y: i % 250 < 125 ? -200 : 900, rate: 5 }, 1 / 60);
    calls.length = 0; camera.apply(c, 390, 470);
    const z = calls[1][1], x = -calls[2][1], y = -calls[2][2];
    assert(x - 195 / z >= -1e-6 && x + 195 / z <= 390 + 1e-6 && y - 235 / z >= -1e-6 && y + 235 / z <= 470 + 1e-6);
  }
});
test('decoration is bounded and disappears on its own', () => {
  const fx = new Effects();
  for (let i = 0; i < 20; i++) { fx.confetti(400, 400, ['#fff'], 90); fx.cannon(0, 300, 400, 1, ['#fff'], 60); fx.turf(100, 300, 400, 26, 1, 1); fx.dust(1, 1, 20, 12); }
  assert(fx.count <= 420); for (let i = 0; i < 600; i++) fx.step(1 / 60); assert.equal(fx.count, 0);
});
