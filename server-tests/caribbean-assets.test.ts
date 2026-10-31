import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import sharp from 'sharp';
import {CARIBBEAN_CREW,DEFAULT_CAPTAIN} from '../games/caribbean-treasures/CaribbeanCrew';
test('Caribbean runtime media decodes, preserves prop alpha and fits the reference art budget',async()=>{
 let total=0;
 for(const name of ['harbor','captain','captain-win','captain-blink','captain-focus','captain-surprise','captain-bonus','captain-soft','captain-laugh','frame','symbol-map','symbol-compass','symbol-pistol','symbol-cutlass','symbol-ruby','symbol-parrot']){
  const path='public/assets/caribbean-treasures/'+name+'.webp',info=await sharp(path).metadata();total+=(await stat(path)).size;
  assert.equal(info.format,'webp');assert(info.width!>=720);assert(info.height!>400);
  if(name!=='harbor'){assert(info.hasAlpha);const alpha=(await sharp(path).stats()).channels[3];assert.equal(alpha.min,0);assert(alpha.max>240);}
 }
 assert(total<5*1024*1024);
 const pkg=JSON.parse(await readFile('games/caribbean-treasures/package.json','utf8'));assert.deepEqual(pkg.assetRoots,['caribbean-treasures']);assert.equal(pkg.gameId,'studio-caribbean-treasures');assert.deepEqual([pkg.apiVersion,pkg.rulesVersion,pkg.progressVersion],[1,1,1]);assert.equal(pkg.preload.length,16);
});
test('ten additional pirate captains have eight complete transparent states and bounded lazy media',async()=>{
 const {createHash}=await import('node:crypto');
 const manifest=JSON.parse(await readFile('public/assets/caribbean-treasures/crew/manifest.json','utf8'));
 assert.equal(CARIBBEAN_CREW.length,11);assert.equal(new Set(CARIBBEAN_CREW.map(c=>c.id)).size,11);
 assert.equal(manifest.characters.length,10);assert.deepEqual(manifest.characters.map((c:any)=>c.id),CARIBBEAN_CREW.filter(c=>c.id!==DEFAULT_CAPTAIN).map(c=>c.id));
 let bytes=0;const identities=new Set<string>();
 for(const member of manifest.characters){
  assert.equal(member.files.length,8);assert.equal(new Set(member.files.map((f:any)=>f.sha256)).size,8);
  for(const file of [...member.files,member.thumbnail]){
   const path='public/assets/caribbean-treasures/crew/'+file.file,data=await readFile(path);bytes+=data.length;
   assert.equal(data.length,file.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256);
   const image=sharp(data),info=await image.metadata();assert.equal(info.format,'webp');assert(info.hasAlpha);
   const alpha=(await image.stats()).channels[3];assert.equal(alpha.min,0);assert.equal(alpha.max,255);
   if(file!==member.thumbnail){assert.equal(info.width,512);assert.equal(info.height,768);}
  }
  identities.add(member.files[0].sha256);
 }
 const originalThumbnail=await readFile('public/assets/caribbean-treasures/crew/'+manifest.defaultThumbnail.file);bytes+=originalThumbnail.length;
 assert.equal(createHash('sha256').update(originalThumbnail).digest('hex'),manifest.defaultThumbnail.sha256);
 assert.equal(identities.size,10);assert.equal(bytes,manifest.bytes);assert(bytes<12*1024*1024);
 const pkg=JSON.parse(await readFile('games/caribbean-treasures/package.json','utf8'));assert(!pkg.preload.some((file:string)=>file.includes('/crew/')),'Only the selected captain loads her reaction set');
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
