/**
 * Candidate rules for Caribbean Treasures. Runtime registration follows qualification.
 * Pure field/scoring code, with no wallet, sessions, audio or browser state.
 */
export const CARIBBEAN_COLS = 6;
export const CARIBBEAN_ROWS = 4;
export const CARIBBEAN_MODEL_VERSION = 'candidate-1';
export const CARIBBEAN_TARGET_RTP = 0.96;
export const CARIBBEAN_LINE_COUNTS = [1, 5, 10, 20] as const;
export const CARIBBEAN_LINE_STAKES = ['100', '200', '500', '1000'] as const;
export const CARIBBEAN_BONUS_SPINS = { raid: 14, flagship: 6 } as const;
export const CARIBBEAN_PROFILE = {
  1: { baseLargePerMillion: 23055, raidCannonPerMillion: 273067, bonusEntryPerMillion: 10589, bonusCostPerMillion: 25574653 },
  5: { baseLargePerMillion: 56752, raidCannonPerMillion: 261127, bonusEntryPerMillion: 13766, bonusCostPerMillion: 19673213 },
  10: { baseLargePerMillion: 75399, raidCannonPerMillion: 253158, bonusEntryPerMillion: 15476, bonusCostPerMillion: 17499269 },
  20: { baseLargePerMillion: 73134, raidCannonPerMillion: 256339, bonusEntryPerMillion: 15212, bonusCostPerMillion: 17803460 },
} as const;
export const CARIBBEAN_SYMBOLS = [
  { id: 0, name: 'Карта', weight: 30, pays: [2, 6, 20, 60] },
  { id: 1, name: 'Компас', weight: 24, pays: [4, 10, 30, 100] },
  { id: 2, name: 'Пистолет', weight: 18, pays: [6, 16, 40, 150] },
  { id: 3, name: 'Сабля', weight: 13, pays: [8, 24, 60, 200] },
  { id: 4, name: 'Рубин', weight: 9, pays: [10, 30, 100, 400] },
  { id: 5, name: 'Попугай', weight: 6, pays: [16, 50, 200, 1000] },
] as const;
export const CARIBBEAN_LINES = [
  [1,1,1,1,1,1], [2,2,2,2,2,2], [0,0,0,0,0,0], [3,3,3,3,3,3],
  [0,1,2,2,1,0], [3,2,1,1,2,3],
  [1,0,0,0,0,1], [2,3,3,3,3,2],
  [0,0,1,2,3,3], [3,3,2,1,0,0],
  [1,2,3,3,2,1], [2,1,0,0,1,2],
  [0,1,1,1,1,0], [3,2,2,2,2,3],
  [1,1,2,2,1,1], [2,2,1,1,2,2],
  [0,1,2,3,2,1], [3,2,1,0,1,2],
  [0,1,0,1,0,1], [3,2,3,2,3,2],
] as const;

export type CaribbeanLineCount = typeof CARIBBEAN_LINE_COUNTS[number];
export type CaribbeanSymbol = 0 | 1 | 2 | 3 | 4 | 5;
export type CaribbeanMode = 'base' | 'raid' | 'flagship';
export type CaribbeanRandom = (exclusiveMaximum: number) => number;
export interface CaribbeanBlock { x: number; y: number; size: 2 | 3; symbol: CaribbeanSymbol }
export interface CaribbeanLineWin {
  line: number;
  symbol: CaribbeanSymbol;
  count: number;
  positions: number[];
  factor: number;
}
export interface CaribbeanFrame {
  version: typeof CARIBBEAN_MODEL_VERSION;
  mode: CaribbeanMode;
  gridBefore: number[];
  blockBefore: CaribbeanBlock | null;
  grid: number[];
  block: CaribbeanBlock | null;
  cannon: boolean;
  wins: CaribbeanLineWin[];
  factorSum: number;
}
export interface CaribbeanSettlement {
  costUnits: string;
  payoutUnits: string;
  netUnits: string;
  linePayoutUnits: string[];
}

function integer(value: unknown, low: number, high: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
}
export function validCaribbeanLineCount(value: unknown): value is CaribbeanLineCount {
  return (CARIBBEAN_LINE_COUNTS as readonly unknown[]).includes(value);
}
export function validCaribbeanGrid(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === CARIBBEAN_COLS * CARIBBEAN_ROWS
    && Array.from(value).every(symbol => integer(symbol, 0, CARIBBEAN_SYMBOLS.length - 1));
}
export function validCaribbeanBlock(value: unknown): value is CaribbeanBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as CaribbeanBlock;
  return Object.keys(block).sort().join(',') === 'size,symbol,x,y'
    && (block.size === 2 || block.size === 3)
    && integer(block.x, 0, CARIBBEAN_COLS - block.size)
    && integer(block.y, 0, CARIBBEAN_ROWS - block.size)
    && integer(block.symbol, 0, CARIBBEAN_SYMBOLS.length - 1);
}
function draw(random: CaribbeanRandom, maximum: number): number {
  const value = random(maximum);
  if (!integer(value, 0, maximum - 1)) throw new Error('Invalid Caribbean random draw');
  return value;
}
function symbol(random: CaribbeanRandom): CaribbeanSymbol {
  let ticket = draw(random, 100);
  for (const candidate of CARIBBEAN_SYMBOLS) {
    if (ticket < candidate.weight) return candidate.id;
    ticket -= candidate.weight;
  }
  throw new Error('Invalid Caribbean symbol weights');
}
export function caribbeanBlockCells(block: CaribbeanBlock): number[] {
  if (!validCaribbeanBlock(block)) throw new Error('Invalid Caribbean block');
  return Array.from({ length: block.size * block.size }, (_, index) =>
    (block.y + Math.floor(index / block.size)) * CARIBBEAN_COLS + block.x + index % block.size);
}
export function paintCaribbeanBlock(grid: readonly number[], block: CaribbeanBlock): number[] {
  if (!validCaribbeanGrid(grid)) throw new Error('Invalid Caribbean field');
  const next = [...grid];
  for (const position of caribbeanBlockCells(block)) next[position] = block.symbol;
  return next;
}
/** All legal 3x3 squares containing the complete old 2x2 square. */
export function caribbeanExpansionOptions(block: CaribbeanBlock): CaribbeanBlock[] {
  if (!validCaribbeanBlock(block)) throw new Error('Invalid Caribbean block');
  if (block.size === 3) return [];
  const options: CaribbeanBlock[] = [];
  for (const y of [block.y - 1, block.y]) for (const x of [block.x - 1, block.x]) {
    const next: CaribbeanBlock = { x, y, size: 3, symbol: block.symbol };
    if (validCaribbeanBlock(next)) options.push(next);
  }
  return options;
}
export function scoreCaribbeanLines(grid: readonly number[], lines: CaribbeanLineCount): CaribbeanLineWin[] {
  if (!validCaribbeanGrid(grid) || !validCaribbeanLineCount(lines)) throw new Error('Invalid Caribbean scoring input');
  const wins: CaribbeanLineWin[] = [];
  for (let line = 0; line < lines; line++) {
    const path = CARIBBEAN_LINES[line];
    const first = grid[path[0] * CARIBBEAN_COLS] as CaribbeanSymbol;
    let count = 1;
    while (count < CARIBBEAN_COLS && grid[path[count] * CARIBBEAN_COLS + count] === first) count++;
    if (count >= 3) wins.push({
      line, symbol: first, count,
      positions: Array.from({ length: count }, (_, column) => path[column] * CARIBBEAN_COLS + column),
      factor: CARIBBEAN_SYMBOLS[first].pays[count - 3],
    });
  }
  return wins;
}
export function playCaribbeanFrame(mode: CaribbeanMode, lines: CaribbeanLineCount, random: CaribbeanRandom): CaribbeanFrame {
  if (!['base', 'raid', 'flagship'].includes(mode) || !validCaribbeanLineCount(lines)) throw new Error('Invalid Caribbean mode');
  const ordinary = Array.from({ length: CARIBBEAN_COLS * CARIBBEAN_ROWS }, () => symbol(random));
  const profile = CARIBBEAN_PROFILE[lines];
  const blockTicket = mode === 'base' ? draw(random, 1000000) : 0;
  const size = mode === 'flagship' || mode === 'base' && blockTicket < profile.baseLargePerMillion ? 3 : 2;
  let block: CaribbeanBlock | null = mode !== 'base' || blockTicket < profile.baseLargePerMillion + 300000
    ? { x: draw(random, CARIBBEAN_COLS - size + 1), y: draw(random, CARIBBEAN_ROWS - size + 1), size, symbol: symbol(random) }
    : null;
  const gridBefore = block ? paintCaribbeanBlock(ordinary, block) : ordinary;
  const blockBefore = block ? { ...block } : null;
  let grid = [...gridBefore], cannon = false;
  if (block?.size === 2 && draw(random, 1000000) < (mode === 'raid' ? profile.raidCannonPerMillion : 125000)) {
    const options = caribbeanExpansionOptions(block);
    block = options[draw(random, options.length)];
    grid = paintCaribbeanBlock(grid, block);
    cannon = true;
  }
  const wins = scoreCaribbeanLines(grid, lines);
  return {
    version: CARIBBEAN_MODEL_VERSION, mode, gridBefore, blockBefore, grid, block, cannon, wins,
    factorSum: wins.reduce((total, win) => total + win.factor, 0),
  };
}
export function settleCaribbeanFrame(grid: readonly number[], lines: CaribbeanLineCount, lineStakeUnits: string, stakeDivisor = 1): CaribbeanSettlement {
  if (!/^[1-9][0-9]{0,14}$/.test(lineStakeUnits)) throw new Error('Invalid Caribbean line stake');
  if (stakeDivisor !== 1 && stakeDivisor !== lines) throw new Error('Invalid Caribbean stake divisor');
  const stake = BigInt(lineStakeUnits), divisor = BigInt(stakeDivisor);
  const wins = scoreCaribbeanLines(grid, lines);
  const awards = wins.map(win => stake * BigInt(win.factor) / divisor);
  const payout = awards.reduce((total, award) => total + award, 0n), cost = stake * BigInt(lines) / divisor;
  return {
    costUnits: String(cost), payoutUnits: String(payout), netUnits: String(payout - cost),
    linePayoutUnits: awards.map(String),
  };
}
