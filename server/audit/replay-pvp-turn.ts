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
  state: { board: Board; turn: 'w' | 'b'; phase: 'playing' | 'finished'; winner: string; revision: number };
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

function makeMove(chess: Chess, seat: Seat, positions: readonly number[]): boolean {
  if (chess.isGameOver() || seat !== sideSeat(chess.turn()) || (positions.length !== 2 && positions.length !== 3)) return false;
  const [from, to, promoted] = positions;
  if (from < 0 || from > 63 || to < 0 || to > 63 || promoted !== undefined && (promoted < 1 || promoted > 4)) return false;
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
  chess: Chess;
  initial: TurnState;
  events: ReplayEvent[];
  startedAt: number;
  ply: number;
  revision: number;
  disconnected: Set<Seat>;
  gap: boolean;
  end?: { outcome: Terminal['outcome']; winnerSeat: Seat | null; at: number };
};

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
    if (!capture || capture.end || capture.match.id !== match.id || capture.gap) return;
    if (observation.state.revision !== capture.revision + 1) { capture.gap = true; return; }
    capture.revision = observation.state.revision;
    const { chess } = capture;
    if (observation.kind === 'move') {
      const positions = [indexOfSquare(observation.from), indexOfSquare(observation.to)];
      if (observation.promotion !== undefined) positions.push(promotions.indexOf(observation.promotion as Promotion) + 1);
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
    if (end && !capture.gap) this.append(capture, end.at, { kind: 'terminal', outcome: end.outcome, winnerSeat: end.winnerSeat,
      state: stateOf(capture.chess, capture.ply, end.outcome === 'cancelled' ? 'cancelled' : 'settled') });
    const gaps: Gap[] = [];
    if (capture.gap) gaps.push('event-gap');
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
    const isStart = index === 0 && event.data.kind === 'checkpoint' && event.atMs === 0;
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

/** Replays the whole game from the pinned initial state, preserving history-dependent chess rules. */
export function verifyChessTurnReplay(input: unknown, onState?: (sequence: number, state: TurnState) => void):
  { status: 'verified'; state: TurnState | null } | { status: 'corrupt' | 'unsupported' | 'too-large' | 'incomplete' } {
  const checked = verifyReplayPackage(input, [chessTurnReplayDefinition]);
  if (checked.status !== 'verified') return { status: checked.status };
  const { manifest, fragments } = checked.value;
  if (!manifest.initial) return manifest.coverage === 'partial' && !fragments.length ? { status: 'verified', state: null } : { status: 'corrupt' };
  const chess = new Chess();
  let ply = 0, previous: TurnState = stateOf(chess, ply), resignation: Seat | undefined;
  const spent = [0, 0];
  let lastMoveAt = 0;
  const disconnected = new Set<Seat>();
  if (!sameState(manifest.initial, previous)) return { status: 'corrupt' };

  for (const { sequence, data, atMs } of fragments.flatMap(fragment => fragment.events)) {
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
