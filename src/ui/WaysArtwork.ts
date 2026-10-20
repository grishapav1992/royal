import { t as translateText } from '../i18n/index';
export type WaysSlotGame = 'studio-sky-lanterns' | 'studio-rivet-rally' | 'studio-frostline-courier';
export const WAYS_SYMBOL_NAMES: Record<WaysSlotGame, readonly string[]> = {
  'studio-sky-lanterns': [translateText('Праздничный фонарь'), translateText('Золотой веер'), translateText('Ночная птица'), translateText('WILD: золотая луна'), translateText('Бонус: небесные врата'), translateText('Облако')],
  'studio-rivet-rally': [translateText('Медная шестерня'), translateText('Гоночный флажок'), translateText('Светящийся болт'), translateText('WILD: механический гонщик'), translateText('Сигнальная лампа'), translateText('Трасса')],
  'studio-frostline-courier': [translateText('Тёплая посылка'), translateText('Снежная сова'), translateText('Почтовая печать'), translateText('WILD: северная звезда'), translateText('Тайная коробка'), translateText('Бонус: доставка')],
};
const sky = [
  '<path d="M42 12H58V20H42Z" fill="#f7cc77"/><ellipse cx="50" cy="50" rx="29" ry="33" fill="#e76858" stroke="#ffe3a0" stroke-width="3"/><path d="M36 23Q26 50 36 78M50 20V82M64 23Q74 50 64 78" fill="none" stroke="#bd4245" stroke-width="3"/><path d="M28 30H72M28 69H72M40 85H60M50 86V96" stroke="#fbd486" stroke-width="4"/><path d="M47 13Q38 0 32 10" fill="none" stroke="#edcfa1" stroke-width="3"/>',
  '<path d="M12 38Q47 10 88 36L50 83Z" fill="#e3bc66" stroke="#fff0bb" stroke-width="3"/><path d="M17 37 50 81M32 29 50 81M48 24 50 81M64 27 50 81M80 34 50 81" stroke="#b57748" stroke-width="2"/><path d="M25 37Q50 25 76 36" fill="none" stroke="#dc6b65" stroke-width="4"/><circle cx="50" cy="84" r="4" fill="#ffe8a4"/>',
  '<path d="M17 39Q44 55 67 27 70 15 79 20L91 29 77 30Q79 67 50 75 30 77 17 62L5 69 13 49Z" fill="#97d9df" stroke="#d9f8ea" stroke-width="2"/><path d="M31 48Q50 68 70 41 48 48 31 48Z" fill="#477fbb"/><path d="M44 76 32 91M58 73 52 91" stroke="#e9c08b" stroke-width="3"/><circle cx="76" cy="24" r="2.5" fill="#203960"/>',
  '<circle cx="50" cy="49" r="32" fill="#f3cb78" stroke="#fff2b6" stroke-width="3"/><path d="M65 21Q42 46 64 75 30 78 22 51 21 29 43 19Z" fill="#d49656"/><path d="M47 36 50 44 59 45 52 51 55 60 47 55 39 61 41 51 34 45 43 43Z" fill="#fff4c3"/><circle cx="74" cy="14" r="3" fill="#fff0c6"/><circle cx="20" cy="80" r="2" fill="#d6f1e7"/>',
  '<path d="M18 25H82V34H18Z" fill="#c25e54" stroke="#f4d5a0" stroke-width="3"/><path d="M28 34V83M72 34V83M20 46H80" stroke="#e9b56c" stroke-width="7"/><path d="M20 21 50 11 80 21" fill="none" stroke="#e9b56c" stroke-width="5"/><path d="M37 60Q50 47 63 60V83H37Z" fill="#254369"/><path d="M23 87H78" stroke="#9bd5d5" stroke-width="4"/>',
  '<path d="M22 68Q6 60 18 47 20 29 38 35 49 16 67 33 85 31 89 50 100 63 82 70Z" fill="#afd9dc" stroke="#def6df" stroke-width="3"/><path d="M24 60Q35 51 42 59M54 42Q65 35 72 45" fill="none" stroke="#78a9c3" stroke-width="3"/>',
];
const rivet = [
  '<path d="M43 9H57L61 22 73 26 85 21 94 34 84 45V58L93 68 85 81 73 76 61 81 57 94H43L39 81 27 77 15 82 6 68 16 58V45L7 34 15 21 27 26 39 22Z" fill="#bf8054" stroke="#ffdcb0" stroke-width="3"/><circle cx="50" cy="51" r="24" fill="#3b494c" stroke="#f4ba74" stroke-width="3"/><circle cx="50" cy="51" r="11" fill="#dfb479"/>',
  '<path d="M29 15V88" stroke="#e9c38c" stroke-width="5"/><path d="M32 18Q54 3 78 21V58Q55 39 32 56Z" fill="#f9e0b9" stroke="#cc9562" stroke-width="2"/><path d="M32 20H45V34H32M58 18H72V33H58M45 33H58V48H45M72 34H78V53H72" fill="#335864"/>',
  '<path d="M51 9 28 45 43 46 30 89 78 39 57 40 71 9Z" fill="#7ccdd0" stroke="#c6ffed" stroke-width="3"/><path d="M47 35 59 19M44 68 59 49" stroke="#3d8495" stroke-width="3"/>',
  '<path d="M23 43Q23 12 52 12 82 13 82 43V59H23Z" fill="#b8784c" stroke="#f9d79e" stroke-width="3"/><path d="M24 42H82L76 60H29Z" fill="#355f6d" stroke="#89ddd9" stroke-width="3"/><path d="M33 46H49V55H33M56 46H72V55H56" fill="#b5e6d8"/><path d="M33 65Q50 78 71 65L65 86H39Z" fill="#e3b97c"/><path d="M43 15V36M61 15V36" stroke="#e5b876" stroke-width="3"/>',
  '<path d="M26 27H74V73H26Z" fill="#355860" stroke="#e4b077" stroke-width="4"/><circle cx="50" cy="50" r="18" fill="#f4b75b" stroke="#ffdf9a" stroke-width="3"/><path d="M18 14 28 24M80 14 70 24M18 86 28 76M81 85 71 75" stroke="#96d1c8" stroke-width="4"/><path d="M34 17H65M34 83H65" stroke="#dca16b" stroke-width="5"/>',
  '<path d="M25 10H74L89 92H10Z" fill="#34444a" stroke="#8caaab" stroke-width="3"/><path d="M50 18V32M50 44V57M50 69V85" stroke="#f9d18b" stroke-width="5"/><path d="M20 76H82M16 88H87" stroke="#ca9a69" stroke-width="4"/>',
];
const frost = [
  '<path d="M20 26H79V78H20Z" fill="#bd786a" stroke="#ffe0b1" stroke-width="3"/><path d="M46 26H57V78H46Z" fill="#f2c87e"/><path d="M20 44H79" stroke="#e7b87d" stroke-width="8"/><path d="M50 26Q20 21 30 10 42 8 50 26 64 6 73 14 83 25 50 26Z" fill="#ecc48b" stroke="#fff0cc" stroke-width="2"/>',
  '<path d="M25 28 19 11 42 21 58 21 80 11 74 28Q89 78 52 87 17 79 25 28Z" fill="#d0e5df" stroke="#f3f5dd" stroke-width="3"/><path d="M29 40Q38 30 46 41L52 56 58 41Q68 31 77 42" fill="none" stroke="#85b8c9" stroke-width="5"/><circle cx="39" cy="44" r="5" fill="#355973"/><circle cx="66" cy="44" r="5" fill="#355973"/><path d="M48 51H58L52 60Z" fill="#c58d62"/><path d="M24 63 12 75M77 63 88 75" stroke="#f0dec0" stroke-width="5"/>',
  '<path d="M24 18H77V80H24Z" fill="#d4aa74" stroke="#ffdfaa" stroke-width="3" stroke-dasharray="4 2"/><path d="M31 26H70V68H31Z" fill="#406f85"/><path d="M52 33 56 44 68 48 58 55 60 65 51 59 41 65 43 53 34 47 46 43Z" fill="#ddebdc"/>',
  '<path d="M50 8 59 33 88 21 70 46 93 58 63 61 65 91 49 69 27 91 32 61 6 56 30 43 14 21 41 33Z" fill="#b9ede6" stroke="#f4fff1" stroke-width="3"/><circle cx="50" cy="50" r="10" fill="#f9d298"/><path d="M50 8V32M7 56 33 52M65 91 56 67" stroke="#72bbc9" stroke-width="2"/>',
  '<path d="M19 28 51 15 82 28V75L50 88 19 75Z" fill="#4c8da6" stroke="#bfece6" stroke-width="3"/><path d="M19 28 50 43 82 28M50 43V87" fill="none" stroke="#e0f6ea" stroke-width="3"/><path d="M39 34Q39 23 49 23 63 23 61 32 60 38 50 41V47" fill="none" stroke="#ffda99" stroke-width="4"/><circle cx="50" cy="53" r="2.5" fill="#ffda99"/>',
  '<path d="M16 27H83V76H16Z" fill="#dfcfb0" stroke="#fff2d3" stroke-width="3"/><path d="M17 28 50 54 83 28M18 75 38 52M81 75 62 52" fill="none" stroke="#a98c71" stroke-width="3"/><circle cx="68" cy="66" r="17" fill="#3e889a" stroke="#a2e5db" stroke-width="3"/><path d="M58 67 65 73 79 59" fill="none" stroke="#e6f5d9" stroke-width="4"/>',
];
export function waysSymbol(game: WaysSlotGame, symbol: number) {
  const art = game === 'studio-sky-lanterns' ? sky : game === 'studio-rivet-rally' ? rivet : frost;
  const label = symbol === 3 ? 'WILD' : game === 'studio-sky-lanterns' && symbol === 4 ? translateText('БОНУС') : game === 'studio-frostline-courier' && symbol === 4 ? translateText('ТАЙНА') : game === 'studio-frostline-courier' && symbol === 5 ? translateText('ДОСТАВКА') : game === 'studio-rivet-rally' && symbol === 4 ? translateText('СИГНАЛ') : '';
  return `<svg class="ways-symbol" viewBox="0 0 100 100" aria-hidden="true">${art[symbol] ?? art[0]}</svg>${label ? `<span class="ways-symbol-label">${label}</span>` : ''}`;
}
