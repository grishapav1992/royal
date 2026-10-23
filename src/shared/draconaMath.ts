export const COLS = 5;
export const ROWS = 4;
export const SIZE = COLS * ROWS;
export const PORTAL = 6;
export const CREST = 7;
export const MAX_CASCADES = 8;
export const MAX_TRANSFERS = 3;
export const MAX_BONUS_SPINS = 20;
export const MAX_RUNE = 5;
export const DRACONA_MATH = { version: 2, payNumerator: 497300, payDenominator: 1000000 } as const;
export type SymbolId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Grid = SymbolId[];
export type RandomSource = () => number;

export const SYMBOLS = [
  { name: 'Изумрудное зелье', short: 'Зелье', file: 'potion.webp', weight: 11, value: 1.3 },
  { name: 'Фамильное кольцо', short: 'Кольцо', file: 'ring.webp', weight: 12, value: 1.2 },
  { name: 'Книга заклинаний', short: 'Книга', file: 'book.webp', weight: 13, value: 1.1 },
  { name: 'Серебряный ключ', short: 'Ключ', file: 'key.webp', weight: 14, value: 1 },
  { name: 'Изумруд', short: 'Изумруд', file: 'gem.webp', weight: 15, value: 0.9 },
  { name: 'Серебряное перо', short: 'Перо', file: 'feather.webp', weight: 16, value: 0.8 },
  { name: 'Исчезающий шкаф', short: 'Перенос', file: 'cabinet.webp', weight: 3, value: 0 },
  { name: 'Фамильный герб', short: 'Герб', file: 'crest.webp', weight: 3, value: 0 },
] as const;

export interface Cluster { symbol: SymbolId; cells: number[]; factor: number; payout: number }
export interface Movement { from: number; to: number }
export type Step =
  | { type: 'initial'; grid: Grid; reserve: Grid }
  | { type: 'win'; grid: Grid; clusters: Cluster[]; payout: number; total: number }
  | { type: 'drop'; grid: Grid; movements: Movement[] }
  | { type: 'portal'; grid: Grid; before: Grid; reserveBefore: Grid; reserveAfter: Grid; cells: number[]; runes: number[]; number: number }
  | { type: 'final'; grid: Grid; total: number; bonusAward: number; crestCount: number };

export interface SpinOptions {
  bet: number;
  random: RandomSource;
  bonus?: boolean;
  runes?: number[];
  bonusIssued?: number;
  initialGrid?: Grid;
  initialReserve?: Grid;
}
export interface SpinResult {
  steps: Step[];
  grid: Grid;
  reserve: Grid;
  runes: number[];
  payout: number;
  transfers: number;
  bonusAward: number;
  crestCount: number;
}

export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawSymbol(random: RandomSource, ordinary = false): SymbolId {
  const symbols: readonly (typeof SYMBOLS[number])[] = ordinary ? SYMBOLS.slice(0, 6) : SYMBOLS;
  const total = symbols.reduce((sum, s) => sum + s.weight, 0);
  let pick = Math.min(0.999999999, Math.max(0, random())) * total;
  for (let index = 0; index < symbols.length; index++) {
    pick -= symbols[index].weight;
    if (pick < 0) return index as SymbolId;
  }
  return (symbols.length - 1) as SymbolId;
}

export function clustersOf(grid: Grid): { symbol: SymbolId; cells: number[] }[] {
  if (grid.length !== SIZE) throw new Error('Ожидается поле 5 на 4');
  const seen = new Set<number>();
  const groups: { symbol: SymbolId; cells: number[] }[] = [];
  for (let start = 0; start < SIZE; start++) {
    const symbol = grid[start];
    if (seen.has(start) || symbol >= PORTAL) continue;
    const queue = [start];
    seen.add(start);
    for (let q = 0; q < queue.length; q++) {
      const cell = queue[q], x = cell % COLS, y = Math.floor(cell / COLS);
      const neighbors = [x > 0 ? cell - 1 : -1, x < COLS - 1 ? cell + 1 : -1, y > 0 ? cell - COLS : -1, y < ROWS - 1 ? cell + COLS : -1];
      for (const neighbor of neighbors) if (neighbor >= 0 && !seen.has(neighbor) && grid[neighbor] === symbol) { seen.add(neighbor); queue.push(neighbor); }
    }
    if (queue.length >= 5) groups.push({ symbol, cells: queue });
  }
  return groups;
}

export function clusterPayout(symbol: SymbolId, count: number, bet: number, factor: number): number {
  if (count < 5 || symbol >= PORTAL) return 0;
  const scaleTenths = count <= 6 ? 25 : count <= 8 ? 55 : count <= 11 ? 120 : count <= 15 ? 300 : 800;
  const valueTenths = [13,12,11,10,9,8][symbol];
  const units = BigInt(bet) * 100n * BigInt(scaleTenths) * BigInt(valueTenths) * BigInt(factor) * BigInt(DRACONA_MATH.payNumerator)
    / (100n * BigInt(DRACONA_MATH.payDenominator));
  return Number(units) / 100;
}

export function dropSymbols(grid: Grid, removed: Set<number>, random: RandomSource): { grid: Grid; movements: Movement[] } {
  const result = [...grid];
  const movements: Movement[] = [];
  for (let col = 0; col < COLS; col++) {
    const survivors: number[] = [];
    for (let row = ROWS - 1; row >= 0; row--) if (!removed.has(row * COLS + col)) survivors.push(row * COLS + col);
    for (let row = ROWS - 1, cursor = 0; row >= 0; row--, cursor++) {
      const to = row * COLS + col, from = survivors[cursor];
      result[to] = from === undefined ? drawSymbol(random) : grid[from];
      movements.push({ from: from ?? col - COLS * (ROWS - survivors.length - row), to });
    }
  }
  return { grid: result, movements };
}

export function blockAt(topLeft: number): number[] {
  const row = Math.floor(topLeft / COLS), col = topLeft % COLS;
  if (!Number.isInteger(topLeft) || col < 0 || col >= COLS - 1 || row < 0 || row >= ROWS - 1) throw new Error('Блок 2 на 2 выходит за пределы поля');
  return [topLeft, topLeft + 1, topLeft + COLS, topLeft + COLS + 1];
}

export function exchangeBlock(grid: Grid, reserve: Grid, topLeft: number): { grid: Grid; reserve: Grid; cells: number[] } {
  if (grid.length !== SIZE || reserve.length !== 4) throw new Error('Неверный размер поля или резервного блока');
  const cells = blockAt(topLeft), next = [...grid], outgoing = cells.map(index => grid[index]);
  cells.forEach((index, offset) => { next[index] = reserve[offset]; });
  return { grid: next, reserve: outgoing, cells };
}

export function playSpin(options: SpinOptions): SpinResult {
  const { bet, random, bonus = false, bonusIssued = 0 } = options;
  if (!Number.isSafeInteger(bet) || bet <= 0) throw new Error('Ставка должна быть положительным целым числом');
  let grid: Grid = options.initialGrid ? [...options.initialGrid] : Array.from({ length: SIZE }, () => drawSymbol(random));
  const enchantedSymbol = bonus && !options.initialReserve && random() < 0.45 ? drawSymbol(random, true) : undefined;
  let reserve: Grid = options.initialReserve ? [...options.initialReserve] : enchantedSymbol !== undefined ? Array(4).fill(enchantedSymbol) as Grid : Array.from({ length: 4 }, () => drawSymbol(random, true));
  if (grid.length !== SIZE || reserve.length !== 4 || [...grid, ...reserve].some(v => !Number.isInteger(v) || v < 0 || v > CREST)) throw new Error('Некорректное поле');
  if (options.runes && (options.runes.length !== SIZE || options.runes.some(v => !Number.isInteger(v) || v < 1 || v > MAX_RUNE))) throw new Error('Некорректные руны');
  const runes = bonus && options.runes ? [...options.runes] : Array(SIZE).fill(1) as number[];
  const steps: Step[] = [{ type: 'initial', grid: [...grid], reserve: [...reserve] }];
  let payout = 0, payoutUnits = 0, transfers = 0, cascades = 0;
  let crestCount = grid.filter(symbol => symbol === CREST).length;
  let pendingTransfers = grid.filter(symbol => symbol === PORTAL).length;
  if (bonus) pendingTransfers = Math.max(1, pendingTransfers);
  const observe = () => { crestCount = Math.max(crestCount, grid.filter(s => s === CREST).length); };
  const resolveClusters = () => {
    while (cascades < MAX_CASCADES) {
      const groups = clustersOf(grid);
      if (!groups.length) return;
      cascades++;
      const clusters = groups.map(group => {
        const factor = Math.max(...group.cells.map(cell => runes[cell]));
        return { ...group, factor, payout: clusterPayout(group.symbol, group.cells.length, bet, factor) };
      });
      const amountUnits = clusters.reduce((sum, c) => sum + Math.round(c.payout * 100), 0), amount = amountUnits / 100;
      payoutUnits += amountUnits; payout = payoutUnits / 100;
      steps.push({ type: 'win', grid: [...grid], clusters, payout: amount, total: payout });
      const removed = new Set(groups.flatMap(group => group.cells));
      const dropped = dropSymbols(grid, removed, random);
      pendingTransfers += dropped.movements.filter(m => m.from < 0 && dropped.grid[m.to] === PORTAL).length;
      grid = dropped.grid;
      observe();
      steps.push({ type: 'drop', grid: [...grid], movements: dropped.movements });
    }
  };
  resolveClusters();
  while (pendingTransfers > 0 && transfers < MAX_TRANSFERS) {
    pendingTransfers--;
    transfers++;
    const col = Math.min(COLS - 2, Math.floor(random() * (COLS - 1)));
    const row = Math.min(ROWS - 2, Math.floor(random() * (ROWS - 1)));
    const before = [...grid], reserveBefore = [...reserve];
    const exchanged = exchangeBlock(grid, reserve, row * COLS + col);
    pendingTransfers += reserve.filter(symbol => symbol === PORTAL).length;
    grid = exchanged.grid;
    reserve = exchanged.reserve;
    if (bonus) for (const cell of exchanged.cells) runes[cell] = Math.min(MAX_RUNE, runes[cell] + 1);
    steps.push({ type: 'portal', grid: [...grid], before, reserveBefore, reserveAfter: [...reserve], cells: exchanged.cells, runes: [...runes], number: transfers });
    observe();
    resolveClusters();
  }
  const bonusAward = crestCount >= 3 ? bonus ? Math.max(0, Math.min(2, MAX_BONUS_SPINS - bonusIssued)) : 8 : 0;
  steps.push({ type: 'final', grid: [...grid], total: payout, bonusAward, crestCount });
  return { steps, grid, reserve, runes, payout, transfers, bonusAward, crestCount };
}
