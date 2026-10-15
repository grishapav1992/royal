import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Collect completed isolated audit runs. Passing reproduction tests confirm defects.
const root = process.argv[2];
if (!root) throw new Error('Pass the temporary audit directory.');
const destination = 'artifacts/casino-expansion/candidate-audit-20261011';
await fs.mkdir(destination, { recursive: true });
const metadata = JSON.parse(await fs.readFile('artifacts/casino-expansion/github-candidates-20261011.json', 'utf8'));
const math = JSON.parse(await fs.readFile('artifacts/casino-expansion/candidate-math-and-reproductions.json', 'utf8'));
const suites = [];
for (const name of ['cards-tests', 'cards-audited-tests', 'sicbo-audited-tests']) {
  const content = await fs.readFile(path.join(root, `${name}.jsonl`), 'utf8');
  const events = content.trim().split('\n').map(line => JSON.parse(line));
  const result = events.findLast(event => !event.Test && ['pass', 'fail'].includes(event.Action));
  assert.equal(result?.Action, 'pass', `${name} must finish successfully`);
  assert(!events.some(event => event.Action === 'fail'), `${name} includes a failed test`);
  await fs.writeFile(path.join(destination, `${name}.jsonl`), content);
  suites.push({
    name, package: result.Package, status: result.Action, elapsedSeconds: result.Elapsed,
    topLevelTests: events.filter(event => event.Action === 'pass' && event.Test && !event.Test.includes('/')).length,
    subtests: events.filter(event => event.Action === 'pass' && event.Test?.includes('/')).length,
    output: events.filter(event => event.Action === 'output' && event.Test?.startsWith('TestRoyalAudit'))
      .map(event => ({ test: event.Test, output: event.Output.trimEnd() })),
  });
}
const cards = metadata.sources.find(source => source.repo === 'yuta-yoshinaga/go_trumpcards');
const sicbo = metadata.sources.find(source => source.repo === 'BornToBuildGame/ultimate-game-server');
const directories = {
  'vafc21/Rush': `Rush-${math.sourceCommit}`,
  [cards.repo]: `go_trumpcards-${cards.commit}`,
  [sicbo.repo]: `ultimate-game-server-${sicbo.commit}`,
};
const extras = {
  [cards.repo]: ['internal/adapter/controller/session_store.go', 'internal/adapter/controller/session_provider.go', 'TRADEMARKS.md'],
  'vafc21/Rush': math.files.map(file => file.path),
};
const sources = [];
for (const source of metadata.sources) {
  const files = [];
  const targets = [...new Set([...source.files.map(file => file.path), ...(extras[source.repo] ?? [])])];
  for (const relative of targets) {
    const content = await fs.readFile(path.join(root, directories[source.repo], relative));
    const sha256 = createHash('sha256').update(content).digest('hex');
    const expected = source.files.find(file => file.path === relative)?.sha256
      ?? math.files.find(file => source.repo === 'vafc21/Rush' && file.path === relative)?.sha256;
    if (expected) assert.equal(sha256, expected, `${source.repo}/${relative} differs from pinned research`);
    files.push({ path: relative, sha256 });
  }
  sources.push({ repo: source.repo, commit: source.commit, license: 'MIT', files });
}
const cardCommon = [
  'Replace math/rand shuffle with server cryptographic RNG.',
  'Replace automatic practice-chip refill and integer chip balance with the Royal ledger.',
  'Persist account-bound hidden state and every debit, refund and credit in atomic PostgreSQL transactions.',
  'Enforce operation idempotency, permitted phases, stake limits and maximum payout reservation.',
];
function card(name, details) {
  return { name, repo: cards.repo, disposition: 'adaptable-after-wallet-integration', directMoneyReady: false,
    recovery: { trials: 25, result: 'equal economic state after JSON recovery and one finishing action' },
    required: cardCommon, ...details };
}
const candidates = [
  { name: 'Diamonds', repo: 'vafc21/Rush', disposition: 'recalculate-paytable', directMoneyReady: false,
    exactMath: math.diamonds, required: ['Recalculate and approve paytable before integration.', 'Use Royal atomic debit/credit, idempotency and maximum payout reserve.'] },
  { name: 'Crash', repo: 'vafc21/Rush', disposition: 'replace-financial-round-handlers', directMoneyReady: false,
    reproduced: math.crash, required: ['Keep future crash point secret while the round is active.',
      'Make cashout compare-and-set and credit atomic and idempotent.', 'Reject cashout after authoritative crash time.',
      'Set a finite practical multiplier cap and reserve maximum liabilities.', 'Persist and recover round state with the Royal ledger.'] },
  card('Three Card Poker', { disposition: 'fix-side-bet-credit', exactMath: { scope: 'Pair Plus only', hands: 22100, payout: '204920', stake: '221000', rtpPercent: 204920 / 221000 * 100 },
    reproduced: ['Fold reports Pair Plus payout 410 on stake 10 but does not credit it; chips stay 980.'],
    additionalRequired: ['Credit independent Pair Plus winnings on fold exactly once.'], optimalMainGameRtp: 'not computed' }),
  card('Caribbean Stud', { exactMath: { scope: 'Fixed jackpot side bet only', hands: 2598960, payout: '12018000', stake: '25989600', rtpPercent: 12018000 / 25989600 * 100 },
    additionalRequired: ['Disable or recalculate fixed jackpot side bet (46.24% return); no progressive pool is implemented.', 'Account for 2x Ante Play debit and large payout reserves.'], optimalMainGameRtp: 'not computed' }),
  card('Let It Ride', { additionalRequired: ['Record three initial wagers and up to two mid-round refunds atomically.'], optimalMainGameRtp: 'not computed' }),
  card('Ultimate Texas Holdem', { additionalRequired: ['Record Ante, Blind, Play and optional Trips as separate stakes.', 'Use rational payouts for 3:2 rather than whole practice-chip rounding.'], optimalMainGameRtp: 'not computed' }),
  card('Casino War', { additionalRequired: ['Publish the selected surrender and repeated-tie War variant.', 'Reserve the extra War wager and record half-stake surrender refunds.'], optimalMainGameRtp: 'not computed' }),
  card('Red Dog', { additionalRequired: ['Record optional raise, push refund and spread-specific payouts.'], optimalMainGameRtp: 'not computed' }),
  card('Pai Gow', { disposition: 'fix-commission-precision', reproduced: ['A win on stake 10 yields zero commission because 10*5/100 truncates; gross payout is 20.'],
    additionalRequired: ['Calculate 5% commission in monetary minor units with an explicit rounding policy.', 'Version the dealer House Way and joker rules.'], optimalMainGameRtp: 'not computed' }),
  card('Dragon Tiger', { exactMath: { scope: 'Single 52-card deck', orderedHands: 2652, mainBetRtpPercent: 25740 / 26520 * 100, tieBetRtpPercent: 14040 / 26520 * 100 },
    additionalRequired: ['Disable or revise the Tie payout for the selected number of decks.'] }),
  card('Deuces Wild', { disposition: 'change-paytable-and-fix-audit-log', reproduced: ['Replacing cards also mutates the original deal action log through a shared slice.'],
    referencedMath: { table: 'Full-pay 25-15-9-5-3-2-2-1, natural royal 800 at five coins', optimalRtpPercent: 100.76, source: 'https://wizardofodds.com/games/video-poker/tables/deuces-wild/', independentlyComputed: false },
    additionalRequired: ['Select and validate a new paytable with the intended return.', 'Copy cards into immutable deal and draw logs.', 'Separate monetary denomination from the five-coin royal bonus condition.'] }),
  { name: 'Sic Bo (Tai Xiu Big/Small)', repo: sicbo.repo, disposition: 'replace-settlement-and-state-storage', directMoneyReady: false,
    exactMath: math.sicbo,
    reproduced: ['Failed WalletUpdate credit still produces a successful payout result without durable pending credit.',
      'Calling settlement twice on the same round credits twice (990 -> 1030 instead of 1010). This is a forced replay test.',
      'Stake 2^62 doubles into a negative int64 payout; there is no maximum stake guard in the sample.'],
    required: ['Use cryptographic dice RNG.', 'Persist account-bound round, bets and settlement state.',
      'Settle and credit atomically with idempotency and failure recovery.', 'Limit and check all stake and pool arithmetic.', 'Implement additional bets separately if a full Sic Bo table is desired.'] },
];
assert.equal(candidates.length, 12);
assert.equal(new Set(candidates.map(candidate => candidate.name)).size, 12);
const auditFiles = [];
for (const file of ['audit-candidates.mjs', 'candidate-card-audit.go.txt', 'candidate-sicbo-audit.go.txt', 'summarize-candidate-audit.mjs']) {
  const relative = `scripts/game-math/${file}`;
  auditFiles.push({ path: relative, sha256: createHash('sha256').update(await fs.readFile(relative)).digest('hex') });
}
const report = {
  checkedAt: new Date().toISOString(), scope: 'All 12 additional casino candidates from the previous GitHub shortlist',
  status: 'audit-only-no-games-installed-no-money-enabled', candidateCount: candidates.length, directlyMoneyReady: 0,
  currentLocalGameCount: 13, possibleCountAfterAdaptation: 25, sources, auditFiles, suites,
  recovery: { cardGames: 9, trialsPerGame: 25, totalTrials: 225, storage: 'JSON snapshot only; no process restart or Royal database integration',
    comparison: 'Economic state compared separately from action logs; equivalent null and empty arrays normalized.',
    actualHttpStorage: 'Default Go provider is an in-memory session store with a one-hour idle TTL, not durable money storage.' },
  limitations: ['This is a source and isolated-function audit, not a certification of production monetary readiness.',
    'Tests confirming defects intentionally pass when the original bad behavior is reproduced.',
    'No real transfers, deployed-game changes, full browser UI tests, or live third-party database tests were performed.',
    'Optimal strategy RTP of complex main card games was not independently computed; side-bet values do not describe the entire game.',
    'Go code MIT licenses were verified. Commercial game-name and publisher rights are not verified; upstream TRADEMARKS.md flags third-party names.',
    'The new games need server integration and Royal screens before adding cabinets to the first floor.'],
  candidates,
};
await fs.writeFile('artifacts/casino-expansion/candidate-audit-20261011.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ candidates: report.candidateCount, directlyMoneyReady: report.directlyMoneyReady,
  suites: suites.map(({ name, status, topLevelTests, subtests }) => ({ name, status, topLevelTests, subtests })) }));
