import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {git} from '../scripts/release.mjs';
import {digest} from '../scripts/module-build-cache.mjs';
import {readHostProjection} from '../scripts/build-host-projection.mjs';
const parent=resolve('artifacts/work/projection-batch-tests');
await mkdir(parent,{recursive:true});test.after(()=>rm(parent,{recursive:true,force:true}));
async function fixture(t,count=120){
 const root=await mkdtemp(resolve(parent,'fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));
 git(root,['init','-q']);git(root,['config','user.name','Projection test']);git(root,['config','user.email','projection@example.invalid']);
 const text='first\n'+'a'.repeat(40)+' blob 17\nembedded\0text\n';
 for(let n=0;n<count;n++){await mkdir(resolve(root,'src'),{recursive:true});await writeFile(resolve(root,'src',`file ${n}.ts`),text+n);}
 git(root,['add','.']);git(root,['commit','-qm','sources']);const commit=git(root,['rev-parse','HEAD']);
 const config={format:1,productionCommit:commit,entries:['index.html'],files:Object.fromEntries(Array.from({length:count},(_,n)=>[`src/file ${n}.ts`,{commit,path:`src/file ${n}.ts`,baseSha256:digest(text+n),sha256:digest(text+n)}]))};
 const save=async()=>{await writeFile(resolve(root,'projection.json'),JSON.stringify(config));git(root,['add','.']);git(root,['commit','-qm','projection']);};await save();
 return{root,config,save,text};
}
test('hundreds of exact Git inputs use a bounded batch and preserve embedded delimiters',async t=>{
 const f=await fixture(t),reader=await readHostProjection(f.root,'projection.json',{strictOrigins:true}),names=Object.keys(f.config.files);
 reader.preload(names);for(let n=0;n<names.length;n++)assert.equal(reader.read(names[n]).toString(),f.text+n);
 assert.equal(reader.metrics.batchedBlobs,120);assert(reader.metrics.gitCommands<=4,JSON.stringify(reader.metrics));
 reader.preload(names);for(const name of names)reader.read(name);assert.equal(reader.metrics.gitCommands,4);
});
test('aliases share Git transport while retaining independently checked patches',async t=>{
 const f=await fixture(t,1),name='src/file 0.ts';f.config.files['src/alias.ts']={...f.config.files[name],patches:[{from:'first',to:'second'}],sha256:digest((f.text+'0').replace('first','second'))};await f.save();
 const reader=await readHostProjection(f.root,'projection.json',{strictOrigins:true});reader.preload(Object.keys(f.config.files));
 assert.equal(reader.metrics.batchedBlobs,1);assert.equal(reader.read('src/alias.ts').toString(),(f.text+'0').replace('first','second'));
});
test('batch reuse does not admit symlink modes, false hashes or command delimiters',async t=>{
 const f=await fixture(t,1),name='src/file 0.ts';await symlink('file 0.ts',resolve(f.root,'src/link.ts'));
 git(f.root,['add','.']);git(f.root,['commit','-qm','symlink']);f.config.files[name].commit=git(f.root,['rev-parse','HEAD']);f.config.files[name].path='src/link.ts';await f.save();
 let reader=await readHostProjection(f.root,'projection.json',{strictOrigins:true});assert.throws(()=>reader.preload([name]),/regular Git file/);
 f.config.files[name].path=name;f.config.files[name].sha256='0'.repeat(64);await f.save();reader=await readHostProjection(f.root,'projection.json',{strictOrigins:true});reader.preload([name]);assert.throws(()=>reader.read(name),/Projected source differs/);
 f.config.files[name].path='src/file\nHEAD:other';await f.save();reader=await readHostProjection(f.root,'projection.json',{strictOrigins:true});assert.throws(()=>reader.preload([name]),/Unsafe/);
});
