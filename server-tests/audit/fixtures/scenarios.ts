import { AUDIT_SCHEMA_VERSION } from '../../../server/audit/contract.ts';
import type {
  AuditAsset, AuditAttempt, AuditEntityRef, AuditEvent, AuditPosting, AuditRecord, AuditSourceRef,
} from '../../../server/audit/contract.ts';

export const fixtureClock = 1794059700000;

const virtualUsd = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 } as const;
const syntheticUsdt = { contour: 'real', code: 'USDT', scale: 6 } as const;
const gameLedger = 'royal_game.demo_ledger';
const paymentLedger = 'royal_payments.crypto_ledger';

type Action = Pick<AuditPosting, 'accountId' | 'entity' | 'operationId'>;
type PostingFields = Pick<AuditPosting, 'movement' | 'availableDeltaUnits' | 'availableAfterUnits'> &
  Partial<Pick<AuditPosting, 'asset' | 'reservedDeltaUnits' | 'reservedAfterUnits'>>;

function source(namespace: string, rowId: string): AuditSourceRef {
  return { namespace, rowId };
}

function makeFixture(id: string) {
  const records: AuditRecord[] = [];
  const scope = { datasetId: 'test-paid-activity-fixture-' + id, environment: 'test' } as const;
  const header = (offset: number) => ({ schemaVersion: AUDIT_SCHEMA_VERSION, scope, occurredAtMs: fixtureClock + offset }) as const;

  return {
    records,
    posting(offset: number, sequence: string, action: Action, fields: PostingFields, namespace = gameLedger) {
      const record: AuditPosting = {
        ...header(offset), type: 'posting', source: source(namespace, sequence), sequence, ...action,
        coverage: 'complete', asset: virtualUsd, reservedDeltaUnits: null, reservedAfterUnits: null, ...fields,
      };
      records.push(record);
      return record;
    },
    event(offset: number, action: Pick<AuditEvent, 'entity' | 'accountId' | 'operationId'>,
      sequence: string, event: AuditEvent['event'], reasonCode: string | null, ...postings: AuditPosting[]) {
      const record: AuditEvent = {
        ...header(offset), type: 'event', eventId: action.entity.source.rowId + ':event:' + sequence,
        sequence, ...action, event, reasonCode,
        postings: postings.map(posting => posting.source),
      };
      records.push(record);
      return record;
    },
    attempt(offset: number, attemptId: string, action: Action,
      fields: Pick<AuditAttempt, 'transport' | 'route' | 'decision' | 'response' | 'statusCode' | 'balance'>) {
      const record: AuditAttempt = { ...header(offset), type: 'attempt', attemptId, ...action, ...fields };
      records.push(record);
      return record;
    },
  };
}

function balance(posting: AuditPosting, units = posting.availableAfterUnits): AuditAttempt['balance'] {
  if (units === null) return { state: 'not-recorded' };
  return { state: 'value', asset: posting.asset, units, snapshot: posting.source };
}

function casinoFixture(id: string, mismatch: boolean) {
  const fixture = makeFixture(id);
  const operationId = id + '-operation';
  const entity: AuditEntityRef = {
    category: 'casino', kind: 'round', gameId: 'royal-plinko', modeId: 'normal', rulesVersion: '1', ticketId: null,
    source: source('royal_game.demo_operations', JSON.stringify(['fixture-a', operationId])),
  };
  const action = { accountId: 'fixture-a', operationId, entity };
  const stake = fixture.posting(0, '1', action, { movement: 'stake', availableDeltaUnits: '-100', availableAfterUnits: '30216' });
  fixture.event(0, action, '1', 'accepted', null, stake);
  const payout = fixture.posting(0, '2', action, { movement: 'payout', availableDeltaUnits: '0', availableAfterUnits: '30216' });
  fixture.event(0, action, '2', 'settled', null, payout);
  const route = '/api/demo-wallet/operations';
  const transport = 'http' as const;
  if (mismatch) {
    fixture.attempt(1, 'incorrect-balance', action, {
      transport, route, decision: 'accepted', response: 'formed', statusCode: 200, balance: balance(payout, '-100'),
    });
  } else {
    fixture.attempt(1, 'lost-answer', action, {
      transport, route, decision: 'accepted', response: 'not-observed', statusCode: null, balance: { state: 'not-recorded' },
    });
    fixture.attempt(2, 'same-operation-retried', action, {
      transport, route, decision: 'replayed', response: 'formed', statusCode: 200, balance: balance(payout),
    });
    fixture.attempt(3, 'changed-intent-rejected', action, {
      transport, route, decision: 'rejected', response: 'formed', statusCode: 409, balance: { state: 'absent' },
    });
  }
  return fixture.records;
}

function pvpFixture(id: string, durationOffsets: readonly number[], payoutUnits = 1900) {
  const fixture = makeFixture(id);
  let winnerBalance = 5000;
  let otherBalance = 5000;
  for (const [index, duration] of durationOffsets.entries()) {
    const start = index * 120_000;
    const seq = index * 3;
    const matchId = id + '-match-' + (index + 1);
    const entity: AuditEntityRef = {
      category: 'pvp', kind: 'match', gameId: 'tsu-e-fa', modeId: 'stake', rulesVersion: '4', ticketId: null,
      source: source('royal_game.pvp_matches', matchId),
    };
    const action = { accountId: 'fixture-a', operationId: 'pvp:' + matchId + ':hold', entity };
    winnerBalance -= 1000;
    otherBalance -= 1000;
    const first = fixture.posting(start, String(seq + 1), action, {
      movement: 'reserve', availableDeltaUnits: '-1000', availableAfterUnits: String(winnerBalance),
    });
    const second = fixture.posting(start, String(seq + 2), { ...action, accountId: 'fixture-b' }, {
      movement: 'reserve', availableDeltaUnits: '-1000', availableAfterUnits: String(otherBalance),
    });
    const terminal = { ...action, operationId: 'pvp:' + matchId + ':final' };
    winnerBalance += payoutUnits;
    fixture.event(start, action, '1', 'reserved', null, first, second);
    const payout = fixture.posting(start + duration, String(seq + 3), terminal, {
      movement: 'payout', availableDeltaUnits: String(payoutUnits), availableAfterUnits: String(winnerBalance),
    });
    fixture.event(start + duration, terminal, '2', 'forfeited', 'resign', payout);
  }
  return fixture.records;
}

function poolFixture(id: string, outcome: 'settled' | 'refunded' | 'duplicate-credit') {
  const fixture = makeFixture(id);
  const pool: AuditEntityRef = {
    category: 'totalizator', kind: 'pool', gameId: 'flag-tote', modeId: 'shared-pool', rulesVersion: '1', ticketId: null,
    source: source('royal_game.flag_tote_rounds', 'ft1-' + fixtureClock),
  };
  const route = '/api/demo-wallet/flag-tote';
  const transport = 'http' as const;
  const cutoff = 240_000;
  const settle = outcome !== 'refunded';
  const tickets = settle
    ? [
      { accountId: 'fixture-a', after: '900', offset: 100 },
      { accountId: 'fixture-b', after: '900', offset: 200 },
      { accountId: 'fixture-c', after: '900', offset: 300 },
      { accountId: 'fixture-a', after: '800', offset: cutoff - 1 },
    ]
    : [{ accountId: 'fixture-a', after: '900', offset: 100 }];
  for (const [index, ticket] of tickets.entries()) {
    const ticketId = id + '-ticket-' + (index + 1);
    const action = { accountId: ticket.accountId, operationId: ticketId, entity: { ...pool, ticketId } };
    const debit = fixture.posting(ticket.offset, String(index + 1), action, {
      movement: 'stake', availableDeltaUnits: '-100', availableAfterUnits: ticket.after,
    });
    fixture.event(ticket.offset, action, String(index + 1), 'accepted', null, debit);
    fixture.attempt(ticket.offset, 'accept-ticket-' + (index + 1), action, {
      transport, route, decision: 'accepted', response: 'formed', statusCode: 200, balance: balance(debit),
    });
  }

  const terminal = { accountId: 'fixture-a', operationId: 'flag-tote:' + pool.source.rowId + ':final', entity: pool };
  if (settle) {
    const rejected = { accountId: 'fixture-a', operationId: id + '-late-ticket', entity: pool };
    fixture.attempt(cutoff, 'reject-at-cutoff', rejected, {
      transport, route, decision: 'rejected', response: 'formed', statusCode: 409, balance: { state: 'absent' },
    });
    const credit = fixture.posting(cutoff + 30_700, '5', terminal, {
      movement: 'payout', availableDeltaUnits: '380', availableAfterUnits: '1180',
    });
    fixture.event(cutoff + 30_700, { ...terminal, accountId: null, operationId: null }, '5', 'settled', null, credit);
    if (outcome === 'duplicate-credit') {
      fixture.posting(cutoff + 30_701, '6', terminal, {
        movement: 'payout', availableDeltaUnits: '380', availableAfterUnits: '1560',
      });
    }
  } else {
    const credit = fixture.posting(cutoff, '2', terminal, {
      movement: 'refund', availableDeltaUnits: '100', availableAfterUnits: '1000',
    });
    fixture.event(cutoff, { ...terminal, accountId: null, operationId: null }, '2', 'cancelled', 'countries', credit);
  }
  return fixture.records;
}

function paymentFixture() {
  const fixture = makeFixture('payment');
  const action = { accountId: 'fixture-a', operationId: 'payment-withdrawal', entity: null };
  fixture.posting(0, '1', { ...action, operationId: 'fixture-sandbox-credit' }, {
    movement: 'deposit', availableDeltaUnits: '500', availableAfterUnits: '500',
  });
  const reserve = fixture.posting(1, '1', action, {
    movement: 'withdrawal-reserve', asset: syntheticUsdt, availableDeltaUnits: '-1000000',
    availableAfterUnits: '2000000', reservedDeltaUnits: '1000000', reservedAfterUnits: '1000000',
  }, paymentLedger);
  fixture.attempt(2, 'synthetic-withdrawal-accepted', action, {
    transport: 'http', route: '/api/crypto-wallet/withdrawals', decision: 'accepted', response: 'formed',
    statusCode: 200, balance: balance(reserve),
  });
  fixture.posting(1000, '2', action, {
    movement: 'withdrawal-paid', asset: syntheticUsdt, availableDeltaUnits: '0',
    availableAfterUnits: '2000000', reservedDeltaUnits: '-1000000', reservedAfterUnits: '0',
  }, paymentLedger);
  return fixture.records;
}

export const fixtureRecords = {
  casinoMismatch: casinoFixture('casino-mismatch', true),
  casinoRetry: casinoFixture('casino-retry', false),
  pvpControl: pvpFixture('pvp-control', [4000]),
  pvpReview: pvpFixture('pvp-review', [4000, 3500, 4100]),
  pvpPayoutMismatch: pvpFixture('pvp-payout-mismatch', [4000], 2000),
  poolCutoff: poolFixture('pool-cutoff', 'settled'),
  poolRefund: poolFixture('pool-refund', 'refunded'),
  poolDuplicateCredit: poolFixture('pool-duplicate-credit', 'duplicate-credit'),
  payment: paymentFixture(),
} satisfies Record<string, AuditRecord[]>;

type BalanceOracle = {
  accountId: string;
  asset: AuditAsset;
  opening: string;
  closing: string;
  openingReserved?: string;
  closingReserved?: string;
};

type FixtureOracle = {
  behavior: 'control' | 'review';
  balances: readonly BalanceOracle[];
  responseMismatches: readonly string[];
  settlementFinding?: 'pvp-payout-mismatch' | 'pool-duplicate-credit';
  expectedPostingCount: number;
};

export const fixtureOracles = {
  casinoMismatch: {
    behavior: 'control', responseMismatches: ['incorrect-balance'], expectedPostingCount: 2,
    balances: [{ accountId: 'fixture-a', asset: virtualUsd, opening: '30316', closing: '30216' }],
  },
  casinoRetry: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 2,
    balances: [{ accountId: 'fixture-a', asset: virtualUsd, opening: '30316', closing: '30216' }],
  },
  pvpControl: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 3,
    balances: [
      { accountId: 'fixture-a', asset: virtualUsd, opening: '5000', closing: '5900' },
      { accountId: 'fixture-b', asset: virtualUsd, opening: '5000', closing: '4000' },
    ],
  },
  pvpReview: {
    behavior: 'review', responseMismatches: [], expectedPostingCount: 9,
    balances: [
      { accountId: 'fixture-a', asset: virtualUsd, opening: '5000', closing: '7700' },
      { accountId: 'fixture-b', asset: virtualUsd, opening: '5000', closing: '2000' },
    ],
  },
  pvpPayoutMismatch: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 3, settlementFinding: 'pvp-payout-mismatch',
    balances: [
      { accountId: 'fixture-a', asset: virtualUsd, opening: '5000', closing: '6000' },
      { accountId: 'fixture-b', asset: virtualUsd, opening: '5000', closing: '4000' },
    ],
  },
  poolCutoff: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 5,
    balances: [
      { accountId: 'fixture-a', asset: virtualUsd, opening: '1000', closing: '1180' },
      { accountId: 'fixture-b', asset: virtualUsd, opening: '1000', closing: '900' },
      { accountId: 'fixture-c', asset: virtualUsd, opening: '1000', closing: '900' },
    ],
  },
  poolRefund: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 2,
    balances: [{ accountId: 'fixture-a', asset: virtualUsd, opening: '1000', closing: '1000' }],
  },
  poolDuplicateCredit: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 6, settlementFinding: 'pool-duplicate-credit',
    balances: [
      { accountId: 'fixture-a', asset: virtualUsd, opening: '1000', closing: '1560' },
      { accountId: 'fixture-b', asset: virtualUsd, opening: '1000', closing: '900' },
      { accountId: 'fixture-c', asset: virtualUsd, opening: '1000', closing: '900' },
    ],
  },
  payment: {
    behavior: 'control', responseMismatches: [], expectedPostingCount: 3,
    balances: [
      { accountId: 'fixture-a', asset: virtualUsd, opening: '0', closing: '500' },
      { accountId: 'fixture-a', asset: syntheticUsdt, opening: '3000000', closing: '2000000', openingReserved: '0', closingReserved: '0' },
    ],
  },
} satisfies Record<keyof typeof fixtureRecords, FixtureOracle>;
