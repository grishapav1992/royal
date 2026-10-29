import { isStudioGame, STUDIO_INFO } from '../shared/studioGames';
import { FIRST_FLOOR_ART, FIRST_FLOOR_GAME_THEMES } from './FirstFloorGameArt';
import previews from '../game/startupPreviews.json';
import { STUDIO_ART } from './StudioArtwork';

const covers: Record<string, string> = {
  'studio-forest-heart':'/assets/forest-heart/v1/catalog.webp',
  'royal-roulette':'/assets/royal-roulette/cover.svg',
  'studio-neopolis':'/assets/neopolis/cover-cabinet-v2.webp',
  'studio-cosmic-escape':'/assets/cosmic-guardians/v1/background.webp',
  'studio-caramel-carnival':'/assets/caramel-rebuild/v1/background.webp',
  'studio-velvet-reign':'/assets/velvet-rebuild/v1/background.webp',
  'studio-last-convoy':'/assets/last-convoy/v1/background.webp',
  'studio-nitro-run':'/assets/nitro-run/v1/background.webp',
  'studio-afterglow':'/assets/afterglow/v1/background-studio-v3.webp',
  'studio-meme-overload':'/assets/meme-overload/v1/desktop.svg',
  'github-crash':'/assets/last-exit/v1/highway.webp',
};
for (const [id, key] of Object.entries(FIRST_FLOOR_GAME_THEMES)) {
  const art = FIRST_FLOOR_ART[key];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="240" viewBox="400 0 500 240" color="${art.palette[0]}"><path fill="${art.palette[2]}" d="M400 0h500v240H400z"/>${art.scene}</svg>`;
  covers[id] = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
Object.assign(covers, previews.cabinets, previews.catalog);
export function royalGameArtwork(id: string): string {
  return covers[id] ?? (isStudioGame(id) ? STUDIO_ART[STUDIO_INFO[id].theme] : '');
}
