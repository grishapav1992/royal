import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const name='nitro-run-redesign-20261119-v1',folder='deployment/releases/'+name;
const before=JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,''));
const helpers=JSON.parse((await readFile(process.argv[3],'utf8')).replace(/^\uFEFF/,''));
const out=resolve(process.argv[4]),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024**2});
assert.equal(git('status','--porcelain').toString().trim(),'');
const release=JSON.parse(await readFile('module-build/release-manifest.json','utf8'));
const receipt=JSON.parse(await readFile('module-build/release-github.json','utf8'));
assert.equal(release.sourceCommit,receipt.sourceCommit);
assert.equal(git('rev-parse','HEAD').toString().trim(),release.sourceCommit);
git('merge-base','--is-ancestor',release.sourceCommit,'origin/main');
git('merge-base','--is-ancestor',receipt.remoteMain,'origin/main');
assert.equal(release.baseCommit,before.sourceCommit);
assert.equal(release.scope,'modules');assert.deepEqual(release.modules,['nitro-run']);
assert(release.clean&&release.build.passed);assert.equal(before.container.health,'healthy');
assert.equal(before.container.image,before.preparedImage);assert.deepEqual(before.program,before.preparedProgram);
assert.equal(sha(await readFile('module-build/release-manifest.json')),receipt.manifestSha256);
for(const [file,hash]of Object.entries(release.files))assert.equal(sha(await readFile(file)),hash,'Changed artifact: '+file);
const reader=await readHostProjection(process.cwd(),folder+'/module-projection.json',{strictOrigins:true});
const owned=new Set(['games/nitro-run/package.json','games/nitro-run/tsconfig.json']);
const presentation=new Set(['src/ui/NitroRunUI.ts','src/ui/NitroRunLayout.ts','src/ui/nitro-run.css','src/ui/nitro-run-layout.css']);
// The optional layout argument is bundled into this module only. Other games
// and the host retain their existing shared helper and immutable packages.
const compiler=new Set(['tsconfig.json','src/ui/slotKit/SlotSettings.ts']);
for(const [file,hash]of Object.entries(release.moduleProjection.inputs)){
 assert.equal(sha(reader.read(file)),hash,'Projection differs: '+file);
 assert(owned.has(file)||presentation.has(file)||compiler.has(file)||before.sourceLF[file]===hash,'Unrelated module input: '+file);
}
const pkg=release.packages[0];assert.equal(pkg.gameId,'studio-nitro-run');
const prefix=`module-dist/${pkg.gameId}/versions/${pkg.version}/`;
const manifest=JSON.parse(await readFile(prefix+'manifest.json','utf8'));
assert.deepEqual(Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,manifest[k]])),before.moduleHost.games[pkg.gameId]);
const files={'manifest.json':sha(await readFile(prefix+'manifest.json')),...manifest.files};
assert.deepEqual(release.files,{...Object.fromEntries(Object.entries(files).map(([n,h])=>[prefix+n,h])),[pkg.pointer]:sha(await readFile(pkg.pointer))});
await mkdir(out,{recursive:false});
async function write(file,bytes){assert(!file.startsWith('/')&&!file.includes('\\')&&!file.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.env')));const target=resolve(out,file);assert(target.startsWith(out+'/')||target.startsWith(out+'\\'));await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});return sha(bytes);}
const source={};for(const file of owned)source[file]=await write('source/'+file,reader.read(file));
for(const file of Object.keys(files))await write('package/'+file,await readFile(prefix+file));
for(const file of ['release-manifest.json','release-github.json'])await write(file,await readFile('module-build/'+file));
const wrapperSha256=await write('publish.py',git('show',release.sourceCommit+':'+folder+'/publish.py'));
const beforeSha256=await write('before.json',Buffer.from(JSON.stringify(before,null,2)+'\n'));
assert.deepEqual(Object.keys(helpers).sort(),['image_metadata.py','snapshot-base.py','snapshot.py']);
const operator={sourceCommit:release.sourceCommit,installerCommit:release.sourceCommit,version:pkg.version,source,
 pointerSha256:sha(await readFile(pkg.pointer)),wrapperSha256,beforeSha256,
 releaseManifestSha256:receipt.manifestSha256,receiptSha256:sha(await readFile('module-build/release-github.json')),
 publisherSha256:before.source['scripts/game-module-release.py'],helpers};
await write('operator.json',Buffer.from(JSON.stringify(operator,null,2)+'\n'));
console.log(JSON.stringify({out,version:pkg.version,sourceFiles:Object.keys(source).length,packageFiles:Object.keys(files).length}));
