import type {JackieLocation} from '../../src/shared/jackieChan';

export type FightMove='punch'|'combo'|'evade'|'kick'|'chair'|'table'|'stool';
export type Furniture='chair'|'table'|'stool';
export const FIGHT_PLANS=[
  {id:'boxing',moves:['combo','punch','kick']},
  {id:'counter',moves:['evade','kick','punch']},
  {id:'high-kick',moves:['kick','combo','evade']},
  {id:'straight',moves:['punch','stool','table']},
  {id:'table-run',moves:['table','evade','kick']},
  {id:'stool-step',moves:['stool','punch','combo']},
  {id:'chair-counter',moves:['chair','evade','punch']},
]as const satisfies readonly {id:string;moves:readonly [FightMove,FightMove,FightMove]}[];
/** Reference routine retained for furniture continuity verification, never auto-selected. */
export const FURNITURE_PLAN={id:'furniture',moves:['chair','table','stool']}as const;
export type FightPlan=typeof FIGHT_PLANS[number]|typeof FURNITURE_PLAN;
export const moveFurniture=(move:FightMove):Furniture|null=>move==='chair'||move==='table'||move==='stool'?move:null;
export const moveReach=(move:FightMove)=>({punch:.40,combo:.40,evade:.40,kick:.65,chair:.57,table:.68,stool:.64})[move];

/** Stable cosmetic variation. No paid-round random source or success flag is involved. */
export function fightPlan(seriesId:string,fightIndex:number,location:JackieLocation):FightPlan {
  let hash=2166136261;for(const char of 'kung-fu:'+seriesId)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const place=location==='harbor'?2:location==='market'?4:0;
  const opening=(hash+place)%(FIGHT_PLANS.length-1);
  return FIGHT_PLANS[(opening+Math.max(0,Math.trunc(fightIndex))*3)%FIGHT_PLANS.length];
}
