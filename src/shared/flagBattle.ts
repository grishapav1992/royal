import {recoverableStakes} from './gameStakes';
export const FLAG_GAME = 'flag-battle' as const;
export const FLAG_HEADER = 'X-Royal-Flag-Battle';
export const FLAG_BETS = recoverableStakes(['100', '200', '500', '1000', '2000', '5000']);
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
  { id: 'ES', ru: 'Испания', en: 'Spain' },
  { id: 'IT', ru: 'Италия', en: 'Italy' },
  { id: 'PT', ru: 'Португалия', en: 'Portugal' },
  { id: 'NL', ru: 'Нидерланды', en: 'Netherlands' },
  { id: 'BE', ru: 'Бельгия', en: 'Belgium' },
  { id: 'CH', ru: 'Швейцария', en: 'Switzerland' },
  { id: 'SE', ru: 'Швеция', en: 'Sweden' },
  { id: 'NO', ru: 'Норвегия', en: 'Norway' },
  { id: 'DK', ru: 'Дания', en: 'Denmark' },
  { id: 'FI', ru: 'Финляндия', en: 'Finland' },
  { id: 'PL', ru: 'Польша', en: 'Poland' },
  { id: 'UA', ru: 'Украина', en: 'Ukraine' },
  { id: 'AT', ru: 'Австрия', en: 'Austria' },
  { id: 'IE', ru: 'Ирландия', en: 'Ireland' },
  { id: 'GR', ru: 'Греция', en: 'Greece' },
  { id: 'CZ', ru: 'Чехия', en: 'Czechia' },
  { id: 'RO', ru: 'Румыния', en: 'Romania' },
  { id: 'HU', ru: 'Венгрия', en: 'Hungary' },
  { id: 'MX', ru: 'Мексика', en: 'Mexico' },
  { id: 'CL', ru: 'Чили', en: 'Chile' },
  { id: 'CO', ru: 'Колумбия', en: 'Colombia' },
  { id: 'PE', ru: 'Перу', en: 'Peru' },
  { id: 'UY', ru: 'Уругвай', en: 'Uruguay' },
  { id: 'AU', ru: 'Австралия', en: 'Australia' },
  { id: 'NZ', ru: 'Новая Зеландия', en: 'New Zealand' },
  { id: 'KR', ru: 'Южная Корея', en: 'South Korea' },
  { id: 'ID', ru: 'Индонезия', en: 'Indonesia' },
  { id: 'TH', ru: 'Таиланд', en: 'Thailand' },
  { id: 'VN', ru: 'Вьетнам', en: 'Vietnam' },
  { id: 'SA', ru: 'Саудовская Аравия', en: 'Saudi Arabia' },
  { id: 'AE', ru: 'ОАЭ', en: 'United Arab Emirates' },
  { id: 'ZA', ru: 'Южная Африка', en: 'South Africa' },
  { id: 'EG', ru: 'Египет', en: 'Egypt' },
  { id: 'MA', ru: 'Марокко', en: 'Morocco' },
  { id: 'NG', ru: 'Нигерия', en: 'Nigeria' },
  { id: 'KE', ru: 'Кения', en: 'Kenya' },
] as const;
export type FlagCountry = typeof FLAG_COUNTRIES[number]['id'];
export const FLAG_MODES = [
  { id: 'classic', count: 12, ru: 'Классика', en: 'Classic', multiplier: 1152, seconds: 20 },
  { id: 'expanded', count: 24, ru: 'Большая битва', en: 'Grand battle', multiplier: 2304, seconds: 24 },
  { id: 'world', count: 48, ru: 'Мировая битва', en: 'World battle', multiplier: 4608, seconds: 30 },
] as const;
export type FlagMode = typeof FLAG_MODES[number]['id'];
export const flagModeInfo = (mode: FlagMode) => FLAG_MODES.find(m => m.id === mode)!;
export const flagCountries = (mode: FlagMode = 'classic') => FLAG_COUNTRIES.slice(0, flagModeInfo(mode).count);
export type FlagSettings = { flags: { country: FlagCountry; mode?: FlagMode } };
type FlagViewBase = { country: FlagCountry; order: FlagCountry[]; seed: number };
export type FlagView = FlagViewBase & ({ version: 1 } | { version: 2; mode: FlagMode });
export const flagViewMode = (view: FlagView): FlagMode => view.version === 1 ? 'classic' : view.mode;
export const flagCapability = (header: string | undefined): boolean | 2 => header === '2' ? 2 : header === '1';
export const supportsFlagRules = (capability: boolean | 2, rules: number) => capability === 2 ? rules === 1 || rules === 2 : capability && rules === 1;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, expected: string) => Object.keys(v).sort().join(',') === expected.split(',').sort().join(',');
export const validFlagCountry = (v: unknown): v is FlagCountry => FLAG_COUNTRIES.some(c => c.id === v);
export const validFlagStake = (v: unknown): v is string => FLAG_BETS.some(s => s === v);
export const validFlagMode = (v: unknown): v is FlagMode => FLAG_MODES.some(m => m.id === v);
export function validFlagSettings(v: unknown): v is FlagSettings {
  if (!object(v) || !keys(v, 'flags') || !object(v.flags)) return false;
  const mode = keys(v.flags, 'country') ? 'classic' : keys(v.flags, 'country,mode') && validFlagMode(v.flags.mode) ? v.flags.mode : undefined;
  return !!mode && flagCountries(mode).some(c => c.id === v.flags.country);
}
/** Total return includes the stake. Round once, in integer common-wallet cents. */
export function flagPayout(stake: string, mode: FlagMode = 'classic'): string {
  if (!validFlagStake(stake) || !validFlagMode(mode)) throw Error('Invalid Flag Battle stake or mode');
  return String(BigInt(stake) * BigInt(flagModeInfo(mode).count) * 24n / 25n);
}
export function validFlagView(v: unknown): v is FlagView {
  if (!object(v)) return false;
  const mode = v.version === 1 && keys(v, 'version,country,order,seed') ? 'classic'
    : v.version === 2 && keys(v, 'version,mode,country,order,seed') && validFlagMode(v.mode) ? v.mode : undefined;
  if (!mode) return false;
  const countries = flagCountries(mode);
  return countries.some(c => c.id === v.country)
    && Array.isArray(v.order) && v.order.length === countries.length && new Set(v.order).size === countries.length && v.order.every((id: unknown) => countries.some(c => c.id === id))
    && Number.isSafeInteger(v.seed) && v.seed >= 0 && v.seed < 2147483648;
}
export function validFlagSession(s: unknown): boolean {
  if (!object(s) || !keys(s, 'id,gameId,rulesVersion,state,stakeUnits,spentUnits,returnedUnits,view')
    || s.gameId !== FLAG_GAME || ![1, 2].includes(s.rulesVersion) || s.state !== 'settled'
    || typeof s.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s.id)
    || !validFlagStake(s.stakeUnits) || s.spentUnits !== s.stakeUnits || !object(s.view)) return false;
  const v = s.view;
  return keys(v, 'flags,player,dealer,community,actions,phase,ended,message') && validFlagView(v.flags) && v.flags.version === s.rulesVersion
    && [v.player,v.dealer,v.community,v.actions].every(a => Array.isArray(a) && a.length === 0)
    && v.phase === 1 && v.ended === true && typeof v.message === 'string'
    && s.returnedUnits === (v.flags.order.at(-1) === v.flags.country ? flagPayout(s.stakeUnits, flagViewMode(v.flags)) : '0');
}
