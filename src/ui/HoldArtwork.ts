import { t as translateText } from '../i18n/index';
export type HoldSlotGame = 'studio-ember-vault' | 'studio-midnight-market' | 'studio-moonlit-mint';
export const HOLD_SYMBOL_NAMES: Record<HoldSlotGame, string[]> = {
  'studio-ember-vault': [translateText('Огранённый рубин'), translateText('Латунный ключ'), translateText('Огненный слиток'), translateText('Печать WILD'), translateText('Шестерня'), translateText('Монета сейфа')],
  'studio-midnight-market': [translateText('Шафрановый мешочек'), translateText('Лунный фонарь'), translateText('Изумрудный чайник'), translateText('Ночная звезда WILD'), translateText('Торговец-сборщик'), translateText('Рыночная монета')],
  'studio-moonlit-mint': [translateText('Серебряный серп'), translateText('Лунный кристалл'), translateText('Звёздный штамп'), translateText('Звезда чеканки WILD'), translateText('Печать двора'), translateText('Лунный медальон')],
};
const vault = [
 '<path d="M28 17H70L87 42L50 86L12 42Z" fill="#ff7075"/><path d="M28 17L36 42L50 86L65 42L70 17M13 42H86M36 42L50 17L65 42" stroke="#ffcdc0" fill="none"/><path d="M26 32L33 23" stroke="#fff4d2" stroke-width="5"/>',
 '<circle cx="34" cy="31" r="19" fill="#ffcf69"/><circle cx="34" cy="31" r="8" fill="#34575b"/><path d="M46 44L80 79L87 71L76 60L69 67L59 55L67 47L58 38Z" fill="#eaae59"/><path d="M47 48L76 76" stroke="#ffe4a0" stroke-width="5"/>',
 '<path d="M22 28H72L87 70L74 81H12Z" fill="#efa64b"/><path d="M22 28L34 68H87L74 81H12L34 68" fill="#ffd887"/><path d="M34 68L22 28H72" stroke="#fff2c2"/><path d="M32 20L39 9M53 19L54 5M71 20L78 10" stroke="#ff765b" stroke-width="5"/>',
 '<path d="M50 7L61 24L82 22L77 44L93 57L73 68L70 88L49 82L31 92L24 70L6 58L23 43L18 22L40 23Z" fill="#ffce6b"/><circle cx="50" cy="51" r="27" fill="#fff0ad"/><text x="50" y="56" text-anchor="middle" font-size="14" font-weight="900" fill="#935c38" stroke="none">WILD</text>',
 '<path d="M40 10H60L64 22L77 19L87 34L78 44L91 52L86 70L72 69L71 84L53 91L45 79L32 84L19 70L24 57L10 50L15 32L30 33L30 18Z" fill="#62abb1"/><circle cx="50" cy="51" r="21" fill="#27555c"/><circle cx="50" cy="51" r="10" fill="#a0e0d5"/>',
 '<circle cx="50" cy="50" r="39" fill="#f8c563"/><circle cx="50" cy="50" r="31" fill="#ffe69a" stroke="#d59144" stroke-width="4"/><path d="M34 46V37Q34 21 50 21Q66 21 66 37V46" fill="none" stroke="#a56338" stroke-width="6"/><rect x="30" y="43" width="40" height="29" rx="7" fill="#c57c41"/><circle cx="50" cy="55" r="5" fill="#fff0bb"/><path d="M50 58V64" stroke="#fff0bb" stroke-width="4"/>',
];
const market = [
 '<path d="M35 28L25 13L48 19L70 12L64 28Q84 47 76 76Q50 95 25 76Q16 49 35 28Z" fill="#e6a863"/><path d="M32 28H67" stroke="#f8df9d" stroke-width="6"/><path d="M39 66L56 39M34 55L63 57M46 41L57 73" stroke="#fae3a5" stroke-width="4"/>',
 '<path d="M32 20H67L75 67L66 82H33L24 67Z" fill="#9bcbec"/><path d="M31 20H68M26 66H73M33 30V58M65 30V58" stroke="#ffe49e" stroke-width="5"/><path d="M40 15Q50 2 60 15M39 86H61" stroke="#d9a65e" fill="none"/><path d="M55 32Q38 40 46 55Q58 63 64 50Q48 55 48 43Q48 36 55 32Z" fill="#fff4b5" stroke="none"/>',
 '<ellipse cx="48" cy="58" rx="28" ry="24" fill="#6fe1c4"/><path d="M71 42Q83 38 91 30L85 55L73 60M26 39Q5 24 10 52Q9 70 24 67" fill="none" stroke="#a2f2d4" stroke-width="7"/><path d="M33 35H62L59 28H37Z" fill="#e6c489"/><path d="M47 27V18M33 81H63" stroke="#ffe3ab" stroke-width="5"/>',
 '<path d="M50 8L62 34L92 38L70 57L75 88L49 73L23 88L28 57L7 37L36 33Z" fill="#b6a4ff"/><circle cx="50" cy="51" r="20" fill="#ffe8ad"/><text x="50" y="56" text-anchor="middle" font-size="12" font-weight="900" fill="#625080" stroke="none">WILD</text>',
 '<path d="M23 47Q16 17 48 14Q79 12 79 47L67 43L63 27L38 30L30 45Z" fill="#ab6bcf"/><circle cx="50" cy="43" r="21" fill="#ffd3b3"/><circle cx="43" cy="40" r="2" fill="#664c73"/><circle cx="58" cy="40" r="2" fill="#664c73"/><path d="M42 49Q50 55 58 48M22 70Q29 58 50 59Q74 57 80 75L73 90H26Z" fill="#87d4d1"/><path d="M34 64L43 87M63 65L57 88" stroke="#fff0ac" stroke-width="5"/>',
 '<circle cx="50" cy="50" r="40" fill="#e2a874"/><circle cx="50" cy="50" r="32" fill="#ffe0a2" stroke="#ad734e" stroke-width="4"/><path d="M28 42H72L65 30H35ZM33 43V64M48 43V64M65 43V64M27 70H73" fill="none" stroke="#9b6874" stroke-width="5"/><path d="M39 22L48 12L58 22" fill="none" stroke="#fff6ca" stroke-width="3"/>',
];
const mint = [
 '<path d="M63 9Q20 14 15 50Q12 85 52 91Q76 88 88 68Q52 83 37 55Q23 27 63 9Z" fill="#d5edff"/><path d="M47 21Q25 36 32 58Q39 78 60 81" stroke="#96c5e9" fill="none"/>',
 '<path d="M50 6L77 30L71 72L50 94L27 72L21 30Z" fill="#afa9ff"/><path d="M21 30H77L50 94L43 30L50 6L59 30L71 72M27 72H71" stroke="#eae6ff" fill="none"/>',
 '<path d="M36 12H65L69 29L60 49H39L31 30Z" fill="#bed1f5"/><path d="M37 49H64V59H37ZM22 69L34 59H67L80 69V86H22Z" fill="#91b0da"/><path d="M50 24L54 32L64 33L57 40L58 47L50 43L41 47L42 39L36 32L46 31Z" fill="#fff2ba"/><path d="M28 77H73" stroke="#e8f4ff" stroke-width="5"/>',
 '<path d="M50 7L61 34L90 34L68 53L79 85L50 66L22 86L31 54L9 34H39Z" fill="#c7d8ff"/><circle cx="50" cy="49" r="18" fill="#f7f3e7"/><text x="50" y="54" text-anchor="middle" font-size="12" font-weight="900" fill="#667daf" stroke="none">WILD</text>',
 '<path d="M33 18L49 11L67 19L75 37L70 57L52 69L31 61L21 42Z" fill="#a0bfd8"/><circle cx="49" cy="40" r="17" fill="#dcecff"/><path d="M34 64L28 89L47 81L65 91L61 65" fill="#9da5e0"/><path d="M49 28L52 36L62 37L55 43L56 53L49 48L41 53L43 43L35 37L46 36Z" fill="#f9efd0" stroke="none"/>',
 '<circle cx="50" cy="50" r="40" fill="#a8bfde"/><circle cx="50" cy="50" r="32" fill="#e6f2ff" stroke="#889dc5" stroke-width="4"/><path d="M58 26Q29 34 36 56Q45 76 65 64Q43 66 45 49Q46 37 58 26Z" fill="#9e9dda"/><path d="M66 34L69 40L76 42L70 46L70 53L65 49L59 53L60 46L55 41L63 40Z" fill="#fff1ba" stroke="none"/>',
];
export function holdSymbol(game: HoldSlotGame, symbol: number): string {
 const key=game==='studio-ember-vault'?0:game==='studio-midnight-market'?1:2;
 return `<svg viewBox="0 0 100 100" class="hold-art" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="45" fill="${['#e8b664','#be86d6','#a9c6ef'][key]}" opacity=".12"/><g stroke="${['#a46545','#785983','#7189b2'][key]}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${[vault,market,mint][key][symbol]??''}</g></svg>`;
}
