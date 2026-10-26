const paths = [
  '<path d="M12 23l25-9 26 9 25-9v63l-25 9-26-9-25 9z"/><path d="M37 14v63m26-54v63M22 43l9 12m-9 0l9-12m15 8l9 5 16-17"/>',
  '<circle cx="50" cy="50" r="35"/><circle cx="50" cy="50" r="27"/><path d="M50 20v9m30 21h-9M50 80v-9M20 50h9M62 34L53 59 38 67l9-26z"/>',
  '<path d="M12 34h59l13 10-8 13H48L35 85H19l10-34H12z"/><path d="M22 34v-9h42v9M47 57l-5 12H31M73 44h13"/>',
  '<path d="M76 12c1 32-15 47-39 54L25 54C54 43 64 28 76 12z"/><path d="M19 49l25 25M30 61L15 81m-6-6l12 12"/>',
  '<path d="M28 18h44l19 27-41 42L9 45z"/><path d="M9 45h82M28 18l-6 27 28 42 28-42-6-27M28 18l22 27 22-27"/>',
  '<path d="M31 78c2-20-10-27-10-41 0-17 16-27 31-23 12 3 19 13 17 25-2 8-8 10-12 13l6 26z"/><path d="M59 20c20-1 26 11 18 25l-14-9M31 61L18 91l26-17m1-47h1M27 51l25-5"/>',
];
export function caribbeanIcon(symbol: number) {
  return '<svg viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' + (paths[symbol] ?? paths[0]) + '</svg>';
}
