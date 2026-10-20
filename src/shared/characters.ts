import { t as translateText } from '../i18n/index';
/** Stable IDs preserve existing accounts; 6 belongs to the bartender. */
export const PLAYER_CHARACTERS = [
  { id: 0, name: translateText('Эдди'), detail: translateText('Яркая куртка и шапка с помпоном') },
  { id: 1, name: translateText('Лиззи'), detail: translateText('Длинные волосы и сиреневое пальто') },
  { id: 2, name: translateText('Тоби'), detail: translateText('Тёмные волосы и оранжевая куртка') },
  { id: 3, name: translateText('Кевин'), detail: translateText('Синяя куртка и красный помпон') },
  { id: 4, name: translateText('Эмми'), detail: translateText('Розовые волосы и светлое пальто') },
  { id: 5, name: translateText('Клайд'), detail: translateText('Ушанка и розовая куртка') },
  { id: 7, name: translateText('Майлз'), detail: translateText('Кудри, круглые очки и жилет') },
  { id: 8, name: translateText('Арчи'), detail: translateText('Вязаная шапка, очки и шарф') },
  { id: 9, name: translateText('Дилан'), detail: translateText('Ирокез и кожаная куртка') },
  { id: 10, name: translateText('Мэй'), detail: translateText('Два пучка и полосатый свитер') },
  { id: 11, name: translateText('Джейк'), detail: translateText('Кепка с козырьком и худи') },
  { id: 12, name: translateText('Гас'), detail: translateText('Седые волосы, усы и костюм') },
] as const;
export function isPlayerCharacter(value: unknown): value is number {
  return typeof value === 'number' && PLAYER_CHARACTERS.some(character => character.id === value);
}
