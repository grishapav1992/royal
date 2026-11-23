import {SlotAssets, type SlotAssetState} from '../../src/ui/slotKit/SlotAssets';
import {cosmicSlot} from '../../src/ui/slotKit/nativeSlots';
import {COSMIC_RACER_IDLE} from './CosmicEscapeRacer';

export const COSMIC_ESCAPE_ASSETS = {...cosmicSlot.assets, alien: COSMIC_RACER_IDLE};
export type CosmicAssetState = SlotAssetState;

export class CosmicEscapeAssets extends SlotAssets<keyof typeof COSMIC_ESCAPE_ASSETS> {
  constructor(changed: (state: CosmicAssetState) => void,
    createImage?: () => HTMLImageElement, timeoutMs = 30000) {
    super(COSMIC_ESCAPE_ASSETS, changed, createImage, timeoutMs);
  }
}
