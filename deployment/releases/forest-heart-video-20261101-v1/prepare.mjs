import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'../../..'),task=resolve(root,'../publish-v15'),out=resolve(task,'payload');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=p=>hash(readFileSync(p));
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,maxBuffer:64*1024**2});
const before=read(resolve(task,'before.json')),scope=read(resolve(import.meta.dirname,'scope.json'));
const release=read(resolve(root,'module-build/release-manifest.json')),receipt=read(resolve(root,'module-build/release-github.json'));
assert.equal(git('status','--porcelain').toString().trim(),'');
assert.equal(release.sourceCommit,git('rev-parse','HEAD').toString().trim());
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(release.baseCommit,before.sourceCommit);
assert.equal(release.scope,'modules');assert.deepEqual(release.modules,['forest-heart']);assert(release.build.passed);
assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.health,'healthy');
const projection=release.moduleProjection;assert(projection);
for(const [name,digest]of Object.entries(projection.inputs)){
 if(name.startsWith('games/forest-heart/'))continue;
 assert.equal(digest,before.sourceLF[name],'Unrelated production input differs: '+name);
}
const pkg=release.packages[0];assert.equal(release.packages.length,1);assert.equal(pkg.gameId,'studio-forest-heart');
const folder=resolve(root,'module-dist/studio-forest-heart/versions/'+pkg.version),metadata=read(resolve(folder,'manifest.json'));
assert.deepEqual(Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(n=>[n,metadata[n]])),{apiVersion:1,rulesVersion:1,progressVersion:1});
const approved=read(resolve(task,'approved-manifest.json')),old=resolve(root,'module-dist/studio-forest-heart/versions/'+approved.version);
const media=m=>Object.fromEntries(Object.entries(m.files).filter(([n])=>n.startsWith('media/')));
assert.deepEqual(media(metadata),media(approved),'Approved media changed');
const normalize=(text,version)=>text.replaceAll('/versions/'+version+'/','/versions/__VERSION__/');
for(const suffix of ['.js','.css']){
 const current=Object.keys(metadata.files).find(n=>n.endsWith(suffix)),previous=Object.keys(approved.files).find(n=>n.endsWith(suffix));
 assert.equal(normalize(readFileSync(resolve(folder,current),'utf8'),metadata.version),normalize(readFileSync(resolve(old,previous),'utf8'),approved.version),'Approved program changed: '+suffix);
}
assert(!existsSync(out),'Payload already exists');mkdirSync(out,{recursive:true});
function copy(from,to){const p=resolve(out,to);mkdirSync(dirname(p),{recursive:true});copyFileSync(from,p);return sha(p);}
const source={};
for(const name of scope.sources){
 const bytes=git('show','HEAD:'+name),digest=hash(bytes);
 assert.notEqual(before.sourceLF[name],digest,'Unchanged source in payload');
 const p=resolve(out,'source',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,bytes);source[name]=digest;
}
for(const name of ['manifest.json',...Object.keys(metadata.files)]){
 assert.equal(sha(resolve(folder,name)),release.files['module-dist/studio-forest-heart/versions/'+pkg.version+'/'+name]);copy(resolve(folder,name),'package/'+name);
}
for(const name of ['release-manifest.json','release-github.json'])copy(resolve(root,'module-build',name),name);
copy(resolve(task,'before.json'),'before.json');
const wrapperSha256=copy(resolve(import.meta.dirname,'publish.py'),'publish.py');
const publisherSha256=copy(resolve(root,'scripts/game-module-release.py'),'publisher.py');
assert.equal(publisherSha256,before.source['scripts/game-module-release.py'],'Production publisher differs');
const helpers=read(resolve(task,'helper-hashes.json'));
assert.equal(helpers.snapshotSha256,sha(resolve(task,'snapshot-base.py')));
const operator={sourceCommit:release.sourceCommit,source,wrapperSha256,publisherSha256,...helpers,
 releaseManifestSha256:sha(resolve(out,'release-manifest.json')),receiptSha256:sha(resolve(out,'release-github.json')),
 pointerSha256:release.files[pkg.pointer],approvedProgramEqual:true,approvedModule:approved.version};
writeFileSync(resolve(out,'operator.json'),JSON.stringify(operator,null,2)+'\n');
console.log(JSON.stringify({prepared:true,sourceCommit:release.sourceCommit,version:pkg.version,sourceFiles:Object.keys(source).length,approvedProgramEqual:true}));
