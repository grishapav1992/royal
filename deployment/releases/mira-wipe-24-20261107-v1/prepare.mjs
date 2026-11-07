import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
const root=process.cwd(),folder='deployment/releases/mira-wipe-24-20261107-v1',name='mira-wipe-24-20261107-v1';
const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
assert.equal(git('status','--porcelain').toString().trim(),'');
const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json'));
const receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit,receipt.sourceCommit);
for(const commit of [release.sourceCommit,receipt.remoteMain])git('merge-base','--is-ancestor',commit,'origin/main');
for(const [file,hash]of Object.entries(release.files))assert.equal(sha(fs.readFileSync(file)),hash,'Prepared artifact changed: '+file);
assert.equal(sha(fs.readFileSync('module-build/release-manifest.json')),receipt.manifestSha256);
assert.equal(release.baseCommit,before.sourceCommit);assert(release.clean&&release.build.passed);
assert.equal(before.container.health,'healthy');assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
const client=['src/game/Bar.ts','src/game/miraAnimation.ts','src/game/MiraRig.ts'];
const atlas='assets/royal-bar/v3/mira-wipe-24.png';
const atlasSha='8fe773f9edaecae2f25cd61a0301fc4a02f8cf4ef62835daab4073c2854e0029';
const committed=file=>git('show',release.sourceCommit+':'+file);
assert.equal(git('rev-parse','HEAD').toString().trim(),release.sourceCommit);
assert.equal(sha(committed(folder+'/host-projection.json')),release.hostProjection.sha256);
const expectedSources=Object.fromEntries(client.map(file=>[file,sha(committed(file))]));
const reader=await readHostProjection(root,folder+'/host-projection.json',{strictOrigins:true});
for(const [file,hash]of Object.entries(release.hostProjection.inputs))assert(expectedSources[file]===hash||[before.source[file],before.sourceLF[file]].includes(hash),'Unrelated input: '+file);
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'server-delta'));
function write(file,bytes){assert(!path.isAbsolute(file)&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return sha(bytes);}
const changed={},delta={};
for(const [file,hash]of Object.entries(expectedSources)){const bytes=reader.read(file);assert.equal(sha(bytes),hash);assert.equal(release.hostProjection.inputs[file],hash);changed[file]=write('source/'+file,bytes);}
for(const [file,hash]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===hash)continue;
 const n=file.slice(5);assert(n==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(n),'Foreign host artifact');
 assert(n==='index.html'||!before.program[file],'Immutable URL collision');const bytes=fs.readFileSync(file);assert.equal(sha(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);
const media=committed('public/'+atlas);
assert.equal(sha(media),atlasSha);
assert(!before.source['public/'+atlas]&&!before.program['dist/'+atlas],'Atlas path is already in use');
changed['public/'+atlas]=write('source/public/'+atlas,media);
delta[atlas]=write('dist-delta/'+atlas,media);
const references={
 'production-guard.py':'deployment/releases/skin-offers-20261105-v2/deploy.py',
 'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
 'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs':'deployment/releases/skin-offers-20261105-v2/quiesce.cjs',
 'quiesce-base.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
};
const support={};for(const [file,source]of Object.entries(references))support[file]=write(file,committed(source));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const helperSha256=write('deploy.py',committed(folder+'/deploy.py')),snapshotSha256=write('snapshot.py',committed('deployment/releases/mira-walk-24-20261107-v1/snapshot.py'));
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta:{},support,helperSha256,snapshotSha256,
 releaseManifestSha256:sha(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:sha(fs.readFileSync('module-build/release-github.json')),addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({out,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,backendFiles:0}));
