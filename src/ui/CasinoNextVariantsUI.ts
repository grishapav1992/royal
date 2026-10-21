import { FruitsSlotUI } from './FruitsSlotUI';
import { CasinoNextVariantView } from './CasinoNextVariantView';
import type { NextVariantGameId } from '../shared/casinoNextVariants';

export class CasinoNextVariantsUI {
 private game: { destroy(): void };
 constructor(host: HTMLElement, gameId: NextVariantGameId) {
  this.game = gameId === 'variant-fruits' ? new FruitsSlotUI(host, gameId) : new CasinoNextVariantView(host, gameId);
 }
 destroy() { this.game.destroy(); }
}
