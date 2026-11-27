import { useEffect, useRef, type RefObject } from "react";

/**
 * Короткая дрожь элемента в момент удара. Каждый новый номер удара запускает
 * анимацию заново, поэтому отдача читается как отдельный удар.
 */
export function useImpactShake(
  ref: RefObject<HTMLElement | null>,
  impact: number,
  reducedMotion: boolean,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  const framesRef = useRef(frames);
  framesRef.current = frames;
  useEffect(() => {
    if (!impact || reducedMotion) return;
    const node = ref.current;
    if (!node || typeof node.animate !== "function") return;
    const animation = node.animate(framesRef.current, options);
    return () => animation.cancel();
  }, [ref, impact, reducedMotion, options]);
}

/** Поле получает короткий толчок: удар посоха чувствуется в клетках. */
export const GRID_SHAKE: Keyframe[] = [
  { transform: "translate3d(0, 0, 0)" },
  { transform: "translate3d(-5px, 2px, 0)", offset: 0.25 },
  { transform: "translate3d(4px, -2px, 0)", offset: 0.6 },
  { transform: "translate3d(-2px, 1px, 0)", offset: 0.85 },
  { transform: "translate3d(0, 0, 0)" },
];

/** Мастер подаётся вперёд после удара и возвращается на место. */
export const HERO_RECOIL: Keyframe[] = [
  { transform: "translate3d(0, 0, 0) scale(1)" },
  { transform: "translate3d(12px, 0, 0) scale(1.04)", offset: 0.32 },
  { transform: "translate3d(-4px, 0, 0) scale(0.99)", offset: 0.7 },
  { transform: "translate3d(0, 0, 0) scale(1)" },
];

export const SHAKE_OPTIONS: KeyframeAnimationOptions = { duration: 300, easing: "ease-out" };
export const RECOIL_OPTIONS: KeyframeAnimationOptions = { duration: 340, easing: "ease-out" };
