import { identifier, type PostgresDatabase } from '../database';
import { FLAG_COUNTRIES } from '../../src/shared/flagBattle';
import { TOTE_GAME, settleFlagTote, toteEligible, toteOrder, toteUuid, type ToteMathTicket, type ToteSettlement } from '../../src/shared/flagTote';
import { auditSourceKey, isAuditRecord, type AuditEvent, type AuditScope, type AuditSourceRef } from './contract';

export const TOTE_ADMISSION_CLOCK = 'flag-tote-admission-clock';

type PoolState = 'open' | 'racing' | 'settled' | 'refunded';
type Finding = {
  status: 'mismatch' | 'insufficient-data';
  code: string;
  sources: AuditSourceRef[];
  expected?: string;
  observed?: string;
};

export type TotePoolReconciliation = {
  status: 'match' | 'mismatch' | 'insufficient-data';
  scope: AuditScope;
  source: AuditSourceRef;
  rulesVersion: string | null;
  state: PoolState | null;
  bankUnits: string | null;
  findings: Finding[];
};

type Ticket = ToteMathTicket & { payoutUnits: string | null };
type Posting = { id: string; accountId: string; operationId: string; entryType: string; amountUnits: string };
type Pool = {
  source: AuditSourceRef;
  rulesVersion: string;
  state: PoolState;
  openedAt: number;
  closesAt: number;
  outcome: unknown;
  settlement: unknown;
  tickets: Ticket[];
};
type Admission = { event: AuditEvent; source: AuditSourceRef };
type Dataset = { scope: AuditScope; sealed: boolean };
type DatasetEvidence = {
  postings: Posting[];
  missing: AuditSourceRef[];
  opening: Map<string, { principalUnits: string | null; source: AuditSourceRef }>;
  admissions: Admission[];
};
type SourceSchema = Pick<PostgresDatabase, 'schema'>;

const operation = (id: string) => TOTE_GAME + ':' + id;
const finalOperation = (pool: Pool) => operation(pool.source.rowId) + ':final';
const accountTicket = (account: string, ticket: string) => JSON.stringify([account, ticket]);
const ref = (db: SourceSchema, table: string, rowId: string): AuditSourceRef => ({ namespace: db.schema + '.' + table, rowId });
const relation = (db: SourceSchema, table: string) => identifier(db.schema) + '.' + identifier(table);
const integer = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

function fields(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mismatch(code: string, sources: AuditSourceRef[], expected?: string, observed?: string): Finding {
  return { status: 'mismatch', code, sources, ...(expected === undefined ? {} : { expected }),
    ...(observed === undefined ? {} : { observed }) };
}

function gap(code: string, sources: AuditSourceRef[]): Finding {
  return { status: 'insufficient-data', code, sources };
}

class CanonicalSourceUnavailable extends Error {}

async function readCanonical<T>(query: Promise<T>): Promise<T> {
  try { return await query; }
  catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code && ['42P01', '3F000', '42501'].includes(code)) {
      throw new CanonicalSourceUnavailable('Flag Tote source unavailable', { cause: error });
    }
    throw error;
  }
}

async function readPool(audit: PostgresDatabase, game: SourceSchema, poolId: string): Promise<Pool | null> {
  const round = await readCanonical(audit.prepare(`SELECT rules_version::text,opened_at,closes_at,state,outcome,settlement
    FROM ${relation(game, 'flag_tote_rounds')} WHERE id=?`).get(poolId));
  if (!round) return null;
  const tickets = await readCanonical(audit.prepare(`SELECT id,account_id AS "accountId",country,stake_units::text AS "stakeUnits",
    payout_units::text AS "payoutUnits" FROM ${relation(game, 'flag_tote_tickets')} WHERE round_id=? ORDER BY sequence`)
    .all(poolId)) as Ticket[];
  return { source: ref(game, 'flag_tote_rounds', poolId), rulesVersion: round.rules_version, state: round.state,
    openedAt: Number(round.opened_at), closesAt: Number(round.closes_at),
    outcome: parse(round.outcome), settlement: parse(round.settlement), tickets };
}

async function readEvidence(
  audit: PostgresDatabase, game: SourceSchema, dataset: Dataset, pool: Pool,
): Promise<DatasetEvidence | null> {
  const { datasetId, environment } = dataset.scope;
  const ledger = game.schema + '.demo_ledger';
  const ticketTable = game.schema + '.flag_tote_tickets';
  const operations = [finalOperation(pool), ...pool.tickets.map(ticket => operation(ticket.id))];
  const captured = await audit.prepare(`SELECT source_row_id::text AS id,account_id AS "accountId",operation_id AS "operationId",
    occurred_at_ms::text AS "occurredAtMs" FROM audit_posting_refs
    WHERE dataset_id=? AND source_namespace=? AND operation_id=ANY(?::text[]) ORDER BY source_row_id`)
    .all(datasetId, ledger, operations);
  const opening = new Map((await audit.prepare(`SELECT account_id,entity_id,principal_units::text
    FROM audit_opening_obligations WHERE dataset_id=? AND source_namespace=? AND entity_id=ANY(?::text[])`)
    .all(datasetId, ticketTable, pool.tickets.map(ticket => ticket.id))).map(row => [
    accountTicket(row.account_id, row.entity_id),
    { principalUnits: row.principal_units as string | null,
      source: ref(audit, 'audit_opening_obligations', JSON.stringify([datasetId, ticketTable, row.account_id, row.entity_id])) },
  ]));
  if (!captured.length && !opening.size) return null;
  const canonical = await readCanonical(audit.prepare(`SELECT id::text,account_id AS "accountId",operation_id AS "operationId",
    created_at::text AS "occurredAtMs",entry_type AS "entryType",amount_units::text AS "amountUnits"
    FROM ${relation(game, 'demo_ledger')} WHERE id=ANY(?::bigint[]) AND source=?`)
    .all(captured.map(row => row.id), TOTE_GAME));
  const byId = new Map(canonical.map(row => [row.id, row]));
  const postings: Posting[] = [], missing: AuditSourceRef[] = [];
  for (const capture of captured) {
    const row = byId.get(capture.id);
    if (row && row.accountId === capture.accountId && row.operationId === capture.operationId &&
      row.occurredAtMs === capture.occurredAtMs) {
      postings.push({ id: row.id, accountId: row.accountId, operationId: row.operationId,
        entryType: row.entryType, amountUnits: row.amountUnits });
    } else {
      missing.push(ref(game, 'demo_ledger', capture.id));
    }
  }
  const events = await audit.prepare(`SELECT evidence_id,account_id,occurred_at_ms,payload FROM audit_evidence
    WHERE dataset_id=? AND kind='event' AND payload->>'reasonCode'=?
      AND payload->'entity'->'source'->>'namespace'=? AND payload->'entity'->'source'->>'rowId'=?`)
    .all(datasetId, TOTE_ADMISSION_CLOCK, pool.source.namespace, pool.source.rowId);
  const admissions: Admission[] = [];
  for (const row of events) {
    const event: unknown = row.payload;
    if (!isAuditRecord(event) || event.type !== 'event' || event.event !== 'accepted' ||
      event.reasonCode !== TOTE_ADMISSION_CLOCK || event.eventId !== row.evidence_id ||
      event.accountId !== row.account_id || event.occurredAtMs !== row.occurred_at_ms ||
      event.scope.datasetId !== datasetId || event.scope.environment !== environment ||
      event.entity.category !== 'totalizator' || event.entity.gameId !== TOTE_GAME || event.entity.modeId !== 'pool' ||
      event.entity.rulesVersion !== pool.rulesVersion || auditSourceKey(event.entity.source) !== auditSourceKey(pool.source)) continue;
    admissions.push({ event, source: ref(audit, 'audit_evidence', JSON.stringify([datasetId, 'event', event.eventId])) });
  }
  return { postings, missing, opening, admissions };
}

function checkTicket(
  game: SourceSchema, pool: Pool, ticket: Ticket, evidence: DatasetEvidence, debits: Posting[],
  validWindow: boolean, findings: Finding[],
) {
  const source = ref(game, 'flag_tote_tickets', ticket.id);
  const postingRefs = debits.map(row => ref(game, 'demo_ledger', row.id));
  const expectedDebit = (-BigInt(ticket.stakeUnits)).toString();
  const opening = evidence.opening.get(accountTicket(ticket.accountId, ticket.id));
  const expectedCount = opening ? 0 : 1;
  if (opening?.principalUnits === null) findings.push(gap('opening-ticket-principal-unavailable', [source, opening.source]));
  else if (opening && opening.principalUnits !== ticket.stakeUnits) {
    findings.push(mismatch('opening-ticket-principal', [source, opening.source], opening.principalUnits, ticket.stakeUnits));
  }
  if (debits.length !== expectedCount) {
    findings.push(mismatch('ticket-debit-count', [source, ...postingRefs], String(expectedCount), String(debits.length)));
  } else if (debits.length && (debits[0].accountId !== ticket.accountId ||
    debits[0].entryType !== 'bet' || debits[0].amountUnits !== expectedDebit)) {
    findings.push(mismatch('ticket-debit', [source, ...postingRefs], expectedDebit, debits[0].amountUnits));
  }
  const capturedDebits = new Set(debits.filter(row => row.accountId === ticket.accountId && row.entryType === 'bet')
    .map(row => auditSourceKey(ref(game, 'demo_ledger', row.id))));
  const observations = evidence.admissions.filter(({ event }) =>
    event.accountId === ticket.accountId && event.entity.ticketId === ticket.id && event.operationId === ticket.id &&
    event.postings.length === 1 && capturedDebits.has(auditSourceKey(event.postings[0])));
  if (observations.length !== 1) {
    findings.push(gap(observations.length ? 'admission-clock-ambiguous' : 'admission-clock-unavailable', [source, ...observations.map(row => row.source)]));
  } else {
    const { event, source: clock } = observations[0];
    if (validWindow && (event.occurredAtMs < pool.openedAt || event.occurredAtMs >= pool.closesAt)) {
      findings.push(mismatch('ticket-outside-window', [source, clock, pool.source],
        '[' + pool.openedAt + ',' + pool.closesAt + ')', String(event.occurredAtMs)));
    }
  }
}

function expectedSettlement(pool: Pool, findings: Finding[]): ToteSettlement | null {
  const order = fields(pool.outcome)?.order;
  if (!toteOrder(order) && toteEligible(pool.tickets)) {
    findings.push(mismatch('pool-outcome', [pool.source]));
    return null;
  }
  try {
    return settleFlagTote(pool.tickets, toteOrder(order) ? order : FLAG_COUNTRIES.map(country => country.id));
  } catch {
    findings.push(mismatch('pool-tickets-invalid', [pool.source]));
    return null;
  }
}

function awardsMatch(stored: unknown, expected: ToteSettlement['awards']): boolean {
  return Array.isArray(stored) && stored.length === expected.length && expected.every((award, index) => {
    const entry = fields(stored[index]);
    return entry?.country === award.country && entry.place === award.place && entry.units === award.units;
  });
}

function checkSettlement(game: SourceSchema, pool: Pool, bankUnits: string, findings: Finding[]) {
  const expected = expectedSettlement(pool, findings);
  const settlement = fields(pool.settlement);
  if (settlement?.potUnits !== bankUnits) {
    findings.push(mismatch('pool-bank', [pool.source], bankUnits, integer(settlement?.potUnits) ? settlement.potUnits : undefined));
  }
  if (!expected) return;
  if (pool.state !== expected.state || settlement?.state !== expected.state || settlement.reason !== expected.reason) {
    findings.push(mismatch('pool-settlement-state', [pool.source], expected.state, pool.state));
  }
  if (settlement?.feeUnits !== expected.feeUnits) {
    findings.push(mismatch('pool-commission', [pool.source], expected.feeUnits, integer(settlement?.feeUnits) ? settlement.feeUnits : undefined));
  }
  if (!awardsMatch(settlement?.awards, expected.awards) || !Array.isArray(settlement?.payouts) || settlement.payouts.length !== 0) {
    findings.push(mismatch('pool-awards', [pool.source]));
  }
  const payout = new Map(expected.payouts.map(row => [row.id, row.units]));
  for (const ticket of pool.tickets) {
    const expectedUnits = payout.get(ticket.id)!;
    if (ticket.payoutUnits !== expectedUnits) {
      findings.push(mismatch(expected.state === 'refunded' ? 'ticket-refund' : 'ticket-payout',
        [ref(game, 'flag_tote_tickets', ticket.id)], expectedUnits, ticket.payoutUnits ?? undefined));
    }
  }
}

function checkCredits(game: SourceSchema, pool: Pool, finals: Posting[], findings: Finding[]) {
  const accounts = new Set([...pool.tickets.map(ticket => ticket.accountId), ...finals.map(row => row.accountId)]);
  for (const account of accounts) {
    const tickets = pool.tickets.filter(ticket => ticket.accountId === account);
    const rows = finals.filter(row => row.accountId === account);
    const refs = [pool.source, ...tickets.map(ticket => ref(game, 'flag_tote_tickets', ticket.id)),
      ...rows.map(row => ref(game, 'demo_ledger', row.id))];
    if (tickets.some(ticket => ticket.payoutUnits === null)) {
      findings.push(gap('ticket-payout-unavailable-for-credit', refs));
      continue;
    }
    const expected = tickets.reduce((total, ticket) => total + BigInt(ticket.payoutUnits!), 0n);
    const count = expected > 0n ? 1 : 0;
    if (rows.length !== count) findings.push(mismatch('pool-credit-count', refs, String(count), String(rows.length)));
    const observed = rows.reduce((total, row) => total + BigInt(row.amountUnits), 0n);
    if (expected !== observed || rows.some(row => row.entryType !== (pool.state === 'refunded' ? 'refund' : 'win'))) {
      findings.push(mismatch(pool.state === 'refunded' ? 'pool-refund-credit' : 'pool-payout-credit', refs,
        expected.toString(), observed.toString()));
    }
  }
}

/** Check an existing Flag Tote pool from committed data. This reader cannot admit or settle a ticket. */
export async function reconcileStoredTotePool(
  audit: PostgresDatabase, game: SourceSchema, datasetId: string, poolId: string,
): Promise<TotePoolReconciliation | null> {
  if (!toteUuid(datasetId) || !/^ft1-[0-9]{1,16}$/.test(poolId)) return null;
  // Both schemas are on the same PostgreSQL database. Compare only one committed view of the pool.
  let registeredScope: AuditScope | undefined;
  return audit.transaction(async () => {
    const row = await audit.prepare(`SELECT d.id::text,d.environment,d.sealed_at_ms FROM audit_datasets d
      JOIN audit_dataset_sources s ON s.dataset_id=d.id WHERE d.id=? AND s.source_namespace=?`)
      .get(datasetId, game.schema + '.demo_ledger');
    if (!row) return null;
    registeredScope = { datasetId: row.id, environment: row.environment };
    const dataset: Dataset = { scope: registeredScope, sealed: row.sealed_at_ms !== null };
    const pool = await readPool(audit, game, poolId);
    if (!pool) return null;
    const evidence = await readEvidence(audit, game, dataset, pool);
    if (!evidence) return null;
    const findings: Finding[] = [];
    const report = (state: PoolState | null, bankUnits: string | null): TotePoolReconciliation => ({
      status: findings.some(row => row.status === 'mismatch') ? 'mismatch' : findings.length ? 'insufficient-data' : 'match',
      scope: dataset.scope, source: pool.source, rulesVersion: pool.rulesVersion, state, bankUnits, findings,
    });
    if (pool.rulesVersion !== '1') {
      findings.push(gap('pool-rules-unsupported', [pool.source]));
      return report(null, null);
    }
    if (evidence.missing.length) {
      findings.push(gap('pool-canonical-postings-unavailable', [pool.source, ...evidence.missing]));
      return report(null, null);
    }
    const validWindow = Number.isSafeInteger(pool.openedAt) && Number.isSafeInteger(pool.closesAt) &&
      pool.openedAt >= 0 && pool.openedAt < pool.closesAt;
    if (!validWindow) findings.push(mismatch('pool-window-invalid', [pool.source]));
    const covered = pool.tickets.filter(ticket => evidence.opening.has(accountTicket(ticket.accountId, ticket.id)) ||
      evidence.postings.some(row => row.operationId === operation(ticket.id)));
    for (const ticket of covered) {
      checkTicket(game, pool, ticket, evidence, evidence.postings.filter(row => row.operationId === operation(ticket.id)),
        validWindow, findings);
    }
    if (covered.length !== pool.tickets.length) {
      findings.push(gap('pool-tickets-outside-dataset', [pool.source]));
      return report(null, null);
    }
    const bankUnits = pool.tickets.reduce((total, ticket) => total + BigInt(ticket.stakeUnits), 0n).toString();
    const finals = evidence.postings.filter(row => row.operationId === finalOperation(pool));
    if (pool.state === 'open' || pool.state === 'racing') {
      if (pool.settlement !== null || pool.tickets.some(ticket => ticket.payoutUnits !== null) || finals.length) {
        findings.push(mismatch('pool-premature-settlement', [pool.source]));
      }
      return report(pool.state, bankUnits);
    }
    if (dataset.sealed && pool.tickets.length > 0 && !finals.length) {
      findings.push(gap('pool-settlement-outside-dataset', [pool.source]));
      return report(null, bankUnits);
    }
    checkSettlement(game, pool, bankUnits, findings);
    checkCredits(game, pool, finals, findings);
    return report(pool.state, bankUnits);
  }, { readOnly: true }).catch(error => {
    if (!(error instanceof CanonicalSourceUnavailable) || !registeredScope) throw error;
    const source = ref(game, 'flag_tote_rounds', poolId);
    return { status: 'insufficient-data', scope: registeredScope, source, rulesVersion: null, state: null, bankUnits: null,
      findings: [gap('pool-source-unavailable', [source])] };
  });
}
