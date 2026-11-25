/** Language and money of the mounted game. The host services own both. */
export const speech = {english: false, locale: 'ru-RU'};
export const t = (ru: string, en: string) => speech.english ? en : ru;
export const money = (units: number | bigint | string) => (Number(units) / 100).toLocaleString(speech.locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const signed = (units: bigint) => (units > 0n ? '+' : units < 0n ? '−' : '') + money(units < 0n ? -units : units);
export const points = (n: number) => {
  if (speech.english) return n === 1 ? 'point' : 'points';
  return ({one: 'очко', few: 'очка'} as Record<string, string>)[new Intl.PluralRules('ru').select(n)] ?? 'очков';
};
