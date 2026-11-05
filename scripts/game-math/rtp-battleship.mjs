import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const BATTLESHIP_METHOD = 'exact-battleship-pot-v1';
const choices = [
  'left-win', 'right-win', 'cancel', 'expired', 'server', 'both-disconnect',
  'disconnect-left', 'disconnect-right', 'resign-left', 'resign-right', 'timeout-left', 'timeout-right',
];

function walletReplay(policy) {
  assert.equal(policy.target, .95);
  assert.equal(policy.refundReturn, 1);
  assert.equal(policy.commissionBasisPoints, 500);
  assert.deepEqual(policy.stakes, [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]);
  assert.deepEqual(policy.choices, choices);
  const hash = createHash('sha256');
  const results = [];
  for (const choice of choices) for (const stake of policy.stakes) {
    const winner = choice.endsWith('win') || /^(disconnect|resign|timeout)-/.test(choice)
      ? Number(choice === 'right-win' || choice.endsWith('-right')) : null;
    const fee = winner === null ? 0 : stake / 10;
    const credits = [0, 1].map(side => winner === null ? stake : side === winner ? stake * 2 - fee : 0);
    hash.update(JSON.stringify([choice, stake, credits, fee, choice === 'expired' ? 1 : 2]) + '\n');
    results.push({ choice, stakeCents: stake, feeCents: fee, creditsCents: credits, potReturn: winner === null ? 1 : .95 });
  }
  return { results, walletEvidence: { cases: results.length, sha256: hash.digest('hex') } };
}

export async function qualifyBattleship(policy) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--import', 'tsx', 'scripts/database-test.ts', '--import', 'tsx', 'scripts/game-math/battleship-wallet.ts',
  ], { cwd: fileURLToPath(new URL('../../', import.meta.url)) });
  const line = stdout.split('\n').find(row => row.startsWith('BATTLESHIP_WALLET '));
  assert(line, 'Missing Battleship wallet replay');
  const result = walletReplay(policy);
  assert.deepEqual(JSON.parse(line.slice('BATTLESHIP_WALLET '.length)), result.walletEvidence);
  return { method: BATTLESHIP_METHOD, ...result, serverReplayChecks: result.walletEvidence.cases,
    interpretation: 'Exact aggregate pot return is 95% on a decisive result and 100% on refunds. Individual return depends on play.' };
}

export function validateBattleshipProof(inputs, proof) {
  assert.equal(proof.gameId, 'battleship');
  assert.equal(proof.method, BATTLESHIP_METHOD);
  assert.equal(proof.rulesVersion, 1);
  assert.equal(proof.progressVersion, 1);
  const result = walletReplay(inputs.policy);
  assert.deepEqual(proof.results, result.results);
  assert.deepEqual(proof.walletEvidence, result.walletEvidence);
  assert.equal(proof.serverReplayChecks, result.walletEvidence.cases);
  return true;
}
