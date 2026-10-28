import { IndependentGameUI } from '../modules/IndependentGameUI';
import { CasinoExpansionView } from './CasinoExpansionView';
import type { ExpansionGameId } from '../shared/casinoExpansion';

export class CasinoExpansionUI {
 private game: { destroy(): void };
 constructor(host: HTMLElement, gameId: ExpansionGameId) {
  this.game = (gameId === 'github-crash' || gameId === 'original-cr-vs-leo' || gameId === 'original-jackie-chan') ? new IndependentGameUI(host, gameId) : new CasinoExpansionView(host, gameId);
 }
 destroy() { this.game.destroy(); }
}
