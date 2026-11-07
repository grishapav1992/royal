import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkAuditAttemptBalance, checkAuditStakeDirection, reconcileAuditBalance, reconcileStoredAuditAttempt,
  type AuditBalanceSnapshot, type AuditBalanceStream,
} from '../server/audit/check-balances';
import type { AuditAsset, AuditAttempt, AuditPosting, AuditScope, AuditSourceRef } from '../server/audit/contract';

const scope: AuditScope = { datasetId: 'audit-test', environment: 'test' };
const asset: AuditAsset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 };
const sourceNamespace = 'royal_game.demo_ledger';

function posting(sequence: string, delta: string, observed: string | null, options: Partial<AuditPosting> = {}): AuditPosting {
  return {
    schemaVersion: 1, type: 'posting', scope, asset, sequence, occurredAtMs: 100, accountId: 'alice',
    source: { namespace: sourceNamespace, rowId: sequence }, operationId: 'round-1', entity: null,
    movement: 'stake', coverage: 'complete', availableDeltaUnits: delta, availableAfterUnits: observed,
    reservedDeltaUnits: null, reservedAfterUnits: null, ...options,
  };
}

function stream(entries: AuditBalanceStream['entries'], options: Partial<AuditBalanceStream> = {}): AuditBalanceStream {
  return { scope, asset, sourceNamespace, accountId: 'alice', component: 'available', openingUnits: '30316', entries, ...options };
}

function snapshot(row: AuditPosting, units: string): AuditBalanceSnapshot {
  return { source: row.source, scope: row.scope, accountId: row.accountId, asset: row.asset, units };
}

function attempt(row: AuditPosting, units: string): AuditAttempt {
  return {
    schemaVersion: 1, type: 'attempt', scope, occurredAtMs: 200, accountId: row.accountId, operationId: row.operationId,
    entity: row.entity, attemptId: 'attempt-1', transport: 'http', route: '/api/demo-wallet/operations',
    decision: 'accepted', response: 'formed', statusCode: 200,
    balance: { state: 'value', asset: row.asset, units, snapshot: row.source },
  };
}

test('a correct committed balance is distinct from the wrong balance formed in the response', () => {
  const row = posting('9', '-100', '30216');
  const check = reconcileAuditBalance(stream([{ posting: row }]));
  assert.equal(check.opening, 'verified');
  assert.deepEqual(check.checks[0], {
    source: row.source, sequence: '9', basis: 'opening', status: 'match',
    expectedUnits: '30216', observedUnits: '30216',
  });
  assert.deepEqual(checkAuditAttemptBalance(attempt(row, '-100'), snapshot(row, '30216')), {
    asset, status: 'mismatch', expectedUnits: '30216', observedUnits: '-100',
  });
});

test('an incorrect recorded balance never becomes the opening-based expectation', () => {
  const first = posting('9', '-100', '30215');
  const next = posting('10', '-100', '30116');
  // Server timestamps can coincide or arrive in an order different from ledger sequence.
  const result = reconcileAuditBalance(stream([{ posting: first }, { posting: { ...next, occurredAtMs: 50 } }]));
  assert.deepEqual(result.checks.map(({ status, expectedUnits }) => [status, expectedUnits]),
    [['mismatch', '30216'], ['match', '30116']]);
  const huge = '900719925474099301111';
  const large = reconcileAuditBalance(stream([{ posting: posting('999', '-1', '900719925474099301110') }], { openingUnits: huge }));
  assert.equal(large.checks[0].status, 'match');
});

test('unknown opening permits only adjacent comparison and an explicit gap breaks the chain', () => {
  const first = posting('1', '-100', '30216');
  const second = posting('2', '-100', '30116');
  const gap = { source: { namespace: sourceNamespace, rowId: '3' }, sequence: '3', reason: 'source-unavailable' as const };
  const fourth = posting('4', '-100', '29916');
  const fifth = posting('5', '-100', '29817');
  const entries = [{ posting: first }, { posting: second }, { gap }, { posting: fourth }, { posting: fifth }];
  const result = reconcileAuditBalance(stream(entries, { openingUnits: null }));
  assert.equal(result.opening, 'unconfirmed');
  assert.deepEqual(result.checks.map(check => [check.status, check.basis, check.expectedUnits]), [
    ['insufficient-data', null, null], ['match', 'adjacent', '30116'],
    ['insufficient-data', null, null], ['insufficient-data', null, null], ['mismatch', 'adjacent', '29816'],
  ]);
  assert.equal(result.checks[0].status === 'insufficient-data' && result.checks[0].reason, 'opening-unconfirmed');
  assert.equal(result.checks[2].status === 'insufficient-data' && result.checks[2].reason, 'source-unavailable');
  const interrupted = reconcileAuditBalance(stream(entries));
  assert.equal(interrupted.opening, 'verified');
  assert.equal(interrupted.checks[4].basis, 'adjacent');
});

test('missing balance observation and missing monetary delta have different consequences', () => {
  const base = { component: 'reserved' as const, openingUnits: '10' };
  const first = posting('1', '0', null, { reservedDeltaUnits: '3', reservedAfterUnits: null });
  const second = posting('2', '0', null, { reservedDeltaUnits: '4', reservedAfterUnits: '17' });
  const third = posting('3', '0', null, { reservedDeltaUnits: null, reservedAfterUnits: '20' });
  const fourth = posting('4', '0', null, { reservedDeltaUnits: '1', reservedAfterUnits: '21' });
  const result = reconcileAuditBalance(stream([first, second, third, fourth].map(row => ({ posting: row })), base));
  assert.deepEqual(result.checks.map(check => [check.status, check.basis, check.expectedUnits]), [
    ['insufficient-data', 'opening', '13'], ['match', 'opening', '17'],
    ['insufficient-data', 'opening', null], ['match', 'adjacent', '21'],
  ]);
  assert.equal(result.checks[0].status === 'insufficient-data' && result.checks[0].reason, 'recorded-balance-unavailable');
  assert.equal(result.checks[2].status === 'insufficient-data' && result.checks[2].reason, 'delta-unavailable');
});

test('source, account, dataset, contour, asset, scale and exact sequence are isolated', () => {
  const base = posting('9', '1', '30317');
  const later = posting('10', '1', '30318');
  assert.throws(() => reconcileAuditBalance(stream([{ posting: later }, { posting: base }])), /invalid order/);
  assert.throws(() => reconcileAuditBalance(stream([{ posting: base }, { posting: { ...base, sequence: '10' } }])), /duplicate/);
  assert.throws(() => reconcileAuditBalance(stream([{ posting: { ...base, source: { namespace: 'another.ledger', rowId: '9' } } }])), /foreign source/);
  for (const foreign of [
    { accountId: 'bob' },
    { scope: { ...scope, datasetId: 'other' } },
    { scope: { ...scope, environment: 'live' as const } },
    { asset: { ...asset, contour: 'real' as const } },
    { asset: { ...asset, code: 'USDT' } },
    { asset: { ...asset, scale: 6 } },
  ]) {
    assert.throws(() => reconcileAuditBalance(stream([{ posting: { ...base, ...foreign } }])), /foreign account, scope or asset/);
  }
  const pending = reconcileAuditBalance(stream([{ posting: base, pendingDeltaUnits: '-3', pendingAfterUnits: '4' }],
    { openingUnits: '7', component: 'pending' }));
  assert.equal(pending.checks[0].expectedUnits, '4');
  assert.equal(pending.checks[0].status, 'match');
});

test('a retry can use a fresh exact snapshot and scales are converted without rounding', () => {
  const original = posting('9', '-100', '30216');
  const fresh = posting('10', '100', '30316', { operationId: 'other-operation', movement: 'deposit' });
  const retry = { ...attempt(original, '303160000'), decision: 'replayed' as const,
    balance: { state: 'value' as const, snapshot: fresh.source, asset: { ...asset, scale: 6 }, units: '303160000' } };
  assert.equal(checkAuditAttemptBalance(retry, snapshot(original, '30216')).status, 'insufficient-data');
  assert.deepEqual(checkAuditAttemptBalance(retry, snapshot(fresh, '30316')), {
    asset: { ...asset, scale: 6 }, status: 'match', expectedUnits: '303160000', observedUnits: '303160000',
  });
  const short = attempt(original, '30216');
  assert.deepEqual(checkAuditAttemptBalance(short, { ...snapshot(original, '302160001'), asset: { ...asset, scale: 6 } }), {
    asset: { ...asset, scale: 6 }, status: 'mismatch', expectedUnits: '302160001', observedUnits: '302160000',
  });
});

test('unobserved, invalid and unassociated response balances give explicit gaps', () => {
  const row = posting('1', '-100', '30216');
  const request = attempt(row, '30216'), exact = snapshot(row, '30216');
  assert.deepEqual([
    checkAuditAttemptBalance({ ...request, response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' } }, exact),
    checkAuditAttemptBalance({ ...request, balance: { state: 'absent' } }, exact),
    checkAuditAttemptBalance({ ...request, balance: { state: 'invalid' } }, exact),
    checkAuditAttemptBalance({ ...request, balance: { state: 'not-recorded' } }, exact),
    checkAuditAttemptBalance({ ...request, balance: { state: 'value', asset, units: '30216', snapshot: null } }, exact),
    checkAuditAttemptBalance(request, null),
    checkAuditAttemptBalance(request, { ...exact, accountId: 'bob' }),
    checkAuditAttemptBalance(request, { ...exact, scope: { ...scope, environment: 'live' } }),
    checkAuditAttemptBalance(request, { ...exact, asset: { ...asset, contour: 'real' } }),
  ].map(result => result.status === 'insufficient-data' && result.reason), [
    'response-not-observed', 'response-balance-absent', 'response-balance-invalid',
    'response-balance-not-recorded', 'snapshot-unassociated', 'snapshot-unavailable',
    'snapshot-context-mismatch', 'snapshot-context-mismatch', 'snapshot-context-mismatch',
  ]);
});

test('stake direction uses only debit buckets, including a known pending debit', () => {
  assert.deepEqual(checkAuditStakeDirection(posting('1', '-100', '30216')), { status: 'match', deltaUnits: '-100' });
  assert.deepEqual(checkAuditStakeDirection(posting('1', '100', '30416')), { status: 'mismatch', deltaUnits: '100' });
  assert.deepEqual(checkAuditStakeDirection(posting('1', '0', '30316')), { status: 'mismatch', deltaUnits: '0' });
  assert.deepEqual(checkAuditStakeDirection(posting('1', '0', '30316'), '-100'), { status: 'match', deltaUnits: '-100' });
  assert.deepEqual(checkAuditStakeDirection(posting('1', '0', '30316'), null), { status: 'insufficient-data' });
  assert.deepEqual(checkAuditStakeDirection(posting('1', '0', '30316', { movement: 'payout' })), { status: 'not-applicable' });
});

test('stored attempt uses the independent ledger head from exactly the requested dataset', async () => {
  const row = posting('9', '-100', '30216');
  const reads: Array<{ datasetId: string; source: AuditSourceRef }> = [];
  const reader = {
    async read(datasetId: string, source: AuditSourceRef) {
      reads.push({ datasetId, source });
      return { status: 'found' as const, posting: row };
    },
  };
  assert.equal(reconcileAuditBalance(stream([{ posting: row }])).checks[0].status, 'match');
  assert.deepEqual(await reconcileStoredAuditAttempt(attempt(row, '-100'), reader), {
    asset, status: 'mismatch', expectedUnits: '30216', observedUnits: '-100',
  });
  assert.deepEqual(reads, [{ datasetId: scope.datasetId, source: row.source }]);

  // A replay can see a newer canonical head produced by a separate wallet payment.
  const newer = posting('10', '500', '30716', { movement: 'deposit', operationId: 'sandbox-deposit', coverage: 'partial' });
  const retry = { ...attempt(newer, '30716'), operationId: row.operationId, decision: 'replayed' as const };
  const freshReader = { read: async () => ({ status: 'found' as const, posting: newer }) };
  assert.equal((await reconcileStoredAuditAttempt(retry, freshReader)).status, 'match');
  assert.equal((await reconcileStoredAuditAttempt({ ...retry, transport: 'websocket', route: 'pvp', statusCode: null }, freshReader)).status, 'match');
});

test('missing or unsupported ledger sources stay explicit and unrelated sources cannot be read', async () => {
  const row = posting('9', '-100', '30216');
  const request = attempt(row, '-100');
  for (const status of ['not-captured', 'source-unavailable', 'unsupported'] as const) {
    const gap = await reconcileStoredAuditAttempt(request, { read: async () => ({ status }) });
    assert.equal(gap.status === 'insufficient-data' && gap.reason, status);
  }
  const neverRead = { read: async (): Promise<never> => { assert.fail('Unbound references must not reach the reader'); } };
  for (const badSource of [
    { namespace: 'audit-attempt-response', rowId: request.attemptId },
    { namespace: 'royal_payments.crypto_ledger', rowId: '9' },
    { namespace: 'royal_game.capro_pending_ledger', rowId: '9' },
    { namespace: sourceNamespace, rowId: '9223372036854775808' },
  ]) {
    const gap = await reconcileStoredAuditAttempt({
      ...request, balance: { state: 'value', asset, units: '-100', snapshot: badSource },
    }, neverRead);
    assert.equal(gap.status === 'insufficient-data' && gap.reason, 'snapshot-source-unsupported');
  }
  for (const routeFields of [
    { route: '/api/crypto-wallet/deposits' },
    { route: '/api/demo-wallet/operations-other' },
    { statusCode: 500 },
    { operationId: null },
    { transport: 'websocket' as const, route: 'pvp', statusCode: 200 },
  ]) {
    const gap = await reconcileStoredAuditAttempt({ ...request, ...routeFields }, neverRead);
    assert.equal(gap.status === 'insufficient-data' && gap.reason, 'snapshot-route-unsupported');
  }
  const absent = await reconcileStoredAuditAttempt({ ...request, balance: { state: 'absent' } }, neverRead);
  assert.equal(absent.status === 'insufficient-data' && absent.reason, 'response-balance-absent');
  const unbound = await reconcileStoredAuditAttempt({ ...request, balance: { state: 'value', asset, units: '-100', snapshot: null } }, neverRead);
  assert.equal(unbound.status === 'insufficient-data' && unbound.reason, 'snapshot-unassociated');
});

test('the returned posting must match the reference, account, scope and canonical virtual asset', async () => {
  const row = posting('9', '-100', '30216');
  for (const incompatible of [
    { source: { ...row.source, rowId: '10' } },
    { accountId: 'bob' },
    { scope: { ...scope, datasetId: 'another' } },
    { scope: { ...scope, environment: 'live' as const } },
    { asset: { ...asset, code: 'USDT' } },
    { asset: { ...asset, contour: 'test' as const } },
    { asset: { ...asset, scale: 6 } },
  ]) {
    const gap = await reconcileStoredAuditAttempt(attempt(row, '-100'), {
      read: async () => ({ status: 'found', posting: { ...row, ...incompatible } }),
    });
    assert.equal(gap.status === 'insufficient-data' && gap.reason, 'snapshot-context-mismatch');
  }
  const noBalance = await reconcileStoredAuditAttempt(attempt(row, '-100'), {
    read: async () => ({ status: 'found', posting: { ...row, availableAfterUnits: null } }),
  });
  assert.equal(noBalance.status === 'insufficient-data' && noBalance.reason, 'recorded-balance-unavailable');
});
