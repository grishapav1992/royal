import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { rtpInputs, validateRtpProof, checkGameRtp, sourceDigest, changedLegacyProfiles } from '../scripts/game-math/rtp-gate.mjs';
const root = process.cwd();
test('source fingerprints survive Windows and Linux checkouts and detect mathematical edits',()=>{
  assert.equal(sourceDigest(Buffer.from('pay=1;\r\n')),sourceDigest(Buffer.from('pay=1;\n')));
  assert.notEqual(sourceDigest(Buffer.from('pay=2;\n')),sourceDigest(Buffer.from('pay=1;\n')));
});
function proofFor(id, inputs, mean = inputs.policy.target) {
  const p = inputs.policy, cycles = p.minCycles || p.minPaidRounds;
  const cost = p.minCycles ? p.minPaidRounds / cycles : 1, reward = mean * cost, variance = 1;
  const results = p.choices.flatMap(choice => p.stakes.map(stakeUnits => {
    const half = 1.96 * Math.sqrt(cycles * variance / (cycles - 1)) / (Math.sqrt(cycles) * cost);
    return { choice, stakeUnits, cycles: p.minCycles, samples: cycles, paidRounds: cycles * cost, cost: cycles * cost,
      reward: reward * cycles, rewardSquared: (reward * reward + variance) * cycles,
      rewardCost: reward * cost * cycles, costSquared: cost * cost * cycles, rtp: mean, interval95: [mean-half,mean+half] };
  }));
  return { schemaVersion: 1, gameId: id, rulesVersion: p.rulesVersion, progressVersion: p.progressVersion,
    sourceHashes: structuredClone(inputs.sourceHashes), policySha256: inputs.policySha256, results,
    streams: p.choices.flatMap((choice,index) => p.seeds.map(seed => ({choice,seed:id==='studio-neopolis'?seed+index*1000003:seed}))),
    serverReplayChecks: p.stakes.length*p.choices.length*64 };
}
for(const id of ['studio-neopolis','studio-dracona']) {
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
