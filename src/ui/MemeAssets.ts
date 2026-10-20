import {SlotAssets,type SlotAssetState} from './slotKit/SlotAssets';
import {memeSlot} from './slotKit/nativeSlots';
export const MEME_ASSETS=memeSlot.assets;
export type MemeAssetState=SlotAssetState;
export class MemeAssets extends SlotAssets<keyof typeof MEME_ASSETS>{
  constructor(changed:(state:MemeAssetState)=>void){super(MEME_ASSETS,changed);}
}
