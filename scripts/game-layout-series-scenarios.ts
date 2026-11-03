/** Natural successful shots for testing free decisions, never a production route. */
import {startPenalty,movePenalty} from '../server/games/crLeo';
import {layoutDraw} from './game-layout-scenarios';
export const layoutSeries=['original-cr-vs-leo','original-jackie-chan'];
export function layoutSeriesSeed(){
 for(let seed=1;seed<10000;seed++){
  const draw=layoutDraw(seed),first=startPenalty({penalty:{hero:'cr',risk:'safe'}},'10',draw);
  if(first.status==='playing'&&movePenalty(first,'10','penalty-kick',first.revision,draw,'extreme').status==='playing')return seed;
 }
 throw Error('No natural two-win series found');
}
