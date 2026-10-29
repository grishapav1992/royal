import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rtpInputs,validateRtpProof} from '../scripts/game-math/rtp-gate.mjs';
import {templeEvidence,calibrationWeights} from '../scripts/game-math/rtp-temple-model.mjs';
test('Temple exact proof covers all six stakes, all strategies and the complete decision graph',async()=>{
  const input=await rtpInputs(process.cwd(),'studio-flooded-temple',1),proof=JSON.parse(await readFile(input.policy.proof,'utf8'));
  assert(validateRtpProof('studio-flooded-temple',input,proof));
  assert.equal(proof.results.length,30);assert.equal(proof.analysis.baseCases,256);assert.equal(proof.analysis.bonusCases,16);assert.equal(proof.analysis.decisionStates,1032);
  const e=templeEvidence(input.policy);assert.deepEqual(e.results.filter(r=>r.choice==='optimal').map(r=>r.rtpFraction),Array(6).fill({numerator:'24',denominator:'25'}));
  assert.deepEqual(e.analysis.baseRtp,{numerator:'9',denominator:'10'});assert.deepEqual(e.analysis.bonusProbability,{numerator:'1',denominator:'50'});
  assert.equal(proof.serverReplayChecks,22452);assert(proof.analysis.actualMaximumHundredths<proof.analysis.capHundredths);
  assert.deepEqual(calibrationWeights().base,[367200,220535,23653,612]);
});
test('Temple gate rejects stale sources, missing choices, a forged return and incomplete server evidence',async()=>{
  const input=await rtpInputs(process.cwd(),'studio-flooded-temple',1),proof=JSON.parse(await readFile(input.policy.proof,'utf8'));
  for(const change of [p=>p.results.pop(),p=>p.results[1]=p.results[0],p=>p.results[0].rtp=1.5,p=>p.analysis.decisionStates--,p=>p.serverReplay.coverage.pop(),p=>p.serverReplay.streams[0].sha256='0'.repeat(64),p=>p.serverReplayChecks--,p=>p.sourceHashes={...p.sourceHashes,'server/games/floodedTemple.ts':'0'.repeat(64)}]){
    const altered=structuredClone(proof);change(altered);assert.throws(()=>validateRtpProof('studio-flooded-temple',input,altered));
  }
});
test('Temple qualification cannot drop a strategy, fingerprints, independent seeds or replay coverage',async()=>{
  const {policy}=await rtpInputs(process.cwd(),'studio-flooded-temple',1);
  for(const mutate of [p=>p.sources.pop(),p=>p.qualificationSource='other.mjs',p=>p.seeds=[],p=>p.seeds=[p.seeds[0],p.seeds[0]],p=>p.serverReplayRoundsPerSeed=0,p=>p.choices.pop(),p=>p.stakes.pop(),p=>p.target=.99]){
    const changed=structuredClone(policy);mutate(changed);assert.throws(()=>templeEvidence(changed));
  }
});
