import {miraSeatAmount,type MiraView} from '../shared/miraRoutine';

export const MIRA_ATLASES={
  walk:{file:'mira-walk-24.png',columns:6,rows:4,fullBody:true},
  seat:{file:'mira-seat.png',columns:4,rows:2,fullBody:true},
  wipe:{file:'mira-wipe-24.png',columns:6,rows:4,fullBody:false,contactGround:319},
  work:{file:'mira-work-corrected.png',columns:4,rows:4,fullBody:false},
  react:{file:'mira-react.png',columns:4,rows:4,fullBody:false},
  serve:{file:'mira-serve.png',columns:4,rows:2,fullBody:false},
} as const;
export type MiraAtlas=keyof typeof MIRA_ATLASES;
export type MiraFrame={atlas:MiraAtlas;frame:number;seat:number;flipped:boolean;clip:MiraView['action']};
const clamp=(p:number)=>Math.max(0,Math.min(1,Number.isFinite(p)?p:0));
const frameAt=(p:number,count:number)=>Math.min(count-1,Math.floor(clamp(p)*count));

export function interpolateMiraProgress(from:MiraView,to:MiraView,amount:number):Partial<MiraView> {
  if(from.action==='wipe'&&to.action==='wipe'&&to.progress>=from.progress){
    return {progress:from.progress+(to.progress-from.progress)*amount};
  }
  if(from.action!=='walk'||to.action!=='walk')return {};
  const phaseChange=(to.progress-from.progress+1)%1;
  return {progress:(from.progress+phaseChange*amount)%1};
}

/** Complete painted poses share the authoritative room timeline. No articulated cutout limbs. */
export function sampleMiraFrame(view:MiraView,reducedMotion=false):MiraFrame {
  const p=clamp(view.progress),seat=miraSeatAmount(view.action,p);
  const result:MiraFrame={atlas:'react',frame:8,seat,flipped:false,clip:view.action};
  switch(view.action){
    case 'walk':return {...result,atlas:'walk',frame:reducedMotion?3:frameAt(p,MIRA_ATLASES.walk.columns*MIRA_ATLASES.walk.rows),flipped:view.facing==='left'};
    case 'sit':return {...result,atlas:'seat',frame:0};
    case 'stand-up':case 'sit-down':return {...result,atlas:'seat',frame:Math.round((1-seat)*7)};
    case 'wipe':{
      const count=MIRA_ATLASES.wipe.columns*MIRA_ATLASES.wipe.rows;
      return {...result,atlas:'wipe',frame:reducedMotion?3:frameAt(p===1?1:(p*5)%1,count)};
    }
    case 'polish':{
      const sequence=[8,9,10,11,10,9];
      return {...result,atlas:'work',frame:reducedMotion?8:sequence[frameAt((p*5)%1,sequence.length)]};
    }
    case 'stock':return {...result,atlas:'work',frame:12+frameAt(p,4)};
    case 'serve':return {...result,atlas:'serve',frame:p<.12?0:p<.22?1:p<.3?2:p<.5?3:p<.59?4:p<.68?5:p<.82?6:7};
    case 'greet':return {...result,frame:reducedMotion?8:frameAt(clamp((p-.08)/.84),8)};
    case 'listen':{
      const nod=[9,10,11,10,9];
      return {...result,frame:reducedMotion||p<=.3||p>=.7?8:nod[frameAt((p-.3)/.4,nod.length)]};
    }
    case 'chat':{
      const sequence=[15,12,13,14,13,12,15,15];
      return {...result,frame:reducedMotion?13:sequence[frameAt(p,sequence.length)]};
    }
    default:return result;
  }
}
