import { t as translateText } from '../i18n/index';
/** A fixed catalog keeps saved appearances small and safe to render on every client. */
export const APPEARANCE_OPTIONS = {
  gender: [translateText('Мужской'), translateText('Женский')],
  body: [translateText('Стандартный'), translateText('Толстый'), translateText('Длинный')],
  skinTone: [translateText('Фарфоровый'), translateText('Светлый'), translateText('Персиковый'), translateText('Смуглый'), translateText('Коричневый'), translateText('Тёмный')],
  hair: [translateText('Короткая'), translateText('Каре'), translateText('Длинные'), translateText('Кудри'), translateText('Ирокез'), translateText('Два пучка'), translateText('Хвост'), translateText('Лысый')],
  hairColor: [translateText('Угольный'), translateText('Шоколадный'), translateText('Каштановый'), translateText('Рыжий'), translateText('Блонд'), translateText('Седой'), translateText('Розовый'), translateText('Синий'), translateText('Зелёный'), translateText('Сиреневый')],
  eyes: [translateText('Круглые'), translateText('Сонные'), translateText('Удивлённые')],
  eyebrows: [translateText('Обычные'), translateText('Густые'), translateText('Домиком'), translateText('Монобровь')],
  mouth: [translateText('Обычный'), translateText('Улыбка'), translateText('Недовольный'), translateText('Один зуб')],
  facialHair: [translateText('Нет'), translateText('Усы'), translateText('Борода'), translateText('Эспаньолка')],
  top: [translateText('Футболка'), translateText('Худи'), translateText('Куртка'), translateText('Свитер в полоску'), translateText('Пальто'), translateText('Жилет')],
  topColor: [translateText('Красный'), translateText('Оранжевый'), translateText('Жёлтый'), translateText('Зелёный'), translateText('Бирюзовый'), translateText('Синий'), translateText('Сиреневый'), translateText('Розовый'), translateText('Молочный'), translateText('Чёрный'), translateText('Коричневый'), translateText('Бордовый')],
  bottom: [translateText('Брюки'), translateText('Шорты'), translateText('Юбка')],
  bottomColor: [translateText('Красный'), translateText('Оранжевый'), translateText('Жёлтый'), translateText('Зелёный'), translateText('Бирюзовый'), translateText('Синий'), translateText('Сиреневый'), translateText('Розовый'), translateText('Молочный'), translateText('Чёрный'), translateText('Коричневый'), translateText('Бордовый')],
  shoes: [translateText('Кеды'), translateText('Ботинки'), translateText('Тапки')],
  shoeColor: [translateText('Красный'), translateText('Оранжевый'), translateText('Жёлтый'), translateText('Зелёный'), translateText('Бирюзовый'), translateText('Синий'), translateText('Сиреневый'), translateText('Розовый'), translateText('Молочный'), translateText('Чёрный'), translateText('Коричневый'), translateText('Бордовый')],
  hat: [translateText('Нет'), translateText('Шапка с помпоном'), translateText('Бини'), translateText('Кепка'), translateText('Ушанка'), translateText('Шапка с ушами'), translateText('Дуршлаг')],
  accessoryColor: [translateText('Красный'), translateText('Оранжевый'), translateText('Жёлтый'), translateText('Зелёный'), translateText('Бирюзовый'), translateText('Синий'), translateText('Сиреневый'), translateText('Розовый'), translateText('Молочный'), translateText('Чёрный'), translateText('Коричневый'), translateText('Бордовый')],
  glasses: [translateText('Нет'), translateText('Круглые'), translateText('Квадратные'), translateText('Солнечные'), translateText('Звёзды')],
  earrings: [translateText('Нет'), translateText('Гвоздики'), translateText('Кольца'), translateText('Вишенки'), translateText('Рыбки')],
  tattoo: [translateText('Нет'), translateText('Пельмень на щеке'), translateText('НЛО на щеке'), translateText('Рыба на руке'), translateText('Картошка на руке'), translateText('404 на щеке')],
  necklace: [translateText('Нет'), translateText('Цепочка'), translateText('Галстук'), translateText('Медаль «№1»')],
  scarf: [translateText('Нет'), translateText('Шарф')],
  makeup: [translateText('Нет'), translateText('Ресницы'), translateText('Помада'), translateText('Румяна'), translateText('Ресницы и помада'), translateText('Полный')],
  makeupColor: [translateText('Розовый'), translateText('Красный'), translateText('Коралловый'), translateText('Сливовый'), translateText('Коричневый'), translateText('Чёрный')],
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
