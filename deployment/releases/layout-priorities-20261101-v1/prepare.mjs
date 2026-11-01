import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
import {verifyRelease,assertClean,git} from '../../../scripts/release.mjs';
const root=process.cwd(),folder=path.dirname(fileURLToPath(import.meta.url)),name='layout-priorities-20261101-v1';
const before=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
await assertClean(root);
const release=await verifyRelease(root),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
const scope=JSON.parse(fs.readFileSync(path.join(folder,'scope.json')));
assert.equal(release.scope,'application');assert.equal(release.sourceCommit,receipt.sourceCommit);
assert.equal(receipt.remoteMain,git(root,['rev-parse','origin/main']));assert.equal(release.baseCommit,before.sourceCommit);
assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);
assert.equal(before.container.health,'healthy');assert(before.availableBytes>5*1024**3);
const reader=await readHostProjection(root,path.relative(root,path.join(folder,'host-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const moduleReport=release.build.moduleProjection;assert(moduleReport);
assert.equal(release.hostProjection.productionCommit,before.sourceCommit);
const inputs={};
for(const graph of [release.hostProjection.inputs,moduleReport.inputs])for(const [file,hash]of Object.entries(graph)){
 assert(!inputs[file]||inputs[file]===hash,'Mixed source: '+file);inputs[file]=hash;
 assert(scope.expectedSources[file]===hash||[before.source[file],before.sourceLF[file]].includes(hash),'Unrelated source: '+file);
}
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'server-delta'));
const payload={};
function write(file,bytes){assert(!path.isAbsolute(file)&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return payload[file]=digest(bytes);}
const changed={};
for(const [file,hash]of Object.entries(scope.expectedSources)){
 assert(file.startsWith('games/')||file.startsWith('src/ui/')||['src/main.ts','src/i18n/en.ts'].includes(file));
 const bytes=reader.read(file);assert.equal(digest(bytes),hash);changed[file]=write('source/'+file,bytes);
}
const delta={};
for(const [file,hash]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===hash)continue;
 const n=file.slice(5);assert(n==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(n));
 assert(n==='index.html'||!before.program[file],'Immutable URL collision');const bytes=fs.readFileSync(file);assert.equal(digest(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);const packages={};
for(const [game,row]of Object.entries(moduleReport.modules)){
 assert(scope.activeGames.includes(game));const meta=JSON.parse(fs.readFileSync(row.manifestPath));
 const contract=Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,meta[k]]));
 assert.deepEqual(contract,before.moduleHost.games[game],'Published contract changed: '+game);
 const files={'manifest.json':digest(fs.readFileSync(row.manifestPath)),...meta.files};
 for(const [file,hash]of Object.entries(files)){
  const source='module-dist/'+game+'/versions/'+meta.version+'/'+file,bytes=fs.readFileSync(source);assert.equal(digest(bytes),hash);assert.equal(release.files[source],hash);write('packages/'+game+'/'+file,bytes);
 }
 const pointer=fs.readFileSync('module-dist/'+game+'/active.json');assert.equal(digest(pointer),release.files['module-dist/'+game+'/active.json']);
 packages[game]={version:meta.version,contract,files,pointerSha256:write('pointers/'+game+'.json',pointer)};
}
assert.deepEqual(Object.keys(packages).sort(),scope.activeGames.slice().sort());
const references={
 'engine-build.py':'deployment/releases/shared-stakes-20261101-v1/engine_build.py',
 'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py':'deployment/releases/remove-reward-games-catalog-20261031-v1/image_metadata.py',
 'publisher.py':'scripts/game-module-release.py',
};
const support={};for(const [file,source]of Object.entries(references))support[file]=write(file,fs.readFileSync(source));
assert.equal(support['publisher.py'],before.source['scripts/game-module-release.py']);
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const helperSha256=write('deploy.py',fs.readFileSync(path.join(folder,'deploy.py'))),snapshotSha256=write('snapshot.py',fs.readFileSync(path.join(folder,'snapshot.py')));
write('scope.json',fs.readFileSync(path.join(folder,'scope.json')));
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta:{},packages,support,helperSha256,snapshotSha256,payload,
 releaseManifestSha256:payload['release-manifest.json'],receiptSha256:payload['release-github.json'],activeGames:scope.activeGames,addedGames:[],restoredGames:[]};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:Object.keys(changed).length,packages:Object.keys(packages).length,payloadFiles:Object.keys(payload).length,out}));
