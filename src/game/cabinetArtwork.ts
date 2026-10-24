import type Phaser from 'phaser';
import type { Cabinet } from '../shared/cabinets';
import type { ARCADE_HOUSE_GAMES, ACTIVE_STUDIO_GAMES } from '../shared/arcadeCatalog';
import { cabinetScreen } from './cabinetArt';
import previews from './startupPreviews.json';
import {ARCADE_GITHUB_GAMES} from '../shared/arcadeCatalog';
import {royalGameArtwork} from '../ui/RoyalGameArtwork';
import {royalCatalogArtwork} from '../ui/RoyalCatalogArtwork';

type HouseGameId = typeof ARCADE_HOUSE_GAMES[number];
type StudioGameId = typeof ACTIVE_STUDIO_GAMES[number];

// Full game artwork stays in its module; the hall only loads these small composites.
export const CABINET_PREVIEWS: Readonly<Record<HouseGameId, string>> = { ...previews.cabinets, 'studio-neopolis': royalCatalogArtwork('studio-neopolis') };
export const CATALOG_PREVIEWS: Readonly<Record<StudioGameId, string>> = { ...previews.catalog, 'studio-neopolis': royalCatalogArtwork('studio-neopolis') };
const allPreviews:Record<string,string>={...CABINET_PREVIEWS,...Object.fromEntries(ARCADE_GITHUB_GAMES.map(id=>[id,royalGameArtwork(id)]))};
const textureKey = (url: string) => 'cabinet-art:' + url;
const previewFor = (id: string): string | undefined =>
  Object.hasOwn(allPreviews, id) ? allPreviews[id] : undefined;

export function preloadCabinetArtwork(scene: Phaser.Scene) {
  for (const url of Object.values(allPreviews)) {
    if (!scene.textures.exists(textureKey(url))) scene.load.image(textureKey(url), url);
  }
}

export function cabinetArtworkReady(scene: Phaser.Scene, id: string): boolean {
  const url = previewFor(id);
  return Boolean(url && scene.textures.exists(textureKey(url)));
}

export function paintCabinetArtwork(scene: Phaser.Scene, context: CanvasRenderingContext2D, cabinet: Cabinet) {
  const url = previewFor(cabinet.id);
  if (!url || !cabinetArtworkReady(scene, cabinet.id)) return;
  const image = scene.textures.get(textureKey(url)).getSourceImage() as HTMLImageElement;
  const screen = cabinetScreen(cabinet);
  context.drawImage(image, screen.x, screen.y, screen.width, screen.height);
}
