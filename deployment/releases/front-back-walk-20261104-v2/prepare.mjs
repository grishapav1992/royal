import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
const root=process.cwd(),folder='deployment/releases/front-back-walk-20261104-v2',name='front-back-walk-20261104-v2';
const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
assert.equal(git('status','--porcelain').toString().trim(),'');
const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json'));
const receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
const installerCommit=process.argv[4]||release.sourceCommit;
assert(/^[a-f0-9]{40}$/.test(installerCommit));
assert.equal(release.sourceCommit,receipt.sourceCommit);
for(const commit of [release.sourceCommit,receipt.remoteMain,installerCommit])git('merge-base','--is-ancestor',commit,'origin/main');
const installerParent=git('rev-parse',installerCommit+'^').toString().trim();
const installerChanges=git('diff','--name-only',installerParent,installerCommit).toString().trim().split('\n').filter(Boolean);
if(installerCommit!==release.sourceCommit)assert(installerChanges.length&&installerChanges.every(name=>name.startsWith(folder+'/')),'Installer revision changed application sources');
assert.equal(sha(git('show',installerCommit+':'+folder+'/host-projection.json')),release.hostProjection.sha256,'Build projection changed after preparation');
for(const [file,hash]of Object.entries(release.files))assert.equal(sha(fs.readFileSync(file)),hash,'Prepared artifact changed: '+file);
assert.equal(sha(fs.readFileSync('module-build/release-manifest.json')),receipt.manifestSha256);
assert.equal(release.baseCommit,before.sourceCommit);assert(release.clean&&release.build.passed);
assert.equal(before.container.health,'healthy');assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
const scope=JSON.parse(fs.readFileSync(folder+'/scope.json'));
const reader=await readHostProjection(root,folder+'/host-projection.json',{strictOrigins:true});
for(const [file,hash]of Object.entries(release.hostProjection.inputs))assert(scope.expectedSources[file]===hash||[before.source[file],before.sourceLF[file]].includes(hash),'Unrelated input: '+file);
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'server-delta'));
function write(file,bytes){assert(!path.isAbsolute(file)&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return sha(bytes);}
const changed={},delta={};
for(const [file,hash]of Object.entries(scope.expectedSources)){const bytes=reader.read(file);assert.equal(sha(bytes),hash);assert.equal(release.hostProjection.inputs[file],hash);changed[file]=write('source/'+file,bytes);}
for(const [file,hash]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===hash)continue;
 const n=file.slice(5);assert(n==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(n),'Foreign host artifact');
 assert(n==='index.html'||!before.program[file],'Immutable URL collision');const bytes=fs.readFileSync(file);assert.equal(sha(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);
const references={
 'application-overlay.py':'deployment/releases/lobby-connection-20261101-v1/deploy.py',
 'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
 'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
};
const committed=file=>git('show',release.sourceCommit+':'+file);
const support={};for(const [file,source]of Object.entries(references))support[file]=write(file,committed(source));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const installerSource=file=>git('show',installerCommit+':'+file);
const helperReceipt={format:1,sourceCommit:installerCommit,parentCommit:installerParent,applicationSourceCommit:release.sourceCommit,packagerSourceCommit:git('rev-parse','HEAD').toString().trim(),remoteMain:git('rev-parse','origin/main').toString().trim(),checkedAt:new Date().toISOString(),changedOnlyReleaseTooling:installerChanges};
const helperReceiptSha256=write('installer-github.json',Buffer.from(JSON.stringify(helperReceipt,null,2)+'\n'));
const helperSha256=write('deploy.py',installerSource(folder+'/deploy.py')),snapshotSha256=write('snapshot.py',installerSource(folder+'/snapshot.py'));
const manifest={release:name,sourceCommit:release.sourceCommit,helperSourceCommit:installerCommit,helperReceiptSha256,baseCommit:before.sourceCommit,before,changed,delta,serverDelta:{},support,helperSha256,snapshotSha256,
 releaseManifestSha256:sha(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:sha(fs.readFileSync('module-build/release-github.json')),addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({out,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,backendFiles:0}));


