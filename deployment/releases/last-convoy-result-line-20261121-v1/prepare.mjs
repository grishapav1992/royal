// Package the verified Last Convoy result-line module for its guarded installer.
// Usage: node deployment/releases/last-convoy-result-line-20261121-v1/prepare.mjs <before.json> <prior-manifest.json> <helpers.json> <browser-report.json> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyRelease,assertClean} from '../../../scripts/release.mjs';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';

const folder='deployment/releases/last-convoy-result-line-20261121-v1';
const game='studio-last-convoy';
const sources=['games/last-convoy/LastConvoyUI.ts','games/last-convoy/last-convoy.css'];
const scenarios=[
 'Last Convoy keeps its result line and stake legible in the connected host',
 'Last Convoy scales the field, Maya and controls at 2K and 4K',
 'natural bonuses keep counters and free continuation visible in both orientations',
 'settings, Stop and one accepted ten-cent round: studio-last-convoy',
 'count-only autoplay fits the connected host: studio-last-convoy',
 'autoplay completes ten paid spins through a natural bonus: studio-last-convoy',
];
const git=process.env.ROYAL_GIT_BINARY||'git';
const [beforeFile,priorFile,helpersFile,reportFile,outDir]=process.argv.slice(2);
assert(outDir,'Usage: prepare.mjs <before.json> <prior-manifest.json> <helpers.json> <browser-report.json> <out-dir>');
assertClean(process.cwd());
const release=await verifyRelease(process.cwd());
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const before=JSON.parse(fs.readFileSync(beforeFile)),helpers=JSON.parse(fs.readFileSync(helpersFile));
const priorBytes=fs.readFileSync(priorFile),prior=JSON.parse(priorBytes),report=JSON.parse(fs.readFileSync(reportFile));
assert.deepEqual(Object.keys(helpers).sort(),['image_metadata.py','snapshot-base.py','snapshot.py']);

// Every listed scenario ran on these exact module bytes and passed.
const titles=new Map();
const walk=suite=>{for(const spec of suite.specs??[])titles.set(spec.title,spec.ok&&spec.tests.every(t=>t.results.every(r=>r.status==='passed')));for(const child of suite.suites??[])walk(child);};
for(const suite of report.suites)walk(suite);
for(const title of scenarios)assert.equal(titles.get(title),true,'Scenario did not pass: '+title);

assert.equal(release.scope,'modules');assert.deepEqual(release.modules,['last-convoy']);
assert.equal(release.baseCommit,before.sourceCommit,'Release targets another production baseline');
execFileSync(git,['merge-base','--is-ancestor',release.sourceCommit,'origin/main']);
const reader=await readHostProjection(process.cwd(),folder+'/module-projection.json',{strictOrigins:true});
assert(!fs.existsSync(outDir));fs.mkdirSync(outDir,{recursive:true});
const put=(name,bytes)=>{
 assert(!path.isAbsolute(name)&&!name.split('/').some(p=>p==='..'||p.startsWith('.env')));
 const target=path.join(outDir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});return hash(bytes);
};
const committed=name=>execFileSync(git,['show',release.sourceCommit+':'+name],{maxBuffer:16*1024**2});
const wrapper=committed(folder+'/publish.py'),publisher=committed('scripts/game-module-release.py');
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
 assert.equal(digest,hash(committed(name)),'Projected source differs from the release commit: '+name);
 source[name]=put('source/'+name,bytes);
}

assert.deepEqual(release.packages.map(row=>row.gameId),[game]);
const row=release.packages[0],pointer=JSON.parse(fs.readFileSync(row.pointer));
const manifestPath=pointer.manifest.replace('/game-modules/','module-dist/'),manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
const files={'manifest.json':hash(manifestBytes),...manifest.files};
assert.deepEqual(Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(k=>[k,manifest[k]])),before.moduleHost.games[game]);
const beforePointer=before.moduleFiles['/opt/royal-game-modules/'+game+'/active.json'];assert.match(beforePointer,/^[a-f0-9]{64}$/);
assert.equal(hash(priorBytes),before.moduleFiles['/opt/royal-game-modules/'+game+'/versions/'+prior.version+'/manifest.json'],'Prior manifest is not the installed one');
assert.notEqual(prior.version,manifest.version);
for(const [name,digest]of Object.entries(files)){
 const from=path.join(path.dirname(manifestPath),name);assert.equal(hash(fs.readFileSync(from)),digest);
 assert.equal(release.files[path.dirname(manifestPath).replaceAll('\\','/')+'/'+name],digest);
 const target=path.join(outDir,'packages',game,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.linkSync(from,target);
}
const packages={[game]:{version:manifest.version,files,beforePointerSha256:beforePointer,pointerSha256:release.files[row.pointer]}};
const browserReportSha256=hash(fs.readFileSync(reportFile));
const proof={sourceCommit:release.sourceCommit,games:{[game]:{
 passed:true,kind:'verified-result-line',beforeManifest:hash(priorBytes),afterManifest:files['manifest.json'],
 beforeEntry:prior.files[prior.entry],afterEntry:manifest.files[manifest.entry],scenarios,browserReportSha256,
}},checks:{connectedHost:true,desktopAndPhone:true,oneTenCentDebit:true,freeContinuationWithoutDebit:true,browserReportSha256}};
const programProofSha256=put('program-proof.json',JSON.stringify(proof,null,2)+'\n');
const operator={sourceCommit:release.sourceCommit,buildBaseCommit:release.baseCommit,actualBaseCommit:before.sourceCommit,
 beforeSha256:hash(fs.readFileSync(beforeFile)),sourceBefore:Object.fromEntries(sources.map(name=>[name,before.sourceLF[name]??null])),
 source,packages,helpers,wrapperSha256:hash(wrapper),publisherSha256:hash(publisher),
 releaseManifestSha256:hash(fs.readFileSync('module-build/release-manifest.json')),receiptSha256:hash(fs.readFileSync('module-build/release-github.json')),
 programProofSha256};
put('operator.json',JSON.stringify(operator,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:release.sourceCommit,version:manifest.version,previous:prior.version,sources:Object.keys(source).length,outDir}));
