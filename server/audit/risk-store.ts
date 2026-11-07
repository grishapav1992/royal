import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { isAuditRecord, type AuditScope } from './contract';
import type { AuditPostingReader } from './postings';
import {
  evaluateAuditRiskRule, isRiskActorId, isRiskScope, isRiskSignalKey, riskAssetKey, riskEntityKey, riskEvidenceKey,
  type AuditRiskEvidence, type AuditRiskSignal,
} from './risk-rules';

const maximumPayloadBytes = 1_048_576;
const reviewDecisions = ['explained', 'escalated', 'dismissed'] as const;
type ReviewDecision = (typeof reviewDecisions)[number];
type Review = { revision: number; reviewerId: string; decision: ReviewDecision; reviewedAtMs: number };

export type StoredAuditRiskSignal = {
  signal: AuditRiskSignal;
  revision: number;
  review: Review | null;
  reviewAppliesToCurrent: boolean;
};

export async function migrateAuditRiskSignals(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-risk-signals-v1', statements: [
    `CREATE TABLE audit_risk_rules (
      rule_id text NOT NULL, rule_version text NOT NULL, definition jsonb NOT NULL,
      PRIMARY KEY(rule_id,rule_version)
    )`,
    `CREATE TABLE audit_risk_signals (
      dataset_id uuid NOT NULL REFERENCES audit_datasets(id), signal_key text NOT NULL CHECK(signal_key ~ '^[0-9a-f]{64}$'),
      rule_id text NOT NULL, rule_version text NOT NULL, as_of_ms bigint NOT NULL CHECK(as_of_ms>=0),
      revision bigint NOT NULL CHECK(revision BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER}),
      status text NOT NULL CHECK(status IN ('observed','clear','insufficient-data')),
      signal jsonb NOT NULL CHECK(octet_length(signal::text)<=${maximumPayloadBytes * 2}), review jsonb,
      PRIMARY KEY(dataset_id,signal_key),
      FOREIGN KEY(rule_id,rule_version) REFERENCES audit_risk_rules(rule_id,rule_version)
    )`,
  ] });
}

function checkSignal(value: AuditRiskSignal): AuditRiskSignal {
  if (!value || typeof value !== 'object') throw new Error('Invalid audit risk signal');
  const computed = evaluateAuditRiskRule(value.rule, value.input);
  if (!isDeepStrictEqual(value, computed) || Buffer.byteLength(JSON.stringify(computed)) > maximumPayloadBytes) {
    throw new Error('Invalid audit risk signal');
  }
  return computed;
}

const positiveRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function stored(signal: AuditRiskSignal, revision: number, review: Review | null): StoredAuditRiskSignal {
  if (!positiveRevision(revision) || (review !== null && (!positiveRevision(review.revision) || review.revision > revision ||
      !isRiskActorId(review.reviewerId) || !reviewDecisions.includes(review.decision) ||
      !Number.isSafeInteger(review.reviewedAtMs) || review.reviewedAtMs < 0))) {
    throw new Error('Invalid stored audit risk revision or review');
  }
  return { signal, revision, review, reviewAppliesToCurrent: review !== null && review.revision === revision };
}

function unchanged(previous: AuditRiskSignal, candidate: AuditRiskSignal) {
  return isDeepStrictEqual(previous, { ...candidate, input: { ...candidate.input, asOfMs: previous.input.asOfMs } });
}

type RiskRow = { signal: AuditRiskSignal; revision: number; review: Review | null };
type RecordedEvidence = {
  accountId: string | null;
  operationId: string | null;
  occurredAtMs: number;
  entityKey: string | null;
};

/** Persists derived review signals in the audit schema, without modifying source records. */
export class AuditRiskSignals {
  constructor(private readonly db: PostgresDatabase, private readonly postings?: Pick<AuditPostingReader, 'read'>) {}

  private row(scope: AuditScope, key: string) {
    return this.db.prepare(`SELECT s.signal,s.revision,s.review FROM audit_risk_signals s
      JOIN audit_datasets d ON d.id=s.dataset_id
      WHERE s.dataset_id=? AND s.signal_key=? AND d.environment=?`)
      .get(scope.datasetId, key, scope.environment) as Promise<RiskRow | undefined>;
  }

  async read(scope: AuditScope, key: string): Promise<StoredAuditRiskSignal | null> {
    if (!isRiskScope(scope) || !isRiskSignalKey(key)) return null;
    const row = await this.row(scope, key);
    if (!row) return null;
    const signal = checkSignal(row.signal);
    if (signal.key !== key || signal.input.scope.datasetId !== scope.datasetId || signal.input.scope.environment !== scope.environment) {
      throw new Error('Audit risk signal scope mismatch');
    }
    return stored(signal, row.revision, row.review);
  }

  private async validateEvidence(signal: AuditRiskSignal) {
    const { scope, observations } = signal.input;
    const refs = new Map<string, AuditRiskEvidence>();
    for (const { primary, supporting } of observations) {
      for (const ref of [primary, ...supporting]) {
        const key = riskEvidenceKey(ref), previous = refs.get(key);
        if (previous && !isDeepStrictEqual(previous, ref)) throw new Error('Conflicting audit risk evidence references');
        refs.set(key, ref);
      }
    }
    const actual = new Map<string, RecordedEvidence>();
    const recorded = [...refs.values()].filter(ref => ref.kind !== 'posting');
    if (recorded.length) {
      const rows = await this.db.prepare(`SELECT e.kind,e.evidence_id,e.account_id,e.occurred_at_ms,e.payload
        FROM jsonb_to_recordset(?::jsonb) r(kind text,id text) JOIN audit_evidence e
          ON e.dataset_id=? AND e.kind=r.kind AND e.evidence_id=r.id`)
        .all(JSON.stringify(recorded.map(({ kind, id }) => ({ kind, id }))), scope.datasetId);
      for (const row of rows) {
        const value: unknown = row.payload;
        if (!isAuditRecord(value) || value.type === 'posting' || value.type !== row.kind ||
            value.scope.datasetId !== scope.datasetId || value.scope.environment !== scope.environment) continue;
        const id = value.type === 'attempt' ? value.attemptId : value.type === 'event' ? value.eventId : value.replayId;
        const accountId = value.type === 'replay' ? null : value.accountId;
        const operationId = value.type === 'replay' ? null : value.operationId;
        if (id !== row.evidence_id || accountId !== row.account_id || value.occurredAtMs !== row.occurred_at_ms) continue;
        const reference = { kind: value.type, id, accountId, operationId, occurredAtMs: value.occurredAtMs };
        actual.set(riskEvidenceKey(reference), { accountId, operationId, occurredAtMs: value.occurredAtMs,
          entityKey: riskEntityKey(value.entity) });
      }
    }
    const captured = [...refs.values()].filter(ref => ref.kind === 'posting');
    if (captured.length) {
      const rows = await this.db.prepare(`SELECT p.source_namespace,p.source_row_id::text AS id,p.account_id,p.operation_id,p.occurred_at_ms
        FROM jsonb_to_recordset(?::jsonb) r(namespace text,"rowId" text) JOIN audit_posting_refs p
          ON p.dataset_id=? AND p.source_namespace=r.namespace AND p.source_row_id=r."rowId"::bigint`)
        .all(JSON.stringify(captured.map(ref => ref.source)), scope.datasetId);
      for (const row of rows) {
        const reference = { kind: 'posting' as const, source: { namespace: row.source_namespace, rowId: row.id },
          accountId: row.account_id, operationId: row.operation_id, occurredAtMs: row.occurred_at_ms };
        actual.set(riskEvidenceKey(reference), { ...reference, entityKey: null });
      }
    }
    for (const [key, ref] of refs) {
      const row = actual.get(key);
      if (!row || row.accountId !== ref.accountId || row.operationId !== ref.operationId || row.occurredAtMs !== ref.occurredAtMs) {
        throw new Error('Audit risk evidence unavailable or out of scope');
      }
    }
    for (const { primary, entity, asset, value } of observations) {
      if (primary.kind === 'posting' && (entity || asset)) {
        const resolved = await this.postings?.read(scope.datasetId, primary.source);
        if (resolved?.status !== 'found' || resolved.posting.scope.datasetId !== scope.datasetId ||
          resolved.posting.scope.environment !== scope.environment || resolved.posting.accountId !== primary.accountId ||
          resolved.posting.operationId !== primary.operationId || resolved.posting.occurredAtMs !== primary.occurredAtMs ||
          (entity && riskEntityKey(resolved.posting.entity) !== riskEntityKey(entity)) ||
          (asset && riskAssetKey(resolved.posting.asset) !== riskAssetKey(asset))) {
          throw new Error('Audit risk posting context unavailable or out of scope');
        }
        if (signal.rule.metric === 'mean-units' && resolved.posting.availableDeltaUnits.replace(/^-/, '') !== value.numerator) {
          throw new Error('Audit risk amount does not match the canonical posting');
        }
      } else if (entity && actual.get(riskEvidenceKey(primary))?.entityKey !== riskEntityKey(entity)) {
        throw new Error('Audit risk evidence entity does not match');
      }
    }
  }

  async record(value: AuditRiskSignal): Promise<StoredAuditRiskSignal | null> {
    const signal = checkSignal(value);
    const { input, key, rule, status } = signal, { scope, asOfMs } = input;
    return this.db.transaction(async () => {
      const dataset = await this.db.prepare('SELECT environment,started_at_ms,sealed_at_ms FROM audit_datasets WHERE id=? FOR SHARE')
        .get(scope.datasetId);
      if (!dataset || dataset.environment !== scope.environment || input.toMs <= dataset.started_at_ms ||
          (dataset.sealed_at_ms !== null && input.fromMs >= dataset.sealed_at_ms)) {
        throw new Error('Audit risk dataset or window unavailable');
      }
      if ((input.fromMs < dataset.started_at_ms || (dataset.sealed_at_ms !== null && input.toMs > dataset.sealed_at_ms)) &&
          (input.completeness.subject || input.completeness.comparison)) {
        throw new Error('Audit risk window crosses the dataset boundary');
      }
      const previous = await this.row(scope, key);
      if (previous && !isDeepStrictEqual(previous.signal.rule, rule)) throw new Error('Audit risk rule version changed');
      if (previous && asOfMs < previous.signal.input.asOfMs) return stored(previous.signal, previous.revision, previous.review);
      const sameFacts = previous ? unchanged(previous.signal, signal) : false;
      if (previous && asOfMs === previous.signal.input.asOfMs) {
        if (!sameFacts) throw new Error('Conflicting audit risk evaluation at the same observation time');
        return stored(previous.signal, previous.revision, previous.review);
      }
      await this.validateEvidence(signal);
      const definition = JSON.stringify(rule);
      const findDefinition = () => this.db.prepare(`SELECT definition=?::jsonb AS matches FROM audit_risk_rules
        WHERE rule_id=? AND rule_version=?`).get(definition, rule.id, rule.version);
      if (!previous && status === 'clear') {
        const registered = await findDefinition();
        if (registered && registered.matches !== true) throw new Error('Audit risk rule version changed');
        return null;
      }
      await this.db.prepare(`INSERT INTO audit_risk_rules(rule_id,rule_version,definition) VALUES (?,?,?::jsonb)
        ON CONFLICT DO NOTHING`).run(rule.id, rule.version, definition);
      const registered = await findDefinition();
      if (registered?.matches !== true) throw new Error('Audit risk rule version changed');
      const revision = previous ? previous.revision + (sameFacts ? 0 : 1) : 1;
      await this.db.prepare(`INSERT INTO audit_risk_signals(dataset_id,signal_key,rule_id,rule_version,as_of_ms,revision,status,signal)
        VALUES (?,?,?,?,?,?,?,?::jsonb) ON CONFLICT (dataset_id,signal_key) DO UPDATE
        SET as_of_ms=excluded.as_of_ms,revision=excluded.revision,status=excluded.status,signal=excluded.signal`)
        .run(scope.datasetId, key, rule.id, rule.version, asOfMs, revision, status, JSON.stringify(signal));
      return stored(signal, revision, previous?.review ?? null);
    }, { lockKey: 'paid-audit-risk:' + scope.datasetId + ':' + key });
  }

  async review(scope: AuditScope, key: string, input: {
    expectedRevision: number; reviewerId: string; decision: ReviewDecision;
  }): Promise<StoredAuditRiskSignal | null> {
    if (!isRiskScope(scope) || !isRiskSignalKey(key) || !input ||
      !positiveRevision(input.expectedRevision) || !isRiskActorId(input.reviewerId) || !reviewDecisions.includes(input.decision)) {
      throw new Error('Invalid audit risk review');
    }
    const { expectedRevision, reviewerId, decision } = input;
    return this.db.transaction(async () => {
      const row = await this.row(scope, key);
      if (!row) return null;
      if (row.revision !== expectedRevision || row.signal.status === 'clear') throw new Error('Audit risk review requires current finding');
      if (row.review?.revision === row.revision && row.review.reviewerId === reviewerId && row.review.decision === decision) {
        return stored(row.signal, row.revision, row.review);
      }
      const review = { revision: row.revision, reviewerId, decision, reviewedAtMs: Date.now() };
      await this.db.prepare('UPDATE audit_risk_signals SET review=?::jsonb WHERE dataset_id=? AND signal_key=?')
        .run(JSON.stringify(review), scope.datasetId, key);
      return stored(row.signal, row.revision, review);
    }, { lockKey: 'paid-audit-risk:' + scope.datasetId + ':' + key });
  }
}
