import type Phaser from 'phaser';
import type { Cabinet } from '../shared/cabinets';
import { ARCADE_HOUSE_GAMES, PLATFORM_CABINET_DEFAULTS } from '../shared/arcadeCatalog';
import { royalGameArtwork } from '../ui/RoyalGameArtwork';
import { cabinetScreen, paintGirlhubLogo } from './cabinetArt';

type HouseGameId = typeof ARCADE_HOUSE_GAMES[number];
type Rect = readonly [number, number, number, number];
type Layer = {url: string; source?: Rect; target: Rect};
type Artwork = {background: string; focus?: number; layers: readonly Layer[]};

// Reuse each game's own art. The roster also requires artwork for every house cabinet.
export const CABINET_ARTWORK: Record<HouseGameId, Artwork> = {
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
};

const textureKey = (url: string) => 'cabinet-art:' + url;
const artworkFor = (id: string): Artwork | undefined => {
  const gameId=PLATFORM_CABINET_DEFAULTS[id]??id;
  if(Object.hasOwn(CABINET_ARTWORK,gameId))return CABINET_ARTWORK[gameId as HouseGameId];
  const background=royalGameArtwork(gameId);
  return background ? {background,layers:[]} : undefined;
};

export function preloadCabinetArtwork(scene: Phaser.Scene) {
  const artwork=Object.keys(PLATFORM_CABINET_DEFAULTS).map(artworkFor).filter((art):art is Artwork=>!!art);
  const urls = new Set(artwork.flatMap(art => [art.background,...art.layers.map(layer=>layer.url)]));
  for(const url of urls)if(!scene.textures.exists(textureKey(url)))scene.load.image(textureKey(url),url);
}

export function cabinetArtworkReady(scene: Phaser.Scene, id: string): boolean {
  const art=artworkFor(id);
  return !!art && [art.background,...art.layers.map(layer=>layer.url)].every(url=>scene.textures.exists(textureKey(url)));
}

export function paintCabinetArtwork(scene: Phaser.Scene, context: CanvasRenderingContext2D, cabinet: Cabinet) {
  const art=artworkFor(cabinet.id);
  if(!art || !cabinetArtworkReady(scene,cabinet.id))return;
  const image=(url:string)=>scene.textures.get(textureKey(url)).getSourceImage() as HTMLImageElement;
  const screen=cabinetScreen(cabinet),background=image(art.background);
  context.save();
  context.beginPath();context.rect(screen.x,screen.y,screen.width,screen.height);context.clip();
  context.translate(screen.x,screen.y);context.scale(screen.width/46,screen.height/42);
  const scale=Math.max(46/background.width,42/background.height);
  const width=background.width*scale,height=background.height*scale;
  context.drawImage(background,(46-width)*(art.focus??.5),(42-height)/2,width,height);
  for(const layer of art.layers){
    const asset=image(layer.url),source=layer.source??[0,0,asset.width,asset.height];
    context.drawImage(asset,...source,...layer.target);
  }
  const glass=context.createLinearGradient(0,0,46,42);
  glass.addColorStop(0,'#ffffff24');glass.addColorStop(.5,'#ffffff00');glass.addColorStop(1,'#06122133');
  context.fillStyle=glass;context.fillRect(0,0,46,42);
  if(cabinet.id==='studio-afterglow')paintGirlhubLogo(context,1,1,44,10);
  context.restore();
}
