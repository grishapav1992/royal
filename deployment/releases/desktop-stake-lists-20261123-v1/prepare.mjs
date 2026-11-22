// Reuse the two verified independent module packages and bind them to the current production baseline.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {linkSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const folder='deployment/releases/desktop-stake-lists-20261123-v1';
const git=(...args)=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{maxBuffer:24*1024**2});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(readFileSync(file));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const [review,output]=process.argv.slice(2);
assert(review&&output,'Usage: prepare.mjs <checks-dir> <out-dir>');
const releasePath='module-build/release-manifest.json',receiptPath='module-build/release-github.json';
const release=json(releasePath),receipt=json(receiptPath),before=json(`${review}/production-baseline.json`);
const previous=json(`${review}/previous-release-manifest.json`),browser=json(`${review}/browser-prepared.json`);
const predecessor=json('deployment/releases/royal-stake-100-20261122-v2/verification.json');
assert.equal(sha(readFileSync(`${review}/previous-release-manifest.json`)),predecessor.releaseManifestSha256);
assert.equal(release.sourceCommit,receipt.sourceCommit);assert.equal(release.sourceCommit,browser.sourceCommit);
assert.equal(receipt.manifestSha256,sha(readFileSync(releasePath)));
assert.equal(release.baseCommit,before.sourceCommit);assert.equal(before.sourceCommit,predecessor.sourceCommit);
assert.equal(before.container.image,predecessor.image);assert.equal(before.container.health,'healthy');
assert.deepEqual(before.program,before.preparedProgram);
assert.equal(git('status','--porcelain').toString().trim(),'');
const toolCommit=git('rev-parse','HEAD').toString().trim(),remoteMain=git('rev-parse','origin/main').toString().trim();
for(const commit of [toolCommit,release.sourceCommit,receipt.remoteMain])git('merge-base','--is-ancestor',commit,remoteMain);
const slugs=['dracona','forest-heart'],games=slugs.map(slug=>'studio-'+slug);
const files=slugs.map(slug=>`games/${slug}/priorityStyles.ts`);
assert.deepEqual(release.modules,slugs);assert.deepEqual(release.packages.map(row=>row.gameId),games);
assert.equal(release.scope,'modules');assert(release.build.passed);
assert.equal(browser.mode,'prepared');assert.deepEqual(browser.catalogue,predecessor.catalogue.active);
assert.equal(browser.checks.length,4);
for(const game of games)for(const width of [1440,393]){
  const row=browser.checks.find(entry=>entry.game===game&&entry.layout.width===width);
  assert(row?.connectedChat&&row.selectable100&&(width<500||row.oneDebitOnReopen),game);
}
const helperLines=readFileSync(`${review}/production-helper-hashes.txt`,'utf8').trim().split('\n');
const helpers=Object.fromEntries(helperLines.map(line=>{
  const match=line.match(/^([0-9a-f]{64})\s+([a-z_-]+\.py)$/);
  assert(match);return [match[2],match[1]];
}));
assert.deepEqual(Object.keys(helpers).sort(),['image_metadata.py','snapshot-base.py','snapshot.py']);
const worker=git('show',`${toolCommit}:${folder}/publish.py`);
const guard=git('show',`${toolCommit}:deployment/releases/autoplay-spin-count-20261120-v1/publish.py`);
const servicePublisher=git('show',`${toolCommit}:scripts/game-module-release.py`);
assert.equal(sha(servicePublisher),before.source['scripts/game-module-release.py']);
mkdirSync(output);
const put=(name,bytes)=>{
  assert(!path.isAbsolute(name)&&!name.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.env')));
  const target=path.join(output,name);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});return sha(bytes);
};
const source={};
for(const name of files){
  const bytes=git('show',`${release.sourceCommit}:${name}`);
  assert.notEqual(sha(bytes),before.sourceLF[name]);
  assert.equal(sha(bytes),release.moduleProjection.inputs[name]);
  source[name]=put(`source/${name}`,bytes);
}
const proof={sourceCommit:release.sourceCommit,games:{}};
const media=files=>Object.fromEntries(Object.entries(files).filter(([filename])=>filename.startsWith('media/')));
const packages={};
for(const row of release.packages){
  const game=row.gameId, old=previous.build.moduleProjection.modules[game], current=release.moduleProjection.modules[game];
  const priorPointer=predecessor.public.pointers[game];
  assert.equal(priorPointer.sha256,before.moduleFiles[`/opt/royal-game-modules/${game}/active.json`]);
  assert.equal(old.version,priorPointer.version);assert.equal(old.manifestSha256,before.moduleFiles[`/opt/royal-game-modules/${game}/versions/${old.version}/manifest.json`]);
  const drop=name=>Object.fromEntries(Object.entries(name).filter(([input])=>!files.includes(input)));
  assert.deepEqual(drop(current.sourceFiles),drop(old.sourceFiles));
  assert.deepEqual(current.hostBridges,old.hostBridges);
  assert.deepEqual(media(current.files),media(old.files));
  assert.equal(current.version,row.version);
  const meta=json(current.manifestPath);
  const mapped=Object.fromEntries(['apiVersion','rulesVersion','progressVersion'].map(key=>[key,meta[key]]));
  assert.deepEqual(mapped,before.moduleHost.games[game]);
  const set={'manifest.json':current.manifestSha256,...current.files};
  for(const [name,digest] of Object.entries(set)){
    const from=path.join(path.dirname(current.manifestPath),name);
    assert.equal(release.files[from],digest);assert.equal(sha(readFileSync(from)),digest);
    const target=path.join(output,'packages',game,name);
    mkdirSync(path.dirname(target),{recursive:true});linkSync(from,target);
  }
  const oldEntry=Object.keys(old.files).find(name=>/^entry-[a-f0-9]+\.js$/.test(name));
  assert(oldEntry);assert.equal(sha(readFileSync(row.pointer)),release.files[row.pointer]);
  packages[game]={version:row.version,pointerSha256:release.files[row.pointer],beforePointerSha256:priorPointer.sha256,files:set};
  proof.games[game]={passed:true,kind:'desktop-stake-menu',beforeManifest:old.manifestSha256,afterManifest:current.manifestSha256,
    beforeEntry:old.files[oldEntry],afterEntry:current.files[meta.entry],browserReportSha256:sha(readFileSync(`${review}/browser-prepared.json`))};
}
const installerReceipt={format:1,sourceCommit:toolCommit,remoteMain,applicationSourceCommit:release.sourceCommit,
  guardSha256:put('scope-guard.py',guard),publishSha256:put('publish.py',worker)};
const operator={sourceCommit:release.sourceCommit,source,packages,helpers,wrapperSha256:installerReceipt.publishSha256,
  publisherSha256:sha(servicePublisher),installerReceiptSha256:put('installer-github.json',encode(installerReceipt)),
  beforeSha256:put('before.json',readFileSync(`${review}/production-baseline.json`)),
  releaseManifestSha256:put('release-manifest.json',readFileSync(releasePath)),
  receiptSha256:put('release-github.json',readFileSync(receiptPath)),programProofSha256:put('program-proof.json',encode(proof))};
put('install-manifest.json',readFileSync(releasePath));
put('operator.json',encode(operator));
console.log(JSON.stringify({sourceCommit:release.sourceCommit,toolCommit,packages:games,media:Object.values(packages).reduce((sum,item)=>sum+Object.keys(media(item.files)).length,0)}));
