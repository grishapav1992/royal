import test from 'node:test';
import assert from 'node:assert/strict';
import { rootArtwork, rootWave } from '../games/forest-heart/RootArtwork';
// @ts-expect-error Independent graph oracle deliberately has no runtime scorer dependency.
import { referenceBoard, referenceFlow } from '../scripts/game-math/forest-heart-reference.mjs';

test('all artwork rotations retain the exact visible ports for every legal tile', () => {
  const base = [10,3,11,15];
  for (const mask of [10,5,3,6,11,14,15]) {
    const art = rootArtwork(mask);
    let rotated = base[art.column];
    for (let i=0;i<art.angle/90;i++) rotated = ((rotated<<1)&15) | (rotated>>3);
    assert.equal(rotated,mask);
  }
  assert.throws(()=>rootArtwork(0));
});

test('the light wave follows only mutual connections and shortest depth on all 4096 boards', () => {
  for (let bits=0;bits<4096;bits++) {
    const board=referenceBoard(bits), wave=rootWave(board);
    assert.deepEqual([...wave.keys()].sort((a,b)=>a-b),referenceFlow(board).reachedCells);
    for (const [cell,arrival] of wave) {
      if (cell===10) { assert.equal(arrival.depth,0); continue; }
      const parent=cell+[-5,1,5,-1][arrival.entry];
      assert.equal(wave.get(parent)?.depth,arrival.depth-1);
      assert.ok(board[cell] & [1,2,4,8][arrival.entry]);
      assert.ok(board[parent] & [4,8,1,2][arrival.entry]);
    }
  }
});
