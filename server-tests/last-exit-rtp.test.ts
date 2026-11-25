import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { demoBalanceUnits, demoReservedUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';
import { CRASH_RTP_PERCENT, CRASH_TICKETS, crashPointFromTicket, rollCrashPoint } from '../server/games/rush/crash';
import { LastExitCashoutDelay } from '../server/lastExitCashoutDelay';
import { crashModel, validateCrashProof } from '../scripts/game-math/rtp-crash.mjs';
import { stakeInputs } from '../scripts/game-math/rtp-gate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('every accepted exit returns at most 96 percent and at least the one cent floor below it', () => {
  const model = crashModel();
  assert.equal(CRASH_RTP_PERCENT, 96); assert.equal(model.acceptedMilliseconds, 76753);
  assert.equal(model.maximum.rtp, .96); assert.equal(model.automaticCap.rtp, .96); assert.equal(model.instantCrash.probability, .04);
  assert(model.minimum.rtp >= .9505 && model.minimum.rtp < .96);
});

test('the gate rejects a changed law, loosened bounds and foreign evidence', async () => {
  const inputs = await stakeInputs(root, 'github-crash'), proof = JSON.parse(await readFile(new URL('../' + inputs.policy.proof, import.meta.url), 'utf8'));
  assert(validateCrashProof('github-crash', inputs, proof));
  const bad = (edit: (value: any) => void) => { const copy = structuredClone(proof); edit(copy); assert.throws(() => validateCrashProof('github-crash', inputs, copy)); };
  bad(p => { p.evidence.model.maximum.rtp = .99; }); bad(p => { p.results[0].rtpBounds = [.98, .99]; }); bad(p => { p.walletEvidence.clientVerified = false; }); bad(p => { p.replay.coverage.pop(); });
  const target = structuredClone(inputs); target.policy.target = .99; assert.throws(() => validateCrashProof('github-crash', target, proof), /generator and the policy target differ|outside its policy/);
  const source = structuredClone(inputs); source.sourceHashes['server/games/rush/crash.ts'] = '0'.repeat(64); assert.throws(() => validateCrashProof('github-crash', source, proof), /rerun qualification/);
});

test('the player text states the qualified return in both languages', async () => {
  const text = await readFile(new URL('../games/last-exit/text.ts', import.meta.url), 'utf8');
  assert(text.includes('около ' + CRASH_RTP_PERCENT + '%') && text.includes('approximately ' + CRASH_RTP_PERCENT + '%')); assert(!text.includes('99%'));
});

async function fixture(roll: () => number) {
  const db = new PostgresDatabase(':memory:'); await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('p')");
  const wallet = new DemoWalletStore(db, () => 0); await wallet.operate('p', { id: randomUUID(), kind: 'deposit', amount: 10000 }); await wallet.expansion.ready; let now = 1e6;
  const open = (law: () => number) => new DemoExpansionStore(db, async id => ({ balance: await demoBalanceUnits(db, id) / 100, entries: [] }), wallet.ready, async () => {}, () => 0, () => now, cardEngine, law, new LastExitCashoutDelay(async () => {}));
  return { db, open, store: open(roll), time: (value: number) => { now = value; } };
}

test('a round accepted under the earlier law keeps its stored point after the change', async () => {
  // This ticket crashed at 2.0000x under 99 percent and would crash earlier under 96 percent.
  const ticket = Math.floor(.99 * CRASH_TICKETS / 2), before = 99 / (ticket / CRASH_TICKETS * 100); assert(crashPointFromTicket(ticket) < 1.95 && before >= 2);
  const f = await fixture(() => before);
  try {
    const start = { id: randomUUID(), gameId: 'github-crash' as const, action: 'start' as const, stakeUnits: '1000', settings: {} }, session = (await f.store.operate('p', start)).session, balance = await demoBalanceUnits(f.db, 'p');
    const restarted = f.open(rollCrashPoint); f.time(session.startedAt! + Math.ceil(Math.log(1.98) / .06 * 1000));
    const cash = { id: randomUUID(), gameId: 'github-crash' as const, action: 'move' as const, sessionId: session.id, move: 'cashout' }, paid = await restarted.operate('p', cash);
    assert.equal(paid.session.multiplier, 1.98); assert.equal(paid.session.returnedUnits, '1980'); assert.equal(await demoBalanceUnits(f.db, 'p'), balance + 1980); assert.equal(await demoReservedUnits(f.db, 'p'), 0);
    const replay = await restarted.operate('p', cash); assert(replay.replayed); assert.equal(await demoBalanceUnits(f.db, 'p'), balance + 1980);
  } finally { await f.db.close(); }
});
