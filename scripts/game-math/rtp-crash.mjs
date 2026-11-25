import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { STAKE_PRECISION_METHOD, precisionLaw } from './rtp-stakes.mjs';
import { qualifyManualStakes, validateManualStakes, walletStakes } from './manual-stakes.mjs';
import { CRASH_RTP_PERCENT, CRASH_TICKETS, crashPointFromTicket, multiplierAtElapsed, secondsToReachMultiplier } from '../../server/games/rush/crash.ts';

/**
 * Exact qualification of LAST EXIT. The previous shared model asserted 0.99 as a constant
 * and never read the generator. This one counts tickets through the production functions.
 */
export const CRASH_KIND = 'crash-exact';
const CAP = 100, stakes = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000], SCALE = 10n ** 9n;
// Nine places keep the evidence identical when a runtime rounds one logarithm differently.
const decimal = (numerator, denominator) => Number((numerator * SCALE * 2n + denominator) / (denominator * 2n)) / Number(SCALE);

/** Tickets are ordered: a larger ticket never crashes later. Returns the number of tickets that satisfy a monotone test. */
function countTickets(survives) {
  // Ticket 0 is the single exception of the law and crashes at 1.00x.
  if (!survives(1)) return 0;
  let low = 1, high = CRASH_TICKETS;
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (survives(middle)) low = middle; else high = middle; }
  return low;
}

export function crashModel() {
  assert.equal(crashPointFromTicket(0), 1, 'The zero ticket must crash at once');
  const point = ticket => Math.min(CAP, crashPointFromTicket(ticket)), deadline = ticket => secondsToReachMultiplier(point(ticket)) * 1000;
  const tickets = BigInt(CRASH_TICKETS), last = Math.ceil(secondsToReachMultiplier(CAP) * 1000) - 1;
  let minimum, maximum, previous = CRASH_TICKETS;
  // The exact server settlement of every integer millisecond a manual exit can be accepted at.
  for (let ms = 0; ms <= last; ms++) {
    const count = countTickets(ticket => ms < deadline(ticket)); assert(count <= previous, 'Survival must not rise with time'); previous = count;
    const cents = Math.floor(Math.min(CAP, multiplierAtElapsed(ms / 1000)) * 100);
    const row = { ms, cents, numerator: BigInt(cents) * BigInt(count), denominator: 100n * tickets };
    if (!minimum || row.numerator < minimum.numerator) minimum = row;
    if (!maximum || row.numerator > maximum.numerator) maximum = row;
  }
  const cap = countTickets(ticket => point(ticket) === CAP), instant = CRASH_TICKETS - countTickets(ticket => crashPointFromTicket(ticket) > 1);
  // Reaching probability of every displayed hundredth, against the rational law.
  for (let hundredths = 101; hundredths <= CAP * 100; hundredths++) {
    const counted = BigInt(countTickets(ticket => crashPointFromTicket(ticket) >= hundredths / 100)), law = BigInt(CRASH_RTP_PERCENT) * tickets / BigInt(hundredths);
    assert(counted - law <= 1n && law - counted <= 1n, 'Crash law differs at ' + hundredths);
  }
  const show = row => ({ atMs: row.ms, paidCents: row.cents, rtp: decimal(row.numerator, row.denominator) });
  return {
    tickets: String(CRASH_TICKETS), acceptedMilliseconds: last + 1, verifiedHundredths: CAP * 100 - 100,
    minimum: show(minimum), maximum: show(maximum),
    automaticCap: { multiplier: CAP, rtp: decimal(BigInt(cap) * BigInt(CAP), tickets) },
    instantCrash: { probability: decimal(BigInt(instant), tickets) },
    stopping: 'Every accepted millisecond returns at most the maximum row, and the next state depends only on survival to the public time. Any adaptive exit rule is a mixture of these rows and cannot exceed it.',
  };
}

function results(p, model) {
  const low = Math.min(model.minimum.rtp, model.automaticCap.rtp), high = Math.max(model.maximum.rtp, model.automaticCap.rtp);
  assert(low >= p.target - p.tolerance && high <= p.target + p.tolerance, 'LAST EXIT RTP is outside its policy: ' + low + ' to ' + high);
  assert(high <= p.target + 1e-9, 'No exit may return more than the target');
  assert.equal(CRASH_RTP_PERCENT / 100, p.target, 'The generator and the policy target differ');
  return stakes.map(stakeUnits => ({ choice: p.choices[0], stakeUnits, kind: 'exact-enumeration', rtp: null, rtpBounds: [low, high] }));
}
function checkPolicy(game, p) {
  assert.equal(game, 'github-crash'); assert.equal(p.kind, CRASH_KIND); assert.equal(p.method, STAKE_PRECISION_METHOD); assert.equal(p.stakePolicyVersion, 1);
  assert.deepEqual(p.stakes, stakes); assert.deepEqual(p.choices, ['all-server-cashout-times']); assert.equal(new Set([...p.seeds, ...p.calibrationSeeds]).size, 4);
  for (const file of ['server/games/rush/crash.ts', 'server/demoExpansion.ts', 'src/shared/roundPrecision.ts']) assert(p.sources.includes(file), 'Unbound crash source: ' + file);
}
export function validateCrashProof(game, inputs, proof) {
  const p = inputs.policy; checkPolicy(game, p);
  assert.equal(proof.schemaVersion, 1); assert.equal(proof.gameId, game); assert.equal(proof.rulesVersion, p.rulesVersion); assert.equal(proof.progressVersion, p.progressVersion); assert.equal(proof.method, STAKE_PRECISION_METHOD);
  assert.equal(proof.policySha256, inputs.policySha256, 'RTP policy changed: rerun qualification'); assert.deepEqual(proof.sourceHashes, inputs.sourceHashes, 'RTP source changed: rerun qualification');
  assert.deepEqual(proof.precisionLaw, precisionLaw());
  const model = crashModel(); assert.deepEqual(proof.evidence, { model }); assert.deepEqual(proof.results, results(p, model));
  assert.equal(proof.replay.coverage.length, stakes.length); let checks = 0;
  for (const stake of stakes) { const r = proof.replay.coverage.find(row => row.stakeUnits === stake); assert(r && r.choice === p.choices[0]); assert.equal(r.paidRounds, p.seeds.length * p.serverReplayRoundsPerSeed); assert(r.minimumExtraUnits >= 0); assert.match(r.sha256, /^[a-f0-9]{64}$/); checks += r.paidRounds; }
  assert.equal(proof.serverReplayChecks, checks);
  const wallet = proof.walletEvidence; assert(wallet?.passed && wallet.gameId === game, 'Fresh common-wallet evidence is required'); assert.match(wallet.sha256, /^[a-f0-9]{64}$/); assert.equal(wallet.cases, walletStakes(p).length); assert.equal(wallet.replayAndRestartCases, wallet.cases); assert(wallet.oneDebitAndCredit && wallet.clientVerified && wallet.native?.passed && wallet.native.journalBalanced);
  validateManualStakes(game, p, proof.manualStakes); return true;
}
export async function qualifyCrash(game, inputs, progress = () => {}) {
  const p = inputs.policy; checkPolicy(game, p);
  const model = crashModel(), rows = results(p, model); progress({ phase: 'exact-crash-enumeration', game, milliseconds: model.acceptedMilliseconds, bounds: rows[0].rtpBounds });
  const { runtimeRound } = await import('./stake-runtime.mjs'), coverage = []; let checks = 0;
  for (const stakeUnits of stakes) {
    const digest = createHash('sha256'); let minimumExtraUnits = Infinity, maximumExtraUnits = 0, spins = 0;
    for (const seed of p.seeds) for (let i = 0; i < p.serverReplayRoundsPerSeed; i++) {
      const r = runtimeRound(game, p.choices[0], String(stakeUnits), (seed + i * 7919) >>> 0), extra = Number(BigInt(r.precision.creditedUnits) - BigInt(r.base)); assert(extra >= 0);
      minimumExtraUnits = Math.min(minimumExtraUnits, extra); maximumExtraUnits = Math.max(maximumExtraUnits, extra); spins += r.spins; checks++; digest.update(JSON.stringify(r.precision) + '\n');
    }
    coverage.push({ choice: p.choices[0], stakeUnits, paidRounds: p.seeds.length * p.serverReplayRoundsPerSeed, spins, minimumExtraUnits, maximumExtraUnits, sha256: digest.digest('hex') });
  }
  const { qualifyStakeWallet } = await import('./stakes-wallet.ts');
  return { method: STAKE_PRECISION_METHOD, precisionLaw: precisionLaw(), results: rows, evidence: { model }, replay: { coverage }, serverReplayChecks: checks, walletEvidence: await qualifyStakeWallet(game, p), manualStakes: qualifyManualStakes(game, p) };
}
