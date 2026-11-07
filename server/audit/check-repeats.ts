import { CLUB_FINE_SOURCE } from '../../src/shared/security';
import { SKIN_UUID } from '../../src/shared/skinStudio';
import { parseFineRequest } from '../clubSanctions';
import { identifier, type PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { verifyGameRound } from '../games/core';
import { isAuditRecord, type AuditAttempt, type AuditSourceRef } from './contract';
import { auditCommandRoutes, auditFineIntentKey, auditFineOperationId, fingerprintAuditIntent } from './intents';

type Status = 'match' | 'mismatch' | 'insufficient-data';
type AttemptCheck = { attemptId: string; status: Status; intent: 'same' | 'different' | 'unknown'; reason: string };
type MoneyCheck = { status: Status; reason: string; postings: AuditSourceRef[] };
export type AuditRepeatCheck = {
  status: Status;
  command: AuditSourceRef | null;
  attempts: AttemptCheck[];
  money: MoneyCheck;
  duplicateAcceptedDecision: boolean;
};
type Operation = { datasetId: string; accountId: string; operationId: string; route: string };
type Posting = { id: string; kind: string | null; units: string | null; game: string | null };

export async function migrateAuditOperationLookup(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-operation-lookup-v1', statements: [], indexes: [
    { name: 'audit_posting_refs_operation', table: 'audit_posting_refs',
      columns: ['dataset_id', 'source_namespace', 'operation_id', 'source_row_id'] },
    { name: 'audit_evidence_operation', table: 'audit_evidence',
      columns: ['dataset_id', 'account_id', "(payload->>'operationId')", 'occurred_at_ms', 'evidence_id'],
      where: "kind='attempt'" },
  ] });
}

const missing = (reason: string): AuditRepeatCheck => ({
  status: 'insufficient-data', command: null, attempts: [], money: { status: 'insufficient-data', reason, postings: [] },
  duplicateAcceptedDecision: false,
});

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function checkAttempt(attempt: AuditAttempt, fingerprint: string | null): AttemptCheck {
  const { attemptId, intentFingerprint, decision, response, statusCode, transport, balance } = attempt;
  if (!fingerprint || !intentFingerprint) return { attemptId, intent: 'unknown', status: 'insufficient-data', reason: 'intent-unavailable' };
  if (intentFingerprint === fingerprint) {
    return { attemptId, intent: 'same', status: 'match', reason: 'same-accepted-intent' };
  }
  if (decision === 'rejected') return { attemptId, intent: 'different', status: 'match', reason: 'different-intent-rejected' };
  const successful = response === 'formed' && (transport === 'http'
    ? statusCode !== null && statusCode >= 200 && statusCode < 300
    : balance.state === 'value');
  if (decision === 'accepted' || decision === 'replayed' || successful) {
    return { attemptId, intent: 'different', status: 'mismatch', reason: 'different-intent-succeeded' };
  }
  return { attemptId, intent: 'different', status: 'insufficient-data', reason: 'different-intent-decision-unavailable' };
}

function checkMoney(route: string, namespace: string, rows: Posting[], accepted: {
  kind?: string; amount_units?: string | null; result?: string;
} | null): MoneyCheck {
  const postings = rows.map(row => ({ namespace, rowId: row.id }));
  if (route === auditCommandRoutes.pvp) return { status: 'insufficient-data', reason: 'match-bank-check-required', postings };
  if (rows.some(row => row.units === null || row.kind === null)) {
    return { status: 'insufficient-data', reason: 'canonical-posting-unavailable', postings };
  }
  if (!accepted) return { status: 'insufficient-data', reason: 'accepted-command-unavailable', postings };
  if (route === auditCommandRoutes.fine) {
    if (!rows.length) return { status: 'insufficient-data', reason: 'command-not-in-posting-boundary', postings };
    const matches = rows.length === 1 && rows[0].kind === 'bet' && rows[0].game === CLUB_FINE_SOURCE &&
      rows[0].units === '-' + accepted.amount_units;
    return { status: matches ? 'match' : 'mismatch', reason: matches ? 'single-fine-debit' : 'fine-debit-mismatch', postings };
  }
  if (route !== auditCommandRoutes.core) {
    const debits = rows.filter(row => row.kind === 'bet').length;
    const credits = rows.filter(row => row.kind === 'win' || row.kind === 'refund').length;
    return debits > 1 || credits > 1
      ? { status: 'mismatch', reason: 'duplicate-command-movement', postings }
      : { status: 'insufficient-data', reason: 'round-check-required', postings };
  }
  if (!rows.length) return { status: 'insufficient-data', reason: 'command-not-in-posting-boundary', postings };
  const payload = parseJson(accepted.result) as { gameRound?: unknown } | null;
  const round = verifyGameRound(payload?.gameRound) ? payload.gameRound : null;
  const stake = accepted.amount_units;
  let expected: Map<string, string>;
  if (accepted.kind === 'deposit' && stake && /^[1-9][0-9]*$/.test(stake)) expected = new Map([['deposit', stake]]);
  else if ((accepted.kind === 'play' || accepted.kind === 'spin') && round && stake === round.stakeUnits) {
    expected = new Map([['bet', '-' + round.stakeUnits], ['win', round.payoutUnits]]);
  } else return { status: 'insufficient-data', reason: 'accepted-money-plan-unavailable', postings };
  const actual = new Map(rows.map(row => [row.kind!, row.units!]));
  const matches = rows.length === expected.size && actual.size === expected.size &&
    [...expected].every(([kind, units]) => actual.get(kind) === units) &&
    rows.every(row => row.game === (round?.gameId ?? 'royal-coins'));
  return { status: matches ? 'match' : 'mismatch', reason: matches ? 'single-command-plan' : 'command-money-plan-mismatch', postings };
}

async function fineReceipt(db: PostgresDatabase, game: string, accountId: string, receiptId: string) {
  const row = await db.prepare(`SELECT operation_id AS id,episode_id AS "sanctionId",revision,
      amount_cents AS "amountCents",paid_at AS created_at FROM ${game}club_fine_payments
    WHERE account_id=? AND operation_id=?`).get(accountId, receiptId);
  if (!row) return null;
  try {
    const { created_at, ...fields } = row;
    const fine = parseFineRequest(fields);
    if (fine.amountCents === 0 || !Number.isSafeInteger(created_at) || created_at < 0) return null;
    return { amount_units: String(fine.amountCents), request_key: auditFineIntentKey(fine), created_at };
  } catch {
    return null;
  }
}

/** All comparisons share one read-only database snapshot of the selected dataset and source schema. */
export async function reconcileStoredAuditOperation(db: PostgresDatabase, gameSchema: string, operation: Operation): Promise<AuditRepeatCheck> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema)) throw new Error('Invalid audit game schema');
  const { datasetId, accountId, operationId, route } = operation;
  const core = route === auditCommandRoutes.core, pvp = route === auditCommandRoutes.pvp, fine = route === auditCommandRoutes.fine;
  if (!core && !pvp && !fine && route !== auditCommandRoutes.expansion && route !== auditCommandRoutes.session) return missing('route-unsupported');
  const receiptId = operationId.slice(CLUB_FINE_SOURCE.length + 1);
  if (fine && (!SKIN_UUID.test(receiptId) || auditFineOperationId(receiptId) !== operationId)) return missing('fine-key-unavailable');
  const game = identifier(gameSchema) + '.';
  const ledgerNamespace = gameSchema + '.demo_ledger';
  try {
    return await db.transaction(async () => {
      const scope = await db.prepare(`SELECT d.environment,d.sealed_at_ms FROM audit_datasets d
        JOIN audit_dataset_sources s ON s.dataset_id=d.id WHERE d.id=? AND s.source_namespace=?`).get(datasetId, ledgerNamespace);
      if (!scope) return missing('dataset-source-unavailable');
      const evidence = await db.prepare(`SELECT payload FROM audit_evidence WHERE dataset_id=? AND kind='attempt'
        AND account_id=? AND payload->>'operationId'=? AND payload->>'route'=?
        ORDER BY occurred_at_ms,evidence_id LIMIT 501`).all(datasetId, accountId, operationId, route);
      if (evidence.length > 500) return missing('operation-attempt-limit');
      const attempts = evidence.map(row => row.payload).filter((value: unknown): value is AuditAttempt =>
        isAuditRecord(value) && value.type === 'attempt' && value.accountId === accountId && value.operationId === operationId &&
        value.scope.datasetId === datasetId && value.scope.environment === scope.environment && value.route === route);
      if (attempts.length !== evidence.length) return missing('attempt-evidence-invalid');
      const rows: Posting[] = pvp ? [] : await db.prepare(`SELECT r.source_row_id::text AS id,l.entry_type AS kind,
        l.amount_units::text AS units,l.source AS game FROM audit_posting_refs r
        LEFT JOIN ${game}demo_ledger l ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
        WHERE r.dataset_id=? AND r.source_namespace=? AND r.account_id=? AND r.operation_id=?
        ORDER BY r.source_row_id LIMIT 501`).all(datasetId, ledgerNamespace, accountId, operationId) as Posting[];
      if (rows.length > 500) return missing('operation-posting-limit');
      if (!rows.length && !attempts.length) return missing('operation-not-observed');
      const table = core ? 'demo_operations' : pvp ? 'pvp_requests' : fine ? 'club_fine_payments' : 'demo_casino_requests';
      const source = fine ? await fineReceipt(db, game, accountId, receiptId) : core
        ? await db.prepare(`SELECT kind,amount_units::text,result,request_key FROM ${game}${table}
          WHERE account_id=? AND operation_id=?`).get(accountId, operationId)
        : await db.prepare(`SELECT request_key,created_at FROM ${game}${table} WHERE account_id=? AND id=?`).get(accountId, operationId);
      const key = parseJson(source?.request_key);
      const routeMatches = core || pvp || fine || key !== null && typeof key === 'object' &&
        Array.isArray(key) === (route === auditCommandRoutes.session);
      // Without a captured posting or an explicit accepted reply, a later request cannot close a sealed dataset's ambiguity.
      const seenInSealed = rows.length > 0 || attempts.some(attempt => attempt.decision === 'accepted' || attempt.decision === 'replayed');
      const accepted = source && routeMatches && (scope.sealed_at_ms === null || seenInSealed) &&
        (source.created_at === undefined || scope.sealed_at_ms === null || source.created_at <= scope.sealed_at_ms) ? source : null;
      const command = accepted ? { namespace: gameSchema + '.' + table, rowId: JSON.stringify([accountId, fine ? receiptId : operationId]) } : null;
      const fingerprint = typeof accepted?.request_key === 'string'
        ? fingerprintAuditIntent(route, accountId, operationId, accepted.request_key) : null;
      const outcomes = attempts.map(attempt => checkAttempt(attempt, fingerprint));
      const money = checkMoney(route, ledgerNamespace, rows, accepted);
      const duplicateAcceptedDecision = attempts.filter(attempt => attempt.decision === 'accepted').length > 1;
      const status = duplicateAcceptedDecision || money.status === 'mismatch' || outcomes.some(item => item.status === 'mismatch') ? 'mismatch'
        : outcomes.length && money.status === 'match' && outcomes.every(item => item.status === 'match') ? 'match' : 'insufficient-data';
      return { status, command, attempts: outcomes, money, duplicateAcceptedDecision };
    }, { readOnly: true });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && (code.startsWith('08') || ['42P01', '3F000', '42501', 'ECONNREFUSED', 'ECONNRESET'].includes(code))) {
      return missing('source-unavailable');
    }
    throw error;
  }
}
