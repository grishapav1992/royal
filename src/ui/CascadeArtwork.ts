export type CascadeGame = 'studio-caramel-carnival' | 'studio-starfall-oracle';
export const CASCADE_NAMES: Record<CascadeGame, string[]> = {
  'studio-caramel-carnival': ['Вишнёвое желе', 'Лимонный леденец', 'Виноградная конфета', 'Символ', 'Символ', 'Карамельная монета'],
  'studio-starfall-oracle': ['Звезда', 'Луна', 'Ночной кристалл', 'Символ', 'Символ', 'Сфера'],
};

/** Original glossy symbols. IDs and paid groups retain the existing server rules. */
export function cascadeSymbol(game: CascadeGame, symbol: number): string {
  const candy = [
    '<path fill="#892552" d="M16 35c-7 16 1 41 20 41 12 0 20-7 20-21 0-23-28-34-40-20Z"/><path fill="#ff5080" d="M15 31c-5 16 2 35 19 35 10 0 19-5 19-19 0-21-25-30-38-16Z"/><path fill="#b7336f" d="M43 39c-3 15 5 35 20 35 16 0 25-13 23-26-2-19-27-26-43-9Z"/><path fill="#ff7995" d="M44 33c-4 14 4 32 20 32 13 0 22-11 20-25-2-15-25-24-40-7Z"/><path fill="#4aa866" d="m34 30 8-20 4 1-7 25Zm24 7-8-20 4-2 9 19Z"/><path fill="#84d884" d="M44 16c7-14 26-15 29-6-5 11-23 16-29 6Z"/><path d="M23 36c4-6 12-8 16-6m16 7c4-5 10-7 16-3" fill="none" stroke="#ffe2e8" stroke-width="5"/>',
    '<path fill="#e1a63d" d="M22 18c11-8 37-8 50 0 14 8 14 33 0 46-10 9-27 10-45 6-18-5-22-29-5-52Z"/><path fill="#ffe483" d="M22 15c11-8 37-8 50 0 14 8 14 31 0 43-10 9-27 10-45 6-18-5-22-27-5-49Z"/><path fill="#fff3ac" d="M34 22c8-6 24-6 32 0 6 5 6 20-2 25-8 8-17 9-29 4-12-5-11-22-1-29Z"/><path d="m32 22 4 29m20-33-6 38m20-29-41 9" fill="none" stroke="#f3bc50" stroke-width="3"/><path d="m44 67 5 13" fill="none" stroke="#f5d5b8" stroke-width="5"/>',
    '<path fill="#8b3bac" d="M17 21h62l8 22-8 22H17L9 43Z"/><path fill="#dc8cea" d="m9 43 9-20 9 20-9 21Zm78 0-9-20-9 20 9 21Z"/><path fill="#b766d0" d="M24 21h48l8 22-8 23H24l-8-23Z"/><path fill="#dc9aef" d="M28 23h40l7 19H21Z"/><path fill="#74328f" d="M28 62h40l7-19H21Z"/><circle cx="41" cy="34" r="8" fill="#efd7ff"/><circle cx="55" cy="34" r="8" fill="#efd7ff"/><circle cx="35" cy="47" r="8" fill="#e2b7f5"/><circle cx="49" cy="47" r="8" fill="#e2b7f5"/><circle cx="61" cy="47" r="8" fill="#e2b7f5"/><circle cx="48" cy="57" r="8" fill="#d79be9"/>',
    '', '',
    '<circle cx="48" cy="45" r="30" fill="#d39144"/><circle cx="48" cy="41" r="30" fill="#ffe2a3"/><circle cx="48" cy="41" r="22" fill="#eebd65"/><path fill="#fff1c0" d="M31 38c0-13 13-16 17-5 6-11 18-8 18 5 0 8-10 17-18 23-7-6-17-15-17-23Z"/><path d="M28 25c10-8 27-9 38-2" fill="none" stroke="#fff4d8" stroke-width="3"/>',
  ];
  const oracle = [
    '<path fill="#be7540" d="m48 9 11 24 26 4-20 18 5 27-22-13-23 13 5-27-20-18 27-4Z"/><path fill="#ffdf8f" d="m48 7 10 22 25 4-18 18 4 26-21-12-21 12 4-26-18-18 25-4Z"/><path fill="#fff6cc" d="m48 16 7 20 19 2-26 22-17 11 3-22-15-13 23-3Z"/><path fill="#eeb65a" d="m48 60 7-24 19 2-15 14 3 16Z"/>',
    '<path fill="#6055b4" d="M63 14c-39-5-54 41-25 61 24 17 53 0 53-24-19 15-42 5-42-12 0-10 5-18 14-25Z"/><path fill="#e8deff" d="M60 9c-38-5-53 40-26 59 23 15 50 0 52-23-20 14-41 4-41-11 0-10 7-19 15-25Z"/><path fill="#b3a1e8" d="M33 65C11 43 29 15 60 9 26 4 14 31 20 48c3 8 7 13 13 17Z"/><path d="M29 26c-8 8-9 17-6 26" fill="none" stroke="#fff5fc" stroke-width="4"/>',
    '<path fill="#385fae" d="m20 28 17-18h24l15 18-28 52Z"/><path fill="#75eaff" d="m37 10 11 18H20Z"/><path fill="#cef8ff" d="m37 10 11 18 13-18Z"/><path fill="#30accd" d="m20 28 28 52V28Z"/><path fill="#99eeff" d="m48 28 28 0-28 52Z"/><path fill="#4d93ed" d="m59 28-11 52 28-52Z"/><path d="M20 28h56m-39-18 11 70 13-70" fill="none" stroke="#d2feff" stroke-width="1.5"/>',
    '', '',
    '<circle cx="48" cy="44" r="31" fill="#573bc0"/><circle cx="48" cy="40" r="29" fill="#7b67e9"/><circle cx="48" cy="39" r="23" fill="#baa9ff"/><circle cx="48" cy="39" r="16" fill="#e5dcff"/><path fill="#fff0bf" d="m48 23 5 10 11 2-8 8 2 12-10-6-10 6 2-12-8-8 11-2Z"/><path d="M30 22c7-8 20-10 29-4" fill="none" stroke="#fff9ff" stroke-width="4"/><circle cx="70" cy="58" r="3" fill="#e9ddff"/>',
  ];
  return `<svg class="cascade-symbol symbol-${symbol}" viewBox="0 0 96 88" aria-hidden="true"><g stroke-linecap="round" stroke-linejoin="round">${(game === 'studio-caramel-carnival' ? candy : oracle)[symbol] || candy[5]}</g></svg>`;
}
