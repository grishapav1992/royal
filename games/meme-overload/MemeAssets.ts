import {SlotAssets,type SlotAssetState} from '../../src/ui/slotKit/SlotAssets';
/** Square crops of the six pictures. Sources and crop rectangles: public/licenses/meme-overload-references.json. */
export const MEME_ASSETS={
 doge:'/assets/meme-overload/v3/doge-07910af7826e.webp',
 harold:'/assets/meme-overload/v3/harold-838d5dcd9023.webp',
 grumpy:'/assets/meme-overload/v3/grumpy-2290352b815b.webp',
 smudge:'/assets/meme-overload/v3/smudge-258bfb8fcf43.webp',
 stonks:'/assets/meme-overload/v3/stonks-78348f9b6f1c.webp',
 pepe:'/assets/meme-overload/v3/pepe-e4b64a86cdc9.webp',
} as const;
export type MemeAssetState=SlotAssetState;
export class MemeAssets extends SlotAssets<keyof typeof MEME_ASSETS>{
  constructor(changed:(state:MemeAssetState)=>void){super(MEME_ASSETS,changed);}
}
