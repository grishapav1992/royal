import { t as translateText } from '../i18n/index';
export type ElementSlotGame = 'studio-stormforge-duel' | 'studio-saffron-cipher' | 'studio-beacon-bay';

export const ELEMENT_SYMBOL_NAMES: Record<ElementSlotGame, readonly string[]> = {
  'studio-stormforge-duel': [translateText('Искра'), translateText('Ледяной клинок'), translateText('Грозовой кристалл'), translateText('WILD: наковальня стихий'), translateText('SCATTER: врата кузницы'), translateText('Щит')],
  'studio-saffron-cipher': [translateText('Лазурная печать'), translateText('Шафрановое перо'), translateText('Алый свиток'), translateText('WILD: золотой ключ'), translateText('SCATTER: тайная арка'), translateText('Чернильница')],
  'studio-beacon-bay': [translateText('Волна'), translateText('Жемчужная раковина'), translateText('Компас'), translateText('WILD: маяк'), translateText('SCATTER: штурвал'), translateText('Парус')],
};

const forge = [
  '<path d="M50 8 75 33 68 68 50 88 30 67 25 35Z" fill="#d86431" stroke="#ffd27a" stroke-width="3"/><path d="M51 20 57 43 70 49 55 72 44 64 38 47Z" fill="#ffe292"/><path d="M50 29 51 47 59 49 50 64 45 54Z" fill="#fff4c3"/>',
  '<path d="M70 11 78 18 44 64 32 53Z" fill="#a8edff" stroke="#dffaff" stroke-width="2"/><path d="M68 17 42 54" fill="none" stroke="#46a7c4" stroke-width="3"/><path d="M28 46 50 66 42 73 22 53Z" fill="#456579" stroke="#bde8f0" stroke-width="2"/><path d="M31 62 38 69 25 85 18 78Z" fill="#304855" stroke="#87b6c6" stroke-width="2"/>',
  '<path d="M49 9 75 30 76 64 51 89 25 67 23 33Z" fill="#514780" stroke="#c5b3ff" stroke-width="3"/><path d="M57 21 38 52 53 50 42 78 67 43 53 45Z" fill="#e9d5ff"/><path d="M24 34 47 43 75 30M26 66 47 59 75 65" fill="none" stroke="#8775b9" stroke-width="2"/>',
  '<path d="M19 31H79L72 42H62V54H32V42H19Z" fill="#a7bbca" stroke="#e6f5ff" stroke-width="2"/><path d="M35 54H59L66 72H28Z" fill="#59768c" stroke="#bbdae9" stroke-width="2"/><path d="M19 72H76V80H19Z" fill="#314f64"/><path d="M34 18 46 6 53 18 44 29Z" fill="#ffbf66"/><path d="M65 9 53 25 61 23 55 34 72 16 63 18Z" fill="#b6a5ff"/>',
  '<path d="M25 82V36Q25 12 50 12T75 36V82Z" fill="#202f45" stroke="#bb8d52" stroke-width="4"/><path d="M35 82V38Q35 23 50 23T65 38V82" fill="#45364f" stroke="#e4b876" stroke-width="3"/><path d="M38 39 51 28 62 43 54 67 43 59Z" fill="#ea9d57"/><path d="M22 83H79" stroke="#f0ca89" stroke-width="5"/>',
  '<path d="M50 13 77 24 73 61Q68 76 50 87 32 76 27 61L23 24Z" fill="#405163" stroke="#8296a7" stroke-width="3"/><path d="M50 26 64 32 61 58 50 73 39 58 36 32Z" fill="#223747" stroke="#60778b" stroke-width="2"/><path d="M50 29V68M38 46H63" stroke="#91acbf" stroke-width="3"/>',
];
const cipher = [
  '<circle cx="50" cy="48" r="33" fill="#28677b" stroke="#e6c887" stroke-width="4"/><circle cx="50" cy="48" r="23" fill="#144354" stroke="#71bfcd" stroke-width="2"/><path d="M50 28 64 48 50 68 36 48Z" fill="none" stroke="#b9e7ed" stroke-width="3"/><circle cx="50" cy="48" r="5" fill="#e9d49a"/>',
  '<path d="M73 13Q40 16 30 55L39 65Q71 57 73 13Z" fill="#e5b644" stroke="#ffe2a1" stroke-width="2"/><path d="M68 21 29 77" stroke="#916020" stroke-width="3"/><path d="M61 29 65 38M48 45 60 47M39 56 49 58" stroke="#fff0b0" stroke-width="2"/><path d="M28 78 19 87" stroke="#edca7f" stroke-width="3"/>',
  '<path d="M22 23Q26 14 35 22H72V70Q78 82 64 82H27Q20 76 23 69Z" fill="#df8b75" stroke="#f2c39e" stroke-width="2"/><path d="M27 24H66V69H29" fill="#a94d4a"/><path d="M33 35H56M33 45H58M33 55H48" stroke="#f5d5aa" stroke-width="3"/><circle cx="67" cy="73" r="7" fill="#e2b760"/>',
  '<circle cx="39" cy="35" r="19" fill="#d5a549" stroke="#ffe4a7" stroke-width="3"/><circle cx="39" cy="35" r="8" fill="#785728" stroke="#b78435" stroke-width="2"/><path d="M50 45 77 72 70 79 64 73 59 78 53 72 58 67 42 51Z" fill="#f0c76c" stroke="#ffe4a7" stroke-width="2"/>',
  '<path d="M24 84V33Q50 4 76 33V84Z" fill="#c99d62" stroke="#ffe2a4" stroke-width="3"/><path d="M34 84V37Q50 18 66 37V84" fill="#2b6a78" stroke="#78c0c8" stroke-width="3"/><path d="M42 48H58M50 39V62M41 67H59" stroke="#e6d29f" stroke-width="3"/><path d="M18 84H82" stroke="#f4d191" stroke-width="5"/>',
  '<path d="M31 35H69L74 71Q72 82 50 82T26 71Z" fill="#214755" stroke="#8facab" stroke-width="3"/><path d="M35 26H65V37H35Z" fill="#977448" stroke="#d4b78c" stroke-width="2"/><path d="M30 55Q50 64 70 55" fill="none" stroke="#638f96" stroke-width="3"/><circle cx="50" cy="63" r="7" fill="#142f40"/>',
];
const beacon = [
  '<path d="M17 58Q36 16 69 25 51 28 47 45 67 37 81 58 63 82 21 73Z" fill="#46bfc1" stroke="#bbf4e9" stroke-width="3"/><path d="M23 59Q40 40 54 51 45 63 36 66M18 73Q46 81 78 65" fill="none" stroke="#e1fff1" stroke-width="4"/>',
  '<path d="M15 66Q11 35 29 24 39 17 50 25 61 17 71 24 89 35 85 66L50 84Z" fill="#efc6a9" stroke="#fff0ce" stroke-width="3"/><path d="M50 78V32M47 74 29 31M53 74 71 31M40 72 19 46M60 72 81 46" stroke="#b78173" stroke-width="2"/><circle cx="50" cy="61" r="11" fill="#fff9e1" stroke="#dac7b5" stroke-width="2"/>',
  '<circle cx="50" cy="49" r="32" fill="#255b72" stroke="#eac779" stroke-width="4"/><circle cx="50" cy="49" r="24" fill="#0d3c58" stroke="#79b4bc" stroke-width="2"/><path d="M48 18H52V27M73 47H82M48 71H52V80M18 47H27" stroke="#dbd4a8" stroke-width="3"/><path d="M61 29 53 53 38 69 46 45Z" fill="#f8dfaa"/><path d="M61 29 53 53 46 45Z" fill="#dc967d"/>',
  '<path d="M38 77 43 36H58L64 77Z" fill="#e8e5ca" stroke="#fff8db" stroke-width="2"/><path d="M42 54H61L59 65H40Z" fill="#d58062"/><path d="M39 36V24H63V36Z" fill="#f2d48b" stroke="#fff5c8" stroke-width="2"/><path d="M34 24 51 10 68 24Z" fill="#bb6a50"/><path d="M45 27H57V34H45Z" fill="#fff9b6"/><path d="M31 78H73" stroke="#c7dcca" stroke-width="5"/>',
  '<circle cx="50" cy="49" r="26" fill="none" stroke="#ebc791" stroke-width="8"/><circle cx="50" cy="49" r="8" fill="#255d70" stroke="#fff0bd" stroke-width="3"/><path d="M50 9V40M50 58V89M10 49H41M59 49H90M22 21 43 42M58 57 78 77M22 77 42 57M58 42 78 21" stroke="#efddad" stroke-width="6" stroke-linecap="round"/>',
  '<path d="M49 14V71H22Z" fill="#d9e6d7" stroke="#a9cfc7" stroke-width="2"/><path d="M55 28V70H80Z" fill="#91b9bc" stroke="#c9e2d7" stroke-width="2"/><path d="M17 74H85L73 86H31Z" fill="#a06a51" stroke="#c7a580" stroke-width="2"/>',
];

export function elementSymbol(game: ElementSlotGame, symbol: number) {
  const art = game === 'studio-stormforge-duel' ? forge : game === 'studio-saffron-cipher' ? cipher : beacon;
  return `<svg class="element-symbol" viewBox="0 0 100 100" aria-hidden="true">${art[symbol] ?? art[0]}</svg>${symbol === 3 ? '<span class="element-symbol-label">WILD</span>' : symbol === 4 ? '<span class="element-symbol-label scatter-label">SCATTER</span>' : ''}`;
}
