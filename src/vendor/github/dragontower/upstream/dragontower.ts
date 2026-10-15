import { randomInt } from "crypto";

/**
 * Dragon Tower is a row-by-row climb. Each row has `tilesPerRow` tiles,
 * one of which is the "dragon" (lose tile) and the rest are "eggs" (safe).
 * The player picks one tile per row going from row 0 (bottom) upward.
 * Hitting an egg climbs you up and grows your multiplier; hitting the
 * dragon ends the game with zero payout.
 */

export const TOWER_ROWS = 9;
const RTP = 0.99;

export type Difficulty = "easy" | "medium" | "hard";

type DifficultySpec = {
  tilesPerRow: number;
  /** Per-row safe-tile probability = (tilesPerRow - 1) / tilesPerRow */
};

const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  easy: { tilesPerRow: 4 },     // 3 eggs / 1 dragon - chance 3/4
  medium: { tilesPerRow: 3 },   // 2 eggs / 1 dragon - chance 2/3
  hard: { tilesPerRow: 2 },     // 1 egg / 1 dragon - chance 1/2
};

export function tilesPerRow(difficulty: Difficulty): number {
  return DIFFICULTIES[difficulty].tilesPerRow;
}

export function placeDragons(difficulty: Difficulty): number[] {
  const t = tilesPerRow(difficulty);
  return Array.from({ length: TOWER_ROWS }, () => randomInt(0, t));
}

/**
 * Cumulative cashout multiplier after climbing `rowsClimbed` rows (i.e.
 * having revealed eggs on rows 0..rowsClimbed-1). Returns 1.0 for 0 rows
 * (no winnings to lock in yet).
 */
export function towerMultiplier(
  difficulty: Difficulty,
  rowsClimbed: number
): number {
  if (rowsClimbed < 0 || rowsClimbed > TOWER_ROWS) {
    throw new Error(`rowsClimbed out of range: ${rowsClimbed}`);
  }
  if (rowsClimbed === 0) return 1;
  const t = tilesPerRow(difficulty);
  // Per-row inverse safe-probability = t / (t - 1)
  const perRow = t / (t - 1);
  return Math.pow(perRow, rowsClimbed) * RTP;
}
