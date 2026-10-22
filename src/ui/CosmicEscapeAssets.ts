import {SlotAssets, type SlotAssetState} from './slotKit/SlotAssets';
import {cosmicSlot} from './slotKit/nativeSlots';

export const COSMIC_ESCAPE_ASSETS = cosmicSlot.assets;
export type CosmicAssetState = SlotAssetState;

export class CosmicEscapeAssets extends SlotAssets<keyof typeof COSMIC_ESCAPE_ASSETS> {
  constructor(changed: (state: CosmicAssetState) => void,
    createImage?: () => HTMLImageElement, timeoutMs = 30000) {
    super(COSMIC_ESCAPE_ASSETS, changed, createImage, timeoutMs);
  }
}
