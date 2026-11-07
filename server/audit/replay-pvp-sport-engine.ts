import type { TableState } from '../../src/shared/activities';
import { clampPaddle } from '../../src/shared/hockey';
import { TableGame } from '../tableGames';
import {
  verifyReplayPackage, type ReplayDefinition, type ReplayEvent, type SportGame, type SportReplayFrame,
} from './replay-package';

export const sportReplayDefinitions: ReplayDefinition[] = (['hockey', 'pool'] as const).map(gameId => ({
  gameId, modeId: 'stake', category: 'pvp', replayProfile: 'pvp-sport', formatVersion: 4,
  rulesVersion: 'royal-table-game-v1', gameVersion: 'royal-table-game-v1', engineId: 'royal-table-physics', engineVersion: '1',
}));

export const sportReplayMaximumTicks = 72_000;
type Seat = 1 | 2;
type TableInput =
  { kind: 'start' } | { kind: 'advance'; dt: number } |
  { kind: 'paddle' | 'place'; seat: Seat; x: number; y: number } |
  { kind: 'shot'; seat: Seat; angle: number; power: number; pocket: number };
/** Read-only view of the live engine. Its values change as the table advances. */
export type TableReplayObservation = TableInput & { state: Readonly<TableState> };
export type TableReplayObserver = (event: TableReplayObservation) => void;

const point = ({ x, y }: { x: number; y: number }) => ({ x: thousandths(x), y: thousandths(y) });
function thousandths(value: number) {
  const rounded = Math.round(value * 1000);
  return rounded === 0 ? 0 : rounded;
}
const phaseOf = (state: Readonly<TableState>): SportReplayFrame['phase'] => state.phase === 'finished' ? 'settled' : 'open';
const otherSeat = (seat: Seat): Seat => seat === 1 ? 2 : 1;
const syntheticId = (seat: Seat) => String(seat);

export function sportReplayFrame(state: Readonly<TableState>, tick: number,
  phase: SportReplayFrame['phase'] = phaseOf(state)): SportReplayFrame {
  return { profile: 'pvp-sport', game: state.id, phase, tick, score: [state.score[0], state.score[1]],
    turn: state.turn === 0 ? 1 : 2, moving: state.moving, breaking: state.breaking, ballInHand: state.ballInHand,
    groups: [state.groups[0], state.groups[1]], serveDelayMs: thousandths(state.serveDelay),
    balls: state.balls.map(ball => ({ id: ball.id, ...point(ball), vx: thousandths(ball.vx), vy: thousandths(ball.vy), active: ball.active })),
    paddles: [point(state.paddles[0]), point(state.paddles[1])] };
}

function sameFrame(a: SportReplayFrame, b: SportReplayFrame) {
  return a.game === b.game && a.phase === b.phase && a.tick === b.tick && a.score[0] === b.score[0] && a.score[1] === b.score[1] &&
    a.turn === b.turn && a.moving === b.moving && a.breaking === b.breaking && a.ballInHand === b.ballInHand &&
    a.groups[0] === b.groups[0] && a.groups[1] === b.groups[1] && a.serveDelayMs === b.serveDelayMs &&
    a.paddles.every((paddle, index) => paddle.x === b.paddles[index].x && paddle.y === b.paddles[index].y) &&
    a.balls.length === b.balls.length && a.balls.every((ball, index) => {
      const expected = b.balls[index];
      return ball.id === expected.id && ball.x === expected.x && ball.y === expected.y && ball.vx === expected.vx &&
        ball.vy === expected.vy && ball.active === expected.active;
    });
}

export type SportReplayVerification = { status: 'verified'; state: SportReplayFrame | null } |
  { status: 'corrupt' | 'unsupported' | 'too-large' | 'incomplete' };

/** Each callback frame is after its event. Seeking returns the latest known state at the requested physics tick. */
export function reconstructSportReplay(input: unknown, targetTick?: number,
  onFrame?: (event: ReplayEvent, state: SportReplayFrame) => void): SportReplayVerification {
  const checked = verifyReplayPackage(input, sportReplayDefinitions);
  if (checked.status !== 'verified') return { status: checked.status };
  if (targetTick !== undefined && (!Number.isSafeInteger(targetTick) || targetTick < 0)) return { status: 'corrupt' };
  const { manifest, fragments } = checked.value;
  if (!manifest.initial) return !fragments.length ? { status: 'verified', state: null } : { status: 'corrupt' };
  const engine = new TableGame(manifest.game.gameId as SportGame);
  engine.join(syntheticId(1)); engine.join(syntheticId(2));
  let tick = 0, sequence = 0;
  let selected = sportReplayFrame(engine.state, tick);
  if (manifest.initial.profile !== 'pvp-sport' || !sameFrame(manifest.initial, selected)) return { status: 'corrupt' };
  const callbacks: Array<{ event: ReplayEvent; state: SportReplayFrame }> = [];
  const disconnected = new Set<Seat>();
  let resigned: Seat | undefined;
  for (const fragment of fragments) for (const event of fragment.events) {
    if (event.sequence !== ++sequence) return { status: 'incomplete' };
    const { data } = event;
    const opening = event.sequence === 1 && event.atMs === 0 && data.kind === 'checkpoint';
    if (event.postings.length !== (event.money?.length ?? 0) || event.money?.some(leg => opening ? leg.movement !== 'reserve' :
      data.kind !== 'terminal' || (data.outcome === 'cancelled' ? leg.movement !== 'refund' : leg.movement !== 'payout'))) {
      return { status: 'corrupt' };
    }
    let phase = phaseOf(engine.state);
    if (data.kind === 'action') {
      const action = data.action;
      if (resigned || engine.state.phase !== 'playing' || action.profile !== 'pvp-sport') return { status: 'corrupt' };
      if (action.code === 'advance') {
        if (disconnected.size) return { status: 'corrupt' };
        if (tick + action.durations.length > sportReplayMaximumTicks) return { status: 'too-large' };
        for (const dt of action.durations) {
          if (engine.state.phase !== 'playing') return { status: 'corrupt' };
          engine.tick(dt);
          tick++;
          if (tick === targetTick) selected = sportReplayFrame(engine.state, tick);
        }
      } else if (action.code === 'resign') resigned = action.seat;
      else {
        if (disconnected.has(action.seat)) return { status: 'corrupt' };
        if (action.code === 'paddle') {
          if (engine.state.id !== 'hockey') return { status: 'corrupt' };
          const target = clampPaddle(action, action.seat - 1);
          if (target.x !== action.x || target.y !== action.y) return { status: 'corrupt' };
          engine.move(syntheticId(action.seat), action.x, action.y);
        } else if (action.code === 'place') {
          if (!engine.place(syntheticId(action.seat), action.x, action.y)) return { status: 'corrupt' };
        } else if (action.code === 'shot' && !engine.shoot(syntheticId(action.seat), action.angle, action.power, action.pocket)) {
          return { status: 'corrupt' };
        }
      }
      phase = phaseOf(engine.state);
    } else if (data.kind === 'presence') {
      if (resigned || engine.state.phase !== 'playing' || disconnected.has(data.seat) === (data.event === 'disconnected')) return { status: 'corrupt' };
      if (data.event === 'disconnected') disconnected.add(data.seat);
      else disconnected.delete(data.seat);
    } else if (data.kind === 'checkpoint') {
      if (resigned || data.state.profile !== 'pvp-sport' || !sameFrame(data.state, sportReplayFrame(engine.state, tick))) return { status: 'corrupt' };
    } else {
      const winner = data.winnerSeat;
      const valid = data.outcome === 'settled' && phase === 'settled' && winner !== null && engine.state.winner === syntheticId(winner) ||
        data.outcome === 'forfeited' && phase === 'open' && winner !== null && (resigned ? otherSeat(resigned) === winner : disconnected.has(otherSeat(winner))) ||
        data.outcome === 'cancelled' && phase === 'open' && !resigned && winner === null;
      if (!valid || data.state.profile !== 'pvp-sport') return { status: 'corrupt' };
      phase = data.outcome === 'cancelled' ? 'cancelled' : 'settled';
      if (!sameFrame(data.state, sportReplayFrame(engine.state, tick, phase))) return { status: 'corrupt' };
    }
    if (onFrame || targetTick === undefined || tick === targetTick) {
      const state = sportReplayFrame(engine.state, tick, phase);
      if (targetTick === undefined || tick === targetTick) selected = state;
      if (onFrame) callbacks.push({ event, state });
    }
  }
  if (targetTick !== undefined && targetTick > tick) return { status: 'incomplete' };
  for (const { event, state } of callbacks) onFrame?.(event, state);
  return { status: 'verified', state: selected };
}
