import {randomInt} from 'node:crypto';
import {TEMPLE_DATA,templeWeightedIndex,type TempleAction} from '../../src/shared/floodedTempleMath';
import {validTempleStake,validTempleSettings,validTempleView,rebuildTempleView,templeResult,type TempleView,type TempleResult} from '../../src/shared/floodedTemple';
export class TempleMoveError extends Error {}
export function startTemple(settings:unknown,stake:string,draw:(max:number)=>number=randomInt):TempleResult {
  if(!validTempleSettings(settings)||!validTempleStake(stake))throw new TempleMoveError('Недопустимая ставка или режим храма.');
  const uniform=(length:number)=>templeWeightedIndex(Array(length).fill(1),draw);
  const baseCase={layout:uniform(TEMPLE_DATA.baseLayouts.length),pattern:uniform(TEMPLE_DATA.basePattern.length),tier:templeWeightedIndex(TEMPLE_DATA.baseTiers.map(t=>t.weight),draw),relic:templeWeightedIndex(TEMPLE_DATA.relicWeights,draw)===1};
  // The relic is reachable in precisely the rare map variant. No future draw is exposed.
  const bonusCase=baseCase.relic?{layout:uniform(TEMPLE_DATA.bonusLayouts.length),tier:templeWeightedIndex(TEMPLE_DATA.bonusTiers.map(t=>t.weight),draw)}:null;
  return templeResult(rebuildTempleView(baseCase,bonusCase,stake));
}
export function moveTemple(view:TempleView,stake:string,revision:unknown,move:unknown,picks?:number[]):TempleResult {
  if(!validTempleView(stake,view)||view.phase!=='bonus'||revision!==view.revision)throw new TempleMoveError('Экспедиция уже изменилась. Восстанови сохранённый ход.');
  let action:TempleAction;
  if(move==='temple-finish'&&picks===undefined)action={kind:'finish'};
  else if((move==='temple-step'||move==='temple-rope')&&Array.isArray(picks)&&picks.length===1&&Number.isInteger(picks[0])&&picks[0]>=0&&picks[0]<20)action={kind:move==='temple-step'?'step':'rope',to:picks[0]};
  else throw new TempleMoveError('Недопустимое действие экспедиции.');
  try{return templeResult(rebuildTempleView(view.baseCase,view.bonusCase,stake,[...view.history,action]));}
  catch{throw new TempleMoveError('В выбранную комнату нельзя пройти этим способом.');}
}
