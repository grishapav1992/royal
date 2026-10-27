import {PENALTY_GAME} from './crLeo';
import {CARIBBEAN_GAME} from './caribbeanTreasures';
import {STUDIO_GAMES, type StudioGameId} from './studioGames';
import {VARIANT_GAMES} from './casinoVariants';
import {isCardGame} from './cardTables';

export const ACTIVE_STUDIO_GAMES = [
  'studio-cosmic-escape', 'studio-caramel-carnival',
  'studio-velvet-reign', 'studio-last-convoy', 'studio-nitro-run', 'studio-afterglow', 'studio-meme-overload', 'studio-dracona', 'studio-neopolis',
] as const satisfies readonly StudioGameId[];

export const ARCADE_CLASSIC_GAMES = [
  'royal-fruits', 'royal-dice', 'royal-limbo', 'royal-mines', 'royal-plinko',
  'royal-keno', 'github-craps', 'github-tower', 'github-diamonds', 'github-crash', 'github-sic-bo', PENALTY_GAME,
] as const;
export const ARCADE_PROVIDER_GAMES = [] as const;
// Preserved for mathematical provenance and old saved rounds, never a live collection.
export const ARCHIVED_GITHUB_GAMES = ARCADE_CLASSIC_GAMES.filter(id => !['royal-plinko', 'github-crash', PENALTY_GAME].includes(id));
// Historical game definitions remain available to validate and finish saved rounds.
export const RETIRED_ARCADE_GAMES: readonly string[] = [
  ...VARIANT_GAMES.filter(id => !isCardGame(id)),
  ...STUDIO_GAMES.filter(id => !(ACTIVE_STUDIO_GAMES as readonly string[]).includes(id)),
  ...ARCHIVED_GITHUB_GAMES,
];
const retired = new Set<unknown>(RETIRED_ARCADE_GAMES);
export const isRetiredArcadeGame = (id: unknown): boolean => retired.has(id);

// LAST EXIT keeps the historical Crash ID, but belongs with the house games.
export const ARCADE_HOUSE_GAMES = [...ACTIVE_STUDIO_GAMES, 'github-crash', 'royal-plinko', PENALTY_GAME] as const;
export const ARCADE_GITHUB_GAMES: readonly string[] = [];

export type CabinetCollection = 'royal' | 'github' | 'casinoapipro';
export type ArcadeCabinetSpec = {id:string; collection:CabinetCollection | 'luelon'; defaultGameId?:string; x:number; y:number};

// Physical seats and game identities are independent. Each seat exposes one collection.
export const ARCADE_CABINET_SPECS: readonly ArcadeCabinetSpec[] = [
  ...ARCADE_HOUSE_GAMES.map((id,index) => ({id,collection:'royal' as const,defaultGameId:id,x:1200+index%4*165,y:430+Math.floor(index/4)*270})),
];
export const ACTIVE_ARCADE_GAMES: readonly string[] = ARCADE_CABINET_SPECS.map(c=>c.id);
export const ROYAL_CABINET_IDS = ARCADE_CABINET_SPECS.filter(c=>c.collection==='royal').map(c=>c.id);
export const ARCADE_CABINET_POSITIONS: Readonly<Record<string,{x:number;y:number}>> = Object.fromEntries(ARCADE_CABINET_SPECS.map(c=>[c.id,{x:c.x,y:c.y}]));
export const STUDIO_CABINET_GAMES = ACTIVE_STUDIO_GAMES;
export const ROYAL_PLATFORM_GAMES: readonly string[] = [...ARCADE_HOUSE_GAMES, CARIBBEAN_GAME, 'studio-flooded-temple'];
export const ROYAL_COLLECTION_GAMES = ROYAL_PLATFORM_GAMES;
export const PLATFORM_CABINET_DEFAULTS: Readonly<Record<string,string>> = Object.freeze(Object.fromEntries(ARCADE_CABINET_SPECS.filter(c=>c.defaultGameId).map(c=>[c.id,c.defaultGameId!])));
export const isPlatformGame=(id:string):boolean=>ROYAL_PLATFORM_GAMES.includes(id);
export const collectionGames=(collection:CabinetCollection):readonly string[] => collection==='royal'?ROYAL_COLLECTION_GAMES:collection==='github'?ARCADE_GITHUB_GAMES:[];
export const isCollectionGame=(collection:CabinetCollection,id:string):boolean=>collectionGames(collection).includes(id);
