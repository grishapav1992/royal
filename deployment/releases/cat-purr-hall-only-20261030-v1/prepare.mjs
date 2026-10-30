import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
const helper=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(helper,'../../..');
const work=path.join(root,'artifacts/work/cat-purr-hall-only'),out=path.join(work,'payload-reviewed');
const name='cat-purr-hall-only-20261030-v1',base='ee9319121f33bf14f45bacae448d21d62a17df9e';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex'),canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const git=(...a)=>cp.execFileSync(process.env.ROYAL_GIT_BINARY||'git',a,{cwd:root,stdio:['ignore','pipe','ignore']});
const release=json(path.join(root,'module-build/release-manifest.json')),receipt=json(path.join(root,'module-build/release-github.json')),before=json(path.join(work,'before.json'));
assert.equal(git('status','--porcelain').toString().trim(),'');assert.equal(release.sourceCommit,git('rev-parse','HEAD').toString().trim());
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(release.baseCommit,base);assert(release.build.passed);
assert.equal(before.sourceRevision,base);assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
const changedFiles=new Set(['src/game/RoomScene.ts','src/game/CatRenderer.ts']);
const tracked=git('ls-files','-z').toString().split('\0').filter(Boolean),cache=new Map(),origins={},hostInputs={};
function blob(commit,file){const key=commit+':'+file;if(!cache.has(key))cache.set(key,canonical(git('show',key)));return cache.get(key);}
function read(file){
 if(file in hostInputs)return cache.get('input:'+file);
 let bytes,origin;
 if(changedFiles.has(file)){
  bytes=blob(release.sourceCommit,file);origin={commit:release.sourceCommit,path:file,changed:true};
  assert.equal(digest(bytes),digest(canonical(fs.readFileSync(path.join(root,file)))));
 }else{
  const expected=before.sourceLF[file];assert(expected,'Unpublished host input rejected: '+file);
  const candidates=[file,...tracked.filter(p=>p.endsWith('/source/'+file))];
  for(const candidate of candidates){try{const value=blob(release.sourceCommit,candidate);if(digest(value)===expected){bytes=value;origin={commit:release.sourceCommit,path:candidate};break;}}catch{}}
  if(!bytes){const commits=git('log','origin/main','--format=%H','--',file).toString().trim().split('\n').filter(Boolean);
   for(const commit of commits){try{const value=blob(commit,file);if(digest(value)===expected){bytes=value;origin={commit,path:file};break;}}catch{}}}
  assert(bytes,'Production host source is not preserved in GitHub main: '+file);assert.equal(digest(bytes),expected,'Retained production source changed: '+file);
 }
 hostInputs[file]=digest(bytes);origins[file]=origin;cache.set('input:'+file,bytes);return bytes;
}
const plugin={name:'reviewed-cat-host',enforce:'pre',load(id){const file=path.relative(root,id.split('?')[0]).split('\\').join('/');if(file.startsWith('../')||file.includes('node_modules/')||!/\.(?:ts|json|css)$/.test(file))return;return read(file).toString();}};
assert.equal(digest(canonical(fs.readFileSync(path.join(root,'index.html')))),before.sourceLF['index.html']);
assert(!fs.existsSync(out),'Review and remove only the previous task-owned partial payload before retrying');fs.mkdirSync(out);
function write(file,bytes){const target=path.resolve(out,file);assert(target.startsWith(out+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return digest(bytes);}
function copy(from,to){return write(to,fs.readFileSync(from));}
const changed={};for(const file of changedFiles){assert(release.changed.includes(file));read(file);changed[file]=copy(path.join(root,file),'source/'+file);}
// Build only the hall entry. Retain the existing admin entry and every old asset.
const built=await build({root,configFile:false,publicDir:false,plugins:[plugin],build:{write:false,emptyOutDir:false,rollupOptions:{input:path.join(root,'index.html')}}});
const delta={};for(const result of Array.isArray(built)?built:[built])for(const item of result.output){const file=item.fileName,bytes=Buffer.from(item.type==='chunk'?item.code:item.source),hash=digest(bytes);
 assert(file==='index.html'||/^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(file),'Unreviewed host output: '+file);
 if(before.program['dist/'+file]===hash)continue;assert(file==='index.html'||!('dist/'+file in before.program),'Immutable client URL would change: '+file);delta[file]=write('dist-delta/'+file,bytes);}
assert('index.html' in delta);assert.deepEqual(Object.keys(origins).filter(f=>origins[f].changed).sort(),[...changedFiles].sort());
for(const [file,hash] of Object.entries(hostInputs))assert(changedFiles.has(file)||hash===before.sourceLF[file],file);
fs.mkdirSync(path.join(out,'server-delta'));
const helpers=Object.fromEntries(['runtime-inventory.cjs','quiesce.cjs','financial_gate.py'].map(f=>[f,digest(fs.readFileSync(path.join(helper,f)))]));
for(const file of ['deploy.py','snapshot.py',...Object.keys(helpers)])copy(path.join(helper,file),file);
for(const file of ['release-manifest.json','release-github.json'])copy(path.join(root,'module-build',file),file);
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:base,before,changed,delta,serverDelta:{},helpers,helperSha256:digest(fs.readFileSync(path.join(out,'deploy.py'))),snapshotSha256:digest(fs.readFileSync(path.join(out,'snapshot.py'))),compatibility:{hostInputs,hostOrigins:origins,onlyReviewedCatSourcesChanged:true,backendProgramsRetained:true,dependenciesRetained:true,moduleHostContractRetained:true,modulesChecked:Object.keys(before.activeModuleMetadata).length}};
fs.writeFileSync(path.join(out,'install-manifest.json'),JSON.stringify(manifest,null,2)+'\n');cp.execFileSync('tar',['-czf',path.join(work,'transport.tgz'),'-C',out,'.']);
console.log(JSON.stringify({sourceCommit:release.sourceCommit,hostInputs:Object.keys(hostInputs).length,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,deltaBytes:Object.keys(delta).reduce((s,f)=>s+fs.statSync(path.join(out,'dist-delta',f)).size,0),transportBytes:fs.statSync(path.join(work,'transport.tgz')).size}));
