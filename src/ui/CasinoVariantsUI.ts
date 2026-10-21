import { LimboSlotUI } from './LimboSlotUI';
import { DiceSlotUI } from './DiceSlotUI';
import { PlinkoSlotUI } from './PlinkoSlotUI';
import { CasinoVariantView } from './CasinoVariantView';
import type { BaseVariantGameId } from '../shared/casinoVariants';

export class CasinoVariantsUI {
 private game: { destroy(): void };
 constructor(host: HTMLElement, gameId: BaseVariantGameId) {
  this.game = gameId === 'variant-limbo' ? new LimboSlotUI(host, gameId)
   : gameId === 'variant-dice' ? new DiceSlotUI(host, gameId)
   : gameId === 'variant-plinko' ? new PlinkoSlotUI(host, gameId)
   : new CasinoVariantView(host, gameId);
 }
 destroy() { this.game.destroy(); }
}
