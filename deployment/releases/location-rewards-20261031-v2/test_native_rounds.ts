import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {BASE, FEATURE} from './prepare.mjs';
import {projectedRuntime} from './projected-runtime.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const testPath = 'deployment/releases/location-rewards-20261031-v2/test_native_rounds.ts';
const helperPath = 'deployment/releases/location-rewards-20261031-v2/projected-runtime.mjs';
const persistedGameIds = [
  'github-caribbean-draw', 'github-switch', 'github-three-card', 'studio-caribbean-treasures', 'studio-dracona',
  'studio-dune-hopper', 'studio-lumen-grove', 'studio-petal-parlor', 'studio-prism-atelier', 'studio-pulse-district',
  'studio-sky-lanterns', 'studio-starfall-oracle', 'variant-dice-streak',
];
const command = 'node --import tsx scripts/database-test.ts --test ' + testPath;
const draw = (seed: number) => (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
const empty = () => ({player: [], dealer: [], community: [], actions: [], phase: 1, ended: false, message: 'Synthetic saved round'});

test('exact production native rounds survive same-schema activation and restart with unchanged money and no retroactive XP', {timeout: 120000}, async t => {
  assert.equal(process.env.NODE_ENV, 'test'); assert.equal(process.env.PGDATABASE, 'royal_test'); assert.equal(process.env.PGHOST, '127.0.0.1');
  const runtime = await projectedRuntime(), a: any = runtime.api;
  assert.equal(Object.keys(runtime.nativeProgramSources).length, 128);
  let db = new a.PostgresDatabase(':memory:'); await db.ready;
  const schema = db.schema, clock = {value: Date.now() - 10000}, accounts = ['reference', 'upgraded'];
  await db.exec('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)');
  let raw = new a.DemoWalletStore(db, () => 0, () => clock.value); await raw.ready;
  const readNative = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ['demo_wallets', 'demo_ledger', 'demo_casino_sessions', 'demo_casino_requests',
      'demo_mines_sessions', 'demo_mines_requests', 'demo_flight_sessions', 'demo_flight_requests', 'demo_operations'])
      rows[table] = await db.prepare('SELECT row_to_json(t) AS row FROM ' + table + ' t ORDER BY row_to_json(t)::text').all();
    return rows;
  };
  const stateRows = async (account: string) => db.prepare('SELECT id,game_id,state,payload,reserved_units FROM demo_casino_sessions WHERE account_id=? ORDER BY id').all(account);
  const ledger = async (account: string) => (await db.prepare('SELECT operation_id,entry_type,amount_units,balance_units,source FROM demo_ledger WHERE account_id=? ORDER BY id').all(account));
  const zeroExperience = async () => {
    for (const table of ['progression_rounds', 'progression_outbox', 'progression_xp', 'progression_rewards'])
      assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM ' + table).get()).n), 0, 'Old saved rounds entered ' + table);
  };
  const starts = new Map<string, any>();
  const seed = async (session: any, start: any, debit: number, credit: number) => {
    assert.equal(session.state, 'active', 'Synthetic initial round must remain resumable');
    starts.set(session.gameId, start);
    for (const account of accounts) await db.transaction(async () => {
      const saved = structuredClone(session);
      await db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run(account, saved.id, saved.gameId, saved.state, JSON.stringify(saved), 0);
      await raw.expansion.money(account, saved, start.id, debit, credit);
      await db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(account, start.id, JSON.stringify(start), saved.id, clock.value);
    }, {lockKey: 'account:' + account});
  };
  try {
    for (const account of accounts) { await db.prepare('INSERT INTO accounts VALUES(?)').run(account); await a.saveDemoUnits(db, account, 1000000); }
    // Historical retired games cannot be newly wagered through the current API. Generate only synthetic
    // accepted states with the retained engines, then persist their normal money/request contract.
    for (const gameId of persistedGameIds) {
      const start: any = {id: randomUUID(), gameId, action: 'start', stakeUnits: '1000', settings: {}};
      const session: any = {id: start.id, gameId, rulesVersion: a.expansionRulesVersion(gameId), state: 'active',
        stakeUnits: start.stakeUnits, spentUnits: '0', returnedUnits: '0', createdAt: clock.value, settings: start.settings, view: empty()};
      let debit = 1000, credit = 0;
      if (gameId.startsWith('github-')) {
        const engine = gameId.slice('github-'.length); start.settings = gameId === 'github-three-card' ? {side: false} : {};
        session.settings = start.settings; session.rulesVersion = 1;
        ({debit, credit} = raw.expansion.applyCards(session, await a.cardEngine(engine, 'start', undefined, undefined, false, 1)));
      } else if (gameId === 'studio-caribbean-treasures') {
        start.settings = {caribbean: {lines: 1, mode: 'buy-raid'}}; session.settings = start.settings;
        debit = Number(a.caribbeanInitialCost(start.settings.caribbean, start.stakeUnits));
        credit = raw.expansion.applyCaribbean(session, a.startCaribbean(start.settings.caribbean, start.stakeUnits, draw(1))).credit;
      } else if (gameId === 'studio-dracona') {
        start.settings = {dracona: {mode: 'normal'}}; session.settings = start.settings;
        credit = raw.expansion.applyDracona(session, a.startDracona(start.settings, start.stakeUnits, draw(7))).credit;
      } else if (gameId === 'variant-dice-streak') {
        start.settings = structuredClone(a.VARIANT_DEFAULTS[gameId]); session.settings = start.settings;
        credit = raw.expansion.applyVariant(session, a.startVariant(gameId, start.settings, start.stakeUnits, draw(1))).credit;
      } else {
        start.settings = structuredClone(a.STUDIO_DEFAULTS[gameId]); session.settings = start.settings;
        const selected = ['studio-petal-parlor', 'studio-pulse-district', 'studio-sky-lanterns'].includes(gameId) ? 3 : 1;
        credit = raw.expansion.applyStudio(session, a.startStudioGame(gameId, start.settings, start.stakeUnits, draw(selected))).credit;
      }
      await seed(session, start, debit, credit);
    }
    const crash = {id: randomUUID(), gameId: 'github-crash', action: 'start', stakeUnits: '1000', settings: {}};
    await seed({id: crash.id, gameId: crash.gameId, rulesVersion: 1, state: 'active', stakeUnits: '1000', spentUnits: '0', returnedUnits: '0',
      createdAt: clock.value, settings: {}, view: empty(), startedAt: clock.value + 2000, crashPoint: 2}, crash, 1000, 0);
    const mines = {id: randomUUID(), action: 'start', amount: 10, mineCount: 1};
    const tower = {id: randomUUID(), action: 'start', gameId: 'github-tower', stakeUnits: '1000', settings: {difficulty: 'easy'}};
    const flight = {id: randomUUID(), action: 'start', amount: 10, autoCashout: 1.1};
    for (const account of accounts) {
      await raw.mines.operate(account, mines); await raw.casino.operate(account, tower); await raw.flight.operate(account, flight);
    }
    const before = await readNative(), beforeStates = await stateRows('upgraded');
    assert.equal(beforeStates.filter((s: any) => persistedGameIds.includes(s.game_id)).length, 13);
    await db.close();
    db = new a.PostgresDatabase(schema, {existingSchema: true}); await db.ready;
    let upgradedRaw = new a.DemoWalletStore(db, () => 0, () => clock.value); await upgradedRaw.ready;
    let progression = new a.ProgressionStore(db, {now: () => clock.value + 1000, prerequisite: upgradedRaw.ready}); await progression.ready;
    let upgraded = a.instrumentProgressionWallet(db, upgradedRaw, progression); await upgraded.ready;
    assert.deepEqual(await readNative(), before, 'Application initialization changed accepted native money or payload');
    const activated = (await db.prepare('SELECT activated_at FROM progression_settings').get()).activated_at;
    await zeroExperience();
    await db.close();
    db = new a.PostgresDatabase(schema, {existingSchema: true}); await db.ready;
    raw = new a.DemoWalletStore(db, () => 0, () => clock.value); await raw.ready;
    upgradedRaw = new a.DemoWalletStore(db, () => 0, () => clock.value); await upgradedRaw.ready;
    progression = new a.ProgressionStore(db, {now: () => clock.value + 500000, prerequisite: upgradedRaw.ready}); await progression.ready;
    upgraded = a.instrumentProgressionWallet(db, upgradedRaw, progression); await upgraded.ready;
    assert.equal((await db.prepare('SELECT activated_at FROM progression_settings').get()).activated_at, activated, 'Restart moved the activation boundary');
    assert.deepEqual(await readNative(), before, 'Second bootstrap changed saved native obligations');
    assert.deepEqual((await upgraded.expansion.active('upgraded')).sessions, (await raw.expansion.active('reference')).sessions);
    assert.deepEqual(await stateRows('upgraded'), beforeStates, 'Reopening changed saved state or reserve');
    const operate = (wallet: any, account: string, op: any) => wallet.expansion.operate(account, op);
    let paidContinuation = false, freeContinuation = false;
    const completed = new Set<string>();
    for (const gameId of persistedGameIds) await t.test(gameId + ' retains its saved rules, money and replay', async () => {
      const start = starts.get(gameId), old = await operate(raw, 'reference', start), reopened = await operate(upgraded, 'upgraded', start);
      assert.deepEqual(reopened.session, old.session); assert(reopened.replayed);
      let session = old.session, last: any = start;
      for (let turn = 0; session.state === 'active' && turn < 64; turn++) {
        const offered = session.view.actions;
        let move: string;
        if (gameId === 'github-caribbean-draw') move = turn === 0 ? 'draw' : 'fold';
        else if (gameId === 'github-three-card') move = 'play';
        else move = ['no-insurance', 'keep', 'stand', 'cashout'].find(name => offered.some((v: any) => v.move === name)) ?? offered[0].move;
        last = {id: randomUUID(), gameId, action: 'move', sessionId: start.id, move};
        if (gameId === 'github-caribbean-draw' && move === 'draw') last.picks = [0];
        if (gameId === 'variant-dice-streak' && move === 'roll') last.picks = [2];
        if (session.view.dracona) last.revision = session.view.dracona.revision;
        if (session.view.caribbean) last.revision = session.view.caribbean.revision;
        const cost = offered.find((v: any) => v.move === move)?.cost ?? 0;
        paidContinuation ||= cost > 0; freeContinuation ||= cost === 0;
        const reference = await operate(raw, 'reference', last), actual = await operate(upgraded, 'upgraded', last);
        assert.deepEqual(actual.session, reference.session); assert.equal(actual.wallet.balance, reference.wallet.balance);
        const money = await ledger('upgraded'); const duplicate = await operate(upgraded, 'upgraded', last);
        assert(duplicate.replayed); assert.deepEqual(duplicate.session, actual.session); assert.deepEqual(await ledger('upgraded'), money);
        session = reference.session;
      }
      assert.equal(session.state, 'settled', 'Saved round did not finish');
      assert.equal((await operate(upgraded, 'upgraded', start)).session.state, 'settled');
      await zeroExperience();
      completed.add(gameId);
    });
    assert.deepEqual([...completed].sort(), [...persistedGameIds].sort(), 'A failed child test cannot emit passing compatibility evidence');
    assert(paidContinuation && freeContinuation, 'Both paid and free saved continuations must be covered');
    const paired = async (family: string, op: any) => {
      const reference = await raw[family].operate('reference', op), actual = await upgraded[family].operate('upgraded', op);
      assert.deepEqual(actual.session, reference.session); assert.equal(actual.wallet.balance, reference.wallet.balance);
      const money = await ledger('upgraded'); await upgraded[family].operate('upgraded', op); assert.deepEqual(await ledger('upgraded'), money);
    };
    await paired('mines', {id: randomUUID(), action: 'reveal', sessionId: mines.id, cell: 24});
    await paired('mines', {id: randomUUID(), action: 'cashout', sessionId: mines.id});
    await paired('casino', {id: randomUUID(), gameId: tower.gameId, action: 'pick', sessionId: tower.id, choice: 1});
    await paired('casino', {id: randomUUID(), gameId: tower.gameId, action: 'cashout', sessionId: tower.id});
    for (const [family, start] of [['mines', mines], ['casino', tower], ['flight', flight]] as const) await paired(family, start);
    clock.value += 100000000;
    assert.equal((await upgraded.snapshot('upgraded')).balance, (await raw.snapshot('reference')).balance);
    assert.deepEqual((await upgraded.flight.snapshot('upgraded')).session, (await raw.flight.snapshot('reference')).session);
    assert.deepEqual(await stateRows('upgraded'), await stateRows('reference'));
    assert.deepEqual(await ledger('upgraded'), await ledger('reference'));
    for (const account of accounts) {
      const total = (await db.prepare('SELECT SUM(amount_units) AS n FROM demo_ledger WHERE account_id=?').get(account)).n;
      assert.equal(1000000 + Number(total), await a.demoBalanceUnits(db, account), 'Native ledger no longer balances to the initial funds');
    }
    assert.equal(await a.demoReservedUnits(db, 'upgraded'), 0);
    await zeroExperience();
    assert.equal((await progression.snapshot('upgraded')).xp, '0');
    const fresh = {id: randomUUID(), kind: 'spin', amount: 10};
    await upgraded.operate('upgraded', fresh); const money = await ledger('upgraded');
    await upgraded.operate('upgraded', fresh); assert.deepEqual(await ledger('upgraded'), money);
    assert.equal((await progression.snapshot('upgraded')).xp, '1000');
    assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM progression_xp').get()).n), 1);
    const report = {format: 1, productionCommit: BASE, featureCommit: FEATURE, backendProjection: runtime.backendProjection,
      test: {path: testPath, sha256: digest(await readFile(resolve(root, testPath))), helperPath,
        helperSha256: digest(await readFile(resolve(root, helperPath))), command, passed: true}, persistedGameIds,
      checks: {sameSchemaRestart: true, savedPayloadAndReservePreserved: true, referenceSettlementAndReplayEqual: true,
        oldSessionsGiveNoXp: true, freshPaidRoundGivesXpOnce: true}, sourceHashes: runtime.sourceHashes,
      preservationScope: {families: ['casino', 'mines'], timedRoundsStillDrain: ['royal-flight', 'github-crash'],
        combatPvpAndSkinReservationsStillDrain: true},
      nativeProgramSources: runtime.nativeProgramSources, fixturePrograms: {platform: process.platform, architecture: process.arch,
        files: Object.fromEntries(await Promise.all(['dist-server/card-engine', 'dist-server/card-engine-v1'].map(async path => [path, digest(await readFile(resolve(root, path)))])))}};
    // Evidence is an explicit opt-in local output, never a mutation of production or the tracked report.
    if (process.env.ROYAL_NATIVE_ROUND_REPORT) {
      const out = resolve(root, 'artifacts/work/location-rewards-v2/native-round-compatibility-result.json');
      assert.equal(resolve(process.env.ROYAL_NATIVE_ROUND_REPORT), out, 'Unexpected local proof output');
      await writeFile(out, JSON.stringify(report, null, 2) + '\n');
    }
  } finally { await db.dropSchema().catch(() => {}); await db.close(); }
});
