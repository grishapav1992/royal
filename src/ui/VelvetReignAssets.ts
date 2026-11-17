import {SlotAssets, type SlotAssetState} from './slotKit/SlotAssets';
import {velvetSlot} from './slotKit/nativeSlots';

const dressing = '/assets/velvet-rebuild/dressing-room/';
export const VELVET_ASSETS = {
  star2: velvetSlot.assets.star2,
  star3: velvetSlot.assets.star3,
  star4: velvetSlot.assets.star4,
  star0: dressing + 'evelyn.webp',
  star1: dressing + 'celeste.webp',
  background: dressing + 'background.webp',
  mask: dressing + 'mask.webp', fan: dressing + 'fan.webp',
  perfume: dressing + 'perfume.webp', crown: dressing + 'crown.webp',
  wild: dressing + 'wild.webp', gem: dressing + 'gem.webp', encore: dressing + 'encore.webp',
};
export type VelvetAssetState = SlotAssetState;

export class VelvetReignAssets extends SlotAssets<keyof typeof VELVET_ASSETS> {
  constructor(changed: (state: VelvetAssetState) => void,
    createImage?: () => HTMLImageElement, timeoutMs = 30000) {
    super(VELVET_ASSETS, changed, createImage, timeoutMs);
  }
}
