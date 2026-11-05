export const BATTLESHIP_SIZE = 10;
export const FLEET_LENGTHS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] as const;
export type ShipPlacement = { cell: number; vertical: boolean };
export type BattleshipMove = { kind: 'deploy'; fleet: ShipPlacement[] } | { kind: 'fire'; cell: number };
export type Shot = 'miss' | 'hit' | 'sunk';
export type BattleshipView = {
  revision: number;
  phase: 'deploying' | 'playing' | 'finished';
  self: number;
  actor: number;
  ownFleet: number[][];
  incoming: Partial<Record<number, Shot>>;
  outgoing: Partial<Record<number, Shot>>;
  enemyShips: number;
};

export function isSeaCell(cell: unknown): cell is number {
  return typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < BATTLESHIP_SIZE ** 2;
}

export function placeShip(fleet: number[][], placement: ShipPlacement, length: number): number[] | null {
  if (!placement || !isSeaCell(placement.cell) || typeof placement.vertical !== 'boolean') return null;
  const { cell, vertical } = placement;
  const x = cell % BATTLESHIP_SIZE, y = Math.floor(cell / BATTLESHIP_SIZE);
  if ((vertical ? y : x) + length > BATTLESHIP_SIZE) return null;
  const cells = Array.from({ length }, (_, i) => cell + i * (vertical ? BATTLESHIP_SIZE : 1));
  const touching = cells.some(next => fleet.some(ship => ship.some(other =>
    Math.abs(next % BATTLESHIP_SIZE - other % BATTLESHIP_SIZE) <= 1 &&
    Math.abs(Math.floor(next / BATTLESHIP_SIZE) - Math.floor(other / BATTLESHIP_SIZE)) <= 1)));
  return touching ? null : cells;
}
