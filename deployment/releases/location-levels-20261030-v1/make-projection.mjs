import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const git=process.env.ROYAL_GIT_BINARY||'git';
const featureCommit='3b551a4495b917740dfd28c3296ce41be5fac348';
const productionCommit='aed09286a21e315cb506b1befc754f5a7b4eecd2';
const directory='deployment/releases/location-levels-20261030-v1';
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const old=JSON.parse(await readFile('deployment/releases/forest-heart-responsive-20261030-v1/host-projection.json'));
const baseline=JSON.parse(await readFile('artifacts/work/location-levels-mvp/baseline.json'));
assert.equal(baseline.sourceCommit,productionCommit);
const changed=['server/accounts.ts','server/index.ts','src/main.ts','src/i18n/en.ts'];
const added=['server/progression/store.ts','server/progression/sources.ts','server/progression/freeSpins.ts','server/progressionRoutes.ts',
  'src/shared/progression.ts','src/wallet/ProgressionClient.ts','src/ui/ProgressionUI.ts','src/ui/progression.css','src/i18n/progressionEn.ts'];
const files=structuredClone(old.files);
for(const name of changed){
  const before=canonical(execFileSync(git,['show','780b1dec:'+name]));
  assert.equal(hash(before),baseline.sourceLF[name],'Feature baseline differs from production: '+name);
}
for(const name of [...changed,...added]){
  const sha256=hash(canonical(execFileSync(git,['show',featureCommit+':'+name])));
  files[name]={commit:featureCommit,path:name,baseSha256:sha256,sha256};
}
const registry=JSON.parse(await readFile('scripts/game-math/rtp-policy.json'));
for(const id of ['royal-coins','royal-fruits']){
  const proof=JSON.parse(await readFile(registry.profiles[id].proof));
  for(const name of registry.profiles[id].sources){
    if(!files[name]){
      const sha256=hash(canonical(execFileSync(git,['show',featureCommit+':'+name])));
      files[name]={commit:featureCommit,path:name,baseSha256:sha256,sha256};
    }
    assert.equal(files[name].sha256,proof.sourceHashes[name],'Projected qualified source differs: '+name);
  }
}
await mkdir(directory,{recursive:true});
for(const [name,entries] of [['host-projection.json',['index.html']],['backend-projection.json',['server/index.ts']]]){
  await writeFile(directory+'/'+name,JSON.stringify({format:1,productionCommit,entries,changedSources:[...changed,...added],files},null,2)+'\n');
}
console.log(JSON.stringify({featureCommit,productionCommit,changed,added,qualifiedProjectionSources:true}));
