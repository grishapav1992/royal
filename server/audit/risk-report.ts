import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase } from '../database';
import type { AuditCategory, AuditScope } from './contract';
import { AuditPostingReader } from './postings';
import { selectCasinoRisk } from './risk-casino';
import { selectPvpRisk } from './risk-pvp';
import { evaluateAuditRiskRule, type AuditRiskSignal } from './risk-rules';
import { type AuditRiskCandidate, type AuditRiskSelection } from './risk-selection';
import { AuditRiskSignals, type StoredAuditRiskSignal } from './risk-store';
import { selectToteRisk } from './risk-tote';

const selectors = { casino: selectCasinoRisk, pvp: selectPvpRisk, totalizator: selectToteRisk } as const;
const reasons: Record<string, string> = {
  'casino-conflicting-request-series': 'Повторяющиеся изменения параметров уже принятой операции',
  'casino-unexpected-purchase-refund-rate': 'Повторяющиеся аномалии платных опций или возвратов',
  'pvp-opponent-concentration': 'Высокая доля матчей с одним соперником',
  'pvp-directional-funds': 'Устойчивое направление движения средств в матчах с одним соперником',
  'pvp-fast-resignation': 'Высокая доля быстрых подтверждённых сдач',
  'pvp-fast-response-intervals': 'Короткие интервалы ответных действий по принятой записи матча',
  'tote-synchronized-pair': 'Одна и та же пара аккаунтов синхронно ставит в нескольких пулах',
};

function reportSignal(signal: AuditRiskSignal, stored: StoredAuditRiskSignal | null) {
  const subjectAccounts = new Set(signal.input.subject.accountIds);
  return {
    key: signal.key, rule: signal.rule, reason: reasons[signal.rule.id] ?? signal.rule.id, status: signal.status,
    scope: signal.input.scope, window: { fromMs: signal.input.fromMs, toMs: signal.input.toMs, asOfMs: signal.input.asOfMs },
    subjectAccountIds: signal.input.subject.accountIds, asset: signal.input.asset, comparisonKey: signal.input.comparisonKey,
    gaps: signal.gaps, completeness: signal.input.completeness, subject: signal.subject, comparison: signal.comparison,
    evidence: signal.input.observations.filter(row => subjectAccounts.has(row.primary.accountId!)),
    revision: stored?.revision ?? null, review: stored?.review ?? null,
    reviewStatus: stored?.reviewAppliesToCurrent ? 'reviewed' : stored?.review ? 'needs-review' : 'unreviewed',
  };
}

/** Run a bounded, trusted analysis. The source snapshot is read-only and signals are derived audit rows. */
export async function runAuditRiskReport(audit: PostgresDatabase, game: PostgresDatabase,
  selection: AuditRiskSelection, category: AuditCategory, abort?: AbortSignal) {
  if (!Object.hasOwn(selectors, category) || game.schema !== selection.gameSchema) throw new Error('Invalid audit risk category or source');
  const signal = abort ?? selection.signal;
  const candidates = await audit.transaction(async () => {
    await audit.exec("SET LOCAL statement_timeout = '3s'");
    signal?.throwIfAborted();
    return selectors[category](audit, { ...selection, signal });
  }, { readOnly: true });
  signal?.throwIfAborted();
  if (candidates.length > 96) throw new Error('Audit risk exceeds the supported comparison segment limit');
  const storage = new AuditRiskSignals(audit, new AuditPostingReader(audit, game));
  const signals = [];
  const financial = new Map<string, NonNullable<AuditRiskCandidate['financialFindings']>[number]>();
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    const calculated = evaluateAuditRiskRule(candidate.rule, candidate.input);
    const stored = await storage.record(calculated);
    const current = stored?.signal ?? calculated;
    const factsMatch = isDeepStrictEqual(calculated, { ...current, input: { ...current.input, asOfMs: calculated.input.asOfMs } });
    signals.push({ ...reportSignal(current, stored), segment: candidate.segment, replayLinks: factsMatch ? candidate.replayLinks ?? [] : [] });
    for (const finding of candidate.financialFindings ?? []) {
      financial.set(JSON.stringify([finding.code, finding.source.namespace, finding.source.rowId, finding.postings]), finding);
    }
  }
  return { scope: selection.scope, category, window: { fromMs: selection.fromMs, toMs: selection.toMs, asOfMs: selection.asOfMs },
    comparisonAccountIds: [...selection.comparisonAccountIds].sort(),
    status: signals.length ? 'evaluated' as const : 'insufficient-data' as const, signals,
    financial: { coverage: 'selector-observations-only' as const, findings: [...financial.values()] } };
}

export async function readAuditRiskReportSignal(audit: PostgresDatabase, scope: AuditScope, key: string) {
  const result = await new AuditRiskSignals(audit).read(scope, key);
  return result ? reportSignal(result.signal, result) : null;
}

/** The operator identity comes from the database connection, including when a role is assumed. */
export async function reviewAuditRiskReportSignal(audit: PostgresDatabase, scope: AuditScope, key: string,
  input: Omit<Parameters<AuditRiskSignals['review']>[2], 'reviewerId'>) {
  const user = await audit.prepare('SELECT SESSION_USER AS name').get();
  if (!user || typeof user.name !== 'string') throw new Error('Audit risk reviewer is unavailable');
  const result = await new AuditRiskSignals(audit).review(scope, key, { ...input, reviewerId: user.name });
  return result ? reportSignal(result.signal, result) : null;
}
