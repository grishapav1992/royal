import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../database';
import type { AuditAsset, AuditEntityRef, AuditScope, AuditSourceRef } from './contract';
import { isRiskActorId, isRiskScope, riskEvidenceKey,
  type AuditRiskEvidence, type AuditRiskRule, type AuditRiskWindow } from './risk-rules';

export const RISK_WINDOW_MS = 86_400_000;

export type AuditRiskSelection = {
  scope: AuditScope;
  gameSchema: string;
  subjectAccountIds: string[];
  comparisonAccountIds: string[];
  fromMs: number;
  toMs: number;
  asOfMs: number;
  signal?: AbortSignal;
};

export type AuditRiskCandidate = {
  rule: AuditRiskRule;
  input: AuditRiskWindow;
  segment: string;
  replayLinks?: { replayId: string; sequence: number; source: AuditSourceRef }[];
  financialFindings?: { code: string; source: AuditSourceRef; postings: AuditSourceRef[] }[];
};

type Observation = {
  primary: AuditRiskEvidence;
  supporting?: AuditRiskEvidence[];
  entity: AuditEntityRef | null;
  matched: boolean;
};

const accountList = (values: unknown, maximum: number): values is string[] =>
  Array.isArray(values) && values.length > 0 && values.length <= maximum &&
  values.every(isRiskActorId) && new Set(values).size === values.length;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function riskAccounts(selection: AuditRiskSelection): string[] {
  if (!selection || !accountList(selection.subjectAccountIds, 8) || !accountList(selection.comparisonAccountIds, 32)) {
    throw new Error('Audit risk requires explicit bounded account groups');
  }
  const accounts = [...selection.subjectAccountIds, ...selection.comparisonAccountIds];
  if (new Set(accounts).size !== accounts.length) throw new Error('Audit risk account groups overlap');
  return accounts.sort();
}

/** Bind all source reads to the configured dataset and canonical wallet namespace. */
export async function riskSourceBoundaries(db: PostgresDatabase, selection: AuditRiskSelection) {
  selection.signal?.throwIfAborted();
  riskAccounts(selection);
  const { scope, gameSchema, fromMs, toMs, asOfMs } = selection;
  if (!isRiskScope(scope) || !/^[a-z_][a-z_0-9]{0,62}$/.test(gameSchema) || gameSchema === db.schema ||
      ![fromMs, toMs, asOfMs].every(time => Number.isSafeInteger(time) && time >= 0) ||
      toMs - fromMs !== RISK_WINDOW_MS || asOfMs < fromMs) throw new Error('Invalid audit risk scope or window');
  const row = await db.prepare(`SELECT d.started_at_ms,d.sealed_at_ms
    FROM audit_datasets d JOIN audit_dataset_sources s ON s.dataset_id=d.id
    WHERE d.id=? AND d.environment=? AND s.source_namespace=?`)
    .get(scope.datasetId, scope.environment, gameSchema + '.demo_ledger');
  if (!row || toMs <= row.started_at_ms || (row.sealed_at_ms !== null && fromMs >= row.sealed_at_ms)) {
    throw new Error('Audit risk dataset, source or window unavailable');
  }
  return { startedAtMs: row.started_at_ms as number, sealedAtMs: row.sealed_at_ms as number | null,
    wholeWindow: fromMs >= row.started_at_ms && (row.sealed_at_ms === null || toMs <= row.sealed_at_ms) };
}

export function riskCandidate(selection: AuditRiskSelection, rule: AuditRiskRule, segment: string, asset: AuditAsset | null,
  rows: Observation[], completeness: { subject: boolean; comparison: boolean }): AuditRiskCandidate {
  const accounts = new Set(riskAccounts(selection));
  if (!segment || segment.length > 1024 || rule.windowMs !== RISK_WINDOW_MS ||
      rows.some(row => row.primary.accountId === null || !accounts.has(row.primary.accountId))) {
    throw new Error('Invalid audit risk comparison segment or observation account');
  }
  const comparisonKey = createHash('sha256').update(JSON.stringify([segment, [...selection.comparisonAccountIds].sort()])).digest('hex');
  const { scope, fromMs, toMs, asOfMs } = selection;
  const subjectAccounts = new Set(selection.subjectAccountIds);
  const sorted = [...rows].sort((a, b) => a.primary.occurredAtMs - b.primary.occurredAtMs ||
    compare(riskEvidenceKey(a.primary), riskEvidenceKey(b.primary)));
  const coverage = { ...completeness };
  for (const row of sorted.slice(rule.sample.maxObservations)) {
    coverage[subjectAccounts.has(row.primary.accountId!) ? 'subject' : 'comparison'] = false;
  }
  return { rule, segment, input: { scope, fromMs, toMs, asOfMs, comparisonKey, asset, completeness: coverage,
    subject: { accountIds: [...subjectAccounts], entity: null },
    observations: sorted.slice(0, rule.sample.maxObservations).map(row => ({
      scope, comparisonKey, asset, entity: row.entity, primary: row.primary, supporting: row.supporting ?? [],
      value: { numerator: row.matched ? '1' : '0', denominator: '1' },
    })),
  } };
}
