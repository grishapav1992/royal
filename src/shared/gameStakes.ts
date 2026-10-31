// Monetary values cross the game transport as integer cents.
export const GAME_STAKE_CENTS: readonly number[] = Object.freeze([10, 20, 50, 100, 200, 500, 1000, 2000, 5000]);
export const GAME_STAKE_UNITS: readonly string[] = Object.freeze(GAME_STAKE_CENTS.map(String));
export const GAME_BETS: readonly number[] = Object.freeze(GAME_STAKE_CENTS.map(cents => cents / 100));
export const DEFAULT_GAME_STAKE = '10';
export const DEFAULT_GAME_BET = 0.1;
// This policy does not register, publish or enable games.
const games = new Set(['studio-cosmic-escape', 'studio-caramel-carnival', 'studio-velvet-reign',
  'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload',
  'studio-dracona', 'studio-neopolis', 'studio-forest-heart', 'github-crash', 'royal-plinko',
  'original-cr-vs-leo', 'original-jackie-chan', 'studio-caribbean-treasures', 'studio-flooded-temple',
  'royal-roulette', 'flag-battle']);
export const usesGameStakes = (game: string): boolean => games.has(game);
export const validGameStake = (value: unknown): value is string => typeof value === 'string' && GAME_STAKE_UNITS.includes(value);
export const validGameBet = (value: unknown): value is number => typeof value === 'number' && GAME_BETS.includes(value);
// Historical denominations remain valid for recovery of accepted rounds only.
export const recoverableStakes = (legacy: readonly string[]): readonly string[] => Object.freeze([...new Set([...GAME_STAKE_UNITS, ...legacy])].sort((a,b) => Number(a)-Number(b)));
export const recoverableBetAmounts = (legacy: readonly number[]): readonly number[] => Object.freeze([...new Set([...GAME_BETS, ...legacy])].sort((a,b) => a-b));
