import {language, t, tr as hostTr} from '../i18n/index';

// Premiere labels travel with the package. The installed host dictionary can predate them.
const english: Record<string, string> = {
  'ПРЕМЬЕРА · 14 ЛИНИЙ · ДО 10 000×': 'PREMIERE · 14 LINES · UP TO 10,000×',
  'ПОКУПКА БОНУСА': 'BONUS BUY',
  'Покупка бонуса и труппа': 'Bonus buy and cast',
  'КУПИТЬ': 'BUY',
  'ставки': 'stake',
  'Звёзды выходят в бонусе и держат свой барабан как WILD': 'Stars appear in the bonus and hold their reel as WILD',
  'На счёте не хватает USDT (Nile) для ставки.': 'Not enough USDT (Nile) in the account for this stake.',
  'Для игры нужен общий баланс USDT.': 'Playing requires the shared USDT balance.',
  'Недостаточно USDT (Nile) для выбранной ставки.': 'Not enough USDT (Nile) for the selected stake.',
  'Виртуальные USDT · Вход без ставки': 'Virtual USDT · Entry without a stake',
};
const own = (source: string) => {
  const key = source.trim();
  return Object.hasOwn(english, key) ? source.replace(key, english[key]) : undefined;
};

export const velvetText = (source: string) => language === 'en' ? own(source) ?? t(source) : t(source);

/** Markup literals are translated label by label, exactly as the host does. Values stay untouched. */
export function velvetMarkup(parts: TemplateStringsArray, ...values: unknown[]): string {
  if (language !== 'en' || !parts.some(part => /[<>]/.test(part))) return hostTr(parts, ...values);
  const local = parts.map(part => part.replace(/[^<>"'\n]+/g, label => own(label) ?? label));
  return hostTr(Object.assign(local, {raw: parts.raw}) as unknown as TemplateStringsArray, ...values);
}
