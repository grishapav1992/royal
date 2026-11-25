// Package the verified Caribbean voyage for the single-game installer.
// The installer is taken from the tool commit, which may equal the release source commit.
// Usage:
// node deployment/releases/caribbean-voyage-module-20261125-v1/prepare.mjs <before.json> <prior-manifest.json> <helpers.json> <browser-report.json> <out-dir> <tool-commit>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyRelease,assertClean} from '../../../scripts/release.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/caribbean-voyage-module-20261125-v1';
const projection='deployment/releases/caribbean-voyage-module-20261125-v1/module-projection.json';
const game='studio-caribbean-treasures';
// Eleven sources are new, ten of them in the scene folder. The receipt lists every compiled game source.
const created=['CaribbeanVoyageClient.ts','scene/clock.ts','scene/effects.ts','scene/gl.ts','scene/harbor.ts','scene/media.ts','scene/pirate.ts','scene/stage.ts','scene/symbols.ts','scene/text.ts','scene/voyage.ts'].map(name=>'games/caribbean-treasures/'+name);
const sources=[...['CaribbeanAudio.ts','CaribbeanCrew.ts','CaribbeanUI.ts','caribbean.css','entry.ts','package.json','presentation.ts'].map(name=>'games/caribbean-treasures/'+name),...created];
const git=process.env.ROYAL_GIT_BINARY||'git';
const [beforeFile,priorFile,helpersFile,reportFile,outDir,toolRef]=process.argv.slice(2);
assert(toolRef,'Usage: prepare.mjs <before.json> <prior-manifest.json> <helpers.json> <browser-report.json> <out-dir> <tool-commit>');
assertClean(process.cwd());
const release=await verifyRelease(process.cwd());
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const before=JSON.parse(fs.readFileSync(beforeFile)),helpers=JSON.parse(fs.readFileSync(helpersFile));
const priorBytes=fs.readFileSync(priorFile),prior=JSON.parse(priorBytes);
assert.deepEqual(Object.keys(helpers).sort(),['image_metadata.py','snapshot-base.py','snapshot.py']);
const toolCommit=execFileSync(git,['rev-parse','--verify',toolRef+'^{commit}'],{encoding:'utf8'}).trim();
execFileSync(git,['merge-base','--is-ancestor',toolCommit,'origin/main']);
execFileSync(git,['merge-base','--is-ancestor',release.sourceCommit,'origin/main']);
assert.equal(release.scope,'modules');assert.deepEqual(release.modules,['caribbean-treasures']);
assert.equal(release.baseCommit,before.sourceCommit,'Release targets another production baseline');
const reader=await readHostProjection(process.cwd(),projection,{strictOrigins:true});

const pointerPath='/opt/royal-game-modules/'+game+'/active.json';
assert.equal(hash(priorBytes),before.moduleFiles['/opt/royal-game-modules/'+game+'/versions/'+prior.version+'/manifest.json'],'Prior manifest is not the installed one');

assert(!fs.existsSync(outDir));fs.mkdirSync(outDir,{recursive:true});
const put=(name,bytes)=>{
 assert(!path.isAbsolute(name)&&!name.split('/').some(p=>p==='..'||p.startsWith('.env')));
 const target=path.join(outDir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return hash(bytes);
};
const wrapper=execFileSync(git,['show',toolCommit+':'+folder+'/publish.py']);
const publisher=execFileSync(git,['show',release.sourceCommit+':scripts/game-module-release.py']);
put('before.json',fs.readFileSync(beforeFile));put('publish.py',wrapper);
put('release-manifest.json',fs.readFileSync('module-build/release-manifest.json'));
// The prepared manifest also protects the unfinished delivery during retention.
put('install-manifest.json',fs.readFileSync('module-build/release-manifest.json'));
put('release-github.json',fs.readFileSync('module-build/release-github.json'));
const receipt=JSON.parse(fs.readFileSync('module-build/release-github.json'));assert.equal(receipt.sourceCommit,release.sourceCommit);

const source={};
for(const name of sources){
 const bytes=reader.read(name),digest=hash(bytes);
 assert.equal(release.moduleProjection.inputs[name],digest,'Source absent from the compiled module: '+name);
 source[name]=put('source/'+name,bytes);
}
assert(['package.json','CaribbeanUI.ts','CaribbeanAudio.ts','caribbean.css'].every(name=>before.source['games/caribbean-treasures/'+name]!==source['games/caribbean-treasures/'+name]));
assert(created.every(name=>!before.source[name]));

assert.deepEqual(release.packages.map(row=>row.gameId),[game]);
const row=release.packages[0],pointer=JSON.parse(fs.readFileSync(row.pointer));
const manifestPath=pointer.manifest.replace('/game-modules/','module-dist/'),manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
assert.notEqual(prior.version,manifest.version);
assert.deepEqual(Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,manifest[k]])),before.moduleHost.games[game]);
const files={'manifest.json':hash(manifestBytes),...manifest.files};
for(const [name,digest]of Object.entries(files)){
 const from=path.join(path.dirname(manifestPath),name);assert.equal(hash(fs.readFileSync(from)),digest);
 assert.equal(release.files[path.dirname(manifestPath).replaceAll('\\','/')+'/'+name],digest);
 const target=path.join(outDir,'package',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.linkSync(from,target);
}
const browserReport=fs.readFileSync(reportFile);
const validation=JSON.parse(browserReport);
assert.equal(validation.version,manifest.version);
assert.equal(validation.moduleManifestSha256,files['manifest.json']);
assert.equal(validation.connectedHostPassed,true);
assert.equal(validation.recoveryPassed,true);
const browserReportSha256=put('browser-validation.json',browserReport);
const proof={sourceCommit:release.sourceCommit,games:{[game]:{passed:true,kind:'verified-voyage',beforeManifest:hash(priorBytes),afterManifest:files['manifest.json'],
 beforeEntry:prior.files[prior.entry],afterEntry:manifest.files[manifest.entry],browserReportSha256}}};
const programProofSha256=put('program-proof.json',JSON.stringify(proof,null,2)+'\n');
const operator={sourceCommit:release.sourceCommit,wrapperSourceCommit:toolCommit,version:manifest.version,
 pointerSha256:release.files[row.pointer],priorPointerSha256:before.moduleFiles[pointerPath],priorManifestSha256:hash(priorBytes),
 beforeSha256:hash(fs.readFileSync(beforeFile)),source,helpers,wrapperSha256:hash(wrapper),publisherSha256:hash(publisher),
 releaseManifestSha256:hash(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:hash(fs.readFileSync('module-build/release-github.json')),
 programProofSha256};
put('operator.json',JSON.stringify(operator,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:release.sourceCommit,toolCommit,version:manifest.version,previous:prior.version,outDir}));
