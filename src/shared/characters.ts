/** Stable IDs preserve existing accounts; 6 belongs to the bartender. */
export const PLAYER_CHARACTERS = [
  { id: 0, name: 'Эдди', detail: 'Яркая куртка и шапка с помпоном' },
  { id: 1, name: 'Лиззи', detail: 'Длинные волосы и сиреневое пальто' },
  { id: 2, name: 'Тоби', detail: 'Тёмные волосы и оранжевая куртка' },
  { id: 3, name: 'Кевин', detail: 'Синяя куртка и красный помпон' },
  { id: 4, name: 'Эмми', detail: 'Розовые волосы и светлое пальто' },
  { id: 5, name: 'Клайд', detail: 'Ушанка и розовая куртка' },
  { id: 7, name: 'Майлз', detail: 'Кудри, круглые очки и жилет' },
  { id: 8, name: 'Арчи', detail: 'Вязаная шапка, очки и шарф' },
  { id: 9, name: 'Дилан', detail: 'Ирокез и кожаная куртка' },
  { id: 10, name: 'Мэй', detail: 'Два пучка и полосатый свитер' },
  { id: 11, name: 'Джейк', detail: 'Кепка с козырьком и худи' },
  { id: 12, name: 'Гас', detail: 'Седые волосы, усы и костюм' },
] as const;
export function isPlayerCharacter(value: unknown): value is number {
  return typeof value === 'number' && PLAYER_CHARACTERS.some(character => character.id === value);
}
