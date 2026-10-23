import {ACTIVITIES} from './activities';
import type {PvpGameId} from './pvp';
export function pvpSeat(gameId:PvpGameId,side:number){
 const point=ACTIVITIES[gameId].entry;
 const cards=['durak','transfer-durak','crazy-eights'].includes(gameId);
 return{x:point.x+(cards?(side===0?0:144):(side===0?-50:50)),y:point.y};
}
