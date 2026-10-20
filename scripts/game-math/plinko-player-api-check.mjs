import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { validVolcanicRound } from '../../src/ui/volcanicPlinkoModel.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:2618';
const target = new URL(base);
assert(['127.0.0.1', 'localhost'].includes(target.hostname), 'This audit is restricted to a local test API');
const pause = () => new Promise(resolve => setTimeout(resolve, 85));
function client() {
  let cookie = '', account = '';
  return {
    setAccount(id) { account = id; },
    async call(path, body, overrideAccount) {
      await pause();
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(account ? { 'X-Royal-Account-Id': overrideAccount ?? account } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const saved = response.headers.get('set-cookie'); if (saved) cookie = saved.split(';')[0];
      return { status: response.status, data: await response.json() };
    },
  };
}
const request = (risk, amount = 10) => ({ id: randomUUID(), kind: 'play', gameId: 'royal-plinko', rulesVersion: 1, amount, input: { rows: 12, risk } });
const report = { date: '2026-10-20', environment: 'Existing isolated local PostgreSQL test API', base, production: 'untouched', sessions: [] };
for (const risk of ['easy', 'medium', 'hard']) {
  const api = client();
  const login = await api.call('/api/auth/login', { email: `plinko-player-audit-${randomUUID()}@example.test`, password: 'Royal-player-audit-local-password!' });
  assert.equal(login.status, 200); api.setAccount(login.data.account.id);
  const deposit = await api.call('/api/demo-wallet/operations', { id: randomUUID(), kind: 'deposit', amount: 1000 }); assert.equal(deposit.status, 200);
  let balanceUnits = 100000, last, lastResult; const counts = { profit: 0, stakeReturned: 0, partialReturnLoss: 0, totalLoss: 0 }, path = [1000];
  for (let index = 0; index < 40; index++) {
    last = request(risk); const result = await api.call('/api/demo-wallet/operations', last); assert.equal(result.status, 200);
    const round = result.data.gameRound; assert(validVolcanicRound(round)); assert.equal(round.input.risk, risk); assert.equal(round.stakeUnits, '1000');
    const paid = Number(round.payoutUnits); balanceUnits += paid - 1000;
    assert.equal(Math.round(result.data.wallet.balance * 100), balanceUnits);
    const entries = result.data.wallet.entries.filter(entry => entry.operationId === last.id);
    assert.equal(entries.filter(entry => entry.kind === 'bet').length, 1); assert.equal(entries.filter(entry => entry.kind === 'win').length, 1);
    counts[paid > 1000 ? 'profit' : paid === 1000 ? 'stakeReturned' : paid > 0 ? 'partialReturnLoss' : 'totalLoss']++;
    path.push(balanceUnits / 100); lastResult = result.data;
  }
  const replay = await api.call('/api/demo-wallet/operations', last);
  assert.equal(replay.status, 200); assert.deepEqual(replay.data.gameRound, lastResult.gameRound); assert.equal(Math.round(replay.data.wallet.balance * 100), balanceUnits);
  const changed = await api.call('/api/demo-wallet/operations', { ...last, amount: 50 }); assert.equal(changed.status, 409);
  const duplicate = request(risk);
  const concurrent = await Promise.all([api.call('/api/demo-wallet/operations', duplicate), api.call('/api/demo-wallet/operations', duplicate)]);
  assert(concurrent.every(value => value.status === 200)); assert.deepEqual(concurrent[0].data.gameRound, concurrent[1].data.gameRound);
  balanceUnits += Number(concurrent[0].data.gameRound.payoutUnits) - 1000;
  const invalid = await api.call('/api/demo-wallet/operations', { ...request(risk), input: { rows: 12.5, risk } }); assert.equal(invalid.status, 400);
  const tampered = await api.call('/api/demo-wallet/operations', { ...request(risk), multiplier: 170 }); assert.equal(tampered.status, 400);
  const otherAccount = await api.call('/api/demo-wallet', undefined, randomUUID()); assert.equal(otherAccount.status, 401);
  const final = await api.call('/api/demo-wallet'); assert.equal(final.status, 200); assert.equal(Math.round(final.data.balance * 100), balanceUnits);
  assert.equal(final.data.entries.filter(entry => entry.operationId === duplicate.id && entry.kind === 'bet').length, 1);
  report.sessions.push({ risk, normalRounds: 40, stakeCoins: 10, initialCoins: 1000, counts, finalNormalCoins: path.at(-1), balancesCoins: path,
    replay: 'same outcome, no second debit', conflictingReplayStatus: changed.status, concurrentDuplicate: 'one stake', invalidRowsStatus: invalid.status, tamperedPayoutStatus: tampered.status, mismatchedAccountStatus: otherAccount.status, finalAfterConcurrencyCoins: balanceUnits / 100 });
  console.log(JSON.stringify(report.sessions.at(-1)));
}
const empty = client(); const login = await empty.call('/api/auth/login', { email: `plinko-empty-${randomUUID()}@example.test`, password: 'Royal-player-audit-local-password!' });
assert.equal(login.status, 200); empty.setAccount(login.data.account.id);
const denied = await empty.call('/api/demo-wallet/operations', request('easy')); assert.equal(denied.status, 400);
const snapshot = await empty.call('/api/demo-wallet'); assert.equal(snapshot.status, 200); assert.equal(snapshot.data.balance, 0); assert.equal(snapshot.data.entries.length, 0);
report.insufficientBalance = { status: denied.status, walletAfter: 0, ledgerEntries: 0 };
report.result = 'passed';
writeFileSync('artifacts/plinko-player-audit-20261020/api.json', JSON.stringify(report, null, 2) + '\n');
const statistical = JSON.parse(readFileSync('artifacts/plinko-player-audit-20261020/report.json', 'utf8')); statistical.api = { result: report.result, normalRounds: 120, concurrencyRounds: 3, report: 'api.json' };
writeFileSync('artifacts/plinko-player-audit-20261020/report.json', JSON.stringify(statistical, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, normalRounds: 120, insufficientBalance: report.insufficientBalance }));
