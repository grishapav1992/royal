import { identifier, type PostgresDatabase } from '../database';
import { TOTE_GAME, TOTE_LIMITS, TOTE_STAKES, TOTE_TIMING, toteCountry, toteUuid } from '../../src/shared/flagTote';
import { TOTE_ADMISSION_CLOCK } from './check-tote';
import { auditSourceKey, isAuditRecord, type AuditAsset, type AuditEvent, type AuditSourceRef } from './contract';
import type { AuditRiskEvidence, AuditRiskRule } from './risk-rules';
import { RISK_WINDOW_MS, riskAccounts, riskCandidate, riskSourceBoundaries,
  type AuditRiskCandidate, type AuditRiskSelection } from './risk-selection';

const finalWindowMs = 1000;
const synchronizationMs = 200;
const cutoffBandMs = 250;
const maxSelectedTickets = 2048;
const asset: AuditAsset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 };
const segment = 'flag-tote:rules-1:exact-pool:cutoff-1000:band-250:sync-200:country-share';
export const TOTE_SYNCHRONIZED_PAIR: AuditRiskRule = {
  id: 'tote-synchronized-pair', version: '1', metric: 'rate', windowMs: RISK_WINDOW_MS,
  sample: { selector: 'flag-tote-verified-admission-pair', minSubject: 3, minComparison: 3, minComparisonAccounts: 1, maxObservations: 512 },
  threshold: { absolute: { numerator: '2', denominator: '3' }, comparisonMultiple: { numerator: '2', denominator: '1' } },
  cohort: { id: 'same-pool-same-country-share-paired-accounts', version: '1' },
};

type Pair = [string, string];
type Pool = { id: string; openedAt: number; closesAt: number; size: number; countryCounts: Map<string, number>; complete: boolean };
type Ticket = {
  id: string; poolId: string; ordinal: number; accountId: string; country: string; stakeUnits: string;
  postingId: string | null; capturedAt: number | null; amountUnits: string | null;
};
type Admission = { ticket: Ticket; event: AuditEvent; posting: AuditRiskEvidence & { kind: 'posting' } };
type PoolSample = { admissions: Map<string, Admission[]>; missing: Set<string>; outsideWindow: Admission[] };
type CandidateRow = Parameters<typeof riskCandidate>[4][number];
type Observation = { row: CandidateRow; popularity: 'rare' | 'common' | 'popular'; cutoffBand: number };
type Finding = { code: string; source: AuditSourceRef; postings: AuditSourceRef[] };

const poolKey = (openedAt: number) => 'ft1-' + openedAt;
const stakeOperation = (ticketId: string) => TOTE_GAME + ':' + ticketId;
const ledger = (selection: AuditRiskSelection) => selection.gameSchema + '.demo_ledger';

function pairs(accounts: string[]): Pair[] {
  const sorted = [...accounts].sort();
  return sorted.flatMap((account, index) => sorted.slice(index + 1).map((peer): Pair => [account, peer]));
}

function comparisonPairs(accounts: string[]): Pair[] {
  const sorted = [...accounts].sort(), result: Pair[] = [];
  for (let index = 0; index + 1 < sorted.length; index += 2) result.push([sorted[index], sorted[index + 1]]);
  return result;
}

function poolIds(fromMs: number, toMs: number): string[] {
  const ids: string[] = [];
  for (let time = Math.ceil(fromMs / TOTE_TIMING.period) * TOTE_TIMING.period;
    time + TOTE_TIMING.betting <= toMs; time += TOTE_TIMING.period) ids.push(poolKey(time));
  return ids;
}

async function readPools(audit: PostgresDatabase, selection: AuditRiskSelection, ids: string[], accounts: string[]) {
  const game = identifier(selection.gameSchema);
  const rows = await audit.prepare(`SELECT p.id,p.opened_at,p.closes_at,p.rules_version FROM ${game}.flag_tote_rounds p
    WHERE p.id=ANY(?::text[]) AND EXISTS (SELECT 1 FROM ${game}.flag_tote_tickets t
      WHERE t.round_id=p.id AND t.account_id=ANY(?::text[])) ORDER BY p.opened_at,p.id`).all(ids, accounts);
  const pools = new Map<string, Pool>();
  let complete = true;
  for (const row of rows) {
    if (row.rules_version !== 1 || !Number.isSafeInteger(row.opened_at) || !Number.isSafeInteger(row.closes_at)
      || row.id !== poolKey(row.opened_at) || row.opened_at % TOTE_TIMING.period !== 0
      || row.closes_at !== row.opened_at + TOTE_TIMING.betting) {
      complete = false;
      continue;
    }
    pools.set(row.id, { id: row.id, openedAt: row.opened_at, closesAt: row.closes_at,
      size: 0, countryCounts: new Map(), complete: true });
  }
  if (!pools.size) return { pools, complete };
  const context = await audit.prepare(`SELECT t.round_id,t.country,count(*)::int AS tickets,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM audit_posting_refs r JOIN ${game}.demo_ledger l
        ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
        AND l.created_at=r.occurred_at_ms AND l.source='flag-tote' AND l.entry_type='bet' AND l.amount_units=-t.stake_units
        WHERE r.dataset_id=? AND r.source_namespace=? AND r.account_id=t.account_id
        AND r.operation_id='flag-tote:'||t.id))::int AS captured
    FROM ${game}.flag_tote_tickets t WHERE t.round_id=ANY(?::text[]) GROUP BY t.round_id,t.country`)
    .all(selection.scope.datasetId, ledger(selection), [...pools.keys()]);
  for (const row of context) {
    const pool = pools.get(row.round_id)!;
    if (!toteCountry(row.country) || row.tickets !== row.captured) pool.complete = false;
    pool.size += row.tickets;
    pool.countryCounts.set(row.country, row.tickets);
  }
  for (const pool of pools.values()) if (pool.size < 1 || pool.size > TOTE_LIMITS.maxTickets) pool.complete = false;
  return { pools, complete };
}

async function readTickets(audit: PostgresDatabase, selection: AuditRiskSelection, ids: string[], accounts: string[]) {
  const game = identifier(selection.gameSchema);
  return await audit.prepare(`SELECT t.id,t.round_id AS "poolId",t.sequence AS ordinal,t.account_id AS "accountId",
    t.country,t.stake_units::text AS "stakeUnits",l.id::text AS "postingId",r.occurred_at_ms AS "capturedAt",
    l.amount_units::text AS "amountUnits" FROM ${game}.flag_tote_tickets t
    LEFT JOIN audit_posting_refs r ON r.dataset_id=? AND r.source_namespace=? AND r.account_id=t.account_id
      AND r.operation_id='flag-tote:'||t.id
    LEFT JOIN ${game}.demo_ledger l ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
      AND l.created_at=r.occurred_at_ms AND l.source='flag-tote' AND l.entry_type='bet'
    WHERE t.round_id=ANY(?::text[]) AND t.account_id=ANY(?::text[]) LIMIT ?`)
    .all(selection.scope.datasetId, ledger(selection), ids, accounts, maxSelectedTickets + 1) as Ticket[];
}

function canonicalPosting(selection: AuditRiskSelection, ticket: Ticket): Admission['posting'] | null {
  if (!toteUuid(ticket.id) || !toteCountry(ticket.country) || !(TOTE_STAKES as readonly string[]).includes(ticket.stakeUnits)
    || !ticket.postingId || !/^[1-9][0-9]{0,18}$/.test(ticket.postingId)
    || ticket.amountUnits !== '-' + ticket.stakeUnits || ticket.capturedAt === null || !Number.isSafeInteger(ticket.capturedAt)
    || ticket.capturedAt < 0 || ticket.capturedAt > selection.asOfMs) return null;
  return { kind: 'posting', source: { namespace: ledger(selection), rowId: ticket.postingId },
    accountId: ticket.accountId, operationId: stakeOperation(ticket.id), occurredAtMs: ticket.capturedAt };
}

async function readAdmissions(
  audit: PostgresDatabase, selection: AuditRiskSelection, tickets: Ticket[], pools: Map<string, Pool>, accounts: string[],
): Promise<Map<string, PoolSample> | null> {
  const rows = await audit.prepare(`SELECT evidence_id,account_id,occurred_at_ms,payload FROM audit_evidence
    WHERE dataset_id=? AND account_id=ANY(?::text[]) AND occurred_at_ms>=? AND occurred_at_ms<? AND occurred_at_ms<=?
      AND kind='event' AND payload->>'reasonCode'=? AND octet_length(payload::text)<=4096 LIMIT ?`)
    .all(selection.scope.datasetId, accounts, selection.fromMs, selection.toMs, selection.asOfMs, TOTE_ADMISSION_CLOCK, maxSelectedTickets * 2 + 1);
  if (rows.length > maxSelectedTickets * 2) return null;
  const namespace = selection.gameSchema + '.flag_tote_rounds';
  const byId = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    const group = byId.get(ticket.id);
    if (group) group.push(ticket);
    else byId.set(ticket.id, [ticket]);
  }
  const verified = new Map<string, Admission | null>();
  for (const row of rows) {
    const event: unknown = row.payload;
    if (!isAuditRecord(event) || event.type !== 'event' || event.event !== 'accepted' || event.reasonCode !== TOTE_ADMISSION_CLOCK
      || event.eventId !== row.evidence_id || event.accountId !== row.account_id || event.occurredAtMs !== row.occurred_at_ms
      || event.scope.datasetId !== selection.scope.datasetId || event.scope.environment !== selection.scope.environment
      || event.entity.category !== 'totalizator' || event.entity.gameId !== TOTE_GAME || event.entity.modeId !== 'pool'
      || event.entity.rulesVersion !== '1' || event.entity.source.namespace !== namespace || !event.entity.ticketId) continue;
    const candidates = byId.get(event.entity.ticketId);
    if (candidates?.length !== 1) continue;
    const [ticket] = candidates, pool = pools.get(ticket.poolId)!;
    const posting = canonicalPosting(selection, ticket);
    if (!posting || event.accountId !== ticket.accountId || event.operationId !== ticket.id || event.entity.source.rowId !== pool.id
      || event.postings.length !== 1 || auditSourceKey(event.postings[0]) !== auditSourceKey(posting.source)) continue;
    verified.set(ticket.id, verified.has(ticket.id) ? null : { ticket, event, posting });
  }
  const samples = new Map<string, PoolSample>();
  for (const [id, [ticket]] of byId) {
    let sample = samples.get(ticket.poolId);
    if (!sample) {
      sample = { admissions: new Map(), missing: new Set(), outsideWindow: [] };
      samples.set(ticket.poolId, sample);
    }
    const admission = verified.get(id);
    const pool = pools.get(ticket.poolId)!;
    if (!admission || admission.event.occurredAtMs < pool.openedAt || admission.event.occurredAtMs >= pool.closesAt) {
      sample.missing.add(ticket.accountId);
      if (admission) sample.outsideWindow.push(admission);
      continue;
    }
    const accepted = sample.admissions.get(ticket.accountId);
    if (accepted) accepted.push(admission);
    else sample.admissions.set(ticket.accountId, [admission]);
  }
  return samples;
}

function eventRef(event: AuditEvent): AuditRiskEvidence {
  return { kind: 'event', id: event.eventId, accountId: event.accountId,
    operationId: event.operationId, occurredAtMs: event.occurredAtMs };
}

function observe(pool: Pool, sample: PoolSample, pair: Pair): Observation | null {
  const accepted = pair.flatMap(account => sample.admissions.get(account) ?? [])
    .sort((a, b) => b.event.occurredAtMs - a.event.occurredAtMs || a.ticket.ordinal - b.ticket.ordinal);
  const near = accepted.filter(admission => admission.event.occurredAtMs >= pool.closesAt - finalWindowMs);
  if (!near.length) return null;
  const anchor = near.find((admission, index) => near.slice(index + 1).some(peer => peer.ticket.accountId !== admission.ticket.accountId
    && admission.event.occurredAtMs - peer.event.occurredAtMs <= synchronizationMs));
  const primary = anchor ?? near[0];
  const peer = accepted.find(admission => admission.ticket.accountId !== primary.ticket.accountId
    && (!anchor || admission.event.occurredAtMs <= primary.event.occurredAtMs
      && primary.event.occurredAtMs - admission.event.occurredAtMs <= synchronizationMs));
  const popularity = pool.countryCounts.get(primary.ticket.country)!;
  return { popularity: popularity * 10 <= pool.size ? 'rare' : popularity * 3 <= pool.size ? 'common' : 'popular',
    cutoffBand: Math.floor((pool.closesAt - 1 - primary.event.occurredAtMs) / cutoffBandMs),
    row: { primary: eventRef(primary.event), entity: primary.event.entity, matched: !!anchor,
      supporting: [primary.posting, ...(peer ? [eventRef(peer.event), peer.posting] : [])] } };
}

/** One row per pool and fixed pair, with controls drawn from the same pool and country popularity band. */
export async function selectToteRisk(audit: PostgresDatabase, selection: AuditRiskSelection): Promise<AuditRiskCandidate[]> {
  const accounts = riskAccounts(selection), subjects = pairs(selection.subjectAccountIds);
  const comparisons = comparisonPairs(selection.comparisonAccountIds);
  const candidate = (pair: Pair, rows: CandidateRow[], subject: boolean, comparison: boolean, financialFindings: Finding[] = []): AuditRiskCandidate =>
    ({ ...riskCandidate({ ...selection, subjectAccountIds: pair }, TOTE_SYNCHRONIZED_PAIR, segment, asset, rows, { subject, comparison }),
      ...(financialFindings.length ? { financialFindings } : {}) });
  const incomplete = () => subjects.map(pair => candidate(pair, [], false, false));
  return audit.transaction(async () => {
    const boundaries = await riskSourceBoundaries(audit, selection);
    if (!subjects.length) return [];
    const from = Math.max(selection.fromMs, boundaries.startedAtMs);
    const to = Math.min(selection.toMs, selection.asOfMs, boundaries.sealedAtMs ?? selection.toMs);
    const { pools, complete } = await readPools(audit, selection, poolIds(from, to), accounts);
    selection.signal?.throwIfAborted();
    const tickets = await readTickets(audit, selection, [...pools.keys()], accounts);
    if (tickets.length > maxSelectedTickets) return incomplete();
    selection.signal?.throwIfAborted();
    const samples = await readAdmissions(audit, selection, tickets, pools, accounts);
    if (!samples) return incomplete();
    selection.signal?.throwIfAborted();
    const baseline = boundaries.wholeWindow && complete;
    return subjects.map(pair => {
      const rows: CandidateRow[] = [], findings: Finding[] = [];
      let subject = baseline, comparison = baseline && comparisons.length > 0 && selection.comparisonAccountIds.length % 2 === 0;
      for (const [id, sample] of samples) {
        const pool = pools.get(id)!;
        const hasSubject = pair.some(account => sample.admissions.has(account) || sample.missing.has(account));
        if (!hasSubject) continue;
        for (const admission of sample.outsideWindow) {
          if (pair.includes(admission.ticket.accountId)) findings.push({ code: 'ticket-outside-window',
            source: { namespace: audit.schema + '.audit_evidence',
              rowId: JSON.stringify([selection.scope.datasetId, 'event', admission.event.eventId]) },
            postings: [admission.posting.source] });
        }
        if (!pool.complete || pair.some(account => sample.missing.has(account))) subject = false;
        if (!pool.complete) continue;
        const observation = observe(pool, sample, pair);
        if (!observation) continue;
        rows.push(observation.row);
        if (comparisons.some(group => group.some(account => sample.missing.has(account)))) comparison = false;
        // At most one control per pool, independent of its classification.
        const control = comparisons.map(group => observe(pool, sample, group)).find(control =>
          control?.popularity === observation.popularity && control.cutoffBand === observation.cutoffBand);
        if (control) rows.push(control.row);
      }
      return candidate(pair, rows, subject, comparison, findings);
    });
  }, { readOnly: true }).catch(error => {
    const code = (error as { code?: string } | null)?.code;
    if (code && ['42P01', '3F000', '42501', '57014'].includes(code)) return incomplete();
    throw error;
  });
}
