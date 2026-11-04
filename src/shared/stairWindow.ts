import {ROOF_WINDOW_PLATFORM,roofWindowPlatformPosition} from './rooftop';

/** A manual side entrance at the middle landing, separate from ground-level doorways. */
const {index:landingIndex,junction,length,windowOffset}=ROOF_WINDOW_PLATFORM;
export const STAIR_WINDOW={
  landingIndex,landing:junction,platformLength:length,outside:roofWindowPlatformPosition(windowOffset),floor:3,column:2,
  interior:{x:3230,top:-26,width:200,height:128},
  entry:{x:3230,y:240},arrival:{x:3230,y:330},
  return:{...roofWindowPlatformPosition(windowOffset-28),stairStep:landingIndex,stairDirection:-1,facing:'right'},
} as const;

export function atStairWindow(p:{hall:string;x:number;y:number;stairStep?:number}){
  return p.hall==='street'&&[landingIndex,landingIndex+1].includes(p.stairStep??0)
    &&Math.hypot(p.x-STAIR_WINDOW.outside.x,p.y-STAIR_WINDOW.outside.y)<=18;
}
export function canApproachStairWindow(p:{hall:string;x:number;y:number;stairStep?:number}){
  return p.hall==='street'&&[landingIndex,landingIndex+1].includes(p.stairStep??0);
}
export function atCardWindow(p:{hall:string;x:number;y:number}){
  return p.hall==='github'&&Math.hypot(p.x-STAIR_WINDOW.entry.x,p.y-STAIR_WINDOW.entry.y)<=62;
}
