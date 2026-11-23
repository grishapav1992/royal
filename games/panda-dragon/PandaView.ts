import type { ReelView } from '../../templates/slot-primitive/src/view.ts';

/** Подтверждённые данные игры: какие линии из `paylines` сыграли и были ли скаттеры. */
export type PandaView = ReelView &
  Readonly<{
    winLines?: readonly number[];
    /** Сколько клеток каждой сыгравшей линии совпало (слева направо). */
    wins?: readonly Readonly<{ line: number; length: number }>[];
    scatter?: boolean;
    /** Вертикальные выигрыши: одинаковые символы подряд в одном столбце (сверху вниз от `from`). */
    columnWins?: readonly Readonly<{ column: number; from: number; length: number }>[];
  }>;
