import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import sharp from 'sharp';
test('Caribbean runtime media decodes, preserves prop alpha and fits the reference art budget',async()=>{
 let total=0;
 for(const name of ['harbor','captain','captain-win','captain-blink','captain-focus','captain-surprise','captain-bonus','captain-soft','captain-laugh','frame','symbol-map','symbol-compass','symbol-pistol','symbol-cutlass','symbol-ruby','symbol-parrot']){
  const path='public/assets/caribbean-treasures/'+name+'.webp',info=await sharp(path).metadata();total+=(await stat(path)).size;
  assert.equal(info.format,'webp');assert(info.width!>=720);assert(info.height!>400);
  if(name!=='harbor'){assert(info.hasAlpha);const alpha=(await sharp(path).stats()).channels[3];assert.equal(alpha.min,0);assert(alpha.max>240);}
 }
 assert(total<5*1024*1024);
 const pkg=JSON.parse(await readFile('games/caribbean-treasures/package.json','utf8'));assert.deepEqual(pkg.assetRoots,['caribbean-treasures']);assert.equal(pkg.version,'1.3.0');assert.equal(pkg.preload.length,16);
});
test('recorded audio exports preserve licensed provenance, inventory and bounded signal edges',async()=>{
 const {createHash}=await import('node:crypto');
 const root='public/assets/caribbean-treasures/audio/',manifest=JSON.parse(await readFile(root+'manifest.json','utf8'));
 assert.equal(Object.keys(manifest.files).length,12);let bytes=0;
 for(const [id,clip] of Object.entries<any>(manifest.files)){
  assert.equal(clip.file,id+'.m4a');const data=await readFile(root+clip.file);bytes+=data.length;
  assert.equal(clip.sha256,createHash('sha256').update(data).digest('hex'));assert.equal(clip.bytes,data.length);
  assert(clip.peak<.95&&clip.peak>.01);assert(clip.boundaryPeak<.005);assert(clip.accentOffsetSeconds>=0&&clip.accentOffsetSeconds<clip.durationSeconds);
 }
 assert(bytes<6*1024*1024);assert(manifest.files.music.durationSeconds>120);
 const credits=JSON.parse(await readFile(root+'credits.json','utf8'));assert.equal(credits.music.author,'Matthew Pablo');assert.equal(credits.music.license,'CC-BY-3.0');assert.equal(credits.effects.length,2);
 const source=await readFile('games/caribbean-treasures/CaribbeanAudio.ts','utf8');assert(!source.includes('createOscillator'));assert(!source.includes('new AudioContext'));
});
