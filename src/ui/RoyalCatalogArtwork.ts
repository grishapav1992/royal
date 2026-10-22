import covers from './royalCatalogArtwork.json';
import { royalGameArtwork } from './RoyalGameArtwork';

// Catalogue posters have their own crops. Cabinet screens retain their startup art.
export function royalCatalogArtwork(id: string): string {
  return (covers as Record<string, string>)[id] ?? royalGameArtwork(id);
}
