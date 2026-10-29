import {JACKIE_GAME} from './jackieChan';
import {CARIBBEAN_GAME} from './caribbeanTreasures';
import {FLAG_GAME} from './flagBattle';
import {FOREST_HEART_GAME} from './forestHeart';
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
export const ARCADE_PROVIDER_GAMES = [] as const;
// Historical game definitions remain available to validate and finish saved rounds.
export const RETIRED_ARCADE_GAMES: readonly string[] = [
  ...VARIANT_GAMES.filter(id => !isCardGame(id)),
];
const retired = new Set<unknown>(RETIRED_ARCADE_GAMES);
export const isRetiredArcadeGame = (id: unknown): boolean => retired.has(id);

// LAST EXIT keeps the historical Crash ID, but belongs with the house games.
export const ARCADE_HOUSE_GAMES = [...ACTIVE_STUDIO_GAMES.filter(id => id !== 'studio-dracona'), 'github-crash', 'royal-plinko', PENALTY_GAME, 'studio-dracona', FOREST_HEART_GAME, FLAG_GAME, JACKIE_GAME] as const;
export const ARCADE_GITHUB_GAMES = ARCADE_CLASSIC_GAMES.filter(id => !(ARCADE_HOUSE_GAMES as readonly string[]).includes(id));

export type CabinetCollection = 'royal' | 'github' | 'casinoapipro';
export type ArcadeCabinetSpec = {id:string; collection:CabinetCollection | 'luelon'; defaultGameId?:string; x:number; y:number};

// Physical seats and game identities are independent. Each seat exposes one collection.
export const ARCADE_CABINET_SPECS: readonly ArcadeCabinetSpec[] = [
  ...[...ACTIVE_STUDIO_GAMES.slice(0,9), 'github-crash'].map((id,index) => ({id,collection:'royal' as const,defaultGameId:id,x:1200+index%5*135,y:430+Math.floor(index/5)*270})),
  ...['royal-fruits','royal-dice','royal-limbo','royal-mines','github-tower'].map((id,index) => ({id,collection:'github' as const,defaultGameId:id,x:index<3?2005+index*220:2115+(index-3)*220,y:index<3?760:980})),
];
export const ACTIVE_ARCADE_GAMES: readonly string[] = ARCADE_CABINET_SPECS.map(c=>c.id);
export const ROYAL_CABINET_IDS = ARCADE_CABINET_SPECS.filter(c=>c.collection==='royal').map(c=>c.id);
export const ARCADE_CABINET_POSITIONS: Readonly<Record<string,{x:number;y:number}>> = Object.fromEntries(ARCADE_CABINET_SPECS.map(c=>[c.id,{x:c.x,y:c.y}]));
export const STUDIO_CABINET_GAMES = ACTIVE_STUDIO_GAMES;
export const ROYAL_PLATFORM_GAMES: readonly string[] = [...STUDIO_GAMES, ...ARCADE_CLASSIC_GAMES, FOREST_HEART_GAME, FLAG_GAME, CARIBBEAN_GAME, JACKIE_GAME];
export const ROYAL_COLLECTION_GAMES = ROYAL_PLATFORM_GAMES.filter(id=>!ARCADE_GITHUB_GAMES.includes(id as typeof ARCADE_GITHUB_GAMES[number]));
export const PLATFORM_CABINET_DEFAULTS: Readonly<Record<string,string>> = Object.freeze(Object.fromEntries(ARCADE_CABINET_SPECS.filter(c=>c.defaultGameId).map(c=>[c.id,c.defaultGameId!])));
export const isPlatformGame=(id:string):boolean=>ROYAL_PLATFORM_GAMES.includes(id);
export const collectionGames=(collection:CabinetCollection):readonly string[] => collection==='royal'?ROYAL_COLLECTION_GAMES:collection==='github'?ARCADE_GITHUB_GAMES:[];
export const isCollectionGame=(collection:CabinetCollection,id:string):boolean=>collectionGames(collection).includes(id);
