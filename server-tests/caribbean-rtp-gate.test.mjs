import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { rtpInputs, validateRtpProof } from '../scripts/game-math/rtp-gate.mjs';
import { caribbeanQualificationEvidence } from '../scripts/game-math/rtp-caribbean.mjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const inputs = await rtpInputs(root,'studio-caribbean-treasures');
const proof = JSON.parse(await readFile(new URL('../docs/game-math/qualifications/caribbean-treasures-v1.json',import.meta.url),'utf8'));
test('complete-round qualification covers 64 mode, line and stake combinations and replays 4096 paid rounds', () => {
  assert(validateRtpProof('studio-caribbean-treasures',inputs,proof));
  assert.equal(proof.results.length,64);
  assert.equal(proof.serverReplayChecks,4096);
  assert(proof.results.every(row => row.rtp.value >= .9595 && row.rtp.value <= .9605));
  assert.deepEqual(caribbeanQualificationEvidence(inputs.policy).results,proof.results);
});
test('edited expectations and omitted coverage cannot pass the RTP gate', () => {
  for (const edit of [
    p => { p.results[0].rtp.value = .96; },
    p => { p.results.pop(); },
    p => { p.results[0].costUnits = '1'; },
    p => { p.results[0].maximumSpins = 100; },
    p => { p.analysis.formula = 'changed'; },
    p => { p.serverReplay.coverage.pop(); },
    p => { p.serverReplay.coverage[0].paidRounds = 1; },
    p => { p.serverReplay.coverage[0].spins = 999999; },
    p => { p.serverReplay.coverage[0].sha256 = 'not-a-digest'; },
    p => { p.serverReplay.seeds = [1,2]; },
    p => { p.serverReplay.naturalEntries = 0; },
    p => { p.serverReplayChecks--; },
  ]) {
    const bad = structuredClone(proof); edit(bad);
    assert.throws(() => validateRtpProof('studio-caribbean-treasures',inputs,bad));
  }
});
test('changed mathematical source or policy needs new review and qualification', () => {
  const changed = structuredClone(inputs);
  changed.sourceHashes['src/shared/caribbeanTreasures.ts'] = '0'.repeat(64);
  assert.throws(() => validateRtpProof('studio-caribbean-treasures',changed,proof));
  const bad = structuredClone(proof);
  bad.sourceHashes = changed.sourceHashes;
  assert.throws(() => validateRtpProof('studio-caribbean-treasures',changed,bad));
  const policy = structuredClone(inputs.policy);
  policy.stakes.push(2000);
  assert.throws(() => caribbeanQualificationEvidence(policy));
});
test('prices include integer rounding and each tactic is covered at each active-line preset', () => {
  for (const lines of [1,5,10,20]) for (const stake of [100,200,500,1000]) {
    const find = mode => proof.results.find(row => row.choice === 'lines-' + lines + '-' + mode && row.stakeUnits === stake);
    const normalRaid = find('normal-raid'), normalFlagship = find('normal-flagship');
    const raid = find('buy-raid'), flagship = find('buy-flagship');
    assert.equal(raid.costUnits,flagship.costUnits);
    assert.equal(normalRaid.costUnits,String(lines * stake));
    assert.equal(normalFlagship.costUnits,String(lines * stake));
    assert.equal(normalRaid.maximumSpins,15);
    assert.equal(normalFlagship.maximumSpins,7);
    assert(raid.rtp.value <= .96 && flagship.rtp.value <= .96);
  }
});
