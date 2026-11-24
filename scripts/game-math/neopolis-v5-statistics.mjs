import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const NEOPOLIS_V5_METHOD = 'neopolis-paired-complete-round-v5';

export function neopolisV5Results(policy, streams) {
  const bytes = readFileSync(new URL('../../docs/game-math/qualifications/neopolis-v4.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), policy.v4ReferenceSha256);
  const reference = JSON.parse(bytes);
  const earlier = reference.precisionStateResults;
  assert.equal(reference.rulesVersion, 4);
  assert.equal(earlier.length, 48);
  assert.equal(streams.length, earlier.length * policy.seeds.length);

  return earlier.map(old => {
    const rows = streams.filter(row => row.choice === old.choice && row.state === old.state);
    assert.deepEqual(rows.map(row => row.seed), policy.seeds);
    const count = old.state === 15 ? policy.readyRoundsPerSeed : policy.roundsPerSeed;
    let samples = 0, delta = 0, deltaSquared = 0, actual = 0, entries = 0;
    const defeats = [0, 0, 0];
    for (const row of rows) {
      assert.equal(row.paidRounds, count);
      assert([row.delta, row.deltaSquared, row.actual].every(Number.isFinite));
      assert(row.deltaSquared >= 0 && row.actual >= 0);
      assert(Number.isSafeInteger(row.entries) && row.entries >= 0 && row.entries <= count);
      assert.equal(row.defeats.length, defeats.length);
      for (let i = 0; i < defeats.length; i++) {
        assert(Number.isSafeInteger(row.defeats[i]) && row.defeats[i] >= 0 && row.defeats[i] <= (row.defeats[i - 1] ?? row.entries));
        defeats[i] += row.defeats[i];
      }
      samples += count;
      delta += row.delta;
      deltaSquared += row.deltaSquared;
      actual += row.actual;
      entries += row.entries;
    }
    const change = delta / samples;
    const rtp = old.rtp + change;
    const previousSe = (old.interval95[1] - old.rtp) / 2.241402727604947;
    const deltaSe = Math.sqrt(Math.max(0, deltaSquared - samples * change ** 2) / ((samples - 1) * samples));
    const half = policy.confidenceZ * Math.hypot(previousSe, deltaSe);
    return { choice: old.choice, state: old.state, charges: old.charges, samples, previousSamples: old.samples,
      baselineRtp: old.rtp, change, rtp, interval95: [rtp - half, rtp + half], directRtp: actual / samples, entries, defeats };
  });
}
