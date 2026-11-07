import { isDeepStrictEqual } from 'node:util';
import { identifier, type PostgresDatabase } from '../database';
import { expansionInitialCost, type ExpansionState } from '../demoExpansion';
import { prepareGame, verifyGameRound } from '../games/core';
import { AFTER_GAME, validAfterSettlement } from '../../src/shared/afterglow';
import { CARAMEL_GAME, caramelCost, validCaramelSettings, validCaramelSettlement } from '../../src/shared/caramelCarnival';
import { CARIBBEAN_GAME, caribbeanInitialCost } from '../../src/shared/caribbeanTreasures';
import { validCaribbeanSession, validCaribbeanTransportSettings } from '../../src/shared/caribbeanTransport';
import { isExpansionGame, validExpansionAction, validExpansionRulesVersion, type ExpansionAction } from '../../src/shared/casinoExpansion';
import { PENALTY_GAME, validPenaltySession } from '../../src/shared/crLeo';
import { DRACONA_GAME, validDraconaSettlement } from '../../src/shared/dracona';
import { FLAG_GAME, validFlagSession } from '../../src/shared/flagBattle';
import { TEMPLE_GAME, validTempleSettlement } from '../../src/shared/floodedTemple';
import { validCascadeSettlement } from '../../src/shared/floodedTempleCascade';
import { FOREST_HEART_GAME, validForestHeartSettlement } from '../../src/shared/forestHeart';
import { gameBetCents } from '../../src/shared/gameStakes';
import { JACKIE_GAME, validJackieSession } from '../../src/shared/jackieChan';
import { CONVOY_GAME, validConvoySettlement } from '../../src/shared/lastConvoy';
import { isLuelonSlotGame, luelonSlotInitialCost, validLuelonSlotSettings, validLuelonSlotSettlement } from '../../src/shared/luelonSlots';
import { isNitroFamily } from '../../src/shared/memeOverload';
import { NEOPOLIS_GAME, validNeopolisSettlement } from '../../src/shared/neopolis';
import { validNitroSettlement } from '../../src/shared/nitroRun';
import { expansionExactAward, precisionBaseSession } from '../../src/shared/roundPrecision';
import { isStudioGame, validStudioSettlement } from '../../src/shared/studioGames';
import { WILD_NUDGE_GAME, validWildNudgeSession } from '../../src/shared/wildNudgeStakes';
import { casinoExpansionMode, resolveCasinoPosting } from './casino';
import { isAuditEntityRef, type AuditEntityRef, type AuditScope, type AuditSourceRef } from './contract';

type CasinoEntity = AuditEntityRef & { category: 'casino' };
type RoundKey = { accountId: string; entity: CasinoEntity };
type RoundReader = Pick<PostgresDatabase, 'schema' | 'prepare'> & { capture?: { schema: string; datasetId: string } };
type AmountReason = 'source-unavailable' | 'unsupported-version' | 'accepted-terms-unavailable'
  | 'accepted-terms-conflict' | 'step-cost-unavailable' | 'evidence-limit' | 'saved-outcome-unavailable'
  | 'saved-outcome-invalid' | 'precision-unavailable' | 'posting-count' | 'posting-amount' | 'posting-source'
  | 'spent-total-conflict' | 'step-receipts-unavailable' | 'dataset-sealed';
type CasinoAmountCheck = {
  status: 'match' | 'mismatch' | 'insufficient-data';
  reason: AmountReason | null;
  expectedUnits: string | null;
  observedUnits: string | null;
  sources: AuditSourceRef[];
};
type CasinoStepCheck = CasinoAmountCheck & {
  operationId: string;
  kind: 'stake' | 'paid-option' | 'free' | 'no-op' | 'unknown';
};
export type CasinoRoundCheck = {
  state: 'open' | 'settled' | 'unknown';
  stake: CasinoAmountCheck;
  steps: CasinoStepCheck[];
  payout: CasinoAmountCheck & { state: 'open' | 'zero' | 'paid' | 'unknown' };
};

type LedgerRow = { id: string; operation_id: string; source: string; entry_type: string; amount_units: string };
type Start = Extract<ExpansionAction, { action: 'start' }>;
type RequestRow = { id: string; request_key: string };

const maxRoundEvidence = 512;
const units = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function source(db: RoundReader, table: string, rowId: string): AuditSourceRef {
  return { namespace: db.schema + '.' + table, rowId };
}

function amountCheck(
  status: CasinoAmountCheck['status'], reason: AmountReason | null, sources: AuditSourceRef[],
  expected: bigint | null = null, observed: bigint | null = null,
): CasinoAmountCheck {
  return { status, reason, expectedUnits: expected?.toString() ?? null, observedUnits: observed?.toString() ?? null, sources };
}

function missing(ref: AuditSourceRef, reason: AmountReason, state: CasinoRoundCheck['state'] = 'unknown'): CasinoRoundCheck {
  return {
    state, stake: amountCheck('insufficient-data', reason, [ref]), steps: [],
    payout: { ...amountCheck('insufficient-data', reason, [ref]), state: state === 'open' ? 'open' : 'unknown' },
  };
}

const total = (rows: LedgerRow[]) => rows.reduce((sum, row) => sum + BigInt(row.amount_units), 0n);
const debits = (rows: LedgerRow[]) => rows.filter(row => row.entry_type === 'bet');
const credits = (rows: LedgerRow[]) => rows.filter(row => row.entry_type !== 'bet');

function postingCheck(
  db: RoundReader, key: RoundKey, evidence: AuditSourceRef[], rows: LedgerRow[],
  expected: bigint | null, side: 'stake' | 'payout', expectedCount: number | null,
  gap: AmountReason | null = null, conflict: AmountReason | null = null,
): CasinoAmountCheck {
  const observed = (side === 'stake' ? -1n : 1n) * total(rows);
  const refs = [...evidence, ...rows.map(row => source(db, 'demo_ledger', row.id))];
  if (rows.some(row => row.source !== key.entity.gameId || side === 'payout' && row.entry_type !== 'win')) {
    return amountCheck('mismatch', 'posting-source', refs, expected, observed);
  }
  if (conflict) return amountCheck('mismatch', conflict, refs, expected, observed);
  if (expectedCount !== null && rows.length !== expectedCount) {
    return amountCheck('mismatch', 'posting-count', refs, expected, observed);
  }
  if (expected === null) return amountCheck('insufficient-data', gap ?? 'accepted-terms-unavailable', refs, expected, observed);
  return observed === expected ? amountCheck('match', null, refs, expected, observed)
    : amountCheck('mismatch', 'posting-amount', refs, expected, observed);
}

function payoutCheck(
  db: RoundReader, key: RoundKey, rows: LedgerRow[], state: CasinoRoundCheck['state'],
  expected: bigint | null, gap: AmountReason | null = null, conflict: AmountReason | null = null,
): CasinoRoundCheck['payout'] {
  const check = postingCheck(db, key, [key.entity.source], rows, expected, 'payout',
    state === 'open' ? 0 : state === 'settled' ? 1 : null, gap, conflict);
  return { ...check, state: state === 'open' ? 'open' : expected === null ? 'unknown' : expected === 0n ? 'zero' : 'paid' };
}

async function ledger(db: RoundReader, accountId: string, operationIds: string[]): Promise<LedgerRow[]> {
  const scope = db.capture;
  const captured = scope ? ` AND EXISTS (SELECT 1 FROM ${identifier(scope.schema)}.audit_posting_refs r
    WHERE r.dataset_id=? AND r.source_namespace=? AND r.source_row_id=l.id
      AND r.account_id=l.account_id AND r.operation_id=l.operation_id AND r.occurred_at_ms=l.created_at)` : '';
  return await db.prepare(`SELECT l.id::text,l.operation_id,l.source,l.entry_type,l.amount_units::text
    FROM ${identifier(db.schema)}.demo_ledger l
    WHERE l.account_id=? AND l.operation_id=ANY(?::text[])${captured} ORDER BY l.id LIMIT ?`)
    .all(accountId, operationIds, ...(scope ? [scope.datasetId, db.schema + '.demo_ledger'] : []), maxRoundEvidence + 1) as LedgerRow[];
}

async function instantOperation(db: RoundReader, accountId: string, id: string) {
  return db.prepare(`SELECT kind,amount_units::text,request_key,result FROM ${identifier(db.schema)}.demo_operations
    WHERE account_id=? AND operation_id=? AND kind IN ('play','spin')`).get(accountId, id);
}

async function checkInstant(db: RoundReader, key: RoundKey, id: string): Promise<CasinoRoundCheck> {
  const ref = key.entity.source;
  const stored = await instantOperation(db, key.accountId, id);
  if (!stored) return missing(ref, 'source-unavailable');
  const saved = parse(stored.result), accepted = parse(stored.request_key);
  const round = record(saved) && record(saved.gameRound) ? saved.gameRound : null;
  const version = key.entity.rulesVersion;
  const tuplePresent = Array.isArray(accepted) && (accepted.length === 5 || accepted.length === 6);
  if (!version || key.entity.modeId !== 'normal') return missing(ref, 'unsupported-version', 'settled');
  try { prepareGame(key.entity.gameId, Number(version), tuplePresent ? accepted[4] : round?.input); } catch {
    return missing(ref, 'unsupported-version', 'settled');
  }
  const rows = await ledger(db, key.accountId, [id]);
  if (rows.length > maxRoundEvidence) return missing(ref, 'evidence-limit', 'settled');
  const acceptedUnits = units(stored.amount_units) && stored.amount_units !== '0' ? BigInt(stored.amount_units) : null;
  const termsMatch = tuplePresent && accepted[0] === stored.kind && gameBetCents(accepted[1])?.toString() === stored.amount_units
    && accepted[2] === key.entity.gameId && String(accepted[3]) === version && (accepted.length === 5 || accepted[5] === 1);
  const roundTermsMatch = round !== null && round.stakeUnits === stored.amount_units
    && isDeepStrictEqual(tuplePresent ? accepted[4] : null, round.input);
  const stake = postingCheck(db, key, [ref], debits(rows), tuplePresent ? acceptedUnits : null, 'stake', 1,
    null, tuplePresent && (!termsMatch || round !== null && !roundTermsMatch) ? 'accepted-terms-conflict' : null);
  const outcomeValid = verifyGameRound(round) && round.gameId === key.entity.gameId && String(round.rulesVersion) === version;
  const precisionMissing = tuplePresent && accepted[5] === 1 && round !== null && !Object.hasOwn(round, 'precision');
  const outcomeConfirmed = outcomeValid && termsMatch && roundTermsMatch && !precisionMissing
    && (accepted[5] === 1 || !round.precision);
  const invalid = round !== null && !precisionMissing && (!outcomeValid || tuplePresent && accepted[5] !== 1 && !!round.precision);
  return {
    state: 'settled', stake, steps: [{ ...stake, operationId: id, kind: 'stake' }],
    payout: payoutCheck(db, key, credits(rows), 'settled', outcomeConfirmed ? BigInt(round.payoutUnits) : null,
      precisionMissing ? 'precision-unavailable' : round === null ? 'saved-outcome-unavailable' : 'accepted-terms-unavailable',
      invalid ? 'saved-outcome-invalid' : null),
  };
}

function expectedStart(start: Start): bigint {
  const { gameId, settings, stakeUnits } = start;
  if (gameId === CARIBBEAN_GAME && validCaribbeanTransportSettings(settings)) {
    return BigInt(caribbeanInitialCost(settings.caribbean, stakeUnits));
  }
  const factor = gameId === CARAMEL_GAME && validCaramelSettings(settings) ? caramelCost(settings)
    : isLuelonSlotGame(gameId) && validLuelonSlotSettings(gameId, settings) ? luelonSlotInitialCost(gameId, settings)
    : expansionInitialCost(gameId, 'side' in settings ? settings.side : false);
  return BigInt(stakeUnits) * BigInt(factor);
}

function crashOutcome(s: ExpansionState, automatic: boolean): boolean {
  if (typeof s.crashPoint !== 'number' || !Number.isFinite(s.crashPoint) || s.crashPoint < 1 || s.crashPoint > 100
    || !Number.isSafeInteger(s.startedAt)) return false;
  if (s.state === 'active') return s.multiplier === undefined && s.returnedUnits === '0';
  const m = s.multiplier;
  if (typeof m !== 'number' || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(m))) return false;
  if (automatic ? m !== (s.crashPoint === 100 ? 100 : 0) : m < 1 || m > s.crashPoint) return false;
  const award = expansionExactAward(s);
  return BigInt(s.returnedUnits) === award.numerator / award.denominator;
}

// null means the source version has no independently checkable outcome here.
function expansionOutcome(s: ExpansionState, automatic: boolean): boolean | null {
  const { gameId, state, stakeUnits: stake, spentUnits: spent, returnedUnits: returned, view, rulesVersion: version } = s;
  const visible = { id: s.id, gameId, rulesVersion: version, state, stakeUnits: stake, spentUnits: spent, returnedUnits: returned, view };
  if (gameId === 'github-crash') return crashOutcome(s, automatic);
  if (gameId === WILD_NUDGE_GAME) return validWildNudgeSession(visible);
  if (gameId === PENALTY_GAME) return validPenaltySession(visible);
  if (gameId === FLAG_GAME) return validFlagSession(visible) && view.flags?.country === (s.settings as { flags?: { country?: unknown } }).flags?.country;
  if (gameId === JACKIE_GAME) return validJackieSession(visible);
  if (gameId === CARIBBEAN_GAME) return validCaribbeanSession(visible)
    && validCaribbeanTransportSettings(s.settings) && isDeepStrictEqual(view.caribbean?.settings, s.settings.caribbean);
  if (gameId === TEMPLE_GAME) return version === 2 ? validCascadeSettlement(state, stake, spent, returned, view.templeCascade)
    : validTempleSettlement(state, stake, spent, returned, view.temple);
  if (gameId === FOREST_HEART_GAME) return validForestHeartSettlement(state, stake, spent, returned, view.forestHeart);
  if (gameId === NEOPOLIS_GAME) return version === view.neopolis?.version && validNeopolisSettlement(state, stake, spent, returned, view.neopolis);
  if (gameId === DRACONA_GAME) return version === Number(view.dracona?.version) + 1 && validDraconaSettlement(state, stake, spent, returned, view.dracona);
  if (gameId === AFTER_GAME && version === 2) return validAfterSettlement(state, stake, spent, returned, view.afterglow);
  if (isNitroFamily(gameId) && version === 2) return validNitroSettlement(state, stake, spent, returned, view.nitro);
  if (gameId === CONVOY_GAME && version === 2) return validConvoySettlement(state, stake, spent, returned, view.convoy);
  if (gameId === CARAMEL_GAME && version === 2) return validCaramelSettings(s.settings)
    && view.caramel?.mode === s.settings.caramel.mode && validCaramelSettlement(state, stake, spent, returned, view.caramel);
  if (isLuelonSlotGame(gameId) && version === 2) return validLuelonSlotSettings(gameId, s.settings)
    && view.luelon?.mode === s.settings.luelon.mode && validLuelonSlotSettlement(gameId, state, stake, spent, returned, view.luelon);
  return version === 1 && isStudioGame(gameId) ? validStudioSettlement(gameId, state, stake, spent, returned, view.studio) : null;
}

function acceptedRequest(row: RequestRow, id: string, gameId: string): ExpansionAction | null {
  const value = parse(row.request_key);
  if (!validExpansionAction(value) || value.id !== row.id || value.gameId !== gameId) return null;
  if (value.action === 'start') return value.id === id ? value : null;
  return value.sessionId === id && (gameId !== 'github-crash' || value.move === 'cashout') ? value : null;
}

// These versioned transcripts advance one revision per accepted continuation.
function continuationBounds(s: ExpansionState): [number, number] | null {
  const v = s.view;
  if (v.caramel) return [v.caramel.history[0]?.kind === 'base' ? 1 : 0, v.caramel.revision];
  if (v.luelon) return [v.luelon.history[0]?.kind === 'base' ? 1 : 0, v.luelon.revision];
  const transcript = v.wildNudge ?? v.jackie?.combat ?? v.forestHeart ?? v.templeCascade ?? v.temple
    ?? v.caribbean ?? v.neopolis ?? v.dracona ?? v.penalty ?? v.afterglow ?? v.nitro ?? v.convoy;
  return transcript ? [1, transcript.revision] : null;
}

async function checkExpansion(db: RoundReader, key: RoundKey, id: string): Promise<CasinoRoundCheck> {
  const ref = key.entity.source, game = key.entity.gameId;
  const row = await db.prepare(`SELECT state,payload FROM ${identifier(db.schema)}.demo_casino_sessions WHERE account_id=? AND id=? AND game_id=?`)
    .get(key.accountId, id, game);
  if (!row) return missing(ref, 'source-unavailable');
  const state = row.state === 'active' ? 'open' : row.state === 'settled' ? 'settled' : 'unknown';
  const raw = parse(row.payload);
  if (!isExpansionGame(game)) return missing(ref, 'unsupported-version', state);
  if (!record(raw) || raw.id !== id || raw.gameId !== game || raw.state !== row.state || state === 'unknown'
    || !units(raw.stakeUnits) || raw.stakeUnits === '0' || !units(raw.spentUnits) || !units(raw.returnedUnits) || !record(raw.view)) {
    return missing(ref, 'saved-outcome-unavailable', state);
  }
  if (!validExpansionRulesVersion(game, raw.rulesVersion) || String(raw.rulesVersion) !== key.entity.rulesVersion) {
    return missing(ref, 'unsupported-version', state);
  }
  const s = raw as ExpansionState;
  const mode = casinoExpansionMode(game, s.rulesVersion, s.settings);
  if (mode === null || mode !== key.entity.modeId) return missing(ref, 'accepted-terms-unavailable', state);
  const requests = await db.prepare(`SELECT id,request_key FROM ${identifier(db.schema)}.demo_casino_requests WHERE account_id=? AND session_id=?
    ORDER BY (id=?) DESC,created_at,id LIMIT ?`).all(key.accountId, id, id, maxRoundEvidence + 1) as RequestRow[];
  if (requests.length > maxRoundEvidence) return missing(ref, 'evidence-limit', state);
  const startRow = requests.find(request => request.id === id);
  const start = startRow ? acceptedRequest(startRow, id, game) : null;
  const startCost = start?.action === 'start' ? expectedStart(start) : null;
  const termsConflict = start?.action === 'start' && (s.stakeUnits !== start.stakeUnits
    || !isDeepStrictEqual(s.settings, start.settings) || s.stakePolicyVersion !== start.stakePolicyVersion);
  const rows = await ledger(db, key.accountId, [...new Set([id, ...requests.map(request => request.id)])]);
  if (rows.length > maxRoundEvidence) return missing(ref, 'evidence-limit', state);
  const win = credits(rows);
  const crashAuto = game === 'github-crash' && (win.length ? win.some(row => row.operation_id === id) : s.multiplier === 0 || s.multiplier === 100);
  const base = precisionBaseSession(s);
  let baseValid: boolean | null = null;
  try { if (base) baseValid = expansionOutcome(base, crashAuto); } catch { baseValid = false; }
  // For the supported expansion versions, the opening price is the only debit.
  // Legacy card variants lack a durable per-step price and remain individually unverified.
  const freeMoves = baseValid !== null || game === 'github-crash';
  const operations = (startRow ? requests : [{ id, request_key: '' }, ...requests]).map(request => ({
    request, operation: acceptedRequest(request, id, game),
  }));
  const bounds = baseValid === true ? continuationBounds(s) : null;
  const moves = operations.filter(({ request }) => request.id !== id)
    .map(({ operation }) => operation?.action === 'move' ? operation : null);
  const revisions = new Set(moves.map(move => move?.revision));
  const traceGap = bounds !== null && (moves.length !== bounds[1] - bounds[0]
    || Array.from({ length: bounds[1] - bounds[0] }, (_, i) => bounds[0] + i).some(revision => !revisions.has(revision)));
  const terminal = !bounds || traceGap ? null : moves.find(move => move?.revision === bounds[1] - 1)?.id ?? id;
  const steps: CasinoStepCheck[] = operations.map(({ request, operation }) => {
    const refs = [ref, ...(request.request_key ? [source(db, 'demo_casino_requests', JSON.stringify([key.accountId, request.id]))] : [])];
    const isStart = request.id === id;
    const noOp = game === 'github-crash' && operation?.action === 'move' && state === 'settled'
      && win.length === 1 && win[0].operation_id !== request.id;
    const cost = isStart ? startCost : operation?.action === 'move' && freeMoves ? 0n : null;
    const kind = isStart ? cost !== null && start?.action === 'start' && cost !== BigInt(start.stakeUnits) ? 'paid-option' : 'stake'
      : noOp ? 'no-op' : cost === 0n ? 'free' : 'unknown';
    const check = postingCheck(db, key, refs, debits(rows).filter(row => row.operation_id === request.id), cost, 'stake',
      cost === null ? null : cost === 0n ? 0 : 1, isStart ? 'accepted-terms-unavailable' : 'step-cost-unavailable',
      isStart && termsConflict ? 'accepted-terms-conflict' : null);
    return { ...check, operationId: request.id, kind };
  });
  const expectedStake = steps.every(step => step.expectedUnits !== null)
    ? steps.reduce((sum, step) => sum + BigInt(step.expectedUnits!), 0n) : null;
  const observedStake = -total(debits(rows));
  const failed = steps.find(step => step.status === 'mismatch');
  const gap = steps.find(step => step.status === 'insufficient-data');
  const stakeRefs = steps.flatMap(step => step.sources.filter(item => item !== ref));
  const stake = failed ? amountCheck('mismatch', failed.reason, [ref, ...stakeRefs], expectedStake, observedStake)
    : observedStake !== BigInt(s.spentUnits) ? amountCheck('mismatch', 'spent-total-conflict', [ref, ...stakeRefs], expectedStake, observedStake)
    : gap || traceGap ? amountCheck('insufficient-data', gap?.reason ?? 'step-receipts-unavailable', [ref, ...stakeRefs],
      traceGap ? null : expectedStake, observedStake)
    : amountCheck('match', null, [ref, ...stakeRefs], expectedStake, observedStake);

  const precisionMissing = state === 'settled' && s.stakePolicyVersion === 1 && !Object.hasOwn(s, 'precision');
  const outcomeConfirmed = baseValid === true && !precisionMissing && !termsConflict && start?.action === 'start';
  const expectation = outcomeConfirmed ? BigInt(s.returnedUnits) : null;
  const wrongSettlementRequest = state === 'settled' && (terminal !== null && win.some(row => row.operation_id !== terminal)
    || game === 'github-crash' && !crashAuto && win.some(row => !moves.some(move => move?.id === row.operation_id)));
  const payout = traceGap && state === 'settled'
    ? { ...amountCheck('insufficient-data', 'step-receipts-unavailable', [ref], expectation), state: 'unknown' as const }
    : payoutCheck(db, key, win, freeMoves ? state : 'unknown', expectation,
      precisionMissing ? 'precision-unavailable' : baseValid === null ? 'saved-outcome-unavailable' : 'accepted-terms-unavailable',
      wrongSettlementRequest ? 'posting-source'
        : !precisionMissing && (!base || baseValid === false || s.stakePolicyVersion !== 1 && Object.hasOwn(s, 'precision')) ? 'saved-outcome-invalid'
        : termsConflict ? 'accepted-terms-conflict' : null);
  return { state, stake, steps, payout };
}

/** Reads only the selected round and its linked postings in a repeatable-read snapshot.
 * Session state is current source state, so it cannot stand in for an as-of dataset boundary.
 */
export async function checkCasinoRound(db: PostgresDatabase, key: RoundKey): Promise<CasinoRoundCheck> {
  const entity = key.entity;
  const id = roundId(key);
  if (!id) return missing(entity.source, 'source-unavailable');
  const { accountId } = key;
  if (entity.source.namespace === db.schema + '.demo_operations') {
    return db.transaction(() => checkInstant(db, { accountId, entity }, id), { readOnly: true });
  }
  if (entity.source.namespace === db.schema + '.demo_casino_sessions') {
    return db.transaction(() => checkExpansion(db, { accountId, entity }, id), { readOnly: true });
  }
  return missing(entity.source, 'source-unavailable');
}

type CapturedRound = { datasetId: string; gameSchema: string } &
  ({ posting: AuditSourceRef } | { opening: RoundKey });
export type CapturedCasinoRoundCheck = {
  status: 'found';
  scope: AuditScope;
  accountId: string;
  entity: CasinoEntity;
  basis: 'dataset' | 'current-source-only' | 'unavailable-as-of-seal';
  result: CasinoRoundCheck;
} | { status: 'not-captured' | 'source-unavailable' | 'unsupported' };

const uuid = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const ledgerId = (id: string) => /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;

function roundId(key: RoundKey): string | null {
  const tuple = parse(key.entity.source.rowId);
  return isAuditEntityRef(key.entity) && key.entity.category === 'casino' && Array.isArray(tuple)
    && tuple.length === 2 && typeof key.accountId === 'string' && tuple[0] === key.accountId
    && typeof tuple[1] === 'string' && tuple[1] ? tuple[1] : null;
}

async function acceptedInstantEntity(reader: RoundReader, accountId: string, id: string): Promise<CasinoEntity | null> {
  const stored = await instantOperation(reader, accountId, id);
  const accepted = parse(stored?.request_key);
  if (!Array.isArray(accepted) || accepted[0] !== stored?.kind) return null;
  try {
    const game = prepareGame(accepted[2], accepted[3], accepted[4]);
    return { gameId: game.gameId, rulesVersion: String(game.rulesVersion), modeId: 'normal', category: 'casino', kind: 'round',
      source: source(reader, 'demo_operations', JSON.stringify([accountId, id])), ticketId: null };
  } catch { return null; }
}

/** Authorizes one round via a dataset posting or an opening obligation. Both schemas are read in one PostgreSQL snapshot. */
export async function checkCapturedCasinoRound(audit: PostgresDatabase, input: CapturedRound): Promise<CapturedCasinoRoundCheck> {
  const { datasetId, gameSchema } = input;
  if (!uuid(datasetId) || !/^[a-z_][a-z0-9_]{0,62}$/.test(gameSchema) || audit.schema === gameSchema) {
    return { status: 'not-captured' };
  }
  const ns = gameSchema + '.demo_ledger';
  const sessionTable = gameSchema + '.demo_casino_sessions';
  if ('posting' in input && (input.posting.namespace !== ns || !ledgerId(input.posting.rowId))) {
    return { status: 'not-captured' };
  }
  const schema = identifier(audit.schema);
  const game = identifier(gameSchema);
  const reader: RoundReader = { schema: gameSchema, prepare: audit.prepare.bind(audit), capture: { schema: audit.schema, datasetId } };
  return audit.transaction<CapturedCasinoRoundCheck>(async () => {
    const dataset = await audit.prepare(`SELECT d.environment,d.sealed_at_ms FROM ${schema}.audit_datasets d
      JOIN ${schema}.audit_dataset_sources s ON s.dataset_id=d.id WHERE d.id=? AND s.source_namespace=?`).get(datasetId, ns);
    if (!dataset || dataset.environment !== 'test' && dataset.environment !== 'live') return { status: 'not-captured' };
    let key: RoundKey;
    if ('posting' in input) {
      const captured = await audit.prepare(`SELECT r.account_id,r.operation_id,r.occurred_at_ms,l.source,l.created_at
        FROM ${schema}.audit_posting_refs r
        LEFT JOIN ${game}.demo_ledger l ON l.id=r.source_row_id AND l.account_id=r.account_id AND l.operation_id=r.operation_id
        WHERE r.dataset_id=? AND r.source_namespace=? AND r.source_row_id=?`).get(datasetId, ns, input.posting.rowId);
      if (!captured) return { status: 'not-captured' };
      if (captured.source === null || captured.created_at !== captured.occurred_at_ms) return { status: 'source-unavailable' };
      const resolved = await resolveCasinoPosting(reader, { rowId: input.posting.rowId, accountId: captured.account_id,
        operationId: captured.operation_id, gameId: captured.source });
      // A damaged outcome must remain detectable from the independently saved accepted instant terms.
      const entity = resolved?.entity ?? await acceptedInstantEntity(reader, captured.account_id, captured.operation_id);
      if (!entity) return { status: 'unsupported' };
      key = { accountId: captured.account_id, entity };
    } else {
      key = input.opening;
      if (key.entity.source.namespace !== sessionTable) return { status: 'not-captured' };
    }
    const id = roundId(key);
    if (!id) return { status: 'not-captured' };
    const isSession = key.entity.source.namespace === sessionTable;
    const opening = isSession && !!await audit.prepare(`SELECT 1 FROM ${schema}.audit_opening_obligations
      WHERE dataset_id=? AND source_namespace=? AND account_id=? AND entity_id=?`).get(datasetId, sessionTable, key.accountId, id);
    if ('opening' in input) {
      if (!opening) return { status: 'not-captured' };
      const session = await audit.prepare(`SELECT game_id FROM ${game}.demo_casino_sessions WHERE account_id=? AND id=?`)
        .get(key.accountId, id);
      if (!session || session.game_id !== key.entity.gameId) return { status: 'source-unavailable' };
    }
    const scope = { datasetId, environment: dataset.environment } as const;
    if (isSession && dataset.sealed_at_ms !== null) {
      return { status: 'found', scope, ...key, basis: 'unavailable-as-of-seal', result: missing(key.entity.source, 'dataset-sealed') };
    }
    if (isSession && !opening) {
      const uncapturedStart = await audit.prepare(`SELECT 1 FROM ${game}.demo_ledger l
        WHERE l.account_id=? AND l.operation_id=? AND l.source=? AND l.entry_type='bet'
          AND NOT EXISTS (SELECT 1 FROM ${schema}.audit_posting_refs r
            WHERE r.dataset_id=? AND r.source_namespace=? AND r.source_row_id=l.id) LIMIT 1`)
        .get(key.accountId, id, key.entity.gameId, datasetId, ns);
      if (uncapturedStart) return { status: 'not-captured' };
    }
    const result = isSession ? await checkExpansion(opening ? { ...reader, capture: undefined } : reader, key, id)
      : await checkInstant(reader, key, id);
    return { status: 'found', scope, ...key, basis: opening ? 'current-source-only' : 'dataset', result };
  }, { readOnly: true }).catch((error: unknown) => {
    const code = (error as { code?: string } | null)?.code;
    if (typeof code === 'string' && (code.startsWith('08') ||
      ['42P01', '3F000', '42501', '57014', 'ECONNREFUSED', 'ECONNRESET'].includes(code))) return { status: 'source-unavailable' };
    throw error;
  });
}
