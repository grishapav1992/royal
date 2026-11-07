import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuditDatasets } from '../server/audit/datasets';
import {
  createReplayPackage, planReplaySeek, verifyReplayPackage,
  type ReplayDefinition, type ReplayEvent, type ReplayManifest, type ReplayState,
} from '../server/audit/replay-package';
import { AuditReplayStore, migrateAuditReplayPackages } from '../server/audit/replay-store';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';

type Start = Parameters<typeof createReplayPackage>[0];
const casino: ReplayDefinition = { formatVersion: 1, category: 'casino', gameId: 'royal-roulette',
  modeId: 'normal', rulesVersion: '1', gameVersion: 'v1', replayProfile: 'casino-steps',
  engineId: 'royal-core', engineVersion: '1' };

function draft(definition = casino, initial: ReplayState = { profile: 'casino-steps', phase: 'open', revision: 0, visible: [] }): Start {
  const { formatVersion: _, ...game } = definition;
  return { scope: { datasetId: randomUUID(), environment: 'test' }, replayId: randomUUID(), entityId: randomUUID(),
    game, coverage: 'complete', gaps: [], initial };
}

const casinoMove = (sequence: number): ReplayEvent => ({
  sequence, atMs: sequence * 10, postings: [], data: { kind: 'action',
    action: { profile: 'casino-steps', code: 'move', selection: [sequence % 10] } },
});
const casinoCheckpoint = (sequence: number): ReplayEvent => ({
  sequence, atMs: sequence * 10, postings: [],
  data: { kind: 'checkpoint', state: { profile: 'casino-steps', phase: 'open', revision: sequence, visible: [1, 2] } },
});
const casinoEnd = (sequence: number): ReplayEvent => ({
  sequence, atMs: sequence * 10, postings: [],
  data: { kind: 'terminal', state: { profile: 'casino-steps', phase: 'settled', revision: sequence, visible: [12] },
    outcome: 'settled', winnerSeat: null },
});

test('canonical checksums bind order, terminal proof, versions, scope and exact fragments', () => {
  const input = draft();
  const events = Array.from({ length: 132 }, (_, i) => i === 128 ? casinoCheckpoint(i + 1)
    : i === 131 ? casinoEnd(i + 1) : casinoMove(i + 1));
  const replay = createReplayPackage(input, events);
  const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
    : value;
  assert.equal(replay.manifest.sha256,
    createReplayPackage(reverseKeys(input) as Start, reverseKeys(events) as ReplayEvent[]).manifest.sha256);
  assert.equal(replay.fragments.length, 2);
  assert.equal(replay.manifest.terminal?.sequence, 132);

  const [first, second] = replay.fragments;
  assert.deepEqual(verifyReplayPackage({ ...replay, fragments: [second] }), { status: 'incomplete', missingFragments: [0] });
  assert.deepEqual(verifyReplayPackage({ ...replay, fragments: [second, first, second] }, [casino]),
    { status: 'verified', value: replay });
  const damaged = structuredClone(replay);
  damaged.fragments[0].events[0].atMs++;
  assert.deepEqual(verifyReplayPackage(damaged), { status: 'corrupt' });
  assert.deepEqual(verifyReplayPackage({ ...replay, manifest: { ...replay.manifest, terminal: { sequence: 132, sha256: '0'.repeat(64) } } }),
    { status: 'corrupt' });
  assert.deepEqual(verifyReplayPackage({ ...replay, manifest: { ...replay.manifest, formatVersion: 99 } }),
    { status: 'unsupported' });
  const nextEngine = { ...casino, rulesVersion: '2', gameVersion: 'v2', engineVersion: '2' };
  assert.deepEqual(verifyReplayPackage(replay, [nextEngine]), { status: 'unsupported' });
  assert.equal(verifyReplayPackage(replay, [nextEngine, casino]).status, 'verified');
  assert.deepEqual(planReplaySeek(replay, [casino], 131), {
    status: 'ready', sequence: 129, state: events[128].data.kind === 'checkpoint' ? events[128].data.state : null,
    events: events.slice(129, 131),
  });
});

test('partial evidence can seek only from verified checkpoints across known sequences', () => {
  const input: Start = { ...draft(), coverage: 'partial', initial: null,
    gaps: ['initial-state-unavailable', 'event-gap', 'terminal-unavailable'] };
  const replay = createReplayPackage(input, [casinoMove(3), casinoCheckpoint(7), casinoMove(8), casinoMove(12)]);
  assert.equal(verifyReplayPackage(replay).status, 'verified');
  assert.deepEqual(planReplaySeek(replay, [casino], 3), { status: 'missing-checkpoint' });
  assert.deepEqual(planReplaySeek(replay, [casino], 12), { status: 'missing-checkpoint' });
  assert.equal(planReplaySeek(replay, [casino], 8).status, 'ready');
  assert.throws(() => createReplayPackage(draft(), [casinoMove(3), casinoEnd(4)]), /Invalid replay/);
  assert.throws(() => createReplayPackage(draft(), [casinoEnd(1), casinoEnd(2)]), /Invalid replay/);
  assert.throws(() => createReplayPackage(draft(), [casinoMove(1), casinoMove(1), casinoEnd(2)]), /Invalid replay/);
});

test('format 2 binds exact monetary legs and calculation without pretending to know event times', () => {
  const source = { namespace: 'game.demo_ledger', rowId: '9223372036854775807' };
  const payout = { ...casinoEnd(2), atMs: 0, postings: [source],
    money: [{ movement: 'payout', units: '9007199254740993', posting: source }],
    calculation: { baseUnits: '9007199254740992', creditedUnits: '9007199254740993',
      numerator: '18014398509481985', denominator: '2' } } satisfies ReplayEvent;
  const start = { ...casinoMove(1), atMs: 0 };
  const input = { ...draft(), formatVersion: 2, timing: 'source-order' } as const;
  const pack = createReplayPackage(input, [start, payout]);
  assert.equal(pack.manifest.formatVersion, 2);
  assert.equal(pack.manifest.timing, 'source-order');
  assert.equal(verifyReplayPackage(pack, [{ ...casino, formatVersion: 2 }]).status, 'verified');
  assert.equal(verifyReplayPackage(pack, [casino]).status, 'unsupported');
  assert.throws(() => createReplayPackage(draft(), [start, payout]), /Invalid replay/);
  assert.throws(() => createReplayPackage(input, [start, { ...payout, atMs: 1 }]), /Invalid replay/);
  assert.throws(() => createReplayPackage(input, [start, { ...payout, postings: [] }]), /Invalid replay/);
  assert.throws(() => createReplayPackage(input, [{ ...start, postings: [source], money: payout.money }, payout]), /Invalid replay/);
  assert.throws(() => createReplayPackage(input, [start,
    { ...payout, calculation: { ...payout.calculation, creditedUnits: '1' } }]), /Invalid replay/);
  const prior = createReplayPackage(draft(), [casinoMove(1), casinoEnd(2)]);
  assert.equal(verifyReplayPackage(prior, [casino, { ...casino, formatVersion: 2 }]).status, 'verified');
});

test('strict profiles preserve typed evidence and reject extra or private fields and oversized inputs', () => {
  const fighters: [{ x: number; y: number; health: number; pose: number; facing: 1 },
    { x: number; y: number; health: number; pose: number; facing: -1 }] = [
    { x: -12, y: 0, health: 100, pose: 1, facing: 1 },
    { x: 12, y: 0, health: 100, pose: 1, facing: -1 },
  ];
  for (const [category, replayProfile, initial] of [
    ['pvp', 'pvp-turn-based', { profile: 'pvp-turn-based', phase: 'open', turn: 0, seatToMove: 1, board: [1, 2] }],
    ['pvp', 'pvp-realtime', { profile: 'pvp-realtime', phase: 'open', tick: 0, fighters }],
    ['totalizator', 'pool-steps', { profile: 'pool-steps', phase: 'open', stage: 0, remaining: [1, 2], eliminated: [] }],
  ] as const) {
    const state = structuredClone(initial) as ReplayState;
    const definition = { ...casino, category, replayProfile };
    const events: ReplayEvent[] = [
      { sequence: 1, atMs: 1, data: { kind: 'checkpoint', state }, postings: [] },
      { sequence: 2, atMs: 2, data: { kind: 'terminal', state: { ...state, phase: 'settled' }, outcome: 'settled', winnerSeat: null }, postings: [] },
    ];
    assert.equal(verifyReplayPackage(createReplayPackage(draft(definition, state), events), [definition]).status, 'verified');
  }
  const input = draft();
  const poisoned = { ...casinoMove(1), chat: 'private' };
  assert.throws(() => createReplayPackage(input, [poisoned, casinoEnd(2)]), /Invalid replay/);
  assert.throws(() => createReplayPackage({ ...input, initial: { ...input.initial, seed: 'future' } } as Start, [casinoEnd(1)]), /Invalid replay/);
  assert.throws(() => createReplayPackage(input, [{ ...casinoEnd(1), postings: [{ namespace: 'game.demo_ledger', rowId: 'player:secret' }] }]),
    /Invalid replay/);
  assert.throws(() => createReplayPackage(input, Array.from({ length: 16385 }, (_, i) => casinoMove(i + 1))), /Invalid replay/);
});

test('PostgreSQL binds fragments to a dataset and captured rows, and preserves immutable retries through seal', async t => {
  const audit = new PostgresDatabase(':memory:'), game = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([audit.close(), game.close()]); });
  const account = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?)').run(account);
  const wallet = new DemoWalletStore(game, () => 0);
  await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 20 });
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const { datasetId, environment } = await datasets.startTest();
  const scope = { datasetId, environment };
  await migrateAuditReplayPackages(audit);
  const store = new AuditReplayStore(audit);
  const opId = randomUUID();
  await wallet.operate(account, { id: opId, kind: 'play', gameId: 'royal-roulette', input: { bet: 'black' },
    amount: 0.1, rulesVersion: 1, stakePolicyVersion: 1 });
  const rows = await game.prepare('SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=? ORDER BY id::bigint').all(account, opId);
  const posting = { namespace: game.schema + '.demo_ledger', rowId: rows[1].id };
  const start = { ...draft(), scope, entityId: opId };
  const events = Array.from({ length: 130 }, (_, i) => i === 129 ? { ...casinoEnd(i + 1), postings: [posting] } : casinoMove(i + 1));
  const replay = createReplayPackage(start, events);
  const [first, last] = replay.fragments;
  assert.equal(await store.writeFragment(scope, start.replayId, last), 'manifest-unavailable');
  assert.deepEqual((await Promise.all([store.writeManifest(replay.manifest), store.writeManifest(replay.manifest)])).sort(),
    ['recorded', 'replayed']);
  assert.equal(await store.writeManifest(createReplayPackage({ ...start, entityId: randomUUID() }, events).manifest), 'conflict');
  assert.equal(await store.writeFragment(scope, start.replayId, last), 'recorded');
  assert.equal(await store.writeFragment(scope, start.replayId, last), 'replayed');
  assert.deepEqual(await store.read(scope, start.replayId), { status: 'incomplete', missingFragments: [0] });
  assert.equal(await store.writeFragment({ ...scope, environment: 'live' }, start.replayId, first), 'dataset-unavailable');
  assert.equal(await store.writeFragment(scope, start.replayId, first), 'recorded');
  assert.deepEqual(await store.read(scope, start.replayId, [casino]), { status: 'verified', value: replay });
  assert.deepEqual(await store.read({ ...scope, environment: 'live' }, start.replayId), { status: 'not-found' });

  const preBoundary = { ...posting, rowId: '1' };
  const isolated = createReplayPackage({ ...start, replayId: randomUUID() }, [{ ...casinoEnd(1), postings: [preBoundary] }]);
  assert.equal(await store.writeManifest(isolated.manifest), 'recorded');
  assert.equal(await store.writeFragment(scope, isolated.manifest.replayId, isolated.fragments[0]), 'posting-not-captured');
  const unfinished = createReplayPackage({ ...start, replayId: randomUUID() }, [casinoEnd(1)]);
  assert.equal(await store.writeManifest(unfinished.manifest), 'recorded');
  await datasets.sealTest(datasetId);
  assert.equal(await store.writeFragment(scope, start.replayId, first), 'replayed');
  assert.equal(await store.writeFragment(scope, unfinished.manifest.replayId, unfinished.fragments[0]), 'dataset-unavailable');

  await audit.prepare("UPDATE audit_replay_fragments SET fragment=jsonb_set(fragment,'{events,0,atMs}','0') WHERE dataset_id=? AND replay_id=? AND ordinal=0")
    .run(datasetId, start.replayId);
  assert.deepEqual(await store.read(scope, start.replayId), { status: 'corrupt' });

  const moved = createReplayPackage({ ...start, replayId: randomUUID() }, [casinoEnd(1)]);
  await audit.prepare('UPDATE audit_replay_packages SET manifest=?::jsonb WHERE dataset_id=? AND replay_id=?')
    .run(JSON.stringify(moved.manifest satisfies ReplayManifest), datasetId, unfinished.manifest.replayId);
  assert.deepEqual(await store.read(scope, unfinished.manifest.replayId), { status: 'corrupt' });
});
