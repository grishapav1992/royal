export type PresentedSlotGame = 'studio-cosmic-escape' | 'studio-velvet-reign';
export const SLOT_SYMBOL_NAMES: Record<PresentedSlotGame, string[]> = {
  'studio-cosmic-escape': ['Звёздный кристалл', 'Спутник', 'Комета', 'WILD-портал', 'Бонусная ракета', 'Звёздная монета'],
  'studio-velvet-reign': ['Рубин', 'Бокал', 'Театральная маска', 'WILD-корона', 'Бонусный билет', 'Золотая монета'],
};

/** Original symbols with stable numeric IDs matching the native server slot. */
export function slotSymbol(game: PresentedSlotGame, symbol: number): string {
  const cosmic = [
    '<path fill="#137697" d="m20 26 11-15h34l11 15-28 50Z"/><path fill="#66eaff" d="m31 11 17 15H20Z"/><path fill="#b6f5ff" d="m31 11 17 15 17-15Z"/><path fill="#53bfff" d="m48 26 28 0-28 50Z"/><path fill="#165acd" d="m20 26 28 50V26Z"/><path d="M20 26h56M31 11l17 65 17-65" fill="none"/>',
    '<path fill="#265a88" d="m13 29 12-7 11 19-12 7Z"/><path fill="#75dbff" d="m10 33 12-7 11 19-12 7Z"/><path fill="#b9ebff" d="m59 47 12-7 13 22-12 7Z"/><path fill="#61acdc" d="m62 43 12-7 13 22-12 7Z"/><path fill="#d5e6fa" d="m28 31 25-14 21 35-25 15Z"/><path fill="#6db2eb" d="m53 17 21 35-10 8-22-36Z"/><circle cx="50" cy="40" r="10" fill="#153e83"/><circle cx="48" cy="37" r="5" fill="#8af6ff"/><path d="m39 22-7-10m0 0-9 5" fill="none"/>',
    '<path fill="#7574e3" d="m15 70 23-51 7 28 33-6Z"/><path fill="#ab9bf5" d="m16 70 23-51 1 34Z"/><circle cx="63" cy="26" r="19" fill="#c398fa"/><circle cx="65" cy="22" r="13" fill="#f8dcff"/><path d="m19 57 12-22m-1 33 11-16" fill="none"/><path fill="#f6e3ff" d="m24 11 3 5 6 1-5 4 1 6-5-3-5 3 1-6-5-4 6-1Z"/>',
    '<ellipse cx="48" cy="43" rx="28" ry="33" fill="#292777"/><ellipse cx="48" cy="43" rx="21" ry="28" fill="#77eff4"/><ellipse cx="48" cy="43" rx="16" ry="23" fill="#202c62"/><path fill="#f3e6b3" d="m48 22 7 14 15 3-11 10 3 17-14-8-14 8 3-17-11-10 15-3Z"/><path d="M14 24v10m-5-5h10m63 23v10m-5-5h10" fill="none"/>',
    '<path fill="#9266ce" d="m28 49-10 19 17-5m32-14 10 19-17-5"/><path fill="#f3e6fc" d="M35 60c-11-17-8-39 13-51 21 12 24 34 13 51Z"/><path fill="#8178d7" d="M48 9c18 13 22 34 13 51H48Z"/><circle cx="47" cy="33" r="10" fill="#3fbad9"/><circle cx="47" cy="32" r="6" fill="#7df3ff"/><path fill="#ffd19c" d="m38 65 10 17 10-17Z"/>',
    '<circle cx="48" cy="44" r="29" fill="#aa7124"/><circle cx="48" cy="41" r="29" fill="#ffd685"/><circle cx="48" cy="41" r="23" fill="#dc9c43"/><path fill="#fff0bf" d="m48 23 5 11 12 2-9 8 2 13-10-6-10 6 2-13-9-8 12-2Z"/>',
  ];
  const velvet = [
    '<path fill="#761734" d="m21 28 15-15h25l15 15-28 47Z"/><path fill="#ff7694" d="m36 13 12 15H21Z"/><path fill="#ffe0da" d="m36 13 12 15 13-15Z"/><path fill="#ed315a" d="m48 28 28 0-28 47Z"/><path fill="#b22b58" d="m21 28 27 47V28Z"/><path d="M21 28h55m-40-15 12 62 13-62" fill="none"/>',
    '<path fill="#eed6a1" d="M28 17h40l-4 26c-2 15-30 15-32 0Z"/><path fill="#891944" d="M31 29h34l-3 15c-2 11-26 11-28 0Z"/><path fill="#f8e9c7" d="M43 56h10v16h14v5H29v-5h14Z"/><path d="M36 20h6m-6 9 2 10" fill="none" stroke="#fff6e1"/>',
    '<path fill="#f0c16d" d="M16 23c20 13 40 13 64 0v24c-2 37-61 37-64 0Z"/><path fill="#b67933" d="M48 31c12 0 22-2 32-8v24c-1 21-17 33-32 34Z"/><path fill="#342037" d="m26 37 16 5c-3 10-18 8-16-5m28 5 16-5c2 13-13 15-16 5"/><path fill="#fff0bb" d="M34 60c10 7 19 7 29-2-5 14-22 15-29 2"/>',
    '<path fill="#bb813a" d="m16 26 12 37h40l12-37-18 13-14-25-14 25Z"/><path fill="#ffd68b" d="m16 26 12 30h40l12-30-18 13-14-25-14 25Z"/><path fill="#e9ac55" d="M29 63h38v8H29Z"/><circle cx="48" cy="47" r="6" fill="#cf2f68"/><circle cx="16" cy="23" r="4" fill="#ffe6ab"/><circle cx="48" cy="11" r="4" fill="#ffe6ab"/><circle cx="80" cy="23" r="4" fill="#ffe6ab"/>',
    '<path fill="#b57935" d="M19 19h58v17c-12 0-12 16 0 16v18H19V52c12 0 12-16 0-16Z"/><path fill="#f8d88f" d="M23 16h50v17c-12 0-12 16 0 16v18H23V49c12 0 12-16 0-16Z"/><path fill="#9d2f61" d="m48 26 5 10 11 2-8 8 2 12-10-6-10 6 2-12-8-8 11-2Z"/>',
    '<circle cx="48" cy="45" r="30" fill="#a46928"/><circle cx="48" cy="41" r="30" fill="#f9d796"/><circle cx="48" cy="41" r="23" fill="#c58c43"/><path fill="#fff0c0" d="m34 34 8 7 6-12 6 12 8-7-4 21H38Zm4 23h20v4H38Z"/>',
  ];
  return `<svg class="slot-symbol symbol-${symbol}" viewBox="0 0 96 88" aria-hidden="true"><g stroke="${game === 'studio-cosmic-escape' ? '#b6efff' : '#e8bf80'}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${(game === 'studio-cosmic-escape' ? cosmic : velvet)[symbol] ?? cosmic[0]}</g></svg>${symbol === 3 ? '<span class="slot-symbol-label">WILD</span>' : symbol === 4 ? '<span class="slot-symbol-label scatter-label">БОНУС</span>' : ''}`;
}
