import { identifier, type PostgresDatabase } from '../database';
import { FLAG_COUNTRIES } from '../../src/shared/flagBattle';
import { TOTE_GAME, TOTE_LIMITS, settleFlagTote, toteCountry, toteOrder, toteUnits, toteUuid, type ToteMathTicket } from '../../src/shared/flagTote';
import { TOTE_ADMISSION_CLOCK, reconcileStoredTotePool, type TotePoolReconciliation } from './check-tote';
import { auditSourceKey, isAuditRecord, type AuditScope, type AuditSourceRef } from './contract';
import { auditToteMode } from './mode-registry';
import { createReplayPackage, isReplayId, type ReplayEvent, type ReplayManifest, type ReplayPackage, type ReplayState } from './replay-package';
import { AuditReplayStore } from './replay-store';

type Request = { datasetId: string; gameSchema: string; poolId: string; replayId: string };
type Ticket = ToteMathTicket & {
  sequence: number; payoutUnits: string | null; opening: boolean; debitId: string | null; debitUnits: string | null;
};
type Final = { id: string; accountId: string; units: string; entryType: string };
type Pool = { openedAtMs: number; closesAtMs: number; finishesAtMs: number; outcome: string | null; sealed: boolean };
type PoolEvidence = NonNullable<ReplayEvent['pool']>;
type Money = NonNullable<ReplayEvent['money']>[number];
type Gap = ReplayManifest['gaps'][number];
type BuildReason = 'not-captured' | 'unsupported' | 'source-unavailable' | 'inconsistent-source';
export type ToteReplayBuild = { status: 'built'; value: ReplayPackage } | { status: 'unavailable'; reason: BuildReason };

const unavailable = (reason: BuildReason): ToteReplayBuild => ({ status: 'unavailable', reason });
const countries = FLAG_COUNTRIES.map(country => country.id);
const entrant = (country: string) => countries.findIndex(id => id === country);
const entrants = countries.map((_, index) => index);
const ledger = (input: Request, id: string): AuditSourceRef => ({ namespace: input.gameSchema + '.demo_ledger', rowId: id });
const operation = (id: string) => TOTE_GAME + ':' + id;

function poolState(stage: number, phase: 'open' | 'settled' | 'cancelled' = 'open', ranking?: number[]): ReplayState {
  return { profile: 'pool-steps', stage, phase,
    remaining: ranking ? ranking.slice(-1) : [...entrants], eliminated: ranking?.slice(0, -1) ?? [] };
}

function action(code: 'advance' | 'ticket' | 'close' | 'allocate', ids: number[] = []): ReplayEvent['data'] {
  return { kind: 'action', action: { profile: 'pool-steps', code, entrants: ids } };
}

function collect(
  events: ReplayEvent[], data: ReplayEvent['data'], pool: PoolEvidence, postings: AuditSourceRef[] = [], money?: Money,
) {
  events.push({ sequence: events.length + 1, atMs: 0, data, pool, postings, ...(money ? { money: [money] } : {}) });
}

function savedOrder(raw: string | null) {
  if (!raw) return null;
  try {
    const order: unknown = JSON.parse(raw)?.order;
    return toteOrder(order) ? order : null;
  } catch {
    return null;
  }
}

async function readPool(audit: PostgresDatabase, input: Request): Promise<Pool | null> {
  const game = identifier(input.gameSchema);
  const row = await audit.prepare(`SELECT p.opened_at,p.closes_at,p.finishes_at,p.outcome,d.sealed_at_ms
    FROM ${game}.flag_tote_rounds p CROSS JOIN audit_datasets d WHERE p.id=? AND d.id=?`).get(input.poolId, input.datasetId);
  if (!row) return null;
  const [openedAtMs, closesAtMs, finishesAtMs] = [row.opened_at, row.closes_at, row.finishes_at];
  if (![openedAtMs, closesAtMs, finishesAtMs].every(time => Number.isSafeInteger(time) && time >= 0)
    || openedAtMs >= closesAtMs || closesAtMs >= finishesAtMs) return null;
  return { openedAtMs, closesAtMs, finishesAtMs, outcome: row.outcome, sealed: row.sealed_at_ms !== null };
}

async function readTickets(audit: PostgresDatabase, input: Request): Promise<Ticket[]> {
  const game = identifier(input.gameSchema);
  // Both the canonical posting identity and its captured identity must agree.
  return await audit.prepare(`SELECT t.id,t.sequence,t.account_id AS "accountId",t.country,t.stake_units::text AS "stakeUnits",
      t.payout_units::text AS "payoutUnits",o.entity_id IS NOT NULL AS opening,l.id::text AS "debitId",l.amount_units::text AS "debitUnits"
    FROM ${game}.flag_tote_tickets t
    LEFT JOIN audit_opening_obligations o ON o.dataset_id=? AND o.source_namespace=? AND o.account_id=t.account_id AND o.entity_id=t.id
    LEFT JOIN audit_posting_refs r ON r.dataset_id=? AND r.source_namespace=? AND r.account_id=t.account_id
      AND r.operation_id='flag-tote:'||t.id
    LEFT JOIN ${game}.demo_ledger l ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
      AND l.created_at=r.occurred_at_ms AND l.source='flag-tote' AND l.entry_type='bet'
    WHERE t.round_id=? AND (o.entity_id IS NOT NULL OR l.id IS NOT NULL) ORDER BY t.sequence LIMIT ?`)
    .all(input.datasetId, input.gameSchema + '.flag_tote_tickets', input.datasetId, ledger(input, '').namespace,
      input.poolId, TOTE_LIMITS.maxTickets + 1) as Ticket[];
}

async function readFinals(audit: PostgresDatabase, input: Request): Promise<Final[]> {
  const game = identifier(input.gameSchema);
  return await audit.prepare(`SELECT l.id::text,l.account_id AS "accountId",l.amount_units::text AS units,l.entry_type AS "entryType"
    FROM audit_posting_refs r JOIN ${game}.demo_ledger l ON l.id=r.source_row_id AND l.account_id=r.account_id
      AND l.operation_id=r.operation_id AND l.created_at=r.occurred_at_ms AND l.source='flag-tote'
    WHERE r.dataset_id=? AND r.source_namespace=? AND r.operation_id=? ORDER BY r.source_row_id LIMIT ?`)
    .all(input.datasetId, ledger(input, '').namespace, operation(input.poolId) + ':final', TOTE_LIMITS.maxTickets + 1) as Final[];
}

async function admissionClocks(audit: PostgresDatabase, input: Request, scope: AuditScope, tickets: Ticket[]) {
  const namespace = input.gameSchema + '.flag_tote_rounds';
  const rows = await audit.prepare(`SELECT evidence_id,account_id,occurred_at_ms,payload FROM audit_evidence
    WHERE dataset_id=? AND kind='event' AND payload->>'reasonCode'=?
      AND payload->'entity'->'source'->>'namespace'=? AND payload->'entity'->'source'->>'rowId'=? LIMIT ?`)
    .all(input.datasetId, TOTE_ADMISSION_CLOCK, namespace, input.poolId, TOTE_LIMITS.maxTickets * 2 + 1);
  const byTicket = new Map(tickets.map(ticket => [ticket.id, ticket]));
  const clocks = new Map<string, number | null>();
  if (rows.length > TOTE_LIMITS.maxTickets * 2) return clocks;
  for (const row of rows) {
    const event: unknown = row.payload;
    if (!isAuditRecord(event) || event.type !== 'event' || event.event !== 'accepted' || event.eventId !== row.evidence_id
      || event.reasonCode !== TOTE_ADMISSION_CLOCK || event.scope.datasetId !== scope.datasetId
      || event.scope.environment !== scope.environment || event.accountId !== row.account_id
      || event.occurredAtMs !== row.occurred_at_ms || event.entity.category !== 'totalizator'
      || event.entity.gameId !== TOTE_GAME || event.entity.modeId !== 'pool' || event.entity.rulesVersion !== '1'
      || event.entity.source.namespace !== namespace || event.entity.source.rowId !== input.poolId) continue;
    const ticket = event.entity.ticketId && byTicket.get(event.entity.ticketId);
    if (!ticket || ticket.opening || !ticket.debitId || event.operationId !== ticket.id || event.accountId !== ticket.accountId
      || event.postings.length !== 1 || auditSourceKey(event.postings[0]) !== auditSourceKey(ledger(input, ticket.debitId))) continue;
    clocks.set(ticket.id, clocks.has(ticket.id) ? null : event.occurredAtMs);
  }
  return clocks;
}

function validTickets(tickets: Ticket[]): boolean {
  return tickets.length > 0 && tickets.length <= TOTE_LIMITS.maxTickets
    && new Set(tickets.map(ticket => ticket.sequence)).size === tickets.length
    && tickets.every(ticket => toteUuid(ticket.id) && toteCountry(ticket.country) && toteUnits(ticket.stakeUnits)
      && ticket.stakeUnits !== '0' && Number.isSafeInteger(ticket.sequence) && ticket.sequence >= 1 && ticket.sequence <= TOTE_LIMITS.maxTickets
      && (ticket.opening ? ticket.debitId === null : !!ticket.debitId && ticket.debitUnits === '-' + ticket.stakeUnits));
}

function collectSettlement(
  input: Request, report: TotePoolReconciliation, tickets: Ticket[], pool: Pool,
  finals: Final[], slots: Map<string, number>, events: ReplayEvent[],
): boolean {
  const refunded = report.state === 'refunded', order = refunded ? null : savedOrder(pool.outcome);
  if (!refunded && !order) return false;
  let result;
  try { result = settleFlagTote(tickets, order ?? countries); } catch { return false; }
  if (result.state !== report.state || result.potUnits !== report.bankUnits) return false;

  const allocation = new Map(result.payouts.map(row => [row.id, row.units]));
  const aggregate = new Map<string, bigint>();
  for (const ticket of tickets) {
    const units = allocation.get(ticket.id);
    if (units === undefined || units !== ticket.payoutUnits) return false;
    aggregate.set(ticket.accountId, (aggregate.get(ticket.accountId) ?? 0n) + BigInt(units));
  }
  const movement = refunded ? 'refund' : 'payout';
  const postingByAccount = new Map(finals.map(row => [row.accountId, ledger(input, row.id)]));
  if (finals.length !== postingByAccount.size || finals.length !== [...aggregate.values()].filter(units => units > 0n).length
    || finals.some(row => aggregate.get(row.accountId)?.toString() !== row.units || row.entryType !== (refunded ? 'refund' : 'win'))) return false;

  for (const award of result.awards) {
    collect(events, action('allocate', [entrant(award.country)]), { kind: 'award', ...award });
  }
  for (const ticket of tickets) {
    const units = allocation.get(ticket.id)!;
    const posting = units === '0' ? null : postingByAccount.get(ticket.accountId);
    if (units !== '0' && !posting) return false;
    collect(events, action('allocate', [entrant(ticket.country)]), { kind: 'allocation', ticketId: ticket.id,
      ordinal: ticket.sequence, accountSlot: slots.get(ticket.accountId)!, units }, posting ? [posting] : []);
  }
  for (const final of finals) {
    const posting = postingByAccount.get(final.accountId)!;
    collect(events, action('allocate'), { kind: 'aggregate', accountSlot: slots.get(final.accountId)! },
      [posting], { movement, units: final.units, posting });
  }
  collect(events, { kind: 'terminal', state: poolState(3, refunded ? 'cancelled' : 'settled', order?.map(entrant)),
    outcome: refunded ? 'cancelled' : 'settled', winnerSeat: null },
  { kind: 'result', bankUnits: result.potUnits, feeUnits: result.feeUnits, reason: result.reason });
  return true;
}

/** Project only an authorized pool in a single committed snapshot. This path never admits, advances, or settles tickets. */
export async function buildCapturedToteReplay(audit: PostgresDatabase, input: Request): Promise<ToteReplayBuild> {
  if (!isReplayId(input.replayId) || !isReplayId(input.datasetId) || !/^ft1-[0-9]{1,16}$/.test(input.poolId)
    || !/^[a-z_][a-z0-9_]{0,62}$/.test(input.gameSchema) || input.gameSchema === audit.schema) return unavailable('not-captured');
  return audit.transaction(async () => {
    const report = await reconcileStoredTotePool(audit, { schema: input.gameSchema }, input.datasetId, input.poolId);
    if (!report) return unavailable('not-captured');
    if (report.status === 'mismatch') return unavailable('inconsistent-source');
    if (report.findings.some(finding => ['pool-source-unavailable', 'pool-canonical-postings-unavailable'].includes(finding.code))) {
      return unavailable('source-unavailable');
    }
    if (report.rulesVersion !== '1') return unavailable('unsupported');
    const pool = await readPool(audit, input);
    const tickets = await readTickets(audit, input);
    if (!pool || !validTickets(tickets)) return unavailable('source-unavailable');
    const clocks = await admissionClocks(audit, input, report.scope, tickets);
    const events: ReplayEvent[] = [];
    collect(events, action('advance'), { kind: 'window', poolId: input.poolId,
      openedAtMs: pool.openedAtMs, closesAtMs: pool.closesAtMs, finishesAtMs: pool.finishesAtMs });
    const slots = new Map<string, number>();
    for (const ticket of tickets) {
      if (!slots.has(ticket.accountId)) slots.set(ticket.accountId, slots.size + 1);
      const posting = ticket.debitId === null ? null : ledger(input, ticket.debitId);
      collect(events, action('ticket', [entrant(ticket.country)]), { kind: 'ticket', ticketId: ticket.id,
        ordinal: ticket.sequence, accountSlot: slots.get(ticket.accountId)!, country: ticket.country, stakeUnits: ticket.stakeUnits,
        admittedAtMs: clocks.get(ticket.id) ?? null, opening: ticket.opening }, posting ? [posting] : [],
      posting ? { movement: 'stake', units: ticket.debitUnits!, posting } : undefined);
    }
    const terminal = report.state === 'settled' || report.state === 'refunded';
    if (terminal || report.state === 'racing' && !pool.sealed) {
      collect(events, action('close'), { kind: 'cutoff', closesAtMs: pool.closesAtMs });
    }
    if (terminal && !collectSettlement(input, report, tickets, pool, await readFinals(audit, input), slots, events)) {
      return unavailable('inconsistent-source');
    }
    const gaps: Gap[] = [];
    if (tickets.some(ticket => clocks.get(ticket.id) == null)) gaps.push('admission-time-unavailable');
    const missingTicket = tickets.some((ticket, index) => ticket.sequence !== index + 1);
    if (missingTicket || report.findings.some(finding =>
      !['admission-clock-unavailable', 'admission-clock-ambiguous'].includes(finding.code))) gaps.push('event-gap');
    if (!terminal) gaps.push('terminal-unavailable');
    return { status: 'built', value: createReplayPackage({
      formatVersion: 3, timing: 'source-order', scope: report.scope, replayId: input.replayId, entityId: input.poolId,
      game: { ...auditToteMode, gameVersion: 'server-rules-1', engineId: 'flag-tote', engineVersion: '1' },
      initial: poolState(0), coverage: gaps.length ? 'partial' : 'complete', gaps,
    }, events) };
  }, { readOnly: true });
}

export async function persistCapturedToteReplay(audit: PostgresDatabase, input: Request) {
  const built = await buildCapturedToteReplay(audit, input);
  if (built.status !== 'built') return built;
  const store = new AuditReplayStore(audit), { manifest, fragments } = built.value;
  const header = await store.writeManifest(manifest);
  if (header !== 'recorded' && header !== 'replayed') return { status: 'write-failed' as const, reason: header };
  for (const fragment of fragments) {
    const result = await store.writeFragment(manifest.scope, manifest.replayId, fragment);
    if (result !== 'recorded' && result !== 'replayed') return { status: 'write-failed' as const, reason: result };
  }
  return { status: 'stored' as const, coverage: manifest.coverage, replayId: manifest.replayId };
}
