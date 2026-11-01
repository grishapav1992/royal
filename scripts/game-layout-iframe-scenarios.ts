/** Reproducible UI scenarios, using the unchanged production engines and entropy. */
import {startDracona} from '../server/games/dracona';
import {startForestHeart} from '../server/games/forestHeart';
import {startTemple} from '../server/games/floodedTemple';
import {startTempleCascade} from '../server/games/floodedTempleCascade';
import {layoutDraw} from './game-layout-scenarios';
export const layoutIframes=['studio-dracona','studio-forest-heart','studio-flooded-temple'];
const seeds=new Map<string,number>();
export function layoutIframeSeed(id:string,legacy=false){
 const key=id+':'+legacy;if(seeds.has(key))return seeds.get(key)!;
 if(!layoutIframes.includes(id))throw Error('Unsupported iframe scenario');
 for(let seed=1;seed<100000;seed++){
  const draw=layoutDraw(seed);
  const found=id==='studio-dracona'?!startDracona({dracona:{mode:'normal'}},'100',draw).ended
   :id==='studio-forest-heart'?(()=>{const r=startForestHeart({forestHeart:{mode:'normal'}},'100',draw);return r.view.base.ability&&r.view.base.bonusAwarded;})()
   :legacy?!startTemple({temple:{mode:'normal'}},'100',draw).ended
   :(()=>{const r=startTempleCascade({temple:{mode:'cascades'}},'100',draw);return !r.ended&&r.view.frames.some(frame=>frame.addedFreeSpins>0);})();
  if(found){seeds.set(key,seed);return seed;}
 }
 throw Error('No natural UI fixture within search budget');
}
