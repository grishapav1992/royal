import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const folder='deployment/releases/guard-profile-20261104-v1';
const [beforeFile,productionFile]=process.argv.slice(2);
const before=JSON.parse(fs.readFileSync(beforeFile)),production=JSON.parse(fs.readFileSync(productionFile));
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024**2});
const commit=git('rev-parse','9d4d015a').toString().trim();
const source='src/game/SecurityGuard.ts';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=structuredClone(production.hostProjection.origins);
assert.equal(before.sourceCommit,production.sourceCommit);
assert.deepEqual(before.program,before.preparedProgram);
assert.equal(before.container.image,before.preparedImage);
assert.equal(before.container.health,'healthy');
for(const [name,hash]of Object.entries(production.hostProjection.inputs)){
  assert.equal(files[name].sha256,hash);
  assert([before.source[name],before.sourceLF[name]].includes(hash),'Retained production input differs: '+name);
}
assert(files[source]&&before.source[source],'Production guard source is missing');
const bytes=Buffer.from(git('show',commit+':'+source).toString().replace(/\r\n/g,'\n'));
const hash=sha(bytes);
assert.notEqual(hash,before.sourceLF[source],'Guard is already published');
files[source]={commit,path:source,baseSha256:hash,sha256:hash};
fs.writeFileSync(folder+'/host-projection.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,entries:['index.html'],files},null,2)+'\n');
fs.writeFileSync(folder+'/scope.json',JSON.stringify({productionCommit:before.sourceCommit,guardCommit:commit,expectedSources:{[source]:hash},addedGames:[],restoredGames:[]},null,2)+'\n');
console.log(JSON.stringify({base:before.sourceCommit,inputs:Object.keys(files).length,changed:{[source]:hash}}));
