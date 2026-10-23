import { LimboSlotUI } from './LimboSlotUI';
import { DiceSlotUI } from './DiceSlotUI';
import { PlinkoSlotUI } from './PlinkoSlotUI';
import { OriginalGameView, type OriginalGameId } from './OriginalGameView';
export type { OriginalGameId } from './OriginalGameView';

/** Compatibility adapter for callers outside the independent game loader. */
export class OriginalGames {
 private game: { destroy(): void };
 constructor(container: HTMLElement, gameId: OriginalGameId) {
  this.game = gameId === 'royal-limbo' ? new LimboSlotUI(container, gameId)
   : gameId === 'royal-dice' ? new DiceSlotUI(container, gameId)
   : gameId === 'royal-plinko' ? new PlinkoSlotUI(container, gameId)
   : new OriginalGameView(container, gameId);
 }
 destroy() { this.game.destroy(); }
}
