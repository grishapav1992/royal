import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertClean,verifyRelease} from '../../../scripts/release.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
const root=process.cwd(),folder='deployment/releases/manual-stakes-20261104-v1',name='manual-stakes-20261104-v1';
const [beforeFile,publishedFile,outPath]=process.argv.slice(2);assert(beforeFile&&publishedFile&&outPath);
await assertClean(root);const release=await verifyRelease(root),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
const before=JSON.parse(fs.readFileSync(beforeFile)),published=JSON.parse(fs.readFileSync(publishedFile)),scope=JSON.parse(fs.readFileSync(folder+'/scope.json'));
assert.equal(release.scope,'application');assert.equal(release.baseCommit,before.sourceCommit);assert.equal(release.sourceCommit,receipt.sourceCommit);
assert.equal(release.sourceCommit,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());
const host=await readHostProjection(root,folder+'/host-projection.json',{strictOrigins:true}),backend=await readHostProjection(root,folder+'/backend-projection.json',{strictOrigins:true});
assert.equal(release.hostProjection.sha256,host.sha256);assert.equal(release.backendProjection.sha256,backend.sha256);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),out=path.resolve(outPath);
assert(!fs.existsSync(out),'Task payload already exists');fs.mkdirSync(out,{recursive:true});const payload={};
function write(file,bytes){assert(!path.isAbsolute(file)&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const destination=path.join(out,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{flag:'wx'});return payload[file]=hash(bytes);}
function link(file,source,expected){const bytes=fs.readFileSync(source);assert.equal(hash(bytes),expected);const destination=path.join(out,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.linkSync(source,destination);payload[file]=expected;}
const changed={};
for(const [file,digest]of Object.entries(scope.expectedSources)){
  const bytes=(host.metadata.files[file]?host:backend).read(file);assert.equal(hash(bytes),digest);changed[file]=write('source/'+file,bytes);
}
for(const [file,digest]of Object.entries(scope.evidenceSources)){
  const origin=scope.evidenceOrigins?.[file]??{commit:release.sourceCommit,path:file};
  assert.equal(origin.path,file);assert(/^[a-f0-9]{40}$/.test(origin.commit));
  execFileSync('git',['merge-base','--is-ancestor',origin.commit,release.sourceCommit]);
  const bytes=execFileSync('git',['show',origin.commit+':'+origin.path],{maxBuffer:64*1024**2});assert.equal(hash(bytes),digest);changed[file]=write('source/'+file,bytes);
}
const delta={},serverDelta={};
for(const [file,digest]of Object.entries(release.files))if(file.startsWith('dist/')&&before.program[file]!==digest){const relative=file.slice(5);assert(relative==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(relative));delta[relative]=write('dist-delta/'+relative,fs.readFileSync(file));assert.equal(delta[relative],digest);}
assert(delta['index.html']);serverDelta['index.js']=write('server-delta/index.js',fs.readFileSync('dist-server/index.js'));assert.equal(serverDelta['index.js'],release.files['dist-server/index.js']);
const packages={};
for(const [game,row]of Object.entries(release.build.moduleProjection.modules)){
  const pointerPath='module-dist/'+game+'/active.json',pointer=JSON.parse(fs.readFileSync(pointerPath)),manifest=JSON.parse(fs.readFileSync(row.manifestPath));
  const contract=Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(key=>[key,manifest[key]]));assert.deepEqual(contract,before.moduleHost.games[game]);
  const prior=published[game];assert(prior);assert.equal(prior.pointerSha256,before.moduleFiles['/opt/royal-game-modules/'+game+'/active.json']);
  const files={'manifest.json':hash(fs.readFileSync(row.manifestPath)),...manifest.files};
  const previousFiles={'manifest.json':prior.pointer.sha256,...prior.manifest.files};
  packages[game]={version:manifest.version,contract,files,pointerSha256:release.files[pointerPath],previousPointerSha256:prior.pointerSha256,previousVersion:prior.manifest.version,previousFiles};
  const prefix='module-dist/'+game+'/versions/'+manifest.version+'/';
  for(const [file,digest]of Object.entries(files)){assert.equal(release.files[prefix+file],digest);link('packages/'+game+'/'+file,prefix+file,digest);}
  assert.equal(write('pointers/'+game+'.json',fs.readFileSync(pointerPath)),release.files[pointerPath]);
}
assert.deepEqual(Object.keys(packages).sort(),scope.activeGames.filter(game=>game!=='tsu-e-fa').sort());
const references={
  'application-overlay.py':'deployment/releases/lobby-connection-20261101-v1/deploy.py',
  'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
  'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
  'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
  'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
  'publisher.py':'scripts/game-module-release.py',
};
const support={};for(const [file,source]of Object.entries(references))support[file]=write(file,execFileSync('git',['show',release.sourceCommit+':'+source],{maxBuffer:64*1024**2}));
assert.equal(support['publisher.py'],before.source['scripts/game-module-release.py']);
for(const file of ['scope.json','production-round-compatibility.json'])write(file,fs.readFileSync(folder+'/'+file));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const helperSha256=write('deploy.py',fs.readFileSync(folder+'/deploy.py')),snapshotSha256=write('snapshot.py',fs.readFileSync(folder+'/snapshot.py'));
const install={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta,packages,support,payload,
  helperSha256,snapshotSha256,releaseManifestSha256:payload['release-manifest.json'],receiptSha256:payload['release-github.json'],
  compatibilitySha256:payload['production-round-compatibility.json'],activeGames:scope.activeGames,addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(install,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,modules:Object.keys(packages).length,clientFiles:Object.keys(delta).length}));
