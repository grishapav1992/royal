import { t as translateText } from '../i18n/index';
import { TOILET, OCCUPIED_TOILET_CUBICLE, toiletSinkApproaches } from './toilet';
import type { Point } from '../game/navigation';

/**
 * Restroom play: wash at a sink (cold water takes a little off the drinking timer),
 * the hand dryer, lockable cubicles and a mirror selfie. No stake, wallet or reward.
 */
export const TOILET_SINKS: readonly Point[] = toiletSinkApproaches;
export const SINK_RADIUS = 40;
export const WASH_SOBER_MS = 5 * 60 * 1000;
export const WASH_COOLDOWN_MS = 30000;
export const DRYER_COOLDOWN_MS = 4000;
export const TOILET_ACT_MS = { wash: 1400, dry: 2600 } as const;
// The dryer hangs on the left wall below the radiator and the bin.
export const HAND_DRYER = { x: 92, y: 530, approach: { x: 134, y: 510 }, radius: 46 } as const;
export const nearSink = (p: { hall?: string; x: number; y: number }) => p.hall !== 'toilet' ? -1 : TOILET_SINKS.findIndex(s => Math.hypot(s.x - p.x, s.y - p.y) <= SINK_RADIUS);
export const nearDryer = (p: { hall?: string; x: number; y: number }) => p.hall === 'toilet' && Math.hypot(HAND_DRYER.approach.x - p.x, HAND_DRYER.approach.y - p.y) <= HAND_DRYER.radius;
/** Free cubicles become seats; while someone sits, the door stays shut for everyone. */
export const TOILET_CUBICLE_SEATS = TOILET.cubicles.filter(p => p.id !== OCCUPIED_TOILET_CUBICLE).map(p => ({
  id: `toilet-cubicle-${p.id}`, cubicle: p.id, x: p.x + p.w / 2, y: p.y + 82, entry: { x: p.x + p.w / 2, y: p.y + p.h - 24 },
}));
export const cubicleOfSeat = (seat: string) => TOILET_CUBICLE_SEATS.find(s => s.id === seat)?.cubicle;
export type ToiletActEvent = { kind: 'wash' | 'dry'; sink: number; by: string };
export const TOILET_LINES = {
  washed: translateText('Холодная вода немного отрезвляет: минус пять минут.'),
  fresh: translateText('Освежился. Ты и так трезв.'),
  wait: translateText('Дай воде стечь, умыться снова можно чуть позже.'),
};
