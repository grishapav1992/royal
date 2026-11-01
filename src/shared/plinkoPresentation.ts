import {precisionBaseRound} from './roundPrecision';
import {validGameBet} from './gameStakes';
import { getPlinkoMultipliers, multiplierRatio, type PlinkoRisk } from './originalGames';

export type PlinkoPresentationGame = 'royal-plinko' | 'variant-plinko';
export type PlinkoPresentationRisk = PlinkoRisk | 'low' | 'high';
export type PlinkoDirection = 0 | 1;
export type PlinkoPresentationBall = Readonly<{
  ballIndex: number;
  path: readonly PlinkoDirection[];
  bucket: number;
  multiplier: number;
  stakeUnits: string;
  returnedUnits: string;
}>;
export type PlinkoPresentation = Readonly<{
  gameId: PlinkoPresentationGame;
  outcomeId: string;
  rows: number;
  risk: PlinkoPresentationRisk;
  table: readonly number[];
  stakeUnits: string;
  returnedUnits: string;
  unallocatedStakeUnits: string;
  balls: readonly PlinkoPresentationBall[];
}>;

const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key =>
    typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
};
const fields = (value: Record<string, unknown>, expected: string) => Reflect.ownKeys(value).sort().join(',') === expected.split(',').sort().join(',');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const units = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(value);
const dense = (value: unknown, length: number): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length === length
  && Reflect.ownKeys(value).length === length + 1 && Array.from({ length }, (_, index) =>
    Object.hasOwn(value, index) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, 'value')).every(Boolean);
const emptyArray = (value: unknown) => dense(value, 0);
const royalRisk = (value: unknown): value is PlinkoRisk => value === 'easy' || value === 'medium' || value === 'hard' || value === 'expert';
const variantRisk = (value: unknown): value is 'low' | 'medium' | 'high' => value === 'low' || value === 'medium' || value === 'high';
const input = (value: unknown): value is { rows: number; risk: PlinkoRisk } => record(value) && fields(value, 'rows,risk')
  && typeof value.rows === 'number' && Number.isInteger(value.rows) && value.rows >= 8 && value.rows <= 16 && royalRisk(value.risk);

function ball(ballIndex: number, path: unknown, bucket: unknown, multiplier: unknown, rows: number, table: number[], stake: bigint): PlinkoPresentationBall | null {
  if (!dense(path, rows) || !path.every(direction => direction === 0 || direction === 1) || typeof bucket !== 'number'
    || !Number.isInteger(bucket) || bucket !== (path as PlinkoDirection[]).reduce<number>((sum, direction) => sum + direction, 0)
    || multiplier !== table[bucket]) return null;
  const ratio = multiplierRatio(table[bucket]);
  return Object.freeze({ ballIndex, path: Object.freeze([...path]) as readonly PlinkoDirection[], bucket, multiplier: table[bucket],
    stakeUnits: stake.toString(), returnedUnits: (stake * ratio.numerator / ratio.denominator).toString() });
}
function presentation(gameId: PlinkoPresentationGame, outcomeId: string, rows: number, risk: PlinkoPresentationRisk,
  table: number[], stakeUnits: string, returnedUnits: string, unallocatedStakeUnits: string, balls: PlinkoPresentationBall[]): PlinkoPresentation {
  return Object.freeze({ gameId, outcomeId, rows, risk, table: Object.freeze([...table]), stakeUnits, returnedUnits, unallocatedStakeUnits, balls: Object.freeze(balls) });
}

/** The operation is the captured request, never an identity or path inferred from a ledger or payout. */
export function royalPlinkoPresentation(operation: unknown, round: unknown): PlinkoPresentation | null {
  const actualRound=round;round=precisionBaseRound(round);
  if(record(operation)&&operation.stakePolicyVersion===1){const {stakePolicyVersion,...base}=operation;operation=base;}
  if (!record(operation) || !fields(operation, 'id,kind,amount,gameId,rulesVersion,input') || !uuid(operation.id)
    || operation.kind !== 'play' || operation.gameId !== 'royal-plinko' || operation.rulesVersion !== 1 || !input(operation.input)
    || typeof operation.amount !== 'number' || !(validGameBet(operation.amount)||[10, 50, 100, 500].includes(operation.amount))) return null;
  if (!record(round) || !fields(round, 'gameId,rulesVersion,input,outcome,stakeUnits,payoutUnits,multiplier')
    || round.gameId !== 'royal-plinko' || round.rulesVersion !== 1 || !input(round.input) || !record(round.outcome)
    || !fields(round.outcome, 'path,bucket') || !units(round.stakeUnits) || !units(round.payoutUnits)
    || round.input.rows !== operation.input.rows || round.input.risk !== operation.input.risk) return null;
  const stakeUnits = String(operation.amount * 100), { rows, risk } = operation.input, table = getPlinkoMultipliers(rows, risk);
  if (round.stakeUnits !== stakeUnits) return null;
  const result = ball(0, round.outcome.path, round.outcome.bucket, round.multiplier, rows, table, BigInt(stakeUnits));
  return result && result.returnedUnits === round.payoutUnits
    ? presentation('royal-plinko', operation.id, rows, risk, table, stakeUnits, record(actualRound)&&typeof actualRound.payoutUnits==='string'?actualRound.payoutUnits:round.payoutUnits, '0', [Object.freeze({...result,returnedUnits:record(actualRound)&&typeof actualRound.payoutUnits==='string'?actualRound.payoutUnits:result.returnedUnits})]) : null;
}

/** Omit capturedStart only for static restoration of an already confirmed canonical session. */
export function variantPlinkoPresentation(session: unknown, capturedStart?: unknown): PlinkoPresentation | null {
  if (!record(session) || !fields(session, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view') || !uuid(session.id)
    || session.gameId !== 'variant-plinko' || session.rulesVersion !== 1 || session.state !== 'settled' || !units(session.stakeUnits)
    || !/^[1-9][0-9]{0,10}$/.test(session.stakeUnits) || session.spentUnits !== session.stakeUnits || !units(session.returnedUnits) || !record(session.view)) return null;
  const view = session.view;
  if (!fields(view, 'player,dealer,community,actions,phase,ended,message,variant') || view.phase !== 1 || view.ended !== true || typeof view.message !== 'string'
    || !emptyArray(view.player) || !emptyArray(view.dealer) || !emptyArray(view.community) || !emptyArray(view.actions) || !record(view.variant)) return null;
  const variant = view.variant;
  if (!fields(variant, 'kind,risk,rows,balls,table') || variant.kind !== 'plinko' || !variantRisk(variant.risk)
    || variant.rows !== 12 || !dense(variant.balls, 2) || !dense(variant.table, 13)) return null;
  const risk = variant.risk, table = getPlinkoMultipliers(12, risk === 'low' ? 'easy' : risk === 'high' ? 'hard' : 'medium');
  if (!variant.table.every((value, index) => value === table[index])) return null;
  if (capturedStart !== undefined) {
    if (!record(capturedStart) || !fields(capturedStart, 'id,action,gameId,stakeUnits,settings') || capturedStart.id !== session.id
      || capturedStart.action !== 'start' || capturedStart.gameId !== 'variant-plinko' || capturedStart.stakeUnits !== session.stakeUnits
      || !record(capturedStart.settings) || !fields(capturedStart.settings, 'variant') || !record(capturedStart.settings.variant)
      || !fields(capturedStart.settings.variant, 'risk') || capturedStart.settings.variant.risk !== risk) return null;
  }
  const stake = BigInt(session.stakeUnits), share = stake / 2n, balls: PlinkoPresentationBall[] = [];
  for (let index = 0; index < 2; index++) {
    const value = variant.balls[index];
    if (!record(value) || !fields(value, 'path,bucket,multiplier')) return null;
    const result = ball(index, value.path, value.bucket, value.multiplier, 12, table, share);
    if (!result) return null;
    balls.push(result);
  }
  if (balls.reduce((sum, value) => sum + BigInt(value.returnedUnits), 0n).toString() !== session.returnedUnits) return null;
  return presentation('variant-plinko', session.id, 12, risk, table, session.stakeUnits, session.returnedUnits, (stake - 2n * share).toString(), balls);
}
