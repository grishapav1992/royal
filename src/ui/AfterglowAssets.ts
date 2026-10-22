import {SlotAssets,type SlotAssetState} from './slotKit/SlotAssets';
import {afterglowSlot} from './slotKit/nativeSlots';
export const AFTER_ASSETS=afterglowSlot.assets;
export type AfterAssetState=SlotAssetState;
export type AfterAssetName=keyof typeof AFTER_ASSETS;
export function afterCharacterAsset(girl:number,look:0|1=0):AfterAssetName { return `${look?'look':'base'}${Math.max(0,Math.min(3,girl))}` as AfterAssetName; }
export class AfterglowAssets extends SlotAssets<AfterAssetName>{
 constructor(changed:(state:AfterAssetState)=>void){super(AFTER_ASSETS,changed);}
 loadCurrent(girl:number,look:0|1=0){return this.load(['symbols','background','base0',afterCharacterAsset(girl,look)]);}
}
