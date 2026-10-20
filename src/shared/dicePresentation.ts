import { DEMO_BETS } from './demoWallet';
import { diceOdds } from './originalGames';
import { diceMultiplier } from './casinoVariants';
import { studioDiceMultiplier } from './studioGames';

export type DicePresentationGame = 'royal-dice' | 'variant-dice' | 'studio-signal-fox';
export type DiceWinRange = Readonly<{ minInclusive: number; maxExclusive: number }>;
export type DiceProbability = Readonly<{ numerator: number; denominator: 100 | 10000 }>;
type CommonPresentation = Readonly<{
  outcomeId: string;
  stakeUnits: string;
  returnedUnits: string;
  scale: 1 | 100;
  rollMinor: number;
  outcomeCount: 100 | 10000;
  winRange: DiceWinRange;
  won: boolean;
  potentialMultiplier: number;
  paidMultiplier: number;
  probability: DiceProbability;
}>;
export type RoyalDicePresentation = CommonPresentation & Readonly<{
  gameId: 'royal-dice';
  gameMode: 'rollUnder' | 'rollOver';
  sliderValue: number;
  scale: 100;
  outcomeCount: 10000;
}>;
export type CorridorDicePresentation = CommonPresentation & Readonly<{
  gameId: 'variant-dice';
  width: 30 | 50 | 70;
  scale: 100;
  outcomeCount: 10000;
}>;
export type FoxDicePresentation = CommonPresentation & Readonly<{
  gameId: 'studio-signal-fox';
  chance: 25 | 50 | 75;
  direction: 'under' | 'over';
  scale: 1;
  outcomeCount: 100;
}>;
export type DicePresentation = RoyalDicePresentation | CorridorDicePresentation | FoxDicePresentation;

const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key =>
    typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
};
const fields = (value: Record<string, unknown>, expected: string) =>
  Reflect.ownKeys(value).sort().join(',') === expected.split(',').sort().join(',');
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const units = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(value);
const allowedStake = (value: unknown): value is string => units(value) && DEMO_BETS.some(bet => String(bet * 100) === value);
const emptyArray = (value: unknown): value is unknown[] => Array.isArray(value)
  && Object.getPrototypeOf(value) === Array.prototype && value.length === 0 && Reflect.ownKeys(value).length === 1;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const decimal2 = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  && /^\d+(?:\.\d{1,2})?$/.test(String(value));
const paid = (stake: string, multiplier: number) => {
  const fixed = Math.round(multiplier * 10000);
  if (!Number.isFinite(multiplier) || multiplier < 0 || !Number.isSafeInteger(fixed)) throw Error('Invalid dice multiplier');
  return (BigInt(stake) * BigInt(fixed) / 10000n).toString();
};
function facts(outcomeId: string, stakeUnits: string, returnedUnits: string, scale: 1 | 100,
  rollMinor: number, outcomeCount: 100 | 10000, minInclusive: number, maxExclusive: number, potentialMultiplier: number) {
  const won = rollMinor >= minInclusive && rollMinor < maxExclusive;
  return { outcomeId, stakeUnits, returnedUnits, scale, rollMinor, outcomeCount,
    winRange: Object.freeze({ minInclusive, maxExclusive }), won, potentialMultiplier,
    paidMultiplier: won ? potentialMultiplier : 0,
    probability: Object.freeze({ numerator: maxExclusive - minInclusive, denominator: outcomeCount }) };
}

/** Royal has no cold round in its wallet snapshot. Bind an actual captured play operation. */
export function royalDicePresentation(capturedOperation: unknown, gameRound: unknown): RoyalDicePresentation | null {
  try {
    if (!record(capturedOperation) || !fields(capturedOperation, 'id,kind,amount,gameId,rulesVersion,input')
      || !uuid(capturedOperation.id) || capturedOperation.kind !== 'play' || capturedOperation.gameId !== 'royal-dice'
      || capturedOperation.rulesVersion !== 1 || !(DEMO_BETS as readonly unknown[]).includes(capturedOperation.amount)
      || !record(capturedOperation.input) || !fields(capturedOperation.input, 'gameMode,sliderValue')
      || !record(gameRound) || !fields(gameRound, 'gameId,rulesVersion,stakeUnits,payoutUnits,input,outcome,multiplier')
      || gameRound.gameId !== 'royal-dice' || gameRound.rulesVersion !== 1 || !allowedStake(gameRound.stakeUnits)
      || !units(gameRound.payoutUnits) || gameRound.stakeUnits !== String(Number(capturedOperation.amount) * 100)
      || !record(gameRound.input) || !fields(gameRound.input, 'gameMode,sliderValue')
      || !record(gameRound.outcome) || !fields(gameRound.outcome, 'rolledValue,won')) return null;
    const input = gameRound.input;
    if ((input.gameMode !== 'rollUnder' && input.gameMode !== 'rollOver') || !decimal2(input.sliderValue)
      || capturedOperation.input.gameMode !== input.gameMode || capturedOperation.input.sliderValue !== input.sliderValue
      || !decimal2(gameRound.outcome.rolledValue) || gameRound.outcome.rolledValue > 99.99
      || typeof gameRound.outcome.won !== 'boolean') return null;
    // Keep the accepted native binary-half tie at 17.92% rather than idealizing its rounding.
    const odds = diceOdds.calculate({ gameMode: input.gameMode, sliderValue: input.sliderValue });
    const threshold = Math.round(input.sliderValue * 100), rollMinor = Math.round(gameRound.outcome.rolledValue * 100);
    const minInclusive = input.gameMode === 'rollUnder' ? 0 : threshold;
    const maxExclusive = input.gameMode === 'rollUnder' ? threshold : 10000;
    const result = facts(capturedOperation.id, gameRound.stakeUnits, gameRound.payoutUnits, 100,
      rollMinor, 10000, minInclusive, maxExclusive, odds.multiplier);
    if (gameRound.outcome.won !== result.won || gameRound.multiplier !== result.paidMultiplier
      || gameRound.payoutUnits !== (result.won ? paid(gameRound.stakeUnits, odds.multiplier) : '0')) return null;
    return Object.freeze({ ...result, gameId: 'royal-dice', gameMode: input.gameMode,
      sliderValue: input.sliderValue, scale: 100, outcomeCount: 10000 });
  } catch { return null; }
}

function canonical(value: unknown, game: 'variant-dice' | 'studio-signal-fox', key: 'variant' | 'studio') {
  if (!record(value) || !fields(value, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view')
    || !uuid(value.id) || value.gameId !== game || value.rulesVersion !== 1 || value.state !== 'settled'
    || !allowedStake(value.stakeUnits) || value.spentUnits !== value.stakeUnits || !units(value.returnedUnits)
    || !record(value.view) || !fields(value.view, `player,dealer,community,actions,phase,ended,message,${key}`)) return null;
  const view = value.view;
  if (view.phase !== 1 || view.ended !== true || typeof view.message !== 'string'
    || ![view.player, view.dealer, view.community, view.actions].every(emptyArray) || !record(view[key])) return null;
  return { session: value, dice: view[key] };
}
function binding(request: unknown, session: Record<string, unknown>, key: 'variant' | 'studio', settings: Record<string, unknown>) {
  if (!record(request) || !fields(request, 'id,gameId,action,stakeUnits,settings') || request.action !== 'start'
    || request.id !== session.id || request.gameId !== session.gameId || request.stakeUnits !== session.stakeUnits
    || !record(request.settings) || !fields(request.settings, key) || !record(request.settings[key])) return false;
  const input = request.settings[key];
  return fields(input, Object.keys(settings).join(',')) && Object.keys(settings).every(name => input[name] === settings[name]);
}

/** An omitted captured start is for a confirmed static receipt, not a live animation. */
export function variantDicePresentation(canonicalSession: unknown, capturedStart?: unknown): CorridorDicePresentation | null {
  try {
    const checked = canonical(canonicalSession, 'variant-dice', 'variant');
    if (!checked) return null;
    const { session, dice } = checked;
    if (!fields(dice, 'kind,width,low,high,roll,won,multiplier') || dice.kind !== 'dice'
      || (dice.width !== 30 && dice.width !== 50 && dice.width !== 70) || !decimal2(dice.roll) || dice.roll > 99.99
      || typeof dice.won !== 'boolean') return null;
    const minInclusive = (100 - dice.width) * 50, maxExclusive = minInclusive + dice.width * 100;
    const multiplier = diceMultiplier(dice.width), rollMinor = Math.round(dice.roll * 100);
    const result = facts(session.id as string, session.stakeUnits as string, session.returnedUnits as string,
      100, rollMinor, 10000, minInclusive, maxExclusive, multiplier);
    if (dice.low !== minInclusive / 100 || dice.high !== maxExclusive / 100 || dice.multiplier !== multiplier || dice.won !== result.won
      || session.returnedUnits !== (result.won ? paid(session.stakeUnits as string, multiplier) : '0')
      || capturedStart !== undefined && !binding(capturedStart, session, 'variant', { width: dice.width })) return null;
    return Object.freeze({ ...result, gameId: 'variant-dice', width: dice.width, scale: 100, outcomeCount: 10000 });
  } catch { return null; }
}

/** The Fox roll is an integer 0..99; over's visible threshold is 100 minus its chance. */
export function foxDicePresentation(canonicalSession: unknown, capturedStart?: unknown): FoxDicePresentation | null {
  try {
    const checked = canonical(canonicalSession, 'studio-signal-fox', 'studio');
    if (!checked) return null;
    const { session, dice } = checked;
    if (!fields(dice, 'kind,chance,direction,roll,won,multiplier') || dice.kind !== 'dice'
      || (dice.chance !== 25 && dice.chance !== 50 && dice.chance !== 75)
      || (dice.direction !== 'under' && dice.direction !== 'over') || !integer(dice.roll, 0, 99)
      || typeof dice.won !== 'boolean') return null;
    const minInclusive = dice.direction === 'under' ? 0 : 100 - dice.chance;
    const maxExclusive = dice.direction === 'under' ? dice.chance : 100;
    const multiplier = studioDiceMultiplier(dice.chance);
    const result = facts(session.id as string, session.stakeUnits as string, session.returnedUnits as string,
      1, dice.roll, 100, minInclusive, maxExclusive, multiplier);
    if (dice.multiplier !== multiplier || dice.won !== result.won
      || session.returnedUnits !== (result.won ? paid(session.stakeUnits as string, multiplier) : '0')
      || capturedStart !== undefined && !binding(capturedStart, session, 'studio', { chance: dice.chance, direction: dice.direction })) return null;
    return Object.freeze({ ...result, gameId: 'studio-signal-fox', chance: dice.chance,
      direction: dice.direction, scale: 1, outcomeCount: 100 });
  } catch { return null; }
}
