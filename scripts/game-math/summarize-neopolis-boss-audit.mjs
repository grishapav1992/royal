import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
// Recompute the supplementary audit from its retained cycle moments.
const args=process.argv.slice(2);
assert(args.length===0||args.length===2,'Usage: node scripts/game-math/summarize-neopolis-boss-audit.mjs [input-directory output-json]');
const task=resolve(args[0]??'docs/game-math/audits/neopolis-boss-20261024');
const output=resolve(args[1]??task+'/combined.json');
const names=['math.json','math-extension-aes.json'];
const reports=await Promise.all(names.map(async name=>JSON.parse(await readFile(task+'/'+name,'utf8'))));
const policy=JSON.parse(await readFile('scripts/game-math/rtp-policy.json','utf8')).profiles['studio-neopolis'];
assert.deepEqual(reports[0].sourceHashes,reports[1].sourceHashes);
assert.equal(reports[0].policySha256,reports[1].policySha256);
assert.equal(reports[0].policySha256,createHash('sha256').update(JSON.stringify(policy)).digest('hex'),'Audit policy differs from current policy');
for(const report of reports){
  assert.equal(report.gameId,'studio-neopolis');assert.equal(report.rulesVersion,3);
  assert.deepEqual(report.configuration.stakes,policy.stakes);
  assert.deepEqual(report.heroes.map(h=>h.hero),policy.choices);
  assert(Object.values(report.invariants).every(value=>value===true),'A batch has failed invariants');
  for(const hero of report.heroes){
    assert.deepEqual(hero.results.map(row=>row.stakeUnits),policy.stakes);
    for(const row of hero.results){
      assert(['samples','paidRounds','reward','cost','rewardSquared','rewardCost','costSquared'].every(key=>Number.isFinite(row[key])));
      assert(row.samples>1&&row.cost===row.paidRounds);
    }
  }
}
const sum=(items,key)=>items.reduce((n,v)=>n+v[key],0);
const mean=(items,key,count)=>sum(items.map(v=>({value:v[key]*v[count]})),'value')/sum(items,count);
const result={schemaVersion:1,gameId:'studio-neopolis',rulesVersion:3,checkedAt:new Date().toISOString(),
  policy:{target:policy.target,tolerance:policy.tolerance,maxUpper95:policy.maxUpper95,maxHalfWidth95:policy.maxHalfWidth95},
  sourceHashes:reports[0].sourceHashes,policySha256:reports[0].policySha256,
  inputs:await Promise.all(names.map(async(name,index)=>({file:name,sha256:createHash('sha256').update(await readFile(task+'/'+name)).digest('hex'),rng:reports[index].configuration.rng??'mulberry32',acceptance:reports[index].acceptance}))),
  method:'Sum complete regenerative cycle reward/cost moments per hero and stake. Six stakes reuse outcomes and are not six independent samples. Do not pool RTP confidence across heroes. All paid collection costs and complete bonuses included. First batch and one predeclared extension retained regardless of outcome. Approximate 95% intervals, not exact analytical RTP.',
  uniquePaidRounds:0,completeCampaigns:0,freeSpins:0,allRowsWithinRegisteredBudget:true,heroes:[]};
for(const hero of reports[0].heroes.map(v=>v.hero)){
  const samples=reports.map(r=>r.heroes.find(h=>h.hero===hero));
  const entry={hero,cycles:sum(samples,'cycles'),paidRounds:sum(samples,'paidRounds'),freeSpins:sum(samples,'freeSpins'),results:[]};
  result.uniquePaidRounds+=entry.paidRounds;result.completeCampaigns+=entry.cycles;result.freeSpins+=entry.freeSpins;
  for(const stakeUnits of policy.stakes){
    const rows=samples.map(h=>h.results.find(row=>row.stakeUnits===stakeUnits)),row={stakeUnits};
    for(const key of ['samples','paidRounds','reward','cost','rewardSquared','rewardCost','costSquared'])row[key]=sum(rows,key);
    row.rtp=row.reward/row.cost;
    const residual=Math.max(0,row.rewardSquared-2*row.rtp*row.rewardCost+row.rtp**2*row.costSquared);
    const half=1.96*Math.sqrt(row.samples*residual/(row.samples-1))/row.cost;
    row.interval95=[row.rtp-half,row.rtp+half];
    row.paidContribution=mean(rows,'paidContribution','paidRounds');
    row.bonusContribution=mean(rows,'bonusContribution','paidRounds');
    assert(Math.abs(row.paidContribution+row.bonusContribution-row.rtp)<1e-9);
    row.withinRegisteredBudget=Math.abs(row.rtp-policy.target)<=policy.tolerance&&row.interval95[1]<=policy.maxUpper95&&half<=policy.maxHalfWidth95;
    result.allRowsWithinRegisteredBudget&&=row.withinRegisteredBudget;
    entry.results.push(row);
  }
  const bonuses=samples.map(s=>s.bonus),triggers=sum(bonuses,'triggers');
  const clearedBossCounts=[0,1,2,3].map(i=>bonuses.reduce((n,b)=>n+b.clearedBossCounts[i],0));
  entry.bonus={triggers,paidSpinsPerCampaign:entry.paidRounds/triggers,clearedBossCounts,
    threeBossClearRate:clearedBossCounts[3]/triggers,
    meanFreeSpins:mean(bonuses.map(b=>({value:b.spins.mean,count:b.triggers})),'value','count'),
    maxFreeSpins:Math.max(...bonuses.map(b=>b.spins.max)),
    positiveFreeSpinRate:mean(samples.map(s=>({value:s.bonus.positiveFreeSpinRate,count:s.freeSpins})),'value','count'),
    meanCampaignPayoutInStakes:mean(bonuses.map(b=>({value:b.payoutInStakes.mean,count:b.triggers})),'value','count'),
    maxCampaignPayoutInStakes:Math.max(...bonuses.map(b=>b.payoutInStakes.max)),
    victoryTailSpins:sum(bonuses,'victoryTailSpins'),
    meanVictoryTailSpins:sum(bonuses,'victoryTailSpins')/clearedBossCounts[3],
    meanVictoryTailPayoutPerEnteredCampaignInStakes:mean(bonuses.map(b=>({value:b.victoryTailPayoutInStakes.mean,count:b.triggers})),'value','count'),
    caps:sum(bonuses,'caps'),stages:[]};
  for(let i=0;i<3;i++){
    const stages=bonuses.map(b=>b.stages[i]);
    entry.bonus.stages.push({boss:stages[0].boss,entered:sum(stages,'entered'),defeated:sum(stages,'defeated'),combatSpins:sum(stages,'combatSpins'),damagingSpins:sum(stages,'damagingSpins'),payoutInStakes:sum(stages,'payoutInStakes'),
      meanSpinsPerEntry:sum(stages,'combatSpins')/sum(stages,'entered'),
      defeatRateConditionalOnEntry:sum(stages,'defeated')/sum(stages,'entered'),
      meanRemainingAfterDefeat:mean(stages.map(s=>({value:s.remainingAfterDefeat.mean,count:s.defeated})),'value','count')});
  }
  result.heroes.push(entry);
}
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,uniquePaidRounds:result.uniquePaidRounds,completeCampaigns:result.completeCampaigns,freeSpins:result.freeSpins,allRowsWithinRegisteredBudget:result.allRowsWithinRegisteredBudget}));
if(!result.allRowsWithinRegisteredBudget)process.exitCode=2;
