import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rtpInputs, validateRtpProof } from '../scripts/game-math/rtp-gate.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('totalizator qualification binds fee, complete allocation coverage, exact results and common-wallet evidence',async()=>{
  const inputs=await rtpInputs(root,'flag-tote');const proof=JSON.parse(await readFile(new URL('../'+inputs.policy.proof,import.meta.url),'utf8'));
  assert(validateRtpProof('flag-tote',inputs,proof));
  for(const mutate of [p=>p.results.pop(),p=>p.results[0].returnedUnits='0',p=>p.streams[0].sha256='0'.repeat(64),p=>p.wallet.failed=1,p=>p.serverReplayChecks--]){
    const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof('flag-tote',inputs,changed));
  }
  assert.throws(()=>validateRtpProof('flag-tote',{...inputs,policy:{...inputs.policy,commissionBasisPoints:1000}},proof));
});
