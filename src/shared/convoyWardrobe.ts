export const CONVOY_LOOK_IDS=['survivor','recon','medic','pilot','urban','commander'] as const;
export type ConvoyLookId=typeof CONVOY_LOOK_IDS[number];
export const CONVOY_LOOK_ROUNDS=[0,10,25,50,100,200] as const;
export type ConvoyProgress={version:1;completedRounds:number};

export function validConvoyProgress(value:unknown):value is ConvoyProgress{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const data=value as Record<string,unknown>;
  return Object.keys(data).sort().join(',')==='completedRounds,version'&&data.version===1&&Number.isSafeInteger(data.completedRounds)&&Number(data.completedRounds)>=0;
}
export function convoyLookLevel(rounds:number){
  if(!Number.isSafeInteger(rounds)||rounds<0)throw new Error('Invalid completed Convoy round count');
  let level=0;for(let i=1;i<CONVOY_LOOK_ROUNDS.length;i++)if(rounds>=CONVOY_LOOK_ROUNDS[i])level=i;
  return level;
}
