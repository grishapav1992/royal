import {SlotAssets,type SlotAssetState} from './slotKit/SlotAssets';
import {convoySlot} from './slotKit/nativeSlots';
export const CONVOY_ASSETS=convoySlot.assets;
export type ConvoyAssetState=SlotAssetState;
export class LastConvoyAssets extends SlotAssets<keyof typeof CONVOY_ASSETS> {
 constructor(changed:(state:ConvoyAssetState)=>void){super(CONVOY_ASSETS,changed);}
}
