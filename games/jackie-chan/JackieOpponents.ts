import type { JackieLocation } from '../../src/shared/jackieChan';

export const OPPONENTS = {
  street: { asset:'/assets/jackie-chan/foes.webp', scale:1, attack:1, guard:7, ru:'Уличный боец', en:'Street fighter' },
  agile: { asset:'/assets/jackie-chan/foe-agile.webp', scale:.92, attack:5, guard:4, ru:'Ловкий боец', en:'Agile fighter' },
  bruiser: { asset:'/assets/jackie-chan/foe-bruiser.webp', scale:1.08, attack:1, guard:7, ru:'Портовый громила', en:'Dockside bruiser' },
  enforcer: { asset:'/assets/jackie-chan/foe-enforcer.webp', scale:1.02, attack:1, guard:7, ru:'Телохранитель', en:'Bodyguard' },
  master: { asset:'/assets/jackie-chan/foe-master.webp', scale:.91, attack:5, guard:7, ru:'Мастер кунг-фу', en:'Kung fu master' },
} as const;
export type OpponentId = keyof typeof OPPONENTS;
const LINEUPS:Record<JackieLocation,readonly OpponentId[]> = {
  restaurant:['street','master','enforcer','agile','bruiser'],
  harbor:['bruiser','street','agile','enforcer','master'],
  market:['agile','enforcer','street','master','bruiser'],
};
/** Cosmetic rotation only. It uses no outcome, wallet value or random source. */
export function opponentLineup(location:JackieLocation,fightIndex:number,count:number){
  const order=LINEUPS[location],offset=Math.max(0,Math.trunc(fightIndex))*2;
  return Array.from({length:count},(_,slot)=>{
    const id=order[(offset+slot)%order.length];
    return {id,...OPPONENTS[id]};
  });
}
