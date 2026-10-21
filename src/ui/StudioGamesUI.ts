import { IndependentGameUI } from '../modules/IndependentGameUI';
import type { StudioGameId } from '../shared/studioGames';

/** The hall only loads the selected package; wallet services stay in the host. */
export class StudioGamesUI {
 private game: IndependentGameUI;
 constructor(host: HTMLElement, gameId: StudioGameId) {
  this.game = new IndependentGameUI(host, gameId);
 }
 destroy() { this.game.destroy(); }
}
