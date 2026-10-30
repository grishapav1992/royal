import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectHostSource} from '../scripts/build-host-projection.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const base='existing production source\n',next='reviewed forest source\n';
const row={commit:'a'.repeat(40),path:'src/ui/GameViewport.ts',baseSha256:sha(base),sha256:sha(next),patches:[{from:'existing production',to:'reviewed forest'}]};
test('projection applies a single reviewed change to an exact retained source',()=>{
 assert.equal(projectHostSource(row,Buffer.from(base)).toString(),next);
 assert.equal(projectHostSource(row,Buffer.from(base.replace(/\n/g,'\r\n'))).toString(),next);
});
test('a changed baseline or a forged result fingerprint cannot be used',()=>{
 assert.throws(()=>projectHostSource(row,Buffer.from('other source')),/origin differs/);
 assert.throws(()=>projectHostSource({...row,sha256:'0'.repeat(64)},Buffer.from(base)),/Projected source differs/);
});
test('patches must match once, and unsafe origins are rejected',()=>{
 for(const from of ['missing',''])assert.throws(()=>projectHostSource({...row,patches:[{from,to:'new'}]},Buffer.from(base)));
 const duplicate='twice twice';assert.throws(()=>projectHostSource({...row,baseSha256:sha(duplicate),patches:[{from:'twice',to:'new'}]},Buffer.from(duplicate)),/exactly once/);
 for(const path of ['../outside','src/../outside','/etc/passwd','src\\file'])assert.throws(()=>projectHostSource({...row,path},Buffer.from(base)),/Unsafe/);
 assert.throws(()=>projectHostSource({...row,commit:'HEAD'},Buffer.from(base)));
});
