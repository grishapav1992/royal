import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rtpInputs,validateRtpProof,checkGameRtp} from '../scripts/game-math/rtp-gate.mjs';
import {forestWalletDigest} from '../scripts/game-math/forest-heart-evidence.mjs';
const id='studio-forest-heart',inputs=await rtpInputs(process.cwd(),id);
const proof=JSON.parse(await readFile(inputs.policy.proof,'utf8'));
test('server qualification recomputes exact full rounds and verifies every stake, strategy and common-wallet scenario',()=>{
  assert(validateRtpProof(id,inputs,proof));assert.equal(proof.serverReplayChecks,10752);
  assert.equal(proof.results.length,84);assert.equal(proof.walletEvidence.cases.length,11);assert.equal(proof.clientReady,false);
  assert.equal(proof.analysis.optimalRtp.decimal,.95994233480111);
});
test('altered RTP, incomplete replay, missing financial cases and forged balanced totals are rejected',()=>{
  for(const mutate of [
    p=>p.results.pop(),p=>{p.results[0].rtp=1.1;},p=>{p.analysis.optimalRtp.numerator='1';},
    p=>p.serverReplay.coverage.pop(),p=>{p.serverReplay.coverage[1]=p.serverReplay.coverage[0];},
    p=>{p.serverReplay.coverage[0].paidRounds--;},p=>{p.serverReplay.entropyCensus.energyTickets--;},
    p=>{p.serverReplay.forcedMaximumChecks--;},p=>{p.serverReplay.naturalBonuses=0;},
    p=>p.walletEvidence.cases.pop(),p=>{p.walletEvidence.ledger[0].balance='0';},
    p=>{for(const row of p.walletEvidence.ledger){row.credits='0';row.debits='0';row.balance='0';}p.walletEvidence.sha256=forestWalletDigest(p.walletEvidence);},
    p=>{p.clientReady=true;},
  ]){const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateRtpProof(id,inputs,changed));}
});
test('changed core or server sources cannot be qualified by copying new fingerprints into an old proof',()=>{
  for(const source of ['src/shared/forestHeartMath.ts','src/shared/forestHeart.ts','server/games/forestHeart.ts']){
    const changed=structuredClone(inputs),receipt=structuredClone(proof);changed.sourceHashes[source]='0'.repeat(64);receipt.sourceHashes[source]='0'.repeat(64);
    assert.throws(()=>validateRtpProof(id,changed,receipt),/independently review/);
  }
  for(const mutate of [p=>{p.target=.99;},p=>{p.tolerance=.02;},p=>p.stakes.pop(),p=>p.choices.pop(),p=>{p.serverReplayRoundsPerSeed=1;}]){
    const changed=structuredClone(inputs);mutate(changed.policy);assert.throws(()=>validateRtpProof(id,changed,structuredClone(proof)));
  }
});
test('an unfinished client remains blocked even when all server and financial checks are qualified',async()=>{
  await assert.rejects(checkGameRtp(process.cwd(),[{gameId:id,rulesVersion:1,progressVersion:1}],[]),/Unfinished client/);
});
