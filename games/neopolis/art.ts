import type { Hero } from '../../src/shared/neopolisMath';

// Explicit paths let the module builder fingerprint and package every raster asset.
const portraits: Record<Hero | 'null', string> = {
  granite: '/assets/neopolis/granite-v2.webp',
  impulse: '/assets/neopolis/impulse-v2.webp',
  prism: '/assets/neopolis/prism-v2.webp',
  null: '/assets/neopolis/null-v2.webp',
};

export function portrait(hero: Hero | 'null'): string {
  return '<img class="np-character" src="' + portraits[hero] + '" alt="" draggable="false" decoding="async">';
}

export function symbolArt(symbol: number): string {
  if (symbol === 6) return '<span class="np-wild" aria-hidden="true"><i></i><b>WILD</b></span>';
  if (symbol === 7) return '<span class="np-scatter" aria-hidden="true">' + portrait('null') + '<b>SCATTER</b></span>';
  return '<span class="np-symbol np-symbol-' + (symbol >= 0 && symbol < 6 ? symbol : 0) + '" aria-hidden="true"></span>';
}

export function noticeArt(battle: boolean): string {
  return '<div class="np-notice-art" aria-hidden="true">' + (battle ? portrait('null') : '<img src="/assets/neopolis/cover-v2.webp" alt="" draggable="false">') + '</div>';
}

export const skyline = '<div class="np-city" aria-hidden="true"><img src="/assets/neopolis/city-v2.webp" alt="" draggable="false" decoding="async"></div><div class="np-atmosphere" aria-hidden="true"></div>';
