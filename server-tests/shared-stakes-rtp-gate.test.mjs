import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{fileURLToPath}from'node:url';
import{stakeInputs}from'../scripts/game-math/rtp-gate.mjs';import{validateStakeProof}from'../scripts/game-math/rtp-stakes.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),registry=JSON.parse(await readFile(new URL('../scripts/game-math/rtp-policy.json',import.meta.url),'utf8'));
test('all 18 live games qualify every shared denomination and every declared paid-round choice',async()=>{
 assert.equal(Object.keys(registry.stakePolicies).length,18);
 for(const game of Object.keys(registry.stakePolicies)){
  const inputs=await stakeInputs(root,game),proof=JSON.parse(await readFile(new URL('../'+inputs.policy.proof,import.meta.url),'utf8'));
  assert.deepEqual(inputs.policy.stakes,[10,20,50,100,200,500,1000,2000,5000]);assert(validateStakeProof(game,inputs,proof));
  for(const edit of [p=>p.results[0].stakeUnits=1,p=>p.precisionLaw.stopping='',p=>p.walletEvidence.clientVerified=false,p=>p.replay.coverage.pop()]){
   const bad=structuredClone(proof);edit(bad);assert.throws(()=>validateStakeProof(game,inputs,bad),game);
  }
  const changed=structuredClone(inputs);changed.sourceHashes['server/demoExpansion.ts']='0'.repeat(64);assert.throws(()=>validateStakeProof(game,changed,proof));
 }
});
