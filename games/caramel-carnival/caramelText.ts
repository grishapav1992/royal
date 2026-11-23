import {language, t, tr as hostTr} from '../../src/i18n/index';

// Candy box labels travel with the package. The installed host dictionary can predate them.
const english: Record<string, string> = {
  '{0} из {1}': '{0} of {1}',
  'Покупка фестиваля стоит 35 ставок, списывается один раз. Максимальная выплата всего раунда вместе с бесплатными вращениями: 5 000 базовых ставок. При достижении предела оставшиеся каскады и вращения заканчиваются. Выплаты округляются вниз до 0,01 USDT.': 'The festival costs 35 stakes, debited once. The maximum payout for the whole round including free spins is 5,000 base stakes. When the limit is reached the remaining cascades and spins end. Payouts are rounded down to 0.01 USDT.',
  'Нажми «Вращать», чтобы открыть коробку': 'Press Spin to open the box',
  'ОТКРЫТЬ КОРОБКУ': 'OPEN THE BOX',
  '8+ одинаковых в любом месте': '8+ of a kind anywhere',
  'Билеты фестиваля': 'Festival tickets',
  'Билеты': 'Tickets',
  'Энергия волчка': 'Spinning top energy',
  'Энергия': 'Energy',
  'Билеты, энергия и фестиваль': 'Tickets, energy and festival',
  '3 билета на поле: ещё 3 вращения, всего до 30': '3 tickets on the field: 3 more spins, up to 30',
  'Сохраняется до конца фестиваля': 'Kept until the festival ends',
  'Фестиваль, 10 вращений': 'Festival, 10 spins',
  'Купить': 'Buy',
  'Фестиваль идёт': 'Festival in progress',
  'Стоп': 'Stop',
  'Бесплатно': 'Free',
  'Ускорить': 'Speed up',
  'волчок +{0}': 'spinning top +{0}',
  '{0} шт. → {1}': '{0} pcs → {1}',
  '×{0} + {1} = ×{2}, до выплаты каскада': '×{0} + {1} = ×{2}, before the cascade pays',
  'Предел энергии ×{0}, до выплаты каскада': 'Energy limit ×{0}, before the cascade pays',
  'Каскад {0} · ×{1}': 'Cascade {0} · ×{1}',
  'Каскад {0} из 20, множитель ×{1}': 'Cascade {0} of 20, multiplier ×{1}',
  'Фестиваль идёт сам, энергия ×{0} сохраняется между вращениями': 'The festival plays itself, ×{0} energy is kept between spins',
  'Бесплатные вращения фестиваля не входят в счёт. Серию можно остановить в любой момент.': 'Free festival spins are not counted. You can stop the series at any time.',
};
const own = (source: string) => {
  const key = source.trim();
  if (!Object.hasOwn(english, key)) return undefined;
  return source.slice(0, source.length - source.trimStart().length) + english[key] + source.slice(source.trimEnd().length);
};
const labels = (source: string) => source.replace(/[^<>"'\n]+/g, label => own(label) ?? label);

export const caramelText = (source: string) => language !== 'en' ? t(source) : own(source) ?? t(/[<>]/.test(source) ? labels(source) : source);

/** Labels are translated as the host does, values stay untouched. */
export function caramelMarkup(parts: TemplateStringsArray, ...values: unknown[]): string {
  if (language !== 'en') return hostTr(parts, ...values);
  if (parts.some(part => /[<>]/.test(part))) {
    const local = parts.map(labels);
    return hostTr(Object.assign(local, {raw: parts.raw}) as unknown as TemplateStringsArray, ...values);
  }
  const translated = own(parts.map((part, i) => part + (i < values.length ? `{${i}}` : '')).join(''));
  return translated === undefined ? hostTr(parts, ...values) : translated.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));
}
