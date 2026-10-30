import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rtpInputs, validateRtpProof } from '../scripts/game-math/rtp-gate.mjs';
import { qualifyRewardSlots, rewardSlotEvidence } from '../scripts/game-math/rtp-reward-slots.mjs';

for (const [gameId, checks, target] of [['royal-coins', 2527, .96], ['royal-fruits', 89152, .97]]) {
  test(gameId + ' exact qualification covers every paid stake and every configured reward nominal', async () => {
    const inputs = await rtpInputs(process.cwd(), gameId);
    const proof = { schemaVersion: 1, gameId, rulesVersion: 1, progressVersion: 1,
      sourceHashes: inputs.sourceHashes, policySha256: inputs.policySha256, ...await qualifyRewardSlots(gameId, inputs.policy) };
    assert(validateRtpProof(gameId, inputs, proof));
    assert.equal(proof.results.length, 9); assert.equal(proof.serverReplayChecks, checks);
    for (const row of proof.results) {
      assert.equal(row.nominalReturn, target);
      if (row.choice === 'reward') {
        assert.equal(row.totalPlayerCostUnits, '0'); assert.equal(row.rtp, null); assert.equal(row.rtpBounds, null);
        assert(row.expectedPromotionalPayoutUnits);
      } else assert.equal(row.rtp, target);
    }
    for (const mutate of [
      p => p.results.pop(),
      p => p.results[0].totalReturnedUnits = '0',
      p => p.results.at(-1).totalPlayerCostUnits = '100',
      p => p.results.at(-1).rtp = 1,
      p => p.results.at(-1).nominalReturn = 1,
      p => p.results[0].sha256 = '0'.repeat(64),
      p => p.integerBoundaries.pop(),
      p => p.integerBoundaries[0].stakeUnits = '2',
      p => p.serverReplay.pop(),
      p => p.serverReplay[0].streams.pop(),
      p => p.serverReplay[0].streams[0].sha256 = '0'.repeat(64),
      p => p.serverReplayChecks--,
      p => p.sourceHashes['server/progression/freeSpins.ts'] = '0'.repeat(64),
      p => p.policySha256 = '0'.repeat(64),
    ]) {
      const changed = structuredClone(proof); mutate(changed);
      assert.throws(() => validateRtpProof(gameId, inputs, changed));
    }
    const sourceChanged = structuredClone(inputs);
    sourceChanged.sourceHashes['server/progression/store.ts'] = '1'.repeat(64);
    assert.throws(() => validateRtpProof(gameId, sourceChanged, proof), /RTP source changed/);
    const policyChanged = structuredClone(inputs);
    policyChanged.policy.rewardStakes.pop();
    policyChanged.policySha256 = createHash('sha256').update(JSON.stringify(policyChanged.policy)).digest('hex');
    assert.throws(() => validateRtpProof(gameId, policyChanged, proof), /RTP policy changed/);
    assert.throws(() => rewardSlotEvidence(gameId, { ...inputs.policy, paidStakes: [1000] }));
    assert.throws(() => rewardSlotEvidence(gameId, { ...inputs.policy, rewardStakes: [10] }));
  });
}
