import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
import {verifyRelease,assertClean,git} from '../../../scripts/release.mjs';
const root=process.cwd(),folder=path.dirname(fileURLToPath(import.meta.url));
const name='player-recovery-20261104-v1',sources=["server/LobbyRoom.ts","src/game/RoomScene.ts","src/i18n/en.ts","src/main.ts","src/network/LobbyClient.ts","src/shared/arcadeCatalog.ts","src/shared/playerRecovery.ts","src/shared/world.ts","src/ui/PlayerRecoverySettings.ts","src/ui/SocialUI.ts","src/ui/player-recovery.css"];
const before=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
const scope=JSON.parse(fs.readFileSync(path.join(folder,'scope.json')));
await assertClean(root);const release=await verifyRelease(root),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(receipt.remoteMain,git(root,['rev-parse','origin/main']));
assert.equal(release.baseCommit,before.sourceCommit);assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);
const reader=await readHostProjection(root,path.relative(root,path.join(folder,'host-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const backend=await readHostProjection(root,path.relative(root,path.join(folder,'backend-projection.json')).replaceAll('\\','/'),{strictOrigins:true});
const preservedBackendInputs={'src/i18n/en.ts':'8853e5a8bd533ca85608eb11975f1f0d98a03fd0d1b749f48cca00e9db86cd68'};
for(const projection of [release.hostProjection,release.backendProjection])for(const [file,hash]of Object.entries(projection.inputs))assert(projection===release.backendProjection&&preservedBackendInputs[file]===hash||scope.expectedSources[file]===hash||[before.source[file],before.sourceLF[file]].includes(hash),'Unrelated build input: '+file);
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});
function write(name,bytes){const p=path.join(out,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes,{flag:'wx'});return digest(bytes);}
const changed={},delta={},serverDelta={};
for(const source of sources){const selected=source.startsWith('server/')?backend:reader,projection=source.startsWith('server/')?release.backendProjection:release.hostProjection;const bytes=selected.read(source);changed[source]=write('source/'+source,bytes);assert.equal(projection.inputs[source],changed[source]);}
for(const [file,hash]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===hash)continue;
 const n=file.slice(5);assert(n==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(n),'Foreign host artifact');
 assert(n==='index.html'||!before.program[file],'Immutable asset collision');const bytes=fs.readFileSync(file);assert.equal(digest(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);
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
const support={};for(const [name,file]of Object.entries(references))support[name]=write(name,fs.readFileSync(file));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const helperSha256=write('deploy.py',fs.readFileSync(path.join(folder,'deploy.py'))),snapshotSha256=write('snapshot.py',fs.readFileSync(path.join(folder,'snapshot.py')));
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta,support,helperSha256,snapshotSha256,
 releaseManifestSha256:digest(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:digest(fs.readFileSync('module-build/release-github.json'))};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:sources.length,clientFiles:Object.keys(delta).length,clientBytes:Object.keys(delta).reduce((n,f)=>n+fs.statSync(path.join(out,'dist-delta',f)).size,0),out}));
