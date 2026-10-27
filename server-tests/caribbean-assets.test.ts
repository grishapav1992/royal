import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import sharp from 'sharp';
test('Caribbean runtime media decodes, preserves captain alpha and fits the budget',async()=>{
 let total=0;
 for(const name of ['harbor','captain','captain-win']){
  const path='public/assets/caribbean-treasures/'+name+'.webp',info=await sharp(path).metadata();total+=(await stat(path)).size;
  assert.equal(info.format,'webp');assert(info.width!>=720);assert(info.height!>400);
  if(name!=='harbor'){assert(info.hasAlpha);const alpha=(await sharp(path).stats()).channels[3];assert.equal(alpha.min,0);assert(alpha.max>240);}
 }
 assert(total<1024*1024);
 const pkg=JSON.parse(await readFile('games/caribbean-treasures/package.json','utf8'));assert.deepEqual(pkg.assetRoots,['caribbean-treasures']);assert.equal(pkg.version,'1.0.0');
});
