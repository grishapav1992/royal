import { paylineCells } from '../../templates/slot-primitive/src/paylines.ts';
import { PANDA_LAYOUT, SYMBOLS } from './layout';
import type { PandaView } from './PandaView';

/**
 * Считывание подтверждённого раунда для показа. Ничего не рассчитывает и не меняет:
 * только переводит серверный снимок в понятные игроку величины.
 */

/** Свиток Дракона — скаттер, открывающий бонус. */
export const SCATTER_SYMBOL = SYMBOLS[0].id;
/** Сколько свитков нужно для бонуса. */
export const SCATTER_TARGET = 3;

export type PandaStrikeKind = 'line' | 'column';

export interface PandaStrike {
  kind: PandaStrikeKind;
  /** Номер линии или столбца, начиная с нуля. */
  index: number;
  /** Клетки разреза по порядку удара. */
  cells: number[];
}

/** Свитки на подтверждённом поле: сколько шагов осталось до бонуса. */
export function pandaScatterCount(view: PandaView | undefined): number {
  let count = 0;
  for (const symbol of view?.symbols ?? []) if (symbol === SCATTER_SYMBOL) count += 1;
  return count;
}

/** Порядок ударов посоха: сначала линии, затем вертикали. */
export function pandaStrikes(view: PandaView | undefined, settled: boolean): PandaStrike[] {
  if (!settled || !view) return [];
  const lines = (view.wins ?? (view.winLines ?? []).map((line) => ({ line, length: PANDA_LAYOUT.columns })))
    .map((win) => {
      const path = PANDA_LAYOUT.paylines[win.line];
      return {
        kind: 'line' as const,
        index: win.line,
        cells: path ? paylineCells(PANDA_LAYOUT.columns, path).slice(0, win.length) : [],
      };
    });
  const columns = (view.columnWins ?? []).map((win) => ({
    kind: 'column' as const,
    index: win.column,
    cells: Array.from({ length: win.length }, (_, i) => (win.from + i) * PANDA_LAYOUT.columns + win.column),
  }));
  return [...lines, ...columns].filter((strike) => strike.cells.length > 0);
}

/** Во сколько раз выплата превысила ставку раунда. */
export function pandaMultiplier(spentCents: string, returnedCents: string): number {
  const spent = Number(spentCents);
  const returned = Number(returnedCents);
  if (!Number.isFinite(spent) || spent <= 0) return 0;
  const value = returned / spent;
  return Number.isFinite(value) ? value : 0;
}

export type PandaWinTier = 'none' | 'small' | 'medium' | 'large' | 'epic';

/** Порядок выплаты для показа: от тихого выигрыша до крупного. */
export function pandaWinTier(multiplier: number): PandaWinTier {
  if (multiplier <= 0) return 'none';
  if (multiplier < 1.5) return 'small';
  if (multiplier < 5) return 'medium';
  if (multiplier < 20) return 'large';
  return 'epic';
}

/** Сколько выигрышных линий и вертикалей показано на подтверждённом поле. */
export function pandaWinLineCount(view: PandaView | undefined): number {
  if (!view) return 0;
  return (view.wins?.length ?? 0) + (view.columnWins?.length ?? 0);
}

/**
 * Горизонтальное положение удара: звук приходит из места, где коснулся посох.
 * Вертикаль звучит из своей колонки, горизонтальная линия – из середины поля.
 */
export function pandaStrikePan(strike: PandaStrike, columns: number): number {
  const half = (columns - 1) / 2;
  if (half <= 0) return 0;
  if (strike.kind === 'column') return clampPan((strike.index - half) / half);
  const total = strike.cells.reduce((sum, cell) => sum + (cell % columns), 0);
  const center = strike.cells.length ? total / strike.cells.length : half;
  return clampPan((center - half) / half);
}

/** Положение барабана в стерео: левый край поля звучит слева. */
export function pandaReelPan(column: number, columns: number): number {
  const half = (columns - 1) / 2;
  if (half <= 0) return 0;
  return clampPan((column - half) / half);
}

function clampPan(value: number): number {
  return Math.max(-0.7, Math.min(0.7, value * 0.7));
}

/** Подпись удара посоха для игрока. */
export function pandaStrikeLabel(strike: PandaStrike | undefined, position: number, total: number): string {
  if (!strike) return '';
  const target = strike.kind === 'line' ? `Линия ${strike.index + 1}` : `Вертикаль ${strike.index + 1}`;
  return `${target} · удар ${position} из ${total}`;
}
