import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODES, PROFILES, seededRandom, simulatePlayer, sampleStats,
  type Profile, type SimulationReport,
} from './simulate-casino';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'artifacts/work/casino-simulation-20261022');
const baseline: SimulationReport = JSON.parse(await readFile(resolve(directory, 'results.json'), 'utf8'));
const previous = JSON.parse(await readFile(resolve(directory, 'small-player-groups.json'), 'utf8'));
const runs = 10000;
const started = performance.now();

async function verifySources() {
  for (const source of baseline.sources) assert.equal(
    createHash('sha256').update(await readFile(resolve(root, source.path))).digest('hex'),
    source.sha256, source.path + ' changed since the original experiment',
  );
}
await verifySources();

type Observed = { mode: string; stakeCents: number; payoutCents: number; freeSpins: number; actions: number };
type Event = { second: number; deltaCents: number; slot: number };
let capture: Observed[] | null = null;
const originalPlays = new Map(Object.entries(MODES).map(([key, mode]) => [key, mode.play]));
for (const [key, mode] of Object.entries(MODES)) {
  const original = originalPlays.get(key)!;
  // Observe the existing engine without adding random draws or changing results.
  mode.play = (stake, random, verify) => {
    const result = original(stake, random, verify);
    capture?.push({ mode: key, stakeCents: stake, ...result });
    return result;
  };
}

function observedPlayer(profile: Profile, seed: string, slot: number) {
  assert.equal(capture, null);
  const observed: Observed[] = [];
  capture = observed;
  let player: ReturnType<typeof simulatePlayer>;
  try { player = simulatePlayer(profile, seed); } finally { capture = null; }
  assert.equal(observed.length, player.rounds);
  const behavior = seededRandom(seed + ':behavior');
  let second = 0, block = 0, currentMode = -1, profit = 0, peak = 0;
  const events: Event[] = [];
  // Replay the unchanged pacing stream. Outcome draws stay inside the original simulator.
  for (const row of observed) {
    if (block === 0) {
      const next = (currentMode + 1) % profile.modes.length;
      if (currentMode >= 0 && next !== currentMode) second += 15 + behavior(31);
      currentMode = next;
      block = 5 + behavior(11);
    }
    assert.equal(row.mode, profile.modes[currentMode]);
    block--;
    second += MODES[row.mode].seconds + behavior(5) + row.freeSpins * 4
      + Math.max(0, row.actions - row.freeSpins - 1) * 3;
    const deltaCents = row.payoutCents - row.stakeCents;
    profit += deltaCents;
    peak = Math.max(peak, profit);
    events.push({ second, deltaCents, slot });
  }
  assert.equal(profit, player.profitCents);
  assert.equal(peak, player.peakWealthCents - profile.depositCents);
  assert((events.at(-1)?.second ?? 0) <= player.seconds);
  return { player, events };
}

function peakNeed(events: Event[]) {
  // At equal modeled seconds, settle wins first to avoid hiding a funding gap.
  events.sort((a, b) => a.second - b.second || b.deltaCents - a.deltaCents || a.slot - b.slot);
  let totalProfit = 0, needCents = 0, peakSecond = 0;
  for (const event of events) {
    totalProfit += event.deltaCents;
    if (totalProfit > needCents) { needCents = totalProfit; peakSecond = event.second; }
  }
  return { needCents, totalProfitCents: totalProfit, peakSecond };
}

assert.deepEqual(peakNeed([
  { second: 1, deltaCents: 10000, slot: 0 },
  { second: 2, deltaCents: -10000, slot: 0 },
]), { needCents: 10000, totalProfitCents: 0, peakSecond: 1 });
assert.equal(peakNeed([
  { second: 1, deltaCents: -10000, slot: 0 },
  { second: 2, deltaCents: 15000, slot: 1 },
]).needCents, 5000);
assert.equal(peakNeed([
  { second: 1, deltaCents: -10000, slot: 0 },
  { second: 1, deltaCents: 10000, slot: 1 },
]).needCents, 10000);

// The faster observer must reproduce the fully verified simulator trace exactly.
for (let i = 0; i < 100; i++) {
  const profile = PROFILES[i % PROFILES.length], seed = baseline.seed + ':reserve-observer-check:' + i;
  const observed = observedPlayer(profile, seed, 0), detailed = simulatePlayer(profile, seed, true);
  assert.deepEqual(observed.events, detailed.trace.map(row => ({
    second: row.second, deltaCents: row.payoutCents - row.stakeCents, slot: 0,
  })));
  assert.deepEqual(observed.player, { ...detailed, trace: [] });
}

function percentile(sorted: number[], fraction: number) {
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}
const comparisons = [];
let allRounds = 0, allSessions = 0;
try {
  for (const groupSize of [1, 2, 3, 4, 5]) {
    const peaks: number[] = [], closingGgr: number[] = [], elapsed: number[] = [], roundCounts: number[] = [];
    let deposits = 0, withdrawals = 0, retained = 0;
    let worst: unknown = null, worstNeed = -1;
    const choices = seededRandom(baseline.seed + ':practical-reserve:profiles:' + groupSize);
    for (let i = 0; i < runs; i++) {
      const selected = groupSize === 1 ? [i % PROFILES.length]
        : groupSize === 2 ? [i % PROFILES.length, Math.floor(i / PROFILES.length) % PROFILES.length]
        : Array.from({ length: groupSize }, () => choices(PROFILES.length));
      const players = selected.map((profile, slot) => observedPlayer(PROFILES[profile],
        baseline.seed + ':small-groups:' + groupSize + ':run:' + i + ':slot:' + slot, slot));
      const path = peakNeed(players.flatMap(row => row.events));
      const sum = (read: (p: typeof players[number]['player']) => number) => players.reduce((n, row) => n + read(row.player), 0);
      const totalProfit = sum(p => p.profitCents);
      assert.equal(path.totalProfitCents, totalProfit);
      assert(path.needCents >= Math.max(0, totalProfit));
      assert(path.needCents <= sum(p => p.peakWealthCents - p.profile.depositCents));
      assert.equal(totalProfit, sum(p => p.withdrawnCents + p.balanceCents - p.profile.depositCents));
      peaks.push(path.needCents); closingGgr.push(-totalProfit);
      deposits += sum(p => p.profile.depositCents); withdrawals += sum(p => p.withdrawnCents); retained += sum(p => p.balanceCents);
      const rounds = sum(p => p.rounds);
      roundCounts.push(rounds); allRounds += rounds; allSessions += groupSize;
      elapsed.push(Math.max(...players.map(row => row.player.seconds)));
      if (path.needCents > worstNeed) {
        worstNeed = path.needCents;
        worst = { runIndex: i, ...path, closingGgrCents: -totalProfit,
          players: players.map(({ player: p }) => ({ profile: p.profile.id, depositCents: p.profile.depositCents,
            rounds: p.rounds, seconds: p.seconds, profitCents: p.profitCents,
            withdrawnCents: p.withdrawnCents, balanceCents: p.balanceCents, peakGainCents: p.peakWealthCents - p.profile.depositCents })) };
      }
      if ((i + 1) % 2500 === 0) console.log(JSON.stringify({ groupSize, done: i + 1, runs }));
    }
    if (groupSize <= 2) {
      const old = previous.comparisons.find((row: { groupSize: number }) => row.groupSize === groupSize);
      assert.equal(Math.min(...closingGgr), old.ggrCents.min);
      assert.equal(closingGgr.filter(value => value < 0).length, old.lossGroups);
      assert(Math.abs(closingGgr.reduce((a, b) => a + b, 0) / runs - old.ggrCents.mean) < 1e-8);
      if (groupSize === 1) assert.equal(Math.max(...peaks), old.singlePlayerPeakReserveCents.max);
    }
    const sorted = [...peaks].sort((a, b) => a - b);
    comparisons.push({ groupSize, runs, meanDepositCents: deposits / runs,
      meanWithdrawnCents: withdrawals / runs, meanRetainedCents: retained / runs,
      reserveCents: { p95: percentile(sorted, .95), p99: percentile(sorted, .99),
        p999: percentile(sorted, .999), observedMax: sorted.at(-1)! },
      candidateReserves: [0, 100000, 200000, 500000, 1000000, 2500000, 5000000].map(reserveCents => ({
        reserveCents, exceededRuns: peaks.filter(need => need > reserveCents).length,
        empiricalExceedanceProbability: peaks.filter(need => need > reserveCents).length / runs,
      })),
      peakDeficitStats: sampleStats(peaks), closingGgrStats: sampleStats(closingGgr),
      elapsedSeconds: sampleStats(elapsed), paidRounds: sampleStats(roundCounts), worst });
  }
} finally {
  for (const [key, play] of originalPlays) MODES[key].play = play;
}
await verifySources();
const report = {
  createdAt: new Date().toISOString(), seed: baseline.seed, runsPerGroupSize: runs,
  simulatedGroups: runs * 5, simulatedSessions: allSessions, simulatedPaidRounds: allRounds,
  runtimeSeconds: (performance.now() - started) / 1000,
  gameCount: new Set(Object.values(MODES).map(mode => mode.gameId)).size,
  modes: Object.values(MODES).map(mode => ({ key: mode.key, gameId: mode.gameId, settings: mode.settings })),
  profiles: PROFILES, comparisons,
  method: 'Maximum positive cumulative player net winnings across the merged session timeline. Withdrawn amounts and remaining wallet balances are both liabilities. Deposits from all players arrive at time zero.',
  assumptions: [
    'Same original 13 selected games and 18 modes. This is not a full current catalogue calculation; Royal Mines, Dracona and unrestricted Limbo were not in that experiment.',
    'One session per player. Original ten profiles with deposits USD 100-1000, stakes usually USD 10 or 50, with a USD 100 step for the loss-chasing profile.',
    'For groups of one or two, exactly replay the existing 10000-run experiment. For groups of three to five, profiles are independently sampled with equal weights, with replacement.',
    'Whole paid rounds, including any attached free bonus sequence, settle at the modeled completion time. At equal modeled seconds, wins settle first.',
    'Most profile time limits are 30-60 minutes; the trailing profile allows 90 minutes. No repeat deposits, payment delays, fees, taxes, operating expenses or payment-provider constraints.',
    'All original exits and withdrawals stay unchanged. Casino funding is unlimited while generating paths; we then measure how much extra house capital each complete path would have required.',
    'Nearest-rank empirical percentiles. A percentile is not a guaranteed sufficient capital amount or a probability guarantee for future players. The 99.9th percentile has only about ten larger observations per group size.',
    'A finite-session result cannot be extrapolated to uninterrupted future operation or different stakes, games or player strategies.',
  ],
  verification: { originalSourceFilesUnchanged: baseline.sources.length, observerMatchesVerifiedTraces: 100,
    singleAndPairOriginalResultsReproduced: true, peakAndClosingLedgersReconcile: true,
    productionWrites: 0, gameMathChanges: 0 },
};
await writeFile(resolve(directory, 'practical-reserve.json'), JSON.stringify(report, null, 2) + '\n');
const dollars = (value: number) => '$' + (value / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rows = comparisons.map(row => `<tr><th>${row.groupSize}</th><td>${dollars(row.reserveCents.p95)}</td><td>${dollars(row.reserveCents.p99)}</td><td>${dollars(row.reserveCents.p999)}</td><td>${dollars(row.reserveCents.observedMax)}</td></tr>`).join('');
const riskRows = comparisons.map(row => `<tr><th>${row.groupSize}</th>${row.candidateReserves.slice(1, 6).map(item => `<td>${(100 * item.empiricalExceedanceProbability).toFixed(2)}%</td>`).join('')}</tr>`).join('');
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Резерв по исходной симуляции: 1-5 игроков</title><style>
body{margin:0;background:#10141d;color:#e8edf6;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:36px 20px}h1{font-size:clamp(26px,4vw,42px);line-height:1.2}h2{font-size:23px;margin-top:34px}p,li{max-width:900px}.muted{color:#aab7cd}.note{border-left:4px solid #f2c66d;background:#232332;padding:16px 20px;border-radius:8px}.scroll{overflow:auto;margin:20px 0;border:1px solid #364254;border-radius:10px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;white-space:nowrap}td,th{padding:12px 16px;border-bottom:1px solid #364254;text-align:right}th:first-child{text-align:left}thead{background:#202c40}a{color:#91bdff}code{color:#c7d9ff}footer{margin-top:40px;color:#aab7cd}@media(max-width:450px){main{padding:22px 14px}td,th{padding:10px 12px}}
</style><main><p class="muted">Исходные 13 игр, 18 режимов · 50 000 групп · 150 000 сессий</p><h1>Резерв на одну группу из 1-5 игроков</h1>
<p>Здесь измеряется максимальная нехватка собственных средств казино во время всей сессии, включая уже оплаченные выводы и деньги, оставшиеся на счетах игроков. Депозиты игроков обеспечивают их исходные балансы.</p>
<p class="note">Предыдущие суммы в миллионах относились к покрытию предельной выплаты Royal Mines. Они не являются оценкой практического стартового резерва по исходной симуляции. В этом эксперименте Royal Mines и Dracona отсутствуют.</p>
<h2>Какой резерв покрывал прогоны</h2><p>Для каждого числа игроков выполнено 10 000 прогонов. Проценты относятся к этой выборке при заданных правилах поведения. Это не гарантия будущих выплат.</p>
<div class="scroll"><table><thead><tr><th>Игроков</th><th>95% прогонов</th><th>99% прогонов</th><th>99,9% прогонов</th><th>Максимум в выборке</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Как часто заданного резерва не хватало</h2><div class="scroll"><table><thead><tr><th>Игроков</th><th>$1 000</th><th>$2 000</th><th>$5 000</th><th>$10 000</th><th>$25 000</th></tr></thead><tbody>${riskRows}</tbody></table></div>
<h2>Условия расчёта</h2><ul><li>Депозиты от $100 до $1 000. Ставки обычно $10 или $50, с повышением до $100 у одного из профилей.</li><li>Игроки меняют игры, фиксируют прибыль, делают частичные выводы или уходят после потерь согласно исходным десяти профилям.</li><li>Одна сессия на игрока, лимиты профилей от 30 до 90 минут. Повторных пополнений нет.</li><li>Учитывается весь путь баланса, а не только результат в конце. При совпадении времени сначала учитываются выигрыши.</li><li>Расходы, комиссии, задержки платежей и налоги не включены.</li><li>Уровень 99,9% основан примерно на десяти более крупных случаях и особенно чувствителен к редким событиям.</li></ul>
<p>Эти суммы относятся к выбранным играм, ставкам и одной группе сессий. Для всего текущего каталога или непрерывной работы требуется отдельная модель. После убытков свободный резерв уменьшается.</p>
<footer>Математика игр сохранена. Все ${baseline.sources.length} исходных файлов совпали с первым экспериментом. Наблюдатель сверён со 100 полными трассами. Денежные итоги для 1 и 2 игроков точно воспроизведены из предыдущего расчёта. <a href="practical-reserve.json">Данные и условия расчёта</a></footer></main></html>`;
assert(!html.includes('\u2014'));
await writeFile(resolve(directory, 'practical-reserve.html'), html);
const metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8'));
for (const name of ['practical-reserve.json', 'practical-reserve.html']) if (!metadata.finalOutputs.includes(name)) metadata.finalOutputs.push(name);
metadata.practicalReserveCorrection = { purpose: 'Distinguish finite-session empirical reserve from maximum single-round payout coverage',
  productionWrites: 0, sourceFilesUnchanged: true, cleanup: 'Only compact final results and HTML retained. No traces, copied dependencies, screenshots or intermediate runs saved.' };
await writeFile(resolve(directory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ comparisons: comparisons.map(row => ({ groupSize: row.groupSize, reserveCents: row.reserveCents,
  candidateReserves: row.candidateReserves })), verification: report.verification, runtimeSeconds: report.runtimeSeconds }, null, 2));
