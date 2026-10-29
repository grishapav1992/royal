import type { ARCADE_HOUSE_GAMES } from '../shared/arcadeCatalog';

type HouseGameId = typeof ARCADE_HOUSE_GAMES[number];
type Rect = readonly [number, number, number, number];
type Layer = {url: string; source?: Rect; target: Rect};
type Artwork = {background: string; focus?: number; layers: readonly Layer[]};

// Reuse each game's own art. The roster also requires artwork for every house cabinet.
export const CABINET_ARTWORK: Record<HouseGameId, Artwork> = {
  'studio-forest-heart': { background: '/assets/forest-heart/v1/catalog.webp', layers: [] },
  'studio-neopolis': { background: '/assets/neopolis/cover-cabinet-v2.webp', layers: [] },
  'studio-dracona': {
    background: '/assets/dracona/manor.webp',
    layers: [{url:'/assets/dracona/hero-idle-a.png',source:[0,0,1024,1536],target:[8,1,30,42]}],
  },
  'studio-cosmic-escape': {
    background: '/assets/cosmic-guardians/v1/background.webp', focus: .7,
    layers: [{url:'/assets/cosmic-guardians/v1/alien.webp',source:[120,0,850,1000],target:[10,1,36,42]}],
  },
  'studio-caramel-carnival': {
    background: '/assets/caramel-rebuild/v1/background.webp', focus: .85,
    layers: [
      {url:'/assets/caramel-rebuild/v1/symbols.webp',source:[0,0,426,426],target:[-1,15,27,27]},
      {url:'/assets/caramel-rebuild/v1/symbols.webp',source:[426,0,426,426],target:[20,3,25,25]},
      {url:'/assets/caramel-rebuild/v1/symbols.webp',source:[853,0,427,426],target:[23,23,23,23]},
    ],
  },
  'studio-velvet-reign': {
    background: '/assets/velvet-rebuild/v1/background.webp',
    layers: [
      {url:'/assets/velvet-rebuild/v1/symbols.webp',source:[720,360,360,360],target:[13,6,35,35]},
      {url:'/assets/velvet-rebuild/v1/symbols.webp',source:[1080,0,360,360],target:[0,13,24,24]},
    ],
  },
  'studio-last-convoy': {
    background: '/assets/last-convoy/v1/background.webp', focus: .9,
    layers: [{url:'/assets/last-convoy/v1/heroine.webp',source:[200,0,600,900],target:[10,0,36,43]}],
  },
  'studio-nitro-run': {
    background: '/assets/nitro-run/v1/background.webp', focus: .9,
    layers: [{url:'/assets/nitro-run/v1/symbols.webp',source:[853,426,427,427],target:[1,13,45,30]}],
  },
  'studio-afterglow': {
    background: '/assets/afterglow/v1/background-studio-v3.webp',
    layers: [{url:'/assets/afterglow/v3/base-0.webp',source:[160,0,700,850],target:[9,11,33,36]}],
  },
  'studio-meme-overload': {
    background: '/assets/meme-overload/v1/desktop.svg',
    layers: [{url:'/assets/meme-overload/v1/doge.jpg',target:[7,7,32,32]}],
  },
  'github-crash': {
    background: '/assets/last-exit/v1/highway.webp',
    layers: [{url:'/assets/last-exit/v1/coupe.webp',target:[1,15,44,29]}],
  },
  'royal-plinko': {
    background: '/assets/arcane-plinko/world.png',
    layers: [{url:'/assets/arcane-plinko/hero.png',source:[80,0,900,1050],target:[7,0,39,44]}],
  },
  'original-jackie-chan': { background:'/assets/jackie-chan/restaurant.webp', layers:[{url:'/assets/jackie-chan/master.webp',source:[0,0,384,512],target:[9,1,31,43]}] },
  'original-cr-vs-leo': {
    background: '/assets/cr-vs-leo/v2/stadium.webp',
    layers: [
      {url:'/assets/cr-vs-leo/v2/cr-white.webp',source:[0,0,320,320],target:[1,10,25,31]},
      {url:'/assets/cr-vs-leo/v2/leo.webp',source:[0,0,320,320],target:[21,10,25,31]},
    ],
  },
};
