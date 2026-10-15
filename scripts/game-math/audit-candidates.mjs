import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';

// Runs pinned upstream functions against local fixtures. No provider or wallet calls.
const root = process.argv[2];
if (!root) throw new Error('Pass the temporary audit directory.');
const rush = path.join(root, 'Rush-bc55199db43cdae829b5c001de15afb2bbe13ff6');
const output = 'artifacts/casino-expansion/candidate-math-and-reproductions.json';
const files = [];
async function load(relative, dependencies, globals = {}) {
  const source = await fs.readFile(path.join(rush, relative), 'utf8');
  files.push({ path: relative, sha256: createHash('sha256').update(source).digest('hex') });
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'node22' });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: id => { if (!(id in dependencies)) throw new Error(`Unmocked import: ${id}`); return dependencies[id]; },
    ...globals,
  }, { filename: relative, timeout: 1000 });
  return module.exports;
}

const weights = [30, 25, 20, 15, 8, 2];
const positions = weights.map((_, i) => weights.slice(0, i).reduce((a, b) => a + b, 0));
let picks = [], drawIndex = 0;
const diamonds = await load('src/lib/games/diamonds.ts', {
  crypto: { randomInt: () => picks[drawIndex++] },
});
let totalWeight = 0n, payoutWeight = 0n, winningWeight = 0n, maxMultiplier = 0;
const distribution = {};
for (let number = 0; number < 6 ** 5; number++) {
  let value = number, weight = 1n;
  picks = [];
  for (let i = 0; i < 5; i++) {
    const gem = value % 6; value = Math.floor(value / 6);
    picks.push(positions[gem]); weight *= BigInt(weights[gem]);
  }
  drawIndex = 0;
  const result = diamonds.deal();
  assert.equal(drawIndex, 5);
  assert(Number.isInteger(result.multiplier) && result.multiplier >= 0);
  totalWeight += weight;
  payoutWeight += weight * BigInt(result.multiplier);
  if (result.multiplier > 0) winningWeight += weight;
  maxMultiplier = Math.max(maxMultiplier, result.multiplier);
  distribution[result.multiplier] = (BigInt(distribution[result.multiplier] ?? 0) + weight).toString();
}
assert.equal(totalWeight, 100n ** 5n);

let randomValue = 0n;
const crash = await load('src/lib/games/crash.ts', {
  crypto: { randomBytes: () => { const b = Buffer.alloc(6); b.writeUIntBE(Number(randomValue), 0, 6); return b; } },
}, { Buffer });
const crashCases = [0n, 1n, 2n ** 47n, 2n ** 48n - 1n].map(n => {
  randomValue = n;
  const result = crash.rollCrashPoint();
  assert(Number.isFinite(result) && result >= 1);
  return { entropy: n.toString(), multiplier: result };
});
for (const m of [1, 1.1, 2, 10, 100]) assert(Math.abs(crash.multiplierAtElapsed(crash.secondsToReachMultiplier(m)) / m - 1) < 1e-12);

const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } };
const auth = { requireSession: async () => ({ kind: 'guest', nickname: 'audit' }) };
const round = { id: 'round', start_at: new Date(95_000).toISOString(), crash_multiplier: 2, crashed_at: null };
let auditNow = 100_000;
class AuditDate extends Date { static now() { return auditNow; } }
let betState = { id: 'bet', lobby_player_id: 'seat', lobby_id: 'lobby', bet_amount_cents: 100, game: 'crash',
  details: { roundId: 'round', status: 'active', autoCashoutAt: null } };
let credits = 0, paid = 0;
const database = {
  from(table) {
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: structuredClone(round) }),
      single: async () => ({ data: structuredClone(table === 'bets' ? betState : table === 'crash_rounds' ? round : { id: 'seat' }) }),
      update(values) { return { eq: async () => { betState = { ...betState, ...structuredClone(values) }; return { error: null }; } }; },
    };
    return chain;
  },
  async rpc(name, values) { assert.equal(name, 'credit_balance'); credits++; paid += values.p_amount_cents; return { data: paid, error: null }; },
};
const dependencies = {
  'next/server': next, '@/lib/auth/session': auth,
  '@/lib/db/supabase': { getServiceSupabase: () => database },
  '@/lib/games/crash': crash, '@/lib/realtime/pusher-server': { publishLobby: async () => {} },
};
const current = await load('src/app/api/games/crash/current/route.ts', dependencies, { Date: AuditDate });
const response = await current.GET({ nextUrl: { searchParams: new URLSearchParams({ lobbyId: 'lobby' }) } });
assert.equal(response.body.round.crashAt, round.crash_multiplier);
const cashout = await load('src/app/api/games/crash/cashout/route.ts', dependencies, { Date: AuditDate });
const request = { json: async () => ({ betId: 'bet', multiplier: 1.2 }) };
const concurrent = await Promise.all([cashout.POST(request), cashout.POST(request)]);
assert.deepEqual(concurrent.map(r => r.status), [200, 200]);
assert.equal(credits, 2);
assert.equal(paid, 240);
const concurrentCredits = credits, concurrentPaid = paid;
round.crash_multiplier = 1.99;
auditNow = Math.floor(95_000 + crash.secondsToReachMultiplier(2) * 1000);
betState.details.status = 'active';
const afterCrash = await cashout.POST({ json: async () => ({ betId: 'bet', multiplier: 2 }) });
const crashedMs = 95_000 + crash.secondsToReachMultiplier(1.99) * 1000;
assert(auditNow > crashedMs);
assert.equal(afterCrash.status, 200);
assert.equal(afterCrash.body.payoutCents, 199);

const sides = { small: 0, big: 0, triple: 0 };
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
  sides[a === b && b === c ? 'triple' : a + b + c >= 11 ? 'big' : 'small']++;
}
assert.deepEqual(sides, { small: 105, big: 105, triple: 6 });

const report = {
  checkedAt: new Date().toISOString(), sourceCommit: 'bc55199db43cdae829b5c001de15afb2bbe13ff6', files,
  diamonds: { method: 'Exact enumeration of all 7776 symbol sequences using upstream deal()',
    totalWeight: totalWeight.toString(), payoutWeight: payoutWeight.toString(), rtpPercent: Number(payoutWeight) / Number(totalWeight) * 100,
    hitPercent: Number(winningWeight) / Number(totalWeight) * 100, maxMultiplier, distribution },
  crash: { boundaryCases: crashCases, futureCrashPointExposed: true,
    concurrentCashout: { requests: 2, successStatuses: concurrent.map(r => r.status), credits: concurrentCredits, paidCents: concurrentPaid, expectedSinglePayoutCents: 120 },
    afterCrashCashout: { millisecondsLate: auditNow - crashedMs, status: afterCrash.status, payoutCents: afterCrash.body.payoutCents },
    maxPossibleMultiplier: .99 * 2 ** 48, limits: 'No full database or realtime deployment tested; isolated original handlers with mocked storage.' },
  sicbo: { method: 'Independent enumeration of all 216 dice outcomes matching Big/Small rules', outcomes: sides,
    rtpPercent: 2 * sides.small / 216 * 100, scope: 'Big/Small, triples lose; not a full Sic Bo table' },
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ diamonds: report.diamonds.rtpPercent, crashPointExposed: true, duplicateCrashCredits: concurrentCredits, afterCrashCashout: afterCrash.status, sicbo: report.sicbo.rtpPercent }));
