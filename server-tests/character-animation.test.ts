import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceCharacterMotion, characterRestScale, createCharacterMotion } from '../src/game/characterAnimation';

const step = (state: ReturnType<typeof createCharacterMotion>, distance: number, time: number, mode: 'walk' | 'rest' | 'action' = 'walk') =>
  advanceCharacterMotion(state, { distance, time, mode, normalSpeed: 155 });

test('the same distance produces the same gait across frame rates and speeds', () => {
  for (const fps of [30, 60, 120]) for (const speed of [77.5, 155, 271.25]) {
    const state = createCharacterMotion(); let contacts = 0, time = 0;
    const distance = 155, ticks = Math.ceil(distance / speed * fps);
    let pose = step(state, 0, 0);
    for (let i = 0; i < ticks; i++) {
      time += distance / speed / ticks * 1000;
      pose = step(state, distance / ticks, time); contacts += Math.abs(pose.landing);
    }
    assert.equal(contacts, 4, `${fps} fps, ${speed} units/s`);
    assert.equal(pose.frame, 0);
    assert(Math.min(state.distance, 77.5 - state.distance) < 1e-8);
  }
});

test('stale moving flags, long frames and jumps cannot keep walking or queue footfalls', () => {
  const state = createCharacterMotion();
  assert.equal(step(state, 20, 20).frame, 1);
  assert.equal(step(state, 0, 80).frame, 1);
  assert.deepEqual(step(state, 0, 170), { frame: 6, landing: 0 });
  assert.deepEqual(step(state, 0, 3000), { frame: 6, landing: 0 });
  assert.deepEqual(step(state, 500, 3016), { frame: 6, landing: 0 });
  assert.deepEqual(step(state, 2, 3032), { frame: 0, landing: 0 });
  assert.deepEqual(step(state, 0, 3048, 'rest'), { frame: 6, landing: 0 });
  assert.deepEqual(step(state, 1, 3064), { frame: 0, landing: 0 });
});

test('turns preserve fractional progress and contacts alternate once at each planted phase', () => {
  const state = createCharacterMotion();
  step(state, 20, 16); step(state, 18, 32);
  assert.deepEqual(step(state, 1, 48), { frame: 3, landing: 1 });
  assert.deepEqual(step(state, 0, 64), { frame: 3, landing: 0 });
  step(state, 20, 80);
  assert.deepEqual(step(state, 18.5, 96), { frame: 0, landing: -1 });
});

test('idle breathing fades in, stays small and resets for actions and reduced motion', () => {
  const state = createCharacterMotion(); step(state, 0, 100, 'rest');
  assert.deepEqual(characterRestScale(state, 100, 7, false), { x: 1, y: 1 });
  const scales = Array.from({ length: 43 }, (_, i) => characterRestScale(state, 100 + i * 100, 7, false));
  assert(scales.some(scale => Math.abs(scale.y - 1) > .007));
  assert(scales.every(scale => Math.abs(scale.y - 1) <= .008001 && Math.abs(scale.x - 1) <= .003001));
  assert.deepEqual(characterRestScale(state, 1234, 7, true), { x: 1, y: 1 });
  step(state, 0, 2000, 'action');
  assert.deepEqual(characterRestScale(state, 2345, 7, false), { x: 1, y: 1 });
  step(state, 0, 3000, 'rest');
  assert.deepEqual(characterRestScale(state, 3000, 7, false), { x: 1, y: 1 });
  step(state, 1, 3016);
  assert.deepEqual(characterRestScale(state, 3200, 7, false), { x: 1, y: 1 });
});
