import assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { HEROES, NEOPOLIS_MATH, NEOPOLIS_RULES_VERSION, neopolisBosses, playNeopolisSpin } from '../../src/shared/neopolisMath.ts';
import { NEOPOLIS_PAYOUT_SCALE, neopolisTeamPayout } from '../../src/shared/neopolisStakePayouts.ts';
import { advanceNeopolis, emptyNeopolisView, NEOPOLIS_MAX_WIN } from '../../src/shared/neopolis.ts';
import { expansionExactAward, makeRoundPrecision, validRoundPrecision } from '../../src/shared/roundPrecision.ts';
import { moveNeopolis } from '../../server/games/neopolis.ts';
import { qualificationTeam } from './rtp-neopolis-v4.mjs';
import { neopolisV5Results } from './neopolis-v5-statistics.mjs';

const denominator = 40 * NEOPOLIS_MATH.payDenominator * Number(NEOPOLIS_PAYOUT_SCALE);
const randomSpace = 4294967296;
function randomFor(key) {
  const cipher = createCipheriv('aes-256-ctr', createHash('sha256').update('neopolis-v5-qualification:' + key).digest(), Buffer.alloc(16));
  const zeros = Buffer.alloc(65536);
  let bytes = Buffer.alloc(0), cursor = 0;
  return () => {
    if (cursor === bytes.length) { bytes = cipher.update(zeros); cursor = 0; }
    const next = bytes.readUInt32LE(cursor);
    cursor += 4;
    return next / randomSpace;
  };
}

function playBonus(first, random, version) {
  let battle = { ...first.battle, remaining: neopolisBosses(version)[0].spins };
  let points = 0;
  while (battle.remaining > 0) {
    const spin = playNeopolisSpin(first.team, battle, random, false, version);
    assert(!spin.triggered);
    points += spin.points;
    battle = spin.battle;
  }
  return { points, defeated: battle.defeated, spins: battle.played };
}

function sample({choice, state, seed, paidRounds}) {
  const team = qualificationTeam(choice, state);
  const factor = Number(neopolisTeamPayout(team)) / denominator;
  const paidRandom = randomFor(`${seed}:${choice}:${state}:paid`), bonusRandom = randomFor(`${seed}:${choice}:${state}:bonus`);
  let delta = 0, deltaSquared = 0, actual = 0, entries = 0;
  const defeats = [0, 0, 0];
  for (let i = 0; i < paidRounds; i++) {
    const first = playNeopolisSpin(team, null, paidRandom, false, 4);
    if (!first.triggered) {
      actual += Math.min(NEOPOLIS_MAX_WIN, first.points * factor);
      continue;
    }
    const tape = [];
    const old = playBonus(first, () => {
      const draw = bonusRandom();
      tape.push(draw);
      return draw;
    }, 4);
    let cursor = 0;
    const current = playBonus(first, () => tape[cursor++] ?? bonusRandom(), NEOPOLIS_RULES_VERSION);
    const currentRtp = Math.min(NEOPOLIS_MAX_WIN, (first.points + current.points) * factor);
    const previousRtp = Math.min(NEOPOLIS_MAX_WIN, (first.points + old.points) * factor);
    const change = currentRtp - previousRtp;
    delta += change;
    deltaSquared += change ** 2;
    actual += currentRtp;
    entries++;
    for (let boss = 0; boss < current.defeated; boss++) defeats[boss]++;
  }
  return { choice, state, seed, paidRounds, delta, deltaSquared, actual, entries, defeats };
}

function replayBonuses(policy) {
  const coverage = [];
  for (const choice of HEROES) {
    const team = qualificationTeam(choice, 15), cases = [];
    const paid = randomFor('replay:' + choice);
    for (let attempt = 0; attempt < 30000 && cases.length < 3; attempt++) {
      const tape = [];
      const first = playNeopolisSpin(team, null, () => {
        const value = paid();
        tape.push(value);
        return value;
      }, false, NEOPOLIS_RULES_VERSION);
      if (first.triggered) cases.push({ first, tape });
    }
    assert.equal(cases.length, 3);
    for (const stake of policy.stakes) {
      for (const [index, fixture] of cases.entries()) {
        const bonus = randomFor(`replay:${choice}:${index}:free`), duplicate = randomFor(`replay:${choice}:${index}:free`);
        let cursor = 0;
        const draw = max => {
          assert.equal(max, randomSpace);
          const value = cursor < fixture.tape.length ? fixture.tape[cursor++] : bonus();
          return Math.floor(value * max);
        };
        const stakeUnits = String(stake);
        let round = advanceNeopolis(emptyNeopolisView(team), stakeUnits, draw);
        assert.equal(cursor, fixture.tape.length);
        assert(!round.ended);
        assert.equal(round.view.battle.remaining, neopolisBosses(NEOPOLIS_RULES_VERSION)[0].spins);
        while (!round.ended) {
          assert.deepEqual(round.actions, [{ move: 'neopolis-spin', label: 'Neopolis free spin', cost: 0 }]);
          round = moveNeopolis(round.view, stakeUnits, round.view.revision, draw);
        }
        const expected = playBonus(fixture.first, duplicate, NEOPOLIS_RULES_VERSION);
        assert.equal(round.view.battle.defeated, expected.defeated);
        assert.equal(round.view.battle.played, expected.spins);
        const exact = expansionExactAward({ gameId: 'studio-neopolis', stakeUnits, returnedUnits: String(round.credit), view: { neopolis: round.view } });
        const normalized = (fixture.first.points + expected.points) * Number(neopolisTeamPayout(team)) / denominator;
        assert(Math.abs(Number(exact.numerator) / Number(exact.denominator) - stake * normalized) < 1e-8);
        const ticket = makeRoundPrecision(exact, String(round.credit), () => 0);
        assert(validRoundPrecision(ticket, exact, ticket.creditedUnits));
        coverage.push({ choice, stake, index, spins: round.view.battle.played, defeated: expected.defeated });
      }
    }
  }
  return coverage;
}

export async function qualifyNeopolisV5(policy, progress = () => {}) {
  const groups = HEROES.flatMap(choice => Array.from({length: 16}, (_, state) => policy.seeds.map(seed => ({
    choice, state, seed, paidRounds: state === 15 ? policy.readyRoundsPerSeed : policy.roundsPerSeed,
  })))).flat();
  let cursor = 0;
  const streams = [];
  const runner = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= groups.length) break;
      const row = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {workerData: {neopolisV5Sample: groups[index]}});
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code !== 0) reject(new Error('Neopolis qualification worker exited with ' + code)); });
      });
      streams[index] = row;
      if (cursor % 12 === 0 || row.state === 15) progress({phase:'complete-paid-round-samples', choice:row.choice, state:row.state, seed:row.seed, entries:row.entries});
    }
  };
  await Promise.all(Array.from({length: 4}, runner));
  const precisionStateResults = neopolisV5Results(policy, streams);
  const replay = replayBonuses(policy);
  return { method: policy.method, streams, precisionStateResults, replay, serverReplayChecks: replay.length,
    analysis: 'Independent paired complete paid rounds estimate the change from the frozen v4 conditional RTP. For triggered rounds the bonus shares random numbers across versions. The payoff includes all continuations and the common cap. Per-state confidence intervals combine the independent v4 and paired-difference variances. Common final cent settlement preserves that expectation for every admitted stake.' };
}

if (!isMainThread && workerData?.neopolisV5Sample) parentPort.postMessage(sample(workerData.neopolisV5Sample));
