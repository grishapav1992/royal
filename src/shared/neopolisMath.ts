/** Neopolis campaign rules v4. Points are millionths of the line stake. */
export const NEOPOLIS_MATH = { version: 4, symbolWeightScale: 1000, scatterWeight: 1500, payNumerator: 347000, payDenominator: 1000000 } as const;
export const COLS = 5, ROWS = 4, SIZE = COLS * ROWS, WILD = 6, SCATTER = 7;
export const HEROES = ['granite', 'impulse', 'prism'] as const;
export type Hero = typeof HEROES[number];
export type Team = { starter: Hero; charges: number[]; complete: boolean };
export const BOSSES = [
  { id: 'null', shield: 3, core: 3, spins: 10 },
  { id: 'vespera', shield: 4, core: 4, spins: 12 },
  { id: 'aeon', shield: 5, core: 5, spins: 14 },
] as const;
export type BossId = typeof BOSSES[number]['id'];
export const MAX_ROUND_SPINS = 1 + BOSSES.reduce((sum, boss) => sum + boss.spins + 3, 0);
// Optional campaign fields keep existing v1 transcripts structurally readable.
export type Battle = { remaining: number; played: number; shield: number; core: number; won: boolean; boss?: number; defeated?: number };
export type Win = { line: number; symbol: number; count: number; cells: number[]; points: number };
export type Frame = { kind: 'deal' | 'win' | 'cascade' | 'hero' | 'finisher' | 'boss-hit' | 'boss-defeated' | 'boss-arrival'; grid: number[]; emblems: number[]; cells: number[]; wins: Win[]; hero?: Hero; points: number; battle?: Battle | null };
export type Spin = { frames: Frame[]; grid: number[]; team: Team; battle: Battle | null; activated: Hero[]; unlocked: Hero[]; points: number; free: boolean; triggered: boolean; finished: boolean; finisher: boolean; empowered: boolean };
export const PAYTABLE = [[5, 15, 40], [6, 20, 50], [8, 25, 70], [10, 35, 100], [12, 50, 150], [15, 75, 250]].map(row => row.map(value => value * NEOPOLIS_MATH.payNumerator));
export const MAX_CASCADES = 8;
const patterns = [[0,0,0,0,0], [0,1,2,1,0], [0,3,2,3,0], [0,0,1,0,0], [0,0,3,0,0], [0,1,1,1,0], [0,3,3,3,0], [0,1,2,3,0], [0,3,2,1,0], [0,2,0,2,0]];
export const LINES = patterns.flatMap(pattern => Array.from({ length: ROWS }, (_, offset) => pattern.map(row => (row + offset) % ROWS)));
export const readyTeam = (team: Team) => team.charges.every(charge => charge === 3);
export function initialTeam(starter: Hero): Team { return { starter, charges: HEROES.map(hero => hero === starter ? 3 : 0), complete: false }; }

const LINE_CELLS = LINES.map(rows => rows.map((row, col) => row * COLS + col));
export function evaluateLines(grid: number[], boostedColumn = -1): Win[] {
  const wins: Win[] = [];
  for (let line = 0; line < LINE_CELLS.length; line++) {
    const cells = LINE_CELLS[line];
    // Only the highest paying interpretation of a Wild line is awarded.
    let best: Win | undefined;
    const first = grid[cells[0]], from = first < WILD ? first : 0, until = first < WILD ? first + 1 : first === WILD ? PAYTABLE.length : 0;
    for (let symbol = from; symbol < until; symbol++) {
      let count = 0;
      while (count < COLS && (grid[cells[count]] === symbol || grid[cells[count]] === WILD)) count++;
      if (count < 3) continue;
      const matched = cells.slice(0, count);
      const factor = boostedColumn >= 0 && boostedColumn < count && grid[cells[boostedColumn]] === WILD ? 2 : 1;
      const points = PAYTABLE[symbol][count - 3] * factor;
      if (!best || points > best.points) best = { line, symbol, count, cells: matched, points };
    }
    if (best) wins.push(best);
  }
  return wins;
}

const SPAWN_MODES = [false, true].map(scatter => [false, true].map(center => {
  const weights = [24,22,20,17,14,11, center ? 2 : 0].map(weight => weight * NEOPOLIS_MATH.symbolWeightScale);
  weights.push(scatter ? NEOPOLIS_MATH.scatterWeight : 0);
  return { weights, total: weights.reduce((sum, weight) => sum + weight, 0) };
}));
export function playNeopolisSpin(sourceTeam: Team, sourceBattle: Battle | null, random: () => number, captureFrames = true): Spin {
  const team: Team = { ...sourceTeam, charges: [...sourceTeam.charges] };
  let battle = sourceBattle ? { ...sourceBattle } : null;
  const free = battle !== null;
  if (team.complete || (battle && battle.remaining < 1)) throw Error('Neopolis cycle has ended');
  const empowered = !!battle && battle.shield === 0;
  if (battle) { battle.boss ??= 0; battle.defeated ??= 0; battle.remaining--; battle.played++; }
  const take = (max: number) => { const value = random(); if (!Number.isFinite(value) || value < 0 || value >= 1) throw Error('Invalid Neopolis entropy'); return Math.floor(value * max); };
  let grid = Array<number>(SIZE).fill(0), emblems = Array<number>(SIZE).fill(-1), boostedColumn = -1, points = 0, triggered = false, finisher = false;
  const frames: Frame[] = [], activated: Hero[] = [], unlocked: Hero[] = [], pending = new Set<Hero>();
  const frame = (kind: Frame['kind'], cells: number[] = [], wins: Win[] = [], hero?: Hero) => {
    if (!captureFrames) return;
    frames.push({ kind, grid: [...grid], emblems: [...emblems], cells, wins, ...(hero ? { hero } : {}), points, battle: battle ? structuredClone(battle) : null });
  };
  const spawn = (cell: number) => {
    const { weights, total } = SPAWN_MODES[!free && readyTeam(team) ? 1 : 0][cell % COLS > 0 && cell % COLS < 4 ? 1 : 0];
    let stop = take(total);
    let symbol = 0;
    while (stop >= weights[symbol]) { stop -= weights[symbol]; symbol++; }
    grid[cell] = symbol;
    emblems[cell] = symbol < WILD && take(100) < (free ? 8 : 4) ? take(HEROES.length) : -1;
  };
  const collect = () => {
    for (let cell = 0; cell < SIZE; cell++) {
      const index = emblems[cell];
      if (index < 0) continue;
      const hero = HEROES[index];
      if (team.charges[index] < 3) {
        team.charges[index]++;
        if (team.charges[index] === 3) unlocked.push(hero);
      }
      if (team.charges[index] === 3 && !activated.includes(hero)) pending.add(hero);
      emblems[cell] = -1;
    }
    if (!free && readyTeam(team) && grid.filter(symbol => symbol === SCATTER).length >= 3) triggered = true;
  };
  const refill = (removed: number[]) => {
    const empty = new Set(removed);
    for (let col = 0; col < COLS; col++) {
      const survivors = Array.from({ length: ROWS }, (_, row) => row * COLS + col).filter(cell => !empty.has(cell)).map(cell => grid[cell]);
      for (let row = ROWS - 1; row >= 0; row--) {
        const cell = row * COLS + col;
        if (survivors.length) { grid[cell] = survivors.pop()!; emblems[cell] = -1; } else spawn(cell);
      }
    }
  };
  const resolve = () => {
    for (let cascade = 0; cascade < MAX_CASCADES; cascade++) {
      collect();
      const wins = evaluateLines(grid, boostedColumn);
      if (!wins.length) return;
      points += wins.reduce((sum, win) => sum + win.points, 0);
      const cells = [...new Set(wins.flatMap(win => win.cells))].sort((a, b) => a - b);
      frame('win', cells, wins);
      // The eighth paid display terminates this cascade chain without an unpaid refill.
      if (cascade === MAX_CASCADES - 1) return;
      refill(cells); frame('cascade', cells);
    }
  };
  for (let cell = 0; cell < SIZE; cell++) spawn(cell);
  frame('deal'); resolve();
  // An earned ability runs once per spin. New emblems can queue another hero.
  const activateHeroes = () => { for (let count = 0; count < HEROES.length; count++) {
    const hero = (['granite', 'prism', 'impulse'] as Hero[]).find(candidate => pending.has(candidate) && !activated.includes(candidate));
    if (!hero) break;
    pending.delete(hero); activated.push(hero);
    let cells: number[];
    if (hero === 'granite') {
      const size = empowered ? 3 : 2, left = take(COLS - size + 1), top = take(ROWS - size + 1);
      cells = Array.from({ length: size * size }, (_, index) => (top + Math.floor(index / size)) * COLS + left + index % size).filter(cell => grid[cell] < WILD);
      refill(cells);
    } else if (hero === 'prism') {
      const candidates = Array.from({ length: SIZE }, (_, cell) => cell).filter(cell => grid[cell] < WILD);
      cells = [];
      while (cells.length < (empowered ? 8 : 5) && candidates.length) cells.push(candidates.splice(take(candidates.length), 1)[0]);
      for (const cell of cells) spawn(cell);
    } else {
      const col = 1 + take(3); boostedColumn = empowered ? col : -1;
      cells = Array.from({ length: ROWS }, (_, row) => row * COLS + col).filter(cell => grid[cell] !== SCATTER);
      for (const cell of cells) { grid[cell] = WILD; emblems[cell] = -1; }
    }
    frame('hero', cells, [], hero); resolve();
  } };
  activateHeroes();
  if (battle && activated.length && !battle.won) {
    if (battle.shield > 0) battle.shield--; else battle.core--;
    frame('boss-hit');
    if (battle.core === 0) {
      const defeated = battle.boss!;
      battle.defeated = defeated + 1; battle.won = defeated === BOSSES.length - 1;
      battle.remaining += 3; finisher = true;
      frame('boss-defeated');
      const cells = Array.from({ length: ROWS }, (_, row) => row * COLS + 2);
      for (const cell of cells) { grid[cell] = WILD; emblems[cell] = -1; }
      boostedColumn = 2; frame('finisher', cells); resolve();
      // Finisher refills can earn an unused hero; it still acts once in this spin.
      activateHeroes();
      if (!battle.won) {
        const next = BOSSES[defeated + 1];
        battle.boss = defeated + 1; battle.shield = next.shield; battle.core = next.core;
        battle.remaining += next.spins;
        frame('boss-arrival');
      }
    }
  }
  if (!battle && triggered) {
    battle = { remaining: BOSSES[0].spins, played: 0, shield: BOSSES[0].shield, core: BOSSES[0].core, won: false, boss: 0, defeated: 0 };
    frame('boss-arrival');
  }
  const nextBattle = battle;
  const finished = !!nextBattle && nextBattle.remaining === 0;
  if (finished) team.complete = true;
  return { frames, grid: [...grid], team, battle: nextBattle, activated, unlocked, points, free, triggered, finished, finisher, empowered };
}
