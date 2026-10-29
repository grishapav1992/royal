import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rtpInputs,validateRtpProof} from '../scripts/game-math/rtp-gate.mjs';

test('roulette qualification binds every stake and number to exact server settlement',async()=>{
 const inputs=await rtpInputs(process.cwd(),'royal-roulette'),proof=JSON.parse(await readFile(inputs.policy.proof,'utf8'));
 assert(validateRtpProof('royal-roulette',inputs,proof));
 assert.equal(proof.results.length,41*4);
 assert.equal(proof.serverReplayChecks,41*4*(37+74+128));
 for(const mutate of [p=>p.results.pop(),p=>p.results[0].rtp=1,p=>p.results[0].totalReturnedUnits='37000',p=>p.results[0].sha256='0'.repeat(64),p=>p.serverReplay.pop(),p=>p.serverReplay[0].streams.pop(),p=>p.serverReplayChecks--,p=>p.sourceHashes['server/games/roulette.ts']='0'.repeat(64)]){
  const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof('royal-roulette',inputs,changed));
 }
});
