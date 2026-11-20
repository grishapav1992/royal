import { useEffect, useRef, useState } from "react";

/** Минимальное время вращения и пауза между остановками барабанов (мс). */
export const MIN_SPIN_MS = 700;
export const STOP_GAP_MS = 160;

/**
 * Визуальное вращение барабанов: все клетки столбца движутся единой лентой,
 * столбцы останавливаются по очереди слева направо после подтверждения хода.
 * Исход не выбирается здесь – он приходит из подтверждённого раунда.
 */
export function useReelMotion(busy: boolean, columns: number, animate: boolean) {
  const [still] = useState<boolean[]>(() => Array(columns).fill(false));
  const [spinning, setSpinning] = useState(still);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
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
    const timers = Array.from({ length: columns }, (_, column) =>
      setTimeout(() => setSpinning(previous => previous.map((value, i) => value && i !== column)), wait + column * STOP_GAP_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [animate, busy, columns, still]);

  return { spinning: animate ? spinning : still, settled: !busy && (!animate || !spinning.some(Boolean)) };
}
