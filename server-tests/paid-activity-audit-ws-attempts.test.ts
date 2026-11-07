import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AUDIT_SCHEMA_VERSION, isAuditRecord, type AuditEntityRef } from '../server/audit/contract';
import type { AuditAttemptObservation } from '../server/audit/attempts';
import { WsAttemptCapture, type WsAttemptOwner } from '../server/audit/ws-attempts';

function owner(sessionId: string): WsAttemptOwner {
  return { sessionId, accountId: randomUUID(), connection: {} };
}

function fixture(gameSchema?: string) {
  const observations: AuditAttemptObservation[] = [];
  let clock = 1000;
  const capture = new WsAttemptCapture(observation => observations.push(observation), { gameSchema, now: () => clock++ });
  return { capture, observations };
}

function reply(requestId: string, balanceUnits: string) {
  return { requestId, wallet: { scope: 'virtual-usdt-v1', balanceUnits, wallet: { balance: 9876 } } };
}

function barrier() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release };
}

test('parallel attempts with the same operation ID capture only their own direct reply', async () => {
  const { capture, observations } = fixture();
  const a = owner('a');
  const b = owner('b');
  const id = randomUUID();
  const command = { id, action: 'accept' };
  const firstReady = barrier();
  const secondReady = barrier();
  const first = capture.runPvp(a, command, async () => {
    await secondReady.wait;
    capture.observePvpReply(b.sessionId, b.connection, 'pvp', reply(id, '8000000'), 'handed-off');
    capture.observePvpReply(a.sessionId, a.connection, 'pvp', reply(randomUUID(), '6000000'), 'handed-off');
    capture.observePvpReply(a.sessionId, a.connection, 'pvp', { wallet: reply(id, '5000000').wallet }, 'handed-off');
    capture.observePvpReply(a.sessionId, a.connection, 'pvp', reply(id, '-1000000'), 'handed-off');
    capture.observePvpReply(a.sessionId, a.connection, 'pvp', reply(id, '1000000'), 'handed-off');
    firstReady.release();
    return 'first';
  });
  const second = capture.runPvp(b, command, async () => {
    secondReady.release();
    await firstReady.wait;
    capture.observePvpReply(b.sessionId, b.connection, 'pvp', reply(id, '302160000'), 'handed-off');
    return 'second';
  });
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(observations.length, 2);
  const byAccount = new Map(observations.map(row => [row.accountId, row]));
  for (const [actor, units] of [[a, '-100'], [b, '30216']] as const) {
    const row = byAccount.get(actor.accountId)!;
    assert.equal(row.operationId, id);
    assert.equal(row.decision, 'unknown');
    assert.equal(row.statusCode, null);
    assert.equal(row.response, 'formed');
    assert.equal(row.delivery, 'handed-off');
    assert.deepEqual(row.balance, {
      state: 'value', units, asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 },
      snapshot: null,
    });
    assert.ok(isAuditRecord({ ...row, type: 'attempt', schemaVersion: AUDIT_SCHEMA_VERSION,
      scope: { datasetId: 'ws-fixture', environment: 'test' } }));
  }
  assert.notEqual(observations[0].attemptId, observations[1].attemptId);
  assert.deepEqual(observations.map(row => row.occurredAtMs).sort(), [1000, 1001]);
});

test('a service snapshot never replaces the balance from the outgoing payload', async () => {
  const { capture, observations } = fixture();
  const actor = owner('actor');
  const request = { action: 'ready', id: randomUUID() };
  await capture.runPvp(actor, request, async () => {
    const service = await capture.runPvpService(actor.accountId, 'pvp-command', { request }, () => ({
      status: 200, value: reply(request.id, '2000000'),
    }));
    assert.equal(service.status, 200);
    capture.observePvpReply(actor.sessionId, actor.connection, 'pvp', reply(request.id, '1000000'), 'handed-off');
  });
  assert.equal(observations[0].decision, 'unknown');
  assert.equal(observations[0].balance.state === 'value' && observations[0].balance.units, '100');
});

test('a wrong transport value can still refer to the shared wallet ledger head', async () => {
  const { capture, observations } = fixture('royal_game');
  const actor = owner('actor');
  const request = { action: 'ready', id: randomUUID() };
  await capture.runPvp(actor, request, () => {
    const outgoing = reply(request.id, '-1000000');
    capture.observePvpReply(actor.sessionId, actor.connection, 'pvp', {
      ...outgoing, wallet: { ...outgoing.wallet, wallet: { balance: 302.16, entries: [{ id: 41 }] } },
    }, 'handed-off');
  });
  assert.deepEqual(observations[0].balance, {
    state: 'value', units: '-100', asset: { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 },
    snapshot: { namespace: 'royal_game.demo_ledger', rowId: '41' },
  });
});

test('explicit replay and changed intent keep the same operation ID and separate decisions', async () => {
  const { capture, observations } = fixture();
  const actor = owner('actor');
  const request = { action: 'invite', id: randomUUID() };
  await capture.runPvp(actor, request, async () => {
    await capture.runPvpService(actor.accountId, 'pvp-command', { request }, () => ({
      status: 200, value: { ...reply(request.id, '1000000'), replayed: true },
    }));
    capture.observePvpReply(actor.sessionId, actor.connection, 'pvp', reply(request.id, '1000000'), 'handed-off');
  });
  const changed = { ...request, action: 'accept' };
  await capture.runPvp(actor, changed, async () => {
    await capture.runPvpService(actor.accountId, 'pvp-command', { request: changed }, () => ({
      status: 409, value: { code: 'play_idempotency_conflict' },
    }));
    capture.observePvpReply(actor.sessionId, actor.connection, 'pvp-result',
      { requestId: request.id, rejected: true, error: 'rejected' }, 'handed-off');
  });
  assert.deepEqual(observations.map(row => row.operationId), [request.id, request.id]);
  assert.notEqual(observations[0].attemptId, observations[1].attemptId);
  assert.deepEqual(observations.map(row => row.decision), ['replayed', 'rejected']);
  assert.equal(observations[1].balance.state, 'absent');
});

test('duplicate incoming commands on one connection cannot claim the first response', async () => {
  const { capture, observations } = fixture();
  const actor = owner('actor');
  const request = { action: 'accept', id: randomUUID() };
  const proceed = barrier();
  const accepted = capture.runPvp(actor, request, async () => {
    await proceed.wait;
    capture.observePvpReply(actor.sessionId, actor.connection, 'pvp', reply(request.id, '1000000'), 'handed-off');
  });
  await capture.runPvp(actor, request, () => undefined);
  proceed.release();
  await accepted;
  assert.deepEqual(observations.map(row => [row.response, row.delivery]), [
    ['not-observed', 'unobserved'], ['formed', 'handed-off'],
  ]);
  assert.notEqual(observations[0].attemptId, observations[1].attemptId);
  assert.ok(observations.every(row => row.operationId === request.id));
});

test('drop and a reused session ID do not transfer a reply to an older attempt', async () => {
  const { capture, observations } = fixture();
  const original = owner('same-session');
  const replacement = { ...original, connection: {} };
  const request = { action: 'move', id: randomUUID() };
  const proceed = barrier();
  const pending = capture.runPvp(original, request, async () => {
    await capture.runPvpService(original.accountId, 'pvp-command', { request }, () => ({
      status: 200, value: { ...reply(request.id, '1000000'), replayed: false },
    }));
    await proceed.wait;
    capture.observePvpReply(original.sessionId, replacement.connection, 'pvp', reply(request.id, '1000000'), 'handed-off');
  });
  capture.dropped(original.sessionId, original.connection);
  await capture.runPvp(replacement, request, () => {
    capture.observePvpReply(replacement.sessionId, replacement.connection, 'pvp', reply(request.id, '2000000'), 'handed-off');
  });
  proceed.release();
  await pending;

  assert.deepEqual(observations.map(row => [row.occurredAtMs, row.decision, row.response, row.delivery]), [
    [1001, 'unknown', 'formed', 'handed-off'], [1000, 'accepted', 'not-observed', 'closed'],
  ]);
  assert.deepEqual(observations[1].balance, { state: 'not-recorded' });
});

test('a formed reply with no receiver remains an observation, with closed delivery', async () => {
  const { capture, observations } = fixture();
  const actor = owner('actor');
  const request = { action: 'cancel', id: randomUUID() };
  await capture.runPvp(actor, request, () => {
    capture.dropped(actor.sessionId, actor.connection);
    capture.observePvpReply(actor.sessionId, undefined, 'pvp', reply(request.id, '10001'), 'closed');
  });
  assert.equal(observations[0].response, 'formed');
  assert.equal(observations[0].delivery, 'closed');
  assert.deepEqual(observations[0].balance, { state: 'invalid' });
});

test('paid activity controls have no inferred reply, and high-rate controls are excluded', () => {
  const { capture, observations } = fixture();
  const actor = owner('actor');
  const entity: AuditEntityRef = {
    category: 'pvp', kind: 'match', gameId: 'chess', modeId: 'stake', rulesVersion: null, ticketId: null,
    source: { namespace: 'royal_game.pvp_matches', rowId: randomUUID() },
  };
  let invoked = 0;
  const invoke = () => ++invoked;
  assert.equal(capture.runActivity(actor, { type: 'chess-move', credential: 'not-kept' }, invoke, entity), 1);
  capture.runActivity(actor, { type: 'combat-input' }, invoke);
  capture.runActivity(actor, { type: 'paddle' }, invoke);
  capture.runActivity(actor, { type: 'note' }, invoke);
  assert.equal(invoked, 4);
  assert.equal(observations.length, 1);
  const row = observations[0];
  assert.deepEqual([row.route, row.operationId, row.decision, row.response, row.delivery],
    ['activity.chess-move', null, 'unknown', 'not-observed', 'unobserved']);
  assert.deepEqual(row.entity, entity);
  assert.equal(JSON.stringify(row).includes('not-kept'), false);
});

test('observer failure cannot replace command results or exceptions', async () => {
  const capture = new WsAttemptCapture(() => { throw Error('audit failure'); });
  const actor = owner('actor');
  const request = { action: 'ready', id: randomUUID() };
  assert.equal(await capture.runPvp(actor, request, () => 123), 123);
  const failure = new Error('domain failure');
  await assert.rejects(capture.runPvp(actor, request, () => { throw failure; }), error => error === failure);
});
