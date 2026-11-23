const glyphs = [
  '<path d="M15 44V30a17 17 0 0 1 34 0v14l-9 4H24z"/><path d="M20 33h24l-6 9H26z"/>',
  '<path d="m11 35 12 4 9-21 9 21 12-4-8 16H19z"/><circle cx="32" cy="12" r="4"/>',
  '<rect x="17" y="19" width="30" height="29" rx="9"/><path d="M32 19V9m-9 45h18"/><circle cx="25" cy="33" r="2"/><circle cx="39" cy="33" r="2"/>',
  '<circle cx="32" cy="32" r="17"/><path d="M18 25C4 30 4 40 20 44c17 5 43-8 31-14l-5-1"/>',
  '<path d="M28 40c-7 0-12 3-14 8l11 3m15-19c0 7-3 12-8 14l-3-11m-5-9Q34 13 54 10q-2 20-16 31L24 26Z"/><path d="m21 44-9 9"/><circle cx="41" cy="23" r="5"/>',
  '<path d="m32 8 16 18-4 20-12 10-12-10-4-20Z"/><path d="m32 8 6 19-6 29-6-29 6-19M16 26h32"/>',
  '<path d="M13 51c21 3 34-7 31-21C40 13 20 14 21 26c1 8 12 8 12 1M14 43c8 2 17-1 19-8"/><circle cx="18" cy="51" r="2"/><circle cx="29" cy="50" r="2"/>',
  '<path d="m8 40 17-8 8-17 6 18 17 7-16 4-7 10-7-10Z"/><path d="M33 27v14"/>',
  '<circle cx="32" cy="32" r="17"/><path d="M9 27a24 24 0 0 1 33-17m13 27a24 24 0 0 1-33 17M24 35l8-12 8 12"/>',
] as const;
export const cosmicSymbolNames = ['Капитан Астэр', 'Принцесса Вега', 'Робот Тин', 'Кольцевая планета', 'Красная ракета', 'Синий кристалл', 'Космическое щупальце', 'Корабль WILD', 'Портал'] as const;
export function cosmicGlyph(id: number) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyphs[id] ?? ''}</svg>`;
}

// Оригинальная условная иллюстрация комплекта, без ресурсов действующего модуля.
export const racerArtwork = `<svg viewBox="0 0 250 480" aria-hidden="true">
  <defs><linearGradient id="suit" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd69a"/><stop offset="1" stop-color="#a8573b"/></linearGradient></defs>
  <g stroke="#d79457" fill="none" opacity=".47"><circle cx="125" cy="164" r="91"/><path d="M19 164h212M125 60v206M59 98l132 132m0-132L59 230"/><path d="M15 369 239 330M15 393 239 354"/></g>
  <path fill="#423347" stroke="#c28963" stroke-width="3" d="M60 263q9-33 32-41l13-19h43l15 22q33 11 36 55l-17 61-6 111H81l-5-105-14-41z"/>
  <path fill="url(#suit)" d="M90 232 120 257l31-27 24 14-13 74 15 58H80l14-58-12-71z"/>
  <path fill="#2d2c41" stroke="#edb878" stroke-width="3" d="M69 166c4-45 31-77 59-74s52 26 55 68l-12 37-38 24-44-17z"/>
  <path fill="#17122b" stroke="#f4c58a" stroke-width="4" d="m77 152 19-15 66 2 17 16-7 23-22 13-52-1-14-11z"/>
  <path fill="#70e0d4" d="m87 155 62-10 16 4-18 8-53 10z" opacity=".87"/>
  <path fill="#f1bd73" d="M124 98h13l16 30-51-1zM93 198l39 16 40-22-8 15-31 19-31-11z"/>
  <path fill="none" stroke="#f0ce9b" stroke-width="4" d="m125 263-6 83m15-83 13 82m-64-39h30m31 0h30"/>
  <path fill="#17122b" stroke="#deab72" d="M108 277h42v21h-42z"/><circle cx="127" cy="287" r="4" fill="#68e1d2"/>
  <path fill="#1d192c" d="M55 442h145v20H55z"/><path stroke="#ac7955" stroke-width="3" d="M56 442h144"/>
</svg>`;
