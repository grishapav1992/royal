import assert from 'node:assert/strict';
import { createTsuEFa, playTsuEFa, publicTsuEFa } from '../../server/pvp/tsu-e-fa.ts';
import { qualifyVirtualPvp } from './rtp-virtual-pvp.mjs';

export function qualifyTsuEFa(gameId, policy) {
  assert.equal(gameId, 'tsu-e-fa');
  // All reachable pre-round score states. Ties are self-loops; every decisive transition increments one score.
  const signs = ['rock', 'scissors', 'paper'];
  const expected = [[null, 0, 1], [1, null, 0], [0, 1, null]];
  let cases = 0, privacyChecks = 0;
  const targets=policy.rulesVersion===1?[2]:policy.targetWins;
  for(const target of targets)for (let left = 0; left < target; left++) for (let right = 0; right < target; right++) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (const first of [0, 1]) {
      const seed = createTsuEFa(target,policy.rulesVersion); seed.score = [left, right];
      const choices = [signs[a], signs[b]], move = side => ({ kind: 'choose', round: 1, choice: choices[side] });
      const locked = playTsuEFa(seed, first, move(first));
      const opponent = publicTsuEFa(locked, 1 - first);
      assert.equal(opponent.choice, null); assert.equal(opponent.last, null); privacyChecks += 2;
      const result = playTsuEFa(locked, 1 - first, move(1 - first));
      const winner = expected[a][b], scores = [left, right]; if (winner !== null) scores[winner]++;
      assert.deepEqual(result.score, scores); assert.equal(result.last.winner, winner);
      assert.deepEqual(result.last.choices, choices);
      const finished = scores.includes(target);
      assert.equal(result.phase, finished ? 'finished' : 'playing');
      assert.equal(result.winner, finished ? winner : null);
      assert.equal(result.round, finished ? 1 : 2);
      assert.deepEqual(result.choices, [null, null]);
      cases++;
    }
  }
  return { ...qualifyVirtualPvp(gameId, policy), rulesCoverage: { ...(policy.rulesVersion===2?{targets}:{}),scores: targets.reduce((sum,target)=>sum+target*target,0), pairsPerScore: 9, orders: 2, cases, privacyChecks } };
}
