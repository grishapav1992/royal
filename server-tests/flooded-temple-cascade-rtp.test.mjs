import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {rtpInputs,validateRtpProof} from '../scripts/game-math/rtp-gate.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),id='studio-flooded-temple';
test('separate inputs qualify cascade rules two without substituting the room proof',async()=>{
  const rooms=await rtpInputs(root,id,1),cascades=await rtpInputs(root,id,2);
  assert.equal(rooms.policy.rulesVersion,1);assert.equal(cascades.policy.rulesVersion,2);assert.notEqual(rooms.policy.proof,cascades.policy.proof);
  const proof=JSON.parse(await readFile(new URL('../'+cascades.policy.proof,import.meta.url),'utf8'));
  assert(validateRtpProof(id,cascades,proof));assert.throws(()=>validateRtpProof(id,rooms,proof));
  await assert.rejects(rtpInputs(root,id,3),/No RTP/);
});
test('cascade qualification rejects omitted seeds, altered intervals, missing stakes and source fingerprints',async()=>{
  const inputs=await rtpInputs(root,id,2),proof=JSON.parse(await readFile(new URL('../'+inputs.policy.proof,import.meta.url),'utf8'));
  for(const mutate of[p=>p.streams.pop(),p=>p.streams[0].interval95[0]=0,p=>p.results.pop(),p=>p.serverReplay.coverage[0].forcedBonusRounds=0,p=>p.analysis.distinctPaidRounds++,p=>p.sourceHashes['src/shared/floodedTempleCascadeMath.ts']='0'.repeat(64)]){
    const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof(id,inputs,changed));
  }
});
