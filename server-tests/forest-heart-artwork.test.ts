import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
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

test('the transparent root atlas has the same real edge ports in both light states and contains no square plate', async () => {
  const image = await sharp('public/assets/forest-heart/v4/roots.webp').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width,1536);assert.equal(image.info.height,768);
  const size=384,base=[10,3,11,15];
  for(let row=0;row<2;row++)for(let col=0;col<4;col++){
    const alpha=(x:number,y:number)=>image.data[((row*size+y)*image.info.width+col*size+x)*4+3]/255;
    for(let edge=0;edge<4;edge++){
      let sum=0,count=0;
      for(let offset=1;offset<=5;offset++)for(let p=Math.floor(size*.46);p<size*.54;p++){
        sum+=alpha(edge===1?size-1-offset:edge===3?offset:p,edge===0?offset:edge===2?size-1-offset:p);count++;
      }
      assert.ok(base[col]&(1<<edge)?sum/count>.85:sum/count<.05,`row ${row}, column ${col}, port ${edge}`);
    }
    for(const [x,y]of [[2,2],[size-3,2],[2,size-3],[size-3,size-3]])assert.ok(alpha(x,y)<.05,'No rotating square border or corner background');
  }
  const plate=await sharp('public/assets/forest-heart/v4/tile.webp').metadata();
  assert.equal(plate.width,512);assert.equal(plate.height,512);assert.equal(plate.hasAlpha,false);
});
