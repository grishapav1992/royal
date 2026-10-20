import { getPlinkoMultipliers, getPlinkoRtp, exactPayoutUnits } from '../shared/originalGames';
import type { PlinkoRound } from '../shared/gameCore';

export const VOLCANIC_ROWS = 12;
export const VOLCANIC_RISKS = ['easy', 'medium', 'hard'] as const;
export type VolcanicRisk = typeof VOLCANIC_RISKS[number];
export const VOLCANIC_PROFILES = {
  easy: { name: 'ШЁПОТ', label: 'Шёпот', risk: 'Низкий', max: 10 },
  medium: { name: 'ЧАРЫ', label: 'Чары', risk: 'Средний', max: 33 },
  hard: { name: 'ЗАТМЕНИЕ', label: 'Затмение', risk: 'Высокий', max: 170 },
} as const;
export const volcanicTable = (risk: VolcanicRisk) => getPlinkoMultipliers(VOLCANIC_ROWS, risk);
export const volcanicRtp = (risk: VolcanicRisk) => getPlinkoRtp(VOLCANIC_ROWS, risk);
export type Point = { x: number; y: number };
export const BOARD = { width: 820, height: 790, stepX: 58, stepY: 55, firstY: 68, pocketY: 742 } as const;
export const pinPosition = (row: number, index: number): Point => ({ x: 410 + (index - row / 2) * BOARD.stepX, y: BOARD.firstY + row * BOARD.stepY });
export const pocketPosition = (index: number): Point => ({ x: 410 + (index - 6) * BOARD.stepX, y: BOARD.pocketY });

/** Points are derived only from the accepted binary path, never from visual physics. */
export function volcanicFlight(path: readonly number[]): Point[] {
  if (path.length !== 12 || path.some(bit => bit !== 0 && bit !== 1)) throw new RangeError('Invalid Plinko path');
  let column = 0;
  const points: Point[] = [{ x: 410, y: 18 }];
  for (let row = 0; row < 12; row++) {
    const pin = pinPosition(row, column);
    points.push({ x: pin.x, y: pin.y - 15 });
    column += path[row];
  }
  points.push({ ...pocketPosition(column), y: BOARD.pocketY - 18 });
  return points;
}

export function flightPose(points: readonly Point[], progress: number): Point & { segment: number } {
  const scaled = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(scaled)), t = Math.min(1, scaled - segment);
  const a = points[segment], b = points[segment + 1];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t * t - (segment ? 27 : 0) * Math.sin(Math.PI * t), segment };
}

/** Also accepts legacy settings so an uncertain old request remains recoverable. */
export function validVolcanicRound(value: unknown): value is PlinkoRound {
  try {
    const round = value as PlinkoRound;
    if (!round || round.gameId !== 'royal-plinko' || round.rulesVersion !== 1 || !/^\d+$/.test(round.stakeUnits) || !/^\d+$/.test(round.payoutUnits)) return false;
    const { rows, risk } = round.input, { path, bucket } = round.outcome;
    if (!Array.isArray(path) || path.length !== rows || path.some(bit => bit !== 0 && bit !== 1) || bucket !== path.reduce((a, b) => a + b, 0)) return false;
    const table = getPlinkoMultipliers(rows, risk);
    return round.multiplier === table[bucket] && exactPayoutUnits(BigInt(round.stakeUnits), round.multiplier) === BigInt(round.payoutUnits);
  } catch { return false; }
}
