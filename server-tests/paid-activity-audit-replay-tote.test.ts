import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { TOTE_ADMISSION_CLOCK } from '../server/audit/check-tote';
import type { AuditEvent, AuditScope } from '../server/audit/contract';
import { AuditDatasets } from '../server/audit/datasets';
import { AuditEvidence } from '../server/audit/evidence';
import { planReplaySeek, verifyReplayPackage, type ReplayEvent, type ReplayPoolEvent } from '../server/audit/replay-package';
import { AuditReplayStore } from '../server/audit/replay-store';
import { buildCapturedToteReplay, persistCapturedToteReplay } from '../server/audit/replay-tote';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { drawToteOrder, FlagToteStore } from '../server/flagTote';
import { FLAG_COUNTRIES, type FlagCountry } from '../src/shared/flagBattle';
import { settleFlagTote, TOTE_TIMING } from '../src/shared/flagTote';

async function fixture(t: TestContext) {
  const game = new PostgresDatabase(':memory:'), audit = new PostgresDatabase(':memory:');
  t.after(async () => { await Promise.all([game.close(), audit.close()]); });
  const a = randomUUID(), b = randomUUID();
  await game.exec('CREATE TABLE accounts(id text PRIMARY KEY)');
  await game.prepare('INSERT INTO accounts VALUES (?),(?)').run(a, b);
  const wallet = new DemoWalletStore(game);
  for (const account of [a, b]) await wallet.operate(account, { id: randomUUID(), kind: 'deposit', amount: 100 });
  const openedAt = (Math.floor(Date.now() / TOTE_TIMING.period) + 1) * TOTE_TIMING.period;
  let now = openedAt;
  const tote = new FlagToteStore(game, account => wallet.snapshotInTransaction(account), wallet.ready, () => now, () => 0);
  const round = (await tote.snapshot(a)).round;
  const datasets = new AuditDatasets(audit, { game: game.schema });
  const evidence = new AuditEvidence(audit, audit.schema);
  const accept = async (accountId: string, country: FlagCountry, stakeUnits = '100', at = openedAt, id: string = randomUUID()) => {
    now = at;
    await tote.bet(accountId, { id, roundId: round.id, rulesVersion: 1, country, stakeUnits });
    const row = await game.prepare('SELECT id::text FROM demo_ledger WHERE account_id=? AND operation_id=?')
      .get(accountId, 'flag-tote:' + id);
    assert(row);
    return { id, accountId, country, stakeUnits, at, posting: { namespace: game.schema + '.demo_ledger', rowId: row.id } };
  };
  const clock = async (scope: AuditScope, ticket: Awaited<ReturnType<typeof accept>>, at = ticket.at, rowId = ticket.posting.rowId) => {
    const event: AuditEvent = {
      schemaVersion: 1, type: 'event', scope, occurredAtMs: at, eventId: randomUUID(), sequence: '1',
      accountId: ticket.accountId, operationId: ticket.id, event: 'accepted', reasonCode: TOTE_ADMISSION_CLOCK,
      entity: { category: 'totalizator', kind: 'pool', gameId: 'flag-tote', modeId: 'pool', rulesVersion: '1',
        source: { namespace: game.schema + '.flag_tote_rounds', rowId: round.id }, ticketId: ticket.id },
      postings: [{ ...ticket.posting, rowId }],
    };
    assert.equal(await evidence.record(event), 'recorded');
  };
  const finish = async (at = round.finishesAt) => { now = at; await tote.advance(); };
  const openDataset = async () => {
    const { datasetId, environment } = await datasets.startTest();
    return { datasetId, environment };
  };
  const request = (scope: AuditScope, replayId = randomUUID()) => ({ datasetId: scope.datasetId, gameSchema: game.schema, poolId: round.id, replayId });
  return { game, audit, datasets, round, a, b, accept, clock, finish, openDataset, request };
}

function eventsWith<K extends ReplayPoolEvent['kind']>(events: ReplayEvent[], kind: K) {
  return events.filter((event): event is ReplayEvent & { pool: Extract<ReplayPoolEvent, { kind: K }> } => event.pool?.kind === kind);
}

test('settled pool replays ticket order, cutoff, country awards and one exact wallet credit per account', async t => {
  const f = await fixture(t), scope = await f.openDataset();
  const outcome = drawToteOrder(() => 0);
  const winner = outcome.order.at(-1)!;
  const other = FLAG_COUNTRIES.map(country => country.id).filter(id => id !== winner);
  const accepted = [
    await f.accept(f.a, winner, '100', f.round.openedAt, randomUUID().toUpperCase()),
    await f.accept(f.a, winner, '200', f.round.openedAt + 1),
    await f.accept(f.b, other[0], '100', f.round.openedAt + 2),
    await f.accept(f.b, other[1], '100', f.round.closesAt - 1),
  ];
  for (const ticket of accepted) await f.clock(scope, ticket);
  await f.finish(f.round.closesAt);
  const request = f.request(scope);
  const racing = await buildCapturedToteReplay(f.audit, request);
  assert.equal(racing.status, 'built');
  assert.deepEqual(racing.value.manifest.gaps, ['terminal-unavailable']);
  assert.equal(eventsWith(racing.value.fragments.flatMap(fragment => fragment.events), 'cutoff').length, 1);
  await f.finish();
  const replay = await buildCapturedToteReplay(f.audit, request);
  assert.equal(replay.status, 'built');
  const { manifest, fragments } = replay.value;
  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.entityId, f.round.id);
  assert.equal(manifest.coverage, 'complete');
  assert.equal(manifest.timing, 'source-order');
  const events = fragments.flatMap(fragment => fragment.events);
  assert(events.every(event => event.atMs === 0));
  assert.deepEqual(eventsWith(events, 'window')[0].pool, { kind: 'window', poolId: f.round.id,
    openedAtMs: f.round.openedAt, closesAtMs: f.round.closesAt, finishesAtMs: f.round.finishesAt });
  assert.deepEqual(eventsWith(events, 'ticket').map(event => event.pool), accepted.map((ticket, i) => ({
    kind: 'ticket', ticketId: ticket.id, ordinal: i + 1, accountSlot: i < 2 ? 1 : 2,
    country: ticket.country, stakeUnits: ticket.stakeUnits, admittedAtMs: ticket.at, opening: false,
  })));
  assert.deepEqual(eventsWith(events, 'ticket').map(event => event.money?.[0]), accepted.map(ticket => ({
    movement: 'stake', units: '-' + ticket.stakeUnits, posting: ticket.posting,
  })));
  const settled = settleFlagTote(accepted, outcome.order);
  assert.deepEqual(eventsWith(events, 'award').map(event => event.pool), settled.awards.map(award => ({ kind: 'award', ...award })));
  assert.deepEqual(eventsWith(events, 'allocation').map(event => [event.pool.ticketId, event.pool.units]),
    settled.payouts.map(payout => [payout.id, payout.units]));
  const [credit] = eventsWith(events, 'aggregate');
  assert.equal(eventsWith(events, 'aggregate').length, 1);
  const row = await f.game.prepare(`SELECT id::text,amount_units::text FROM demo_ledger WHERE account_id=? AND operation_id=?`)
    .get(f.a, 'flag-tote:' + f.round.id + ':final');
  assert(row);
  assert.deepEqual(credit.money, [{ movement: 'payout', units: row.amount_units,
    posting: { namespace: f.game.schema + '.demo_ledger', rowId: row.id } }]);
  assert(eventsWith(events, 'allocation').slice(0, 2).every(event => event.postings[0]?.rowId === row.id && !event.money));
  assert.deepEqual(eventsWith(events, 'result')[0].pool, { kind: 'result', bankUnits: '500', feeUnits: '25', reason: null });
  const terminal = events.at(-1)!.data;
  assert(terminal.kind === 'terminal' && terminal.state.profile === 'pool-steps');
  assert.deepEqual([...terminal.state.eliminated, ...terminal.state.remaining],
    outcome.order.map(id => FLAG_COUNTRIES.findIndex(country => country.id === id)));
  const serialized = JSON.stringify(replay);
  assert(!serialized.includes(f.a) && !serialized.includes(f.b) && !serialized.includes('"seed"'));

  const engine = { ...manifest.game, formatVersion: 3 };
  assert.equal(verifyReplayPackage(replay.value, [engine]).status, 'verified');
  assert.equal(planReplaySeek(replay.value, [engine], events.length).status, 'ready');
  assert.equal((await persistCapturedToteReplay(f.audit, request)).status, 'stored');
  assert.equal((await persistCapturedToteReplay(f.audit, request)).status, 'stored');
  await f.datasets.sealTest(scope.datasetId);
  assert.deepEqual(await buildCapturedToteReplay(f.audit, request), replay);
  assert.deepEqual(await new AuditReplayStore(f.audit).read(scope, request.replayId), { status: 'verified', value: replay.value });
});

test('an ineligible pool has refund allocations and one aggregate refund without a fabricated ranking', async t => {
  const f = await fixture(t), scope = await f.openDataset();
  const first = await f.accept(f.a, 'FR'), second = await f.accept(f.a, 'BR', '200');
  await f.clock(scope, first);
  await f.clock(scope, second);
  await f.finish(f.round.closesAt);
  const replay = await buildCapturedToteReplay(f.audit, f.request(scope));
  assert.equal(replay.status, 'built');
  assert.equal(replay.value.manifest.coverage, 'complete');
  const events = replay.value.fragments.flatMap(fragment => fragment.events);
  assert.deepEqual(eventsWith(events, 'award'), []);
  assert.deepEqual(eventsWith(events, 'allocation').map(event => [event.pool.ticketId, event.pool.units]), [[first.id, '100'], [second.id, '200']]);
  assert.deepEqual(eventsWith(events, 'aggregate').map(event => [event.money?.[0].movement, event.money?.[0].units]), [['refund', '300']]);
  assert.deepEqual(eventsWith(events, 'result')[0].pool, { kind: 'result', bankUnits: '300', feeUnits: '0', reason: 'countries' });
  const end = events.at(-1)!.data;
  assert(end.kind === 'terminal' && end.state.profile === 'pool-steps');
  assert.equal(end.outcome, 'cancelled');
  assert.deepEqual(end.state.eliminated, []);
});

test('opening obligations and missing clocks stay explicit, and a sealed dataset cannot import a later pool state', async t => {
  const f = await fixture(t);
  const prior = await f.accept(f.a, 'FR', '200');
  const scope = await f.openDataset();
  const accepted = await f.accept(f.a, 'BR'), absent = await f.accept(f.b, 'DE');
  await f.clock(scope, accepted);
  await f.clock(scope, absent, absent.at, '99999999');
  const request = f.request(scope);
  assert.deepEqual(await buildCapturedToteReplay(f.audit, { ...request, datasetId: randomUUID() }),
    { status: 'unavailable', reason: 'not-captured' });
  const open = await buildCapturedToteReplay(f.audit, request);
  assert.equal(open.status, 'built');
  assert.deepEqual(open.value.manifest.gaps, ['admission-time-unavailable', 'terminal-unavailable']);
  const openTickets = eventsWith(open.value.fragments.flatMap(fragment => fragment.events), 'ticket');
  assert.deepEqual(openTickets.map(event => [event.pool.ticketId, event.pool.opening, event.pool.admittedAtMs]),
    [[prior.id, true, null], [accepted.id, false, accepted.at], [absent.id, false, null]]);
  assert.equal(openTickets[0].money, undefined);
  assert.deepEqual(openTickets[0].postings, []);

  await f.datasets.sealTest(scope.datasetId);
  const later = await f.accept(f.b, 'GB', '500');
  await f.finish();
  const sealed = await buildCapturedToteReplay(f.audit, request);
  assert.equal(sealed.status, 'built');
  assert.deepEqual(sealed.value.manifest.gaps, ['admission-time-unavailable', 'event-gap', 'terminal-unavailable']);
  const sealedEvents = sealed.value.fragments.flatMap(fragment => fragment.events);
  assert.deepEqual(eventsWith(sealedEvents, 'ticket').map(event => event.pool.ticketId), [prior.id, accepted.id, absent.id]);
  assert(!JSON.stringify(sealed).includes(later.id));
  assert.equal(eventsWith(sealedEvents, 'cutoff').length, 0);
  assert.equal(eventsWith(sealedEvents, 'result').length, 0);
  assert.equal(eventsWith(sealedEvents, 'aggregate').length, 0);
});

test('an exact timestamp at the closed boundary or missing canonical debit cannot be promoted into replay', async t => {
  const f = await fixture(t), scope = await f.openDataset();
  const ticket = await f.accept(f.a, 'FR');
  await f.clock(scope, ticket, f.round.closesAt);
  const request = f.request(scope);
  assert.deepEqual(await buildCapturedToteReplay(f.audit, request), { status: 'unavailable', reason: 'inconsistent-source' });
  await f.game.prepare('UPDATE demo_ledger SET operation_id=? WHERE id=?').run('unrelated', ticket.posting.rowId);
  assert.deepEqual(await buildCapturedToteReplay(f.audit, request), { status: 'unavailable', reason: 'source-unavailable' });
});
