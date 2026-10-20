import {SlotAssets,type SlotAssetState} from './slotKit/SlotAssets';
import {nitroSlot} from './slotKit/nativeSlots';
export const NITRO_ASSETS=nitroSlot.assets;
export type NitroAssetState=SlotAssetState;
export class NitroRunAssets extends SlotAssets<keyof typeof NITRO_ASSETS>{
 constructor(changed:(state:NitroAssetState)=>void){super(NITRO_ASSETS,changed);}
}
