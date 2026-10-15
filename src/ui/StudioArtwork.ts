import type { StudioTheme } from '../shared/studioGames';

/** Original worlds and symbols drawn for the club's native machines. */
export const STUDIO_ART: Record<StudioTheme, string> = {
  space: '/assets/studio/space-world.webp',
  candy: '/assets/studio/candy-world.webp',
  ocean: '/assets/studio/ocean-world.webp',
  forge: '/assets/studio/forge-world.webp',
  garden: '/assets/studio/garden-world.webp',
};

export const studioEscape = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

const ordinary: Record<StudioTheme, { sprite: number; name: string }[]> = {
  space: [{sprite:4,name:'Кристалл'},{sprite:3,name:'Звёздный колокол'},{sprite:9,name:'Орбитальная шестерня'}],
  candy: [{sprite:0,name:'Вишни'},{sprite:1,name:'Лимон'},{sprite:2,name:'Виноград'}],
  ocean: [{sprite:5,name:'Ракушка'},{sprite:4,name:'Морской кристалл'},{sprite:3,name:'Корабельный колокол'}],
  forge: [{sprite:9,name:'Шестерня'},{sprite:11,name:'Пламя'},{sprite:4,name:'Огненный кристалл'}],
  garden: [{sprite:10,name:'Лист'},{sprite:0,name:'Вишни'},{sprite:1,name:'Солнечный лимон'}],
};

export const studioSymbolName = (symbol: number, theme: StudioTheme): string => symbol < 3 ? ordinary[theme][symbol]?.name ?? 'Символ' : symbol === 3 ? 'WILD' : symbol === 4 ? 'SCATTER / сборщик' : 'Монета';

export function studioSymbol(symbol: number, theme: StudioTheme = 'space', label = '', size = ''): string {
  const sprite = symbol < 3 ? ordinary[theme][symbol]?.sprite ?? 0 : symbol === 3 ? 6 : symbol === 4 ? 8 : 7;
  return `<span class="studio-symbol-atlas ${Math.floor(sprite / 4) === 1 ? 'studio-atlas-middle ' : ''}${size}" style="background-position:${(sprite % 4 * 1.08 + .04) / 3.32 * 100}% ${(Math.floor(sprite / 4) * 1.08 + .04) / 2.24 * 100}%" ${label ? `role="img" aria-label="${studioEscape(label)}"` : 'aria-hidden="true"'}></span>`;
}

export function studioDie(value?: number): string {
  const pips: Record<number, number[]> = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  return `<span class="studio-die" role="img" aria-label="${value ? `Кость: ${value}` : 'Кость ждёт броска'}">${value ? Array.from({length:9},(_, index)=>`<i class="${pips[value].includes(index) ? 'pip' : ''}" aria-hidden="true"></i>`).join('') : '<strong aria-hidden="true">?</strong>'}</span>`;
}
