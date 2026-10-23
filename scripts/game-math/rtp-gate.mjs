import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
// Git checkouts use CRLF on Windows and LF in Linux CI. Hash canonical text.
export const sourceDigest = value => digest(value.toString('utf8').replace(/\r\n/g,'\n'));
export async function changedLegacyProfiles(root,hashes,profiles) {
  const changed=new Set();
  for(const [file,hash] of Object.entries(hashes)) {
    if(sourceDigest(await readFile(resolve(root,file)))===hash)continue;
    const covering=Object.entries(profiles).filter(([,p])=>p.sources.includes(file));
    assert(covering.length,'Unqualified legacy mathematics changed: '+file+'. Register affected games and qualify the new rules.');
    for(const [id] of covering)changed.add(id);
  }
  return changed;
}
export async function rtpInputs(root, gameId) {
  const registry = JSON.parse(await readFile(resolve(root, 'scripts/game-math/rtp-policy.json'), 'utf8'));
  const policy = registry.profiles[gameId];
  assert(policy, 'No RTP qualification policy for ' + gameId);
  const sourceHashes = Object.fromEntries(await Promise.all([...policy.sources, 'scripts/game-math/rtp-simulation.mjs'].map(async file =>
    [file, sourceDigest(await readFile(resolve(root, file)))])));
  return { policy, sourceHashes, policySha256: digest(JSON.stringify(policy)) };
}
export function validateRtpProof(gameId, inputs, proof) {
  const { policy: p } = inputs;
  assert.equal(proof.schemaVersion, 1); assert.equal(proof.gameId, gameId);
  assert.equal(proof.rulesVersion, p.rulesVersion); assert.equal(proof.progressVersion, p.progressVersion);
  assert(p.target > 0 && p.target < 1 && p.maxUpper95 < 1 && p.tolerance <= .02);
  assert.equal(proof.policySha256, inputs.policySha256, 'RTP policy changed: rerun qualification');
  assert.deepEqual(proof.sourceHashes, inputs.sourceHashes, 'RTP source changed: rerun qualification');
  assert.equal(proof.results.length, p.stakes.length * p.choices.length, 'Every stake and choice must be qualified');
  const keys = new Set();
  for (const row of proof.results) {
    assert(p.choices.includes(row.choice) && p.stakes.includes(row.stakeUnits));
    const key = row.choice + ':' + row.stakeUnits; assert(!keys.has(key)); keys.add(key);
    assert([row.samples,row.paidRounds,row.reward,row.cost,row.rewardSquared,row.rewardCost,row.costSquared,row.rtp,...row.interval95].every(Number.isFinite));
    assert(row.samples > 1 && row.paidRounds >= p.minPaidRounds && row.cycles >= p.minCycles);
    assert.equal(row.cost, row.paidRounds);
    const mean = row.reward / row.cost;
    const residual = Math.max(0, row.rewardSquared - 2 * mean * row.rewardCost + mean * mean * row.costSquared);
    const half = 1.96 * Math.sqrt(row.samples * residual / (row.samples - 1)) / row.cost;
    assert(Math.abs(row.rtp - mean) < 1e-10 && Math.abs(row.interval95[0] - mean + half) < 1e-9 && Math.abs(row.interval95[1] - mean - half) < 1e-9, 'Invalid statistical evidence');
    assert(half > 0 && half <= p.maxHalfWidth95, 'RTP estimate is too imprecise');
    assert(Math.abs(mean - p.target) <= p.tolerance && mean + half <= p.maxUpper95, 'RTP is outside the approved budget: ' + key);
  }
  assert.equal(proof.streams.length, p.choices.length * p.seeds.length);
  for (const [index, choice] of p.choices.entries()) for (const seed of p.seeds) {
    const expected = gameId === 'studio-neopolis' ? seed + index * 1000003 : seed;
    assert(proof.streams.some(stream => stream.choice === choice && stream.seed === expected));
  }
  assert(proof.serverReplayChecks >= p.stakes.length * p.choices.length * 64, 'Server replay cross-check is missing');
  return true;
}
export async function checkGameRtp(root, catalog, selected = catalog.map(game => game.gameId)) {
  const registry = JSON.parse(await readFile(resolve(root, 'scripts/game-math/rtp-policy.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(resolve(root, 'scripts/game-math/rtp-legacy-baseline.json'), 'utf8'));
  assert.equal(digest(JSON.stringify(baseline.games)), '6c5d82f085ccda7ad8fa7e8d6a0c7bcc391448979be9f6d5ea30a72516af4a4e', 'The frozen legacy list cannot absorb new unqualified games');
  assert.equal(digest(JSON.stringify(baseline.sourceHashes)), '1b853f77bb9e572ee5444ed5072c2d1951d0ef0e30f983f5286a5aa4f1e641be', 'The frozen math baseline cannot be rewritten to bypass qualification');
  const changedProfiles=await changedLegacyProfiles(root,baseline.sourceHashes,registry.profiles);
  for (const gameId of ['studio-neopolis','studio-dracona']) assert(registry.profiles[gameId], 'A required RTP profile was removed: ' + gameId);
  for (const game of catalog) {
    const exemption = registry.nonWagered[game.gameId];
    assert(registry.profiles[game.gameId] || baseline.games.includes(game.gameId) || typeof exemption === 'string' && exemption.trim().length >= 20,
      'New module has no RTP qualification or documented non-wagered classification: ' + game.gameId);
  }
  let verified = 0;
  for (const gameId of new Set([...selected,...changedProfiles])) {
    if (!registry.profiles[gameId]) continue;
    const inputs = await rtpInputs(root, gameId), contract = catalog.find(game => game.gameId === gameId);
    assert(contract && contract.rulesVersion === inputs.policy.rulesVersion && contract.progressVersion === inputs.policy.progressVersion);
    const proof = JSON.parse(await readFile(resolve(root, inputs.policy.proof), 'utf8').catch(() => { throw Error('Missing RTP qualification for ' + gameId + '; run npm run qualify:rtp -- --game ' + gameId + ' --write-proof'); }));
    validateRtpProof(gameId, inputs, proof); verified++;
  }
  return { verified, legacyNotQualified: baseline.games.length };
}
