import { t as translateText } from '../i18n/index';
import type { Obstacle, Point } from '../game/navigation';
import { walkable } from '../game/navigation';

/**
 * Street play: hot drinks kiosk, snowballs and snowmen.
 * Everything here is free decoration and social play: no stake, wallet or reward.
 * Shared by the server, client prediction and tests.
 */

// Kiosk «Горячее» stands by the curb on the right side of the front sidewalk.
export const STREET_KIOSK = {
  x: 2190, y: 1120, width: 176,
  obstacle: { x: 2100, y: 1070, w: 180, h: 52 } as Obstacle,
  // Customers stand in front of the counter, between the kiosk and the curb.
  service: { x: 2105, y: 1130, w: 170, h: 66 } as Obstacle,
  approach: { x: 2190, y: 1166 },
  vendor: translateText('Продавщица Нина'),
} as const;
export const atStreetKiosk = (p: { hall?: string; x: number; y: number }) => p.hall === 'street'
  && p.x >= STREET_KIOSK.service.x && p.x <= STREET_KIOSK.service.x + STREET_KIOSK.service.w
  && p.y >= STREET_KIOSK.service.y && p.y <= STREET_KIOSK.service.y + STREET_KIOSK.service.h;

/** Kiosk-only drinks. Coffee is the bar's coffee; Mira's menu does not change. */
export const KIOSK_ONLY_DRINKS = [
  { id: 'cocoa', name: translateText('Какао'), description: translateText('Горячее какао с пенкой · без алкоголя'), color: '#9b6a4a', strength: 0 },
  { id: 'mulled-wine', name: translateText('Глинтвейн'), description: translateText('Горячее вино с пряностями · опьяняет'), color: '#a8433f', strength: .26 },
] as const;
export const KIOSK_DRINK_IDS = ['cocoa', 'coffee', 'mulled-wine'] as const;
export const KIOSK_LINES = [
  translateText('Какао с пенкой, кофе или глинтвейн? Скамейки рядом, садитесь греться.'),
  translateText('Глинтвейн горячий, но голову кружит не хуже вина. Какао безопаснее.'),
  translateText('Таксист Гоша берёт кофе каждые полчаса. Пассажира так и не дождался.'),
];

// Snow drifts by the curb: the places where snowballs are made.
export const SNOW_DRIFTS: readonly Point[] = [
  { x: 560, y: 1176 }, { x: 1010, y: 1172 }, { x: 1560, y: 1180 }, { x: 1985, y: 1178 },
];
// The roof keeps its own drifts by the parapet; snowmen stay a street thing.
export const ROOF_SNOW_DRIFTS: readonly Point[] = [
  { x: 320, y: 1110 }, { x: 1000, y: 1120 }, { x: 1880, y: 1115 }, { x: 980, y: 400 },
];
export type SnowHall = 'street' | 'roof';
export const isSnowHall = (hall: string | undefined): hall is SnowHall => hall === 'street' || hall === 'roof';
export const snowDrifts = (hall: string | undefined): readonly Point[] => hall === 'roof' ? ROOF_SNOW_DRIFTS : hall === 'street' ? SNOW_DRIFTS : [];
export const SNOW_PICK_RADIUS = 58;
export const MAX_SNOWBALLS = 3;
export const SNOW_PICK_MS = 600;
export const SNOW_THROW_MS = 650;
export const SNOW_RANGE = 420;
export const SNOW_SPEED = 560;
export const SNOW_HIT_RADIUS = 26;
export const SNOW_SPLAT_MS = 4000;
export const snowFlightMs = (from: Point, to: Point) => Math.round(Math.max(220, Math.hypot(to.x - from.x, to.y - from.y) / SNOW_SPEED * 1000));
export const nearSnowDrift = (p: { hall?: string; x: number; y: number; stairStep?: number }) => isSnowHall(p.hall) && !(p.stairStep ?? 0)
  && snowDrifts(p.hall).some(d => Math.hypot(d.x - p.x, d.y - p.y) <= SNOW_PICK_RADIUS);

/** The landing point keeps the direction of the aim and stops at the throwing range. */
export function snowballLanding(from: Point, aim: Point): Point {
  const dx = aim.x - from.x, dy = aim.y - from.y, d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d < 1) return { x: from.x, y: from.y + 60 };
  const k = Math.min(1, SNOW_RANGE / d);
  return { x: Math.round(from.x + dx * k), y: Math.round(from.y + dy * k) };
}
/** Direction used by the keyboard throw: straight ahead at three quarters of the range. */
export function snowballAim(from: Point, facing: string): Point {
  const d = SNOW_RANGE * .75;
  const v = facing === 'left' ? { x: -1, y: 0 } : facing === 'right' ? { x: 1, y: 0 } : facing === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  return { x: from.x + v.x * d, y: from.y + v.y * d };
}

// Snowmen: three rolled balls stacked in one place, shared by everyone in the room.
export const SNOW_ROLL_START = 10;
export const SNOW_ROLL_MAX = 38;
export const SNOW_ROLL_GROWTH = .028;
export const SNOWMAN_LIMIT = 5;
export const SNOWMAN_STACK_RADIUS = 40;
export const SNOWMAN_COMPLETE_MS = 2 * 60 * 60 * 1000;
export const SNOWMAN_IDLE_MS = 20 * 60 * 1000;
export const snowRollRadius = (distance: number) => Math.min(SNOW_ROLL_MAX, SNOW_ROLL_START + Math.max(0, distance) * SNOW_ROLL_GROWTH);
// The front sidewalk is the snowy area where balls grow and snowmen stand.
export const SNOW_FIELD = { x: 330, y: 960, w: 2160, h: 236 } as const;
const NO_SNOWMAN: Obstacle[] = [
  { x: 690, y: 920, w: 300, h: 150 },
  { x: STREET_KIOSK.obstacle.x - 30, y: STREET_KIOSK.obstacle.y - 40, w: STREET_KIOSK.obstacle.w + 60, h: 180 },
];
export const inSnowField = (p: Point) => p.x >= SNOW_FIELD.x && p.x <= SNOW_FIELD.x + SNOW_FIELD.w && p.y >= SNOW_FIELD.y && p.y <= SNOW_FIELD.y + SNOW_FIELD.h;
export function snowmanDropPoint(p: Point, facing: string): Point {
  const v = facing === 'left' ? { x: -1, y: 0 } : facing === 'right' ? { x: 1, y: 0 } : facing === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  return { x: Math.round(p.x + v.x * 34), y: Math.round(p.y + v.y * 22) };
}
export type SnowmanView = { id: string; x: number; y: number; parts: number[]; builder: string; complete: boolean; meltAt: number };
export const parseSnowmanParts = (value: string) => value.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0).slice(0, 3);
export type SnowmanPlacement =
  | { kind: 'stack'; id: string }
  | { kind: 'new' }
  | { kind: 'refused'; reason: string };
/** Decide where a rolled ball goes: on top of a nearby unfinished snowman or as a new base. */
export function placeSnowball(point: Point, radius: number, snowmen: readonly SnowmanView[], obstacles: readonly Obstacle[]): SnowmanPlacement {
  const near = snowmen.filter(s => Math.hypot(s.x - point.x, s.y - point.y) <= SNOWMAN_STACK_RADIUS).sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
  if (near) {
    if (near.complete || near.parts.length >= 3) return { kind: 'refused', reason: translateText('Этот снеговик уже готов. Поставь ком в другом месте.') };
    const top = near.parts[near.parts.length - 1];
    if (radius > top - 4) return { kind: 'refused', reason: translateText('Ком слишком большой для верха. Слепи поменьше или начни новый снеговик.') };
    return { kind: 'stack', id: near.id };
  }
  if (!inSnowField(point) || NO_SNOWMAN.some(o => point.x >= o.x && point.x <= o.x + o.w && point.y >= o.y && point.y <= o.y + o.h)
    || !walkable(point.x, point.y, obstacles as Obstacle[], 18)) return { kind: 'refused', reason: translateText('Здесь снеговик будет мешать проходу. Отойди в сторону.') };
  if (snowmen.some(s => Math.hypot(s.x - point.x, s.y - point.y) < 90)) return { kind: 'refused', reason: translateText('Слишком близко к другому снеговику.') };
  if (snowmen.length >= SNOWMAN_LIMIT) return { kind: 'refused', reason: translateText('На улице уже пять снеговиков. Подожди, пока какой-нибудь растает.') };
  if (radius < 20) return { kind: 'refused', reason: translateText('Для основания нужен ком побольше. Покатай его ещё.') };
  return { kind: 'new' };
}

// Roof fireworks: a crate by the north parapet. Anyone on the roof may launch; the sky is shared.
export const ROOF_FIREWORKS = {
  crate: { x: 1335, y: 430 },
  obstacle: { x: 1300, y: 394, w: 70, h: 36 } as Obstacle,
  approach: { x: 1335, y: 458 },
  radius: 70,
  cooldownMs: 12000,
} as const;
export const nearFireworks = (p: { hall?: string; x: number; y: number }) => p.hall === 'roof' && Math.hypot(p.x - ROOF_FIREWORKS.approach.x, p.y - ROOF_FIREWORKS.approach.y) <= ROOF_FIREWORKS.radius;
export type FireworkEvent = { id: number; x: number; y: number; hue: number; by: string };
/** A deterministic burst point in the sky above the skyline, so every viewer sees the same show. */
export function fireworkBurst(id: number): Point & { hue: number } {
  const r = (n: number) => ((id * 9301 + n * 49297) % 233280) / 233280;
  return { x: Math.round(420 + r(1) * 1400), y: Math.round(110 + r(2) * 120), hue: Math.floor(r(3) * 360) };
}

/** Street evening by Moscow time, with a half-hour transition at each end. */
export function streetEvening(now = Date.now()): number {
  const moscow = new Date(now + 3 * 60 * 60 * 1000);
  const minutes = moscow.getUTCHours() * 60 + moscow.getUTCMinutes() + moscow.getUTCSeconds() / 60;
  const ramp = (start: number) => Math.max(0, Math.min(1, (minutes - start) / 30));
  // Darkens from 16:30 to 17:00, brightens from 08:00 to 08:30.
  if (minutes >= 16 * 60 + 30) return ramp(16 * 60 + 30);
  if (minutes < 8 * 60) return 1;
  return 1 - ramp(8 * 60);
}
