export const MAX_SOBER_TIME_MS = 30 * 60 * 1000;
export type IntoxicationStage = 0 | 1 | 2 | 3;
export type Intoxication = { level: number; stage: IntoxicationStage; label: string; remainingMs: number };

/** Absolute deadlines keep recovery running across disconnections and restarts. */
export function getIntoxication(soberAt: number, now = Date.now()): Intoxication {
  const remainingMs = Number.isFinite(soberAt) ? Math.max(0, Math.min(MAX_SOBER_TIME_MS, soberAt - now)) : 0;
  const level = remainingMs / MAX_SOBER_TIME_MS;
  const stage: IntoxicationStage = !remainingMs ? 0 : level <= 1 / 3 ? 1 : level <= 2 / 3 ? 2 : 3;
  const labels = ['Трезв', 'Лёгкое опьянение', 'Заметное опьянение', 'Сильное опьянение'];
  return { level, stage, label: labels[stage], remainingMs };
}

/** Only an accepted drink action should add time to this deadline. */
export function addDrink(soberAt: number, strength: number, now = Date.now()) {
  const current = getIntoxication(soberAt, now).remainingMs;
  const dose = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  const remaining = Math.min(MAX_SOBER_TIME_MS, current + MAX_SOBER_TIME_MS * dose);
  return remaining > 0 ? now + remaining : 0;
}

export type IntoxicationMovementInput = { x: number; y: number; ms: number; seq?: number; sprint?: boolean };

/** The same input phase lets prediction replay the server's small steering sway. */
export function intoxicatedMovement(soberAt: number, input: IntoxicationMovementInput, phase = input.seq ?? 0, now = Date.now()) {
  const { level } = getIntoxication(soberAt, now);
  const length = Math.hypot(input.x, input.y);
  const speedMultiplier = 1 - level * .28;
  if (!length) return { x: 0, y: 0, speedMultiplier };
  const angle = Math.sin(phase * .37) * level * .20;
  const x = input.x / length, y = input.y / length;
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle), speedMultiplier };
}
