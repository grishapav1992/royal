import { createHash } from 'node:crypto';
import { isAuditEntityRef, type AuditAsset, type AuditEntityRef, type AuditScope, type AuditSourceRef } from './contract';

type Ratio = { numerator: string; denominator: string };

export type AuditRiskRule = {
  id: string;
  version: string;
  metric: 'rate' | 'mean-units';
  windowMs: number;
  sample: {
    selector: string;
    minSubject: number;
    minComparison: number;
    minComparisonAccounts: number;
    maxObservations: number;
  };
  threshold: { absolute: Ratio; comparisonMultiple: Ratio };
  cohort: { id: string; version: string };
};

export type AuditRiskEvidence = {
  accountId: string | null;
  operationId: string | null;
  occurredAtMs: number;
} & ({ kind: 'posting'; source: AuditSourceRef } | { kind: 'attempt' | 'event' | 'replay'; id: string });

export type AuditRiskObservation = {
  scope: AuditScope;
  comparisonKey: string;
  asset: AuditAsset | null;
  entity: AuditEntityRef | null;
  primary: AuditRiskEvidence;
  supporting: AuditRiskEvidence[];
  value: Ratio;
};

export type AuditRiskWindow = {
  scope: AuditScope;
  fromMs: number;
  toMs: number;
  asOfMs: number;
  subject: { accountIds: string[]; entity: AuditEntityRef | null };
  comparisonKey: string;
  asset: AuditAsset | null;
  completeness: { subject: boolean; comparison: boolean };
  observations: AuditRiskObservation[];
};

type RiskGap = 'window-open' | 'subject-coverage' | 'comparison-coverage' |
  'subject-sample' | 'comparison-sample' | 'comparison-accounts';
type SampleTotals = Ratio & { observations: number; accounts: number };

export type AuditRiskSignal = {
  schemaVersion: 1;
  key: string;
  status: 'observed' | 'clear' | 'insufficient-data';
  gaps: RiskGap[];
  rule: AuditRiskRule;
  input: AuditRiskWindow;
  subject: SampleTotals;
  comparison: SampleTotals;
};

const maxWindowMs = 31 * 24 * 60 * 60 * 1000;
const maxObservations = 512;
const ownFields = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const slug = (value: unknown) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
const identifier = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
  value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
export const isRiskActorId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
export const isRiskSignalKey = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const uint = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const validRatio = (value: unknown): value is Ratio => ownFields(value, ['numerator', 'denominator']) &&
  uint(value.numerator) && uint(value.denominator) && value.denominator !== '0';

export function isRiskScope(value: unknown): value is AuditScope {
  return ownFields(value, ['datasetId', 'environment']) && typeof value.datasetId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.datasetId) &&
    (value.environment === 'test' || value.environment === 'live');
}

const asset = (value: unknown): value is AuditAsset | null => value === null ||
  ownFields(value, ['contour', 'code', 'scale']) && ['virtual', 'test', 'real'].some(item => item === value.contour) &&
  typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(value.code) && integer(value.scale, 0, 18);
const entity = (value: unknown): value is AuditEntityRef | null => value === null || isAuditEntityRef(value);

export const riskAssetKey = (value: AuditAsset | null) => value ? JSON.stringify([value.contour, value.code, value.scale]) : null;
export const riskEntityKey = (value: AuditEntityRef | null, omitTicket = false) => value ?
  JSON.stringify([value.category, value.kind, value.gameId, value.modeId, value.rulesVersion,
    value.source.namespace, value.source.rowId, omitTicket ? null : value.ticketId]) : null;
export const riskEvidenceKey = (value: AuditRiskEvidence) => value.kind === 'posting' ?
  JSON.stringify([value.kind, value.source.namespace, value.source.rowId]) : JSON.stringify([value.kind, value.id]);

function validRule(value: unknown): value is AuditRiskRule {
  if (!ownFields(value, ['id', 'version', 'metric', 'windowMs', 'sample', 'threshold', 'cohort']) ||
      !slug(value.id) || !slug(value.version) || (value.metric !== 'rate' && value.metric !== 'mean-units') ||
      !integer(value.windowMs, 1, maxWindowMs) ||
      !ownFields(value.cohort, ['id', 'version']) || !slug(value.cohort.id) || !slug(value.cohort.version) ||
      !ownFields(value.sample, ['selector', 'minSubject', 'minComparison', 'minComparisonAccounts', 'maxObservations']) ||
      !slug(value.sample.selector) || !integer(value.sample.maxObservations, 2, maxObservations) ||
      !integer(value.sample.minSubject, 1, value.sample.maxObservations) ||
      !integer(value.sample.minComparison, 1, value.sample.maxObservations - value.sample.minSubject) ||
      !integer(value.sample.minComparisonAccounts, 1, value.sample.maxObservations - value.sample.minSubject) ||
      !ownFields(value.threshold, ['absolute', 'comparisonMultiple']) ||
      !validRatio(value.threshold.absolute) || value.threshold.absolute.numerator === '0' ||
      !validRatio(value.threshold.comparisonMultiple)) return false;
  const { absolute, comparisonMultiple } = value.threshold;
  return (value.metric !== 'rate' || BigInt(absolute.numerator) <= BigInt(absolute.denominator)) &&
    BigInt(comparisonMultiple.numerator) >= BigInt(comparisonMultiple.denominator);
}

function validEvidence(value: unknown): value is AuditRiskEvidence {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'kind')) return false;
  const kind = (value as { kind: unknown }).kind;
  if (!ownFields(value, ['kind', kind === 'posting' ? 'source' : 'id', 'accountId', 'operationId', 'occurredAtMs']) ||
      !(value.accountId === null || isRiskActorId(value.accountId)) ||
      !(value.operationId === null || identifier(value.operationId)) || !integer(value.occurredAtMs)) return false;
  if (kind === 'posting') {
    return value.accountId !== null && value.operationId !== null &&
      ownFields(value.source, ['namespace', 'rowId']) && slug(value.source.namespace) &&
      typeof value.source.rowId === 'string' && /^[1-9][0-9]{0,18}$/.test(value.source.rowId) &&
      BigInt(value.source.rowId) <= 9223372036854775807n;
  }
  return (kind === 'attempt' || kind === 'event' || kind === 'replay') && identifier(value.id) &&
    (kind !== 'attempt' || value.accountId !== null) &&
    (kind !== 'replay' || (value.accountId === null && value.operationId === null));
}

function validWindow(rule: AuditRiskRule, input: unknown): input is AuditRiskWindow {
  return ownFields(input, ['scope', 'fromMs', 'toMs', 'asOfMs', 'subject', 'comparisonKey', 'asset', 'completeness', 'observations']) &&
    isRiskScope(input.scope) && integer(input.fromMs) && integer(input.toMs) && input.toMs - input.fromMs === rule.windowMs &&
    integer(input.asOfMs, input.fromMs) && isRiskActorId(input.comparisonKey) && asset(input.asset) &&
    (rule.metric !== 'mean-units' || input.asset !== null) &&
    ownFields(input.subject, ['accountIds', 'entity']) && entity(input.subject.entity) &&
    Array.isArray(input.subject.accountIds) && input.subject.accountIds.length >= 1 && input.subject.accountIds.length <= 8 &&
    input.subject.accountIds.every(isRiskActorId) && new Set(input.subject.accountIds).size === input.subject.accountIds.length &&
    ownFields(input.completeness, ['subject', 'comparison']) && typeof input.completeness.subject === 'boolean' &&
    typeof input.completeness.comparison === 'boolean' &&
    Array.isArray(input.observations) && input.observations.length <= rule.sample.maxObservations;
}

function validObservation(rule: AuditRiskRule, window: AuditRiskWindow, input: unknown): input is AuditRiskObservation {
  return ownFields(input, ['scope', 'comparisonKey', 'asset', 'entity', 'primary', 'supporting', 'value']) &&
    isRiskScope(input.scope) && input.scope.datasetId === window.scope.datasetId && input.scope.environment === window.scope.environment &&
    input.comparisonKey === window.comparisonKey && asset(input.asset) && riskAssetKey(input.asset) === riskAssetKey(window.asset) &&
    entity(input.entity) && validEvidence(input.primary) && input.primary.accountId !== null &&
    input.primary.occurredAtMs >= window.fromMs && input.primary.occurredAtMs < window.toMs &&
    input.primary.occurredAtMs <= window.asOfMs &&
    Array.isArray(input.supporting) && input.supporting.length <= 4 &&
    input.supporting.every(item => validEvidence(item) && item.occurredAtMs <= window.asOfMs) &&
    validRatio(input.value) && input.value.denominator === '1' &&
    (rule.metric === 'rate' ? ['0', '1'].includes(input.value.numerator) : input.primary.kind === 'posting');
}

function totals(rows: AuditRiskObservation[]): SampleTotals {
  let numerator = 0n, denominator = 0n;
  const accounts = new Set<string>();
  for (const row of rows) {
    numerator += BigInt(row.value.numerator);
    denominator += BigInt(row.value.denominator);
    accounts.add(row.primary.accountId!);
  }
  return { numerator: String(numerator), denominator: String(denominator), observations: rows.length, accounts: accounts.size };
}

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Compute an explainable review signal from observations produced by the rule's trusted selector. */
export function evaluateAuditRiskRule(rule: AuditRiskRule, input: AuditRiskWindow): AuditRiskSignal {
  if (!validRule(rule) || !validWindow(rule, input)) throw new Error('Invalid audit risk rule or window');
  const seen = new Set<string>(), subjectRows: AuditRiskObservation[] = [], comparisonRows: AuditRiskObservation[] = [];
  const omitTicket = input.subject.entity?.ticketId === null;
  const targetEntity = riskEntityKey(input.subject.entity, omitTicket);
  for (const row of input.observations) {
    if (!validObservation(rule, input, row)) throw new Error('Invalid audit risk observation');
    const key = riskEvidenceKey(row.primary);
    const supportKeys = row.supporting.map(riskEvidenceKey);
    if (seen.has(key) || supportKeys.includes(key) || new Set(supportKeys).size !== supportKeys.length) {
      throw new Error('Duplicate audit risk observation or proof');
    }
    seen.add(key);
    const isSubject = input.subject.accountIds.includes(row.primary.accountId!);
    const sameEntity = riskEntityKey(row.entity, omitTicket) === targetEntity;
    if (targetEntity && isSubject !== sameEntity) throw new Error('Audit risk observation outside subject or comparison');
    (isSubject ? subjectRows : comparisonRows).push(row);
  }
  const subject = totals(subjectRows), comparison = totals(comparisonRows);
  const gaps: RiskGap[] = [];
  if (input.asOfMs < input.toMs) gaps.push('window-open');
  if (!input.completeness.subject) gaps.push('subject-coverage');
  if (!input.completeness.comparison) gaps.push('comparison-coverage');
  if (subject.observations < rule.sample.minSubject) gaps.push('subject-sample');
  if (comparison.observations < rule.sample.minComparison) gaps.push('comparison-sample');
  if (comparison.accounts < rule.sample.minComparisonAccounts) gaps.push('comparison-accounts');
  const { absolute, comparisonMultiple } = rule.threshold;
  const n = BigInt(subject.numerator), d = BigInt(subject.denominator);
  const meetsThreshold = !gaps.length && n * BigInt(absolute.denominator) >= d * BigInt(absolute.numerator) &&
    n * BigInt(comparison.denominator) * BigInt(comparisonMultiple.denominator) >=
      d * BigInt(comparison.numerator) * BigInt(comparisonMultiple.numerator);
  const normalized = structuredClone(input);
  normalized.subject.accountIds.sort(compare);
  for (const row of normalized.observations) row.supporting.sort((a, b) => compare(riskEvidenceKey(a), riskEvidenceKey(b)));
  normalized.observations.sort((a, b) => a.primary.occurredAtMs - b.primary.occurredAtMs ||
    compare(riskEvidenceKey(a.primary), riskEvidenceKey(b.primary)));
  const key = createHash('sha256').update(JSON.stringify([1, input.scope.datasetId, input.scope.environment,
    rule.id, rule.version, input.fromMs, input.toMs, normalized.subject.accountIds, riskEntityKey(input.subject.entity),
    rule.cohort.id, rule.cohort.version, input.comparisonKey, riskAssetKey(input.asset)])).digest('hex');
  return { schemaVersion: 1, key, status: gaps.length ? 'insufficient-data' : meetsThreshold ? 'observed' : 'clear',
    gaps, rule: structuredClone(rule), input: normalized, subject, comparison };
}
