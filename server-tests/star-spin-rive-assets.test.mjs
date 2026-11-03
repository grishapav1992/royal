import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=data=>createHash('sha256').update(data).digest('hex');
const rigConfig=JSON.parse(await readFile('games/wild-nudge/animation/rigs.json','utf8'));
test('all four Rive exports bind their current source, images and seven reaction states',async()=>{
 assert.deepEqual(rigConfig.characters.map(c=>c.id),['lyra','aeliri','vespera','nyxara']);
 for(const c of rigConfig.characters){
  const file=JSON.parse(await readFile(`public/assets/wild-nudge/characters/${c.id}-rive.json`,'utf8'));
  assert.equal(file.character,c.id);assert.equal(file.artboard,c.artboard);assert.equal(file.cliVersion,'1.7.0');assert.deepEqual(file.modes,['idle','spin_wait','wild_align','bonus_enter','bonus_idle','round_win','select']);
  const bytes=Buffer.from(file.data,'base64');assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);assert(bytes.length>100000);assert.equal(bytes.subarray(0,4).toString(),'RIVE');
  for(const[path,digest]of Object.entries(file.sourceHashes)){const source=await readFile(path);assert.equal(hash(/\.(?:mjs|rml|json)$/.test(path)?source.toString('utf8').replace(/\r\n/g,'\n'):source),digest,'Regenerate Rive export: '+path);}
 }
 const runtime=JSON.parse(await readFile('public/assets/wild-nudge/characters/rive-runtime.json','utf8')),sdk=JSON.parse(await readFile('node_modules/@rive-app/webgl2/package.json','utf8'));assert.equal(runtime.version,sdk.version);assert.equal(hash(Buffer.from(runtime.data,'base64')),runtime.sha256);assert.equal(hash(await readFile('node_modules/@rive-app/webgl2/rive.wasm')),runtime.sha256);assert.equal(runtime.licenseText,(await readFile('games/wild-nudge/animation/RIVE-LICENSE.txt','utf8')).replace(/\r\n/g,'\n'));
});
test('skin weights stay normalized and every texture mesh uses valid triangles',async()=>{
 for(const c of rigConfig.characters){const scene=await readFile(`games/wild-nudge/animation/${c.id}/scene.rml`,'utf8');assert.equal((scene.match(/<RootBone /g)||[]).length,5);assert.equal((scene.match(/<LinearAnimation /g)||[]).length,7);
  for(const match of scene.matchAll(/<Weight values="(\d+)" indices="(\d+)"/g)){const values=Number(match[1]),indices=Number(match[2]);let total=0;for(let slot=0;slot<4;slot++){const weight=Math.floor(values/2**(slot*8))%256,bone=Math.floor(indices/2**(slot*8))%256;total+=weight;if(weight)assert(bone>=1&&bone<=5);}assert.equal(total,255,'Weights must not stretch the bind pose');}
  for(const match of scene.matchAll(/<Mesh triangleIndexBytes="([A-Za-z0-9+/=]+)"/g)){const bytes=Buffer.from(match[1],'base64');let count=0,n=0,shift=0;for(const byte of bytes){n+=(byte&127)*2**shift;if(byte&128){shift+=7;assert(shift<35);}else{assert(n<651);count++;n=0;shift=0;}}assert.equal(shift,0);assert(count>0&&count%3===0);}
 }
});
