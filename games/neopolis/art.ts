import { HEROES, type Hero, type BossId } from '../../src/shared/neopolisMath';

export const SCENES = [
  { id: 'null', background: '/assets/neopolis/city-v2.webp', costumes: '/assets/neopolis/team-night-v3.webp', villain: '/assets/neopolis/null-v2.webp' },
  { id: 'vespera', background: '/assets/neopolis/citadel-v3.webp', costumes: '/assets/neopolis/team-eclipse-v3.webp', villain: '/assets/neopolis/vespera-v3.webp' },
  { id: 'aeon', background: '/assets/neopolis/observatory-v3.webp', costumes: '/assets/neopolis/team-chrono-v3.webp', villain: '/assets/neopolis/aeon-v3.webp' },
] as const;

export function portrait(character: Hero | BossId): string {
  const hero = HEROES.indexOf(character as Hero);
  if (hero >= 0) return '<span class="np-character np-costume" data-character="' + character + '" style="--np-portrait-x:' + hero * 50 + '%" aria-hidden="true"></span>';
  return '<img class="np-character" src="' + SCENES.find(scene => scene.id === character)!.villain + '" alt="" draggable="false" decoding="async">';
}

export function symbolArt(symbol: number): string {
  if (symbol === 6) return '<span class="np-wild" aria-hidden="true"><i></i><b>WILD</b></span>';
  if (symbol === 7) return '<span class="np-scatter" aria-hidden="true">' + portrait('null') + '<b>SCATTER</b></span>';
  return '<span class="np-symbol np-symbol-' + (symbol >= 0 && symbol < 6 ? symbol : 0) + '" aria-hidden="true"></span>';
}

export function noticeArt(battle: boolean, boss: BossId = 'null'): string {
  return '<div class="np-notice-art" aria-hidden="true">' + (battle ? portrait(boss) : '<img src="/assets/neopolis/cover-v2.webp" alt="" draggable="false">') + '</div>';
}

export const skyline = '<div class="np-city" aria-hidden="true"><img class="np-city-current" src="/assets/neopolis/city-v2.webp" alt="" draggable="false" decoding="async"></div><div class="np-atmosphere" aria-hidden="true"></div>';
