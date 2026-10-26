import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rtpInputs, validateRtpProof } from '../scripts/game-math/rtp-gate.mjs';

const game = 'studio-cosmic-escape';
const inputs = await rtpInputs(process.cwd(), game);
const original = JSON.parse(await readFile(resolve(inputs.policy.proof), 'utf8'));
const validate = proof => validateRtpProof(game, inputs, proof);

test('Cosmic qualifies complete capped rounds for every mode and stake with deterministic bounds', () => {
  assert(validate(original));
  assert.equal(original.method, 'bounded-analytical-cosmic');
  assert.equal(original.results.length, 26 * 4);
  assert.equal(original.scorerReplayChecks, 59049);
  assert.equal(original.serverReplayChecks, 26 * 4 * 64);
  for (const row of original.results) {
    assert(row.rtpBounds[0] >= .958 && row.rtpBounds[1] <= .962);
    assert(row.rtpBounds[0] <= row.rtpBounds[1]);
  }
});

test('Cosmic rejects altered analytical fractions, moment bounds and incomplete mode or stake evidence', () => {
  for (const mutate of [
    proof => { proof.results.pop(); },
    proof => { proof.results[1] = structuredClone(proof.results[0]); },
    proof => { proof.results[0].rtpBounds[1] = 1.01; proof.qualified = true; },
    proof => { proof.results[0].uncappedRtp.numerator = '1'; },
    proof => { proof.analysis.modes[2].cappedRtpBound[0] = .96; },
    proof => { proof.analysis.boardMomentUpper['ufo-invasion'][4] = 0; },
    proof => { proof.analysis.capBounds[2].bestUpperInStakes = 0; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => validate(changed));
  }
});

test('Cosmic rejects changed sources, missing server checks and incomplete natural bonus coverage', () => {
  for (const mutate of [
    proof => { proof.sourceHashes[Object.keys(proof.sourceHashes)[0]] = '0'.repeat(64); },
    proof => { proof.policySha256 = '0'.repeat(64); },
    proof => { proof.scorerReplayChecks--; },
    proof => { proof.serverReplayChecks--; },
    proof => { proof.serverReplay.coverage.pop(); },
    proof => { proof.serverReplay.coverage[1] = structuredClone(proof.serverReplay.coverage[0]); },
    proof => { proof.serverReplay.coverage[0].paidRounds--; },
    proof => { proof.serverReplay.coverage[0].spins = 0; },
    proof => { proof.serverReplay.seeds = []; },
    proof => { proof.serverReplay.counters.naturalAwards['15'] = 0; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => validate(changed));
  }
});

test('Cosmic cannot qualify by widening the unchanged target or dropping a mode or stake', () => {
  for (const mutate of [
    policy => { policy.target = .95; },
    policy => { policy.tolerance = .02; },
    policy => { policy.mathProfileVersion = 2; },
    policy => { policy.stakes.pop(); },
    policy => { policy.choices.pop(); },
    policy => { policy.serverReplayRoundsPerSeed = 1; },
  ]) {
    const changed = structuredClone(inputs); mutate(changed.policy);
    assert.throws(() => validateRtpProof(game, changed, structuredClone(original)));
  }
});

test('Cosmic requires independent model review after any mathematical source edit even with matching forged fingerprints', () => {
  for(const file of inputs.policy.sources){
    const changedInputs=structuredClone(inputs),changedProof=structuredClone(original);
    changedInputs.sourceHashes[file]='0'.repeat(64);
    changedProof.sourceHashes[file]='0'.repeat(64);
    assert.throws(()=>validateRtpProof(game,changedInputs,changedProof),/independently review the analytical model/);
  }
});
