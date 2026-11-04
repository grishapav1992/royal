import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {transform,version} from 'esbuild';
import assert from 'node:assert/strict';
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const git=path=>execFileSync('git',['show',path]);
const before=await read(process.argv[2]);
const proof=await read('module-build/wild-nudge-proof.json');
const changed=new Set();
const rows={};
for(const [name,inputSha256] of Object.entries(proof.sourceFiles)){
 if(changed.has(name)||name.startsWith('node_modules/')||[before.source[name],before.sourceLF[name]].includes(inputSha256))continue;
 const input=await readFile(name),canonical=Buffer.from(input.toString('utf8').replaceAll('\r\n','\n'));
 assert.equal(sha(input),inputSha256);assert.deepEqual(canonical,git('HEAD:'+name));
 if(sha(canonical)===before.sourceLF[name]){
  assert.deepEqual(input,Buffer.from(canonical.toString('utf8').replaceAll('\n','\r\n')));
  rows[name]={kind:'line-endings-only',inputSha256,productionLFSha256:sha(canonical)};continue;
 }
 assert.equal(name,'src/modules/GameHostContract.ts','Unreviewed implementation change');
 const config=await read('deployment/releases/star-spin-20261103-v1/host-projection.json'),row=config.files[name];
 let production=git(row.commit+':'+row.path).toString('utf8');
 for(const patch of row.patches??[]){assert.equal(production.split(patch.from).length,2);production=production.replace(patch.from,patch.to);}
 assert.equal(sha(production),before.sourceLF[name]);
 const options={loader:'ts',target:'es2022',format:'esm',minify:false};
 const old=await transform(production,options),current=await transform(canonical.toString('utf8'),options);
 assert.equal(old.code,current.code,'Host runtime differs');
 rows[name]={kind:'type-only-runtime-equal',inputSha256,canonicalSha256:sha(canonical),productionLFSha256:sha(production),runtimeSha256:sha(old.code),esbuildVersion:version,passed:true};
}
await writeFile('deployment/releases/star-spin-character-fit-20261104-v1/input-equivalence.json',JSON.stringify({format:1,productionCommit:before.sourceCommit,package:proof.version,rows},null,2)+'\n');
console.log(JSON.stringify({passed:true,lineEndings:Object.values(rows).filter(r=>r.kind==='line-endings-only').length,typeOnly:Object.values(rows).filter(r=>r.kind==='type-only-runtime-equal').length}));
