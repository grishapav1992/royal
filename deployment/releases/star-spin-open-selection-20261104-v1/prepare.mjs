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
const installerCommit=process.argv[4]||git('rev-parse','HEAD').toString().trim();
assert(/^[a-f0-9]{40}$/.test(installerCommit));
assert.equal(release.sourceCommit,receipt.sourceCommit);
for(const commit of [release.sourceCommit,installerCommit,receipt.remoteMain])git('merge-base','--is-ancestor',commit,'origin/main');
const installerParent=git('rev-parse',installerCommit+'^').toString().trim();
const installerChanges=git('diff','--name-only',installerParent,installerCommit).toString().trim().split('\n').filter(Boolean);
assert(installerChanges.every(n=>n.startsWith(folder+'/')),'Installer revision may change only its own release tooling');
for(const n of ['host-projection.json','backend-projection.json'])assert.equal(sha(git('show',installerCommit+':'+folder+'/'+n)),release[n==='host-projection.json'?'hostProjection':'backendProjection'].sha256,'Build projection changed after preparation');
for(const n of ['prepare.mjs','scope.json','deploy.py','snapshot.py'])assert.equal(sha(git('show','HEAD:'+folder+'/'+n)),sha(git('show',installerCommit+':'+folder+'/'+n)),'Installer working source differs');
for(const [file,hash]of Object.entries(release.files))assert.equal(sha(fs.readFileSync(file)),hash,'Prepared artifact changed: '+file);
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
const installerSource=file=>git('show',installerCommit+':'+file);
const moduleConfig=git('show',scope.selectionSourceCommit+':tsconfig.json');
const baselineOrigin=release.backendProjection.origins['tsconfig.json'];
assert(!baselineOrigin.patches?.length);
const baselineConfig=git('show',baselineOrigin.commit+':'+baselineOrigin.path);
const expectedConfig=JSON.parse(baselineConfig);expectedConfig.compilerOptions.resolveJsonModule=true;
assert.deepEqual(JSON.parse(moduleConfig),expectedConfig);
assert.equal(sha(baselineConfig),before.sourceLF['tsconfig.json']);assert.equal(sha(moduleConfig),scope.moduleBuildInputs['tsconfig.json']);
const moduleBuildConfiguration={baselineSha256:write('baseline-tsconfig.json',baselineConfig),selectedSha256:write('module-tsconfig.json',moduleConfig)};
const changed={};
for(const [file,hash]of Object.entries(scope.expectedSources)){const bytes=git('show',scope.selectionSourceCommit+':'+file);assert.equal(sha(bytes),hash);changed[file]=write('source/'+file,bytes);}
assert.equal(release.backendProjection.inputs['server/starSpinCollection.ts'],changed['server/starSpinCollection.ts']);
const backend=fs.readFileSync('dist-server/index.js');assert.equal(sha(backend),release.files['dist-server/index.js']);
const serverDelta={'index.js':write('server-delta/index.js',backend)};
const target=scope.module,prefix='module-dist/'+target.gameId+'/versions/'+target.version+'/';
const previous=JSON.parse(fs.readFileSync('artifacts/work/star-spin-open-selection-20261104/previous-active.json'));
assert.equal(sha(fs.readFileSync('artifacts/work/star-spin-open-selection-20261104/previous-active.json')),before.moduleFiles['/opt/royal-game-modules/'+target.gameId+'/active.json']);
const previousVersion=previous.manifest.split('/').at(-2);assert(/^[a-zA-Z0-9_.-]+$/.test(previousVersion));
assert.equal(previous.sha256,before.moduleFiles['/opt/royal-game-modules/'+target.gameId+'/versions/'+previousVersion+'/manifest.json']);
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
const scopeSha256=write('scope.json',installerSource(folder+'/scope.json'));
const helperReceipt={format:1,sourceCommit:installerCommit,parentCommit:installerParent,applicationSourceCommit:release.sourceCommit,remoteMain:git('rev-parse','origin/main').toString().trim(),checkedAt:new Date().toISOString(),changedOnlyReleaseTooling:installerChanges};
const helperReceiptSha256=write('installer-github.json',Buffer.from(JSON.stringify(helperReceipt,null,2)+'\n'));
const helperSha256=write('deploy.py',installerSource(folder+'/deploy.py')),snapshotSha256=write('snapshot.py',installerSource(folder+'/snapshot.py'));
const manifest={release:scope.name,sourceCommit:release.sourceCommit,helperSourceCommit:installerCommit,helperReceiptSha256,scopeSha256,moduleBuildConfiguration,baseCommit:before.sourceCommit,before,changed,delta:{},serverDelta,support,helperSha256,snapshotSha256,previousVersion,
 package:{version:target.version,contract:target.contract,files,manifestSha256:target.manifestSha256,pointerSha256:target.pointerSha256},
 releaseManifestSha256:sha(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:sha(fs.readFileSync('module-build/release-github.json')),addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({out,sourceFiles:Object.keys(changed).length,clientFiles:0,backendFiles:1,moduleFiles:Object.keys(files).length}));
