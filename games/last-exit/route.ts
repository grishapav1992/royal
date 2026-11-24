import { clamp } from './scene-kit';
/** The displayed multiplier selects scenery only. */
export const zones = [
 { key: 'industrial', ru: 'Промзона', en: 'Industrial', min: 1, horizon: .505, tint: [132, 128, 119], ground: [158, 141, 112], side: [.92, .92], props: [0, 1], steel: 0, sun: null },
 { key: 'interchange', ru: 'Развязка', en: 'Interchange', min: 2, horizon: .515, tint: [128, 128, 123], ground: [150, 143, 127], side: [.9, .9], props: [2, 3], steel: 0, sun: [.03, .02] },
 { key: 'highway', ru: 'Шоссе', en: 'Highway', min: 4, horizon: .505, tint: [144, 133, 112], ground: [186, 158, 112], side: [.94, .94], props: [4, 5], steel: 1, sun: null },
 { key: 'last-exit', ru: 'Последний съезд', en: 'Last exit', min: 8, horizon: .478, tint: [140, 138, 125], ground: [146, 132, 92], side: [0, .92], props: [6, 7], steel: 0, sun: [.03, .04] },
] as const;
export function zoneOf(multiplier: number) { const value = Number.isFinite(multiplier) ? multiplier : 1; return value >= 8 ? 3 : value >= 4 ? 2 : value >= 2 ? 1 : 0; }
/** Percent along the route strip: even steps to 8x, then a compressed run to the 100x cap. */
export function routePosition(value: number) { const v = clamp(value, 1, 100); return v <= 8 ? Math.log2(v) / 3 * 72 : 72 + Math.log(v / 8) / Math.log(100 / 8) * 28; }
