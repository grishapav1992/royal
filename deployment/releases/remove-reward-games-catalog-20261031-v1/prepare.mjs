import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
import {verifyRelease,assertClean,git} from '../../../scripts/release.mjs';
const root=process.cwd(),folder=path.dirname(fileURLToPath(import.meta.url));
const name='remove-reward-games-catalog-20261031-v1',source='src/shared/arcadeCatalog.ts';
const before=JSON.parse(fs.readFileSync(process.argv[2])),out=path.resolve(process.argv[3]);
await assertClean(root);const release=await verifyRelease(root),receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(receipt.remoteMain,git(root,['rev-parse','origin/main']));
assert.equal(release.baseCommit,before.sourceCommit);assert.deepEqual(before.program,before.preparedProgram);assert.equal(before.container.image,before.preparedImage);
const reader=await readHostProjection(root,path.relative(root,path.join(folder,'host-projection.json')),{strictOrigins:true});
const changedBytes=reader.read(source),previous=Buffer.from(changedBytes.toString().replace('ROYAL_PLATFORM_GAMES: readonly string[] = [','ROYAL_PLATFORM_GAMES: readonly string[] = [...REWARD_SLOT_GAMES, '));
assert.equal(digest(previous),before.sourceLF[source]);assert.equal(release.hostProjection.inputs[source],digest(changedBytes));
for(const [file,hash]of Object.entries(release.hostProjection.inputs))assert(file===source||[before.source[file],before.sourceLF[file]].includes(hash),'Unrelated host input: '+file);
assert(!fs.existsSync(out),'Payload already exists');fs.mkdirSync(out,{recursive:true});
function write(name,bytes){const p=path.join(out,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes,{flag:'wx'});return digest(bytes);}
const changed={[source]:write('source/'+source,changedBytes)},delta={};
for(const [file,hash]of Object.entries(release.files)){
 if(!file.startsWith('dist/')||before.program[file]===hash)continue;
 const n=file.slice(5);assert(n==='index.html'||/^assets\/[\w-]+\.(js|css)$/.test(n),'Foreign host artifact');
 assert(n==='index.html'||!before.program[file],'Immutable asset collision');const bytes=fs.readFileSync(file);assert.equal(digest(bytes),hash);delta[n]=write('dist-delta/'+n,bytes);
}
assert(delta['index.html']);fs.mkdirSync(path.join(out,'server-delta'));write('before-catalogue.ts',previous);
const references={
 'overlay-base.py':'deployment/releases/cat-purr-hall-only-20261030-v1/deploy.py',
 'snapshot-base.py':'deployment/releases/universal-spins-20261031-v1/snapshot.py',
 'runtime-inventory.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/runtime-inventory.cjs',
 'quiesce.cjs':'deployment/releases/cat-purr-hall-only-20261030-v1/quiesce.cjs',
 'financial_gate.py':'deployment/releases/cat-purr-hall-only-20261030-v1/financial_gate.py',
 'image_metadata.py':path.relative(root,path.join(folder,'image_metadata.py')),
};
const support={};for(const [name,file]of Object.entries(references))support[name]=write(name,fs.readFileSync(file));
for(const file of ['release-manifest.json','release-github.json'])write(file,fs.readFileSync('module-build/'+file));
const helperSha256=write('deploy.py',fs.readFileSync(path.join(folder,'deploy.py'))),snapshotSha256=write('snapshot.py',fs.readFileSync(path.join(folder,'snapshot.py')));
const manifest={release:name,sourceCommit:release.sourceCommit,baseCommit:before.sourceCommit,before,changed,delta,serverDelta:{},support,helperSha256,snapshotSha256,
 releaseManifestSha256:digest(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:digest(fs.readFileSync('module-build/release-github.json'))};
write('install-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,sourceFiles:1,clientFiles:Object.keys(delta).length,clientBytes:Object.keys(delta).reduce((n,f)=>n+fs.statSync(path.join(out,'dist-delta',f)).size,0),out}));
