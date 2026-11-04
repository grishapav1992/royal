import {ROOF_STAIR_ROUTE} from './rooftop';

/** A manual side entrance at the middle landing, separate from ground-level doorways. */
const landingIndex=Math.floor(ROOF_STAIR_ROUTE.length/2);
export const STAIR_WINDOW={
  landingIndex,landing:ROOF_STAIR_ROUTE[landingIndex],floor:3,column:0,
  interior:{x:3230,top:-26,width:200,height:128},
  entry:{x:3230,y:240},arrival:{x:3230,y:330},
  return:{...ROOF_STAIR_ROUTE[landingIndex],stairStep:landingIndex+1,stairDirection:-1,facing:'left'},
} as const;

export function atStairWindow(p:{hall:string;x:number;y:number;stairStep?:number}){
  return p.hall==='street'&&[landingIndex,landingIndex+1].includes(p.stairStep??0)
    &&Math.hypot(p.x-STAIR_WINDOW.landing.x,p.y-STAIR_WINDOW.landing.y)<=24;
}
export function atCardWindow(p:{hall:string;x:number;y:number}){
  return p.hall==='github'&&Math.hypot(p.x-STAIR_WINDOW.entry.x,p.y-STAIR_WINDOW.entry.y)<=62;
}
