import { getIntoxication } from './intoxication';

// Directions are ordered up, right, down, left. Every layout changes all four keys.
const layouts = [
  [1, 0, 3, 2], [1, 2, 3, 0], [1, 3, 0, 2],
  [2, 0, 3, 1], [2, 3, 0, 1], [2, 3, 1, 0],
  [3, 0, 1, 2], [3, 2, 0, 1], [3, 2, 1, 0],
] as const;
const vectors = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;

export function nextDrunkLayout(previous: number, random = Math.random): number {
  const previousValid = Number.isInteger(previous) && previous >= 1 && previous <= layouts.length;
  const count = layouts.length - Number(previousValid);
  const value = random();
  let selected = Math.floor((Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0) * count) + 1;
  if (previousValid && selected >= previous) selected++;
  return selected;
}

/** The optional mask preserves simultaneous opposite keys before their new directions are combined. */
export function drunkKeyboardDirection(soberAt: number, controlLayout: number, input: { x: number; y: number; directions?: number }, now = Date.now()): { x: number; y: number } {
  if (getIntoxication(soberAt, now).stage !== 3) return { x: input.x, y: input.y };
  const validLayout = Number.isInteger(controlLayout) && controlLayout >= 1 && controlLayout <= layouts.length;
  const layout = layouts[(validLayout ? controlLayout : 1) - 1];
  const directions = Number.isInteger(input.directions) && input.directions! >= 0 && input.directions! <= 15
    ? input.directions!
    : (input.y < 0 ? 1 : 0) | (input.x > 0 ? 2 : 0) | (input.y > 0 ? 4 : 0) | (input.x < 0 ? 8 : 0);
  let x = 0, y = 0;
  for (let key = 0; key < 4; key++) if (directions & (1 << key)) {
    const direction = vectors[layout[key]];
    x += direction.x; y += direction.y;
  }
  return { x, y };
}
