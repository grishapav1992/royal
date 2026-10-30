import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyHostProjection} from '../../../scripts/build-host-projection.mjs';

const helper=dirname(fileURLToPath(import.meta.url)),root=resolve(helper,'../../..');
const task=resolve(root,'artifacts/work/forest-heart-responsive/publication');
const out=resolve(task,'payload');
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=p=>hash(readFileSync(p));
const git=(...args)=>execFileSync('git',args,{cwd:root});
const before=read(resolve(task,'before.json'));
const release=read(resolve(root,'module-build/release-manifest.json'));
const receipt=read(resolve(root,'module-build/release-github.json'));
assert.equal(git('status','--porcelain').toString().trim(),'');
assert.equal(release.sourceCommit,git('rev-parse','HEAD').toString().trim());
assert.equal(release.sourceCommit,receipt.sourceCommit);
assert.equal(release.baseCommit,before.sourceCommit);
assert.equal(release.scope,'application');assert(release.build.passed);
assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.health,'healthy');
assert(!existsSync(out),'Payload already exists');mkdirSync(out,{recursive:true});
const host=['src/ui/GameViewport.ts','src/ui/RoyalCatalogArtwork.ts','src/ui/royal-platform.css'];
const source={},dist={};
function copy(from,to){const file=resolve(out,to);mkdirSync(dirname(file),{recursive:true});copyFileSync(from,file);return sha(file);}
function tracked(file){return git('show','HEAD:'+file);}
assert(release.hostProjection,'A reviewed production host graph is required');
const projected=await verifyHostProjection(root,release.hostProjection);
assert.equal(projected.metadata.productionCommit,before.sourceCommit);
assert.deepEqual([...projected.metadata.changedSources].sort(),[...host].sort());
for(const [file,digest] of Object.entries(release.hostProjection.inputs)){
  if(host.includes(file)){assert.equal(projected.metadata.files[file].baseSha256,before.sourceLF[file]);continue;}
  assert.equal(digest,before.sourceLF[file],'Unrelated compiled host source changed: '+file);
}
for(const file of ['package.json','package-lock.json','index.html','tsconfig.json'])assert.equal(hash(tracked(file)),before.sourceLF[file],'Dependencies or entry changed: '+file);
for(const file of [...host,...git('ls-files','-z','games/forest-heart').toString().split('\0').filter(Boolean)]){
  const bytes=host.includes(file)?projected.read(file):tracked(file),digest=hash(bytes);
  assert(before.source[file],'New source needs explicit review: '+file);
  if(before.source[file]===digest)continue;
  const target=resolve(out,'source',file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);source[file]=digest;
}
for(const file of host)assert(source[file],'Required host change is missing: '+file);
for(const [name,digest] of Object.entries(release.files)){
  if(!name.startsWith('dist/'))continue;
  const sub=name.slice(5);
  if(sub!=='index.html'&&!/^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(sub))continue;
  if(sub==='admin.html'||/^assets\/admin-/.test(sub)||before.program[name]===digest)continue;
  assert.equal(sha(resolve(root,name)),digest);dist[sub]=copy(resolve(root,name),'dist-delta/'+sub);
}
assert(dist['index.html']);
for(const asset of ['assets/forest-heart/v1/background.webp','assets/forest-heart/v3/elf-idle.webp']){
  assert.equal(sha(resolve(root,'public',asset)),before.program['dist/'+asset],'Catalogue asset missing or different in production: '+asset);
}
const pkg=release.packages.find(p=>p.gameId==='studio-forest-heart');assert(pkg);
const pointer=read(resolve(root,pkg.pointer));
const folder=resolve(root,'module-dist/studio-forest-heart/versions/'+pkg.version);
const metadata=read(resolve(folder,'manifest.json'));
assert.deepEqual(Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(n=>[n,metadata[n]])),{apiVersion:1,rulesVersion:1,progressVersion:1});
for(const name of ['manifest.json',...Object.keys(metadata.files)]){
  const from=resolve(folder,name);assert.equal(sha(from),release.files['module-dist/studio-forest-heart/versions/'+pkg.version+'/'+name]);copy(from,'package/'+name);
}
for(const name of ['release-manifest.json','release-github.json'])copy(resolve(root,'module-build',name),name);
copy(resolve(task,'before.json'),'before.json');
const guardSha256=copy(resolve(helper,'guard.py'),'guard.py');
const publisherBytes=tracked('scripts/game-module-release.py');
const publisherSha256=hash(publisherBytes);assert.equal(publisherSha256,before.source['scripts/game-module-release.py'],'Live publisher changed');
writeFileSync(resolve(out,'publisher.py'),publisherBytes);
const operator={release:'forest-heart-responsive-20261030-v1',sourceCommit:release.sourceCommit,source,dist,guardSha256,publisherSha256,
  releaseManifestSha256:sha(resolve(out,'release-manifest.json')),receiptSha256:sha(resolve(out,'release-github.json')),
  beforePointerSha256:before.moduleFiles['studio-forest-heart/active.json'],pointerSha256:release.files[pkg.pointer],moduleVersion:pkg.version};
assert.equal(pointer.sha256,sha(resolve(out,'package/manifest.json')));
writeFileSync(resolve(out,'operator.json'),JSON.stringify(operator,null,2)+'\n');
console.log(JSON.stringify({prepared:true,sourceCommit:release.sourceCommit,moduleVersion:pkg.version,sourceFiles:Object.keys(source).length,clientFiles:Object.keys(dist).length}));
