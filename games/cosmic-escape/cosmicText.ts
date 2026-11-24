import {language, t, tr as hostTr} from '../../src/i18n/index';

// Cockpit labels travel with the package. The installed host dictionary can predate them.
const english: Record<string, string> = {
  'базовых ставок. Выплаты округляются вниз до 0,01 USDT. Ставка списывается один раз, весь выигрыш серии зачисляется один раз по окончании.': 'base bets. Payouts are rounded down to 0.01 USDT. The bet is charged once, and the whole series win is credited once when it ends.',
  'Экипаж': 'Crew',
  'Экипаж {0} из {1}': 'Crew {0} of {1}',
  '{0} из {1}': '{0} of {1}',
  'Гонщица': 'Racer',
  'Серебряная героиня': 'Silver heroine',
  'Серебряная': 'Silver',
  'Новый персонаж': 'New character',
  'Открыть капсулу': 'Open the capsule',
  'Прогресс недоступен': 'Progress unavailable',
  'Новые персонажи скоро': 'More characters soon',
  'Скоро новые': 'More soon',
  'Открыто {0} из {1}': '{0} of {1} unlocked',
  'Закрыть экипаж': 'Close the crew',
  'Закрыта': 'Locked',
  'Открыта': 'Unlocked',
  'Выбрана': 'Selected',
  'Выбрать': 'Select',
  'Пока закрыта': 'Still locked',
  'Закрытая капсула': 'Locked capsule',
  'Скоро': 'Soon',
  'В экипаж': 'To the crew',
  'от {0}': 'from {0}',
  'Очки за завершённый раунд': 'Points for a completed round',
  'Сменить персонажа можно после завершения раунда.': 'You can change the character after the round ends.',
  'Выбор не сохранён. Попробуй ещё раз.': 'The choice was not saved. Try again.',
  'Не удалось загрузить прогресс. Игра продолжает работать.': 'Progress could not be loaded. The game keeps working.',
  'Считается вся сумма, списанная за раунд, USDT. Бесплатные вращения и выигрыш очков не добавляют. Персонаж не влияет на ставки и шансы, сменить его можно между раундами.': 'The whole amount charged for a round counts, in USDT. Free spins and wins add no points. The character does not affect bets or chances and can be changed between rounds.',
  'Вращать': 'Spin',
  'Стоп': 'Stop',
  'Энергия': 'Energy',
  'Порталы': 'Portals',
  'Ставка': 'Bet',
  'Ставка на все 20 линий': 'Bet for all 20 lines',
  'Баланс': 'Balance',
  'Выигрыш': 'Win',
  'Миссии': 'Missions',
  'Купить 10, 12 или 15 вращений': 'Buy 10, 12 or 15 spins',
  'Бесплатные вращения за порталы': 'Free spins for portals',
  'Порталы, миссии и результат': 'Portals, missions and result',
  '{0} портала': '{0} portals',
  '5 порталов': '5 portals',
  'Результат вращения': 'Spin result',
  'Нажми «Вращать», чтобы начать путешествие': 'Press Spin to start your journey',
  'Барабаны вращаются': 'The reels are spinning',
  'Нет выигрышной линии': 'No winning line',
  'Порталы открыты': 'Portals open',
  'Возврат части ставки': 'Part of the bet returned',
  '{0} бесплатных вращений': '{0} free spins',
  'Линия {0} · {1} × {2}': 'Line {0} · {1} × {2}',
  'Линий: {0} · {1} × {2}': 'Lines: {0} · {1} × {2}',
  ' с WILD': ' with WILD',
  ', энергия ×{0}': ', energy ×{0}',
  '×{0} от ставки · зачислено на баланс': '×{0} of the bet · added to the balance',
  '×{0} от ставки': '×{0} of the bet',
  'Миссия {0} · зачислим в конце': 'Mission total {0} · added when it ends',
  'Миссия {0} · зачислено на баланс': 'Mission total {0} · added to the balance',
  'Вращение {0} из {1} · миссия {2}': 'Spin {0} of {1} · mission total {2}',
  'Бесплатное вращение {0} из {1}': 'Free spin {0} of {1}',
  'Цена списывается один раз. Все вращения миссии бесплатные.': 'The price is charged once. Every mission spin is free.',
  'Выбери миссию': 'Choose a mission',
  '{0} вращений': '{0} spins',
  'Купить за {0}': 'Buy for {0}',
  'Энергия с ×{0}': 'Energy from ×{0}',
  'WILD может занять весь барабан.': 'WILD can fill a whole reel.',
  'Две попытки раскрыть WILD за вращение.': 'Two chances to expand WILD on each spin.',
  'Эхо случается вдвое чаще.': 'Echo happens twice as often.',
  'Цена указана в USDT за всю миссию. Выплата может оказаться меньше цены или равной нулю.': 'Prices are in USDT for the whole mission. The payout can be less than the price or zero.',
};
const own = (source: string) => {
  const key = Object.hasOwn(english, source) ? source : source.trim();
  if (!Object.hasOwn(english, key)) return undefined;
  if (key === source) return english[key];
  return source.slice(0, source.length - source.trimStart().length) + english[key] + source.slice(source.trimEnd().length);
};
const labels = (source: string) => source.replace(/[^<>"'\n]+/g, label => own(label) ?? label);

export const cosmicText = (source: string) => language !== 'en' ? t(source) : own(source) ?? t(/[<>]/.test(source) ? labels(source) : source);

/** Labels are translated as the host does, values stay untouched. */
export function cosmicMarkup(parts: TemplateStringsArray, ...values: unknown[]): string {
  if (language !== 'en') return hostTr(parts, ...values);
  if (parts.some(part => /[<>]/.test(part))) {
    const local = parts.map(labels);
    return hostTr(Object.assign(local, {raw: parts.raw}) as unknown as TemplateStringsArray, ...values);
  }
  const translated = own(parts.map((part, i) => part + (i < values.length ? `{${i}}` : '')).join(''));
  return translated === undefined ? hostTr(parts, ...values) : translated.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));
}
