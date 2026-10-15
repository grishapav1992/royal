/** A fixed catalog keeps saved appearances small and safe to render on every client. */
export const APPEARANCE_OPTIONS = {
  gender: ['Мужской', 'Женский'],
  body: ['Стандартный', 'Толстый', 'Длинный'],
  skinTone: ['Фарфоровый', 'Светлый', 'Персиковый', 'Смуглый', 'Коричневый', 'Тёмный'],
  hair: ['Короткая', 'Каре', 'Длинные', 'Кудри', 'Ирокез', 'Два пучка', 'Хвост', 'Лысый'],
  hairColor: ['Угольный', 'Шоколадный', 'Каштановый', 'Рыжий', 'Блонд', 'Седой', 'Розовый', 'Синий', 'Зелёный', 'Сиреневый'],
  eyes: ['Круглые', 'Сонные', 'Удивлённые'],
  eyebrows: ['Обычные', 'Густые', 'Домиком', 'Монобровь'],
  mouth: ['Обычный', 'Улыбка', 'Недовольный', 'Один зуб'],
  facialHair: ['Нет', 'Усы', 'Борода', 'Эспаньолка'],
  top: ['Футболка', 'Худи', 'Куртка', 'Свитер в полоску', 'Пальто', 'Жилет'],
  topColor: ['Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Бирюзовый', 'Синий', 'Сиреневый', 'Розовый', 'Молочный', 'Чёрный', 'Коричневый', 'Бордовый'],
  bottom: ['Брюки', 'Шорты', 'Юбка'],
  bottomColor: ['Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Бирюзовый', 'Синий', 'Сиреневый', 'Розовый', 'Молочный', 'Чёрный', 'Коричневый', 'Бордовый'],
  shoes: ['Кеды', 'Ботинки', 'Тапки'],
  shoeColor: ['Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Бирюзовый', 'Синий', 'Сиреневый', 'Розовый', 'Молочный', 'Чёрный', 'Коричневый', 'Бордовый'],
  hat: ['Нет', 'Шапка с помпоном', 'Бини', 'Кепка', 'Ушанка', 'Шапка с ушами', 'Дуршлаг'],
  accessoryColor: ['Красный', 'Оранжевый', 'Жёлтый', 'Зелёный', 'Бирюзовый', 'Синий', 'Сиреневый', 'Розовый', 'Молочный', 'Чёрный', 'Коричневый', 'Бордовый'],
  glasses: ['Нет', 'Круглые', 'Квадратные', 'Солнечные', 'Звёзды'],
  earrings: ['Нет', 'Гвоздики', 'Кольца', 'Вишенки', 'Рыбки'],
  tattoo: ['Нет', 'Пельмень на щеке', 'НЛО на щеке', 'Рыба на руке', 'Картошка на руке', '404 на щеке'],
  necklace: ['Нет', 'Цепочка', 'Галстук', 'Медаль «№1»'],
  scarf: ['Нет', 'Шарф'],
  makeup: ['Нет', 'Ресницы', 'Помада', 'Румяна', 'Ресницы и помада', 'Полный'],
  makeupColor: ['Розовый', 'Красный', 'Коралловый', 'Сливовый', 'Коричневый', 'Чёрный'],
} as const;
export type AppearanceField = keyof typeof APPEARANCE_OPTIONS;
export type Appearance = { version: 1 } & Record<AppearanceField, number>;
export const APPEARANCE_FIELDS = Object.keys(APPEARANCE_OPTIONS) as AppearanceField[];
export const SKIN_COLORS = ['#f4d7c3', '#edc2a2', '#dfa47b', '#bc825b', '#925b40', '#603e32'];
export const HAIR_COLORS = ['#302b30', '#51352c', '#81503a', '#be6837', '#e2c373', '#b7b9b2', '#db78a1', '#527ead', '#628454', '#a282b5'];
export const CLOTHING_COLORS = ['#d95444', '#df8b3c', '#edc653', '#719b60', '#55998f', '#507cad', '#9674ad', '#d585a2', '#eee1bf', '#3b3b44', '#8d694d', '#904654'];
export const MAKEUP_COLORS = ['#c87991', '#bc454d', '#d67a62', '#8b4f76', '#946354', '#42353e'];
export const DEFAULT_APPEARANCE: Appearance = {
  version: 1, gender: 0, body: 0, skinTone: 1, hair: 0, hairColor: 1,
  eyes: 0, eyebrows: 0, mouth: 0, facialHair: 0, top: 2, topColor: 0,
  bottom: 0, bottomColor: 5, shoes: 0, shoeColor: 8, hat: 0,
  accessoryColor: 2, glasses: 0, earrings: 0, tattoo: 0, necklace: 0, scarf: 0,
  makeup: 0, makeupColor: 0,
};

export function isAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.version === 1 && Object.keys(data).length === APPEARANCE_FIELDS.length + 1
    && APPEARANCE_FIELDS.every(field => Number.isInteger(data[field]) && Number(data[field]) >= 0 && Number(data[field]) < APPEARANCE_OPTIONS[field].length);
}
/** Older saved outfits predate the optional makeup controls. */
export function normalizeAppearance(value: unknown): Appearance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = { ...value } as Record<string, unknown>;
  for (const field of ['makeup', 'makeupColor'] as const) {
    if (!Object.hasOwn(data, field)) data[field] = DEFAULT_APPEARANCE[field];
  }
  return isAppearance(data) ? data : null;
}
export function serializeAppearance(value?: Appearance | null): string {
  if (!value) return '';
  return JSON.stringify({ version: 1, ...Object.fromEntries(APPEARANCE_FIELDS.map(field => [field, value[field]])) });
}
export function parseAppearance(value: string): Appearance | null {
  if (!value || value.length > 1024) return null;
  try { return normalizeAppearance(JSON.parse(value)); } catch { return null; }
}
export function appearanceKey(value: Appearance): string {
  return `avatar-v1-${APPEARANCE_FIELDS.filter(field => field !== 'gender').map(field => value[field]).join('-')}`;
}
export function appearanceFromLegacy(skin: number | null): Appearance {
  const seeds: Partial<Appearance>[] = [
    { top: 1, hat: 1, accessoryColor: 2 },
    { gender: 1, hair: 2, hairColor: 1, top: 4, topColor: 6 },
    { skinTone: 4, topColor: 1 }, { topColor: 5, hat: 1, accessoryColor: 0 },
    { gender: 1, skinTone: 3, hair: 2, hairColor: 6, top: 4, topColor: 8 },
    { top: 1, topColor: 7, hairColor: 4, hat: 4 }, {},
    { body: 1, skinTone: 4, hair: 3, top: 5, topColor: 10, glasses: 1, necklace: 2 },
    { body: 2, hairColor: 3, top: 1, topColor: 4, glasses: 1, hat: 2, scarf: 1 },
    { hair: 4, hairColor: 6, topColor: 9 },
    { gender: 1, skinTone: 3, hair: 5, top: 3, topColor: 4 },
    { top: 1, topColor: 10, hat: 3, accessoryColor: 10 },
    { body: 1, hairColor: 5, topColor: 6, facialHair: 1, necklace: 2 },
  ];
  return { ...DEFAULT_APPEARANCE, ...seeds[skin ?? 0] };
}
export function randomAppearance(): Appearance {
  const result = { ...DEFAULT_APPEARANCE };
  for (const field of APPEARANCE_FIELDS) result[field] = Math.floor(Math.random() * APPEARANCE_OPTIONS[field].length);
  // Most random visitors wear just a few accessories.
  for (const field of ['hat', 'glasses', 'earrings', 'tattoo', 'necklace', 'scarf', 'facialHair', 'makeup'] as const) if (Math.random() < .6) result[field] = 0;
  return result;
}
