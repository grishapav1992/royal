import { LimboSlotUI } from './LimboSlotUI';
import { DiceSlotUI } from './DiceSlotUI';
import { VolcanicPlinkoUI } from './VolcanicPlinkoUI';
import { OriginalGameView, type OriginalGameId } from './OriginalGameView';
export type { OriginalGameId } from './OriginalGameView';

/** Compatibility adapter for callers outside the independent game loader. */
export class OriginalGames {
 private game: { destroy(): void };
 constructor(container: HTMLElement, gameId: OriginalGameId, options: { skipIntro?: boolean } = {}) {
  this.game = gameId === 'royal-limbo' ? new LimboSlotUI(container, gameId)
   : gameId === 'royal-dice' ? new DiceSlotUI(container, gameId)
   : gameId === 'royal-plinko' ? new VolcanicPlinkoUI(container, options)
   : new OriginalGameView(container, gameId);
 }
 destroy() { this.game.destroy(); }
}
