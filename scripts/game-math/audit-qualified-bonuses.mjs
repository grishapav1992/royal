// Read-only screening of current qualified rules. This does not replace RTP qualification.
// Run: node --import tsx scripts/game-math/audit-qualified-bonuses.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { simulateNeopolis, simulateDracona } from './rtp-simulation.mjs';
import { HEROES, MAX_ROUND_SPINS, NEOPOLIS_MATH, initialTeam, playNeopolisSpin } from '../../src/shared/neopolisMath.ts';
import { SIZE, MAX_BONUS_SPINS, playSpin, seededRandom } from '../../src/shared/draconaMath.ts';
import { playSpin as playDraconaV1 } from '../../src/shared/draconaMathV1.ts';
import { advanceNeopolis, emptyNeopolisView, validNeopolisView } from '../../src/shared/neopolis.ts';
import { validDraconaView } from '../../src/shared/dracona.ts';
import { startNeopolis, moveNeopolis } from '../../server/games/neopolis.ts';
import { startDracona, moveDracona } from '../../server/games/dracona.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes('--' + name) ? args[args.indexOf('--' + name) + 1] : fallback;
const count = (name, fallback) => {
  const n = Number(option(name, fallback));
  assert(Number.isSafeInteger(n) && n > 0, 'Invalid --' + name);
  return n;
};
const cyclesPerSeed = count('cycles', 2000);
const draconaRoundsPerSeed = count('dracona-rounds', 500000);
const replayBonuses = count('replay-bonuses', 3);
const output = resolve(option('output', 'docs/game-math/qualified-bonus-audit-20261024.json'));
const policy = JSON.parse(await readFile(new URL('./rtp-policy.json', import.meta.url), 'utf8')).profiles;
const freshSeeds = [2026102401, 2026102407];
for (const game of ['studio-neopolis', 'studio-dracona']) {
  assert(freshSeeds.every(seed => !policy[game].seeds.includes(seed)), 'Screening seeds must differ from qualification seeds');
}
const drawFor = seed => { const random = seededRandom(seed); return max => Math.floor(random() * max); };
const snapshot = value => JSON.parse(JSON.stringify(value));
const progress = value => console.log(JSON.stringify({ phase: 'fresh-seed-screen', ...value }));
const startedAt = new Date().toISOString();
const sourceFiles = [...new Set(['scripts/game-math/audit-qualified-bonuses.mjs', 'scripts/game-math/rtp-simulation.mjs', 'scripts/game-math/rtp-policy.json',
  ...policy['studio-neopolis'].sources, ...policy['studio-dracona'].sources])];
const hashSources = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, createHash('sha256').update((await readFile(file, 'utf8')).replace(/\r\n/g, '\n')).digest('hex')])));
const sourceHashes = await hashSources();

// Independent integer settlement and raw-engine streams are compared with server start/move.
// Every free step resumes from a serialized saved view. No production or wallet is opened.
function serverReplayNeopolis() {
  const rows = [];
  for (const [heroIndex, hero] of HEROES.entries()) for (const stake of policy['studio-neopolis'].stakes) {
    const seed = 2026102501 + heroIndex * 1000003;
    const actual = drawFor(seed), raw = drawFor(seed);
    let team = initialTeam(hero), previous, rounds = 0, bonuses = 0, free = 0, staleMoves = 0, lockedChoices = 0;
    while (bonuses < replayBonuses) {
      if (team.complete) team = initialTeam(hero);
      let battle = null, total = 0, spins = 0;
      const expected = [];
      do {
        const result = playNeopolisSpin(team, battle, () => raw(4294967296) / 4294967296);
        team = result.team; battle = result.battle;
        const amount = Number(BigInt(stake) * BigInt(result.points) / (40n * BigInt(NEOPOLIS_MATH.payDenominator)));
        total = Math.min(stake * 3000, total + amount);
        expected.push(result); spins++;
        if (total === stake * 3000) { team = { ...team, complete: true }; break; }
        assert(spins <= MAX_ROUND_SPINS);
      } while (battle && battle.remaining);
      let result = startNeopolis({ neopolis: { hero } }, String(stake), previous, actual);
      let cursor = 0;
      assert.deepEqual(result.view.history.at(-1).result, expected[cursor++]);
      if (!result.ended) bonuses++;
      while (!result.ended) {
        assert.equal(result.credit, 0);
        assert(validNeopolisView(String(stake), snapshot(result.view)));
        assert.throws(() => moveNeopolis(result.view, String(stake), result.view.revision + 1, () => { throw Error('Stale revision consumed entropy'); }), /stale bonus move/);
        staleMoves++;
        result = moveNeopolis(snapshot(result.view), String(stake), result.view.revision, actual);
        assert.deepEqual(result.view.history.at(-1).result, expected[cursor++]); free++;
      }
      assert.equal(cursor, expected.length);
      assert.equal(result.credit, total);
      assert.deepEqual(result.view.team, team);
      assert(validNeopolisView(String(stake), result.view));
      previous = { stakeUnits: String(stake), view: snapshot(result.view) };
      if (!team.complete) {
        const wrongStake = String(stake === 1000 ? 2000 : 1000);
        assert.throws(() => startNeopolis({ neopolis: { hero } }, wrongStake, previous, () => { throw Error('Changed stake consumed entropy'); }), /finish the current team cycle/);
        const wrongHero = HEROES.find(candidate => candidate !== hero);
        assert.throws(() => startNeopolis({ neopolis: { hero: wrongHero } }, String(stake), previous, () => { throw Error('Changed starter consumed entropy'); }), /finish the current team cycle/);
        lockedChoices += 2;
      }
      rounds++; assert(rounds < 100000, 'No reachable Neopolis bonus');
    }
    rows.push({ hero, stakeUnits: stake, seed, paidRounds: rounds, completedBonuses: bonuses, serializedFreeContinuations: free, staleMovesRejected: staleMoves, stakeOrStarterChangesRejected: lockedChoices });
  }
  return rows;
}

function serverReplayDracona() {
  const rows = [];
  for (const stake of policy['studio-dracona'].stakes) {
    const seed = 2026102601;
    const actual = drawFor(seed), raw = drawFor(seed);
    let rounds = 0, bonuses = 0, free = 0, retriggers = 0, staleMoves = 0;
    while (bonuses < replayBonuses) {
      let remaining = 0, issued = 0, runes = Array(SIZE).fill(1), total = 0;
      const expected = [];
      do {
        const result = playSpin({ bet: stake / 100, bonus: issued > 0, runes, bonusIssued: issued, random: () => raw(4294967296) / 4294967296 });
        total += Math.round(result.payout * 100);
        if (issued) { remaining--; if (result.bonusAward) retriggers++; }
        remaining += result.bonusAward; issued += result.bonusAward; runes = result.runes;
        assert(issued <= MAX_BONUS_SPINS); expected.push(result);
      } while (remaining);
      let result = startDracona({ dracona: { mode: 'normal' } }, String(stake), actual), cursor = 0;
      assert.deepEqual(result.view.history.at(-1).result, expected[cursor++]);
      if (!result.ended) bonuses++;
      while (!result.ended) {
        assert.equal(result.credit, 0);
        assert(validDraconaView(String(stake), snapshot(result.view)));
        assert.throws(() => moveDracona(result.view, String(stake), result.view.revision + 1, () => { throw Error('Stale revision consumed entropy'); }), /Бонус уже изменился/);
        staleMoves++;
        result = moveDracona(snapshot(result.view), String(stake), result.view.revision, actual);
        assert.deepEqual(result.view.history.at(-1).result, expected[cursor++]); free++;
      }
      assert.equal(cursor, expected.length);
      assert.equal(result.credit, total);
      assert.deepEqual(result.view.history.at(-1).result.runes, runes);
      assert(validDraconaView(String(stake), result.view));
      rounds++; assert(rounds < 100000, 'No reachable Dracona bonus');
    }
    rows.push({ stakeUnits: stake, seed, paidRounds: rounds, completedBonuses: bonuses, serializedFreeContinuations: free, retriggers, staleMovesRejected: staleMoves });
  }
  return rows;
}

function legacyContinuationChecks() {
  const rows = [];
  for (const version of [1, 2]) for (const stake of policy['studio-neopolis'].stakes) for (const hero of HEROES) {
    const origin = { ...initialTeam(hero), charges: [3, 3, 3] };
    let result = advanceNeopolis(emptyNeopolisView(origin, version), String(stake), () => 4294967295);
    assert(!result.ended);
    const draw = drawFor(2026102701);
    const preserved = result.view.totalPayoutUnits;
    while (!result.ended) {
      result = moveNeopolis(snapshot(result.view), String(stake), result.view.revision, draw);
      assert.equal(result.view.version, version); assert(validNeopolisView(String(stake), result.view));
    }
    assert(Number(result.view.totalPayoutUnits) >= Number(preserved));
    assert.equal(result.credit, Number(result.view.totalPayoutUnits));
    assert(result.view.revision <= (version === 1 ? 14 : 46));
    const next = startNeopolis({ neopolis: { hero } }, String(stake), { stakeUnits: String(stake), view: result.view }, draw);
    assert.equal(next.view.version, 3);
    rows.push({ gameId: 'studio-neopolis', oldViewVersion: version, stakeUnits: stake, hero, completedSpins: result.view.revision, unchangedOldRules: true, nextRoundViewVersion: next.view.version });
  }
  for (const stake of policy['studio-dracona'].stakes) {
    const random = seededRandom(1), draws = [];
    const first = playDraconaV1({ bet: stake / 100, random: () => { const n = Math.floor(random() * 4294967296); draws.push(n); return n / 4294967296; } });
    assert(first.bonusAward > 0);
    let view = { kind: 'dracona', version: 1, revision: 1, history: [{ draws, result: first }], totalPayoutUnits: String(Math.round(first.payout * 100)), bonusAwarded: first.bonusAward, freePlayed: 0, remaining: first.bonusAward };
    assert(validDraconaView(String(stake), view));
    const draw = drawFor(2026102801);
    while (view.remaining) {
      const next = moveDracona(snapshot(view), String(stake), view.revision, draw);
      view = next.view; assert.equal(view.version, 1); assert(validDraconaView(String(stake), view));
      assert.equal(next.credit, next.ended ? Number(view.totalPayoutUnits) : 0);
    }
    const next = startDracona({ dracona: { mode: 'normal' } }, String(stake), draw);
    assert.equal(next.view.version, 2);
    rows.push({ gameId: 'studio-dracona', oldViewVersion: 1, stakeUnits: stake, completedSpins: view.revision, unchangedOldRules: true, nextRoundViewVersion: next.view.version });
  }
  return rows;
}

const replay = { neopolis: serverReplayNeopolis(), dracona: serverReplayDracona(), legacy: legacyContinuationChecks() };
console.log(JSON.stringify({ phase: 'server-replay-complete', neopolisConfigurations: replay.neopolis.length, draconaConfigurations: replay.dracona.length, legacyConfigurations: replay.legacy.length }));
const neopolis = simulateNeopolis({ ...policy['studio-neopolis'], seeds: freshSeeds, qualificationCyclesPerSeed: cyclesPerSeed }, progress);
const dracona = simulateDracona({ ...policy['studio-dracona'], seeds: freshSeeds, qualificationRoundsPerSeed: draconaRoundsPerSeed }, progress);
const afterHashes = await hashSources();
assert.deepEqual(afterHashes, sourceHashes, 'Audited source changed during screening');
const report = { schemaVersion: 1, startedAt, completedAt: new Date().toISOString(), sourceHashes,
  configuration: { freshSeeds, cyclesPerSeed, draconaRoundsPerSeed, replayBonusesPerConfiguration: replayBonuses },
  scope: 'Current Neopolis rules 3 and Dracona rules 3. All declared stakes and current choices. Complete paid rounds include every free continuation. Neopolis collection persists through complete regenerative cycles. Server replay separately verifies serialization, integer payouts, stale moves and legacy continuation.',
  limitations: [
    'This is fresh-seed screening, not regenerated qualification evidence or exact analytical RTP.',
    'The normal 95% intervals are pointwise estimates with no correction for multiple comparisons; rare tail events remain a limitation.',
    'The six stake estimates reuse the same random paths and are correlated.',
    'Neopolis cycles, rather than dependent paid spins inside a cycle, are the independent statistical units.',
    'Server replay uses real start/move functions and validators; database wallet idempotency and browser close/reopen are separate integration tests.',
    'Accepted legacy bonuses keep their original higher-paying rules. Starting a new round selects current rules.',
    'Neither game exposes a current bonus-buy mode. Dracona exposes normal mode; Neopolis exposes the three starter choices.'
  ],
  serverReplay: replay, screens: { 'studio-neopolis': neopolis, 'studio-dracona': dracona },
  screeningResult: {
    grossOverreturnDetected: [...neopolis.results, ...dracona.results].some(row => row.interval95[0] > 1),
    interpretation: 'A lower 95% limit above 100% is an investigation signal. Absence of this signal does not qualify the rules or prove RTP below 100%.'
  }
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, screeningResult: report.screeningResult, results: Object.entries(report.screens).map(([gameId, screen]) => ({ gameId, results: screen.results.map(({ choice, stakeUnits, paidRounds, rtp, interval95 }) => ({ choice, stakeUnits, paidRounds, rtp, interval95 })) })) }));
if (report.screeningResult.grossOverreturnDetected) process.exitCode = 2;
