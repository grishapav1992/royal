import { createHash } from 'node:crypto';
import { CLUB_FINE_SOURCE } from '../../src/shared/security';
import { SKIN_UUID } from '../../src/shared/skinStudio';
import type { PostgresDatabase } from '../database';
import { validPaymentEvent } from '../payments/protocol';
import type { AuditAsset, AuditPosting, AuditSourceRef } from './contract';

type PostingFields = Omit<AuditPosting, 'schemaVersion' | 'scope' | 'type'>;
type PaymentSource = 'nowpayments' | 'telegram-stars' | 'payment-adjustment' | 'nowpayments-sandbox'
  | 'legacy-direct-topup' | 'skin-purchase' | 'progression-reward' | 'casinoapipro-sandbox' | typeof CLUB_FINE_SOURCE;
type PaymentTable = 'demo_ledger' | 'capro_pending_ledger' | 'crypto_ledger';
type MirrorTable = 'payment_outbox' | 'payment_credit_events';

export type PaymentPostingKey = { table: PaymentTable; rowId: string };
export type PaymentPostingResolution = {
  posting: PostingFields;
  paymentSource: PaymentSource;
  operation: AuditSourceRef | null;
  pendingDeltaUnits: string | null;
  pendingAfterUnits: string | null;
  deliveryEventId: string | null;
};

export type PaymentMirror = {
  source: AuditSourceRef;
  eventId: string;
  operationId: string;
  accountId: string;
  state: 'queued' | 'acknowledged' | 'applied';
};

type LedgerRow = {
  account_id: string;
  operation_id: string;
  created_at_ms: string;
};
type DemoRow = LedgerRow & {
  source: string;
  entry_type: string;
  amount_units: string;
  balance_units: string;
};
type PendingRow = LedgerRow & {
  reason: string;
  amount_units: string;
  pending_balance_units: string;
};
type CryptoRow = LedgerRow & {
  entry_key: string;
  available_delta: string;
  reserved_delta: string;
  balance_units: string;
  reserved_units: string;
};

const virtualAsset: AuditAsset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 };
const paymentAsset: AuditAsset = { contour: 'real', code: 'USDT', scale: 6 };
const providerMovements = {
  debit: 'stake', credit: 'payout', refund: 'refund', rollback: 'reversal', transfer: 'release',
} as const;
const providerEntries = { bet: 'debit', win: 'credit', refund: 'refund', rollback: 'rollback' } as const;

function source(db: PostgresDatabase, table: string, rowId: string): AuditSourceRef {
  return { namespace: db.schema + '.' + table, rowId };
}

function sourceRowId(id: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
}

function readCommitted<T>(db: PostgresDatabase, action: () => Promise<T>): Promise<T> {
  if (db.inTransaction) throw new Error('Payment audit requires an independent source snapshot');
  return db.transaction(action, { readOnly: true });
}

function resolve(
  db: PostgresDatabase, key: PaymentPostingKey, row: LedgerRow, paymentSource: PaymentSource,
  operation: AuditSourceRef | null, movement: PostingFields['movement'], asset: AuditAsset,
  availableDeltaUnits: string, availableAfterUnits: string | null,
  reservedDeltaUnits: string | null = null, reservedAfterUnits: string | null = null,
): PaymentPostingResolution | null {
  const occurredAtMs = Number(row.created_at_ms);
  if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) return null;
  return {
    posting: {
      source: source(db, key.table, key.rowId), sequence: key.rowId, occurredAtMs,
      accountId: row.account_id, operationId: row.operation_id, entity: null,
      coverage: operation ? 'complete' : 'partial', movement, asset: { ...asset },
      availableDeltaUnits, availableAfterUnits, reservedDeltaUnits, reservedAfterUnits,
    },
    paymentSource, operation, pendingDeltaUnits: null, pendingAfterUnits: null, deliveryEventId: null,
  };
}

async function resolveCrypto(db: PostgresDatabase, key: PaymentPostingKey) {
  const row = await db.prepare(`SELECT account_id,operation_id,created_at::text AS created_at_ms,entry_key,
    available_delta::text,reserved_delta::text,balance_units::text,reserved_units::text
    FROM crypto_ledger WHERE id=?::bigint`).get(key.rowId) as CryptoRow | undefined;
  if (!row) return null;
  const { entry_key: entryKey, operation_id: operationId, account_id: accountId } = row;
  let movement: PostingFields['movement'];
  let paymentSource: PaymentSource = 'nowpayments';
  let operation: AuditSourceRef | null;
  if (entryKey === 'adjustment:' + operationId) {
    movement = 'adjustment';
    paymentSource = 'payment-adjustment';
    const linked = await db.prepare('SELECT id FROM finance_adjustments WHERE id=? AND player_id=?')
      .get(operationId, accountId);
    operation = linked ? source(db, 'finance_adjustments', operationId) : null;
  } else {
    let kind = 'withdrawal';
    if (entryKey.startsWith('deposit:')) {
      movement = 'deposit';
      kind = 'deposit';
      if (entryKey.startsWith('deposit:telegram-stars:')) paymentSource = 'telegram-stars';
    } else if (entryKey === 'reserve:' + operationId) movement = 'withdrawal-reserve';
    else if (entryKey === 'paid:' + operationId) movement = 'withdrawal-paid';
    else if (entryKey === 'refund:' + operationId) movement = 'refund';
    else return null;

    const linked = await db.prepare('SELECT id FROM crypto_operations WHERE id=? AND account_id=? AND kind=?')
      .get(operationId, accountId, kind);
    operation = linked ? source(db, 'crypto_operations', operationId) : null;
  }
  const resolution = resolve(db, key, row, paymentSource, operation, movement, paymentAsset,
    row.available_delta, row.balance_units, row.reserved_delta, row.reserved_units);
  if (resolution) resolution.deliveryEventId = createHash('sha256').update(entryKey).digest('hex');
  return resolution;
}

async function providerOperation(db: PostgresDatabase, accountId: string, operationId: string, reason: string) {
  if (!(await db.hasTable('capro_transactions'))) return null;
  const transactionId = operationId.slice('capro:'.length);
  const row = await db.prepare(`SELECT t.transaction_id FROM capro_transactions t
    JOIN capro_players p ON p.player_id=t.player_id
    WHERE t.transaction_id=? AND p.account_id=? AND t.operation=?`).get(transactionId, accountId, reason);
  return row ? source(db, 'capro_transactions', transactionId) : null;
}

async function resolvePending(db: PostgresDatabase, key: PaymentPostingKey) {
  const row = await db.prepare(`SELECT account_id,operation_id,created_at::text AS created_at_ms,
    reason,amount_units,pending_balance_units FROM capro_pending_ledger WHERE id=?::bigint`).get(key.rowId) as PendingRow | undefined;
  if (!row || !row.operation_id.startsWith('capro:') || !Object.hasOwn(providerMovements, row.reason)) return null;
  const reason = row.reason as keyof typeof providerMovements;
  const operation = reason === 'transfer'
    ? await transferCounterpart(db, row)
    : await providerOperation(db, row.account_id, row.operation_id, reason);
  const resolution = resolve(db, key, row, 'casinoapipro-sandbox', operation, providerMovements[reason],
    virtualAsset, '0', null);
  if (resolution) {
    resolution.pendingDeltaUnits = row.amount_units;
    resolution.pendingAfterUnits = row.pending_balance_units;
  }
  return resolution;
}

async function transferCounterpart(db: PostgresDatabase, row: PendingRow) {
  const counterpart = await db.prepare(`SELECT id::text AS id FROM demo_ledger
    WHERE account_id=? AND operation_id=? AND source='casinoapipro' AND entry_type='win'
      AND amount_units>0 AND amount_units::numeric=-?::numeric`).all(row.account_id, row.operation_id, row.amount_units);
  return counterpart.length === 1 ? source(db, 'demo_ledger', counterpart[0].id) : null;
}

async function resolveProviderAvailable(db: PostgresDatabase, key: PaymentPostingKey, row: DemoRow) {
  if (!row.operation_id.startsWith('capro:') || !Object.hasOwn(providerEntries, row.entry_type)) return null;
  const entry = row.entry_type as keyof typeof providerEntries;
  const reason = providerEntries[entry];
  let operation = await providerOperation(db, row.account_id, row.operation_id, reason);
  let movement: PostingFields['movement'] = providerMovements[reason];
  // An external transaction ID can also start with "transfer:". The pending ledger proves an internal transfer.
  if (!operation && entry === 'win' && row.operation_id.startsWith('capro:transfer:')) {
    const linked = await db.prepare(`SELECT id::text AS id FROM capro_pending_ledger
      WHERE account_id=? AND operation_id=? AND reason='transfer'
        AND amount_units::numeric=-?::numeric`).get(row.account_id, row.operation_id, row.amount_units);
    if (linked) {
      movement = 'release';
      operation = source(db, 'capro_pending_ledger', linked.id);
    }
  }
  return resolve(db, key, row, 'casinoapipro-sandbox', operation, movement, virtualAsset, row.amount_units, row.balance_units);
}

async function resolveDemo(db: PostgresDatabase, key: PaymentPostingKey) {
  const row = await db.prepare(`SELECT account_id,operation_id,created_at::text AS created_at_ms,
    source,entry_type,amount_units::text,balance_units::text FROM demo_ledger WHERE id=?::bigint`)
    .get(key.rowId) as DemoRow | undefined;
  if (!row) return null;
  const { account_id: accountId, operation_id: operationId, entry_type: entry } = row;
  if (row.source === 'casinoapipro') return resolveProviderAvailable(db, key, row);
  let operation: AuditSourceRef | null = null;
  let paymentSource: PaymentSource;
  let movement: PostingFields['movement'];
  if (row.source === 'nowpayments-sandbox' && entry === 'deposit' && operationId.startsWith('nowpayments-sandbox:')) {
    paymentSource = 'nowpayments-sandbox';
    movement = 'deposit';
    const id = operationId.slice('nowpayments-sandbox:'.length);
    if (await db.hasTable('nowpayments_sandbox_deposits')) {
      const linked = await db.prepare('SELECT id FROM nowpayments_sandbox_deposits WHERE id=? AND account_id=?')
        .get(id, accountId);
      if (linked) operation = source(db, 'nowpayments_sandbox_deposits', id);
    }
  } else if (row.source === 'royal-coins' && entry === 'deposit') {
    paymentSource = 'legacy-direct-topup';
    movement = 'deposit';
    const linked = await db.prepare("SELECT operation_id FROM demo_operations WHERE operation_id=? AND account_id=? AND kind='deposit'")
      .get(operationId, accountId);
    if (linked) operation = source(db, 'demo_operations', JSON.stringify([accountId, operationId]));
  } else if (['atelier', 'janitor-skins'].includes(row.source) && (entry === 'bet' || entry === 'refund')) {
    paymentSource = 'skin-purchase';
    movement = entry === 'bet' ? 'purchase' : 'refund';
    const linked = await db.prepare('SELECT id FROM skin_purchases WHERE id=? AND account_id=? AND offer_id=?')
      .get(operationId, accountId, row.source === 'janitor-skins' ? 'janitor' : 'atelier');
    if (linked) operation = source(db, 'skin_purchases', operationId);
  } else if (row.source === CLUB_FINE_SOURCE && entry === 'bet') {
    paymentSource = CLUB_FINE_SOURCE;
    movement = 'fine';
    const prefix = CLUB_FINE_SOURCE + ':';
    const id = operationId.startsWith(prefix) ? operationId.slice(prefix.length) : '';
    if (SKIN_UUID.test(id) && await db.hasTable('club_fine_payments')) {
      const linked = await db.prepare(`SELECT operation_id FROM club_fine_payments
        WHERE account_id=? AND operation_id=? AND amount_cents::numeric=-?::numeric`).get(accountId, id, row.amount_units);
      if (linked) operation = source(db, 'club_fine_payments', JSON.stringify([accountId, id]));
    }
  } else if (row.source.startsWith('reward:') && entry === 'win' && operationId.startsWith('reward:')) {
    paymentSource = 'progression-reward';
    movement = 'reward';
    const id = operationId.slice('reward:'.length);
    if (await db.hasTable('progression_spin_uses')) {
      const linked = await db.prepare('SELECT operation_id FROM progression_spin_uses WHERE operation_id=? AND account_id=?')
        .get(id, accountId);
      if (linked) operation = source(db, 'progression_spin_uses', JSON.stringify([accountId, id]));
    }
  } else return null;
  return resolve(db, key, row, paymentSource, operation, movement, virtualAsset, row.amount_units, row.balance_units);
}

/** Read a committed canonical posting by its source row ID. Unsupported source kinds return null. */
export async function resolvePaymentPosting(db: PostgresDatabase, key: PaymentPostingKey): Promise<PaymentPostingResolution | null> {
  if (!sourceRowId(key.rowId)) return null;
  return readCommitted(db, async () => {
    switch (key.table) {
      case 'crypto_ledger': return resolveCrypto(db, key);
      case 'demo_ledger': return resolveDemo(db, key);
      case 'capro_pending_ledger': return resolvePending(db, key);
      default: return null;
    }
  });
}

/** Delivery evidence only. Never convert the returned reference into another posting. */
export async function resolvePaymentMirror(
  db: PostgresDatabase, key: { table: MirrorTable; eventId: string },
): Promise<PaymentMirror | null> {
  if (!/^[a-f0-9]{64}$/.test(key.eventId)) return null;
  return readCommitted(db, async () => {
    if (key.table === 'payment_credit_events') {
      const row = await db.prepare('SELECT event_id,user_id,payment_id FROM payment_credit_events WHERE event_id=?').get(key.eventId);
      return row ? { source: source(db, key.table, row.event_id), eventId: row.event_id, accountId: row.user_id,
        operationId: row.payment_id, state: 'applied' } : null;
    }
    if (key.table !== 'payment_outbox') return null;
    const row = await db.prepare(`SELECT sequence::text,user_id,body,delivered_at IS NOT NULL AS acknowledged
      FROM payment_outbox WHERE event_id=?`).get(key.eventId);
    if (!row) return null;
    let event: unknown;
    try {
      event = JSON.parse(String(row.body));
    } catch {
      return null;
    }
    if (!validPaymentEvent(event) || event.event_id !== key.eventId || event.user_id !== row.user_id) return null;
    return { source: source(db, key.table, row.sequence), eventId: key.eventId, accountId: event.user_id,
      operationId: event.payment_id, state: row.acknowledged ? 'acknowledged' : 'queued' };
  });
}
