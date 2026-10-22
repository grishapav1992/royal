import {SlotAssets, type SlotAssetState} from './slotKit/SlotAssets';
import {velvetSlot} from './slotKit/nativeSlots';

export const VELVET_ASSETS = velvetSlot.assets;
export type VelvetAssetState = SlotAssetState;

export class VelvetReignAssets extends SlotAssets<keyof typeof VELVET_ASSETS> {
  constructor(changed: (state: VelvetAssetState) => void,
    createImage?: () => HTMLImageElement, timeoutMs = 30000) {
    super(VELVET_ASSETS, changed, createImage, timeoutMs);
  }
}
