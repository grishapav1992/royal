import { useLayoutEffect, useRef, useState } from "react";

/** Минимальное время вращения и пауза между остановками барабанов (мс). */
export const MIN_SPIN_MS = 880;
export const STOP_GAP_MS = 185;
/** Заминка перед последним барабаном: короткое ожидание перед развязкой. */
export const FINAL_HOLD_MS = 430;

/**
 * Визуальное вращение барабанов: все клетки столбца движутся единой лентой,
 * столбцы останавливаются по очереди слева направо после подтверждения хода.
 * Последний барабан задерживается, чтобы решение читалось как напряжение.
 * Исход не выбирается здесь – он приходит из подтверждённого раунда.
 */
export function useReelMotion(busy: boolean, columns: number, animate: boolean) {
  const [still] = useState<boolean[]>(() => Array(columns).fill(false));
  const [spinning, setSpinning] = useState(still);
  const startedAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!animate) {
      startedAt.current = null;
      setSpinning(still);
      return;
    }
    if (busy) {
      startedAt.current = performance.now();
      setSpinning(Array(columns).fill(true));
      return;
    }
    if (startedAt.current === null) return;
    const wait = Math.max(0, MIN_SPIN_MS - (performance.now() - startedAt.current));
    startedAt.current = null;
    const timers = Array.from({ length: columns }, (_, column) => {
      const hold = column === columns - 1 ? FINAL_HOLD_MS : 0;
      return setTimeout(() => setSpinning(previous => previous.map((value, i) => value && i !== column)),
        wait + column * STOP_GAP_MS + hold);
    });
    return () => timers.forEach(clearTimeout);
  }, [animate, busy, columns, still]);

  const active = animate ? spinning : still;
  const remaining = active.reduce<number[]>((list, value, index) => (value ? [...list, index] : list), []);
  // Заминка перед последним барабаном: игрок ждёт, чем закончится раунд.
  const anticipating = animate && remaining.length === 1 && remaining[0] === columns - 1;
  return { spinning: active, settled: !busy && (!animate || !active.some(Boolean)), anticipating };
}
