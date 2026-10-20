import {STUDIO_GAMES, type StudioGameId} from './studioGames';
import {VARIANT_GAMES} from './casinoVariants';
import {isCardGame} from './cardTables';

export const ACTIVE_STUDIO_GAMES = [
  'studio-cosmic-escape', 'studio-caramel-carnival',
  'studio-velvet-reign', 'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload',
] as const satisfies readonly StudioGameId[];

export const ARCADE_CLASSIC_GAMES = [
  'royal-fruits', 'royal-dice', 'royal-limbo', 'royal-mines', 'royal-plinko',
  'royal-keno', 'github-craps', 'github-tower', 'github-diamonds', 'github-crash', 'github-sic-bo',
] as const;
export const ARCADE_PROVIDER_GAMES = ['casinoapipro', 'luelon'] as const;
export const ACTIVE_ARCADE_GAMES: readonly string[] = [
  ...ACTIVE_STUDIO_GAMES, ...ARCADE_CLASSIC_GAMES, ...ARCADE_PROVIDER_GAMES,
];

// Historical game definitions remain available to validate and finish saved rounds.
export const RETIRED_ARCADE_GAMES: readonly string[] = [
  ...STUDIO_GAMES.filter(id => !(ACTIVE_STUDIO_GAMES as readonly string[]).includes(id)),
  ...VARIANT_GAMES.filter(id => !isCardGame(id)),
];
const retired = new Set<unknown>(RETIRED_ARCADE_GAMES);
export const isRetiredArcadeGame = (id: unknown): boolean => retired.has(id);

export const ARCADE_CABINET_POSITIONS: Readonly<Record<string, {x:number;y:number}>> = {
  casinoapipro: {x:480, y:330}, luelon: {x:480, y:550},
  ...Object.fromEntries(ACTIVE_STUDIO_GAMES.map((id,index) => [id, {x:1200+index*220, y:330}])),
  ...Object.fromEntries(ARCADE_CLASSIC_GAMES.map((id,index) => [id, {x:1200+index%5*180, y:[550,820,1050][Math.floor(index/5)]}])),
};
