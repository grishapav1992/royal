import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import { buildCapturedCasinoReplay, persistCapturedCasinoReplay } from '../server/audit/replay-casino';
import { planReplaySeek, verifyReplayPackage } from '../server/audit/replay-package';
import { AuditReplayStore } from '../server/audit/replay-store';
import { PostgresDatabase } from '../server/database';
import { DemoExpansionStore } from '../server/demoExpansion';
import { DemoWalletStore } from '../server/demoWallet';
import { demoBalanceUnits } from '../server/demoWalletAmounts';
import { cardEngine } from '../server/games/cardEngine';
import { ROYAL_PLATFORM_GAMES } from '../src/shared/arcadeCatalog';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../src/shared/caribbeanTreasures';
import { settingsFor } from '../scripts/game-math/stake-runtime.mjs';
import { cascadeRandom } from '../scripts/game-math/rtp-temple-cascade-model.mjs';

async function fixture(t: TestContext, draw: (max: number) => number = () => 0) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close()]); });
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  const wallet = new DemoWalletStore(game, draw);
  const createPlayer = async (amount = 10000) => {
    const player = randomUUID();
    await game.prepare('INSERT INTO accounts VALUES (?)').run(player);
    await wallet.operate(player, { id: randomUUID(), kind: 'deposit', amount });
    return player;
  };
  const account = await createPlayer();
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId, environment } = await datasets.startTest();
  const refs = async (operationId: string, player = account) => (await game.prepare(`SELECT id::text,entry_type,amount_units::text
    FROM demo_ledger WHERE account_id=? AND operation_id=? ORDER BY demo_ledger.id`).all(player, operationId))
    .map(row => ({ type: row.entry_type, units: row.amount_units, posting: { namespace: game.schema + '.demo_ledger', rowId: row.id } }));
  const request = async (operationId: string, player = account) => ({
    datasetId, gameSchema: game.schema, posting: (await refs(operationId, player))[0].posting, replayId: randomUUID(),
  });
  return { game, audit, account, createPlayer, wallet, datasets, scope: { datasetId, environment }, refs, request };
}

test('instant replay retains the accepted selection, server outcome, zero payout and precision receipt', async t => {
  const f = await fixture(t);
  assert.deepEqual(await buildCapturedCasinoReplay(f.audit, { ...f.scope, gameSchema: f.game.schema,
    posting: { namespace: f.game.schema + '.demo_ledger', rowId: '1' }, replayId: randomUUID() }),
  { status: 'unavailable', reason: 'not-captured' });
  const id = randomUUID();
  await f.wallet.operate(f.account,
    { id, kind: 'play', gameId: 'royal-roulette', input: { bet: 'black' }, amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
  const input = await f.request(id);
  const replay = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(replay.status, 'built');
  const { manifest, fragments } = replay.value;
  assert.equal(manifest.coverage, 'complete');
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.timing, 'source-order');
  assert.equal(manifest.entityId, id);
  const [stake, payout] = fragments[0].events;
  assert.deepEqual(stake.data, { kind: 'action', action: { profile: 'casino-steps', code: 'start', selection: [1] } });
  assert.deepEqual(payout.data, { kind: 'terminal', state: { profile: 'casino-steps', phase: 'settled', revision: 1, visible: [0] },
    outcome: 'settled', winnerSeat: null });
  const ledger = await f.refs(id);
  assert.deepEqual(stake.money, [{ movement: 'stake', units: '-10', posting: ledger[0].posting }]);
  assert.deepEqual(payout.money, [{ movement: 'payout', units: '0', posting: ledger[1].posting }]);
  assert.deepEqual(payout.calculation, { numerator: '0', denominator: '1', baseUnits: '0', creditedUnits: '0' });
  assert(fragments[0].events.every(event => event.atMs === 0));
  assert(!JSON.stringify(replay).includes(f.account));
  assert(!JSON.stringify(replay).includes('"ticket"'));

  const engine = { ...manifest.game, formatVersion: 2 };
  assert.equal(verifyReplayPackage(replay.value, [engine]).status, 'verified');
  assert.equal(planReplaySeek(replay.value, [engine], 2).status, 'ready');
  assert.equal((await persistCapturedCasinoReplay(f.audit, input)).status, 'stored');
  assert.equal((await persistCapturedCasinoReplay(f.audit, { ...input, posting: ledger[1].posting })).status, 'stored');
  const store = new AuditReplayStore(f.audit);
  assert.deepEqual(await store.read(f.scope, input.replayId), { status: 'verified', value: replay.value });
});

test('Caribbean paid start and free bonus steps follow saved revisions rather than request timestamps', async t => {
  const f = await fixture(t, cascadeRandom(129733));
  const id = randomUUID();
  const settings = { caribbean: { mode: 'buy-raid', lines: 5, stakeBasis: 'total' } } as const;
  const start = await f.wallet.expansion.operate(f.account,
    { id, gameId: CARIBBEAN_GAME, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings });
  const input = await f.request(id);
  const open = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(open.status, 'built');
  assert.deepEqual(open.value.manifest.gaps, ['terminal-unavailable']);
  assert.equal(open.value.manifest.terminal, null);
  assert.deepEqual(open.value.fragments[0].events[0].money,
    [{ movement: 'paid-option', units: '-' + caribbeanInitialCost(settings.caribbean, '100'), posting: input.posting }]);

  let session = start.session;
  const moveIds: string[] = [];
  while (session.state === 'active') {
    const moveId = randomUUID();
    moveIds.push(moveId);
    session = (await f.wallet.expansion.operate(f.account, {
      id: moveId, gameId: CARIBBEAN_GAME, action: 'move', sessionId: id, move: 'caribbean-spin', revision: session.view.caribbean!.revision,
    })).session;
  }
  await f.game.prepare('UPDATE demo_casino_requests SET created_at=1 WHERE account_id=? AND session_id=?').run(f.account, id);
  const settled = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(settled.status, 'built');
  assert.equal(settled.value.manifest.coverage, 'complete');
  const events = settled.value.fragments.flatMap(fragment => fragment.events);
  const free = events.filter(event => event.data.kind === 'action' && event.data.action.code === 'move');
  assert.equal(free.length, 14);
  assert(free.every(event => !event.money && !event.postings.length && event.atMs === 0));
  const boards = events.filter(event => event.data.kind !== 'action')
    .flatMap(event => event.data.kind !== 'action' && event.data.state.profile === 'casino-steps' && event.data.state.visible.length
      ? [event.data.state.visible] : []);
  assert.deepEqual(boards, session.view.caribbean!.spins.map(spin => spin.frame.grid));
  const settledPosting = (await f.refs(moveIds.at(-1)!))[0].posting;
  assert.deepEqual(events.at(-1)?.money, [{ movement: 'payout', units: session.returnedUnits, posting: settledPosting }]);
  assert.equal(events.at(-1)?.calculation?.creditedUnits, session.returnedUnits);
  assert(!JSON.stringify(settled).includes('"draws"'));

  await f.game.prepare('DELETE FROM demo_casino_requests WHERE account_id=? AND id=?').run(f.account, moveIds[4]);
  const incomplete = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(incomplete.status, 'built');
  assert.equal(incomplete.value.manifest.coverage, 'partial');
  assert.deepEqual(incomplete.value.manifest.gaps, ['event-gap', 'terminal-unavailable']);
  assert.equal(incomplete.value.fragments[0].events.length, 1);
});

test('both natural Caribbean tactics preserve the accepted choice, free spins and single settlement for every line count', async t => {
  const f = await fixture(t);
  const tactics = [
    { name: 'raid', move: 'caribbean-choose-raid', selection: 2, freeSpins: 14 },
    { name: 'flagship', move: 'caribbean-choose-flagship', selection: 3, freeSpins: 6 },
  ] as const;
  for (const lines of [1, 5, 10, 20] as const) for (const tactic of tactics) await t.test(lines + '/' + tactic.name, async () => {
    const id = randomUUID(), stakeUnits = '10';
    const before = await demoBalanceUnits(f.game, f.account);
    let { session } = await f.wallet.expansion.operate(f.account, { id, gameId: CARIBBEAN_GAME, action: 'start',
      stakeUnits, stakePolicyVersion: 1, settings: { caribbean: { lines, mode: 'normal', stakeBasis: 'total' } } });
    assert.equal(session.view.caribbean?.phase, 'choice');
    assert.equal(session.spentUnits, stakeUnits);
    const input = await f.request(id);
    const choice = { id: randomUUID(), gameId: CARIBBEAN_GAME, action: 'move', sessionId: id, move: tactic.move,
      revision: session.view.caribbean!.revision } as const;
    const accepted = await f.wallet.expansion.operate(f.account, choice);
    assert.equal(accepted.replayed, false);
    const repeated = await f.wallet.expansion.operate(f.account, choice);
    assert.equal(repeated.replayed, true);
    assert.deepEqual(repeated.session, accepted.session);
    session = accepted.session;
    assert.equal(session.view.caribbean?.tactic, tactic.name);
    assert.equal(session.view.caribbean?.remaining, tactic.freeSpins);

    const spinIds: string[] = [];
    for (let spin = 0; spin < tactic.freeSpins; spin++) {
      assert.equal(session.state, 'active');
      const spinId = randomUUID();
      spinIds.push(spinId);
      session = (await f.wallet.expansion.operate(f.account, { id: spinId, gameId: CARIBBEAN_GAME, action: 'move',
        sessionId: id, move: 'caribbean-spin', revision: session.view.caribbean!.revision })).session;
    }
    assert.equal(session.state, 'settled');
    assert.equal(session.spentUnits, stakeUnits);
    const replay = await buildCapturedCasinoReplay(f.audit, input);
    assert.equal(replay.status, 'built');
    assert.equal(replay.value.manifest.coverage, 'complete');
    assert.equal(replay.value.manifest.game.modeId, 'normal');
    const events = replay.value.fragments.flatMap(fragment => fragment.events);
    const actions = events.flatMap(event => event.data.kind === 'action' ? [event.data.action] : []);
    assert.deepEqual(actions, [
      { profile: 'casino-steps', code: 'start', selection: [lines] },
      { profile: 'casino-steps', code: 'move', selection: [tactic.selection] },
      ...spinIds.map(() => ({ profile: 'casino-steps', code: 'move', selection: [1] })),
    ]);
    const boards = session.view.caribbean!.spins.map(spin => spin.frame.grid);
    assert.deepEqual(events.flatMap(event => event.data.kind !== 'action' && event.data.state.profile === 'casino-steps'
      ? [event.data.state.visible] : []), [boards[0], ...boards]);
    const postings = await f.game.prepare(`SELECT id::text,operation_id,entry_type,amount_units::text
      FROM demo_ledger WHERE account_id=? AND operation_id=ANY(?::text[]) ORDER BY demo_ledger.id`)
      .all(f.account, [id, choice.id, ...spinIds]);
    assert.deepEqual(postings.map(row => [row.operation_id, row.entry_type, row.amount_units]), [
      [id, 'bet', '-' + stakeUnits], [spinIds.at(-1), 'win', session.returnedUnits],
    ]);
    assert.deepEqual(events.flatMap(event => event.money ?? []), [
      { movement: 'stake', units: '-' + stakeUnits, posting: input.posting },
      { movement: 'payout', units: session.returnedUnits, posting: { namespace: input.posting.namespace, rowId: postings[1].id } },
    ]);
    assert.equal(events.at(-1)?.data.kind, 'terminal');
    assert.equal(events.at(-1)?.calculation?.creditedUnits, session.returnedUnits);
    assert.equal(await demoBalanceUnits(f.game, f.account), before - Number(stakeUnits) + Number(session.returnedUnits));

    if (lines === 20 && tactic.name === 'flagship') {
      await f.game.prepare('UPDATE demo_casino_requests SET request_key=? WHERE account_id=? AND id=?')
        .run(JSON.stringify({ ...choice, move: 'caribbean-choose-raid' }), f.account, choice.id);
      const inconsistent = await buildCapturedCasinoReplay(f.audit, input);
      assert.equal(inconsistent.status, 'built');
      assert.equal(inconsistent.value.manifest.coverage, 'partial');
      assert.deepEqual(inconsistent.value.manifest.gaps, ['event-gap', 'terminal-unavailable']);
      assert.equal(inconsistent.value.manifest.terminal, null);
    }
  });
});

test('automatic Crash closes with its actual payout and late cashout never becomes an action', async t => {
  const f = await fixture(t);
  let now = Date.now();
  const store = new DemoExpansionStore(f.game, async account => ({ balance: await demoBalanceUnits(f.game, account) / 100, entries: [] }),
    f.wallet.ready, async () => {}, () => 0, () => now, cardEngine, () => 2.3456);
  const id = randomUUID(), gameId = 'github-crash';
  await store.operate(f.account, { id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings: {} });
  const input = await f.request(id);
  const open = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(open.status, 'built');
  assert.deepEqual(open.value.fragments[0].events[1].data,
    { kind: 'checkpoint', state: { profile: 'casino-steps', phase: 'open', revision: 1, visible: [] } });
  now += 100_000;
  await store.settleDue(f.account);
  await store.operate(f.account, { id: randomUUID(), gameId, action: 'move', sessionId: id, move: 'cashout' });
  const after = await buildCapturedCasinoReplay(f.audit, input);
  assert.equal(after.status, 'built');
  assert.equal(after.value.manifest.coverage, 'complete');
  const events = after.value.fragments[0].events;
  assert.deepEqual(events.map(event => event.data.kind), ['action', 'terminal']);
  assert.equal(events[1].money?.[0].units, '0');
  assert.deepEqual(events[1].data, { kind: 'terminal',
    state: { profile: 'casino-steps', phase: 'settled', revision: 1, visible: [0, 0, 2, 10, 3, 4, 5, 6] },
    outcome: 'settled', winnerSeat: null });

  const manualId = randomUUID(), cashout = randomUUID();
  await store.operate(f.account, { id: manualId, gameId, action: 'start', stakeUnits: '100', stakePolicyVersion: 1, settings: {} });
  now += 4_000;
  const cash = await store.operate(f.account, { id: cashout, gameId, action: 'move', sessionId: manualId, move: 'cashout' });
  const manual = await buildCapturedCasinoReplay(f.audit, await f.request(manualId));
  assert.equal(manual.status, 'built');
  const manualEvents = manual.value.fragments[0].events;
  assert.deepEqual(manualEvents.filter(event => event.data.kind === 'action').map(event => event.data.kind === 'action' && event.data.action.code),
    ['start', 'cashout']);
  assert.deepEqual(manualEvents.at(-1)?.money, [{ movement: 'payout', units: cash.session.returnedUnits, posting: (await f.refs(cashout))[0].posting }]);
  assert.equal((await persistCapturedCasinoReplay(f.audit, input)).status, 'stored');
  await f.datasets.sealTest(f.scope.datasetId);
  assert.deepEqual(await buildCapturedCasinoReplay(f.audit, input), { status: 'unavailable', reason: 'sealed-session-unavailable' });
  assert.equal((await new AuditReplayStore(f.audit).read(f.scope, input.replayId)).status, 'verified');
});

test('Forest Heart replays each accepted rotation and pass through all free bonus steps', async t => {
  const f = await fixture(t, maximum => maximum === 4096 ? 0b101101010011 : 0);
  const gameId = 'studio-forest-heart';
  const operate = (command: object) => f.wallet.expansion.operate(f.account, command,
    2, true, true, true, true, true, true, true, true, 2, 4, true, true, 2, 2, 2, true);
  for (const rotation of [null, ...Array.from({ length: 12 }, (_, index) => index)]) {
    const move = rotation === null ? 'forest-pass' : 'forest-turn-' + rotation;
    await t.test(move, async () => {
      const id = randomUUID();
      let { session } = await operate({ id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1,
        settings: { forestHeart: { mode: 'normal' } } });
      assert.equal(session.view.forestHeart?.stage, 'choice');
      const input = await f.request(id);
      const choice = randomUUID();
      session = (await operate({ id: choice, gameId, action: 'move', sessionId: id, move,
        revision: session.view.forestHeart!.revision })).session;
      assert.equal(session.view.forestHeart?.base.rotation, rotation);
      assert.deepEqual(await f.refs(choice), []);
      let terminal = '';
      for (let spin = 0; spin < 4; spin++) {
        assert.equal(session.view.forestHeart?.stage, 'bonus');
        terminal = randomUUID();
        session = (await operate({ id: terminal, gameId, action: 'move', sessionId: id, move: 'forest-spin',
          revision: session.view.forestHeart!.revision })).session;
      }
      assert.equal(session.state, 'settled');
      const replay = await buildCapturedCasinoReplay(f.audit, input);
      assert.equal(replay.status, 'built');
      assert.equal(replay.value.manifest.coverage, 'complete');
      const events = replay.value.fragments.flatMap(fragment => fragment.events);
      const moves = events.filter(event => event.data.kind === 'action' && event.data.action.code === 'move');
      assert.equal(moves.length, 5);
      assert(moves.every(event => event.postings.length === 0 && !event.money));
      const choiceFrame = events[events.indexOf(moves[0]) + 1].data;
      assert.equal(choiceFrame.kind, 'checkpoint');
      assert.equal(choiceFrame.state.profile, 'casino-steps');
      assert.equal(choiceFrame.state.visible.at(-1), (rotation ?? -1) + 1);
      assert.deepEqual(events.at(-1)?.money, [{ movement: 'payout', units: session.returnedUnits,
        posting: (await f.refs(terminal))[0].posting }]);
    });
  }
});

test('purchased casino bonuses preserve each free continuation and the final posting', async t => {
  const seeded = cascadeRandom(129733);
  const f = await fixture(t, maximum => maximum <= 0x1_0000_0000 ? seeded(maximum) : randomInt(maximum));
  const scenarios = [
    ...['cosmic-chaos', 'ufo-invasion', 'deep-echo'].map(choice => ({ gameId: 'studio-cosmic-escape', choice, view: 'luelon' as const })),
    ...['spotlight', 'super-encore'].map(choice => ({ gameId: 'studio-velvet-reign', choice, view: 'luelon' as const })),
    { gameId: 'studio-caramel-carnival', choice: 'festival', view: 'caramel' as const },
    ...[1, 5, 10, 20].flatMap(lines => ['raid', 'flagship'].map(tactic => ({
      gameId: CARIBBEAN_GAME, choice: 'lines-' + lines + '-buy-' + tactic, view: 'caribbean' as const,
    }))),
  ];
  for (const { gameId, choice, view } of scenarios) await t.test(gameId + '/' + choice, async () => {
    const id = randomUUID(), player = await f.createPlayer();
    let { session } = await f.wallet.expansion.operate(player, { id, gameId, action: 'start',
      stakeUnits: '10', stakePolicyVersion: 1, settings: settingsFor(gameId, choice) });
    assert.equal(session.state, 'active');
    const { spentUnits } = session;
    const input = await f.request(id, player);
    const commands = [];
    while (session.state === 'active') {
      assert(commands.length < 128, 'fixture must settle within the replay budget');
      const [action] = session.view.actions;
      assert.equal(session.view.actions.length, 1);
      assert.equal(action.cost, 0);
      const command = { id: randomUUID(), gameId, action: 'move', sessionId: id, move: action.move,
        revision: session.view[view]!.revision };
      commands.push(command);
      session = (await f.wallet.expansion.operate(player, command)).session;
    }
    assert.equal(session.spentUnits, spentUnits);
    const replay = await buildCapturedCasinoReplay(f.audit, input);
    assert.equal(replay.status, 'built');
    assert.equal(replay.value.manifest.coverage, 'complete');
    const events = replay.value.fragments.flatMap(fragment => fragment.events);
    assert.deepEqual(events[0].money, [{ movement: 'paid-option', units: '-' + spentUnits, posting: input.posting }]);
    const continuation = events.filter(event => event.data.kind === 'action' && event.data.action.code === 'move');
    assert.equal(continuation.length, commands.length);
    assert(continuation.every(event => !event.money && !event.postings.length));
    const last = commands.at(-1)!;
    assert.deepEqual(events.at(-1)?.money, [{ movement: 'payout', units: session.returnedUnits,
      posting: (await f.refs(last.id, player))[0].posting }]);

    if (choice === 'spotlight') {
      await f.game.prepare('UPDATE demo_casino_requests SET request_key=? WHERE account_id=? AND id=?')
        .run(JSON.stringify({ ...last, revision: last.revision + 20 }), player, last.id);
      const incomplete = await buildCapturedCasinoReplay(f.audit, input);
      assert.equal(incomplete.status, 'built');
      assert.deepEqual(incomplete.value.manifest.gaps, ['event-gap', 'terminal-unavailable']);
      assert.equal(incomplete.value.manifest.terminal, null);
    }
  });
});

test('every qualified casino entry mode in the approved catalogue produces money-linked replay evidence', async t => {
  const seeded = cascadeRandom(129733);
  // The seeded fixture is 32-bit, while settlement may request a larger precision ticket.
  const f = await fixture(t, maximum => maximum <= 0x1_0000_0000 ? seeded(maximum) : randomInt(maximum));
  const { stakePolicies }: { stakePolicies: Record<string, { choices: string[]; rulesVersion: number }> } =
    JSON.parse(await readFile(new URL('../scripts/game-math/rtp-policy.json', import.meta.url), 'utf8'));
  const run = async (gameId: string, mode: string, rulesVersion: number, player: string, id: string,
    open: boolean, spent: string, returned: string) => {
    const legs = await f.refs(id, player);
    assert.equal(legs.length, open ? 1 : 2);
    assert.deepEqual([legs[0].type, legs[0].units], ['bet', '-' + spent]);
    const result = await buildCapturedCasinoReplay(f.audit, {
      datasetId: f.scope.datasetId, gameSchema: f.game.schema, posting: legs[0].posting, replayId: randomUUID(),
    });
    assert.equal(result.status, 'built');
    const { manifest, fragments } = result.value;
    assert.equal(manifest.game.gameId, gameId);
    assert.equal(manifest.game.modeId, mode);
    assert.equal(manifest.game.rulesVersion, String(rulesVersion));
    assert.deepEqual(manifest.gaps, open ? ['terminal-unavailable'] : []);
    assert.equal(verifyReplayPackage(result.value, [{ ...manifest.game, formatVersion: 2 }]).status, 'verified');
    const events = fragments.flatMap(fragment => fragment.events);
    const start = events[0];
    assert.equal(start.data.kind, 'action');
    assert.equal(start.money?.[0]?.units, '-' + spent);
    assert.deepEqual(start.money?.[0]?.posting, legs[0].posting);
    if (!open) {
      const end = events.at(-1);
      assert.deepEqual([legs[1].type, legs[1].units], ['win', returned]);
      assert.equal(end?.data.kind, 'terminal');
      assert.deepEqual(end?.money, [{ movement: 'payout', units: returned, posting: legs[1].posting }]);
    }
  };

  for (const gameId of ROYAL_PLATFORM_GAMES) {
    const policy = stakePolicies[gameId];
    assert(policy?.choices.length, 'Missing stake policy for ' + gameId);
    if (gameId === 'royal-plinko' || gameId === 'royal-roulette') {
      const choices = gameId === 'royal-plinko' ? policy.choices : ['red', 'black', 'even', 'odd', 'number'];
      for (const choice of choices) await t.test(gameId + '/' + choice, async () => {
        const id = randomUUID(), [rows, risk] = choice.split(':');
        const input = gameId === 'royal-plinko' ? { rows: Number(rows), risk }
          : choice === 'number' ? { bet: choice, number: 7 } : { bet: choice };
        const accepted = await f.wallet.operate(f.account,
          { id, kind: 'play', gameId, input, amount: 0.1, rulesVersion: policy.rulesVersion, stakePolicyVersion: 1 });
        assert(accepted.gameRound);
        await run(gameId, 'normal', policy.rulesVersion, f.account, id, false, '10', accepted.gameRound.payoutUnits);
      });
      continue;
    }
    // Several mathematical choices share a paid start and only diverge on later moves.
    const starts = new Map<string, string>();
    for (const choice of policy.choices) {
      const encoded = JSON.stringify(settingsFor(gameId, choice));
      if (!starts.has(encoded)) starts.set(encoded, choice);
    }
    for (const [encoded, choice] of starts) await t.test(gameId + '/start/' + choice, async () => {
      const player = await f.createPlayer(100), id = randomUUID();
      const settings = JSON.parse(encoded);
      const mode = settings.luelon?.mode ?? settings.caramel?.mode ?? settings.neopolis?.hero ??
        settings.flags?.mode ?? settings.caribbean?.mode ?? 'normal';
      const { session } = await f.wallet.expansion.operate(player, {
        id, gameId, action: 'start', stakeUnits: '10', stakePolicyVersion: 1, settings,
      }, 2, true, true, true, true, true, true, true, true, 2, 4, true, true, 2, 2, 2, true);
      await run(gameId, mode, policy.rulesVersion, player, id, session.state === 'active', session.spentUnits, session.returnedUnits);
    });
  }
});
