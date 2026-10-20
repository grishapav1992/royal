import { fruitsMultiplier } from './gameCore';

export type FruitsPresentationGame = 'royal-fruits' | 'variant-fruits';
export type FruitsSymbol = 0 | 1 | 2 | 3;
export type FruitsPresentationRow = Readonly<{
  lineIndex: number;
  symbols: readonly [FruitsSymbol, FruitsSymbol, FruitsSymbol];
  stakeUnits: string;
  multiplier: number;
  returnedUnits: string;
}>;
export type FruitsPresentation = Readonly<{
  gameId: FruitsPresentationGame;
  outcomeId: string;
  stakeUnits: string;
  returnedUnits: string;
  rows: readonly FruitsPresentationRow[];
}>;

const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const fields = (value: Record<string, unknown>, expected: string) => Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const units = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(value);
const empty = (value: unknown) => record(value) && Object.keys(value).length === 0;
const dense = (value: unknown, length: number): value is unknown[] => Array.isArray(value) && value.length === length && Object.keys(value).length === length && Array.from({ length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const symbols = (value: unknown): value is [FruitsSymbol, FruitsSymbol, FruitsSymbol] => dense(value, 3) && value.every(symbol => typeof symbol === 'number' && Number.isInteger(symbol) && symbol >= 0 && symbol <= 3);
const emptyArray = (value: unknown) => dense(value, 0);

function row(lineIndex: number, value: Record<string, unknown>, expectedStake: string): FruitsPresentationRow | null {
  if (expectedStake === '0' || !symbols(value.symbols) || value.stakeUnits !== expectedStake || !units(value.returnedUnits)) return null;
  const multiplier = fruitsMultiplier(value.symbols);
  if (value.multiplier !== multiplier || value.returnedUnits !== (BigInt(expectedStake) * BigInt(multiplier)).toString()) return null;
  return Object.freeze({ lineIndex, symbols: Object.freeze([...value.symbols]) as FruitsPresentationRow['symbols'], stakeUnits: expectedStake, multiplier, returnedUnits: value.returnedUnits });
}
function presentation(gameId: FruitsPresentationGame, outcomeId: string, stakeUnits: string, returnedUnits: string, rows: FruitsPresentationRow[]): FruitsPresentation {
  return Object.freeze({ gameId, outcomeId, stakeUnits, returnedUnits, rows: Object.freeze(rows) });
}

/** The operation is the captured request, never an identity inferred from a wallet balance or ledger. */
export function royalFruitsPresentation(operation: unknown, round: unknown): FruitsPresentation | null {
  if (!record(operation) || !fields(operation, 'id,kind,amount,gameId,rulesVersion,input') || !uuid(operation.id)
    || operation.kind !== 'play' || operation.gameId !== 'royal-fruits' || operation.rulesVersion !== 1 || !empty(operation.input)
    || typeof operation.amount !== 'number' || ![10, 50, 100, 500].includes(operation.amount)) return null;
  if (!record(round) || !fields(round, 'gameId,rulesVersion,input,outcome,stakeUnits,payoutUnits,multiplier')
    || round.gameId !== 'royal-fruits' || round.rulesVersion !== 1 || !empty(round.input) || !record(round.outcome)
    || !fields(round.outcome, 'symbols') || !units(round.stakeUnits) || !units(round.payoutUnits)) return null;
  const stakeUnits = String(operation.amount * 100);
  if (round.stakeUnits !== stakeUnits) return null;
  const result = row(0, { symbols: round.outcome.symbols, stakeUnits, multiplier: round.multiplier, returnedUnits: round.payoutUnits }, stakeUnits);
  return result ? presentation('royal-fruits', operation.id, stakeUnits, round.payoutUnits, [result]) : null;
}

/** Omit capturedStart only for static restoration of an already confirmed canonical session. */
export function variantFruitsPresentation(session: unknown, capturedStart?: unknown): FruitsPresentation | null {
  if (!record(session) || !fields(session, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view') || !uuid(session.id)
    || session.gameId !== 'variant-fruits' || session.rulesVersion !== 1 || session.state !== 'settled' || !units(session.stakeUnits)
    || !/^[1-9][0-9]{0,10}$/.test(session.stakeUnits) || session.spentUnits !== session.stakeUnits || !units(session.returnedUnits) || !record(session.view)) return null;
  const view = session.view;
  if (!fields(view, 'player,dealer,community,actions,phase,ended,message,variant') || view.phase !== 1 || view.ended !== true || typeof view.message !== 'string'
    || !emptyArray(view.player) || !emptyArray(view.dealer) || !emptyArray(view.community) || !emptyArray(view.actions) || !record(view.variant)) return null;
  const variant = view.variant;
  if (!fields(variant, 'kind,lines,rows') || variant.kind !== 'fruits' || (variant.lines !== 2 && variant.lines !== 3) || !dense(variant.rows, variant.lines)) return null;
  if (capturedStart !== undefined) {
    if (!record(capturedStart) || !fields(capturedStart, 'id,action,gameId,stakeUnits,settings') || capturedStart.id !== session.id
      || capturedStart.action !== 'start' || capturedStart.gameId !== 'variant-fruits' || capturedStart.stakeUnits !== session.stakeUnits
      || !record(capturedStart.settings) || !fields(capturedStart.settings, 'variant') || !record(capturedStart.settings.variant)
      || !fields(capturedStart.settings.variant, 'lines') || capturedStart.settings.variant.lines !== variant.lines) return null;
  }
  const stake = BigInt(session.stakeUnits), count = BigInt(variant.lines), share = stake / count, remainder = stake % count;
  const rows: FruitsPresentationRow[] = [];
  for (let index = 0; index < variant.lines; index++) {
    const value = variant.rows[index];
    if (!record(value) || !fields(value, 'symbols,stakeUnits,multiplier,returnedUnits')) return null;
    const result = row(index, value, (share + (BigInt(index) < remainder ? 1n : 0n)).toString());
    if (!result) return null;
    rows.push(result);
  }
  if (rows.reduce((sum, value) => sum + BigInt(value.returnedUnits), 0n).toString() !== session.returnedUnits) return null;
  return presentation('variant-fruits', session.id, session.stakeUnits, session.returnedUnits, rows);
}
