import {SlotAssets,type SlotAssetState} from './slotKit/SlotAssets';
import {afterglowSlot} from './slotKit/nativeSlots';
export const AFTER_ASSETS=afterglowSlot.assets;
export type AfterAssetState=SlotAssetState;
export class AfterglowAssets extends SlotAssets<keyof typeof AFTER_ASSETS>{constructor(changed:(state:AfterAssetState)=>void){super(AFTER_ASSETS,changed);}}
