import { isExpansionGame, validExpansionAction } from '../../src/shared/casinoExpansion';
import { GAME_CATALOG } from '../../src/shared/gameCore';
import { identifier, type PostgresDatabase } from '../database';
import { resolveCasinoPosting, type CasinoPostingResolution } from './casino';
import { checkCapturedCasinoRound } from './check-casino';
import { isAuditRecord, type AuditAsset, type AuditSourceRef } from './contract';
import { auditCommandRoutes, fingerprintAuditIntent } from './intents';
import { attachRiskReplayJumps, casinoRiskReplayPostings } from './risk-replay-links';
import { riskEntityKey, riskEvidenceKey, type AuditRiskEvidence, type AuditRiskRule } from './risk-rules';
import {
  RISK_WINDOW_MS, riskAccounts, riskCandidate, riskSourceBoundaries, type AuditRiskCandidate, type AuditRiskSelection,
} from './risk-selection';

const maximumSourceRows = 256;
const virtual: AuditAsset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 };
const coreGames = new Set<string>(GAME_CATALOG.map(game => game.id));
const routes = [auditCommandRoutes.core, auditCommandRoutes.expansion];

export const casinoConflictRiskRule: AuditRiskRule = {
  id: 'casino-conflicting-request-series', version: '1', metric: 'rate', windowMs: RISK_WINDOW_MS,
  sample: { selector: 'captured-casino-attempts-v1', minSubject: 3, minComparison: 2,
    minComparisonAccounts: 2, maxObservations: maximumSourceRows },
  threshold: { absolute: { numerator: '1', denominator: '2' }, comparisonMultiple: { numerator: '2', denominator: '1' } },
  cohort: { id: 'casino-mode-version-virtual', version: '1' },
};

export const casinoPurchaseRefundRiskRule: AuditRiskRule = {
  id: 'casino-unexpected-purchase-refund-rate', version: '1', metric: 'rate', windowMs: RISK_WINDOW_MS,
  sample: { selector: 'captured-casino-charges-and-refunds-v1', minSubject: 2, minComparison: 2,
    minComparisonAccounts: 2, maxObservations: maximumSourceRows },
  threshold: { absolute: { numerator: '1', denominator: '3' }, comparisonMultiple: { numerator: '2', denominator: '1' } },
  cohort: { id: 'casino-mode-version-virtual', version: '1' },
};

type Capture = {
  id: string; account_id: string; operation_id: string; occurred_at_ms: number; source: string | null; entry_type: string | null;
};
type Posting = Extract<AuditRiskEvidence, { kind: 'posting' }>;
type Original = { entity: CasinoPostingResolution['entity']; proof: Posting };
type RiskRow = { primary: AuditRiskEvidence; supporting?: AuditRiskEvidence[]; entity: null; matched: boolean };
type Collector = { groups: Map<string, RiskRow[]>; coverage: { subject: boolean; comparison: boolean } };
type FinancialFinding = NonNullable<AuditRiskCandidate['financialFindings']>[number];

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function groupKey(entity: CasinoPostingResolution['entity']) {
  return entity.rulesVersion === null || entity.modeId === 'unknown' ? null :
    JSON.stringify(['casino', entity.gameId, entity.modeId, entity.rulesVersion, virtual.contour]);
}

function add(collector: Collector, segment: string, row: RiskRow) {
  const rows = collector.groups.get(segment) ?? [];
  rows.push(row);
  collector.groups.set(segment, rows);
}

function unavailable(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' &&
    (code.startsWith('08') || ['42P01', '3F000', '42501', '57014', 'ECONNREFUSED', 'ECONNRESET'].includes(code));
}

/** Derive casino rate samples from scoped attempts, committed source commands and captured ledger rows. */
export async function selectCasinoRisk(audit: PostgresDatabase, selection: AuditRiskSelection): Promise<AuditRiskCandidate[]> {
  selection.signal?.throwIfAborted();
  const accounts = riskAccounts(selection), subjects = new Set(selection.subjectAccountIds);
  const { gameSchema, scope, asOfMs, fromMs, toMs } = selection;
  const { datasetId } = scope;
  const canonical = gameSchema + '.demo_ledger', g = identifier(gameSchema), a = identifier(audit.schema);
  const reader = { schema: gameSchema, prepare: audit.prepare.bind(audit) };
  const collector = (complete: boolean): Collector => ({ groups: new Map(), coverage: { subject: complete, comparison: complete } });
  const markGap = (sample: Collector, accountId: string) => {
    sample.coverage[subjects.has(accountId) ? 'subject' : 'comparison'] = false;
  };
  const finish = (rule: AuditRiskRule, sample: Collector, extraSegments: string[] = []) => {
    const relevant = new Set([...extraSegments, ...[...sample.groups].filter(([, rows]) =>
      rows.some(row => subjects.has(row.primary.accountId!))).map(([segment]) => segment)]);
    if (!relevant.size && (!sample.coverage.subject || !sample.coverage.comparison)) relevant.add('casino:unresolved');
    return [...relevant].sort().map(segment =>
      riskCandidate(selection, rule, segment, virtual, sample.groups.get(segment) ?? [], sample.coverage));
  };
  let boundariesRead = false;
  try {
    return await audit.transaction(async () => {
      const bounds = await riskSourceBoundaries(audit, selection);
      boundariesRead = true;
      const lower = Math.max(fromMs, bounds.startedAtMs);
      const knownThrough = Math.min(asOfMs, bounds.sealedAtMs ?? asOfMs);
      const upper = Math.min(toMs - 1, knownThrough);
      const attemptSample = collector(bounds.wholeWindow), moneySample = collector(bounds.wholeWindow);
      const capped = (sample: Collector) => { sample.coverage.subject = false; sample.coverage.comparison = false; };
      const postingProof = (row: Capture): Posting => ({
        kind: 'posting', source: { namespace: canonical, rowId: row.id }, accountId: row.account_id,
        operationId: row.operation_id, occurredAtMs: row.occurred_at_ms,
      });
      const replayEntities = new Map<string, CasinoPostingResolution['entity']>();
      const originalCache = new Map<string, Original | null>();
      const original = async (accountId: string, operationId: string): Promise<Original | null> => {
        const key = JSON.stringify([accountId, operationId]);
        if (originalCache.has(key)) return originalCache.get(key) ?? null;
        const rows = await audit.prepare(`WITH refs AS MATERIALIZED (
          SELECT source_row_id,account_id,operation_id,occurred_at_ms FROM ${a}.audit_posting_refs
          WHERE dataset_id=? AND source_namespace=? AND operation_id=? AND account_id=?
            AND occurred_at_ms>=? AND occurred_at_ms<=? ORDER BY source_row_id LIMIT 9
        ) SELECT r.source_row_id::text AS id,r.account_id,r.operation_id,r.occurred_at_ms,l.source,l.entry_type
          FROM refs r LEFT JOIN LATERAL (SELECT source,entry_type FROM ${g}.demo_ledger l
            WHERE l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
              AND l.created_at=r.occurred_at_ms LIMIT 1) l ON true ORDER BY r.source_row_id`)
          .all(datasetId, canonical, operationId, accountId, bounds.startedAtMs, knownThrough) as Capture[];
        const row = rows.length < 9 ? rows.find(item => item.entry_type === 'bet') : null;
        const resolved = row?.source ? await resolveCasinoPosting(reader, { rowId: row.id, accountId, operationId, gameId: row.source }) : null;
        const value = resolved && row && groupKey(resolved.entity) ? { entity: resolved.entity, proof: postingProof(row) } : null;
        if (value && subjects.has(accountId)) replayEntities.set(riskEvidenceKey(value.proof), value.entity);
        originalCache.set(key, value);
        return value;
      };
      const attemptRows = await audit.prepare(`SELECT account_id,occurred_at_ms,evidence_id,payload->>'route' AS route,
        CASE WHEN pg_column_size(payload)<=131072 THEN payload END AS payload
        FROM ${a}.audit_evidence WHERE dataset_id=? AND kind='attempt' AND account_id=ANY(?::text[])
          AND occurred_at_ms>=? AND occurred_at_ms<=?
        ORDER BY account_id,occurred_at_ms,evidence_id LIMIT ?`)
        .all(datasetId, accounts, lower, upper, maximumSourceRows + 1);
      if (attemptRows.length > maximumSourceRows || await audit.prepare(`SELECT 1 FROM ${a}.audit_attempt_capture_gaps
        WHERE dataset_id=? AND first_at_ms<=? AND last_at_ms>=? LIMIT 1`).get(datasetId, upper, lower)) capped(attemptSample);
      const commands = new Map<string, { accepted: string; original: Original } | 'other' | null>();
      for (const row of attemptRows.slice(0, maximumSourceRows)) {
        selection.signal?.throwIfAborted();
        if (!routes.includes(row.route)) continue;
        const attempt: unknown = row.payload;
        if (!isAuditRecord(attempt) || attempt.type !== 'attempt' || attempt.scope.datasetId !== datasetId ||
            attempt.scope.environment !== scope.environment || attempt.accountId !== row.account_id ||
            attempt.occurredAtMs !== row.occurred_at_ms || attempt.attemptId !== row.evidence_id ||
            attempt.transport !== 'http' || !attempt.operationId) {
          markGap(attemptSample, row.account_id);
          continue;
        }
        const { route, accountId, operationId } = attempt;
        const key = JSON.stringify([route, accountId, operationId]);
        if (!commands.has(key)) {
          const core = route === auditCommandRoutes.core;
          const command = core ? await audit.prepare(`SELECT kind,request_key FROM ${g}.demo_operations
            WHERE account_id=? AND operation_id=?`).get(accountId, operationId) :
            await audit.prepare(`SELECT session_id,request_key FROM ${g}.demo_casino_requests
              WHERE account_id=? AND id=? AND created_at BETWEEN ? AND ?`)
              .get(accountId, operationId, bounds.startedAtMs, knownThrough);
          if (core && command?.kind === 'deposit') commands.set(key, 'other');
          else {
            const parsed = parse(command?.request_key);
            const expansion = !core && validExpansionAction(parsed) && parsed.id === operationId &&
              command?.session_id === (parsed.action === 'start' ? parsed.id : parsed.sessionId) ? parsed : null;
            const start = core && Array.isArray(parsed) && (parsed[0] === 'play' || parsed[0] === 'spin') && parsed[0] === command?.kind
              ? await original(accountId, operationId) : expansion ? await original(accountId, command?.session_id) : null;
            const agrees = start && (expansion ? expansion.gameId === start.entity.gameId :
              Array.isArray(parsed) && parsed[2] === start.entity.gameId && String(parsed[3]) === start.entity.rulesVersion);
            commands.set(key, agrees ? { accepted: fingerprintAuditIntent(route, accountId, operationId, command!.request_key),
              original: start } : null);
          }
        }
        const command = commands.get(key);
        if (command === 'other') continue;
        if (!command || !attempt.intentFingerprint) {
          markGap(attemptSample, accountId);
          continue;
        }
        const changed = command.accepted !== attempt.intentFingerprint;
        if (changed && (attempt.decision !== 'rejected' || attempt.statusCode !== 409)) {
          markGap(attemptSample, accountId);
          continue;
        }
        const primary = { kind: 'attempt' as const, id: attempt.attemptId, accountId, operationId, occurredAtMs: attempt.occurredAtMs };
        add(attemptSample, groupKey(command.original.entity)!, { primary, supporting: [command.original.proof], entity: null, matched: changed });
      }

      selection.signal?.throwIfAborted();
      const moneyRows = await audit.prepare(`WITH refs AS MATERIALIZED (
        SELECT source_row_id,account_id,operation_id,occurred_at_ms FROM ${a}.audit_posting_refs
        WHERE dataset_id=? AND source_namespace=? AND account_id=ANY(?::text[]) AND occurred_at_ms>=? AND occurred_at_ms<=?
        ORDER BY account_id,occurred_at_ms,source_row_id LIMIT ?
      ) SELECT r.source_row_id::text AS id,r.account_id,r.operation_id,r.occurred_at_ms,l.source,l.entry_type FROM refs r
      LEFT JOIN LATERAL (SELECT source,entry_type FROM ${g}.demo_ledger l
        WHERE l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
          AND l.created_at=r.occurred_at_ms LIMIT 1) l ON true`)
        .all(datasetId, canonical, accounts, lower, upper, maximumSourceRows + 1) as Capture[];
      if (moneyRows.length > maximumSourceRows) capped(moneySample);
      const checks = new Map<string, Awaited<ReturnType<typeof checkCapturedCasinoRound>>>();
      const financial = new Map<string, Map<string, FinancialFinding>>();
      const confirmFinding = async (accountId: string, segment: string, code: string,
        sources: AuditSourceRef[], entity: AuditSourceRef, original: Posting) => {
        const postings = sources.filter(ref => ref.namespace === canonical);
        const ids = [...new Set(postings.map(ref => ref.rowId))];
        if (!ids.length) return false;
        const observed = await audit.prepare(`SELECT count(*)::int AS count FROM ${a}.audit_posting_refs
          WHERE dataset_id=? AND source_namespace=? AND account_id=? AND source_row_id=ANY(?::bigint[])
            AND occurred_at_ms<=?`).get(datasetId, canonical, accountId, ids, upper);
        if (observed?.count !== ids.length) return false;
        if (subjects.has(accountId)) {
          const findings = financial.get(segment) ?? new Map();
          const source = sources.find(ref => ref.namespace === gameSchema + '.demo_casino_requests') ?? entity;
          const evidence = [...new Set([...ids, original.source.rowId])].map(rowId => ({ namespace: canonical, rowId }));
          findings.set(JSON.stringify([code, source, evidence]), { code, source, postings: evidence });
          financial.set(segment, findings);
        }
        return true;
      };
      for (const row of moneyRows.slice(0, maximumSourceRows)) {
        selection.signal?.throwIfAborted();
        const { source, entry_type, account_id: accountId, operation_id: operationId } = row;
        if (!source || !entry_type) { markGap(moneySample, accountId); continue; }
        if ((entry_type !== 'bet' && entry_type !== 'refund') || !coreGames.has(source) && !isExpansionGame(source)) continue;
        const resolved = await resolveCasinoPosting(reader, { rowId: row.id, accountId, operationId, gameId: source });
        const resolvedEntity = resolved?.entity ?? (entry_type === 'refund' ? (await original(accountId, operationId))?.entity : null);
        const segment = resolvedEntity && groupKey(resolvedEntity);
        const ids = parse(resolvedEntity?.source.rowId);
        if (!resolvedEntity || !segment || !Array.isArray(ids) || ids[0] !== accountId || typeof ids[1] !== 'string') {
          markGap(moneySample, accountId);
          continue;
        }
        const start = await original(accountId, ids[1]);
        if (!start || riskEntityKey(start.entity) !== riskEntityKey(resolvedEntity)) { markGap(moneySample, accountId); continue; }
        const key = riskEvidenceKey(start.proof);
        if (!checks.has(key)) checks.set(key, await checkCapturedCasinoRound(audit, { datasetId, gameSchema, posting: start.proof.source }));
        const check = checks.get(key);
        if (check?.status === 'source-unavailable') { capped(moneySample); break; }
        if (check?.status !== 'found' || check.basis !== 'dataset') { markGap(moneySample, accountId); continue; }
        const primary = postingProof(row);
        if (resolved && subjects.has(accountId)) replayEntities.set(riskEvidenceKey(primary), resolved.entity);
        const supporting = key === riskEvidenceKey(primary) ? [] : [start.proof];
        const result = check.result;
        if (entry_type === 'refund') {
          const payout = result.payout;
          if (payout.status === 'mismatch' && payout.reason === 'posting-source' && payout.expectedUnits !== null &&
              payout.sources.some(ref => ref.namespace === canonical && ref.rowId === row.id) &&
              await confirmFinding(accountId, segment, 'casino-refund-posting-source', payout.sources, resolvedEntity.source, start.proof)) {
            add(moneySample, segment, { primary, supporting, entity: null, matched: true });
          } else markGap(moneySample, accountId);
          continue;
        }
        const step = result.steps.find(item => item.operationId === operationId);
        if (step?.status === 'match') add(moneySample, segment, { primary, supporting, entity: null, matched: false });
        else if (step?.status === 'mismatch' && step.expectedUnits !== null &&
            (step.reason === 'posting-amount' || step.reason === 'posting-count') &&
            await confirmFinding(accountId, segment, 'casino-step-' + step.reason, step.sources, resolvedEntity.source, start.proof)) {
          // An extra paid action contributes to a behavior rate. A regular stake mismatch stays a separate finding.
          if (step.kind === 'stake' || step.kind === 'unknown') markGap(moneySample, accountId);
          else add(moneySample, segment, { primary, supporting, entity: null, matched: true });
        } else markGap(moneySample, accountId);
      }
      const subjectMoneySegments = [...moneySample.groups].filter(([, rows]) =>
        rows.some(row => subjects.has(row.primary.accountId!))).map(([segment]) => segment);
      selection.signal?.throwIfAborted();
      const moneyCandidates = finish(casinoPurchaseRefundRiskRule, moneySample, [...financial.keys()]);
      for (const candidate of moneyCandidates) {
        const findings = financial.get(candidate.segment);
        if (findings?.size) candidate.financialFindings = [...findings.values()];
      }
      const candidates = [...finish(casinoConflictRiskRule, attemptSample, subjectMoneySegments), ...moneyCandidates];
      await attachRiskReplayJumps(audit, selection, candidates.map(candidate => ({ candidate,
        proofs: candidate.input.observations.flatMap(row => subjects.has(row.primary.accountId!) ?
          casinoRiskReplayPostings(row).flatMap(posting => {
            const entity = replayEntities.get(riskEvidenceKey(posting));
            return entity ? [{ entity, posting }] : [];
          }) : []),
      })));
      return candidates;
    }, { readOnly: true });
  } catch (error) {
    selection.signal?.throwIfAborted();
    if (!boundariesRead || !unavailable(error)) throw error;
    return [...finish(casinoConflictRiskRule, collector(false)), ...finish(casinoPurchaseRefundRiskRule, collector(false))];
  }
}
