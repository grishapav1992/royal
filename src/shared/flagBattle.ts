export const FLAG_GAME = 'flag-battle' as const;
export const FLAG_HEADER = 'X-Royal-Flag-Battle';
export const FLAG_BETS = ['100', '200', '500', '1000', '2000', '5000'] as const;
export const FLAG_COUNTRIES = [
  { id: 'RU', ru: 'Россия', en: 'Russia' },
  { id: 'BR', ru: 'Бразилия', en: 'Brazil' },
  { id: 'US', ru: 'США', en: 'United States' },
  { id: 'JP', ru: 'Япония', en: 'Japan' },
  { id: 'FR', ru: 'Франция', en: 'France' },
  { id: 'DE', ru: 'Германия', en: 'Germany' },
  { id: 'GB', ru: 'Великобритания', en: 'United Kingdom' },
  { id: 'AR', ru: 'Аргентина', en: 'Argentina' },
  { id: 'CN', ru: 'Китай', en: 'China' },
  { id: 'IN', ru: 'Индия', en: 'India' },
  { id: 'TR', ru: 'Турция', en: 'Türkiye' },
  { id: 'CA', ru: 'Канада', en: 'Canada' },
] as const;
export type FlagCountry = typeof FLAG_COUNTRIES[number]['id'];
export type FlagSettings = { flags: { country: FlagCountry } };
export type FlagView = { version: 1; country: FlagCountry; order: FlagCountry[]; seed: number };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string) => Object.keys(v).sort().join(',') === expected.split(',').sort().join(',');
export const validFlagCountry = (v: unknown): v is FlagCountry => FLAG_COUNTRIES.some(c => c.id === v);
export const validFlagStake = (v: unknown): v is string => FLAG_BETS.some(s => s === v);
export function validFlagSettings(v: unknown): v is FlagSettings {
  return object(v) && keys(v, 'flags') && object(v.flags) && keys(v.flags, 'country') && validFlagCountry(v.flags.country);
}
/** Total return includes the stake. Round once, in integer common-wallet cents. */
export function flagPayout(stake: string): string {
  if (!validFlagStake(stake)) throw Error('Invalid Flag Battle stake');
  return String(BigInt(stake) * 288n / 25n);
}
export function validFlagView(v: unknown): v is FlagView {
  return object(v) && keys(v, 'version,country,order,seed') && v.version === 1 && validFlagCountry(v.country)
    && Array.isArray(v.order) && v.order.length === 12 && new Set(v.order).size === 12 && v.order.every(validFlagCountry)
    && Number.isSafeInteger(v.seed) && v.seed >= 0 && v.seed < 2147483648;
}
export function validFlagSession(s: unknown): boolean {
  if (!object(s) || !keys(s, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view')
    || s.gameId !== FLAG_GAME || s.rulesVersion !== 1 || s.state !== 'settled'
    || typeof s.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s.id)
    || !validFlagStake(s.stakeUnits) || s.spentUnits !== s.stakeUnits || !object(s.view)) return false;
  const v = s.view;
  return keys(v, 'flags,player,dealer,community,actions,phase,ended,message') && validFlagView(v.flags)
    && [v.player,v.dealer,v.community,v.actions].every(a => Array.isArray(a) && a.length === 0)
    && v.phase === 1 && v.ended === true && typeof v.message === 'string'
    && s.returnedUnits === (v.flags.order[11] === v.flags.country ? flagPayout(s.stakeUnits) : '0');
}
