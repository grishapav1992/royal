import { t as translateText } from '../i18n/index';
export type JourneySlotGame = 'studio-copperline-express' | 'studio-pulse-district' | 'studio-jade-koi';
export const JOURNEY_SYMBOL_NAMES: Record<JourneySlotGame, readonly string[]> = {
  'studio-copperline-express': [translateText('Билет'), translateText('Карманные часы'), translateText('Фонарь'), translateText('WILD: локомотив'), translateText('SCATTER: станция'), translateText('Рельсы')],
  'studio-pulse-district': [translateText('Бирюзовое окно'), translateText('Неоновая вывеска'), translateText('Проездной'), translateText('WILD: ночной проводник'), translateText('SCATTER: площадь'), translateText('Антенна')],
  'studio-jade-koi': [translateText('Лотос'), translateText('Нефритовая монета'), translateText('Алый веер'), translateText('WILD: карп'), translateText('SCATTER: водяные врата'), translateText('Кувшинка')],
};

const copper = [
  '<path d="M18 26H82V39Q70 47 82 55V74H18V55Q30 47 18 39Z" fill="#bd8057" stroke="#f5d5a6" stroke-width="3"/><path d="M31 32V69" stroke="#704f3c" stroke-width="2" stroke-dasharray="4 4"/><path d="M42 39H69M42 48H64M42 58H71" stroke="#ffe6b8" stroke-width="3"/>',
  '<path d="M43 18V10H57V18M38 9H62" fill="none" stroke="#ead6a7" stroke-width="4"/><circle cx="50" cy="54" r="31" fill="#d3a667" stroke="#f6ddb0" stroke-width="4"/><circle cx="50" cy="54" r="23" fill="#293e42" stroke="#e9c785" stroke-width="2"/><path d="M50 37V55L65 65M50 29V34M50 74V79M26 54H31M69 54H75" fill="none" stroke="#f9e8c1" stroke-width="3"/>',
  '<path d="M38 25Q38 8 50 8T62 25" fill="none" stroke="#d3ae76" stroke-width="4"/><path d="M30 26H70L74 75H26Z" fill="#284342" stroke="#e2bd7e" stroke-width="3"/><path d="M38 37H62L65 65H35Z" fill="#ffd27b"/><path d="M50 37V64M35 50H65" stroke="#835b39" stroke-width="3"/><path d="M25 76H75V84H25Z" fill="#d5ae73"/>',
  '<path d="M27 44H68L75 67H23Z" fill="#28616b" stroke="#a8d7d1" stroke-width="3"/><path d="M48 25H72V58H48Z" fill="#b98450" stroke="#f4d2a0" stroke-width="3"/><path d="M54 31H65V43H54Z" fill="#263b40"/><path d="M25 35H39V51H25Z" fill="#daaa6b"/><path d="M18 68H80V75H18Z" fill="#a96044"/><circle cx="31" cy="77" r="8" fill="#263e45" stroke="#f4d6a3" stroke-width="3"/><circle cx="61" cy="77" r="8" fill="#263e45" stroke="#f4d6a3" stroke-width="3"/><path d="M25 24Q35 12 46 20" fill="none" stroke="#d8ddc5" stroke-width="6" stroke-linecap="round"/>',
  '<path d="M19 39 50 14 81 39Z" fill="#ba734b" stroke="#f1c58f" stroke-width="3"/><path d="M25 40H75V80H25Z" fill="#294c51" stroke="#d8b17b" stroke-width="3"/><path d="M42 54H58V80H42Z" fill="#e8cb98"/><path d="M31 49H37V61H31M63 49H69V61H63" fill="#92bcb6"/><path d="M16 83H84" stroke="#f0d39d" stroke-width="4"/>',
  '<path d="M37 14 18 87M63 14 82 87" stroke="#b8c1ad" stroke-width="6"/><path d="M30 30H70M25 48H75M21 66H79M16 84H84" stroke="#966748" stroke-width="8"/>',
];
const pulse = [
  '<path d="M23 16H77V83H23Z" fill="#204765" stroke="#6bc9d2" stroke-width="3"/><path d="M32 25H68V73H32Z" fill="#42aebd"/><path d="M50 25V73M32 48H68" stroke="#174158" stroke-width="5"/><path d="M35 28 65 66" stroke="#b2f2ef" stroke-width="2" opacity=".7"/>',
  '<path d="M16 32 77 21 84 69 24 81Z" fill="#372748" stroke="#e9b489" stroke-width="3"/><path d="M26 42 66 34M28 56 72 48M31 69 57 63" stroke="#e692b8" stroke-width="5" stroke-linecap="round"/><path d="M39 15V28M62 12V24" stroke="#78c7d3" stroke-width="3"/>',
  '<path d="M23 19H77V80H23Z" fill="#31819c" stroke="#a2e1e1" stroke-width="3"/><path d="M29 26H70V42H29Z" fill="#e9c7a0"/><circle cx="40" cy="59" r="9" fill="#d993ae"/><path d="M54 52H69M54 61H69M31 74H69" stroke="#d0ecdc" stroke-width="3"/>',
  '<path d="M31 25 50 15 69 25 65 34H35Z" fill="#b772a6" stroke="#edc8d9" stroke-width="2"/><circle cx="50" cy="43" r="12" fill="#edcbb0"/><path d="M30 78V61Q50 47 70 61V78Z" fill="#275d79" stroke="#91d4df" stroke-width="3"/><path d="M45 56H55V76H45Z" fill="#d39b61"/><path d="M64 57 81 70" stroke="#d6c6a6" stroke-width="5" stroke-linecap="round"/><circle cx="82" cy="72" r="6" fill="#f2dab5"/>',
  '<path d="M21 77V39L33 29 43 39V77M56 77V26L69 16 81 26V77" fill="#245e78" stroke="#7ccdd1" stroke-width="3"/><path d="M29 46H35M29 56H35M63 33H71M63 45H71M63 57H71" stroke="#f2be87" stroke-width="4"/><path d="M14 83H88" stroke="#daa3c4" stroke-width="4"/>',
  '<path d="M50 26V83M34 83H66M40 56H60" stroke="#76aebb" stroke-width="5"/><circle cx="50" cy="20" r="6" fill="#e7b69a"/><path d="M34 13Q21 23 34 34M66 13Q79 23 66 34" fill="none" stroke="#df9cbf" stroke-width="4" stroke-linecap="round"/>',
];
const jade = [
  '<path d="M50 79Q19 66 21 44 36 43 50 61 64 43 79 44 81 66 50 79Z" fill="#d9c6c2" stroke="#fff1d8" stroke-width="2"/><path d="M50 76Q30 48 50 17 70 48 50 76Z" fill="#efa4a3" stroke="#ffe5c8" stroke-width="2"/><path d="M50 80Q26 80 16 66 36 63 50 74 64 63 84 66 74 80 50 80Z" fill="#4a9a7e"/>',
  '<circle cx="50" cy="49" r="33" fill="#439c7b" stroke="#d4e5b1" stroke-width="4"/><circle cx="50" cy="49" r="24" fill="none" stroke="#8ccaaa" stroke-width="2"/><path d="M40 39H60V59H40Z" fill="#203f3d" stroke="#e4db9e" stroke-width="3"/><path d="M29 36 33 30M68 67 74 61" stroke="#deeca9" stroke-width="3"/>',
  '<path d="M12 34Q49 8 88 35L50 81Z" fill="#c26765" stroke="#f5d2a9" stroke-width="3"/><path d="M20 31 50 80M34 25 50 80M50 21V80M66 25 50 80M80 32 50 80" stroke="#f1b18c" stroke-width="2"/><path d="M50 79V89" stroke="#c9b18a" stroke-width="4"/>',
  '<path d="M69 24Q81 43 54 69 29 81 21 61 17 42 49 30Z" fill="#eac995" stroke="#fff0cc" stroke-width="2"/><path d="M57 31Q51 43 32 59" fill="none" stroke="#c67965" stroke-width="10"/><path d="M20 59 8 39 31 42M58 67 74 80 71 51" fill="#6cba9a" stroke="#d3e7b4" stroke-width="2"/><circle cx="65" cy="31" r="3" fill="#294f44"/><path d="M49 49Q66 45 67 59" fill="none" stroke="#e9b388" stroke-width="3"/>',
  '<path d="M22 22H78V32H22Z" fill="#a36f59" stroke="#ebc29b" stroke-width="3"/><path d="M29 30V81M71 30V81M20 44H80" stroke="#c7a477" stroke-width="7"/><path d="M36 68Q50 49 64 68" fill="none" stroke="#9bd7c2" stroke-width="3"/><path d="M19 86Q34 76 49 86T81 86" fill="none" stroke="#69b39e" stroke-width="4"/>',
  '<path d="M84 49Q77 23 44 22 15 24 15 52 18 81 53 79 78 75 84 49Z" fill="#357f69" stroke="#9fceb0" stroke-width="3"/><path d="M50 52 27 24M50 52 25 73M50 52 79 71" stroke="#6eaf8b" stroke-width="2"/><path d="M50 52 81 46 65 22Z" fill="#244c43"/>',
];

export function journeySymbol(game: JourneySlotGame, symbol: number) {
  const art = game === 'studio-copperline-express' ? copper : game === 'studio-pulse-district' ? pulse : jade;
  return `<svg class="journey-symbol" viewBox="0 0 100 100" aria-hidden="true">${art[symbol] ?? art[0]}</svg>${symbol === 3 ? '<span class="journey-symbol-label">WILD</span>' : symbol === 4 ? '<span class="journey-symbol-label scatter-label">SCATTER</span>' : ''}`;
}
