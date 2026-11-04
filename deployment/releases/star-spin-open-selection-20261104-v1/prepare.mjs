import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const folder='deployment/releases/star-spin-open-selection-20261104-v1';
const before=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
const scope=JSON.parse(fs.readFileSync(folder+'/scope.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
assert.equal(git('status','--porcelain').toString().trim(),'');
const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json'));
const receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit,git('rev-parse','HEAD').toString().trim());
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(receipt.remoteMain,git('rev-parse','origin/main').toString().trim());
assert.equal(sha(fs.readFileSync('module-build/release-manifest.json')),receipt.manifestSha256);
assert.equal(release.baseCommit,before.sourceCommit);assert(release.clean&&release.build.passed);
assert.equal(before.container.health,'healthy');assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
assert.equal(before.program['dist-server/index.js'],scope.baselineBackendSha256);
for(const [key,preserved]of [['hostProjection',{}],['backendProjection',scope.preservedBackendInputs]]){
 const graph=release[key];assert.deepEqual(graph,release.build[key]);assert.equal(graph.productionCommit,before.sourceCommit);
 for(const [file,hash]of Object.entries(graph.inputs))assert((preserved[file]||scope.expectedSources[file]||before.source[file])===hash||before.sourceLF[file]===hash,'Unrelated input: '+file);
}
for(const [file,hash]of Object.entries(release.files))if(file.startsWith('dist/'))assert.equal(before.program[file],hash,'Host would change: '+file);
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'dist-delta'));
function write(file,bytes){assert(!path.isAbsolute(file)&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return sha(bytes);}
const committed=file=>git('show',release.sourceCommit+':'+file);
const changed={};
for(const [file,hash]of Object.entries(scope.expectedSources)){const bytes=git('show',scope.selectionSourceCommit+':'+file);assert.equal(sha(bytes),hash);changed[file]=write('source/'+file,bytes);}
assert.equal(release.backendProjection.inputs['server/starSpinCollection.ts'],changed['server/starSpinCollection.ts']);
const backend=fs.readFileSync('dist-server/index.js');assert.equal(sha(backend),release.files['dist-server/index.js']);
const serverDelta={'index.js':write('server-delta/index.js',backend)};
const target=scope.module,prefix='module-dist/'+target.gameId+'/versions/'+target.version+'/';
const files={};for(const [file,hash]of Object.entries(release.files))if(file.startsWith(prefix)){
 const bytes=fs.readFileSync(file);assert.equal(sha(bytes),hash);files[file.slice(prefix.length)]=write('package/'+file.slice(prefix.length),bytes);
}
assert.equal(files['manifest.json'],target.manifestSha256);assert(Object.keys(files).length>1);
const pointer=fs.readFileSync('module-dist/'+target.gameId+'/active.json');assert.equal(sha(pointer),target.pointerSha256);write('active.json',pointer);
assert.deepEqual(before.moduleHost.games[target.gameId],target.contract);
const references={
 'application-overlay.py':'deployment/releases/lobby-connection-20261101-v1/deploy.py',
 'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
 'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
 'publisher.py':'scripts/game-module-release.py',
};
const support={};for(const [file,source]of Object.entries(references))support[file]=write(file,committed(source));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
write('scope.json',committed(folder+'/scope.json'));
const helperSha256=write('deploy.py',committed(folder+'/deploy.py')),snapshotSha256=write('snapshot.py',committed(folder+'/snapshot.py'));
const manifest={release:scope.name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta:{},serverDelta,support,helperSha256,snapshotSha256,
 package:{version:target.version,contract:target.contract,files,manifestSha256:target.manifestSha256,pointerSha256:target.pointerSha256},
 releaseManifestSha256:sha(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:sha(fs.readFileSync('module-build/release-github.json')),addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({out,sourceFiles:Object.keys(changed).length,clientFiles:0,backendFiles:1,moduleFiles:Object.keys(files).length}));
