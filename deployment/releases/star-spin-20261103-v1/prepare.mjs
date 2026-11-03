import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
import {verifyRelease,assertClean,git} from '../../../scripts/release.mjs';
const root=process.cwd(),folder=path.dirname(fileURLToPath(import.meta.url)),name='star-spin-20261103-v1';
const before=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
const scope=JSON.parse(fs.readFileSync(path.join(folder,'scope.json')));
await assertClean(root);
const release=await verifyRelease(root),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(receipt.remoteMain,git(root,['rev-parse','origin/main']));
assert.equal(release.baseCommit,before.sourceCommit);assert.deepEqual(before.program,before.preparedProgram);
assert.equal(before.container.image,before.preparedImage);assert.equal(before.container.health,'healthy');
const host=await readHostProjection(root,path.relative(root,path.join(folder,'host-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const backend=await readHostProjection(root,path.relative(root,path.join(folder,'backend-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const modules=release.build.moduleProjection;assert(modules);assert.deepEqual(Object.keys(modules.modules),['studio-wild-nudge']);
for(const graph of [release.hostProjection,release.backendProjection,modules])for(const [file,hash]of Object.entries(graph.inputs)){
  assert(scope.expectedSources[file]===hash||[before.source[file],before.sourceLF[file]].includes(hash)||graph===release.backendProjection&&scope.preservedBackendInputs[file]===hash,'Unrelated input: '+file);
}
const policy=JSON.parse(fs.readFileSync('scripts/game-math/rtp-policy.json'));
for(const rules of [policy.profiles['studio-wild-nudge'],...Object.values(policy.versionProfiles['studio-wild-nudge'])]){
  const proof=JSON.parse(fs.readFileSync(rules.proof));
  for(const [file,hash]of Object.entries(proof.sourceHashes))if(release.backendProjection.inputs[file])assert.equal(release.backendProjection.inputs[file],hash,'Unqualified monetary input: '+file);
}
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});const payload={};
function write(file,bytes){assert(!path.isAbsolute(file)&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return payload[file]=digest(bytes);}
const committed=file=>execFileSync('git',['show',release.sourceCommit+':'+file],{cwd:root,maxBuffer:64*1024**2});
const changed={},delta={},serverDelta={};
for(const [file,hash]of Object.entries(scope.expectedSources)){
  const bytes=file.startsWith('public/')?committed(file):host.read(file);assert.equal(digest(bytes),hash);
  changed[file]=write('source/'+file,bytes);
}
for(const [file,hash]of Object.entries(release.files)){
  if(!file.startsWith('dist/')||before.program[file]===hash)continue;
  const n=file.slice(5);assert(n==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(n),'Foreign host artifact');
  assert(n==='index.html'||!before.program[file],'Immutable URL collision');
  const bytes=fs.readFileSync(file);assert.equal(digest(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);
const serverBytes=fs.readFileSync('dist-server/index.js');serverDelta['index.js']=write('server-delta/index.js',serverBytes);
assert.equal(serverDelta['index.js'],release.backendProjection.output.sha256);
const p=modules.modules['studio-wild-nudge'],meta=JSON.parse(fs.readFileSync(p.manifestPath));
const contract=Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,meta[k]]));
assert.deepEqual(contract,{apiVersion:1,rulesVersion:2,progressVersion:1});assert(!before.moduleHost.games['studio-wild-nudge']);
const files={'manifest.json':digest(fs.readFileSync(p.manifestPath)),...meta.files};
for(const [file,hash]of Object.entries(files)){
  const source='module-dist/studio-wild-nudge/versions/'+meta.version+'/'+file,bytes=fs.readFileSync(source);
  assert.equal(digest(bytes),hash);assert.equal(release.files[source],hash);write('package/'+file,bytes);
}
const pointer=fs.readFileSync('module-dist/studio-wild-nudge/active.json');
assert.equal(digest(pointer),release.files['module-dist/studio-wild-nudge/active.json']);
const nextHost=structuredClone(before.moduleHost);nextHost.games['studio-wild-nudge']=contract;
const hostContractSha256=write('host.json',Buffer.from(JSON.stringify(nextHost,null,2)+'\n'));
const packageInfo={version:meta.version,contract,files,pointerSha256:write('active.json',pointer)};
const references={
  'application-overlay.py':'deployment/releases/hall-elevator-20261101-v1/deploy.py',
  'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
  'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
  'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
  'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
  'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
  'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
  'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
  'publisher.py':'scripts/game-module-release.py'
};
const support={};for(const [file,source]of Object.entries(references))support[file]=write(file,committed(source));
assert.equal(support['publisher.py'],before.source['scripts/game-module-release.py']);
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const releaseFolder=path.relative(root,folder).replaceAll('\\','/');
const helperSha256=write('deploy.py',committed(releaseFolder+'/deploy.py')),snapshotSha256=write('snapshot.py',committed(releaseFolder+'/snapshot.py'));
write('scope.json',committed(releaseFolder+'/scope.json'));
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta,support,helperSha256,snapshotSha256,payload,package:packageInfo,hostContractSha256,
  releaseManifestSha256:payload['release-manifest.json'],receiptSha256:payload['release-github.json'],addedGames:['studio-wild-nudge'],restoredGames:[],activeGames:scope.activeGames};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,clientFiles:Object.keys(delta).length,package:meta.version,out}));
