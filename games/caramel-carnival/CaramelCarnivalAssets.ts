import {SlotAssets, type SlotAssetState} from '../../src/ui/slotKit/SlotAssets';
import {caramelSlot} from '../../src/ui/slotKit/nativeSlots';

export const CARAMEL_ASSETS = caramelSlot.assets;
export type CaramelAssetState = SlotAssetState;

export class CaramelCarnivalAssets extends SlotAssets<keyof typeof CARAMEL_ASSETS> {
  constructor(changed: (state: CaramelAssetState) => void,
    createImage?: () => HTMLImageElement, timeoutMs = 30000) {
    super(CARAMEL_ASSETS, changed, createImage, timeoutMs);
  }
}
