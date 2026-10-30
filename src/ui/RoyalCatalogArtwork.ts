import covers from './royalCatalogArtwork.json';
import { royalGameArtwork } from './RoyalGameArtwork';

// Catalogue posters have their own crops. Cabinet screens retain their startup art.
export function royalCatalogArtwork(id: string): string {
  if(id==='studio-wild-nudge')return '/assets/wild-nudge/cover.webp';
  if(id==='studio-forest-heart')return '/assets/forest-heart/v3/elf-idle.webp';
  if(id==='studio-flooded-temple')return '/assets/flooded-temple/cover.webp';
  return (covers as Record<string, string>)[id] ?? royalGameArtwork(id);
}
