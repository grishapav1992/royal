import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reviewBuildInputs} from '../deployment/releases/forest-heart-responsive-20261030-v1/build-input-review.mjs';

const folder=new URL('../deployment/releases/forest-heart-responsive-20261030-v1/',import.meta.url);
const names=['package.json','tsconfig.json'];
const hash=bytes=>createHash('sha256').update(Buffer.from(bytes).toString().replace(/\r\n/g,'\n')).digest('hex');
function fixture(){
 const review=JSON.parse(readFileSync(new URL('build-input-review.json',folder)));
 const baseline=Object.fromEntries(names.map(name=>[name,readFileSync(new URL('production-build-inputs/'+name,folder))]));
 const prepared=Object.fromEntries(names.map(name=>[name,readFileSync(new URL('../'+name,import.meta.url))]));
 const before={sourceCommit:review.productionCommit,sourceLF:Object.fromEntries(names.map(name=>[name,hash(baseline[name])]))};
 return{review,baseline,prepared,before};
}
function change(data,name,edit){const value=JSON.parse(data.prepared[name]);edit(value);data.prepared[name]=Buffer.from(JSON.stringify(value));data.review.files[name].preparedSha256=hash(data.prepared[name]);}
const verify=data=>reviewBuildInputs(data.before,data.baseline,data.prepared,data.review);

test('the retained production inputs permit only the reviewed tooling differences',()=>{
 const result=verify(fixture());assert(result.productionFilesPreserved);assert.equal(result.scriptChanges.length,12);
});
test('a newly pinned dependency difference is still rejected',()=>{
 const data=fixture();change(data,'package.json',value=>value.dependencies.vite='99.0.0');
 assert.throws(()=>verify(data),/identity or dependency/);
});
test('build and runtime scripts cannot be admitted as test commands',()=>{
 const data=fixture();change(data,'package.json',value=>value.scripts.build='different-build');data.review.scriptChanges.push('build');
 assert.throws(()=>verify(data),/Build or runtime script/);
});
test('newly pinned emitter or resolver differences are rejected',()=>{
 for(const option of ['target','baseUrl']){const data=fixture();change(data,'tsconfig.json',value=>value.compilerOptions[option]='different');assert.throws(()=>verify(data),/Compiler or resolver/);}
});
test('a stale production fingerprint or an unreviewed prepared input is rejected',()=>{
 const stale=fixture();stale.before.sourceLF['package.json']='0'.repeat(64);assert.throws(()=>verify(stale),/production input differs/);
 const changed=fixture();changed.prepared['package.json']=Buffer.from('{}');assert.throws(()=>verify(changed),/Prepared input differs/);
});
