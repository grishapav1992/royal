import {CARIBBEAN_CREW} from '../../../../games/caribbean-treasures/CaribbeanCrew';
import {COSMIC_CREW_RATES} from '../../../../src/shared/cosmicCrew';
/** Proposed thresholds. The point scale is the one already used by Cosmic Escape. */
export const THRESHOLDS=[0,100,250,450,700,1000,1350,1750,2200,2700,3250];
export const CREW=CARIBBEAN_CREW.map((m,i)=>({...m,points:THRESHOLDS[i]}));
export const RATES=COSMIC_CREW_RATES;
export const pointsFor=(cents:number)=>RATES.reduce((p,r)=>cents>=r.from?r.points:p,0);
export const unlockedCount=(points:number)=>CREW.filter(m=>points>=m.points).length;

