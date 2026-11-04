import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
const root=process.cwd(),folder='deployment/releases/front-back-walk-20261104-v1',name='front-back-walk-20261104-v1';
const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const preparedBefore=process.argv[5]?JSON.parse(fs.readFileSync(process.argv[5],'utf8')):before;
const runtimeAdvance=process.argv[6]?JSON.parse(fs.readFileSync(process.argv[6],'utf8')):null;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
assert.equal(git('status','--porcelain').toString().trim(),'');
const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json'));
const receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
const installerCommit=process.argv[4]||git('rev-parse','HEAD').toString().trim();assert(/^[a-f0-9]{40}$/.test(installerCommit));
assert.equal(release.sourceCommit,receipt.sourceCommit);
for(const commit of [release.sourceCommit,installerCommit,receipt.remoteMain])git('merge-base','--is-ancestor',commit,'origin/main');
const installerParent=git('rev-parse',installerCommit+'^').toString().trim();
const installerChanges=git('diff','--name-only',installerParent,installerCommit).toString().trim().split('\n').filter(Boolean);
assert(installerChanges.length&&installerChanges.every(name=>name.startsWith(folder+'/')),'Installer revision may change only its own tooling');
assert.equal(sha(git('show',installerCommit+':'+folder+'/host-projection.json')),release.hostProjection.sha256,'Prepared projection changed');
for(const name of ['prepare.mjs','scope.json','deploy.py','snapshot.py'])assert.equal(sha(git('show','HEAD:'+folder+'/'+name)),sha(git('show',installerCommit+':'+folder+'/'+name)),'Installer working source differs');
for(const [file,hash]of Object.entries(release.files))assert.equal(sha(fs.readFileSync(file)),hash,'Prepared artifact changed: '+file);
assert.equal(sha(fs.readFileSync('module-build/release-manifest.json')),receipt.manifestSha256);
assert.equal(release.baseCommit,preparedBefore.sourceCommit);assert(release.clean&&release.build.passed);
assert.equal(before.container.health,'healthy');assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
const scope=JSON.parse(fs.readFileSync(folder+'/scope.json'));
if(before.sourceCommit!==preparedBefore.sourceCommit){
 assert(runtimeAdvance);const allowed=scope.allowedRuntimeAdvance;assert.equal(runtimeAdvance.release,'star-spin-open-selection-20261104-v1');assert.equal(runtimeAdvance.release,allowed.release);
 for(const key of ['sourceCommit','sourceChanges','serverDelta','moduleFiles'])assert.deepEqual(runtimeAdvance[key],allowed[key]);
 git('merge-base','--is-ancestor',runtimeAdvance.sourceCommit,'origin/main');
 assert.equal(before.sourceCommit,runtimeAdvance.sourceCommit);assert.equal(before.sourceRevision,before.sourceCommit);assert.equal(before.container.image,runtimeAdvance.image);
 assert.deepEqual(Object.keys(runtimeAdvance.serverDelta),['index.js']);
 for(const key of ['runtimeHash','mounts','host','composeFiles'])assert.deepEqual(before.container[key],preparedBefore.container[key]);
 assert.equal(before.serviceProfiles['royal-game-1'].profileSha256,preparedBefore.serviceProfiles['royal-game-1'].profileSha256);
 const expected=structuredClone(preparedBefore),actual=structuredClone(before);
 for(const key of ['source','sourceLF'])Object.assign(expected[key],runtimeAdvance.sourceChanges);
 for(const key of ['program','preparedProgram'])Object.assign(expected[key],Object.fromEntries(Object.entries(runtimeAdvance.serverDelta).map(([name,hash])=>['dist-server/'+name,hash])));
 Object.assign(expected.moduleFiles,runtimeAdvance.moduleFiles);
 for(const key of ['sourceCommit','sourceRevision','container','preparedImage'])expected[key]=actual[key];
 expected.services['/royal-game-1']=actual.services['/royal-game-1'];expected.serviceProfiles['royal-game-1']=actual.serviceProfiles['royal-game-1'];
 for(const key of ['at','availableBytes']){delete expected[key];delete actual[key];}assert.deepEqual(actual,expected,'Unrelated concurrent runtime change');
}
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
const scopeSha256=write('scope.json',installerSource(folder+'/scope.json'));
const helperReceipt={format:1,sourceCommit:installerCommit,parentCommit:installerParent,applicationSourceCommit:release.sourceCommit,remoteMain:git('rev-parse','origin/main').toString().trim(),checkedAt:new Date().toISOString(),changedOnlyReleaseTooling:installerChanges};
const helperReceiptSha256=write('installer-github.json',Buffer.from(JSON.stringify(helperReceipt,null,2)+'\n'));
const helperSha256=write('deploy.py',installerSource(folder+'/deploy.py')),snapshotSha256=write('snapshot.py',installerSource(folder+'/snapshot.py'));
const manifest={release:name,sourceCommit:release.sourceCommit,helperSourceCommit:installerCommit,helperReceiptSha256,scopeSha256,baseCommit:before.sourceCommit,before,preparedBefore,runtimeAdvance,changed,delta,serverDelta:{},support,helperSha256,snapshotSha256,
 releaseManifestSha256:sha(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:sha(fs.readFileSync('module-build/release-github.json')),addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({out,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,backendFiles:0}));


