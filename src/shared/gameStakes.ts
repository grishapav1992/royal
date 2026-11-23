import { DRAGON_PATH_GAME } from './dragonPathProtocol.ts';

// Monetary values cross the game transport as integer cents.
export const GAME_STAKE_CENTS: readonly number[] = Object.freeze([10, 20, 50, 100, 200, 500, 1000, 2000, 5000]);
export const DEFAULT_MAX_GAME_STAKE_CENTS = 5000;
export const MAX_GAME_STAKE_CENTS = 10000;
export const ROYAL_STAKE_LIMIT_HEADER = 'X-Royal-Stake-Limit';
export const ROYAL_GAME_STAKE_CENTS: readonly number[] = Object.freeze([...GAME_STAKE_CENTS, MAX_GAME_STAKE_CENTS]);
export const ROYAL_GAME_STAKE_UNITS: readonly string[] = Object.freeze(ROYAL_GAME_STAKE_CENTS.map(String));
export const ROYAL_GAME_BETS: readonly number[] = Object.freeze(ROYAL_GAME_STAKE_CENTS.map(cents => cents / 100));
export const GAME_STAKE_UNITS: readonly string[] = Object.freeze(GAME_STAKE_CENTS.map(String));
export const GAME_BETS: readonly number[] = Object.freeze(GAME_STAKE_CENTS.map(cents => cents / 100));
export const DEFAULT_GAME_STAKE = '10';
export const DEFAULT_GAME_BET = 0.1;
export const MIN_GAME_STAKE_CENTS = 10;
/** Parse canonical transport money without multiplying a binary fraction. */
export function gameBetCents(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : undefined;
}
/** Player input accepts a dot or comma, with at most two decimal places. */
export function parseGameStake(value: string, maximumCents = MAX_GAME_STAKE_CENTS): string | undefined {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return cents >= BigInt(MIN_GAME_STAKE_CENTS) && cents <= BigInt(maximumCents) ? String(cents) : undefined;
}
// This policy does not register, publish or enable games.
const royalCasinoGames = new Set(['studio-cosmic-escape', 'studio-caramel-carnival', 'studio-velvet-reign',
  'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload',
  'studio-dracona', 'studio-neopolis', 'studio-forest-heart', 'github-crash', 'royal-plinko',
  'original-cr-vs-leo', 'original-jackie-chan', 'studio-caribbean-treasures', 'studio-flooded-temple',
  'royal-roulette', 'flag-battle', 'studio-wild-nudge', DRAGON_PATH_GAME]);
export const usesGameStakes = (game: string): boolean => royalCasinoGames.has(game) || game === 'tsu-e-fa';
export const gameStakeMaximum = (game: string): number =>
  royalCasinoGames.has(game) ? MAX_GAME_STAKE_CENTS : DEFAULT_MAX_GAME_STAKE_CENTS;
export const validGameStake = (value: unknown, maximumCents = MAX_GAME_STAKE_CENTS): value is string => typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value)
  && Number(value) >= MIN_GAME_STAKE_CENTS && Number(value) <= maximumCents;
export const validGameBet = (value: unknown, maximumCents = MAX_GAME_STAKE_CENTS): value is number => {
  const cents = gameBetCents(value);
  return cents !== undefined && cents >= MIN_GAME_STAKE_CENTS && cents <= maximumCents;
};
// Historical denominations remain valid for recovery of accepted rounds only.
export const recoverableStakes = (legacy: readonly string[]): readonly string[] => Object.freeze([...new Set([
  ...Array.from({length:MAX_GAME_STAKE_CENTS-MIN_GAME_STAKE_CENTS+1},(_,index)=>String(MIN_GAME_STAKE_CENTS+index)), ...legacy,
])].sort((a,b) => Number(a)-Number(b)));
export const recoverableBetAmounts = (legacy: readonly number[]): readonly number[] => Object.freeze([...new Set([...GAME_BETS, ...legacy])].sort((a,b) => a-b));
