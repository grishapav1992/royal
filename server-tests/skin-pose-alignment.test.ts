import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { alignSkinWalkingPoses } from '../src/game/skinPoseAlignment';
import { misalignedSkinSheet } from '../tests/fixtures/skin-walk-sheet';

test('complete walking poses align the head and ground while correcting a reversed profile', async () => {
  const { data } = await sharp(await misalignedSkinSheet()).resize(128, 192).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const layout = alignSkinWalkingPoses(new Uint8ClampedArray(data));
  const marker = (row: number, pose: number) => {
    let x = 0, y = 0, n = 0;
    for (let cy = 0; cy < 48; cy++) for (let cx = 0; cx < 32; cx++) {
      const at = ((row * 48 + cy) * 128 + pose * 32 + cx) * 4;
      if (data[at] > 220 && data[at + 1] > 200 && data[at + 2] < 30 && data[at + 3] > 240) { x += cx; y += cy; n++; }
    }
    assert(n); return { x: x / n, y: y / n };
  };
  for (let row = 0; row < 4; row++) {
    const reference = marker(row, 0);
    for (const pose of [1, 2]) {
      const a = layout[row * 4 + pose], p = marker(row, pose);
      assert.equal(a.pose, pose, 'Useful complete walking figures must remain available');
      const x = 16 + ((a.mirrored ? 31 - p.x : p.x) - 16) * a.scale + a.x, y = p.y * a.scale + a.y;
      assert(Math.abs(x - reference.x) < 1.1, `Horizontal head drift: ${x - reference.x}`);
      assert(Math.abs(y - reference.y) < 1.1, `Vertical head drift: ${y - reference.y}`);
      assert.equal(a.mirrored, pose === 2);
    }
  }
});

test('an unusable walking frame falls back to a complete standing pose', () => {
  const data = new Uint8ClampedArray(128 * 192 * 4);
  for (let y = 5; y < 44; y++) for (let x = 8; x < 24; x++) data[(y * 128 + x) * 4 + 3] = 255;
  const result = alignSkinWalkingPoses(data);
  assert.equal(result[1].pose, 0); assert.equal(result[2].pose, 0);
  assert.equal(result[3].pose, 3, 'Seated artwork must remain untouched');
});

test('a slight silhouette change does not mirror a small mark during a front-facing walk', () => {
  const data = new Uint8ClampedArray(128 * 192 * 4);
  for (const pose of [0, 1, 2]) {
    const fill = (left: number, top: number, right: number, bottom: number, color: number[]) => {
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        data.set(color, (y * 128 + pose * 32 + x) * 4);
      }
    };
    fill(8, 8, 24, 24, [215, 170, 130, 255]);
    fill(pose === 1 ? 10 : 11, 22, pose === 2 ? 23 : 21, 44, [90, 70, 80, 255]);
    const tuft = pose === 1 ? 24 : 7;
    fill(tuft, 8, tuft + 1, 10, [55, 38, 32, 255]);
    fill(21, 13, 22, 14, [166, 37, 29, 255]);
  }
  const frontSteps = alignSkinWalkingPoses(data).slice(1, 3);
  assert.deepEqual(frontSteps.map(step => [step.pose, step.mirrored]), [[1, false], [2, false]]);
});
