import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve('artifacts/work/pvp-invite-simplify/release-v3');
const before=JSON.parse(fs.readFileSync(path.join(root,'before.json')));
const base='https://stealth-spark-gokmxooi.expresshost.cloud';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files={};
async function get(name,expected){
 assert(name.startsWith('/game-modules/tsu-e-fa/')&&!name.includes('..'));
 const response=await fetch(base+name,{signal:AbortSignal.timeout(45000)});assert(response.ok,'Published package fetch failed: '+name);
 const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length<64*1024**2);assert.equal(hash(bytes),expected,'Published module changed: '+name);
 const target=path.join(root,'published-modules',name.slice('/game-modules/'.length));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);files[name]=expected;return bytes;
}
const pointerPath='/game-modules/tsu-e-fa/active.json';
const pointer=JSON.parse(await get(pointerPath,before.moduleFiles['/opt/royal-game-modules/tsu-e-fa/active.json']));
const manifest=JSON.parse(await get(pointer.manifest,pointer.sha256));
assert.equal(manifest.gameId,'tsu-e-fa');assert.equal(manifest.rulesVersion,4);assert.equal(manifest.apiVersion,1);assert.equal(manifest.progressVersion,1);
const prefix=pointer.manifest.slice(0,pointer.manifest.lastIndexOf('/')+1);
for(const [name,digest]of Object.entries(manifest.files)){
 assert(!name.startsWith('/')&&!name.split('/').some(part=>!part||part==='.'||part==='..'));
 assert.equal(before.moduleFiles['/opt/royal-game-modules/tsu-e-fa/versions/'+manifest.version+'/'+name],digest);
 await get(prefix+name,digest);
}
fs.writeFileSync(path.join(root,'published-package.json'),JSON.stringify({version:manifest.version,pointer,manifest,files},null,2)+'\n');
console.log(JSON.stringify({version:manifest.version,verifiedFiles:Object.keys(files).length}));
