import type { JackieLocation } from '../../src/shared/jackieChan';

export const OPPONENTS = {
  street: { asset:'/assets/jackie-chan/foes.webp', rank:1, scale:1, attack:1, guard:7, ru:'Уличный боец', en:'Street fighter' },
  agile: { asset:'/assets/jackie-chan/foe-agile.webp', rank:2, scale:.92, attack:5, guard:4, ru:'Ловкий боец', en:'Agile fighter' },
  bruiser: { asset:'/assets/jackie-chan/foe-bruiser.webp', rank:3, scale:1.08, attack:1, guard:7, ru:'Портовый громила', en:'Dockside bruiser' },
  enforcer: { asset:'/assets/jackie-chan/foe-enforcer.webp', rank:4, scale:1.02, attack:1, guard:7, ru:'Телохранитель', en:'Bodyguard' },
  master: { asset:'/assets/jackie-chan/foe-master.webp', rank:5, scale:.91, attack:5, guard:7, ru:'Мастер кунг-фу', en:'Kung fu master' },
} as const;
export type OpponentId = keyof typeof OPPONENTS;
export const OPPONENT_DIFFICULTIES = {
  safe:{ru:'Лёгкий',en:'Easy'},
  sharp:{ru:'Средний',en:'Medium'},
  extreme:{ru:'Сложный',en:'Hard'},
} as const;
const POOLS:Record<number,readonly OpponentId[]> = {
  1:['street','agile'],
  2:['agile','bruiser','enforcer'],
  3:['bruiser','enforcer','master'],
};
const LOCATION_OFFSET:Record<JackieLocation,number>={restaurant:0,harbor:1,market:2};
/** Ranks describe the cast. Server difficulty still comes only from group size. */
export function opponentLineup(location:JackieLocation,fightIndex:number,count:number){
  const order=POOLS[count];if(!order)throw RangeError('Unsupported opponent count');
  const offset=LOCATION_OFFSET[location]+Math.max(0,Math.trunc(fightIndex));
  return Array.from({length:count},(_,slot)=>{
    const id=order[(offset+slot)%order.length];
    return {id,...OPPONENTS[id]};
  });
}
