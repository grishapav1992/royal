import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const git=process.env.ROYAL_GIT_BINARY||'git';
const featureCommit='f9a6a231e73da8618d745a654d1b684b18bcda5d';
const productionCommit='b1eeea9ffe6154c6941ae568a8712bc6ebfb10d0';
const directory='deployment/releases/location-levels-20261030-v1';
const canonical=b=>Buffer.from(b.toString().replace(/\r\n/g,'\n'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const origins=JSON.parse(await readFile('artifacts/work/location-levels-mvp/production-origin-map.json'));
const baseline=JSON.parse(await readFile('artifacts/work/location-levels-mvp/baseline.json'));
assert.equal(baseline.sourceCommit,productionCommit);
assert.equal(origins.productionCommit,productionCommit);
const changed=['server/accounts.ts','server/index.ts','src/main.ts','src/i18n/en.ts'];
const added=['server/progression/store.ts','server/progression/sources.ts','server/progression/freeSpins.ts','server/progression/handlers.ts','server/progressionRoutes.ts',
  'src/shared/progression.ts','src/wallet/ProgressionClient.ts','src/ui/ProgressionUI.ts','src/ui/progression.css','src/i18n/progressionEn.ts'];
const files=structuredClone(origins.files);
for(const [name,row] of Object.entries(files))assert.equal(row.sha256,baseline.sourceLF[name],'Origin differs from verified production: '+name);
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
