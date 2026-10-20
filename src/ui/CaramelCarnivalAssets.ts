import {SlotAssets, type SlotAssetState} from './slotKit/SlotAssets';
import {caramelSlot} from './slotKit/nativeSlots';

export const CARAMEL_ASSETS = caramelSlot.assets;
export type CaramelAssetState = SlotAssetState;

export class CaramelCarnivalAssets extends SlotAssets<keyof typeof CARAMEL_ASSETS> {
  constructor(changed: (state: CaramelAssetState) => void,
    createImage: () => HTMLImageElement = () => new Image(), timeoutMs = 30000) {
    super(CARAMEL_ASSETS, changed, createImage, timeoutMs);
  }
}
