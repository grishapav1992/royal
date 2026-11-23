/** Local UI verification only. Find an existing natural bonus using the unchanged engines. */
import {seededRandom} from '../src/shared/draconaMath';
import {startLuelonSlotGame} from '../server/games/luelonSlots';
import {startCaramel} from '../server/games/caramelCarnival';
import {startConvoy} from '../server/games/lastConvoy';
import {startNitro} from '../server/games/nitroRun';
import {startAfter} from '../server/games/afterglow';

export const layoutSlots=['studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-last-convoy','studio-nitro-run','studio-afterglow','studio-meme-overload'] as const;
export function layoutDraw(seed:number){const random=seededRandom(seed);return(max:number)=>Math.floor(random()*max);}
// A natural mission whose first free spin contains energy growth, a WILD beam and Echo.
export const layoutCosmicFeaturesSeed = 25524;

export function layoutCosmicRacerSeed(cue: 'calm' | 'even' | 'win' | 'big-win') {
 for (let seed = 1; seed < 100000; seed++) {
  const {ended, credit} = startLuelonSlotGame('studio-cosmic-escape', {luelon: {mode: 'normal'}}, '10', layoutDraw(seed));
  const result = credit < 10 ? 'calm' : credit === 10 ? 'even' : credit >= 200 ? 'big-win' : 'win';
  if (ended && result === cue) return seed;
 }
 throw Error('No racer fixture found within search budget');
}
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

/** Natural settled rounds for the disposable Convoy autoplay tests. */
export function layoutConvoyLimitSeed(outcome: 'loss' | 'win') {
 for (let seed = 1; seed < 1000; seed++) {
  const round = startConvoy({convoy:{mode:'normal'}}, '10', layoutDraw(seed));
  const net = Number(round.view.totalPayoutUnits) - 10;
  if (round.ended && (outcome === 'loss' ? net < 0 : net > 0)) return seed;
 }
 throw Error('No Convoy limit fixture found within search budget');
}
