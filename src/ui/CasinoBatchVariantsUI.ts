import { TargetPlinkoUI } from './TargetPlinkoUI';
import { CasinoBatchVariantView } from './CasinoBatchVariantView';
import type { BatchVariantGameId } from '../shared/casinoBatchVariants';

export class CasinoBatchVariantsUI {
 private game: { destroy(): void };
 constructor(host: HTMLElement, gameId: BatchVariantGameId) {
  this.game = gameId === 'variant-target-plinko' ? new TargetPlinkoUI(host, gameId) : new CasinoBatchVariantView(host, gameId);
 }
 destroy() { this.game.destroy(); }
}
