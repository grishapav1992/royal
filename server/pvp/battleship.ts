import { randomInt } from 'node:crypto';
import { FLEET_LENGTHS, isSeaCell, placeShip, type BattleshipMove, type BattleshipView, type Shot } from '../../src/shared/battleship';

type Side = 0 | 1;
type Shots = Partial<Record<number, Shot>>;
export type BattleshipState = {
  revision: number;
  phase: BattleshipView['phase'];
  actor: Side;
  starter: Side;
  fleets: [number[][], number[][]];
  shots: [Shots, Shots];
  winner: Side | null;
};

export function createBattleship(): BattleshipState {
  const starter = randomInt(2) as Side;
  return { revision: 0, phase: 'deploying', actor: starter, starter, fleets: [[], []], shots: [{}, {}], winner: null };
}

export function playBattleship(current: BattleshipState, side: Side, move: BattleshipMove): BattleshipState {
  if (current.phase === 'finished' || current.actor !== side) throw Error('Ход соперника.');
  const state = structuredClone(current);
  const opponent = side === 0 ? 1 : 0;
  if (state.phase === 'deploying' && move.kind === 'deploy') {
    if (!Array.isArray(move.fleet) || move.fleet.length !== FLEET_LENGTHS.length) throw Error('Расставь весь флот.');
    const fleet: number[][] = [];
    for (const [index, length] of FLEET_LENGTHS.entries()) {
      const ship = placeShip(fleet, move.fleet[index], length);
      if (!ship) throw Error('Неверная позиция корабля.');
      fleet.push(ship);
    }
    state.fleets[side] = fleet;
    state.actor = opponent;
    if (state.fleets[opponent].length) {
      state.phase = 'playing';
      state.actor = state.starter;
    }
  } else if (state.phase === 'playing' && move.kind === 'fire') {
    const shots = state.shots[side], { cell } = move;
    if (!isSeaCell(cell) || shots[cell]) throw Error('Выбери новую клетку.');
    const target = state.fleets[opponent].find(ship => ship.includes(cell));
    shots[cell] = target ? 'hit' : 'miss';
    if (!target) state.actor = opponent;
    if (target?.every(point => shots[point] === 'hit')) {
      for (const point of target) shots[point] = 'sunk';
      if (state.fleets[opponent].every(ship => ship.every(point => shots[point] === 'sunk'))) {
        state.phase = 'finished';
        state.winner = side;
      }
    }
  } else {
    throw Error('Действие недоступно.');
  }
  state.revision++;
  return state;
}

export function publicBattleship(state: BattleshipState, side: Side): BattleshipView {
  const opponent = side === 0 ? 1 : 0;
  const outgoing = state.shots[side];
  return {
    revision: state.revision, phase: state.phase, self: side, actor: state.actor,
    ownFleet: state.fleets[side], incoming: state.shots[opponent], outgoing,
    enemyShips: FLEET_LENGTHS.length - state.fleets[opponent].filter(ship => ship.every(cell => outgoing[cell] === 'sunk')).length,
  };
}
