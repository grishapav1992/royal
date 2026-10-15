import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { build } from 'esbuild';
import { prepareGame, verifyGameRound } from '../server/games/core';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { DEMO_BETS } from '../src/shared/demoWallet';
import {
  exactPayoutUnits, getKenoMultipliers, getKenoRtp, getPlinkoMultipliers, getPlinkoRtp,
  ORIGINAL_DEFAULT_INPUTS, diceOdds, getDiceRtp, getDiceRtpForStake, getLimboRtp, getLimboWinProbability,
} from '../src/shared/originalGames';
import { getBasePlinkoMultipliers } from '../server/games/vfair/plinko/plinko-multipliers';
import { KENO_REFERENCE_PAYTABLES } from '../server/games/vfair/keno/keno-reference-paytables';
import { rollLimboFromHash } from '../server/games/vfair/limbo/limbo-provably-fair';
import { LIMBO_OUTCOME_COUNT, rollLimboFromInteger } from '../server/games/vfair/limbo/limbo-roll';

async function database() {
  const db = new PostgresDatabase(':memory:');
  (await db.exec(" CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('alice');"));
  return db;
}
const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i;
  return Math.round(c);
};

test('all Dice discrete rolls use upstream odds and exact integer-unit settlement', () => {
  for (const gameMode of ['rollUnder', 'rollOver'] as const) {
    const game = prepareGame('royal-dice', 1, { gameMode, sliderValue: 50 });
    let wins = 0, payout = 0n;
    for (let rolled = 0; rolled < 10000; rolled++) {
      const round = game.play(1000n, max => { assert.equal(max, 10000); return rolled; });
      assert.equal(round.gameId, 'royal-dice');
      if (round.gameId !== 'royal-dice') throw new Error();
      const won = gameMode === 'rollUnder' ? rolled < 5000 : rolled >= 5000;
      assert.equal(round.outcome.won, won);
      assert.equal(round.multiplier, won ? 1.96 : 0);
      assert.equal(verifyGameRound(round), true);
      if (won) wins++;
      payout += BigInt(round.payoutUnits);
    }
    assert.equal(wins, 5000);
    assert.equal(payout, 9800000n);
  }
  const odds = diceOdds.calculate({ gameMode: 'rollUnder', sliderValue: 49.01 });
  const rounded = prepareGame('royal-dice', 1, { gameMode: 'rollUnder', sliderValue: 49.01 }).play(1000n, () => 0);
  assert.equal(rounded.multiplier, odds.multiplier);
  assert.equal(rounded.payoutUnits, '1999');
  assert.ok(Math.abs(getDiceRtp({ gameMode: 'rollUnder', sliderValue: 49.01 }) - 0.98000396) < 1e-12);
  assert.equal(exactPayoutUnits(100n, 1.15), 115n);
  assert.equal(exactPayoutUnits(9007199254740993n, 1.94), 17473966554197526n);
});

test('Dice displayed RTP includes the actual payout flooring for every permitted stake', () => {
  for (const gameMode of ['rollUnder', 'rollOver'] as const) {
    const input = { gameMode, sliderValue: 96.94 };
    const game = prepareGame('royal-dice', 1, input);
    let wins = 0;
    for (let rolled = 0; rolled < 10000; rolled++) {
      const round = game.play(1000n, () => rolled);
      if (round.gameId !== 'royal-dice') throw new Error();
      if (round.outcome.won) wins++;
    }
    for (const amount of DEMO_BETS) {
      const stakeUnits = BigInt(amount) * 100n;
      const winningRound = game.play(stakeUnits, () => gameMode === 'rollUnder' ? 0 : 9999);
      const actualReturn = Number(BigInt(winningRound.payoutUnits) * BigInt(wins)) / Number(stakeUnits * 10000n);
      assert.ok(Math.abs(getDiceRtpForStake(input, stakeUnits) - actualReturn) < 1e-12);
    }
  }
  const input = { gameMode: 'rollUnder', sliderValue: 96.94 } as const;
  assert.ok(Math.abs(getDiceRtpForStake(input, 1000n) - 0.979094) < 1e-12);
  assert.ok(Math.abs(getDiceRtpForStake(input, 5000n) - 0.97986952) < 1e-12);
  assert.ok(Math.abs(getDiceRtpForStake(input, 10000n) - getDiceRtp(input)) < 1e-12);
  assert.throws(() => getDiceRtpForStake(input, 0n));
});

test('Plinko exposes and actually uses all 36 upstream tables and binomial bucket probabilities', () => {
  for (let rows = 8; rows <= 16; rows++) for (const risk of ['easy', 'medium', 'hard', 'expert'] as const) {
    const table = getPlinkoMultipliers(rows, risk);
    assert.deepEqual(table, getBasePlinkoMultipliers(rows, risk));
    let expected = 0;
    for (let bucket = 0; bucket <= rows; bucket++) {
      expected += choose(rows, bucket) / 2 ** rows * table[bucket];
      let index = 0;
      const path = Array.from({ length: rows }, (_, i) => i < bucket ? 1 : 0);
      const round = prepareGame('royal-plinko', 1, { rows, risk }).play(1000n, max => { assert.equal(max, 2); return path[index++]; });
      assert.equal(round.gameId, 'royal-plinko');
      if (round.gameId !== 'royal-plinko') throw new Error();
      assert.equal(index, rows);
      assert.equal(round.outcome.bucket, bucket);
      assert.deepEqual(round.outcome.path, path);
      assert.equal(round.multiplier, table[bucket]);
      assert.equal(round.payoutUnits, String(Math.round(table[bucket] * 100) * 10));
      assert.equal(verifyGameRound(round), true);
    }
    assert.ok(Math.abs(expected - getPlinkoRtp(rows, risk)) < 1e-12);
  }
  const game = prepareGame('royal-plinko', 1, { rows: 8, risk: 'medium' });
  let sum = 0n;
  for (let mask = 0; mask < 256; mask++) {
    let bit = 0;
    const round = game.play(1000n, () => mask >>> bit++ & 1);
    sum += BigInt(round.payoutUnits);
  }
  assert.equal(Number(sum) / 256000, getPlinkoRtp(8, 'medium'));
});

test('Keno draws ten distinct numbers and settles actual upstream tables for all forty modes', () => {
  for (let count = 1; count <= 10; count++) for (const risk of ['classic', 'low', 'medium', 'high'] as const) {
    const picks = Array.from({ length: count }, (_, i) => i + 1);
    const table = getKenoMultipliers(count, risk);
    assert.deepEqual(table, KENO_REFERENCE_PAYTABLES[count][risk]);
    let expected = 0;
    for (let hits = 0; hits <= count; hits++) expected += choose(count, hits) * choose(40 - count, 10 - hits) / choose(40, 10) * table[hits];
    assert.ok(Math.abs(expected - getKenoRtp(count, risk)) < 1e-12);
    const round = prepareGame('royal-keno', 1, { picks, risk }).play(1000n, () => 0);
    assert.equal(round.gameId, 'royal-keno');
    if (round.gameId !== 'royal-keno') throw new Error();
    assert.deepEqual(round.outcome.drawnNumbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(round.outcome.hits, picks);
    assert.equal(round.multiplier, table[count]);
    assert.equal(verifyGameRound(round), true);
  }
  assert.equal(getKenoRtp(1, 'classic'), 0.99);
  const game = prepareGame('royal-keno', 1, { picks: [3, 1, 2], risk: 'classic' });
  assert.deepEqual(game.input, { picks: [1, 2, 3], risk: 'classic' });
});

test('Limbo preserves the upstream hash-to-multiplier arithmetic and applies target payout with instant losses', () => {
  for (const integer of [0, 1, 123456789, 2147483648, 4294967295]) {
    const round = prepareGame('royal-limbo', 1, { targetMultiplier: 2 }).play(1000n, max => { assert.equal(max, 2 ** 32); return integer; });
    assert.equal(round.gameId, 'royal-limbo');
    if (round.gameId !== 'royal-limbo') throw new Error();
    const rolled = rollLimboFromHash(integer.toString(16).padStart(8, '0'), 0.98);
    assert.equal(round.outcome.rolledMultiplier, rolled);
    assert.equal(round.outcome.won, rolled >= 2);
    assert.equal(round.multiplier, rolled >= 2 ? 2 : 0);
    assert.equal(verifyGameRound(round), true);
  }
});

test('the production game bundle uses the integer Limbo adapter without dev-only hash dependencies', async () => {
  const result = await build({
    entryPoints: ['server/games/core.ts'], bundle: true, platform: 'node', format: 'esm',
    packages: 'external', write: false, metafile: true,
  });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.some(path => path.endsWith('/limbo/limbo-roll.ts')));
  assert.equal(inputs.some(path => path.includes('/provably-fair/')), false);
  const externalImports = Object.values(result.metafile!.outputs).flatMap(output => output.imports).filter(entry => entry.external).map(entry => entry.path);
  assert.equal(externalImports.some(path => path.startsWith('@noble/')), false);
  assert.equal(result.outputFiles.some(file => file.text.includes('@noble/hashes')), false);
});

test('Limbo RTP counts the actual discrete win boundary including upstream double-floor gaps', () => {
  // Independent golden boundaries for the unchanged hash-to-roll function.
  const boundaries = [
    { target: 1.01, lastWin: 4167394009 },
    { target: 1.13, lastWin: 3692164868 },
    { target: 1.15, lastWin: 3628506853 },
    { target: 1.16, lastWin: 3597493974 },
    { target: 2, lastWin: 2104533975 },
    { target: 2.3, lastWin: 1822107337 },
    { target: 1000000, lastWin: 4209 },
  ];
  const upstreamRoll = (integer: number) => rollLimboFromHash(integer.toString(16).padStart(8, '0'), 0.98);
  for (const { target, lastWin } of boundaries) {
    const probability = (lastWin + 1) / LIMBO_OUTCOME_COUNT;
    assert.equal(getLimboWinProbability(target), probability);
    assert.equal(getLimboRtp(target), probability * target);
    const game = prepareGame('royal-limbo', 1, { targetMultiplier: target });
    for (const integer of [0, 1, lastWin - 1, lastWin, lastWin + 1, LIMBO_OUTCOME_COUNT - 1]) {
      const expected = upstreamRoll(integer);
      assert.equal(rollLimboFromInteger(integer, 0.98), expected);
      const round = game.play(1001n, () => integer);
      if (round.gameId !== 'royal-limbo') throw new Error();
      assert.equal(round.outcome.rolledMultiplier, expected);
      assert.equal(round.outcome.won, integer <= lastWin);
      assert.equal(round.payoutUnits, String(integer <= lastWin ? exactPayoutUnits(1001n, target) : 0n));
      assert.equal(verifyGameRound(round), true);
    }
  }
  assert.ok(upstreamRoll(boundaries[1].lastWin) >= 1.13);
  assert.equal(upstreamRoll(boundaries[1].lastWin + 1), 1.12);
  assert.ok(Math.abs(getLimboRtp(1.13) - 0.971403508905787) < 1e-15);
  assert.ok(Math.abs(getLimboRtp(1000000) - 0.9802170097827911) < 1e-15);
  for (const target of [NaN, Infinity, 1, 1000000.01, 2.001]) assert.throws(() => getLimboRtp(target));
});

test('Originals reject forged inputs and altered outcome or payout without accepting Mines as instant', () => {
  const invalid = [
    ['royal-dice', { gameMode: 'rollUnder', sliderValue: 0 }], ['royal-dice', { gameMode: 'rollUnder', sliderValue: NaN }],
    ['royal-dice', { gameMode: 'rollUnder', sliderValue: 50.001 }], ['royal-dice', { gameMode: 'other', sliderValue: 50 }],
    ['royal-plinko', { rows: 7, risk: 'easy' }], ['royal-plinko', { rows: 17, risk: 'easy' }], ['royal-plinko', { rows: 8, risk: '__proto__' }],
    ['royal-limbo', { targetMultiplier: 1 }], ['royal-limbo', { targetMultiplier: Infinity }], ['royal-limbo', { targetMultiplier: 2.001 }],
    ['royal-keno', { picks: [1, 1], risk: 'classic' }], ['royal-keno', { picks: [0], risk: 'classic' }], ['royal-keno', { picks: [41], risk: 'classic' }],
    ['royal-keno', { picks: [], risk: 'classic' }], ['royal-mines', {}],
  ] as const;
  for (const [id, input] of invalid) assert.throws(() => prepareGame(id, 1, input));
  for (const [id, input] of Object.entries(ORIGINAL_DEFAULT_INPUTS)) {
    assert.throws(() => prepareGame(id, 1, { ...input, multiplier: 10000 }));
    const game = prepareGame(id, 1, input);
    for (const random of [-1, NaN, 0.5, Infinity]) assert.throws(() => game.play(1000n, () => random));
    const round = game.play(1000n, () => 0);
    assert.equal(verifyGameRound(round), true);
    assert.equal(verifyGameRound({ ...round, multiplier: round.multiplier + 0.01 }), false);
    assert.equal(verifyGameRound({ ...round, payoutUnits: String(BigInt(round.payoutUnits) + 1n) }), false);
    assert.equal(verifyGameRound({ ...round, outcome: { ...round.outcome, extra: 1 } }), false);
  }
});

test('Originals wallet commits fractional-cent flooring and replays after reopen without fresh randomness', async () => {
  const db = (await database()); let draws = 0;
  try {
    let wallet = new DemoWalletStore(db, () => { draws++; return 0; });
    (await wallet.operate('alice', { id: randomUUID(), kind: 'deposit', amount: 1000 }));
    const request = { id: randomUUID(), kind: 'play', amount: 10, gameId: 'royal-dice', rulesVersion: 1, input: { gameMode: 'rollUnder', sliderValue: 49.01 } };
    const result = (await wallet.operate('alice', request));
    assert.equal(result.gameRound!.payoutUnits, '1999');
    assert.equal(result.wallet.balance, 1009.99);
    wallet = new DemoWalletStore(db, () => { throw new Error('Must replay'); });
    const replay = (await wallet.operate('alice', request));
    assert.deepEqual(replay.gameRound, result.gameRound);
    assert.equal(replay.wallet.balance, 1009.99);
    assert.equal(draws, 1);
    (await assert.rejects(async () => (await wallet.operate('alice', { ...request, input: { ...request.input, sliderValue: 50 } })), error => error instanceof WalletError && error.status === 409));
    (await db.exec("CREATE OR REPLACE FUNCTION fail_original_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='play' THEN RAISE EXCEPTION 'interrupted'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_original BEFORE INSERT ON demo_operations FOR EACH ROW EXECUTE FUNCTION fail_original_fn();"));
    wallet = new DemoWalletStore(db, () => 0);
    const before = (await wallet.snapshot('alice'));
    (await assert.rejects(async () => (await wallet.operate('alice', { ...request, id: randomUUID() })), /interrupted/));
    assert.deepEqual((await wallet.snapshot('alice')), before);
  } finally { (await db.close()); }
});
