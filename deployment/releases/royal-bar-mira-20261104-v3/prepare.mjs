import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
import {assertClean,git} from '../../../scripts/release.mjs';
const root=process.cwd(),folder='deployment/releases/royal-bar-mira-20261104-v3';
const name='royal-bar-mira-20261104-v3',sources=JSON.parse(fs.readFileSync(path.join(folder,'scope.json'))).changedSources;
const before=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
const scope=JSON.parse(fs.readFileSync(path.join(folder,'scope.json')));
await assertClean(root);const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json')),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
const installerCommit=process.argv[4];assert(/^[a-f0-9]{40}$/.test(installerCommit));
assert.equal(release.sourceCommit,receipt.sourceCommit);
for(const commit of [release.sourceCommit,receipt.remoteMain,installerCommit])git(root,['merge-base','--is-ancestor',commit,'origin/main']);
const installerParent=git(root,['rev-parse',installerCommit+'^']);
const installerChanges=git(root,['diff','--name-only',installerParent,installerCommit]).split('\n').filter(Boolean);
assert(installerChanges.length&&installerChanges.every(name=>name.startsWith(folder+'/')),'Installer revision changed application sources');
const committed=(commit,file)=>execFileSync('git',['show',commit+':'+file],{cwd:root,maxBuffer:64*1024**2});
for(const kind of ['hostProjection','backendProjection'])assert.equal(digest(committed(installerCommit,folder+'/'+(kind==='hostProjection'?'host':'backend')+'-projection.json')),release[kind].sha256,'Build projection changed');
for(const [file,hash]of Object.entries(release.files))assert.equal(digest(fs.readFileSync(file)),hash,'Prepared artifact changed: '+file);
assert.equal(digest(fs.readFileSync('module-build/release-manifest.json')),receipt.manifestSha256);
assert(release.clean&&release.build.passed);
assert.equal(release.baseCommit,before.sourceCommit);assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);
const reader=await readHostProjection(root,path.relative(root,path.join(folder,'host-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const backend=await readHostProjection(root,path.relative(root,path.join(folder,'backend-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const preservedBackendInputs=scope.preservedBackendInputs;
for(const projection of [release.hostProjection,release.backendProjection])for(const [file,hash]of Object.entries(projection.inputs))assert(projection===release.backendProjection&&preservedBackendInputs[file]===hash||scope.expectedSources[file]===hash||[before.source[file],before.sourceLF[file]].includes(hash),'Unrelated build input: '+file);
if(fs.existsSync(out))assert(!fs.existsSync(path.join(out,'install-manifest.json')),'Complete payload is immutable');
fs.mkdirSync(out,{recursive:true});
function write(name,bytes){const p=path.join(out,name);fs.mkdirSync(path.dirname(p),{recursive:true});if(fs.existsSync(p)){assert(fs.lstatSync(p).isFile()&&!fs.lstatSync(p).isSymbolicLink());assert.equal(digest(fs.readFileSync(p)),digest(bytes),'Partial payload bytes changed');}else fs.writeFileSync(p,bytes,{flag:'wx'});return digest(bytes);}
const changed={},delta={},serverDelta={};
for(const source of sources){
 const media=source.startsWith('public/'),selected=source.startsWith('server/')?backend:reader,projection=source.startsWith('server/')?release.backendProjection:release.hostProjection;
 const bytes=media?committed(release.sourceCommit,source):selected.read(source);changed[source]=write('source/'+source,bytes);assert.equal(changed[source],scope.expectedSources[source]);if(!media)assert.equal(projection.inputs[source],changed[source]);
}
for(const [file,hash]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===hash)continue;
 const n=file.slice(5);if(!scope.mediaSources.includes('public/'+n)&&n!=='index.html'&&!/^assets\/[\w-]+\.(js|css)$/.test(n))continue;
 assert(n==='index.html'||!before.program[file],'Immutable asset collision');const bytes=fs.readFileSync(file);assert.equal(digest(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);
// Projected Vite builds deliberately disable publicDir. PNG files are uncompiled
// Git source bytes, bound separately to this same pushed application commit.
const mediaOrigins={};
for(const name of scope.mediaSources){
 const bytes=committed(release.sourceCommit,name),hash=digest(bytes);
 assert.equal(hash,scope.expectedSources[name]);assert.equal(hash,changed[name]);
 assert.equal(execFileSync('git',['ls-tree',release.sourceCommit,'--',name],{encoding:'utf8'}).split(' ')[0],'100644');
 delta[name.slice(7)]=write('dist-delta/'+name.slice(7),bytes);mediaOrigins[name]=hash;
}
const mediaReceipt={sourceCommit:release.sourceCommit,remoteMain:git(root,['rev-parse','origin/main']),assets:mediaOrigins};
const mediaReceiptSha256=write('media-github.json',Buffer.from(JSON.stringify(mediaReceipt,null,2)+'\n'));
const serverBytes=fs.readFileSync('dist-server/index.js');serverDelta['index.js']=write('server-delta/index.js',serverBytes);assert.equal(serverDelta['index.js'],release.backendProjection.output.sha256);assert.equal(serverDelta['index.js'],release.files['dist-server/index.js']);
const references={
 'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
 'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
};
const support={};for(const [name,file]of Object.entries(references))support[name]=write(name,committed(release.sourceCommit,file));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const helperReceipt={format:1,sourceCommit:installerCommit,parentCommit:installerParent,applicationSourceCommit:release.sourceCommit,packagerSourceCommit:git(root,['rev-parse','HEAD']),remoteMain:git(root,['rev-parse','origin/main']),checkedAt:new Date().toISOString(),changedOnlyReleaseTooling:installerChanges};
const helperReceiptSha256=write('installer-github.json',Buffer.from(JSON.stringify(helperReceipt,null,2)+'\n'));
const helperSha256=write('deploy.py',committed(installerCommit,folder+'/deploy.py')),snapshotSha256=write('snapshot.py',committed(installerCommit,folder+'/snapshot.py'));
const manifest={release:name,sourceCommit:release.sourceCommit,helperSourceCommit:installerCommit,helperReceiptSha256,mediaReceiptSha256,baseCommit:before.sourceCommit,before,changed,delta,serverDelta,support,helperSha256,snapshotSha256,
 releaseManifestSha256:digest(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:digest(fs.readFileSync('module-build/release-github.json')),addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:sources.length,clientFiles:Object.keys(delta).length,clientBytes:Object.keys(delta).reduce((n,f)=>n+fs.statSync(path.join(out,'dist-delta',f)).size,0),out}));
