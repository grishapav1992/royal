import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { rtpInputs, validateRtpProof, checkGameRtp, sourceDigest, changedLegacyProfiles } from '../scripts/game-math/rtp-gate.mjs';
const root = process.cwd();
test('virtual PvP qualification covers the complete stake range and rejects missing cases and altered returns',async()=>{
 for(const id of ['hockey','pool','chess','durak','transfer-durak','crazy-eights','tsu-e-fa']){
  const inputs=await rtpInputs(root,id),proof=JSON.parse(await readFile(resolve(root,inputs.policy.proof),'utf8'));
  assert(validateRtpProof(id,inputs,proof));assert.equal(proof.serverReplayChecks,4991*8*3);
  for(const mutate of [p=>p.results.pop(),p=>p.results[0].cases--,p=>p.results[0].feeUnits='0',p=>p.results[2].sha256=p.results[0].sha256,p=>p.serverReplayChecks--]){
   const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof(id,inputs,changed));
  }
  if(id==='tsu-e-fa'){
   for(const mutate of [p=>{delete p.rulesCoverage;},p=>{p.rulesCoverage.cases--;}]){
    const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof(id,inputs,changed));
   }
  }
 }
});
test('source fingerprints survive Windows and Linux checkouts and detect mathematical edits',()=>{
  assert.equal(sourceDigest(Buffer.from('pay=1;\r\n')),sourceDigest(Buffer.from('pay=1;\n')));
  assert.notEqual(sourceDigest(Buffer.from('pay=2;\n')),sourceDigest(Buffer.from('pay=1;\n')));
});

test('Tsu-e-fa qualifies the agreed 3/5/7 targets and retains accepted rules 1',async()=>{
  for(const rules of [1,2]){
    const inputs=await rtpInputs(root,'tsu-e-fa',rules),proof=JSON.parse(await readFile(resolve(root,inputs.policy.proof),'utf8'));
    assert(validateRtpProof('tsu-e-fa',inputs,proof));
    assert.equal(proof.rulesCoverage.cases,rules===1?72:1494);
    if(rules===2){const altered=structuredClone(proof);altered.rulesCoverage.targets=[2,5,7];assert.throws(()=>validateRtpProof('tsu-e-fa',inputs,altered));}
  }
});
function proofFor(id, inputs, mean = inputs.policy.target) {
  const p = inputs.policy, cycles = p.minCycles || p.minPaidRounds;
  const cost = p.minCycles ? p.minPaidRounds / cycles : 1, reward = mean * cost, variance = 1;
  const results = p.choices.flatMap(choice => p.stakes.map(stakeUnits => {
    const half = (p.confidenceZ ?? 1.96) * Math.sqrt(cycles * variance / (cycles - 1)) / (Math.sqrt(cycles) * cost);
    return { choice, stakeUnits, cycles: p.minCycles, samples: cycles, paidRounds: cycles * cost, cost: cycles * cost,
      reward: reward * cycles, rewardSquared: (reward * reward + variance) * cycles,
      rewardCost: reward * cost * cycles, costSquared: cost * cost * cycles, rtp: mean, interval95: [mean-half,mean+half] };
  }));
  const proof = { schemaVersion: 1, gameId: id, rulesVersion: p.rulesVersion, progressVersion: p.progressVersion,
    sourceHashes: structuredClone(inputs.sourceHashes), policySha256: inputs.policySha256, results,
    streams: p.choices.flatMap((choice,index) => p.seeds.map(seed => ({choice,seed:id==='studio-neopolis'?seed+index*1000003:seed}))),
    serverReplayChecks: p.stakes.length*p.choices.length*64 };
  if (p.method==='neopolis-variable-stake-conditional-v4') {
    proof.method=p.method; proof.serverReplayChecks*=16;
    const stateMoment=(count,cost=1)=>{
      const reward=mean*cost,half=(p.confidenceZ??1.96)/Math.sqrt(count-1)/cost;
      return {samples:count,paidRounds:count*cost,reward:reward*count,cost:cost*count,rewardSquared:(reward*reward+1)*count,
        rewardCost:reward*cost*count,costSquared:cost*cost*count,rtp:mean,interval95:[mean-half,mean+half]};
    };
    proof.stateResults=p.choices.flatMap((choice,index)=>Array.from({length:16},(_,state)=>{
      const charges=[3,3,3],others=[0,1,2].filter(i=>i!==index);charges[others[0]]=Math.floor(state/4);charges[others[1]]=state%4;
      const count=p.conditionalSeeds.length*(state===15?p.conditionalReadyRoundsPerSeed:p.conditionalRoundsPerSeed);
      return p.stakes.map(stakeUnits=>({choice,state,charges,stakeUnits,...stateMoment(count)}));
    }).flat());
    proof.conditionalStreams=p.choices.flatMap((hero,index)=>Array.from({length:16},(_,state)=>p.conditionalSeeds.map(seed=>({hero,state,seed:seed+index*1000003+state*7919,paidRounds:state===15?p.conditionalReadyRoundsPerSeed:p.conditionalRoundsPerSeed}))).flat());
    proof.stakePolicyResults=p.choices.flatMap(choice=>p.stakePolicies.filter(value=>value!=='fixed').flatMap(stakePolicy=>p.stakes.map(stakeUnits=>({choice,stakePolicy,stakeUnits,cycles:p.minCycles,...stateMoment(p.minCycles,p.minPaidRounds/p.minCycles)}))));
  }
  return proof;
}
for(const id of ['studio-neopolis','studio-dracona','studio-afterglow']) {
  test(id+' accepts complete, precise evidence for every declared stake and choice',async()=>{
    const inputs=await rtpInputs(root,id); assert(validateRtpProof(id,inputs,proofFor(id,inputs)));
  });
  test(id+' rejects the historical excessive return even with qualified=true',async()=>{
    const inputs=await rtpInputs(root,id), proof=proofFor(id,inputs,id==='studio-neopolis'?12.6:1.93);
    proof.qualified=true; assert.throws(()=>validateRtpProof(id,inputs,proof),/outside the approved budget/);
  });
  test(id+' rejects changed math, missing choices, duplicated stakes and forged totals',async()=>{
    const inputs=await rtpInputs(root,id), original=proofFor(id,inputs);
    for(const mutate of [
      p=>{p.sourceHashes[Object.keys(p.sourceHashes)[0]]='0'.repeat(64);},
      p=>{p.policySha256='0'.repeat(64);}, p=>{p.results.pop();}, p=>{p.results[1]=p.results[0];},
      p=>{p.results[0].reward*=2;}, p=>{p.results[0].paidRounds=1;}, p=>{p.streams=[];}, p=>{p.serverReplayChecks=0;}
    ]){const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateRtpProof(id,inputs,changed));}
  });
}
test('a new module cannot inherit the unqualified legacy status',async()=>{
  await assert.rejects(checkGameRtp(root,[{gameId:'studio-unreviewed-slot',rulesVersion:1,progressVersion:1}],[]),/New module has no RTP/);
});
test('expanding the frozen legacy list is rejected',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'royal-rtp-test-'));
  try {
    await mkdir(join(folder,'scripts/game-math'),{recursive:true});
    for(const file of ['rtp-policy.json','rtp-legacy-baseline.json'])await writeFile(join(folder,'scripts/game-math',file),await readFile(join(root,'scripts/game-math',file)));
    const path=join(folder,'scripts/game-math/rtp-legacy-baseline.json'),baseline=JSON.parse(await readFile(path,'utf8'));
    baseline.games.push('studio-unreviewed-slot');await writeFile(path,JSON.stringify(baseline));
    await assert.rejects(checkGameRtp(folder,[],[]),/frozen legacy list/);
    baseline.games.pop();baseline.sourceHashes={};await writeFile(path,JSON.stringify(baseline));
    await assert.rejects(checkGameRtp(folder,[],[]),/frozen math baseline/);
    await writeFile(join(folder,'math.ts'),'pay=2;\n');
    const hashes={'math.ts':sourceDigest(Buffer.from('pay=1;\n'))};
    await assert.rejects(changedLegacyProfiles(folder,hashes,{}),/Unqualified legacy mathematics changed/);
    assert.deepEqual([...await changedLegacyProfiles(folder,hashes,{'known-game':{sources:['math.ts']}})],['known-game']);
  } finally {
    const target=resolve(folder);assert.equal(dirname(target),resolve(tmpdir()));assert(basename(target).startsWith('royal-rtp-test-'));
    await rm(target,{recursive:true,force:true,maxRetries:15,retryDelay:200});
  }
});

test('combat exact qualification covers every stake and decisive or refunded outcome and rejects forged evidence',async()=>{
  const inputs=await rtpInputs(root,'mortal-kombat');
  const proof=JSON.parse(await readFile(resolve(root,inputs.policy.proof),'utf8'));
  assert(validateRtpProof('mortal-kombat',inputs,proof));assert.equal(proof.serverReplayChecks,144);
  for(const mutate of [
    row=>{row.results.pop();},row=>{row.results[1]=row.results[0];},row=>{row.results[0].feeUnits='0';},
    row=>{row.results[0].playerUnits=['0','2000000'];},row=>{row.results[2].returnRatio=.95;},
    row=>{row.sourceHashes={};},row=>{row.serverReplayChecks=0;}
  ]){const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof('mortal-kombat',inputs,changed));}
});


test('Neopolis variable-stake qualification requires every conditional state and adaptive policy', async()=>{
  const inputs=await rtpInputs(root,'studio-neopolis'),original=proofFor('studio-neopolis',inputs);
  assert(validateRtpProof('studio-neopolis',inputs,original));
  for(const mutate of [
    p=>p.stateResults.pop(),p=>{p.stateResults[1]=p.stateResults[0];},p=>{p.stateResults[0].charges=[3,3,3];},
    p=>{p.stateResults[0].reward*=2;},p=>p.conditionalStreams.pop(),p=>p.stakePolicyResults.pop(),
    p=>{p.stakePolicyResults[0].reward*=2;},p=>{p.serverReplayChecks/=16;}
  ]){const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateRtpProof('studio-neopolis',inputs,changed));}
});
