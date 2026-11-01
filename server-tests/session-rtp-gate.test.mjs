import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rtpInputs,validateRtpProof } from '../scripts/game-math/rtp-gate.mjs';
import { hiloQualificationEvidence } from '../scripts/game-math/rtp-hilo.mjs';
import { keysMetadataEvidence } from '../scripts/game-math/rtp-keys.mjs';

for(const gameId of ['github-hilo','variant-keys'])test(gameId+' proof covers every wallet stake and stopping choice and rejects altered evidence',async()=>{
  const inputs=await rtpInputs(process.cwd(),gameId),proof=JSON.parse(await readFile(inputs.policy.proof,'utf8'));
  assert(validateRtpProof(gameId,inputs,proof));assert.equal(proof.results.length,gameId==='github-hilo'?192:288);
  for(const mutate of [
    p=>p.results.pop(),p=>p.results[0].rtp=1,p=>p.results[0].rtpBounds[1]=1,
    p=>p.results[0].sha256='0'.repeat(64),p=>p.serverReplay.pop(),p=>p.serverReplay[0].streams.pop(),
    p=>p.serverReplay[0].streams[0].sha256='0'.repeat(64),p=>p.serverReplayChecks--,
    p=>p.sourceHashes[Object.keys(p.sourceHashes)[0]]='0'.repeat(64),
  ]){const altered=structuredClone(proof);mutate(altered);assert.throws(()=>validateRtpProof(gameId,inputs,altered));}
});
test('Hi-Lo exact backward induction covers every first rank, adaptive continuation and integer floor',async()=>{
  const{policy}=await rtpInputs(process.cwd(),'github-hilo'),evidence=hiloQualificationEvidence(policy);
  assert.equal(new Set(evidence.results.map(row=>row.choice)).size,24);
  for(const row of evidence.results){
    assert(row.rtpBounds[0]>.99-1/row.stakeUnits);assert(row.rtpBounds[1]<=.99);
    for(const state of row.states){assert(state.options.some(option=>option.action==='cashout'));assert(state.options.length>=2);}
  }
  const altered=structuredClone(policy);altered.target=1;assert.throws(()=>hiloQualificationEvidence(altered));
});
test('keys metadata exception reproduces frozen bytes and rejects any other game or mathematical change',async()=>{
  const source=await readFile('src/shared/casinoNextVariants.ts','utf8');assert(keysMetadataEvidence(source));
  assert(keysMetadataEvidence(source.replaceAll('\n','\r\n')));
  for(const altered of [source.replace("'variant-color':'github-hilo'","'variant-color':'variant-color'"),source.replace('98n*2n','99n*2n'),source.replace("'variant-keys':'variant-keys'","'variant-keys':'royal-mines'")])
    assert.throws(()=>keysMetadataEvidence(altered));
});
