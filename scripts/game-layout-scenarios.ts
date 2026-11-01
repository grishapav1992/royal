/** Local UI verification only. Find an existing natural bonus using the unchanged engines. */
import {seededRandom} from '../src/shared/draconaMath';
import {startLuelonSlotGame} from '../server/games/luelonSlots';
import {startCaramel} from '../server/games/caramelCarnival';
import {startConvoy} from '../server/games/lastConvoy';
import {startNitro} from '../server/games/nitroRun';
import {startAfter} from '../server/games/afterglow';

export const layoutSlots=['studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-last-convoy','studio-nitro-run','studio-afterglow','studio-meme-overload'] as const;
export function layoutDraw(seed:number){const random=seededRandom(seed);return(max:number)=>Math.floor(random()*max);}
const cache=new Map<string,number>();
export function layoutBonusSeed(id:string){
 if(cache.has(id))return cache.get(id)!;
 if(!layoutSlots.includes(id as typeof layoutSlots[number]))throw Error('Layout fixture supports the seven active slots only');
 for(let seed=1;seed<100000;seed++){
  const draw=layoutDraw(seed);
  const result=id==='studio-cosmic-escape'||id==='studio-velvet-reign'?startLuelonSlotGame(id,{luelon:{mode:'normal'}},'100',draw)
   :id==='studio-caramel-carnival'?startCaramel({caramel:{mode:'normal'}},'100',draw)
   :id==='studio-last-convoy'?startConvoy({convoy:{mode:'normal'}},'100',draw)
   :id==='studio-afterglow'?startAfter({afterglow:{mode:'normal'}},'100',0,draw)
   :startNitro({nitro:{mode:'normal'}},'100',draw);
  if(!result.ended){cache.set(id,seed);return seed;}
 }
 throw Error('No bonus fixture found within search budget');
}
