import {randomInt} from 'node:crypto';
import {initialCascadeState,type CascadeDraw} from '../../src/shared/floodedTempleCascadeMath';
import {validCascadeSettings,validCascadeStake,validCascadeView,replayCascadeOperations,generateCascadeOperation,cascadeResult,type TempleCascadeView} from '../../src/shared/floodedTempleCascade';

export class TempleCascadeMoveError extends Error{}
export function startTempleCascade(settings:unknown,stake:string,draw:CascadeDraw=randomInt){
  if(!validCascadeSettings(settings)||!validCascadeStake(stake))throw new TempleCascadeMoveError('Недопустимая ставка или режим каскадов.');
  const tape=generateCascadeOperation(initialCascadeState(),draw);
  return cascadeResult(replayCascadeOperations(stake,[tape]));
}
export function moveTempleCascade(view:TempleCascadeView,stake:string,revision:unknown,move:unknown,draw:CascadeDraw=randomInt){
  if(!validCascadeView(stake,view)||view.phase==='complete'||revision!==view.revision||move!=='temple-cascade')throw new TempleCascadeMoveError('Каскадный раунд уже изменился. Восстанови сохранённый результат.');
  const operation=generateCascadeOperation(structuredClone(view.state),draw);
  return cascadeResult(replayCascadeOperations(stake,[...view.operations,operation]));
}
