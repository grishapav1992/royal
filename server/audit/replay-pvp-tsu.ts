import { TSU_E_FA_CHOICES, tsuEFaWinner, type TsuEFaView } from '../../src/shared/tsuEFa';
import { createReplayPackage, verifyReplayPackage, type ReplayDefinition, type ReplayEvent, type ReplayManifest, type ReplayState } from './replay-package';
import type { AuditScope } from './contract';

const game = { gameId: 'tsu-e-fa', modeId: 'stake', category: 'pvp', replayProfile: 'pvp-turn-based',
  rulesVersion: '4', gameVersion: 'royal-tsu-duel-v4', engineId: 'royal-tsu-duel', engineVersion: '4' } as const;
export const tsuTurnReplayDefinition: ReplayDefinition = { ...game, formatVersion: 2 };

type TurnState = Extract<ReplayState, { profile: 'pvp-turn-based' }>;
type Seat = 1 | 2;
const stages = ['select', 'countdown', 'reveal'] as const;
const initialBoard = [1, 0, 0, 0, 0, 0, 0, 0, 0];
const sameBoard = (a: number[], b: number[]) => a.length === b.length && a.every((value, i) => value === b[i]);

export function tsuReplayState(view: TsuEFaView, phase: TurnState['phase'] = 'open'): TurnState | null {
  const stage = stages.indexOf(view.duel?.stage ?? 'select');
  if (view.rulesVersion !== 4 || view.target !== 2 || !view.duel || view.round > 1023 || stage < 0) return null;
  // Only the already revealed result crosses the audit boundary. The recipient's own choice is private.
  const revealed = view.last;
  const board = [view.round, ...view.score, stage, Number(view.locked[0]) + 2 * Number(view.locked[1]),
    revealed?.round ?? 0, revealed ? TSU_E_FA_CHOICES.indexOf(revealed.choices[0]) + 1 : 0,
    revealed ? TSU_E_FA_CHOICES.indexOf(revealed.choices[1]) + 1 : 0,
    revealed?.winner == null ? 0 : revealed.winner + 1];
  return { profile: game.replayProfile, phase, turn: view.round, seatToMove: null, board };
}

function validState(state: ReplayState): state is TurnState {
  if (state.profile !== game.replayProfile || state.seatToMove !== null || state.board.length !== 9) return false;
  const [round, a, b, stage, mask, last, signA, signB, win] = state.board;
  return round === state.turn && round > 0 && a <= 2 && b <= 2 && a + b <= round && stage <= 2 && mask <= 3 &&
    (stage === 0 ? mask < 3 : stage === 1 ? mask === 3 : mask === 0) &&
    (last === 0 ? signA === 0 && signB === 0 && win === 0
      : last <= round && signA >= 1 && signA <= 3 && signB >= 1 && signB <= 3 &&
        win === (tsuEFaWinner(TSU_E_FA_CHOICES[signA - 1], TSU_E_FA_CHOICES[signB - 1]) ?? -1) + 1);
}

function nextBoard(before: number[], after: number[], locked: number) {
  const [round, a, b, stage, mask] = before;
  if (stage === 0 && locked && !(mask & locked)) {
    const updated = mask | locked;
    return sameBoard(after, [round, a, b, updated === 3 ? 1 : 0, updated, ...before.slice(5)]);
  }
  if (locked) return false;
  if (stage === 2) return sameBoard(after, [round, a, b, 0, 0, ...before.slice(5)]);
  if (stage !== 1 || after[3] !== 2 || after[5] !== round) return false;
  const win = after[8], scoreA = a + Number(win === 1), scoreB = b + Number(win === 2);
  return after[1] === scoreA && after[2] === scoreB && after[0] === round + Number(scoreA < 2 && scoreB < 2);
}

type Terminal = Extract<ReplayEvent['data'], { kind: 'terminal' }>;
function terminalMatches(data: Terminal, previous: TurnState, locked: number, resigned: Seat | null, disconnected: Set<Seat>) {
  if (!validState(data.state)) return false;
  const board = data.state.board, [, , , stage, mask] = previous.board;
  if (resigned && data.outcome !== 'forfeited') return false;
  if (data.outcome === 'settled') {
    return stage === 1 && nextBoard(previous.board, board, locked) &&
      (board[1] === 2 && data.winnerSeat === 1 || board[2] === 2 && data.winnerSeat === 2);
  }
  if (locked || !sameBoard(previous.board, board)) return false;
  if (data.outcome === 'draw') return stage === 0 && mask === 0 && !disconnected.size && data.winnerSeat === null;
  if (data.outcome === 'timed-out') return stage === 0 && !disconnected.size && mask === data.winnerSeat;
  if (data.outcome === 'forfeited') return data.winnerSeat !== null &&
    (resigned === 3 - data.winnerSeat || disconnected.size === 1 && disconnected.has(data.winnerSeat === 1 ? 2 : 1));
  return data.outcome === 'cancelled' && data.winnerSeat === null;
}

export function verifyTsuTurnReplay(input: unknown) {
  const checked = verifyReplayPackage(input, [tsuTurnReplayDefinition]);
  if (checked.status !== 'verified') return { status: checked.status };
  const { manifest, fragments } = checked.value;
  const corrupt = { status: 'corrupt' } as const;
  if (manifest.timing) return corrupt;
  const suffix = manifest.initial === null;
  if (suffix && !manifest.gaps.includes('initial-state-unavailable')) return corrupt;
  const partial = manifest.gaps.some(gap => gap === 'event-gap' || gap === 'initial-state-unavailable');
  let current = manifest.initial, locked = 0, resigned: Seat | null = null, sequence = 0;
  let needsInitialCheckpoint = true;
  const disconnected = new Set<Seat>();
  if (current && (!validState(current) || !sameBoard(current.board, initialBoard))) return corrupt;
  for (const fragment of fragments) for (const event of fragment.events) {
    const { data } = event;
    if (suffix && (event.sequence !== sequence + 1 ||
        (!sequence && (data.kind !== 'checkpoint' || event.atMs !== 0)) ||
        (data.kind !== 'terminal' && (event.postings.length > 0 || event.money?.length)) ||
        event.money?.some(leg => leg.movement !== 'payout' && leg.movement !== 'refund'))) return corrupt;
    if (event.sequence !== ++sequence) {
      if (!partial) return corrupt;
      sequence = event.sequence;
      current = null;
      locked = 0;
      resigned = null;
      disconnected.clear();
    }
    if (data.kind === 'checkpoint' || data.kind === 'terminal') {
      if (!validState(data.state)) return corrupt;
      if (current && validState(current)) {
        if (data.kind === 'checkpoint' && resigned) return corrupt;
        if (data.kind === 'terminal' ? !terminalMatches(data, current, locked, resigned, disconnected)
          : needsInitialCheckpoint ? !sameBoard(current.board, data.state.board) || event.atMs !== 0
            : !nextBoard(current.board, data.state.board, locked)) return corrupt;
      } else if (!partial) return corrupt;
      current = data.state;
      needsInitialCheckpoint = false;
      locked = 0;
    } else if (data.kind === 'presence') {
      if (resigned || disconnected.has(data.seat) === (data.event === 'disconnected')) return corrupt;
      if (data.event === 'disconnected') disconnected.add(data.seat);
      else disconnected.delete(data.seat);
    } else {
      const { action } = data;
      if (action.profile !== game.replayProfile || action.code === 'pass' || resigned || locked || current && needsInitialCheckpoint) return corrupt;
      if (action.code === 'resign') {
        if (action.positions.length) return corrupt;
        resigned = action.seat;
      } else {
        if (action.positions.length !== 1 || current && action.positions[0] !== current.turn) return corrupt;
        locked = action.seat;
      }
    }
  }
  return { status: 'verified', engineVerified: !!manifest.initial && !!manifest.terminal && !partial } as const;
}

export type CapturedTsuReplay = {
  matchId: string;
  initial: TurnState | null;
  events: ReplayEvent[];
  lockReceipts: { requestId: string; seat: Seat; round: number; at: number; sequence: number }[];
  gaps: ReplayManifest['gaps'];
  settlement: { reason: string; winnerSeat: Seat | null; finishedAtMs: number };
};

export function buildTsuTurnReplay(recording: CapturedTsuReplay, scope: AuditScope, links: {
  start?: ReplayEvent['money']; finish?: ReplayEvent['money']; sourceGap?: boolean;
} = {}) {
  const gaps = [...recording.gaps];
  if (links.sourceGap) gaps.push('source-unavailable');
  const events = recording.events.map((event, index) => {
    const money = index === 0 && recording.initial ? links.start : event.data.kind === 'terminal' ? links.finish : undefined;
    return { ...event, postings: money?.map(leg => leg.posting) ?? [], ...(money?.length ? { money } : {}) };
  });
  const pack = createReplayPackage({ formatVersion: 2, scope, replayId: recording.matchId, entityId: recording.matchId,
    game, initial: recording.initial, gaps, coverage: gaps.length ? 'partial' : 'complete' }, events);
  if (verifyTsuTurnReplay(pack).status !== 'verified') throw new Error('Invalid Tsu audit transcript');
  return pack;
}

export function verifyTsuTransition(before: TurnState, after: TurnState, locked: number) {
  return validState(after) && nextBoard(before.board, after.board, locked);
}

export function verifyTsuTerminal(data: Terminal, previous: TurnState, resigned: Seat | null, disconnected: Set<Seat>) {
  return terminalMatches(data, previous, 0, resigned, disconnected);
}
