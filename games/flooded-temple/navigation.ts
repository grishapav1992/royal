import type {TempleView} from '../../src/shared/floodedTemple';
import {templeLegalActions} from '../../src/shared/floodedTempleMath';

/** Select a forced destination, while preserving an explicit legal choice at a fork. */
export function templeRouteChoices(view:TempleView|undefined){
  if(!view?.bonusMap||!view.bonusState||view.bonusState.done)return [];
  return templeLegalActions(view.bonusMap,view.bonusState).filter(action=>action.kind!=='finish');
}
export function templeSelectedRoom(view:TempleView|undefined,selected:number|null){
  const choices=templeRouteChoices(view);
  return choices.some(action=>action.to===selected)?selected:choices.length===1?choices[0].to:null;
}
export const templeDirection=(from:number,to:number)=>to===from-5?'↑':to===from+5?'↓':to===from-1?'←':'→';
