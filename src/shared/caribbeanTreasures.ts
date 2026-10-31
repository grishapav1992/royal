import {validGameStake} from './gameStakes.ts';
import {
  CARIBBEAN_BONUS_SPINS, CARIBBEAN_LINE_STAKES, CARIBBEAN_PROFILE,
  playCaribbeanFrame, settleCaribbeanFrame, validCaribbeanLineCount,
  type CaribbeanLineCount, type CaribbeanRandom, type CaribbeanFrame,
} from './caribbeanTreasuresMath.ts';

export const CARIBBEAN_GAME = 'studio-caribbean-treasures' as const;
export const CARIBBEAN_RULES_VERSION = 2;
export const CARIBBEAN_PROGRESS_VERSION = 1;
export type CaribbeanTactic = 'raid' | 'flagship';
export type CaribbeanStartMode = 'normal' | 'buy-raid' | 'buy-flagship';
export type CaribbeanMove = 'choose-raid' | 'choose-flagship' | 'spin';
export interface CaribbeanSettings { lines: CaribbeanLineCount; mode: CaribbeanStartMode; stakeBasis?: 'total' }
export interface CaribbeanOperation { move: 'start' | CaribbeanMove; draws: number[] }
export interface CaribbeanSpin { frame: CaribbeanFrame; payoutUnits: string }
export interface CaribbeanView {
  kind: 'caribbean-treasures';
  version: 1 | 2;
  settings: CaribbeanSettings;
  lineStakeUnits: string;
  costUnits: string;
  phase: 'choice' | 'bonus' | 'complete';
  tactic: CaribbeanTactic | null;
  remaining: number;
  bonusTicket: number | null;
  mapPieces: number;
  spins: CaribbeanSpin[];
  operations: CaribbeanOperation[];
  revision: number;
  totalPayoutUnits: string;
}
export interface CaribbeanResult {
  view: CaribbeanView;
  ended: boolean;
  costUnits: string;
  creditUnits: string;
  actions: { move: CaribbeanMove; label: string; cost: 0 }[];
}
export class CaribbeanMoveError extends Error {}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: object, expected: string) => Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
export function validCaribbeanStake(value: unknown): value is string {
  return validGameStake(value) || typeof value === 'string' && (CARIBBEAN_LINE_STAKES as readonly string[]).includes(value);
}
export function validCaribbeanSettings(value: unknown): value is CaribbeanSettings {
  return record(value) && (keys(value, 'lines,mode') || keys(value, 'lines,mode,stakeBasis') && value.stakeBasis === 'total') && validCaribbeanLineCount(value.lines)
    && typeof value.mode === 'string' && ['normal','buy-raid','buy-flagship'].includes(value.mode);
}
export function caribbeanInitialCost(settings: CaribbeanSettings, lineStakeUnits: string): string {
  if (!validCaribbeanSettings(settings) || !validCaribbeanStake(lineStakeUnits)) throw new CaribbeanMoveError('Invalid Caribbean settings or stake');
  const base = BigInt(lineStakeUnits) * BigInt(settings.stakeBasis === 'total' ? 1 : settings.lines);
  return String(settings.mode === 'normal' ? base :
    (base * BigInt(CARIBBEAN_PROFILE[settings.lines].bonusCostPerMillion) + 999999n) / 1000000n);
}
function traced(random: CaribbeanRandom) {
  const draws: number[] = [];
  const draw: CaribbeanRandom = maximum => {
    const value = random(maximum);
    if (!Number.isSafeInteger(value) || value < 0 || value >= maximum || draws.length >= 64)
      throw new CaribbeanMoveError('Invalid Caribbean entropy');
    draws.push(value); return value;
  };
  return { draws, draw };
}
function appendSpin(view: CaribbeanView, mode: 'base' | CaribbeanTactic, draw: CaribbeanRandom) {
  const frame = playCaribbeanFrame(mode, view.settings.lines, draw);
  const settlement = settleCaribbeanFrame(frame.grid, view.settings.lines, view.lineStakeUnits, view.settings.stakeBasis === 'total' ? view.settings.lines : 1);
  view.spins.push({ frame, payoutUnits: settlement.payoutUnits });
  view.totalPayoutUnits = String(BigInt(view.totalPayoutUnits) + BigInt(settlement.payoutUnits));
}
function result(view: CaribbeanView): CaribbeanResult {
  const ended = view.phase === 'complete';
  const actions: CaribbeanResult['actions'] = view.phase === 'choice'
    ? [{ move: 'choose-raid', label: 'Рейд на торговцев · 14 вращений', cost: 0 },
      { move: 'choose-flagship', label: 'Штурм флагмана · 6 вращений', cost: 0 }]
    : ended ? [] : [{ move: 'spin', label: 'Бесплатное вращение', cost: 0 }];
  return { view, ended, costUnits: view.costUnits, creditUnits: ended ? view.totalPayoutUnits : '0', actions };
}
export function startCaribbeanRound(settings: CaribbeanSettings, lineStakeUnits: string, random: CaribbeanRandom): CaribbeanResult {
  const costUnits = caribbeanInitialCost(settings, lineStakeUnits), entropy = traced(random);
  const bought = settings.mode !== 'normal', tactic: CaribbeanTactic | null =
    settings.mode === 'buy-raid' ? 'raid' : settings.mode === 'buy-flagship' ? 'flagship' : null;
  const view: CaribbeanView = {
    kind: 'caribbean-treasures', version: settings.stakeBasis === 'total' ? 2 : 1, settings: { ...settings }, lineStakeUnits, costUnits,
    phase: bought ? 'bonus' : 'complete', tactic, remaining: tactic ? CARIBBEAN_BONUS_SPINS[tactic] : 0,
    bonusTicket: null, mapPieces: 0, spins: [], operations: [], revision: 1, totalPayoutUnits: '0',
  };
  if (!bought) {
    appendSpin(view, 'base', entropy.draw);
    const ticket = entropy.draw(1000000), entered = ticket < CARIBBEAN_PROFILE[settings.lines].bonusEntryPerMillion;
    view.bonusTicket = ticket;
    view.mapPieces = entered ? 3 : ticket % 3;
    if (entered) view.phase = 'choice';
  }
  view.operations.push({ move: 'start', draws: entropy.draws });
  return result(view);
}
/** Caller validates persisted state; this transition never debits or stores a wallet. */
export function moveCaribbeanRound(current: CaribbeanView, revision: unknown, move: CaribbeanMove, random: CaribbeanRandom): CaribbeanResult {
  if (revision !== current.revision || current.phase === 'complete') throw new CaribbeanMoveError('Stale or completed Caribbean round');
  const view = structuredClone(current), entropy = traced(random);
  if (move === 'choose-raid' || move === 'choose-flagship') {
    if (view.phase !== 'choice' || view.tactic !== null) throw new CaribbeanMoveError('Caribbean tactic is already fixed');
    view.tactic = move === 'choose-raid' ? 'raid' : 'flagship';
    view.remaining = CARIBBEAN_BONUS_SPINS[view.tactic]; view.phase = 'bonus';
  } else if (move === 'spin') {
    if (view.phase !== 'bonus' || !view.tactic || view.remaining <= 0) throw new CaribbeanMoveError('No Caribbean free spin');
    appendSpin(view, view.tactic, entropy.draw);
    view.remaining--;
    if (view.remaining === 0) view.phase = 'complete';
  } else throw new CaribbeanMoveError('Unknown Caribbean move');
  view.operations.push({ move, draws: entropy.draws }); view.revision++;
  return result(view);
}
/** Replay uses consumed draws only. Future fields or future random outcomes are never serialized. */
export function validCaribbeanView(value: unknown): value is CaribbeanView {
  try {
    if (!record(value) || !keys(value, 'kind,version,settings,lineStakeUnits,costUnits,phase,tactic,remaining,bonusTicket,mapPieces,spins,operations,revision,totalPayoutUnits')
      || value.kind !== 'caribbean-treasures' || value.version !== (value.settings && (value.settings as CaribbeanSettings).stakeBasis === 'total' ? 2 : 1) || !validCaribbeanSettings(value.settings)
      || !validCaribbeanStake(value.lineStakeUnits) || !Array.isArray(value.operations)
      || value.operations.length < 1 || value.operations.length > 16 || value.operations.length !== value.revision) return false;
    let replay: CaribbeanView | undefined;
    for (const operation of value.operations) {
      if (!record(operation) || !keys(operation, 'move,draws') || !Array.isArray(operation.draws)
        || operation.draws.length > 64 || operation.draws.some(draw => !Number.isSafeInteger(draw) || draw < 0)) return false;
      const replayDraws = operation.draws;
      let cursor = 0;
      const draw: CaribbeanRandom = maximum => {
        if (cursor >= replayDraws.length) throw new Error('Missing replay entropy');
        const n = replayDraws[cursor++];
        if (n >= maximum) throw new Error('Wrong replay bound');
        return n;
      };
      const next = !replay ? operation.move === 'start' && startCaribbeanRound(value.settings, value.lineStakeUnits, draw)
        : moveCaribbeanRound(replay, replay.revision, operation.move as CaribbeanMove, draw);
      if (!next || cursor !== operation.draws.length) return false;
      replay = next.view;
    }
    return JSON.stringify(replay) === JSON.stringify(value);
  } catch { return false; }
}
export function validCaribbeanSettlement(state: unknown, spentUnits: unknown, returnedUnits: unknown, value: unknown): value is CaribbeanView {
  return validCaribbeanView(value) && spentUnits === value.costUnits
    && (state === 'active' && value.phase !== 'complete' && returnedUnits === '0'
      || state === 'settled' && value.phase === 'complete' && returnedUnits === value.totalPayoutUnits);
}
