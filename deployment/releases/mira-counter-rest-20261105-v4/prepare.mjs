import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const release='mira-counter-rest-20261105-v4';
const previous='mira-counter-rest-20261105-v3';
const folder='deployment/releases/'+release;
const work='artifacts/work/mira-counter-rest-20261105/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file));
const [baseline,flagReceipt,output,installerCommit]=process.argv.slice(2);
assert(baseline&&flagReceipt&&output);
assert.match(installerCommit,/^[a-f0-9]{40}$/);
const git=(...args)=>execFileSync('git',args,{maxBuffer:16*1024**2});
const commit=(ref,file)=>git('show',ref+':'+file);
const text=(...args)=>git(...args).toString('utf8').trim();
const remoteMain=text('rev-parse','origin/main');
git('merge-base','--is-ancestor',installerCommit,remoteMain);

const initial=path.join(work,'v3','payload');
const old=read(path.join(initial,'install-manifest.json'));
const before=read(baseline);
const flag=read(flagReceipt);
assert.equal(old.release,previous);
assert.equal(old.sourceCommit,text('rev-parse','HEAD'));
assert.equal(text('status','--porcelain'),'');
git('merge-base','--is-ancestor',old.sourceCommit,remoteMain);
assert.equal(before.sourceCommit,old.baseCommit);
for(const key of ['container','program','preparedProgram','preparedImage','configHashes','moduleHostContract','protectedPrograms','services','serviceProfiles'])assert.deepEqual(before[key],old.before[key],key);

const diff=(before,after)=>Object.keys({...before,...after}).filter(key=>before[key]!==after[key]).sort();
const flagPrefix='/opt/royal-game-modules/flag-battle/';
const flagPath=flagPrefix+'active.json';
const sourceChanges=diff(old.before.source,before.source);
assert.deepEqual(sourceChanges,Object.keys(flag.changedSource).sort());
assert.equal(sourceChanges.length,1);
for(const file of sourceChanges){
  assert(file.startsWith('games/flag-battle/'));
  assert.equal(before.source[file],flag.changedSource[file]);
  assert(!Object.hasOwn(old.changed,file));
}
assert.deepEqual(diff(old.before.sourceLF,before.sourceLF),sourceChanges);
assert.equal(before.moduleFiles[flagPath],flag.pointerSha256);
assert.notEqual(old.before.moduleFiles[flagPath],flag.pointerSha256);
assert.equal(flag.version,'2.1.2-e8311314c888');
assert.equal(flag.hostSourceCommit,old.baseCommit);
assert.equal(flag.hostImage,old.before.preparedImage);
const moduleChanges=diff(old.before.moduleFiles,before.moduleFiles);
assert(moduleChanges.length>1&&moduleChanges.every(key=>key===flagPath||key.startsWith(flagPrefix+'versions/'+flag.version+'/')));
for(const key of moduleChanges)assert(before.moduleFiles[key]);

const releaseManifest=read(path.join(initial,'release-manifest.json'));
for(const projection of [releaseManifest.hostProjection,releaseManifest.backendProjection])for(const file of sourceChanges)assert(!Object.hasOwn(projection.inputs,file));
assert.equal(releaseManifest.sourceCommit,old.sourceCommit);
assert.equal(sha(fs.readFileSync(path.join(initial,'release-manifest.json'))),old.releaseManifestSha256);
const parentCommit=text('rev-parse',installerCommit+'^');
const changedOnlyReleaseTooling=text('diff','--name-only',parentCommit,installerCommit).split('\n');
assert(changedOnlyReleaseTooling.every(file=>file.startsWith(folder+'/')));
assert(!fs.existsSync(output),'Release package already exists');

function write(file,bytes){
  const target=path.join(output,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,bytes,{flag:'wx'});
  return sha(bytes);
}
function copy(file,digest){
  const bytes=fs.readFileSync(path.join(initial,file));
  assert.equal(sha(bytes),digest,file);
  return write(file,bytes);
}
const support={...old.support};
for(const [file,digest] of Object.entries(support))copy(file,digest);
for(const [section,prefix] of [['changed','source'],['delta','dist-delta'],['serverDelta','server-delta']]){
  for(const [file,digest] of Object.entries(old[section]))copy(prefix+'/'+file,digest);
}
const deploy=commit(installerCommit,folder+'/deploy.py');
assert(deploy.toString().includes(`NAME = '${release}'`));
const helperSha256=write('deploy.py',deploy);
copy('snapshot.py',old.snapshotSha256);
copy('release-manifest.json',old.releaseManifestSha256);
copy('release-github.json',old.receiptSha256);
copy('media-github.json',old.mediaReceiptSha256);
const helperReceiptSha256=write('installer-github.json',JSON.stringify({format:1,sourceCommit:installerCommit,parentCommit,
  applicationSourceCommit:old.sourceCommit,packagerSourceCommit:installerCommit,remoteMain,checkedAt:new Date().toISOString(),changedOnlyReleaseTooling},null,2)+'\n');
const manifest={...old,release,before,support,helperSourceCommit:installerCommit,helperSha256,helperReceiptSha256,flagReceipt:flag};
const manifestSha256=write('install-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({release,sourceCommit:old.sourceCommit,manifestSha256,sourceChanges,moduleChanges:moduleChanges.length}));
