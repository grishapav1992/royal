import { Chess } from 'chess.js';
import { CHESS_TIME_MS, type ChessState } from '../../src/shared/activities';
import type { PvpChallenge } from '../../src/shared/pvp';
import { chessTimeoutDraw } from '../chessGame';
import type { AuditScope, AuditSourceRef } from './contract';
import {
  createReplayPackage, isReplayId, verifyReplayPackage,
  type ReplayDefinition, type ReplayEvent, type ReplayPackage, type ReplayState,
} from './replay-package';

const game = {
  gameId: 'chess', modeId: 'stake', category: 'pvp', replayProfile: 'pvp-turn-based',
  rulesVersion: 'royal-chess-room-v1', gameVersion: 'royal-chess-room-v1', engineId: 'chessjs', engineVersion: '1.4.0',
} as const;

export const chessTurnReplayDefinition: ReplayDefinition = { ...game, formatVersion: 2 };

type Seat = 1 | 2;
type Promotion = 'q' | 'r' | 'b' | 'n';
type Board = ChessState['board'];
type TurnState = Extract<ReplayState, { profile: 'pvp-turn-based' }>;
type Terminal = Extract<ReplayEvent['data'], { kind: 'terminal' }>;
type EventData = ReplayEvent['data'];
type Gap = 'initial-state-unavailable' | 'event-gap' | 'terminal-unavailable';
type WalletOutcome = 'win' | 'draw' | 'resign' | 'disconnect' | 'server' | 'timeout';

export type ChessReplayObservation = {
  atMs: number;
  players: [string, string];
  state: { board: Board; turn: 'w' | 'b'; phase: 'playing' | 'finished'; winner: string; revision: number; ply: number };
} & (
  { kind: 'start' } |
  { kind: 'move'; seat: Seat; from: string; to: string; promotion?: string } |
  { kind: 'resign'; seat: Seat } |
  { kind: 'timeout' }
);

export type CapturedChessReplay = {
  matchId: string;
  initial: TurnState | null;
  events: ReplayEvent[];
  gaps: Gap[];
  settlement: { reason: WalletOutcome; winnerSeat: Seat | null; finishedAtMs: number };
};

const pieceCodes: Record<string, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const promotions: Promotion[] = ['q', 'r', 'b', 'n'];
const maximumRecordedEvents = 4096;
const checkpointEveryMoves = 16;
const sideSeat = (side: 'w' | 'b'): Seat => side === 'w' ? 1 : 2;
const other = (seat: Seat): Seat => seat === 1 ? 2 : 1;
const indexOfSquare = (square: string) => /^[a-h][1-8]$/.test(square)
  ? (Number(square[1]) - 1) * 8 + square.charCodeAt(0) - 97 : -1;
const squareAt = (index: number) => String.fromCharCode(97 + index % 8) + (Math.floor(index / 8) + 1);

function boardOf(chess: Chess): Board {
  return chess.board().flatMap(rank => rank.flatMap(piece => piece ? [piece] : []));
}

function encodeBoard(board: Board): number[] | null {
  const encoded = Array<number>(64).fill(0);
  for (const piece of board) {
    const square = indexOfSquare(piece.square), code = pieceCodes[piece.type];
    if (square < 0 || !code || encoded[square] !== 0 || (piece.color !== 'w' && piece.color !== 'b')) return null;
    encoded[square] = code + (piece.color === 'b' ? 6 : 0);
  }
  return encoded;
}

function stateOf(chess: Chess, turn: number, phase: TurnState['phase'] = 'open'): TurnState {
  return { profile: 'pvp-turn-based', phase, turn, seatToMove: phase === 'open' ? sideSeat(chess.turn()) : null,
    board: encodeBoard(boardOf(chess))! };
}

const sameBoard = (a: readonly number[], b: readonly number[] | null) =>
  !!b && a.length === b.length && a.every((code, index) => code === b[index]);

function sameState(a: ReplayState, b: TurnState) {
  return a.profile === 'pvp-turn-based' && a.phase === b.phase && a.turn === b.turn &&
    a.seatToMove === b.seatToMove && sameBoard(a.board, b.board);
}

function validMovePositions(positions: readonly number[]) {
  if (positions.length !== 2 && positions.length !== 3) return false;
  const [from, to, promoted] = positions;
  return from >= 0 && from <= 63 && to >= 0 && to <= 63 && (promoted === undefined || promoted >= 1 && promoted <= 4);
}

function movePositions(move: Extract<ChessReplayObservation, { kind: 'move' }>) {
  const positions = [indexOfSquare(move.from), indexOfSquare(move.to)];
  if (move.promotion !== undefined) positions.push(promotions.indexOf(move.promotion as Promotion) + 1);
  return positions;
}

function makeMove(chess: Chess, seat: Seat, positions: readonly number[]): boolean {
  if (chess.isGameOver() || seat !== sideSeat(chess.turn()) || !validMovePositions(positions)) return false;
  const [from, to, promoted] = positions;
  try {
    const promotion = promoted === undefined ? undefined : promotions[promoted - 1];
    return chess.move({ from: squareAt(from), to: squareAt(to), promotion }).promotion === promotion;
  } catch { return false; }
}

function observedBoard(observation: ChessReplayObservation, chess: Chess) {
  return observation.state.turn === chess.turn() && sameBoard(stateOf(chess, 0).board, encodeBoard(observation.state.board));
}

type ActiveCapture = {
  match: PvpChallenge;
  events: ReplayEvent[];
  startedAt: number;
  ply: number;
  revision: number;
  disconnected: Set<Seat>;
  gap: boolean;
  end?: { outcome: Terminal['outcome']; winnerSeat: Seat | null; at: number };
} & ({ chess: Chess; initial: TurnState } | { chess: null; initial: null; position: TurnState });
type SuffixCapture = Extract<ActiveCapture, { chess: null }>;

function observedPosition({ board, ply, turn }: ChessReplayObservation['state']): TurnState | null {
  const encoded = encodeBoard(board);
  if (!encoded || !Number.isSafeInteger(ply) || ply < 1 || (ply % 2 === 0 ? 'w' : 'b') !== turn) return null;
  return { profile: 'pvp-turn-based', phase: 'open', turn: ply, seatToMove: sideSeat(turn), board: encoded };
}

type MatchCandidate = Pick<PvpChallenge, 'id' | 'creatorId' | 'opponentId' | 'gameId' | 'status' | 'stakeUnits'>;

function paidChess(match: MatchCandidate): boolean {
  return match.gameId === 'chess' && match.status === 'playing' && isReplayId(match.id)
    && typeof match.stakeUnits === 'string' && /^[1-9][0-9]{0,19}$/.test(match.stakeUnits)
    && !!match.opponentId && match.opponentId !== match.creatorId;
}

function winnerSeat(match: Pick<PvpChallenge, 'creatorId' | 'opponentId'>, winnerId: string | null): Seat | null | undefined {
  return winnerId === null ? null : winnerId === match.creatorId ? 1 : winnerId === match.opponentId ? 2 : undefined;
}

/** Records only synchronous engine observations tied to a server-confirmed paid match. */
export class ChessTurnReplayCapture {
  private candidate?: PvpChallenge;
  private active?: ActiveCapture;

  constructor(private readonly accountForSession: (sessionId: string) => string | undefined,
    private readonly sink: (recording: CapturedChessReplay) => void, private readonly now = () => performance.now()) {}

  private seat(session: string, match: PvpChallenge) {
    const account = this.accountForSession(session);
    return account ? winnerSeat(match, account) ?? undefined : undefined;
  }

  observeMatches(matches: readonly PvpChallenge[], terminals: readonly PvpChallenge[] = []) {
    for (const terminal of terminals) this.observeTerminal(terminal);
    const candidates = matches.filter(paidChess);
    this.candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (this.active && this.candidate && this.active.match.id !== this.candidate.id) this.active = undefined;
  }

  private append(capture: ActiveCapture, at: number, data: EventData) {
    if (!Number.isFinite(at) || capture.events.length >= maximumRecordedEvents - (data.kind === 'terminal' ? 0 : 1)) {
      capture.gap = true;
      return;
    }
    const elapsed = Math.floor(Math.max(0, at - capture.startedAt, capture.events.at(-1)?.atMs ?? 0));
    if (!Number.isSafeInteger(elapsed)) {
      capture.gap = true;
      return;
    }
    capture.events.push({ sequence: capture.events.length + 1, atMs: elapsed, data, postings: [] });
  }

  private recordSuffix(capture: SuffixCapture, observation: Exclude<ChessReplayObservation, { kind: 'start' }>, position: TurnState) {
    const { atMs, state } = observation;
    const positions = observation.kind === 'move' ? movePositions(observation) : [];
    if (observation.kind === 'move' && (!validMovePositions(positions) || position.seatToMove !== other(observation.seat)) ||
        observation.kind !== 'move' && state.phase !== 'finished') return false;

    if (state.phase === 'finished') {
      const winner = state.winner === '' ? null : this.seat(state.winner, capture.match);
      if (winner === undefined || observation.kind === 'resign' && winner !== other(observation.seat) ||
          observation.kind === 'move' && winner !== null && winner !== observation.seat) return false;
      const outcome = observation.kind === 'timeout' ? 'timed-out' : observation.kind === 'resign' ? 'forfeited'
        : winner === null ? 'draw' : 'settled';
      capture.end = { outcome, winnerSeat: winner, at: atMs };
    }
    if (observation.kind !== 'timeout') this.append(capture, atMs, { kind: 'action', action: {
      profile: game.replayProfile, code: observation.kind, seat: observation.seat, positions,
    } });
    if (!capture.end) this.append(capture, atMs, { kind: 'checkpoint', state: position });
    capture.position = position;
    capture.ply = position.turn;
    return true;
  }

  observeEngine(observation: ChessReplayObservation) {
    const match = this.candidate;
    if (!match || this.seat(observation.players[0], match) !== 1 || this.seat(observation.players[1], match) !== 2) return;
    if (observation.kind === 'start') {
      if (this.active) { this.active.gap = true; return; }
      const chess = new Chess();
      if (observation.state.phase !== 'playing' || !observedBoard(observation, chess) || !Number.isFinite(observation.atMs) ||
        !Number.isSafeInteger(observation.state.revision) || observation.state.revision < 0) return;
      this.active = { match, chess, initial: stateOf(chess, 0), events: [], startedAt: observation.atMs,
        ply: 0, revision: observation.state.revision, disconnected: new Set(), gap: false };
      this.append(this.active, observation.atMs, { kind: 'checkpoint', state: this.active.initial });
      return;
    }

    const capture = this.active;
    if (!capture) {
      const position = observedPosition(observation.state);
      if (!position || !Number.isFinite(observation.atMs) || !Number.isSafeInteger(observation.state.revision) ||
          observation.state.revision < 0) return;
      const suffix: SuffixCapture = { match, chess: null, initial: null, position, events: [], startedAt: observation.atMs,
        ply: position.turn, revision: observation.state.revision, disconnected: new Set(), gap: false };
      if (this.recordSuffix(suffix, observation, position)) this.active = suffix;
      return;
    }
    if (capture.end || capture.match.id !== match.id || capture.gap) return;
    if (observation.state.revision !== capture.revision + 1) { capture.gap = true; return; }
    capture.revision = observation.state.revision;
    const { chess } = capture;
    if (!chess) {
      const position = observedPosition(observation.state);
      if (!position || (observation.kind === 'move' ? position.turn !== capture.ply + 1 : !sameState(position, capture.position)) ||
          !this.recordSuffix(capture, observation, position)) capture.gap = true;
      return;
    }
    if (observation.kind === 'move') {
      const positions = movePositions(observation);
      if (!makeMove(chess, observation.seat, positions) || !observedBoard(observation, chess) ||
          (observation.state.phase === 'finished') !== chess.isGameOver()) {
        capture.gap = true;
        return;
      }
      capture.ply++;
      this.append(capture, observation.atMs, { kind: 'action', action: { profile: game.replayProfile,
        code: 'move', seat: observation.seat, positions } });
      if (chess.isGameOver()) capture.end = { outcome: chess.isCheckmate() ? 'settled' : 'draw',
        winnerSeat: chess.isCheckmate() ? observation.seat : null, at: observation.atMs };
      else if (capture.ply % checkpointEveryMoves === 0) {
        this.append(capture, observation.atMs, { kind: 'checkpoint', state: stateOf(chess, capture.ply) });
      }
    } else {
      if (observation.state.phase !== 'finished' || !observedBoard(observation, chess)) { capture.gap = true; return; }
      if (observation.kind === 'resign') {
        capture.end = { outcome: 'forfeited', winnerSeat: other(observation.seat), at: observation.atMs };
        this.append(capture, observation.atMs, { kind: 'action', action: { profile: game.replayProfile,
          code: 'resign', seat: observation.seat, positions: [] } });
      } else {
        const winningSide = chess.turn() === 'w' ? 'b' : 'w';
        capture.end = { outcome: 'timed-out', winnerSeat: chessTimeoutDraw(boardOf(chess), winningSide) ? null : sideSeat(winningSide),
          at: observation.atMs };
      }
    }
    if (capture.end && (capture.end.winnerSeat === null ? '' : observation.players[capture.end.winnerSeat - 1]) !== observation.state.winner) {
      capture.gap = true;
      capture.end = undefined;
    }
  }

  observePresence(sessionId: string, event: 'disconnected' | 'reconnected') {
    const capture = this.active;
    const seat = capture && this.seat(sessionId, capture.match);
    if (!capture || !seat || capture.end || capture.gap || capture.disconnected.has(seat) === (event === 'disconnected')) return;
    if (event === 'disconnected') capture.disconnected.add(seat);
    else capture.disconnected.delete(seat);
    this.append(capture, this.now(), { kind: 'presence', event, seat });
  }

  observeAdjudication(matchId: string, winnerId: string | null, reason: 'win' | 'draw', finishedAtMs: number) {
    const capture = this.active;
    if (!capture || capture.match.id !== matchId) return;
    this.finish(capture, winnerId, reason, finishedAtMs);
  }

  observeTerminal(challenge: PvpChallenge, acceptedResignationActor?: string) {
    const capture = this.active;
    if (!capture || challenge.id !== capture.match.id || challenge.gameId !== 'chess' ||
      challenge.creatorId !== capture.match.creatorId || challenge.opponentId !== capture.match.opponentId ||
      (challenge.status !== 'finished' && challenge.status !== 'cancelled')) return;
    const reason = challenge.reason;
    if (reason === 'win' || reason === 'draw' || reason === 'resign' || reason === 'disconnect' || reason === 'server' || reason === 'timeout') {
      this.finish(capture, challenge.winnerId, reason, challenge.expiresAt, acceptedResignationActor);
    }
  }

  private finish(capture: ActiveCapture, winnerId: string | null, reason: WalletOutcome, finishedAtMs: number, acceptedResignationActor?: string) {
    const winner = winnerSeat(capture.match, winnerId);
    if (winner === undefined || !Number.isSafeInteger(finishedAtMs) || finishedAtMs < 0 ||
      (reason === 'draw' || reason === 'server') && winner !== null ||
      (reason === 'win' || reason === 'resign' || reason === 'disconnect') && winner === null) return;

    this.active = undefined;
    this.candidate = undefined;
    const now = this.now();
    let end = capture.end;
    if (!end && !capture.gap) {
      const resigningSeat = acceptedResignationActor ? winnerSeat(capture.match, acceptedResignationActor) : null;
      if (reason === 'resign' && winner !== null && resigningSeat === other(winner)) {
        this.append(capture, now, { kind: 'action', action: { profile: game.replayProfile, code: 'resign', seat: resigningSeat, positions: [] } });
        end = { outcome: 'forfeited', winnerSeat: winner, at: now };
      } else if (reason === 'disconnect' && winner !== null && capture.disconnected.has(other(winner))) {
        end = { outcome: 'forfeited', winnerSeat: winner, at: now };
      } else if (reason === 'server') end = { outcome: 'cancelled', winnerSeat: null, at: now };
    }
    if (!end || end.winnerSeat !== winner ||
      (reason === 'win' || reason === 'draw') && end.outcome === 'cancelled' ||
      reason === 'server' && end.outcome !== 'cancelled') {
      capture.gap = true;
      end = undefined;
    }
    if (end && !capture.gap) {
      const phase = end.outcome === 'cancelled' ? 'cancelled' : 'settled';
      const state: TurnState = capture.chess ? stateOf(capture.chess, capture.ply, phase)
        : { ...capture.position, phase, seatToMove: null };
      this.append(capture, end.at, { kind: 'terminal', outcome: end.outcome, winnerSeat: end.winnerSeat, state });
    }
    const gaps: Gap[] = capture.initial === null ? ['initial-state-unavailable', 'event-gap'] : capture.gap ? ['event-gap'] : [];
    if (capture.events.at(-1)?.data.kind !== 'terminal') gaps.push('terminal-unavailable');
    this.sink({ matchId: capture.match.id, initial: capture.initial, events: capture.events, gaps,
      settlement: { reason, winnerSeat: winner, finishedAtMs } });
  }
}

export function buildChessTurnReplay(recording: CapturedChessReplay, scope: AuditScope, links: {
  start?: AuditSourceRef[]; terminal?: AuditSourceRef[]; startMoney?: ReplayEvent['money']; terminalMoney?: ReplayEvent['money'];
  sourceGap?: boolean;
} = {}): ReplayPackage {
  const terminalIndex = recording.events.length - 1;
  const events = recording.events.map((event, index) => {
    const isStart = recording.initial !== null && index === 0 && event.data.kind === 'checkpoint' && event.atMs === 0;
    const isTerminal = index === terminalIndex && event.data.kind === 'terminal';
    const money = isStart ? links.startMoney : isTerminal ? links.terminalMoney : undefined;
    const postings = isStart ? links.start : isTerminal ? links.terminal : undefined;
    return { ...event, postings: postings ?? money?.map(leg => leg.posting) ?? [], ...(money?.length ? { money } : {}) };
  });
  const gaps = links.sourceGap ? [...recording.gaps, 'source-unavailable' as const] : recording.gaps;
  const replay = createReplayPackage({ formatVersion: 2, scope, replayId: recording.matchId,
    entityId: recording.matchId, game, initial: recording.initial, gaps,
    coverage: gaps.length ? 'partial' : 'complete' }, events);
  if (verifyChessTurnReplay(replay).status !== 'verified') throw new Error('Invalid chess replay evidence');
  return replay;
}

/** Validates observed suffix order and boards without simulating the unobserved start. */
function verifyObservedSuffix(events: readonly ReplayEvent[], onState?: (sequence: number, state: TurnState) => void) {
  const corrupt = { status: 'corrupt' } as const;
  let previous: TurnState | null = null;
  let pending: Extract<Extract<EventData, { kind: 'action' }>['action'], { profile: 'pvp-turn-based' }> | null = null;
  const disconnected = new Set<Seat>();
  for (const [index, { sequence, atMs, data, postings, money }] of events.entries()) {
    if (sequence !== index + 1 || (index === 0 && atMs !== 0) || data.kind !== 'terminal' && postings.length > 0 ||
        money?.some(leg => leg.movement !== 'payout' && leg.movement !== 'refund')) return corrupt;
    if (data.kind === 'action') {
      const { action } = data;
      if (action.profile !== 'pvp-turn-based' || pending ||
          (action.code === 'move' ? !validMovePositions(action.positions) || !!previous && action.seat !== previous.seatToMove
            : action.code !== 'resign' || action.positions.length > 0)) return corrupt;
      pending = action;
      continue;
    }
    if (data.kind === 'presence') {
      if (!previous || pending || disconnected.has(data.seat) === (data.event === 'disconnected')) return corrupt;
      if (data.event === 'disconnected') disconnected.add(data.seat);
      else disconnected.delete(data.seat);
      continue;
    }
    const { state } = data;
    const move = pending?.code === 'move' ? pending : null;
    const nextSeat = state.profile === 'pvp-turn-based' && state.turn % 2 === 0 ? 1 : 2;
    if (state.profile !== 'pvp-turn-based' || state.turn < 1 || state.board.length !== 64 || state.board.some(code => code > 12) ||
        state.board.filter(code => code === 6).length !== 1 || state.board.filter(code => code === 12).length !== 1 ||
        move && move.seat === nextSeat || previous && (state.turn !== previous.turn + Number(!!move) ||
          !move && !sameBoard(previous.board, state.board))) return corrupt;
    if (data.kind === 'checkpoint') {
      if (!move || state.seatToMove !== nextSeat) return corrupt;
    } else if (state.seatToMove !== null || state.phase !== (data.outcome === 'cancelled' ? 'cancelled' : 'settled') ||
        (data.outcome === 'settled' || data.outcome === 'draw') && (!move || data.winnerSeat !== (data.outcome === 'draw' ? null : move.seat)) ||
        data.outcome === 'forfeited' && (data.winnerSeat === null ||
          (pending ? pending.code !== 'resign' || data.winnerSeat !== other(pending.seat) : !disconnected.has(other(data.winnerSeat)))) ||
        (data.outcome === 'timed-out' || data.outcome === 'cancelled') && pending) return corrupt;
    previous = state;
    pending = null;
    onState?.(sequence, state);
  }
  return { status: 'verified' as const, state: previous };
}

/** Replays full history from the pinned initial position and validates partial evidence separately. */
export function verifyChessTurnReplay(input: unknown, onState?: (sequence: number, state: TurnState) => void):
  { status: 'verified'; state: TurnState | null } | { status: 'corrupt' | 'unsupported' | 'too-large' | 'incomplete' } {
  const checked = verifyReplayPackage(input, [chessTurnReplayDefinition]);
  if (checked.status !== 'verified') return { status: checked.status };
  const { manifest, fragments } = checked.value;
  const events = fragments.flatMap(fragment => fragment.events);
  if (!manifest.initial) return !events.length || manifest.gaps.includes('event-gap')
    ? verifyObservedSuffix(events, onState) : { status: 'corrupt' };
  const chess = new Chess();
  let ply = 0, previous: TurnState = stateOf(chess, ply), resignation: Seat | undefined;
  const spent = [0, 0];
  let lastMoveAt = 0;
  const disconnected = new Set<Seat>();
  if (!sameState(manifest.initial, previous)) return { status: 'corrupt' };

  for (const { sequence, data, atMs } of events) {
    const clockSeat = sideSeat(chess.turn());
    const clockTime = spent[clockSeat - 1] + atMs - lastMoveAt;
    if (data.kind === 'action') {
      const action = data.action;
      if (action.profile !== game.replayProfile || resignation || chess.isGameOver() ||
        data.action.code === 'move' && clockTime > CHESS_TIME_MS + ply + 1) return { status: 'corrupt' };
      if (action.code === 'resign' && !action.positions.length) resignation = action.seat;
      else if (action.code === 'move' && makeMove(chess, action.seat, action.positions)) {
        spent[clockSeat - 1] = clockTime;
        lastMoveAt = atMs;
        previous = stateOf(chess, ++ply);
      }
      else return { status: 'corrupt' };
    } else if (data.kind === 'presence') {
      if (resignation || chess.isGameOver() || disconnected.has(data.seat) === (data.event === 'disconnected')) return { status: 'corrupt' };
      if (data.event === 'disconnected') disconnected.add(data.seat);
      else disconnected.delete(data.seat);
    } else if (data.kind === 'checkpoint') {
      if (resignation || chess.isGameOver() || !sameState(data.state, previous)) return { status: 'corrupt' };
    } else if (data.kind === 'terminal') {
      if (data.outcome === 'settled' && (!chess.isCheckmate() || data.winnerSeat !== other(sideSeat(chess.turn()))) ||
        data.outcome === 'draw' && (!chess.isDraw() || data.winnerSeat !== null) ||
        data.outcome === 'forfeited' && (chess.isGameOver() || data.winnerSeat === null ||
          (resignation ? data.winnerSeat !== other(resignation) : !disconnected.has(other(data.winnerSeat)))) ||
        data.outcome === 'timed-out' && (resignation || chess.isGameOver() || clockTime < CHESS_TIME_MS - ply - 1 ||
          data.winnerSeat !== (chessTimeoutDraw(boardOf(chess), chess.turn() === 'w' ? 'b' : 'w') ? null : other(sideSeat(chess.turn())))) ||
        data.outcome === 'cancelled' && (resignation || chess.isGameOver() || data.winnerSeat !== null)) return { status: 'corrupt' };
      const terminal = stateOf(chess, ply, data.outcome === 'cancelled' ? 'cancelled' : 'settled');
      if (!sameState(data.state, terminal)) return { status: 'corrupt' };
      previous = terminal;
    } else return { status: 'corrupt' };
    onState?.(sequence, previous);
  }
  return { status: 'verified', state: previous };
}
