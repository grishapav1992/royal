import {recoverableStakes} from './gameStakes';
export const COSMIC_ESCAPE_BET_UNITS = recoverableStakes(['20','40','60','80','100','200','300','400','500','600','800','1000','1500','2000','3000','5000','7500','10000','15000','20000','30000','50000','75000','100000','150000','200000']);
export const COSMIC_ESCAPE_DEFAULT_STAKE = '10';
export function validCosmicStake(value:unknown):value is string {
  return typeof value==='string'&&(COSMIC_ESCAPE_BET_UNITS as readonly string[]).includes(value);
}
