import {PENALTY_GAME} from './crLeo';
import {STUDIO_GAMES, type StudioGameId} from './studioGames';
import {VARIANT_GAMES} from './casinoVariants';
import {isCardGame} from './cardTables';

export const ACTIVE_STUDIO_GAMES = [
  'studio-cosmic-escape', 'studio-caramel-carnival',
  'studio-velvet-reign', 'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload', 'studio-dracona',
] as const satisfies readonly StudioGameId[];

export const ARCADE_CLASSIC_GAMES = [
  'royal-fruits', 'royal-dice', 'royal-limbo', 'royal-mines', 'royal-plinko',
  'royal-keno', 'github-craps', 'github-tower', 'github-diamonds', 'github-crash', 'github-sic-bo', PENALTY_GAME,
] as const;
// Provider demos use their own credits and are hidden in the single Nile wallet release.
export const ARCADE_PROVIDER_GAMES = [] as const;
export const ACTIVE_ARCADE_GAMES: readonly string[] = [
  ...ACTIVE_STUDIO_GAMES, ...ARCADE_CLASSIC_GAMES,
];

// Historical game definitions remain available to validate and finish saved rounds.
export const RETIRED_ARCADE_GAMES: readonly string[] = [
  ...VARIANT_GAMES.filter(id => !isCardGame(id)),
];
const retired = new Set<unknown>(RETIRED_ARCADE_GAMES);
export const isRetiredArcadeGame = (id: unknown): boolean => retired.has(id);

// LAST EXIT keeps the historical Crash ID, but belongs with the house games.
export const ARCADE_HOUSE_GAMES = [...ACTIVE_STUDIO_GAMES.filter(id => id !== 'studio-dracona'), 'github-crash', 'royal-plinko', PENALTY_GAME, 'studio-dracona'] as const;
export const ARCADE_GITHUB_GAMES = ARCADE_CLASSIC_GAMES.filter(id => !(ARCADE_HOUSE_GAMES as readonly string[]).includes(id));

export const ARCADE_CABINET_POSITIONS: Readonly<Record<string, {x:number;y:number}>> = {
  luelon: {x:2045, y:430}, casinoapipro: {x:2415, y:430},
  ...Object.fromEntries(ARCADE_HOUSE_GAMES.map((id,index) => [id, {x:1200+index%5*135, y:430+Math.floor(index/5)*270}])),
  ...Object.fromEntries(ARCADE_GITHUB_GAMES.map((id,index) => [id, {x:1950+index%5*140, y:760+Math.floor(index/5)*250}])),
};

// A cabinet's seat is independent from the module selected in its catalogue.
export const STUDIO_CABINET_GAMES = ACTIVE_STUDIO_GAMES;
// Neopolis is an unpublished prototype retained in source and module builds.
export const ROYAL_PLATFORM_GAMES: readonly string[] = [...STUDIO_GAMES.filter(id=>id!=='studio-neopolis'), ...ARCADE_CLASSIC_GAMES];
export const PLATFORM_CABINET_DEFAULTS: Readonly<Record<string,string>> = Object.freeze(Object.fromEntries(ACTIVE_ARCADE_GAMES.map(id=>[id,id])));
export const isPlatformGame=(id:string):boolean=>ROYAL_PLATFORM_GAMES.includes(id);
