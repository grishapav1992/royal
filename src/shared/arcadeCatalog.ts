import {STUDIO_GAMES, type StudioGameId} from './studioGames';
import {VARIANT_GAMES} from './casinoVariants';
import {isCardGame} from './cardTables';

export const STUDIO_CABINET_GAMES = [
  'studio-cosmic-escape', 'studio-caramel-carnival',
  'studio-velvet-reign', 'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload',
] as const satisfies readonly StudioGameId[];

// Every house cabinet can launch the complete copied collection.
export const ACTIVE_STUDIO_GAMES = STUDIO_GAMES;

export const ARCADE_CLASSIC_GAMES = [
  'royal-fruits', 'royal-dice', 'royal-limbo', 'royal-mines', 'royal-plinko',
  'royal-keno', 'github-craps', 'github-tower', 'github-diamonds', 'github-crash', 'github-sic-bo',
] as const;
export const ARCADE_PROVIDER_GAMES = ['casinoapipro', 'luelon'] as const;
export const ACTIVE_ARCADE_GAMES: readonly string[] = [
  ...STUDIO_CABINET_GAMES, ...ARCADE_CLASSIC_GAMES, ...ARCADE_PROVIDER_GAMES,
];

// Historical game definitions remain available to validate and finish saved rounds.
export const RETIRED_ARCADE_GAMES: readonly string[] = [
  ...VARIANT_GAMES.filter(id => !isCardGame(id)),
];
const retired = new Set<unknown>(RETIRED_ARCADE_GAMES);
export const isRetiredArcadeGame = (id: unknown): boolean => retired.has(id);

// LAST EXIT keeps the historical Crash ID, but belongs with the house games.
export const ARCADE_HOUSE_GAMES = [...STUDIO_CABINET_GAMES, 'github-crash'] as const;
export const ARCADE_GITHUB_GAMES = ARCADE_CLASSIC_GAMES.filter(id => id !== 'github-crash');

// Physical seat identities stay stable even when a cabinet opens another module.
export const ROYAL_PLATFORM_GAMES: readonly string[] = [...STUDIO_GAMES, ...ARCADE_CLASSIC_GAMES];
export const PLATFORM_CABINET_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries([...STUDIO_CABINET_GAMES, ...ARCADE_CLASSIC_GAMES].map(id => [id, id])),
  luelon: 'studio-orbit',
  casinoapipro: 'studio-jade-koi',
});
export const isPlatformGame = (id: string): boolean => id === 'casinoapipro' || ROYAL_PLATFORM_GAMES.includes(id);

export const ARCADE_CABINET_POSITIONS: Readonly<Record<string, {x:number;y:number}>> = {
  luelon: {x:2045, y:430}, casinoapipro: {x:2415, y:430},
  ...Object.fromEntries(ARCADE_HOUSE_GAMES.map((id,index) => [id, {x:1200+index%4*160, y:430+Math.floor(index/4)*270}])),
  ...Object.fromEntries(ARCADE_GITHUB_GAMES.map((id,index) => [id, {x:1950+index%5*140, y:760+Math.floor(index/5)*250}])),
};
