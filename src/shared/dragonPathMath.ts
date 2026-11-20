import { DRAGON_PATH_LAYOUT as layout } from './dragonPathLayout.ts';

export const DRAGON_PATH_SCATTER = 0;
export const DRAGON_PATH_WILD = 1;
export const DRAGON_PATH_TRIGGER = 3;
export const DRAGON_PATH_FREE_MULTIPLIER = 3;
export const DRAGON_PATH_POINT_SCALE = 100;
export const DRAGON_PATH_WEIGHTS: readonly number[] = [2, 3, 4, 5, 8, 9, 10, 11, 12];
export const DRAGON_PATH_PAYS: readonly (readonly number[])[] = [
  [],
  [413, 1770, 8851],
  [285, 1377, 4524],
  [187, 885, 2950],
  [138, 590, 1869],
  [108, 433, 1377],
  [89, 354, 1082],
  [75, 275, 826],
  [63, 216, 669],
];
// Верхняя оценка резерва без ограничения фактической выплаты.
export const DRAGON_PATH_RESERVE_FACTOR = Math.ceil((layout.paylines.length * Math.max(...DRAGON_PATH_PAYS.flat())
  + layout.columns * Math.max(...DRAGON_PATH_PAYS.slice(DRAGON_PATH_WILD + 1).map(pays => pays[2])))
  * (1 + DRAGON_PATH_FREE_MULTIPLIER) / DRAGON_PATH_POINT_SCALE);
const weightTotal = DRAGON_PATH_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
const size = layout.columns * layout.rows;
const lineCells = layout.paylines.map(path => path.map((row, column) => row * layout.columns + column));
const columnCells = Array.from({ length: layout.columns }, (_, column) =>
  Array.from({ length: layout.rows }, (_, row) => row * layout.columns + column));

interface Match {
  readonly symbol: number;
  readonly count: number;
  readonly points: number;
}

export type DragonPathWin = Readonly<Match & { kind: 'line' | 'column'; index: number; positions: readonly number[] }>;
export interface DragonPathScore {
  readonly wins: readonly DragonPathWin[];
  readonly scatterPositions: readonly number[];
  readonly points: number;
}

export function validDragonPathGrid(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === size && Array.from(value).every(symbol =>
    Number.isInteger(symbol) && symbol >= 0 && symbol < DRAGON_PATH_WEIGHTS.length);
}

export function drawDragonPathGrid(draw: (exclusiveMaximum: number) => number): number[] {
  return Array.from({ length: size }, () => {
    let ticket = draw(weightTotal);
    if (!Number.isSafeInteger(ticket) || ticket < 0 || ticket >= weightTotal) throw Error('Недопустимый результат генератора.');
    for (const [symbol, weight] of DRAGON_PATH_WEIGHTS.entries()) {
      if (ticket < weight) return symbol;
      ticket -= weight;
    }
    throw Error('Недопустимые веса символов.');
  });
}

export function scoreDragonPathLine(symbols: readonly number[]): Match | undefined {
  let best: Match | undefined;
  for (let symbol = DRAGON_PATH_WILD; symbol < DRAGON_PATH_PAYS.length; symbol++) {
    let count = 0;
    while (count < symbols.length && (symbols[count] === symbol || symbols[count] === DRAGON_PATH_WILD)) count++;
    const points = DRAGON_PATH_PAYS[symbol][count - 3] ?? 0;
    if (points > (best?.points ?? 0)) best = { symbol, count, points };
  }
  return best;
}

export function scoreDragonPathGrid(grid: readonly number[]): DragonPathScore {
  if (!validDragonPathGrid(grid)) throw Error('Ожидается поле 5×5 с известными символами.');
  const wins: DragonPathWin[] = [];
  for (const [index, path] of lineCells.entries()) {
    const win = scoreDragonPathLine(path.map(position => grid[position]));
    if (win) wins.push({ ...win, kind: 'line', index, positions: path.slice(0, win.count) });
  }
  for (const [index, positions] of columnCells.entries()) {
    const symbol = grid[positions[0]];
    if (symbol <= DRAGON_PATH_WILD || !positions.every(position => grid[position] === symbol)) continue;
    wins.push({ kind: 'column', index, positions: [...positions], symbol, count: positions.length, points: DRAGON_PATH_PAYS[symbol][2] });
  }
  return {
    wins,
    scatterPositions: grid.flatMap((symbol, position) => symbol === DRAGON_PATH_SCATTER ? [position] : []),
    points: wins.reduce((sum, win) => sum + win.points, 0),
  };
}
