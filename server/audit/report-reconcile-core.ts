import { identifier, type PostgresDatabase } from '../database';
import { checkAuditStakeDirection, reconcileAuditBalance, reconcileStoredAuditAttempt, type AuditBalanceEntry, type AuditBalanceStream } from './check-balances';
import { checkCapturedCasinoRound } from './check-casino';
import { reconcileStoredPayment } from './check-payments';
import { reconcileStoredPvpMatch } from './check-pvp';
import { reconcileStoredAuditOperation } from './check-repeats';
import { reconcileStoredTotePool } from './check-tote';
import { auditSourceKey, isAuditEntityRef, isAuditRecord, type AuditAsset, type AuditEntityRef, type AuditPosting,
  type AuditScope, type AuditSourceRef } from './contract';
import type { AuditSourceSchemas } from './datasets';
import { auditCommandRoutes } from './intents';
import { isReplayId } from './replay-package';
import { AuditReplayStore } from './replay-store';

type Rule = 'R-01' | 'R-02' | 'R-03' | 'R-04' | 'R-05' | 'R-06' | 'payment' | 'replay';
type Reference = { rule: Rule; code: string; sources: AuditSourceRef[] };
type Finding = Reference & { status: 'match' | 'mismatch' | 'pending'; expected?: string; observed?: string };
export type ReadyAuditReconciliation = {
  status: 'ready';
  schemaVersion: 1;
  scope: AuditScope;
  anchor: AuditSourceRef;
  accountId: string;
  operationId: string;
  occurredAtMs: number;
  entity: AuditEntityRef | null;
  requiredSources: string[];
  findings: Finding[];
  coverage: Reference[];
  evidence: AuditSourceRef[];
  replayIds: string[];
};
export type AuditReconciliation = ReadyAuditReconciliation | { status: 'not-found' } | { status: 'unsupported' };

type Ledger = 'demo_ledger' | 'capro_pending_ledger' | 'crypto_ledger';
type Adapter = { ledger: Ledger; namespace: string; sql: string; asset: AuditAsset; components: AuditBalanceStream['component'][] };
type Capture = { account_id: string; operation_id: string; occurred_at_ms: number };
type SourceRow = Capture & {
  row_id: string; present: boolean; entry: string | null; game: string | null;
  available_delta: string | null; available_after: string | null; reserved_delta: string | null;
  reserved_after: string | null; pending_delta: string | null; pending_after: string | null;
};
type Recorder = {
  add(rule: Rule, status: Finding['status'] | 'insufficient-data', code: string, refs?: AuditSourceRef[],
    expected?: string | null, observed?: string | null): void;
  link(ref: AuditSourceRef): void;
};

const maxChain = 128;
const maxAttempts = 24;
const maxResults = 96;
const maxRefs = 128;
const maxReplayCandidates = 4;
const virtual: AuditAsset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 };
const usdt: AuditAsset = { contour: 'real', code: 'USDT', scale: 6 };
const name = (value: string) => /^[a-z_][a-z_0-9]{0,62}$/.test(value);
const units = (value: unknown): value is string => typeof value === 'string' && /^(0|-?[1-9][0-9]{0,77})$/.test(value);
const rowId = (value: string) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const source = (namespace: string, key: string): AuditSourceRef => ({ namespace, rowId: key });

function adapter(schema: string, ledger: Ledger): Adapter {
  const table = identifier(schema) + '.' + identifier(ledger);
  const fields = ledger === 'demo_ledger'
    ? "entry_type AS entry,source AS game,amount_units::text AS available_delta,balance_units::text AS available_after"
    : ledger === 'capro_pending_ledger'
      ? "reason AS entry,'casinoapipro'::text AS game,'0'::text AS available_delta,NULL::text AS available_after"
      : "entry_key AS entry,NULL::text AS game,available_delta::text,balance_units::text AS available_after";
  const reserved = ledger === 'crypto_ledger' ? 'reserved_delta::text,reserved_units::text AS reserved_after'
    : 'NULL::text AS reserved_delta,NULL::text AS reserved_after';
  const pending = ledger === 'capro_pending_ledger' ? 'amount_units::text AS pending_delta,pending_balance_units::text AS pending_after'
    : 'NULL::text AS pending_delta,NULL::text AS pending_after';
  return { ledger, namespace: schema + '.' + ledger, asset: ledger === 'crypto_ledger' ? usdt : virtual,
    components: ledger === 'demo_ledger' ? ['available'] : ledger === 'crypto_ledger' ? ['available', 'reserved'] : ['pending'],
    sql: `SELECT id,${fields},${reserved},${pending} FROM ${table}
      WHERE id=r.source_row_id AND account_id=r.account_id AND operation_id=r.operation_id AND created_at=r.occurred_at_ms LIMIT 1` };
}

function readCaptured(audit: PostgresDatabase, ledger: Adapter, filter: string) {
  return audit.prepare(`WITH refs AS MATERIALIZED (
    SELECT source_row_id,account_id,operation_id,occurred_at_ms FROM audit_posting_refs
    WHERE dataset_id=? AND source_namespace=? AND ${filter}
  ) SELECT r.source_row_id::text AS row_id,r.account_id,r.operation_id,r.occurred_at_ms,
    l.id IS NOT NULL AS present,l.entry,l.game,l.available_delta,l.available_after,l.reserved_delta,l.reserved_after,
    l.pending_delta,l.pending_after FROM refs r LEFT JOIN LATERAL (${ledger.sql}) l ON true ORDER BY r.source_row_id`);
}

function normalized(row: SourceRow, ledger: Adapter, scope: AuditScope): AuditPosting | null {
  if (!row.present || !units(row.available_delta)) return null;
  const posting: AuditPosting = { schemaVersion: 1, type: 'posting', scope, occurredAtMs: row.occurred_at_ms,
    source: source(ledger.namespace, row.row_id), sequence: row.row_id, accountId: row.account_id, operationId: row.operation_id,
    entity: null, coverage: 'partial', movement: row.entry === 'bet' || row.entry === 'debit' ? 'stake' : 'adjustment',
    asset: ledger.asset, availableDeltaUnits: row.available_delta, availableAfterUnits: units(row.available_after) ? row.available_after : null,
    reservedDeltaUnits: units(row.reserved_delta) ? row.reserved_delta : null,
    reservedAfterUnits: units(row.reserved_after) ? row.reserved_after : null };
  return isAuditRecord(posting) ? posting : null;
}

function unavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' &&
    (code.startsWith('08') || ['42P01', '42501', '3F000', '57014', '25P02', 'ECONNRESET', 'ECONNREFUSED'].includes(code));
}

/** Some CHECK readers catch source errors. A savepoint also repairs the shared snapshot if PostgreSQL aborted it. */
export async function auditReconcileSection<T>(audit: PostgresDatabase, work: () => Promise<T>): Promise<T | null> {
  await audit.exec('SAVEPOINT audit_reconcile_section');
  try {
    const result = await work();
    await audit.exec('RELEASE SAVEPOINT audit_reconcile_section');
    return result;
  } catch (error) {
    await audit.exec('ROLLBACK TO SAVEPOINT audit_reconcile_section');
    await audit.exec('RELEASE SAVEPOINT audit_reconcile_section');
    if (!unavailable(error)) throw error;
    return null;
  }
}

function recorder(report: ReadyAuditReconciliation): Recorder {
  const evidence = new Set<string>(), findings = new Set<string>();
  const overflow = () => {
    if (!report.coverage.some(row => row.code === 'reconciliation-output-limit')) {
      report.coverage.push({ rule: 'R-01', code: 'reconciliation-output-limit', sources: [report.anchor] });
    }
  };
  const link = (ref: AuditSourceRef) => {
    const key = auditSourceKey(ref);
    if (evidence.has(key)) return;
    if (report.evidence.length === maxRefs) return overflow();
    evidence.add(key);
    report.evidence.push(ref);
  };
  const add: Recorder['add'] = (rule, status, code, refs = [report.anchor], expected, observed) => {
    const all = [...new Map(refs.map(ref => [auditSourceKey(ref), ref])).values()];
    const sources = all.slice(0, 32);
    const key = JSON.stringify([rule, status, code, sources, expected ?? null, observed ?? null]);
    if (findings.has(key)) return;
    if (findings.size === maxResults) return overflow();
    if (sources.length < all.length) overflow();
    findings.add(key);
    sources.forEach(link);
    if (status === 'insufficient-data') report.coverage.push({ rule, code, sources });
    else report.findings.push({ rule, status, code, sources, ...(expected == null ? {} : { expected }),
      ...(observed == null ? {} : { observed }) });
  };
  return { add, link };
}

async function balances(audit: PostgresDatabase, ledger: Adapter, report: ReadyAuditReconciliation, output: Recorder) {
  const { scope, anchor, accountId } = report;
  const rows = await readCaptured(audit, ledger,
    'account_id=? AND source_row_id<=? ORDER BY source_row_id DESC LIMIT ?')
    .all(scope.datasetId, ledger.namespace, accountId, anchor.rowId, maxChain + 1) as SourceRow[];
  if (rows.length > maxChain) output.add('R-01', 'insufficient-data', 'balance-chain-limit');
  const openingNamespace = ledger.ledger === 'capro_pending_ledger' ? ledger.namespace.replace(/capro_pending_ledger$/, 'demo_ledger') : ledger.namespace;
  const opening = rows.length <= maxChain ? await audit.prepare(`SELECT available_units::text,reserved_units::text,pending_units::text
    FROM audit_opening_balances WHERE dataset_id=? AND account_id=? AND source_namespace=?`)
    .get(scope.datasetId, accountId, openingNamespace) : null;
  const openingRef = source(audit.schema + '.audit_opening_balances', JSON.stringify([scope.datasetId, openingNamespace, accountId]));
  const entries: AuditBalanceEntry[] = rows.slice(-maxChain).map(row => {
    const posting = normalized(row, ledger, scope);
    if (!posting) return { gap: { source: source(ledger.namespace, row.row_id), sequence: row.row_id,
      reason: row.present ? 'unsupported' : 'source-unavailable' } };
    return { posting, pendingDeltaUnits: units(row.pending_delta) ? row.pending_delta : null,
      pendingAfterUnits: units(row.pending_after) ? row.pending_after : null };
  });
  for (const component of ledger.components) {
    const initial = opening?.[component + '_units'];
    const check = reconcileAuditBalance({ scope, accountId, asset: ledger.asset, sourceNamespace: ledger.namespace, component,
      openingUnits: units(initial) ? initial : null, entries }).checks.at(-1);
    if (!check) continue;
    const previous = rows.at(-2);
    const refs = [anchor, ...(check.basis === 'opening' ? [openingRef] :
      check.basis === 'adjacent' && previous ? [source(ledger.namespace, previous.row_id)] : [])];
    if (check.basis === 'opening' && openingNamespace !== ledger.namespace) report.requiredSources.push(openingNamespace);
    output.add('R-01', check.status, check.status === 'insufficient-data' ? component + '-' + check.reason :
      component + '-balance-' + check.basis, refs, check.expectedUnits, check.observedUnits);
  }
  return rows.at(-1) ?? null;
}

async function stakeDirection(audit: PostgresDatabase, row: SourceRow, ledger: Adapter, sources: AuditSourceSchemas,
  report: ReadyAuditReconciliation, output: Recorder) {
  const posting = normalized(row, ledger, report.scope);
  if (!posting || posting.movement !== 'stake') return;
  let pending: string | null = '0';
  let available = posting.availableDeltaUnits;
  const links = [report.anchor];
  if (row.game === 'casinoapipro') {
    const sibling = adapter(sources.game, ledger.ledger === 'demo_ledger' ? 'capro_pending_ledger' : 'demo_ledger');
    const registered = await audit.prepare('SELECT 1 FROM audit_dataset_sources WHERE dataset_id=? AND source_namespace=?')
      .get(report.scope.datasetId, sibling.namespace);
    if (registered) {
      report.requiredSources.push(sibling.namespace);
      const linked = await readCaptured(audit, sibling, 'account_id=? AND operation_id=? LIMIT 2')
        .all(report.scope.datasetId, sibling.namespace, report.accountId, report.operationId) as SourceRow[];
      const other = linked.length === 1 ? linked[0] : null;
      if (other?.present && other.game === 'casinoapipro' &&
          other.entry === (sibling.ledger === 'demo_ledger' ? 'bet' : 'debit')) {
        links.push(source(sibling.namespace, other.row_id));
        available = sibling.ledger === 'demo_ledger' ? other.available_delta ?? '' : available;
        pending = sibling.ledger === 'capro_pending_ledger' ? other.pending_delta : row.pending_delta;
      } else if (!linked.length && sibling.ledger === 'capro_pending_ledger') {
        const exists = await audit.prepare(`SELECT 1 FROM ${identifier(sources.game)}.capro_pending_ledger
          WHERE account_id=? AND operation_id=?`).get(report.accountId, report.operationId);
        if (exists) pending = null;
      } else pending = null;
    } else pending = null;
  }
  if (!units(available) || !units(pending)) {
    output.add('R-01', 'insufficient-data', 'stake-components-unavailable', links);
    return;
  }
  const result = checkAuditStakeDirection({ movement: 'stake', availableDeltaUnits: available }, pending);
  if ('deltaUnits' in result) output.add('R-01', result.status, 'stake-direction', links, 'negative', result.deltaUnits);
}

function attemptRef(audit: PostgresDatabase, scope: AuditScope, id: string) {
  return source(audit.schema + '.audit_evidence', JSON.stringify([scope.datasetId, 'attempt', id]));
}

async function attempts(audit: PostgresDatabase, ledger: Adapter, row: SourceRow, report: ReadyAuditReconciliation, output: Recorder,
  signal?: AbortSignal) {
  const { scope, anchor, accountId } = report;
  const ticket = row.game === 'flag-tote' && row.entry === 'bet' && /^flag-tote:([0-9a-f-]{36})$/i.exec(report.operationId);
  const operationId = ticket ? ticket[1] : report.operationId;
  const rows = await audit.prepare(`SELECT evidence_id,occurred_at_ms,
    CASE WHEN pg_column_size(payload)<=131072 THEN payload END AS payload
    FROM audit_evidence WHERE dataset_id=? AND account_id=? AND kind='attempt' AND payload->>'operationId'=?
    ORDER BY occurred_at_ms,evidence_id LIMIT ?`).all(scope.datasetId, accountId, operationId, maxAttempts + 1);
  if (!rows.length) output.add('R-02', 'insufficient-data', 'attempt-not-associated');
  if (rows.length > maxAttempts) output.add('R-02', 'insufficient-data', 'attempt-limit');
  const routes = new Set<string>();
  const reader = {
    read: async (datasetId: string, ref: AuditSourceRef) => {
      if (datasetId !== scope.datasetId || ref.namespace !== anchor.namespace || !rowId(ref.rowId)) {
        return { status: 'not-captured' as const };
      }
      const row = await readCaptured(audit, ledger, 'source_row_id=?')
        .get(datasetId, ledger.namespace, ref.rowId) as SourceRow | undefined;
      if (!row) return { status: 'not-captured' as const };
      const posting = normalized(row, ledger, scope);
      return posting ? { status: 'found' as const, posting } : { status: 'source-unavailable' as const };
    },
  };
  for (const row of rows.slice(0, maxAttempts)) {
    signal?.throwIfAborted();
    const item: unknown = row.payload;
    const ref = attemptRef(audit, scope, row.evidence_id);
    if (!isAuditRecord(item) || item.type !== 'attempt' || item.scope.datasetId !== scope.datasetId ||
        item.scope.environment !== scope.environment || item.accountId !== accountId || item.operationId !== operationId ||
        item.attemptId !== row.evidence_id || item.occurredAtMs !== row.occurred_at_ms) {
      output.add('R-02', 'insufficient-data', 'attempt-evidence-invalid', [anchor, ref]);
      continue;
    }
    if (ticket && item.route !== '/api/demo-wallet/flag-tote') continue;
    routes.add(item.route);
    output.link(ref);
    if (item.decision === 'rejected' && item.balance.state !== 'value') continue;
    const check = await reconcileStoredAuditAttempt(item, reader);
    const snapshot = item.balance.state === 'value' ? item.balance.snapshot : null;
    const refs = [anchor, ref, ...(check.status !== 'insufficient-data' && snapshot ? [snapshot] : [])];
    output.add('R-02', check.status, check.status === 'insufficient-data' ? check.reason : 'response-balance', refs,
      check.expectedUnits, check.observedUnits);
  }
  if (rows.length && !routes.size) output.add('R-02', 'insufficient-data', 'attempt-not-associated');
  return routes;
}

async function repeats(audit: PostgresDatabase, gameSchema: string, report: ReadyAuditReconciliation, output: Recorder,
  route: string) {
  const { scope, accountId, operationId, anchor } = report;
  const result = await reconcileStoredAuditOperation(audit, gameSchema, { datasetId: scope.datasetId, accountId, operationId, route });
  const command = result.command ? [result.command] : [];
  const money = result.money;
  // Multi-step money plans are covered by the matching round or bank CHECK.
  if (!['round-check-required', 'match-bank-check-required'].includes(money.reason)) {
    output.add('R-03', money.status, money.reason, [anchor, ...command, ...money.postings]);
  }
  for (const entry of result.attempts.slice(0, maxAttempts)) {
    output.add('R-03', entry.status, entry.reason, [anchor, ...command, attemptRef(audit, scope, entry.attemptId)]);
  }
  if (result.attempts.length > maxAttempts) output.add('R-03', 'insufficient-data', 'operation-attempt-limit');
  if (result.duplicateAcceptedDecision) output.add('R-03', 'mismatch', 'duplicate-accepted-decision',
    [anchor, ...command, ...result.attempts.slice(0, maxAttempts).map(entry => attemptRef(audit, scope, entry.attemptId))]);
}

async function casino(audit: PostgresDatabase, gameSchema: string, report: ReadyAuditReconciliation, output: Recorder) {
  const result = await checkCapturedCasinoRound(audit, { datasetId: report.scope.datasetId, gameSchema, posting: report.anchor });
  if (result.status !== 'found') {
    output.add('R-04', 'insufficient-data', result.status);
    return;
  }
  report.entity = result.entity;
  const { stake, payout, steps } = result.result;
  output.add('R-04', stake.status, stake.reason ?? 'round-stake', stake.sources, stake.expectedUnits, stake.observedUnits);
  output.add('R-04', payout.status === 'match' && payout.state === 'open' ? 'pending' : payout.status,
    payout.reason ?? (payout.state === 'open' ? 'round-open' : 'round-payout'),
    payout.sources, payout.expectedUnits, payout.observedUnits);
  for (const step of steps) {
    if (step.kind !== 'stake' || step.status !== 'match') {
      output.add('R-04', step.status, step.reason ?? 'round-step-' + step.kind,
        step.sources, step.expectedUnits, step.observedUnits);
    }
  }
}

async function pvp(audit: PostgresDatabase, gameSchema: string, report: ReadyAuditReconciliation, output: Recorder) {
  const match = /^pvp:([0-9a-f-]{36}):(hold|final)$/i.exec(report.operationId);
  if (!match || !isReplayId(match[1].toLowerCase())) {
    output.add('R-05', 'insufficient-data', 'match-key-unassociated');
    return;
  }
  const matchId = match[1];
  const { scope, anchor } = report;
  const bound = await audit.prepare(`SELECT (SELECT count(*)::int FROM (
    SELECT 1 FROM audit_posting_refs WHERE dataset_id=? AND source_namespace=? AND operation_id IN (?,?) LIMIT 257) r) AS refs,
    (SELECT count(*)::int FROM (SELECT 1 FROM ${identifier(gameSchema)}.virtual_pvp_holds WHERE match_id=? LIMIT 5) h) AS holds`)
    .get(scope.datasetId, anchor.namespace, 'pvp:' + matchId + ':hold', 'pvp:' + matchId + ':final', matchId);
  if (!bound || bound.refs > 256 || bound.holds > 4) {
    output.add('R-05', 'insufficient-data', 'match-evidence-limit');
    return;
  }
  const checked = await reconcileStoredPvpMatch(audit, { schema: gameSchema }, scope.datasetId, matchId);
  const entity = checked.bank ? { category: 'pvp', kind: 'match', gameId: checked.bank.gameId, modeId: 'stake',
    rulesVersion: checked.bank.gameRulesVersion, source: checked.bank.source, ticketId: null } : null;
  if (isAuditEntityRef(entity)) report.entity = entity;
  for (const person of checked.participants) {
    if (person.hold) output.link(person.hold.source);
    for (const posting of person.postings) output.link(posting.source);
  }
  for (const finding of checked.findings) {
    output.add('R-05', finding.severity === 'gap' ? 'insufficient-data' : 'mismatch',
      finding.code, [anchor, ...(finding.source ? [finding.source] : [])]);
  }
  if (!checked.findings.length) {
    const status = checked.status === 'not-captured' ? 'insufficient-data' : checked.status;
    output.add('R-05', status, status === 'pending' ? 'match-open' : 'match-bank', [anchor, ...(checked.bank ? [checked.bank.source] : [])]);
  }
}

async function tote(audit: PostgresDatabase, gameSchema: string, report: ReadyAuditReconciliation, output: Recorder) {
  const { scope, anchor, operationId, accountId } = report;
  const g = identifier(gameSchema);
  const final = /^flag-tote:(ft1-[0-9]{1,16}):final$/.exec(operationId);
  const ticketId = final ? null : /^flag-tote:([0-9a-f-]{36})$/i.exec(operationId)?.[1] ?? null;
  const ticket = ticketId ? await audit.prepare(`SELECT round_id FROM ${g}.flag_tote_tickets WHERE id=? AND account_id=?`)
    .get(ticketId, accountId) : null;
  const poolId = final?.[1] ?? ticket?.round_id;
  if (typeof poolId !== 'string' || !/^ft1-[0-9]{1,16}$/.test(poolId)) {
    output.add('R-06', 'insufficient-data', 'pool-key-unassociated');
    return;
  }
  const poolSource = source(gameSchema + '.flag_tote_rounds', poolId);
  const bound = await audit.prepare(`WITH operations AS (
    SELECT 'flag-tote:'||id AS id FROM ${g}.flag_tote_tickets WHERE round_id=?
    UNION ALL SELECT ?
  ) SELECT (SELECT count(*)::int FROM (SELECT 1 FROM operations o
    JOIN audit_posting_refs r ON r.dataset_id=? AND r.source_namespace=? AND r.operation_id=o.id LIMIT 513) p) AS refs,
    (SELECT count(*)::int FROM (SELECT 1 FROM audit_evidence WHERE dataset_id=? AND kind='event'
      AND payload->>'reasonCode'='flag-tote-admission-clock' AND payload->'entity'->'source'->>'namespace'=?
      AND payload->'entity'->'source'->>'rowId'=? LIMIT 513) e) AS events`)
    .get(poolId, 'flag-tote:' + poolId + ':final', scope.datasetId, anchor.namespace, scope.datasetId, poolSource.namespace, poolId);
  if (!bound || bound.refs > 512 || bound.events > 512) {
    output.add('R-06', 'insufficient-data', 'pool-evidence-limit', [anchor, poolSource]);
    return;
  }
  const checked = await reconcileStoredTotePool(audit, { schema: gameSchema }, scope.datasetId, poolId);
  if (!checked) {
    output.add('R-06', 'insufficient-data', 'pool-not-captured', [anchor, poolSource]);
    return;
  }
  report.entity = { category: 'totalizator', kind: 'pool', gameId: 'flag-tote', modeId: 'pool',
    rulesVersion: checked.rulesVersion, source: checked.source, ticketId };
  for (const issue of checked.findings) {
    output.add('R-06', issue.status, issue.code, [anchor, ...issue.sources], issue.expected, issue.observed);
  }
  if (!checked.findings.length) {
    const open = checked.state === 'open' || checked.state === 'racing';
    output.add('R-06', open ? 'pending' : checked.status, open ? 'pool-open' : 'pool-bank', [anchor, checked.source]);
  }
}

async function payment(audit: PostgresDatabase, schema: string, entry: string | null, report: ReadyAuditReconciliation,
  output: Recorder) {
  const { scope, anchor, operationId, accountId } = report;
  const kind = entry === 'adjustment:' + operationId ? 'adjustment' :
    ['reserve:', 'paid:', 'refund:'].some(prefix => entry === prefix + operationId) ? 'withdrawal' : null;
  if (!kind) {
    output.add('payment', 'insufficient-data', 'payment-operation-unsupported');
    return;
  }
  const result = await reconcileStoredPayment(audit, schema, { datasetId: scope.datasetId, accountId, operationId, kind });
  output.add('payment', result.status, result.reason,
    [anchor, ...(result.command ? [result.command] : []), ...result.postings], null, result.confirmedWithdrawalUnits);
}

async function replays(audit: PostgresDatabase, report: ReadyAuditReconciliation, output: Recorder, signal?: AbortSignal) {
  const { scope, anchor, entity } = report;
  if (!entity) return;
  let entityId: unknown = entity.source.rowId;
  if (entity.category === 'casino') {
    try {
      const key: unknown = JSON.parse(entity.source.rowId);
      entityId = Array.isArray(key) && key[0] === report.accountId ? key[1] : null;
    } catch { entityId = null; }
  }
  if (typeof entityId !== 'string') return;
  const candidates = await audit.prepare(`SELECT replay_id::text FROM audit_replay_packages
    WHERE dataset_id=? AND manifest->>'entityId'=? AND manifest->'game'->>'gameId'=?
    ORDER BY replay_id LIMIT ?`).all(scope.datasetId, entityId, entity.gameId, maxReplayCandidates + 1);
  if (candidates.length > maxReplayCandidates) output.add('replay', 'insufficient-data', 'replay-candidate-limit');
  const store = new AuditReplayStore(audit);
  for (const { replay_id } of candidates.slice(0, maxReplayCandidates)) {
    signal?.throwIfAborted();
    const result = await store.read(scope, replay_id);
    if (result.status !== 'verified') continue;
    const { manifest, fragments } = result.value;
    const game = manifest.game;
    if (manifest.entityId !== entityId || game.category !== entity.category || game.gameId !== entity.gameId ||
        game.modeId !== entity.modeId || (entity.rulesVersion !== null && game.rulesVersion !== entity.rulesVersion) ||
        !fragments.some(fragment => fragment.events.some(event => event.postings.some(ref => auditSourceKey(ref) === auditSourceKey(anchor))))) continue;
    report.replayIds.push(replay_id);
    output.link(source(audit.schema + '.audit_replay_packages', replay_id));
  }
  if (!report.replayIds.length) output.add('replay', 'insufficient-data', 'replay-not-linked');
}

function adapters(audit: PostgresDatabase, sources: AuditSourceSchemas) {
  if (!name(sources.game) || (sources.payments !== undefined && !name(sources.payments)) ||
      new Set([audit.schema, sources.game, ...(sources.payments ? [sources.payments] : [])]).size !== (sources.payments ? 3 : 2)) {
    throw new Error('Invalid audit reconciliation source configuration');
  }
  return [adapter(sources.game, 'demo_ledger'), adapter(sources.game, 'capro_pending_ledger'),
    ...(sources.payments ? [adapter(sources.payments, 'crypto_ledger')] : [])];
}

export function auditReconcileSupportsSource(audit: PostgresDatabase, sources: AuditSourceSchemas, namespace: string) {
  return adapters(audit, sources).some(ledger => ledger.namespace === namespace);
}

/** Trusted CLI-04 materialization, derived from one captured posting and one committed read-only snapshot. */
export async function buildAuditReconciliation(audit: PostgresDatabase, sources: AuditSourceSchemas, datasetId: string,
  anchor: AuditSourceRef, signal?: AbortSignal): Promise<AuditReconciliation> {
  signal?.throwIfAborted();
  const ledger = adapters(audit, sources).find(item => item.namespace === anchor.namespace);
  datasetId = datasetId.toLowerCase();
  if (!ledger || !isReplayId(datasetId) || !rowId(anchor.rowId)) return { status: 'unsupported' };
  if (audit.inTransaction) throw new Error('Audit reconciliation requires an independent snapshot');
  return audit.transaction(async () => {
    await audit.exec("SET LOCAL statement_timeout='3s'");
    return reconcilePosting(audit, sources, ledger, datasetId, anchor, signal);
  }, { readOnly: true });
}

/** Trusted caller owns the enclosing read-only snapshot and its time limits. */
export async function reconcileAuditPostingInSnapshot(audit: PostgresDatabase, sources: AuditSourceSchemas, datasetId: string,
  anchor: AuditSourceRef, signal?: AbortSignal): Promise<AuditReconciliation> {
  const ledger = adapters(audit, sources).find(item => item.namespace === anchor.namespace);
  if (!ledger || !isReplayId(datasetId) || !rowId(anchor.rowId)) return { status: 'unsupported' };
  return reconcilePosting(audit, sources, ledger, datasetId, anchor, signal);
}

async function reconcilePosting(audit: PostgresDatabase, sources: AuditSourceSchemas, ledger: Adapter, datasetId: string,
  anchor: AuditSourceRef, signal?: AbortSignal): Promise<AuditReconciliation> {
  signal?.throwIfAborted();
  if (!audit.inTransaction) throw new Error('Audit reconciliation requires a snapshot');
  const capture = await audit.prepare(`SELECT d.environment,r.account_id,r.operation_id,r.occurred_at_ms
    FROM audit_posting_refs r JOIN audit_datasets d ON d.id=r.dataset_id
    WHERE r.dataset_id=? AND r.source_namespace=? AND r.source_row_id=?`)
    .get(datasetId, anchor.namespace, anchor.rowId);
  if (!capture) return { status: 'not-found' };
  const { environment, account_id: accountId, operation_id: operationId, occurred_at_ms: occurredAtMs } = capture;
  if (environment !== 'test' && environment !== 'live' || typeof accountId !== 'string' ||
      !/^[a-zA-Z0-9._:-]{1,128}$/.test(accountId) || typeof operationId !== 'string' || operationId.length > 512 ||
      !operationId.length || /[\x00-\x1f\x7f]/.test(operationId) || !Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) {
    return { status: 'unsupported' };
  }
  const report: ReadyAuditReconciliation = { status: 'ready', schemaVersion: 1, scope: { datasetId, environment },
    anchor: source(anchor.namespace, anchor.rowId), accountId, operationId, occurredAtMs, entity: null, requiredSources: [anchor.namespace],
    findings: [], coverage: [], evidence: [], replayIds: [] };
  const output = recorder(report);
  output.link(report.anchor);
  const run = async <T>(rule: Rule, action: () => Promise<T>): Promise<T | null> => {
    signal?.throwIfAborted();
    const result = await auditReconcileSection(audit, async () => ({ value: await action() }));
    if (!result) output.add(rule, 'insufficient-data', 'source-unavailable');
    return result?.value ?? null;
  };
  const row = await run('R-01', () => balances(audit, ledger, report, output));
  if (!row?.present) return report;
  await run('R-01', () => stakeDirection(audit, row, ledger, sources, report, output));
  const routes = await run('R-02', () => attempts(audit, ledger, row, report, output, signal));
  if (ledger.ledger === 'crypto_ledger' && sources.payments) {
    await run('payment', () => payment(audit, sources.payments!, row.entry, report, output));
  } else if (ledger.ledger === 'demo_ledger' && row.game?.startsWith('pvp:')) {
    await run('R-05', () => pvp(audit, sources.game, report, output));
  } else if (ledger.ledger === 'demo_ledger' && row.game === 'flag-tote') {
    await run('R-06', () => tote(audit, sources.game, report, output));
  } else if (ledger.ledger === 'demo_ledger' && ['bet', 'win', 'refund', 'rollback'].includes(row.entry ?? '') &&
      row.game !== 'atelier' && row.game !== 'janitor-skins' && !row.game?.startsWith('reward:')) {
    await run('R-04', () => casino(audit, sources.game, report, output));
  }
  if (ledger.ledger === 'demo_ledger') {
    const preferred = report.entity?.source.namespace.endsWith('.demo_operations') ? auditCommandRoutes.core : null;
    const boundRoutes = preferred ? [preferred] : [auditCommandRoutes.core, auditCommandRoutes.expansion, auditCommandRoutes.session]
      .filter(route => routes?.has(route));
    for (const route of boundRoutes) await run('R-03', () => repeats(audit, sources.game, report, output, route));
    if (!boundRoutes.length && report.entity?.category === 'pvp') {
      output.add('R-03', 'insufficient-data', 'operation-request-unassociated');
    }
  }
  await run('replay', () => replays(audit, report, output, signal));
  report.requiredSources = [...new Set(report.requiredSources)].sort();
  signal?.throwIfAborted();
  return report;
}
