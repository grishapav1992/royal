import { PVP_MOVE_MS, cardRank, isPvpCardGame, validPvpRequest, type PvpCardGameId, type PvpChallenge, type PvpSnapshot } from '../../src/shared/pvp';
import type { AuditScope } from './contract';
import { createReplayPackage, isReplayId, verifyReplayPackage, type ReplayDefinition, type ReplayEvent, type ReplayState } from './replay-package';

const cardGames = ['durak', 'transfer-durak', 'crazy-eights'] as const;
export const cardTurnReplayDefinitions: readonly ReplayDefinition[] = cardGames.map(gameId => ({
  gameId, formatVersion: 2, modeId: 'stake', category: 'pvp', replayProfile: 'pvp-turn-based',
  rulesVersion: 'royal-cards-v1', gameVersion: 'royal-cards-v1', engineId: 'royal-cards',
  engineVersion: '42db70683726228f6ab2217c7ef48b269cf372368950faa9f4555825880f6cf0',
}));
export const isCardTurnReplayGame = isPvpCardGame;

export type CardSeat = 1 | 2;
export type CardTurnState = Extract<ReplayState, { profile: 'pvp-turn-based' }>;
type CardAction = Extract<Extract<ReplayEvent['data'], { kind: 'action' }>['action'], { profile: 'pvp-turn-based' }>;
type CardTerminal = Extract<ReplayEvent['data'], { kind: 'terminal' }> & { state: CardTurnState };
type Money = NonNullable<ReplayEvent['money']>;
export type CardReplayReceipt = { requestId: string; seat: CardSeat };
export type CardReplayMove = CardReplayReceipt & { prior: number; action: CardAction; after: CardTurnState };
export type CapturedCardReplay = {
  matchId: string;
  gameId: PvpCardGameId;
  initial: { state: CardTurnState; receipt: CardReplayReceipt; startedAtMs: number | null } | null;
  moves: CardReplayMove[];
  resign: CardReplayReceipt | null;
};

type CardPosition = {
  handCounts: [number, number]; stockCount: number; discardCount: number; trump: number | null;
  suit: number; attackerSeat: CardSeat; collecting: boolean; table: { attack: number; defense?: number }[];
};
const gameMoveKinds = ['play', 'attack', 'defend', 'transfer', 'take', 'done', 'draw', 'pass'] as const;
const byGame = {
  durak: ['attack', 'defend', 'take', 'done'],
  'transfer-durak': ['attack', 'defend', 'transfer', 'take', 'done'],
  'crazy-eights': ['play', 'draw', 'pass'],
} as const;
const maxMoves = 1024;
const maxTurn = Math.floor((Number.MAX_SAFE_INTEGER - 3) / 2);
const isInteger = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const isSeat = (n: unknown): n is CardSeat => n === 1 || n === 2;
const sameTokens = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((token, index) => token === right[index]);
const sameState = (left: ReplayState | null, right: CardTurnState) => left?.profile === 'pvp-turn-based' &&
  left.phase === right.phase && left.turn === right.turn && left.seatToMove === right.seatToMove && sameTokens(left.board, right.board);
const isCard = (game: PvpCardGameId, value: unknown): value is number =>
  isInteger(value, 0, 51) && (game === 'crazy-eights' || cardRank(value) >= 6);
const toSeat = (value: unknown): CardSeat | null => value === 0 ? 1 : value === 1 ? 2 : null;
export const cardParticipantSeat = (match: Pick<PvpChallenge, 'creatorId' | 'opponentId'>, accountId: unknown): CardSeat | null =>
  typeof accountId === 'string' ? accountId === match.creatorId ? 1 : accountId === match.opponentId ? 2 : null : null;

/** Decode the public positions only. The two hand fields hold counts. */
export function decodeCardReplayPosition(gameId: PvpCardGameId, board: readonly number[]): CardPosition | null {
  if (board.length < 8 || board.length > 20 || board.length % 2 !== 0) return null;
  const [first, second, stockCount, discardCount, faceUp, suit, attackerSeat, collecting] = board;
  const crazy = gameId === 'crazy-eights';
  const deckSize = crazy ? 52 : 36;
  if (![first, second, stockCount, discardCount].every(n => isInteger(n, 0, deckSize)) ||
      !isInteger(faceUp, 0, 52) || faceUp !== 0 && !isCard(gameId, faceUp - 1) ||
      !isInteger(suit, 0, 3) || !isSeat(attackerSeat) || !isInteger(collecting, 0, 1)) return null;
  const table: CardPosition['table'] = [];
  const visible = new Set<number>(faceUp ? [faceUp - 1] : []);
  for (let i = 8; i < board.length; i += 2) {
    const attack = board[i] - 1, defense = board[i + 1] - 1;
    if (!isCard(gameId, attack) || visible.has(attack)) return null;
    visible.add(attack);
    if (defense === -1) { table.push({ attack }); continue; }
    if (!isCard(gameId, defense) || visible.has(defense)) return null;
    visible.add(defense);
    table.push({ attack, defense });
  }
  const total = first + second + stockCount + discardCount;
  if (crazy ? (total !== deckSize || discardCount === 0 || faceUp !== 0 || collecting !== 0 || board.length !== 10 || board[9] !== 0)
    : (total + visible.size - Number(faceUp !== 0) !== deckSize || (stockCount === 0) !== (faceUp === 0))) return null;
  return { handCounts: [first, second], stockCount, discardCount, trump: faceUp ? faceUp - 1 : null,
    suit, attackerSeat, collecting: collecting === 1, table };
}

/** The caller supplies only public values, then this projection validates the closed format. */
export function cardReplayState(gameId: PvpCardGameId, view: {
  revision: unknown; actor: unknown; attacker: unknown; handCounts: unknown[]; stockCount: unknown;
  discardCount: unknown; trump: unknown; suit: unknown; collecting: unknown; table: unknown;
}, phase: CardTurnState['phase']): CardTurnState | null {
  const actor = toSeat(view.actor), attacker = toSeat(view.attacker);
  if (!isInteger(view.revision, 0, maxTurn) || !actor || !attacker || view.handCounts.length !== 2 ||
      typeof view.collecting !== 'boolean' || view.trump !== null && !isCard(gameId, view.trump) ||
      !Array.isArray(view.table) || view.table.length > 6) return null;
  const board = [...view.handCounts, view.stockCount, view.discardCount, view.trump === null ? 0 : view.trump + 1,
    view.suit, attacker, view.collecting ? 1 : 0];
  for (const pair of view.table) {
    if (!pair || !isCard(gameId, pair.attack) || pair.defense !== undefined && !isCard(gameId, pair.defense)) return null;
    board.push(pair.attack + 1, pair.defense === undefined ? 0 : pair.defense + 1);
  }
  if (!board.every((n): n is number => isInteger(n, 0, 52)) || !decodeCardReplayPosition(gameId, board)) return null;
  return { profile: 'pvp-turn-based', phase, turn: view.revision, seatToMove: phase === 'open' ? actor : null, board };
}

export function cardReplayAction(gameId: PvpCardGameId, seat: CardSeat, move: unknown): CardAction | null {
  if (!move || typeof move !== 'object' || Array.isArray(move)) return null;
  const row = move as Record<string, unknown>;
  const index = gameMoveKinds.findIndex(kind => kind === row.kind);
  const kind = gameMoveKinds[index];
  if (!(byGame[gameId] as readonly string[]).includes(kind)) return null;
  const positions = [index + 1];
  if (index < 4) {
    if (!isCard(gameId, row.card)) return null;
    positions.push(row.card + 1);
    if (kind === 'defend') {
      if (!isInteger(row.target, 0, 5)) return null;
      positions.push(row.target);
    } else if (kind === 'play' && cardRank(row.card) === 8) {
      if (!isInteger(row.suit, 0, 3)) return null;
      positions.push(row.suit);
    }
  }
  return { profile: 'pvp-turn-based', code: kind === 'pass' ? 'pass' : 'move', seat, positions };
}

export function decodeCardReplayAction(gameId: PvpCardGameId, action: CardAction) {
  if (action.code === 'resign') return action.positions.length === 0 ? { kind: 'resign' as const } : null;
  const [kindCode, cardCode, extra] = action.positions;
  const kind = gameMoveKinds[kindCode - 1];
  const move = { kind, ...(cardCode === undefined ? {} : { card: cardCode - 1 }),
    ...(extra === undefined ? {} : { [kind === 'defend' ? 'target' : 'suit']: extra }) };
  const encoded = cardReplayAction(gameId, action.seat, move);
  return encoded && encoded.code === action.code && sameTokens(encoded.positions, action.positions) ? move : null;
}

function initialPosition(game: PvpCardGameId, state: CardTurnState) {
  const position = decodeCardReplayPosition(game, state.board);
  if (state.phase !== 'open' || state.turn !== 0 || !position || state.seatToMove !== position.attackerSeat || position.collecting) return false;
  const crazy = game === 'crazy-eights', count = crazy ? 7 : 6;
  return position.handCounts.every(value => value === count) && (crazy
    ? position.discardCount === 1 && cardRank(position.table[0].attack) !== 8
    : position.discardCount === 0 && position.table.length === 0);
}

/** Uses only private service responses. A later retry at a different revision cannot supply a checkpoint. */
export class CardsTurnReplayCapture {
  private readonly active = new Map<string, CapturedCardReplay>();
  private readonly finished = new Set<string>();

  constructor(private readonly sink: (recording: CapturedCardReplay) => void) {}

  observeCommand(accountId: string, request: unknown, snapshot: PvpSnapshot) {
    this.observeAcceptedCommand(accountId, request, snapshot);
    this.observeSnapshot(snapshot);
  }

  private observeAcceptedCommand(accountId: string, request: unknown, snapshot: PvpSnapshot) {
    const match = snapshot.active, cards = snapshot.cards;
    if (!match || !cards || !validPvpRequest(request) || snapshot.requestId !== request.id ||
        !('challengeId' in request) || request.challengeId !== match.id ||
        !isPvpCardGame(match.gameId) || cards.gameId !== match.gameId) return;
    const seat = cardParticipantSeat(match, accountId);
    if (!seat || toSeat(cards.self) !== seat || !Array.isArray(cards.hand)) return;
    const recording = this.recording(match);
    if (!recording) return;
    const phase = match.status === 'playing' ? 'open' : match.status === 'finished' ? 'settled' : 'cancelled';
    const handCounts = seat === 1 ? [cards.hand.length, cards.opponentCount] : [cards.opponentCount, cards.hand.length];
    const state = cardReplayState(match.gameId, { ...cards, handCounts }, phase);
    if (state && request.action === 'ready' && initialPosition(match.gameId, state) && !recording.initial) {
      // At revision zero, only the ready transition sets the ordinary card deadline.
      const startedAtMs = isInteger(match.expiresAt, PVP_MOVE_MS, Number.MAX_SAFE_INTEGER) ? match.expiresAt - PVP_MOVE_MS : null;
      recording.initial = { state, receipt: { requestId: request.id, seat }, startedAtMs };
    }
    if (state && request.action === 'move' && state.turn === request.revision + 1 &&
        (phase === 'open' || match.reason === 'win' || match.reason === 'draw') && recording.moves.length < maxMoves &&
        !recording.moves.some(row => row.prior === request.revision)) {
      const action = cardReplayAction(match.gameId, seat, request.move);
      if (action) recording.moves.push({ requestId: request.id, seat, prior: request.revision, action, after: state });
    }
    if (request.action === 'resign' && match.reason === 'resign' && phase === 'settled' && !recording.resign) {
      recording.resign = { requestId: request.id, seat };
    }
  }

  observeSnapshot(snapshot: PvpSnapshot) {
    if (snapshot.active?.status === 'playing' && snapshot.cards) this.recording(snapshot.active);
    else if (snapshot.active) this.observeTerminal(snapshot.active);
    for (const match of snapshot.challenges ?? []) if (this.active.has(match.id)) this.observeTerminal(match);
  }

  observeMatches(matches: readonly PvpChallenge[]) {
    const live = new Set(matches.map(match => match.id));
    for (const matchId of this.active.keys()) if (!live.has(matchId)) this.finish(matchId);
  }

  private recording(match: PvpChallenge) {
    if (!isPvpCardGame(match.gameId) || !isReplayId(match.id) || (!match.opponentId && match.status !== 'cancelled') ||
        !/^[1-9][0-9]{0,19}$/.test(match.stakeUnits) || match.mode === 'free' || this.finished.has(match.id)) return null;
    let recording = this.active.get(match.id);
    if (!recording) {
      if (this.active.size >= 16) return null;
      recording = { matchId: match.id, gameId: match.gameId, initial: null, moves: [], resign: null };
      this.active.set(match.id, recording);
    }
    return recording;
  }

  private observeTerminal(match: PvpChallenge) {
    if ((match.status === 'finished' || match.status === 'cancelled') && this.recording(match)) this.finish(match.id);
  }

  private finish(matchId: string) {
    const recording = this.active.get(matchId);
    if (!recording) return;
    this.active.delete(matchId);
    this.finished.add(matchId);
    if (this.finished.size > 256) this.finished.delete(this.finished.values().next().value!);
    this.sink(recording);
  }
}

export function buildCardTurnReplay(recording: CapturedCardReplay, scope: AuditScope, evidence: {
  terminal: CardTerminal; startMoney: Money; terminalMoney: Money; sourceGap: boolean; resignVerified: boolean; resignExpected: boolean;
  clocks?: { startedAtMs: number; finishedAtMs: number; moves: ReadonlyMap<number, number>; resignedAtMs?: number };
}) {
  const { terminal, startMoney, terminalMoney, sourceGap, resignVerified, resignExpected, clocks } = evidence;
  const { formatVersion: _, ...game } = cardTurnReplayDefinitions.find(row => row.gameId === recording.gameId)!;
  const initial = recording.initial?.state ?? null;
  const gaps: ('initial-state-unavailable' | 'event-gap' | 'source-unavailable')[] = [];
  const events: ReplayEvent[] = [];
  let sourceOrder = clocks === undefined || initial === null;
  let previousMs = 0;
  const add = (sequence: number, data: ReplayEvent['data'], sourceAtMs: number | undefined, money: Money = []) => {
    const elapsed = sourceAtMs === undefined || !clocks ? null : sourceAtMs - clocks.startedAtMs;
    if (!isInteger(elapsed, previousMs, Number.MAX_SAFE_INTEGER)) sourceOrder = true;
    else previousMs = elapsed;
    events.push({ sequence, atMs: previousMs, data, postings: money.map(leg => leg.posting), ...(money.length ? { money } : {}) });
  };
  if (initial) add(1, { kind: 'checkpoint', state: initial }, clocks?.startedAtMs, startMoney);
  else gaps.push('initial-state-unavailable');
  const neverStarted = terminal.state.board.length === 0;
  let next = 0;
  let previous = initial;
  let naturalFinish = false;
  for (const move of [...recording.moves].sort((a, b) => a.prior - b.prior)) {
    if (move.prior < next || move.prior >= terminal.state.turn ||
        previous?.turn === move.prior && previous.seatToMove !== move.seat) continue;
    const finalMove = move.after.phase === 'settled' && move.after.turn === terminal.state.turn &&
      (terminal.outcome === 'settled' || terminal.outcome === 'draw');
    if (move.after.phase !== 'open' && !finalMove) continue;
    const atMs = clocks?.moves.get(move.prior);
    add(2 + move.prior * 2, { kind: 'action', action: move.action }, atMs);
    if (finalMove) {
      naturalFinish = true;
      if (atMs !== clocks?.finishedAtMs) sourceOrder = true;
    } else add(3 + move.prior * 2, { kind: 'checkpoint', state: move.after }, atMs);
    previous = move.after;
    next = move.prior + 1;
  }
  const moveCount = events.filter(event => event.data.kind === 'action').length;
  if (!initial && !neverStarted || moveCount !== terminal.state.turn || resignExpected && !resignVerified) gaps.push('event-gap');
  if (sourceGap) gaps.push('source-unavailable');
  let terminalSequence = neverStarted ? 1 : 2 + terminal.state.turn * 2 - Number(naturalFinish);
  if (recording.resign && resignVerified) {
    add(terminalSequence++, { kind: 'action', action: { profile: 'pvp-turn-based', code: 'resign', seat: recording.resign.seat, positions: [] } },
      clocks?.resignedAtMs);
    if (clocks?.resignedAtMs !== clocks?.finishedAtMs) sourceOrder = true;
  }
  add(terminalSequence, terminal, clocks?.finishedAtMs, initial ? terminalMoney : [...startMoney, ...terminalMoney]);
  if (sourceOrder) for (const event of events) event.atMs = 0;
  return createReplayPackage({ formatVersion: 2, scope, replayId: recording.matchId, entityId: recording.matchId, game,
    initial, coverage: gaps.length ? 'partial' : 'complete', gaps, ...(sourceOrder ? { timing: 'source-order' } : {}) }, events);
}

/** Verifies the public transcript shape and known actor transitions. It cannot validate private card draws. */
export function verifyCardTurnReplay(input: unknown): ReturnType<typeof verifyReplayPackage> {
  const verified = verifyReplayPackage(input, cardTurnReplayDefinitions);
  if (verified.status !== 'verified') return verified;
  const { manifest, fragments } = verified.value;
  const gameId = manifest.game.gameId;
  const corrupt = { status: 'corrupt' } as const;
  if (!isPvpCardGame(gameId) || !manifest.initial && manifest.timing !== 'source-order') return corrupt;
  if (manifest.initial && (manifest.initial.profile !== 'pvp-turn-based' || !initialPosition(gameId, manifest.initial))) return corrupt;
  const events = fragments.flatMap(fragment => fragment.events);
  const terminal = events.at(-1);
  if (!terminal || terminal.data.kind !== 'terminal' || terminal.data.state.profile !== 'pvp-turn-based' ||
      (!!manifest.initial !== (events[0].sequence === 1 && events[0].data.kind === 'checkpoint'))) return corrupt;
  let state = manifest.initial;
  let pending: ReplayEvent | null = null;
  let moves = 0;
  for (const event of events) {
    const data = event.data;
    if (manifest.timing === 'source-order' && event.atMs !== 0 || event.pool || event.calculation || data.kind === 'presence') return corrupt;
    if (data.kind === 'action') {
      if (event.postings.length || event.money?.length || pending || data.action.profile !== 'pvp-turn-based' ||
          !decodeCardReplayAction(gameId, data.action) || event.sequence < 2 || event.sequence % 2 !== 0) return corrupt;
      if (data.action.code === 'resign') {
        if (event.sequence !== terminal.sequence - 1 || terminal.data.outcome !== 'forfeited' ||
            terminal.data.winnerSeat === data.action.seat || terminal.data.winnerSeat === null) return corrupt;
      } else {
        if (state?.profile === 'pvp-turn-based' && state.turn === (event.sequence - 2) / 2 && state.seatToMove !== data.action.seat) return corrupt;
        moves++;
      }
      pending = event;
      continue;
    }
    if (data.state.profile !== 'pvp-turn-based' || (data.state.phase === 'open') !== (data.state.seatToMove !== null)) return corrupt;
    const neverStarted = data.kind === 'terminal' && data.outcome === 'cancelled' && data.winnerSeat === null &&
      data.state.phase === 'cancelled' && data.state.turn === 0 && data.state.board.length === 0 && !manifest.initial;
    if (!neverStarted && !decodeCardReplayPosition(gameId, data.state.board)) return corrupt;
    const isResign = pending?.data.kind === 'action' && pending.data.action.code === 'resign';
    if (data.kind === 'terminal') {
      const finalMove = pending !== null && !isResign && (data.outcome === 'settled' || data.outcome === 'draw');
      const expected = neverStarted ? 1 : data.state.turn * 2 + (isResign ? 3 : finalMove ? 1 : 2);
      const winnerRequired = data.outcome === 'settled' || data.outcome === 'forfeited' || data.outcome === 'timed-out';
      if (pending && !isResign && !finalMove || (winnerRequired !== (data.winnerSeat !== null)) ||
          data.state.phase !== (data.outcome === 'cancelled' ? 'cancelled' : 'settled') || event.sequence !== expected ||
          pending && (pending.sequence !== expected - 1 || pending.atMs !== event.atMs) ||
          state?.profile === 'pvp-turn-based' && state.turn === data.state.turn && !sameTokens(state.board, data.state.board)) return corrupt;
    } else if (event.sequence === 1) {
      if (!sameState(manifest.initial, data.state) || event.atMs !== 0 || pending || event.money?.some(leg => leg.movement !== 'reserve')) return corrupt;
    } else if (!pending || isResign || event.sequence !== pending.sequence + 1 || event.atMs !== pending.atMs ||
        data.state.turn !== (event.sequence - 1) / 2 || event.postings.length || event.money?.length) return corrupt;
    state = data.state;
    pending = null;
  }
  if (manifest.coverage === 'complete' && (!manifest.initial || moves !== terminal.data.state.turn ||
      events.some((event, index) => event.sequence !== index + 1))) return corrupt;
  return verified;
}
